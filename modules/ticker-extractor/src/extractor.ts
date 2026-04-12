import type { DBClient } from '@modules/db';
import { schema } from '@modules/db';
import type { InferenceClient } from '@modules/inference';
import { makeClaudeProvider, makeOllamaProvider } from '@modules/inference';
import type { Tracer } from '@modules/tracing';
import { generateObject } from 'ai';
import { inArray } from 'drizzle-orm';
import type { ExtractionResult, MakeTickerExtractorOpts, TickerMention } from './types';
import { ExtractionResultSchema } from './types';

const EXTRACTION_SYSTEM_PROMPT = `You are a financial ticker extraction system. Your task is to identify equity (stock) ticker mentions in text from financial social media posts.

Rules:
- Extract ONLY publicly traded equity tickers (stocks). Ignore crypto, ETFs, indices, commodities.
- Include both explicit mentions ($TSLA, $AAPL) and implicit mentions ("Tesla stock", "buying Apple", "NVIDIA is pumping").
- For each mention, assign a confidence score:
  - 1.0: Explicit ticker with $ prefix (e.g., $TSLA, $NVDA)
  - 0.85-0.95: Unambiguous stock mention without $ (e.g., "TSLA", "AAPL calls", "Tesla earnings")
  - 0.7-0.84: Likely company reference in financial context (e.g., "buying Apple", "Tesla to the moon")
  - Below 0.7: Ambiguous or uncertain — do NOT include these
- For implicit mentions, provide the company name as you understand it and your best guess at the ticker symbol.
- Capture a short context snippet (up to 100 characters) around where the mention appears.
- If no equity tickers are mentioned, return an empty mentions array.
- Do NOT include:
  - Crypto tickers (BTC, ETH, etc.)
  - Index funds or ETFs (SPY, QQQ, VTI)
  - Broad market references ("the market", "S&P", "Nasdaq")
  - Non-equity financial instruments`;

function buildUserPrompt(text: string): string {
  return `Extract all equity ticker mentions from the following text:\n\n---\n${text}\n---`;
}

export interface TickerExtractor {
  extractTickers(text: string): Promise<TickerMention[]>;
}

export function makeTickerExtractor(opts: {
  inferenceClient: InferenceClient;
  db: DBClient;
  tracer: Tracer;
  config?: MakeTickerExtractorOpts;
}): TickerExtractor {
  const { inferenceClient, db, tracer, config = {} } = opts;
  const minConfidence = config.minConfidence ?? 0.7;
  const validateAgainstDb = config.validateAgainstDb ?? true;

  const ollamaProvider = makeOllamaProvider({
    baseUrl: config.ollamaBaseUrl,
    model: config.ollamaModel,
  });

  const claudeProvider = makeClaudeProvider({
    apiKey: config.anthropicApiKey,
  });

  async function callLlm(text: string): Promise<ExtractionResult> {
    // Try Ollama/Gemma4 first; fall back to Claude on failure
    try {
      const result = await inferenceClient.invoke<ExtractionResult>({
        name: 'extract-tickers-ollama',
        model: ollamaProvider.modelId,
        config: { temperature: 0.1, format: 'json' },
        prompt: buildUserPrompt(text),
        retry: {
          maxAttempts: 2,
          baseDelayMs: 500,
        },
        callable: async () => {
          const { object } = await generateObject({
            model: ollamaProvider.model,
            schema: ExtractionResultSchema,
            system: EXTRACTION_SYSTEM_PROMPT,
            prompt: buildUserPrompt(text),
          });
          return object;
        },
      });
      return result;
    } catch {
      // Claude fallback
      const result = await inferenceClient.invoke<ExtractionResult>({
        name: 'extract-tickers-claude',
        model: claudeProvider.modelId,
        config: { temperature: 0.1 },
        prompt: buildUserPrompt(text),
        retry: {
          maxAttempts: 2,
          baseDelayMs: 1000,
        },
        callable: async () => {
          const { object } = await generateObject({
            model: claudeProvider.model,
            schema: ExtractionResultSchema,
            system: EXTRACTION_SYSTEM_PROMPT,
            prompt: buildUserPrompt(text),
          });
          return object;
        },
      });
      return result;
    }
  }

  async function validateSymbols(mentions: TickerMention[]): Promise<TickerMention[]> {
    if (mentions.length === 0) {
      return [];
    }

    const symbols = mentions.map((m) => m.symbol.toUpperCase());

    const validTickers = await db
      .select({ symbol: schema.tickers.symbol })
      .from(schema.tickers)
      .where(inArray(schema.tickers.symbol, symbols));

    const validSymbolSet = new Set(validTickers.map((t) => t.symbol.toUpperCase()));

    return mentions.filter((m) => validSymbolSet.has(m.symbol.toUpperCase()));
  }

  return {
    async extractTickers(text: string): Promise<TickerMention[]> {
      return tracer.with('ticker-extractor.extract', async (ctx) => {
        ctx.annotate('text.length', text.length);

        if (!text.trim()) {
          return [];
        }

        ctx.log.info({ textLength: text.length }, 'Extracting tickers from text');

        const result = await callLlm(text);

        // Filter by confidence threshold
        const aboveThreshold = result.mentions.filter(
          (m) => m.confidence >= minConfidence,
        );

        ctx.annotate('mentions.raw', result.mentions.length);
        ctx.annotate('mentions.above_threshold', aboveThreshold.length);

        // Normalize symbols to uppercase
        const normalized = aboveThreshold.map((m) => ({
          ...m,
          symbol: m.symbol.toUpperCase(),
        }));

        if (!validateAgainstDb) {
          ctx.annotate('mentions.validated', normalized.length);
          ctx.log.info(
            { count: normalized.length },
            'Ticker extraction complete (no DB validation)',
          );
          return normalized;
        }

        // Post-extraction validation against DB ticker table
        const validated = await validateSymbols(normalized);

        ctx.annotate('mentions.validated', validated.length);
        ctx.log.info(
          {
            raw: result.mentions.length,
            aboveThreshold: aboveThreshold.length,
            validated: validated.length,
          },
          'Ticker extraction complete',
        );

        return validated;
      });
    },
  };
}

export type TickerExtractorClient = ReturnType<typeof makeTickerExtractor>;
