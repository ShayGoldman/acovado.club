import { ChatOllama } from '@langchain/ollama';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { DBClient } from '@modules/db';
import {
  makeTrackedSubredditInsertValue,
  makeTrackedSubredditUpdateValue,
  schema,
} from '@modules/db';
import type { Message } from '@modules/events';
import type { InferenceClient } from '@modules/inference';
import type { Context, Tracer } from '@modules/tracing';
import { eq } from '@modules/db';
import { makeRedditClient } from '@modules/reddit-client';
import Z from 'zod/v4';

const subredditClassificationSchema = Z.object({
  isRelatedToInvesting: Z.boolean(),
  reasoning: Z.string(),
});

export interface MakeTrackedSubredditCandidateHandlerServiceOpts {
  db: DBClient;
  tracer: Tracer;
  inference: InferenceClient;
  ollamaBaseUrl: string;
}

interface TrackedSubredditCandidateDiscoveredPayload {
  id: number;
  resource: string;
  data: {
    name: string;
  };
  type: string;
  timestamp: Date;
}

function buildSystemMessage(): string {
  return `You are analyzing a subreddit to determine if it is related to investing, stocks, trading, or finance.

## CLASSIFICATION CRITERIA ##
A subreddit is considered related to investing/stocks if it focuses on:
- Stock market discussions, analysis, or trading
- Investment strategies, portfolio management, or financial planning
- Company analysis, earnings discussions, or market news
- Trading platforms, brokers, or investment tools
- Cryptocurrency investing (if it's about investment/trading, not just technology)
- Options, futures, or other financial derivatives
- Value investing, growth investing, or other investment philosophies

A subreddit is NOT related if it focuses on:
- General business news without investment focus
- Technology, gaming, or other non-financial topics
- Personal finance (budgeting, saving) without investment focus
- Memes or entertainment unrelated to investing
- General discussion forums

## OUTPUT FORMAT ##
Provide a boolean indicating if the subreddit is related to investing/stocks, along with a brief reasoning explaining your decision based on the subreddit's title, description, and subscriber count.`;
}

function buildHumanMessage(
  title: string,
  description: string,
  publicDescription: string,
  subscriberCount: number,
): string {
  return `Analyze the following subreddit information:

Title: ${title}
Description: ${description}
Public Description: ${publicDescription}
Subscribers: ${subscriberCount.toLocaleString()}

Is this subreddit related to investing, stocks, trading, or finance?`;
}

export function makeTrackedSubredditCandidateHandlerService(
  opts: MakeTrackedSubredditCandidateHandlerServiceOpts,
) {
  const { db, tracer, inference, ollamaBaseUrl } = opts;
  const redditClient = makeRedditClient();
  const model = new ChatOllama({
    baseUrl: ollamaBaseUrl,
    model: 'gemma3:4b',
    temperature: 0,
    format: 'json',
  }).withStructuredOutput(subredditClassificationSchema);

  return {
    async onTrackedSubredditCandidateDiscovered(
      message: Message<TrackedSubredditCandidateDiscoveredPayload>,
      context: Context,
    ) {
      await context.with('Process subreddit candidate', async (c) => {
        const { name } = message.payload.data;

        c.log.info({ subreddit: name }, 'Received subreddit candidate discovered event');

        try {
          const aboutData = await redditClient.fetchSubredditAbout(name);
          c.log.debug(
            {
              subreddit: name,
              title: aboutData.title,
              subscribers: aboutData.subscribers,
            },
            'Fetched subreddit about data',
          );

          const systemMessage = buildSystemMessage();
          const humanMessage = buildHumanMessage(
            aboutData.title,
            aboutData.description,
            aboutData.public_description,
            aboutData.subscribers,
          );

          const messages = [
            new SystemMessage(systemMessage),
            new HumanMessage(humanMessage),
          ];

          const classification = await inference.invoke({
            name: 'Classify subreddit for investing relevance',
            model: 'gemma3:4b',
            config: { temperature: 0, format: 'json' },
            prompt: messages,
            callable: () => model.invoke(messages),
            metadata: { subreddit: name },
          });

          c.log.info(
            {
              subreddit: name,
              isRelatedToInvesting: classification.isRelatedToInvesting,
              reasoning: classification.reasoning,
            },
            'Subreddit classified',
          );

          const status = classification.isRelatedToInvesting ? 'enabled' : 'ignored';

          const [existing] = await db
            .select()
            .from(schema.trackedSubreddits)
            .where(eq(schema.trackedSubreddits.name, name))
            .limit(1);

          if (existing) {
            await db
              .update(schema.trackedSubreddits)
              .set(
                makeTrackedSubredditUpdateValue({
                  status,
                }),
              )
              .where(eq(schema.trackedSubreddits.name, name));

            c.log.info(
              { subreddit: name, status },
              'Updated existing tracked subreddit status',
            );
          } else {
            await db.insert(schema.trackedSubreddits).values(
              makeTrackedSubredditInsertValue({
                name,
                status,
              }),
            );

            c.log.info({ subreddit: name, status }, 'Created new tracked subreddit');
          }
        } catch (error) {
          c.log.error(
            { error, subreddit: name },
            'Failed to process subreddit candidate',
          );
          throw error;
        }
      });
    },
  };
}
