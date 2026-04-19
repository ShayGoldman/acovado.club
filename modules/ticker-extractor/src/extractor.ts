import { generateObject } from 'ai';
import { SYSTEM_PROMPT, buildPrompt } from './prompt';
import { LlmExtractionResultSchema } from './schema';
import type { MakeTickerExtractorOpts, TickerMention } from './types';

export function makeTickerExtractor({
  inferenceClient,
  provider,
}: MakeTickerExtractorOpts) {
  async function extractTickers(text: string): Promise<TickerMention[]> {
    if (!text.trim()) return [];

    const prompt = buildPrompt(text);

    return inferenceClient.invoke<TickerMention[]>({
      name: 'extract-tickers',
      model: provider.modelId,
      config: { format: 'json', temperature: 0 },
      prompt,
      callable: async () => {
        const { object } = await generateObject({
          model: provider.model,
          schema: LlmExtractionResultSchema,
          system: SYSTEM_PROMPT,
          prompt,
          temperature: 0,
        });

        return object.mentions.map((mention) => ({
          symbol: mention.symbol.toUpperCase(),
          confidence: mention.confidence,
          isExplicit: mention.isExplicit,
          context: mention.context,
        }));
      },
      retry: { maxAttempts: 2 },
    });
  }

  return { extractTickers };
}
