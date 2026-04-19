import type { ClaudeProvider, InferenceClient, OllamaProvider } from '@modules/inference';

/** A single ticker symbol extracted from text. */
export interface TickerMention {
  /** Uppercase ticker symbol, e.g. "AAPL" */
  symbol: string;
  /** Extraction confidence score in [0, 1] */
  confidence: number;
  /** True when the symbol appeared with a $ prefix (e.g. $AAPL) */
  isExplicit: boolean;
  /** Short phrase surrounding the mention (for audit / debugging) */
  context: string;
}

export interface MakeTickerExtractorOpts {
  inferenceClient: InferenceClient;
  provider: OllamaProvider | ClaudeProvider;
}

export interface TickerExtractor {
  extractTickers(text: string): Promise<TickerMention[]>;
}
