import { z } from 'zod';

export const TickerMentionSchema = z.preprocess(
  (data: unknown) => {
    if (typeof data !== 'object' || data === null) return data;
    const d = data as Record<string, unknown>;
    return {
      symbol: d.symbol ?? d.ticker ?? '',
      companyName: d.companyName ?? d.company ?? '',
      confidence: d.confidence ?? 0,
      isExplicit: d.isExplicit ?? false,
      context: d.context ?? '',
    };
  },
  z.object({
    symbol: z
      .string()
      .describe('The stock ticker symbol in uppercase, e.g. TSLA, AAPL, NVDA'),
    companyName: z
      .string()
      .describe('The full company name, e.g. Tesla Inc., Apple Inc.'),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe(
        'Confidence that this is an intentional equity mention: 1.0 = explicit $TICKER, 0.85-0.95 = bare ticker, 0.7-0.84 = implicit company reference',
      ),
    isExplicit: z
      .boolean()
      .describe(
        'True when the $ prefix was used (e.g. $TSLA), false for implicit mentions',
      ),
    context: z
      .string()
      .describe('Surrounding text snippet (up to 100 chars) where the mention appears'),
  }),
);

export const LlmExtractionResultSchema = z.object({
  mentions: z
    .array(TickerMentionSchema)
    .default([])
    .describe('All equity ticker mentions found. Empty array if none.'),
});

export type LlmExtractionResult = z.infer<typeof LlmExtractionResultSchema>;
