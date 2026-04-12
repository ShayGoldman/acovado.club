import { eq, schema, sql } from '@modules/db';
import type { DBClient } from '@modules/db';
import type { Message } from '@modules/events';
import type { Logger } from '@modules/logger';
import type { TickerExtractor } from '@modules/ticker-extractor';
import type { Tracer } from '@modules/tracing';
import type { RedditPostCollectedPayload } from './types';

export interface MakeMessageHandlerOpts {
  db: DBClient;
  tickerExtractor: TickerExtractor;
  logger: Logger;
  tracer: Tracer;
}

export function makeMessageHandler({
  db,
  tickerExtractor,
  logger: _logger,
  tracer,
}: MakeMessageHandlerOpts) {
  return async function onMessage(
    message: Message<RedditPostCollectedPayload>,
    _ctx: unknown,
  ): Promise<void> {
    const payload = message.payload;

    await tracer.with('process reddit.post.collected', async (ctx) => {
      ctx.annotate('subreddit', payload.subreddit);
      ctx.annotate('externalId', payload.externalId);

      // Step 1: Upsert content_item
      const [item] = await tracer.with('db.upsert content_items', async () =>
        db
          .insert(schema.contentItems)
          .values({
            sourceId: payload.sourceId,
            externalId: payload.externalId,
            title: payload.title,
            body: payload.body,
            url: payload.url,
            publishedAt: new Date(payload.publishedAt),
          })
          .onConflictDoUpdate({
            target: [schema.contentItems.sourceId, schema.contentItems.externalId],
            // No-op update — force RETURNING to include processedAt
            set: { url: sql`EXCLUDED.url` },
          })
          .returning(),
      );

      if (!item)
        throw new Error(`Failed to upsert content_item for ${payload.externalId}`);

      // Step 2: Dedup gate — skip if already processed
      if (item.processedAt !== null) {
        ctx.log.info({ contentItemId: item.id }, 'signal.skipped.already_processed');
        return;
      }

      // Step 3: Extract tickers
      const text = [payload.title, payload.body].filter(Boolean).join('\n\n');
      const mentions = await tracer.with('ticker.extract', async () =>
        tickerExtractor.extractTickers(text),
      );
      ctx.annotate('mentions.count', mentions.length);

      // Step 4: Insert mentions (0 rows is valid)
      if (mentions.length > 0) {
        await tracer.with('db.insert mentions', async () =>
          db.insert(schema.mentions).values(
            mentions.map((m) => ({
              contentItemId: item.id,
              tickerSymbol: m.symbol,
              confidence: m.confidence.toString(),
              isExplicit: m.isExplicit,
              rawContext: m.context,
            })),
          ),
        );
      }

      // Step 5: Mark processed
      await tracer.with('db.update processed_at', async () =>
        db
          .update(schema.contentItems)
          .set({ processedAt: new Date() })
          .where(eq(schema.contentItems.id, item.id)),
      );

      ctx.log.info(
        { contentItemId: item.id, mentionCount: mentions.length },
        'signal.done',
      );
    });
  };
}
