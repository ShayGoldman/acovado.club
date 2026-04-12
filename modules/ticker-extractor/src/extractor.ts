import type { InferenceClient } from '@modules/inference';
import type { TickerMention } from './types';

export interface MakeTickerExtractorOpts {
  inferenceClient: InferenceClient;
  /** Ollama base URL, e.g. "http://localhost:11434" */
  ollamaBaseUrl: string;
  /** Ollama model tag, e.g. "gemma3:4b" */
  model: string;
}

export type TickerExtractor = ReturnType<typeof makeTickerExtractor>;

export function makeTickerExtractor({
  inferenceClient,
  ollamaBaseUrl,
  model,
}: MakeTickerExtractorOpts) {
  async function extractTickers(text: string): Promise<TickerMention[]> {
    const prompt = `You are a financial signal extractor. Extract every US stock ticker symbol mentioned in the following text.

Return a JSON array of objects. Each object must have exactly these fields:
- symbol (string): uppercase ticker, e.g. "AAPL"
- confidence (number): 0.0–1.0, how confident you are this is a real ticker mention
- isExplicit (boolean): true if preceded by "$" (e.g. $AAPL), false otherwise
- context (string): the short phrase (≤ 15 words) surrounding the mention

Rules:
- Only include genuine stock/ETF tickers, not random uppercase words.
- If no tickers are found, return an empty array: []
- Return ONLY valid JSON, no markdown, no explanation.

Text:
${text}`;

    return inferenceClient.invoke<TickerMention[]>({
      name: 'extract-tickers',
      model,
      config: { format: 'json', temperature: 0 },
      prompt,
      callable: async () => {
        const res = await fetch(`${ollamaBaseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt,
            stream: false,
            format: 'json',
          }),
        });
        if (!res.ok) {
          throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);
        }
        const data = (await res.json()) as { response: string };
        try {
          const parsed = JSON.parse(data.response);
          if (!Array.isArray(parsed)) return [];
          return parsed as TickerMention[];
        } catch {
          return [];
        }
      },
      retry: { maxAttempts: 2 },
    });
  }

  return { extractTickers };
}
