import { ChatOllama } from '@langchain/ollama';
import type { RedditThread, RedditReply } from '@modules/db';
import type { Context } from '@modules/tracing';
import Z from 'zod/v4';
import type { ReplyTree } from '@/processing/reply-context.service';
import { HumanMessage } from '@langchain/core/messages';
import { uniq } from 'es-toolkit';

export interface MakeTickerExtractorServiceOpts {
  ollamaBaseUrl: string;
}

export interface TickerExtractorService {
  extractTickers(thread: RedditThread, context: Context): Promise<string[]>;
  extractTickersFromReply(
    reply: RedditReply,
    contextTree: ReplyTree,
    context: Context,
  ): Promise<string[]>;
}

const responseSchema = Z.object({
  answer: Z.array(Z.string()),
});

export function makeTickerExtractorService(opts: MakeTickerExtractorServiceOpts) {
  const { ollamaBaseUrl } = opts;
  const model = new ChatOllama({
    baseUrl: ollamaBaseUrl,
    model: 'gemma3:1b',
    temperature: 0,
    format: 'json',
  }).withStructuredOutput(
    Z.object({
      tickers: Z.array(Z.string()),
    }),
  );

  function buildContextText(contextTree: ReplyTree): string {
    const parts: string[] = [];

    function traverse(tree: ReplyTree) {
      if (tree.thread) {
        parts.push(`Thread Title: ${tree.thread.title}`);
        parts.push(`Thread Content: ${tree.thread.selftext}`);
      }
      if (tree.parent) {
        traverse(tree.parent);
      }
      parts.push(`Reply by ${tree.reply.author}: ${tree.reply.body}`);
    }

    traverse(contextTree);
    return parts.join('\n\n');
  }

  return {
    async extractTickers(thread: RedditThread, context: Context): Promise<string[]> {
      return context.with('Extract tickers from thread', async (c) => {
        const { title, selftext, subreddit } = thread;
        c.log.info(
          { subreddit, titleLength: title.length, contentLength: selftext.length },
          'Extracting tickers from thread',
        );

        try {
          const prompt = `What are the ticker symbols mentioned in this text: "${selftext}". 
          Respond with the tickers only and no other text or preceding $ sign`;

          const response = await model.invoke([new HumanMessage(prompt)], {
            // maxConcurrency: 5,
          });

          c.log.debug({ tickers: response.tickers }, 'Tickers extracted');

          return uniq(response.tickers);
        } catch (error) {
          c.log.error(
            { error, subreddit, title },
            'Failed to extract tickers from thread',
          );
          throw error;
        }
      });
    },
    async extractTickersFromReply(
      reply: RedditReply,
      contextTree: ReplyTree,
      context: Context,
    ): Promise<string[]> {
      return context.with('Extract tickers from reply', async (c) => {
        c.log.info(
          { replyId: reply.id, threadId: reply.threadId },
          'Extracting tickers from reply with context',
        );

        try {
          const contextText = buildContextText(contextTree);
          const prompt = `What are the ticker symbols mentioned in this reply? Ignore the conversation context for now.
          
          Conversation context:
          ${contextText}
          
          Respond with the tickers only and no other text or preceding $ sign`;

          const response = await model.invoke([new HumanMessage(prompt)], {
            // maxConcurrency: 5,
          });

          c.log.debug({ tickers: response.tickers }, 'Tickers extracted');

          return uniq(response.tickers);
        } catch (error) {
          c.log.error(
            { error, replyId: reply.id },
            'Failed to extract tickers from reply',
          );
          throw error;
        }
      });
    },
  };
}
