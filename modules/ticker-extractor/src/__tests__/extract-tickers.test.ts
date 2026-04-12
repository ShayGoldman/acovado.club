import { describe, expect, it } from 'bun:test';
import type { DBClient } from '@modules/db';
import type { InferenceClient } from '@modules/inference';
import type { Tracer } from '@modules/tracing';
import type { ExtractionResult } from '../types';
import { makeTickerExtractor } from '../extractor';

// Reddit post samples for accuracy testing
const REDDIT_SAMPLES = [
  {
    id: 'explicit-single',
    text: 'Just bought 100 shares of $TSLA at $200. To the moon! 🚀',
    expectedSymbols: ['TSLA'],
  },
  {
    id: 'explicit-multiple',
    text: 'My portfolio: $AAPL 40%, $NVDA 30%, $MSFT 20%, rest in cash. Feeling good about tech.',
    expectedSymbols: ['AAPL', 'NVDA', 'MSFT'],
  },
  {
    id: 'implicit-company-name',
    text: 'Tesla earnings next week. I think they will beat expectations. Also watching Apple for the iPhone launch.',
    expectedSymbols: ['TSLA', 'AAPL'],
  },
  {
    id: 'mixed-explicit-implicit',
    text: 'Loading up on $AMD calls before earnings. Also bullish on Nvidia long term.',
    expectedSymbols: ['AMD', 'NVDA'],
  },
  {
    id: 'no-tickers',
    text: 'The market is so volatile today. I am just going to hold cash until things calm down.',
    expectedSymbols: [],
  },
  {
    id: 'crypto-excluded',
    text: 'Bitcoin is pumping hard today. BTC to $100k. ETH also looking strong.',
    expectedSymbols: [], // crypto should be excluded
  },
  {
    id: 'etf-excluded',
    text: 'Just DCA-ing into SPY and QQQ every month. VTSAX for the long haul.',
    expectedSymbols: [], // ETFs/indices should be excluded
  },
];

// Build a mock inference client that returns predefined responses
function makeMockInferenceClient(
  responsesByName: Record<string, ExtractionResult>,
): InferenceClient {
  return {
    async invoke<T>(request: { name?: string; callable: () => Promise<T> }): Promise<T> {
      const name = request.name ?? 'unknown';
      if (responsesByName[name]) {
        return responsesByName[name] as T;
      }
      // Fall through to callable for unmocked requests
      return request.callable();
    },
  };
}

// Build a mock DB client that returns known valid symbols
function makeMockDbClient(validSymbols: string[]): DBClient {
  return {
    select: () => ({
      from: () => ({
        where: async () => validSymbols.map((symbol) => ({ symbol })),
      }),
    }),
  } as unknown as DBClient;
}

// Build a no-op tracer for tests
function makeMockTracer(): Tracer {
  const ctx = {
    log: {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {},
    },
    annotate: () => {},
    with: async (_name: string, fn: (c: typeof ctx) => Promise<unknown>) => fn(ctx),
    setName: () => {},
    recordException: () => {},
  };

  return {
    with: async (_name: string, fn: (c: typeof ctx) => Promise<unknown>) => fn(ctx),
    shutdown: async () => {},
  } as unknown as Tracer;
}

