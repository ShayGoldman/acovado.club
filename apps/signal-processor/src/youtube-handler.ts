import { schema } from '@modules/db';
import { eq } from '@modules/db';
import type { DBClient } from '@modules/db';
import type { Message } from '@modules/events';
import type { TickerExtractor } from '@modules/ticker-extractor';
import type { Tracer } from '@modules/tracing';
import type { YouTubeVideoCollectedPayload } from './youtube-types';

export interface MakeYouTubeMessageHandlerOpts {
  db: DBClient;
  tickerExtractor: TickerExtractor;
  tracer: Tracer;
}

export function makeYouTubeMessageHandler({
  db,
  tickerExtractor,
  tracer,
}: MakeYouTubeMessageHandlerOpts) {
  return async function onYouTubeMessage(
    message: Message<YouTubeVideoCollectedPayload>,
  ): Promise<void> {
    const payload = message.payload;

    await tracer.with('process youtube.video.collected', async (ctx) => {
      ctx.annotate('channelId', payload.channelId);
      ctx.annotate('videoId', payload.externalId);

      try {
        // Step 1: Upsert content_item — conflict on (source_id, external_id)
        const [item] = await tracer.with('db.upsert content_items', async () =>
          db
            .insert(schema.contentItems)
            .values({
              sourceId: payload.sourceId,
              externalId: payload.externalId,
              title: payload.title,
              body: payload.description,
              url: payload.url,
              publishedAt: new Date(payload.publishedAt),
            })
            .onConflictDoUpdate({
              target: [schema.contentItems.sourceId, schema.contentItems.externalId],
              set: { url: schema.contentItems.url },
            })
            .returning(),
        );

        if (!item)
          throw new Error(`Failed to upsert content_item for ${payload.externalId}`);

        // Step 2: Dedup gate — skip if already extracted
        if (item.processedAt !== null) {
          ctx.log.info({ contentItemId: item.id }, 'signal.skipped.already_processed');
          return;
        }

        // Step 3: Extract tickers from title + description (YouTube-specific concatenation)
        const text = [payload.title, payload.description].filter(Boolean).join('\n\n');
        const mentions = await tracer.with('ticker.extract', async (c) => {
          const result = await tickerExtractor.extractTickers(text);
          c.annotate('mentions.count', result.length);
          return result;
        });

        // Step 4: Insert mentions
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
      } catch (error: unknown) {
        // Log only bounded fields — never pass the full Error object to pino, as
        // database driver errors may carry query parameters (including video description).
        ctx.log.error(
          {
            externalId: payload.externalId,
            sourceId: payload.sourceId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            errorMessage: error instanceof Error
              ? error.message.slice(0, 200)
              : String(error).slice(0, 200),
          },
          'signal.error',
        );
        throw error;
      }
    });
  };
}

export type YouTubeMessageHandler = ReturnType<typeof makeYouTubeMessageHandler>;
