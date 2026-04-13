import { contentItems, count, desc, eq, gte, mentions, sources, sql } from '@modules/db';
import type { DBClient } from '@modules/db';

export type TrendingRow = {
  ticker: string;
  count: number;
  sources: string[];
};

const WINDOWS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export function parseWindow(raw: string | null): number {
  if (raw && raw in WINDOWS) return WINDOWS[raw]!;
  return WINDOWS['24h']!;
}

export async function getTrending(
  db: DBClient,
  windowMs: number,
): Promise<TrendingRow[]> {
  const since = new Date(Date.now() - windowMs);

  const rows = await db
    .select({
      ticker: mentions.tickerSymbol,
      count: count(),
      sources: sql<string[]>`array_agg(DISTINCT ${sources.kind})`,
    })
    .from(mentions)
    .innerJoin(contentItems, eq(mentions.contentItemId, contentItems.id))
    .innerJoin(sources, eq(contentItems.sourceId, sources.id))
    .where(gte(mentions.createdAt, since))
    .groupBy(mentions.tickerSymbol)
    .orderBy(desc(count()))
    .limit(20);

  return rows;
}
