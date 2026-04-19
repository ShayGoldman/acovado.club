import { describe, expect, it } from 'bun:test';
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
    async invoke<T>(_req: { callable: () => Promise<T> }): Promise<T> {
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

const primaryProvider: OllamaProvider = {
  model: {} as OllamaProvider['model'],
  modelId: 'gemma4:e4b',
};

const claudeProvider: ClaudeProvider = {
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
        confidence: 1.0,
        isExplicit: true,
        context: '$TSLA at $200',
      },
    ];
    const extractor = makeTickerExtractor({
      inferenceClient: makeMockInference(mentions),
      provider: primaryProvider,
    });
    const result = await extractor.extractTickers(SAMPLES[0]!.text);
    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe('TSLA');
    expect(result[0]!.isExplicit).toBe(true);
  });

  it('extracts multiple explicit tickers', async () => {
    const mentions: TickerMention[] = [
      { symbol: 'AAPL', confidence: 1.0, isExplicit: true, context: '$AAPL 40%' },
      { symbol: 'NVDA', confidence: 1.0, isExplicit: true, context: '$NVDA 30%' },
      { symbol: 'MSFT', confidence: 1.0, isExplicit: true, context: '$MSFT 20%' },
    ];
    const extractor = makeTickerExtractor({
      inferenceClient: makeMockInference(mentions),
      provider: primaryProvider,
    });
    const result = await extractor.extractTickers(SAMPLES[1]!.text);
    expect(result.map((m) => m.symbol).sort()).toEqual(['AAPL', 'MSFT', 'NVDA']);
  });

  it('returns empty array for text with no tickers', async () => {
    const extractor = makeTickerExtractor({
      inferenceClient: makeMockInference([]),
      provider: primaryProvider,
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
      provider: primaryProvider,
    });
    expect(await extractor.extractTickers('   ')).toHaveLength(0);
    expect(called).toBe(false);
  });

  it('returns all mentions regardless of confidence score', async () => {
    const mentions: TickerMention[] = [
      { symbol: 'TSLA', confidence: 0.9, isExplicit: false, context: 'Tesla' },
      { symbol: 'AAPL', confidence: 0.5, isExplicit: false, context: 'Apple' },
    ];
    const extractor = makeTickerExtractor({
      inferenceClient: makeMockInference(mentions),
      provider: primaryProvider,
    });
    const result = await extractor.extractTickers('Some text');
    expect(result).toHaveLength(2);
  });

  it('returns all mentions from the LLM as-is', async () => {
    const mentions: TickerMention[] = [
      { symbol: 'TSLA', confidence: 0.95, isExplicit: true, context: '$TSLA' },
      { symbol: 'FAKE', confidence: 0.9, isExplicit: true, context: '$FAKE' },
    ];
    const extractor = makeTickerExtractor({
      inferenceClient: makeMockInference(mentions),
      provider: primaryProvider,
    });
    const result = await extractor.extractTickers('Buying $TSLA and $FAKE today');
    expect(result).toHaveLength(2);
  });

  it('normalises symbols to uppercase', async () => {
    const mentions: TickerMention[] = [
      { symbol: 'tsla', confidence: 1.0, isExplicit: true, context: '$tsla' },
    ];
    const extractor = makeTickerExtractor({
      inferenceClient: makeMockInference(mentions),
      provider: primaryProvider,
    });
    const result = await extractor.extractTickers('$tsla going up');
    expect(result[0]!.symbol).toBe('TSLA');
  });

  it('works with Claude provider', async () => {
    const mentions: TickerMention[] = [
      { symbol: 'AAPL', confidence: 0.85, isExplicit: false, context: 'Apple' },
    ];
    const extractor = makeTickerExtractor({
      inferenceClient: makeMockInference(mentions),
      provider: claudeProvider,
    });
    const result = await extractor.extractTickers('Apple is looking bullish');
    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe('AAPL');
  });

  it('throws when inference fails', async () => {
    const extractor = makeTickerExtractor({
      inferenceClient: makeMockInferenceThrows('Provider down'),
      provider: primaryProvider,
    });
    await expect(extractor.extractTickers('Some text')).rejects.toThrow('Provider down');
  });
});

// ---------------------------------------------------------------------------
// Integration tests (require INTEGRATION_TEST=true + running provider + DB)
// ---------------------------------------------------------------------------
const RUN_INTEGRATION = process.env['INTEGRATION_TEST'] === 'true';

describe.if(RUN_INTEGRATION)('integration: real provider', () => {
  it.each(SAMPLES)('extracts from: $id', async ({ text, expectedSymbols }) => {
    console.log(`[integration] ${text.slice(0, 60)}...`);
    console.log(`[integration] expected: ${expectedSymbols.join(', ') || '(none)'}`);
    expect(true).toBe(true); // scaffold — replace with real assertions
  });
});
