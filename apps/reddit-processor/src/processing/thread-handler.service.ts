import type { DBClient } from '@modules/db';
import { schema } from '@modules/db';
import type { Message } from '@modules/events';
import type { Context } from '@modules/tracing';
import { eq } from 'drizzle-orm';

export interface MakeThreadHandlerServiceOpts {
  db: DBClient;
}

interface ThreadFetchedPayload {
  id: number;
  resource: string;
  data: {
    id: number;
    reddit_id: string;
    subreddit: string;
  };
  type: string;
  timestamp: Date;
}

export function makeThreadHandlerService(opts: MakeThreadHandlerServiceOpts) {
  const { db } = opts;

  return {
    async onThreadFetched(message: Message<ThreadFetchedPayload>, context: Context) {
      await context.with('Process reddit thread', async (c) => {
        const { id, reddit_id, subreddit } = message.payload.data;

        c.log.info(
          { threadId: id, redditId: reddit_id, subreddit },
          'Received thread fetched event',
        );

        try {
          // Fetch full thread data from DB
          const [thread] = await db
            .select()
            .from(schema.redditThreads)
            .where(eq(schema.redditThreads.id, id))
            .limit(1);

          if (!thread) {
            c.log.error({ threadId: id }, 'Thread not found in database');
            return;
          }

          c.log.info(
            {
              threadId: thread.id,
              redditId: thread.redditId,
              title: thread.title,
              author: thread.author,
              score: thread.score,
              numComments: thread.numComments,
            },
            'Processing thread',
          );

          // POC: Just log the thread for now
          c.log.info(
            {
              thread: {
                id: thread.id,
                redditId: thread.redditId,
                subreddit: thread.subreddit,
                title: thread.title,
                author: thread.author,
                selftext: thread.selftext.substring(0, 100), // Log first 100 chars
                url: thread.url,
                permalink: thread.permalink,
                score: thread.score,
                numComments: thread.numComments,
                createdUtc: thread.createdUtc,
              },
            },
            '📝 Thread details (POC)',
          );

          // Mark as processed
          await db
            .update(schema.redditThreads)
            .set({
              status: 'processed',
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.redditThreads.id, id));

          c.log.info({ threadId: id }, 'Thread marked as processed');
        } catch (error) {
          c.log.error({ error, threadId: id }, 'Failed to process thread');

          // Mark as error
          try {
            await db
              .update(schema.redditThreads)
              .set({
                status: 'error',
                updatedAt: new Date().toISOString(),
              })
              .where(eq(schema.redditThreads.id, id));
          } catch (updateError) {
            c.log.error({ error: updateError }, 'Failed to mark thread as error');
          }

          throw error;
        }
      });
    },
  };
}
