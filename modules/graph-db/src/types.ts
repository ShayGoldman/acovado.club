export interface GraphNode {
  id: number;
  labels: string[];
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  id: number;
  type: string;
  sourceNode: number;
  destinationNode: number;
  properties: Record<string, unknown>;
}

export interface GraphQueryResult {
  header: string[];
  data: unknown[][];
  stats: GraphQueryStats;
}

export interface GraphQueryStats {
  nodesCreated: number;
  nodesDeleted: number;
  relationshipsCreated: number;
  relationshipsDeleted: number;
  propertiesSet: number;
  labelsAdded: number;
  executionTime: number;
}

export interface ThreadNode {
  id: string;
  redditId: string;
  title: string;
  subreddit: string;
  score: number;
  createdUtc: string;
}

export interface AuthorNode {
  username: string;
}

export interface ReplyNode {
  id: string;
  content: string;
}
