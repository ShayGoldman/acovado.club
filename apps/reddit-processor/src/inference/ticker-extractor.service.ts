import { ChatOllama } from '@langchain/ollama';
import type { RedditThread, RedditReply } from '@modules/db';
import type { InferenceClient } from '@modules/inference';
import type { Context } from '@modules/tracing';
import Z from 'zod/v4';
import type { ReplyTree } from '@/processing/reply-context.service';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export type TickerClassification =
  | 'has_position'
  | 'recommends'
  | 'warns_against'
  | 'sold_position';

export interface TickerReference {
  ticker: string;
  classification: TickerClassification;
  reference: string;
  reasoning: string;
}

export interface MakeTickerExtractorServiceOpts {
  ollamaBaseUrl: string;
  inference: InferenceClient;
}

export interface TickerExtractorService {
  extractTickers(thread: RedditThread, context: Context): Promise<TickerReference[]>;
  extractTickersFromReply(
    reply: RedditReply,
    contextTree: ReplyTree,
    context: Context,
  ): Promise<TickerReference[]>;
}

const tickerClassificationSchema = Z.enum([
  'has_position',
  'recommends',
  'warns_against',
  'sold_position',
]);

const tickerReferenceSchema = Z.object({
  ticker: Z.string(),
  classification: tickerClassificationSchema,
  reference: Z.string(),
  reasoning: Z.string(),
});

const responseSchema = Z.object({
  references: Z.array(tickerReferenceSchema),
});

export function normalizeContextTree(contextTree: ReplyTree): string {
  const parts: string[] = [];

  if (contextTree.thread) {
    parts.push('=== ORIGINAL THREAD ===');
    parts.push(`Title: ${contextTree.thread.title}`);
    if (contextTree.thread.selftext) {
      parts.push(`Content: ${contextTree.thread.selftext}`);
    }
    parts.push('');
  }

  const replyChain: ReplyTree[] = [];
  let current: ReplyTree | undefined = contextTree;
  while (current) {
    replyChain.unshift(current);
    current = current.parent;
  }

  if (replyChain.length > 1) {
    parts.push('=== CONVERSATION HISTORY ===');
    for (let i = 0; i < replyChain.length - 1; i++) {
      const tree = replyChain[i];
      if (tree) {
        parts.push(`[Reply ${i + 1} by ${tree.reply.author}]`);
        parts.push(tree.reply.body);
        parts.push('');
      }
    }
  }

  return parts.join('\n');
}

