import { schema } from '@modules/db';
import { generateObject } from 'ai';
import { inArray } from 'drizzle-orm';
import { buildPrompt, SYSTEM_PROMPT } from './prompt';
import { LlmExtractionResultSchema } from './schema';
import type { MakeTickerExtractorOpts, TickerExtractor, TickerMention } from './types';

export function makeTickerExtractor(opts: MakeTickerExtractorOpts): TickerExtractor {
  const { inferenceClient, db, providers, minConfidence = 0.7 } = opts;

  async function callPrimary(text: string): Promise<TickerMention[]> {
    const result = await inferenceClient.invoke({
      name: 'extract-tickers',
      model: providers.primary.modelId,
      config: { temperature: 0.1, format: 'json' },
      prompt: buildPrompt(text),
      retry: { maxAttempts: 2, baseDelayMs: 500 },
      callable: async () => {
        const { object } = await generateObject({
          model: providers.primary.model,
          schema: LlmExtractionResultSchema,
          system: SYSTEM_PROMPT,
          prompt: buildPrompt(text),
        });
        return object.mentions;
      },
    });
    return result;
  }

  async function callFallback(
    text: string,
    fallback: NonNullable<typeof providers.fallback>,
  ): Promise<TickerMention[]> {
    const result = await inferenceClient.invoke({
      name: 'extract-tickers-fallback',
      model: fallback.modelId,
      config: { temperature: 0.1 },
      prompt: buildPrompt(text),
      retry: { maxAttempts: 2, baseDelayMs: 1000 },
      callable: async () => {
        const { object } = await generateObject({
          model: fallback.model,
          schema: LlmExtractionResultSchema,
          system: SYSTEM_PROMPT,
          prompt: buildPrompt(text),
        });
        return object.mentions;
      },
    });
    return result;
  }

  async function filterByDb(mentions: TickerMention[]): Promise<TickerMention[]> {
    if (mentions.length === 0) return [];

    const symbols = mentions.map((m) => m.symbol.toUpperCase());
    const rows = await db
      .select({ symbol: schema.tickers.symbol })
      .from(schema.tickers)
      .where(inArray(schema.tickers.symbol, symbols));

    const valid = new Set(rows.map((r) => r.symbol.toUpperCase()));
    return mentions.filter((m) => valid.has(m.symbol.toUpperCase()));
  }

  return {
    async extractTickers(text: string): Promise<TickerMention[]> {
      if (!text.trim()) return [];

      let raw: TickerMention[];

      try {
        raw = await callPrimary(text);
      } catch {
        if (!providers.fallback)
          throw new Error('Primary provider failed and no fallback configured');
        raw = await callFallback(text, providers.fallback);
      }

      // Normalise symbols, apply confidence threshold, validate against DB
      const normalised = raw
        .map((m) => ({ ...m, symbol: m.symbol.toUpperCase() }))
        .filter((m) => m.confidence >= minConfidence);

      return filterByDb(normalised);
    },
  };
}

export type TickerExtractorClient = ReturnType<typeof makeTickerExtractor>;
