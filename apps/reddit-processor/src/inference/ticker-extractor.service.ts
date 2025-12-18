import { Ollama } from '@langchain/ollama';
import type { RedditThread } from '@modules/db';
import type { Context } from '@modules/tracing';
import Z from 'zod/v4';

export interface MakeTickerExtractorServiceOpts {
  ollamaBaseUrl: string;
}

export interface TickerExtractorService {
  extractTickers(thread: RedditThread, context: Context): Promise<string[]>;
}

const responseSchema = Z.object({
  answer: Z.array(Z.string()),
});

export function makeTickerExtractorService(opts: MakeTickerExtractorServiceOpts) {
  const { ollamaBaseUrl } = opts;
  const model = new Ollama({
    baseUrl: ollamaBaseUrl,
    model: 'gemma3:1b',
    temperature: 0,
    format: 'json',
  });

  return {
    async extractTickers(thread: RedditThread, context: Context): Promise<string[]> {
      return context.with('Extract tickers from thread', async (c) => {
        const { title, selftext, subreddit } = thread;
        c.log.info(
          { subreddit, titleLength: title.length, contentLength: selftext.length },
          'Extracting tickers from thread',
        );

        try {
          const prompt = `What are the ticker symbols mentioned in this text: "${selftext}". Response with the tickers only and no other text or preceding $ sign. Return your response as a JSON object with the following structure: {"answer": ["TICKER1", "TICKER2", ...]}`;

          const response = await model.generate([prompt], {
            // maxConcurrency: 5,
          });

          const firstGeneration = response.generations[0]?.[0];
          if (!firstGeneration) {
            throw new Error('No response generated from model');
          }

          const content = firstGeneration.text.trim();
          c.log.debug({ rawResponse: content }, 'Raw response from model');

          const parsed = JSON.parse(content);
          const validated = responseSchema.parse(parsed);

          c.log.debug({ answer: validated.answer }, 'Tickers extracted');

          return validated.answer;
        } catch (error) {
          c.log.error(
            { error, subreddit, title },
            'Failed to extract tickers from thread',
          );
          throw error;
        }
      });
    },
  };
}