export function makeTickerExtractorService(opts: MakeTickerExtractorServiceOpts) {
  const { ollamaBaseUrl, inference } = opts;
  const model = new ChatOllama({
    baseUrl: ollamaBaseUrl,
    model: 'gemma3:4b-it-qat',
    temperature: 0,
    format: 'json',
    numCtx: 16384,
    numPredict: 1024,
    think: false,
  }).withStructuredOutput(responseSchema);

  const classificationDescriptions = {
    has_position: 'Author EXPLICITLY states they own/hold the stock',
    recommends: 'Author EXPLICITLY recommends buying/investing in the stock',
    warns_against: 'Author EXPLICITLY warns against buying/investing in the stock',
    sold_position: 'Author EXPLICITLY states they sold/exited a position in the stock',
  };

  function buildSystemMessage(isReply = false): string {
    const optionsList = Object.entries(classificationDescriptions)
      .map(([key, desc]) => `- ${key}: ${desc}`)
      .join('\n');

    const replyInstructions = isReply
      ? '\nIMPORTANT: Extract tickers ONLY from the "TEXT TO ANALYZE" section. Context is for understanding meaning only.'
      : '';

    return `
    Extract stock ticker symbols and classify the author's action statement toward each ticker

    ## HARD RULE: EXPLICIT EVIDENCE GATE ##
    You may ONLY output a classification for a ticker if you can include an reference that contains an explicit action statement.

    ## HARD RULE: EXPLICIT TICKER FORMAT ## 
    You may ONLY output a ticker if it matches the following format: UPPERCASE, 1-5 chars, alphanumeric (ignore $ prefix)
    Avoid: common words, lowercase text, acronyms (USA, CEO, AI), Single letter tickers

    ## Explicit action triggers ##
    - has_position: "I own", "I hold", "I'm holding", "my position", "I have shares", "long <ticker>", "bagholding"
    - sold_position: "I sold", "I exited", "I closed", "I got out", "I dumped", "I liquidated"
    - recommends: "buy", "I'm buying", "you should buy", "I recommend buying", "worth investing", "load up"
    - warns_against: "don't buy", "do not buy", "avoid", "stay away", "not worth investing", "do not invest"

    ## Classification options ##
    ${optionsList}

    NOT sufficient (do NOT classify): "bullish", "bearish", "looks good", "will go up", "watching", "on my list", "great company", "could be a buy", "might buy".

    If you cannot find an explicit trigger quote, output nothing for that ticker.
    Do not use words like "implies", "suggests", "seems", or "likely". 
    ${replyInstructions}
    `;
  }

  function buildHumanMessage(text: string, contextText?: string): string {
    if (contextText) {
      return `=== CONTEXT (FOR REFERENCE ONLY) ===\n${contextText}\n\n=== TEXT TO CLASSIFY ===\n"${text}"`;
    }
    return `=== TEXT TO CLASSIFY ===\n"${text}"`;
  }

  return {
    async extractTickers(
      thread: RedditThread,
      context: Context,
    ): Promise<TickerReference[]> {
      return context.with('Extract tickers from thread', async (c) => {
        const { title, selftext, subreddit } = thread;
        c.annotate('thread.id', thread.id);
        c.annotate('thread.subreddit', subreddit);

        c.log.info(
          { subreddit, titleLength: title.length, contentLength: selftext.length },
          'Extracting tickers from thread',
        );

        try {
          const systemMessage = buildSystemMessage(false);
          const humanMessage = buildHumanMessage(selftext);

          const messages = [
            new SystemMessage(systemMessage),
            new HumanMessage(humanMessage),
          ];

          const response = await inference.invoke({
            name: 'Extract tickers from thread',
            model: 'gemma3:4b-it-qat',
            config: { temperature: 0, format: 'json' },
            prompt: messages,
            callable: () => model.invoke(messages),
            metadata: { subreddit, threadId: thread.id },
          });

          const tickerSymbols = response.references.map((ref) =>
            ref.ticker.trim().toUpperCase(),
          );
          c.annotate('inference.ticker.count', response.references.length);
          if (tickerSymbols.length > 0) {
            c.annotate('inference.ticker.symbols', tickerSymbols.join(','));
            for (let i = 0; i < tickerSymbols.length; i++) {
              const symbol = tickerSymbols[i];
              if (symbol) {
                c.annotate(`inference.ticker.${i}.symbol`, symbol);
              }
            }
          }

          c.log.debug(
            { count: response.references.length },
            'Ticker references extracted',
          );

          return response.references;
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
    ): Promise<TickerReference[]> {
      return context.with('Extract tickers from reply', async (c) => {
        c.annotate('reply.id', reply.id);
        c.annotate('reply.redditId', reply.redditId);
        c.annotate('thread.id', reply.threadId);

        c.log.info(
          { replyId: reply.id, threadId: reply.threadId },
          'Extracting tickers from reply with context',
        );

        try {
          const normalizedContext = normalizeContextTree(contextTree);
          const replyText = reply.body;
          const systemMessage = buildSystemMessage(true);
          const humanMessage = buildHumanMessage(replyText, normalizedContext);

          const messages = [
            new SystemMessage(systemMessage),
            new HumanMessage(humanMessage),
          ];

          const response = await inference.invoke({
            name: 'Extract tickers from reply',
            model: 'gemma3:4b-it-qat',
            config: { temperature: 0, format: 'json' },
            prompt: messages,
            callable: () => model.invoke(messages),
            metadata: { replyId: reply.id, threadId: reply.threadId },
          });

          const tickerSymbols = response.references.map((ref) =>
            ref.ticker.trim().toUpperCase(),
          );
          c.annotate('inference.ticker.count', response.references.length);
          if (tickerSymbols.length > 0) {
            c.annotate('inference.ticker.symbols', tickerSymbols.join(','));
            for (let i = 0; i < tickerSymbols.length; i++) {
              const symbol = tickerSymbols[i];
              if (symbol) {
                c.annotate(`inference.ticker.${i}.symbol`, symbol);
              }
            }
          }

          c.log.debug(
            { count: response.references.length },
            'Ticker references extracted from reply',
          );

          return response.references;
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
