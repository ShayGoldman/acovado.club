import type { ClaudeProvider, OllamaProvider } from '@modules/inference';
import type { InferenceClient } from '@modules/inference';
import type { DBClient } from '@modules/db';

export interface TickerMention {
  symbol: string;
  companyName: string;
  confidence: number;
  isExplicit: boolean;
  context: string;
}

export interface TickerExtractor {
  extractTickers(text: string): Promise<TickerMention[]>;
}

export interface MakeTickerExtractorOpts {
  inferenceClient: InferenceClient;
  db: DBClient;
  providers: {
    primary: OllamaProvider;
    fallback?: ClaudeProvider;
  };
  /** Minimum confidence threshold. Default: 0.7 */
  minConfidence?: number;
}
