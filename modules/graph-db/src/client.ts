import type { Tracer } from '@modules/tracing';
import { createClient } from 'redis';
import type {
  GraphNodeResult,
  GraphQueryResult,
  GraphQueryStats,
  GraphRelationshipResult,
} from './types';

export type GraphClient = ReturnType<typeof makeGraphClient>;

type RedisClient = ReturnType<typeof createClient>;

export interface MakeGraphClientOpts {
  // Format: redis[s]://[[username][:password]@][host][:port][/db-number]
  // Example: redis://:mypassword@localhost:6379
  url: string;
  tracer: Tracer;
}

function parseStatValue(stat: string): string {
  const parts = stat.split(':');
  return parts[1]?.trim() ?? '0';
}

function parseGraphStats(stats: string[]): GraphQueryStats {
  const result: GraphQueryStats = {
    nodesCreated: 0,
    nodesDeleted: 0,
    relationshipsCreated: 0,
    relationshipsDeleted: 0,
    propertiesSet: 0,
    labelsAdded: 0,
    executionTime: 0,
  };

  for (const stat of stats) {
    if (stat.startsWith('Nodes created:')) {
      result.nodesCreated = Number.parseInt(parseStatValue(stat), 10);
    } else if (stat.startsWith('Nodes deleted:')) {
      result.nodesDeleted = Number.parseInt(parseStatValue(stat), 10);
    } else if (stat.startsWith('Relationships created:')) {
      result.relationshipsCreated = Number.parseInt(parseStatValue(stat), 10);
    } else if (stat.startsWith('Relationships deleted:')) {
      result.relationshipsDeleted = Number.parseInt(parseStatValue(stat), 10);
    } else if (stat.startsWith('Properties set:')) {
      result.propertiesSet = Number.parseInt(parseStatValue(stat), 10);
    } else if (stat.startsWith('Labels added:')) {
      result.labelsAdded = Number.parseInt(parseStatValue(stat), 10);
    } else if (stat.startsWith('Query internal execution time:')) {
      const timeStr = parseStatValue(stat).replace(' milliseconds', '');
      result.executionTime = Number.parseFloat(timeStr);
    }
  }

  return result;
}

function parseGraphResponse(response: unknown[]): GraphQueryResult {
  const [header, ...rest] = response;
  const stats = rest.pop() as string[];
  const data = rest as unknown[][];

  return {
    header: Array.isArray(header) ? header.map(String) : [],
    data,
    stats: parseGraphStats(stats || []),
  };
}

function parseNodeFromData(data: unknown[]): GraphNodeResult | null {
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  const nodeData = data[0];
  if (!Array.isArray(nodeData) || nodeData.length < 3) {
    return null;
  }

  const id = nodeData[0];
  const labels = nodeData[1];
  const properties = nodeData[2];

  if (typeof id !== 'number') {
    return null;
  }

  if (!Array.isArray(labels) || labels.length === 0) {
    return null;
  }

  if (typeof properties !== 'object' || properties === null) {
    return null;
  }

  return {
    id,
    label: labels[0] as string,
    properties: properties as Record<string, unknown>,
  };
}

function parseRelationshipFromData(data: unknown[]): GraphRelationshipResult | null {
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  const relData = data[0];
  if (!Array.isArray(relData) || relData.length < 4) {
    return null;
  }

  const id = relData[0];
  const type = relData[1];
  const sourceNodeId = relData[2];
  const destinationNodeId = relData[3];
  const properties = relData[4];

  if (typeof id !== 'number') {
    return null;
  }

  if (typeof type !== 'string') {
    return null;
  }

  if (typeof sourceNodeId !== 'number') {
    return null;
  }

  if (typeof destinationNodeId !== 'number') {
    return null;
  }

  return {
    id,
    type,
    sourceNodeId,
    destinationNodeId,
    properties:
      typeof properties === 'object' && properties !== null
        ? (properties as Record<string, unknown>)
        : {},
  };
}

