import { describe, expect, it } from 'bun:test';
import type { DBClient } from '@modules/db';
import type { ClaudeProvider, InferenceClient, OllamaProvider } from '@modules/inference';
import { makeTickerExtractor } from '../extractor';
import type { TickerMention } from '../types';

// ---------------------------------------------------------------------------
// Test fixtures — real Reddit-style posts used for accuracy checks
// ---------------------------------------------------------------------------
const SAMPLES = [
  {
    id: 'explicit-single',
    text: 'Just bought 100 shares of $TSLA at $200. To the moon! 🚀',
    expectedSymbols: ['TSLA'],
  },
  {
    id: 'explicit-multiple',
    text: 'Portfolio update: $AAPL 40%, $NVDA 30%, $MSFT 20%, rest in cash.',
    expectedSymbols: ['AAPL', 'NVDA', 'MSFT'],
  },
  {
    id: 'implicit-company',
    text: 'Tesla earnings next week. Also watching Apple for the iPhone launch.',
    expectedSymbols: ['TSLA', 'AAPL'],
  },
  {
    id: 'no-tickers',
    text: 'The market is so volatile. Going to hold cash until things calm down.',
    expectedSymbols: [],
  },
  {
    id: 'crypto-excluded',
    text: 'Bitcoin is pumping. BTC to $100k soon. ETH also looking strong.',
    expectedSymbols: [],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeMockInference(returns: TickerMention[]): InferenceClient {
  return {
    async invoke<T>(req: { callable: () => Promise<T> }): Promise<T> {
      return returns as T;
    },
  };
}

function makeMockInferenceThrows(error: string): InferenceClient {
  return {
    async invoke<T>(): Promise<T> {
      throw new Error(error);
    },
  };
}

function makeMockDb(validSymbols: string[]): DBClient {
  return {
    select: () => ({
      from: () => ({
        where: async () => validSymbols.map((symbol) => ({ symbol })),
      }),
    }),
  } as unknown as DBClient;
}

const primaryProvider: OllamaProvider = {
  model: {} as OllamaProvider['model'],
  modelId: 'gemma3:4b',
};

const fallbackProvider: ClaudeProvider = {
  model: {} as ClaudeProvider['model'],
  modelId: 'claude-haiku-4-5-20251001',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('makeTickerExtractor', () => {
  it('extracts a single explicit ticker', async () => {
    const mentions: TickerMention[] = [
      {
        symbol: 'TSLA',
        companyName: 'Tesla Inc.',
        confidence: 1.0,
        isExplicit: true,
        context: '$TSLA at $200',
      },
    ];
    const extractor = makeTickerExtractor({
      inferenceClient: makeMockInference(mentions),
      db: makeMockDb(['TSLA']),
      providers: { primary: primaryProvider },
    });
    const result = await extractor.extractTickers(SAMPLES[0]!.text);
    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe('TSLA');
    expect(result[0]!.isExplicit).toBe(true);
  });

  it('extracts multiple explicit tickers', async () => {
    const mentions: TickerMention[] = [
      {
        symbol: 'AAPL',
        companyName: 'Apple',
        confidence: 1.0,
        isExplicit: true,
        context: '$AAPL 40%',
      },
      {
        symbol: 'NVDA',
        companyName: 'NVIDIA',
        confidence: 1.0,
        isExplicit: true,
        context: '$NVDA 30%',
      },
      {
        symbol: 'MSFT',
        companyName: 'Microsoft',
        confidence: 1.0,
        isExplicit: true,
        context: '$MSFT 20%',
      },
    ];
    const extractor = makeTickerExtractor({
      inferenceClient: makeMockInference(mentions),
      db: makeMockDb(['AAPL', 'NVDA', 'MSFT']),
      providers: { primary: primaryProvider },
    });
    const result = await extractor.extractTickers(SAMPLES[1]!.text);
    expect(result.map((m) => m.symbol).sort()).toEqual(['AAPL', 'MSFT', 'NVDA']);
  });

  it('returns empty array for text with no tickers', async () => {
    const extractor = makeTickerExtractor({
      inferenceClient: makeMockInference([]),
      db: makeMockDb([]),
      providers: { primary: primaryProvider },
    });
    expect(await extractor.extractTickers(SAMPLES[3]!.text)).toHaveLength(0);
  });

  it('returns empty array for empty/whitespace text without calling LLM', async () => {
    let called = false;
    const inference: InferenceClient = {
      async invoke<T>(): Promise<T> {
        called = true;
        return [] as T;
      },
    };
    const extractor = makeTickerExtractor({
      inferenceClient: inference,
      db: makeMockDb([]),
      providers: { primary: primaryProvider },
    });
    expect(await extractor.extractTickers('   ')).toHaveLength(0);
    expect(called).toBe(false);
  });

  it('filters out mentions below confidence threshold', async () => {
    const mentions: TickerMention[] = [
      {
        symbol: 'TSLA',
        companyName: 'Tesla',
        confidence: 0.9,
        isExplicit: false,
        context: 'Tesla',
      },
      {
        symbol: 'AAPL',
        companyName: 'Apple',
        confidence: 0.5,
        isExplicit: false,
        context: 'Apple',
      },
    ];
    const extractor = makeTickerExtractor({
      inferenceClient: makeMockInference(mentions),
      db: makeMockDb(['TSLA', 'AAPL']),
      providers: { primary: primaryProvider },
      minConfidence: 0.7,
    });
    const result = await extractor.extractTickers('Some text');
    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe('TSLA');
  });

  it('filters out symbols not in DB tickers table (SEC validation)', async () => {
    const mentions: TickerMention[] = [
      {
        symbol: 'TSLA',
        companyName: 'Tesla',
        confidence: 0.95,
        isExplicit: true,
        context: '$TSLA',
      },
      {
        symbol: 'FAKE',
        companyName: 'Fake Corp',
        confidence: 0.9,
        isExplicit: true,
        context: '$FAKE',
      },
    ];
    const extractor = makeTickerExtractor({
      inferenceClient: makeMockInference(mentions),
      db: makeMockDb(['TSLA']), // FAKE not in DB
      providers: { primary: primaryProvider },
    });
    const result = await extractor.extractTickers('Buying $TSLA and $FAKE today');
    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe('TSLA');
  });

  it('normalises symbols to uppercase', async () => {
    const mentions: TickerMention[] = [
      {
        symbol: 'tsla',
        companyName: 'Tesla',
        confidence: 1.0,
        isExplicit: true,
        context: '$tsla',
      },
    ];
    const extractor = makeTickerExtractor({
      inferenceClient: makeMockInference(mentions),
      db: makeMockDb(['TSLA']),
      providers: { primary: primaryProvider },
    });
    const result = await extractor.extractTickers('$tsla going up');
    expect(result[0]!.symbol).toBe('TSLA');
  });

  it('falls back to Claude when Ollama fails', async () => {
    const fallbackResult: TickerMention[] = [
      {
        symbol: 'AAPL',
        companyName: 'Apple',
        confidence: 0.85,
        isExplicit: false,
        context: 'Apple',
      },
    ];

    let primaryCalled = false;
    let fallbackCalled = false;

    const inference: InferenceClient = {
      async invoke<T>(req: { name?: string }): Promise<T> {
        if (req.name === 'extract-tickers') {
          primaryCalled = true;
          throw new Error('Ollama connection refused');
        }
        fallbackCalled = true;
        return fallbackResult as T;
      },
    };

    const extractor = makeTickerExtractor({
      inferenceClient: inference,
      db: makeMockDb(['AAPL']),
      providers: { primary: primaryProvider, fallback: fallbackProvider },
    });

    const result = await extractor.extractTickers('Apple is looking bullish');
    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe('AAPL');
    expect(primaryCalled).toBe(true);
    expect(fallbackCalled).toBe(true);
  });

  it('throws when primary fails and no fallback configured', async () => {
    const extractor = makeTickerExtractor({
      inferenceClient: makeMockInferenceThrows('Ollama down'),
      db: makeMockDb([]),
      providers: { primary: primaryProvider },
    });
    await expect(extractor.extractTickers('Some text')).rejects.toThrow(
      'Primary provider failed and no fallback configured',
    );
  });
});

// ---------------------------------------------------------------------------
// Integration tests (require INTEGRATION_TEST=true + running Ollama + DB)
// ---------------------------------------------------------------------------
const RUN_INTEGRATION = process.env.INTEGRATION_TEST === 'true';

describe.if(RUN_INTEGRATION)('integration: real Ollama', () => {
  it.each(SAMPLES)('extracts from: $id', async ({ text, expectedSymbols }) => {
    // Wire up real clients here for manual verification on Day 7 checkpoint.
    // Run with: INTEGRATION_TEST=true bun test
    console.log(`[integration] ${text.slice(0, 60)}...`);
    console.log(`[integration] expected: ${expectedSymbols.join(', ') || '(none)'}`);
    expect(true).toBe(true); // scaffold — replace with real assertions
  });
});
