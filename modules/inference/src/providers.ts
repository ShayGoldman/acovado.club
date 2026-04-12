import { createAnthropic } from '@ai-sdk/anthropic';
import { createOllama } from 'ollama-ai-provider';

export interface MakeOllamaProviderOpts {
  baseUrl?: string;
  model?: string;
}

export interface MakeClaudeProviderOpts {
  apiKey?: string;
}

/**
 * Creates a configured Ollama provider for use with the Vercel AI SDK.
 * Reads OLLAMA_BASE_URL and OLLAMA_MODEL from environment if opts not provided.
 */
export function makeOllamaProvider(opts: MakeOllamaProviderOpts = {}) {
  const baseUrl = opts.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  const model = opts.model ?? process.env.OLLAMA_MODEL ?? 'gemma3:4b';

  const ollama = createOllama({ baseURL: `${baseUrl}/api` });

  return {
    provider: ollama,
    model: ollama(model),
    modelId: model,
  };
}

/**
 * Creates a configured Anthropic (Claude) provider for use with the Vercel AI SDK.
 * Reads ANTHROPIC_API_KEY from environment if opts not provided.
 */
export function makeClaudeProvider(opts: MakeClaudeProviderOpts = {}) {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;

  const anthropic = createAnthropic({ apiKey });

  return {
    provider: anthropic,
    model: anthropic('claude-haiku-4-5-20251001'),
    modelId: 'claude-haiku-4-5-20251001',
  };
}

export type OllamaProvider = ReturnType<typeof makeOllamaProvider>;
export type ClaudeProvider = ReturnType<typeof makeClaudeProvider>;