export function makeGraphClient(opts: MakeGraphClientOpts) {
  const { url, tracer } = opts;
  let client: RedisClient | null = null;

  async function connect(): Promise<void> {
    return tracer.with('GraphDB connect', async (ctx) => {
      const newClient = createClient({ url });

      newClient.on('error', (err) => {
        ctx.log.error({ error: err }, 'GraphDB client error');
      });

      await newClient.connect();
      client = newClient;
      ctx.log.info(
        { url: url.replace(/\/\/.*@/, '//<credentials>@') },
        'Connected to GraphDB',
      );
    });
  }

  async function disconnect(): Promise<void> {
    return tracer.with('GraphDB disconnect', async (ctx) => {
      if (client) {
        await client.quit();
        client = null;
        ctx.log.info('Disconnected from GraphDB');
      }
    });
  }

  async function query(
    graphName: string,
    cypherQuery: string,
    params?: Record<string, unknown>,
  ): Promise<GraphQueryResult> {
    return tracer.with(`GraphDB query: ${graphName}`, async (ctx) => {
      if (!client) {
        throw new Error('GraphDB client is not connected. Call connect() first.');
      }

      let finalQuery = cypherQuery;
      if (params && Object.keys(params).length > 0) {
        const cypherParams = Object.entries(params)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join(', ');
        finalQuery = `CYPHER ${cypherParams} ${cypherQuery}`;
      }

      ctx.log.debug({ graphName, query: finalQuery }, 'Executing Cypher query');

      const response = await client.sendCommand(['GRAPH.QUERY', graphName, finalQuery]);
      const result = parseGraphResponse(response as unknown[]);

      ctx.log.debug(
        { graphName, stats: result.stats },
        `Query completed in ${result.stats.executionTime}ms`,
      );

      return result;
    });
  }

  function selectGraph(graphName: string) {
    return {
      async query(
        cypherQuery: string,
        params?: Record<string, unknown>,
      ): Promise<GraphQueryResult> {
        return query(graphName, cypherQuery, params);
      },

      async createNode(
        label: string,
        properties: Record<string, unknown>,
      ): Promise<GraphQueryResult> {
        const propsString = Object.entries(properties)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join(', ');

        return query(graphName, `CREATE (n:${label} {${propsString}}) RETURN n`);
      },

      async mergeNode(
        label: string,
        matchProps: Record<string, unknown>,
        setProps?: Record<string, unknown>,
      ): Promise<GraphQueryResult & { node?: GraphNodeResult }> {
        const matchString = Object.entries(matchProps)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join(', ');

        let cypherQuery = `MERGE (n:${label} {${matchString}})`;

        if (setProps && Object.keys(setProps).length > 0) {
          const setString = Object.entries(setProps)
            .map(([key, value]) => `n.${key} = ${JSON.stringify(value)}`)
            .join(', ');
          cypherQuery += ` ON CREATE SET ${setString} ON MATCH SET ${setString}`;
        }

        cypherQuery += ' RETURN n';
        const result = await query(graphName, cypherQuery);
        const node = parseNodeFromData(result.data);
        return node ? { ...result, node } : result;
      },

      async createRelationship(
        fromLabel: string,
        fromProps: Record<string, unknown>,
        relationType: string,
        toLabel: string,
        toProps: Record<string, unknown>,
      ): Promise<GraphQueryResult> {
        const fromMatch = Object.entries(fromProps)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join(', ');
        const toMatch = Object.entries(toProps)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join(', ');

        return query(
          graphName,
          `MATCH (a:${fromLabel} {${fromMatch}}), (b:${toLabel} {${toMatch}}) MERGE (a)-[r:${relationType}]->(b) RETURN r`,
        );
      },

      async mergeRelationshipWithProperties(
        fromLabel: string,
        fromProps: Record<string, unknown>,
        relationType: string,
        toLabel: string,
        toProps: Record<string, unknown>,
        edgeProps: Record<string, unknown>,
        updateCondition?: string,
      ): Promise<GraphQueryResult & { relationship?: GraphRelationshipResult }> {
        const fromMatch = Object.entries(fromProps)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join(', ');
        const toMatch = Object.entries(toProps)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join(', ');

        const onCreateProps = Object.entries(edgeProps)
          .map(([key, value]) => `r.${key} = ${JSON.stringify(value)}`)
          .join(', ');

        let onMatchClause = '';
        if (updateCondition) {
          const onMatchProps = Object.entries(edgeProps)
            .map(([key, value]) => `r.${key} = ${JSON.stringify(value)}`)
            .join(', ');
          onMatchClause = ` ON MATCH WHERE ${updateCondition} SET ${onMatchProps}`;
        }

        const cypherQuery = `MATCH (a:${fromLabel} {${fromMatch}}), (b:${toLabel} {${toMatch}}) MERGE (a)-[r:${relationType}]->(b) ON CREATE SET ${onCreateProps}${onMatchClause} RETURN r`;

        const result = await query(graphName, cypherQuery);
        const relationship = parseRelationshipFromData(result.data);
        return relationship ? { ...result, relationship } : result;
      },
    };
  }

  return {
    connect,
    disconnect,
    query,
    selectGraph,
  };
}
