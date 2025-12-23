import type { DBClient, RedditThread, RedditReply } from '@modules/db';
import { schema, inArray } from '@modules/db';
import type { Producer } from '@modules/events';
import { makeEvent } from '@modules/events';
import type { Tracer } from '@modules/tracing';
import { difference } from 'es-toolkit';

export interface MakeTrackedSubredditDiscoveryServiceOpts {
  db: DBClient;
  producer: Producer;
  tracer: Tracer;
}

function extractSubredditMentions(text: string): string[] {
  const regex = /\/r\/([A-Za-z0-9_]+)\/?/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null = null;

  // biome-ignore lint/suspicious/noAssignInExpressions: regex.exec pattern
  while ((match = regex.exec(text)) !== null) {
    const subredditName = match[1]?.toLowerCase();
    if (subredditName && !matches.includes(subredditName)) {
      matches.push(subredditName);
    }
  }

  return matches;
}

async function discoverSubredditsFromText(
  text: string,
  db: DBClient,
  producer: Producer,
  tracer: Tracer,
): Promise<void> {
  return tracer.with('Discover subreddits from text', async (ctx) => {
    const mentions = extractSubredditMentions(text);

    if (mentions.length === 0) {
      return;
    }

    ctx.log.debug({ mentions, count: mentions.length }, 'Extracted subreddit mentions');

    const existingSubreddits = await db
      .select({
        name: schema.trackedSubreddits.name,
        status: schema.trackedSubreddits.status,
      })
      .from(schema.trackedSubreddits)
      .where(inArray(schema.trackedSubreddits.name, mentions));

    const undiscoveredSubreddits = difference(
      mentions,
      existingSubreddits.map((s) => s.name),
    );

    const existingNames = new Set(existingSubreddits.map((s) => s.name));

    if (undiscoveredSubreddits.length === 0) {
      ctx.log.debug(
        { existingSubreddits: Array.from(existingNames) },
        'Skipping event emission - no new subreddits to discover',
      );
      return;
    }

    for (const undiscovered of undiscoveredSubreddits) {
      try {
        const event = makeEvent('reddit-tracked-subreddit-candidate', 'discovered', {
          id: 0,
          name: undiscovered,
        });

        await producer.send(
          'reddit',
          'reddit.tracked-subreddit.candidate-discovered',
          event,
        );

        ctx.log.info(
          { subreddit: undiscovered },
          'Emitted subreddit candidate discovered event',
        );
      } catch (error) {
        ctx.log.error(
          { error, subreddit: undiscovered },
          'Failed to emit subreddit candidate discovered event',
        );
      }
    }
  });
}

export function makeTrackedSubredditDiscoveryService(
  opts: MakeTrackedSubredditDiscoveryServiceOpts,
) {
  const { db, producer, tracer } = opts;

  return {
    async discoverSubreddits(thread: RedditThread): Promise<void> {
      const text = `${thread.title} ${thread.selftext}`;
      await discoverSubredditsFromText(text, db, producer, tracer);
    },

    async discoverSubredditsFromReply(reply: RedditReply): Promise<void> {
      await discoverSubredditsFromText(reply.body, db, producer, tracer);
    },
  };
}
