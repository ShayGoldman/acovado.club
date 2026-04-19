import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV3 } from '@ai-sdk/provider';

export interface MakeOllamaProviderOpts {
  baseUrl?: string;
  model?: string;
}

export interface MakeClaudeProviderOpts {
  apiKey?: string;
  model?: string;
}

/**
 * Creates a configured Ollama language model for use with the Vercel AI SDK.
 * Reads OLLAMA_BASE_URL and OLLAMA_MODEL from environment if opts not provided.
 */
export function makeOllamaProvider(opts: MakeOllamaProviderOpts = {}): {
  model: LanguageModelV3;
  modelId: string;
} {
  const baseUrl =
    opts.baseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
  const modelId = opts.model ?? process.env['OLLAMA_MODEL'] ?? 'gemma3:4b';

  const ollama = createOpenAICompatible({
    name: 'ollama',
    baseURL: `${baseUrl}/v1`,
    supportsStructuredOutputs: true,
  });

  return {
    model: ollama(modelId),
    modelId,
  };
}

/**
 * Creates a configured Anthropic (Claude) language model for use with the Vercel AI SDK.
 * Reads ANTHROPIC_API_KEY from environment if opts not provided.
 */
export function makeClaudeProvider(opts: MakeClaudeProviderOpts = {}): {
  model: LanguageModelV3;
  modelId: string;
} {
  const apiKey = opts.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  const modelId = opts.model ?? 'claude-haiku-4-5-20251001';

  const anthropic = createAnthropic({ ...(apiKey !== undefined ? { apiKey } : {}) });

  return {
    model: anthropic(modelId),
    modelId,
  };
}

export type OllamaProvider = ReturnType<typeof makeOllamaProvider>;
export type ClaudeProvider = ReturnType<typeof makeClaudeProvider>;
