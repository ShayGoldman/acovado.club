import { z } from 'zod';

export const TickerMentionSchema = z.object({
  symbol: z.string().describe('The stock ticker symbol (e.g., TSLA, AAPL, NVDA)'),
  name: z.string().describe('The full company name'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Confidence score from 0.0 to 1.0 that this is an intentional equity mention',
    ),
  isExplicit: z
    .boolean()
    .describe(
      'True if the ticker was explicitly mentioned with $ prefix (e.g., $TSLA), false if implicit (e.g., "Tesla stock")',
    ),
  context: z
    .string()
    .describe(
      'The surrounding text snippet (up to 100 chars) that triggered this extraction',
    ),
});

export const ExtractionResultSchema = z.object({
  mentions: z
    .array(TickerMentionSchema)
    .describe('All equity ticker mentions found in the text'),
});

export type TickerMention = z.infer<typeof TickerMentionSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

export interface MakeTickerExtractorOpts {
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  anthropicApiKey?: string;
  /** Minimum confidence threshold (default: 0.7) */
  minConfidence?: number;
  /** Whether to validate extracted tickers against the DB tickers table (default: true) */
  validateAgainstDb?: boolean;
}