describe('makeTickerExtractor', () => {
  describe('unit: extraction with mock inference client', () => {
    it('extracts explicit single ticker', async () => {
      const mockResult: ExtractionResult = {
        mentions: [
          {
            symbol: 'TSLA',
            name: 'Tesla Inc.',
            confidence: 1.0,
            isExplicit: true,
            context: 'bought 100 shares of $TSLA at $200',
          },
        ],
      };

      const extractor = makeTickerExtractor({
        inferenceClient: makeMockInferenceClient({
          'extract-tickers-ollama': mockResult,
        }),
        db: makeMockDbClient(['TSLA']),
        tracer: makeMockTracer(),
        config: { validateAgainstDb: true },
      });

      const result = await extractor.extractTickers(REDDIT_SAMPLES[0]!.text);
      expect(result).toHaveLength(1);
      expect(result[0]!.symbol).toBe('TSLA');
      expect(result[0]!.isExplicit).toBe(true);
      expect(result[0]!.confidence).toBe(1.0);
    });

    it('extracts multiple explicit tickers', async () => {
      const mockResult: ExtractionResult = {
        mentions: [
          {
            symbol: 'AAPL',
            name: 'Apple Inc.',
            confidence: 1.0,
            isExplicit: true,
            context: '$AAPL 40%',
          },
          {
            symbol: 'NVDA',
            name: 'NVIDIA Corp.',
            confidence: 1.0,
            isExplicit: true,
            context: '$NVDA 30%',
          },
          {
            symbol: 'MSFT',
            name: 'Microsoft Corp.',
            confidence: 1.0,
            isExplicit: true,
            context: '$MSFT 20%',
          },
        ],
      };

      const extractor = makeTickerExtractor({
        inferenceClient: makeMockInferenceClient({
          'extract-tickers-ollama': mockResult,
        }),
        db: makeMockDbClient(['AAPL', 'NVDA', 'MSFT']),
        tracer: makeMockTracer(),
      });

      const result = await extractor.extractTickers(REDDIT_SAMPLES[1]!.text);
      const symbols = result.map((m) => m.symbol).sort();
      expect(symbols).toEqual(['AAPL', 'MSFT', 'NVDA']);
    });

    it('returns empty array for text with no tickers', async () => {
      const mockResult: ExtractionResult = { mentions: [] };

      const extractor = makeTickerExtractor({
        inferenceClient: makeMockInferenceClient({
          'extract-tickers-ollama': mockResult,
        }),
        db: makeMockDbClient([]),
        tracer: makeMockTracer(),
      });

      const result = await extractor.extractTickers(REDDIT_SAMPLES[4]!.text);
      expect(result).toHaveLength(0);
    });

    it('filters out mentions below confidence threshold', async () => {
      const mockResult: ExtractionResult = {
        mentions: [
          {
            symbol: 'TSLA',
            name: 'Tesla',
            confidence: 0.9,
            isExplicit: false,
            context: 'Tesla',
          },
          {
            symbol: 'AAPL',
            name: 'Apple',
            confidence: 0.5,
            isExplicit: false,
            context: 'Apple',
          }, // below threshold
        ],
      };

      const extractor = makeTickerExtractor({
        inferenceClient: makeMockInferenceClient({
          'extract-tickers-ollama': mockResult,
        }),
        db: makeMockDbClient(['TSLA', 'AAPL']),
        tracer: makeMockTracer(),
        config: { minConfidence: 0.7 },
      });

      const result = await extractor.extractTickers(
        'Tesla earnings. Also Apple something.',
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.symbol).toBe('TSLA');
    });

    it('filters out symbols not in DB tickers table', async () => {
      const mockResult: ExtractionResult = {
        mentions: [
          {
            symbol: 'TSLA',
            name: 'Tesla',
            confidence: 0.95,
            isExplicit: true,
            context: '$TSLA',
          },
          {
            symbol: 'FAKE',
            name: 'Fake Corp',
            confidence: 0.9,
            isExplicit: true,
            context: '$FAKE',
          },
        ],
      };

      const extractor = makeTickerExtractor({
        inferenceClient: makeMockInferenceClient({
          'extract-tickers-ollama': mockResult,
        }),
        db: makeMockDbClient(['TSLA']), // FAKE not in DB
        tracer: makeMockTracer(),
        config: { validateAgainstDb: true },
      });

      const result = await extractor.extractTickers('Buying $TSLA and $FAKE today');
      expect(result).toHaveLength(1);
      expect(result[0]!.symbol).toBe('TSLA');
    });

    it('normalizes symbols to uppercase', async () => {
      const mockResult: ExtractionResult = {
        mentions: [
          {
            symbol: 'tsla',
            name: 'Tesla',
            confidence: 1.0,
            isExplicit: true,
            context: '$tsla',
          },
        ],
      };

      const extractor = makeTickerExtractor({
        inferenceClient: makeMockInferenceClient({
          'extract-tickers-ollama': mockResult,
        }),
        db: makeMockDbClient(['TSLA']),
        tracer: makeMockTracer(),
      });

      const result = await extractor.extractTickers('$tsla going up');
      expect(result[0]!.symbol).toBe('TSLA');
    });

    it('returns empty array for empty text', async () => {
      const extractor = makeTickerExtractor({
        inferenceClient: makeMockInferenceClient({}),
        db: makeMockDbClient([]),
        tracer: makeMockTracer(),
      });

      const result = await extractor.extractTickers('   ');
      expect(result).toHaveLength(0);
    });

    it('falls back to Claude when Ollama fails', async () => {
      let ollamaCallCount = 0;
      let claudeCallCount = 0;

      const inferenceClient: InferenceClient = {
        async invoke<T>(request: {
          name?: string;
          callable: () => Promise<T>;
        }): Promise<T> {
          if (request.name === 'extract-tickers-ollama') {
            ollamaCallCount++;
            throw new Error('Ollama connection refused');
          }
          if (request.name === 'extract-tickers-claude') {
            claudeCallCount++;
            return {
              mentions: [
                {
                  symbol: 'AAPL',
                  name: 'Apple',
                  confidence: 0.9,
                  isExplicit: false,
                  context: 'Apple',
                },
              ],
            } as T;
          }
          return request.callable();
        },
      };

      const extractor = makeTickerExtractor({
        inferenceClient,
        db: makeMockDbClient(['AAPL']),
        tracer: makeMockTracer(),
      });

      const result = await extractor.extractTickers('Apple is looking bullish');
      expect(result).toHaveLength(1);
      expect(result[0]!.symbol).toBe('AAPL');
      expect(ollamaCallCount).toBeGreaterThan(0);
      expect(claudeCallCount).toBe(1);
    });
  });
});

// Integration tests - run only when INTEGRATION_TEST=true and OLLAMA is available
const RUN_INTEGRATION = process.env.INTEGRATION_TEST === 'true';

describe.if(RUN_INTEGRATION)('integration: real Ollama extraction', () => {
  // These tests require:
  // - Ollama running at OLLAMA_BASE_URL (default: http://localhost:11434)
  // - OLLAMA_MODEL set (default: gemma3:4b)
  // - DATABASE_URL pointing to a running Postgres with migrations applied
  // Run with: INTEGRATION_TEST=true bun test

  it.each(REDDIT_SAMPLES)(
    'extracts tickers from: $id',
    async ({ text, expectedSymbols }) => {
      // This test is intentionally left as a scaffold — wire up real clients
      // once DB and Ollama are confirmed running (Day 7 board review)
      console.log(`[integration] Text: ${text.slice(0, 60)}...`);
      console.log(
        `[integration] Expected symbols: ${expectedSymbols.join(', ') || '(none)'}`,
      );

      // TODO: wire up real makeDBClient + makeInferenceClient + makeTickerExtractor
      // and assert expectedSymbols are a subset of extracted symbols

      expect(true).toBe(true); // placeholder
    },
  );
});
