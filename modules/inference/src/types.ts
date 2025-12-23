import type { Context } from '@modules/tracing';

export interface ModelConfig {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  format?: 'json' | 'text';
  [key: string]: unknown;
}

export interface InferenceMetadata {
  [key: string]: string | number | boolean | null | undefined;
}

export interface InferenceClient {
  invoke<T>(request: InferenceRequest<T>): Promise<T>;
}

export interface InferenceRequest<T> {
  name?: string;
  model: string;
  config: ModelConfig;
  prompt: unknown;
  callable: () => Promise<T>;
  metadata?: InferenceMetadata;
  retry?: RetryConfig;
}

export interface RetryConfig {
  maxAttempts: number;
  retryableErrors?: (error: Error) => boolean;
  backoffMs?: number;
  exponentialBackoff?: boolean;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
}

export interface InferenceHooks {
  beforeInvoke?: (
    request: InferenceRequest<unknown>,
    context: Context,
  ) => Promise<void> | void;
  afterInvoke?: (
    request: InferenceRequest<unknown>,
    response: unknown,
    context: Context,
  ) => Promise<void> | void;
  onError?: (
    request: InferenceRequest<unknown>,
    error: Error,
    context: Context,
  ) => Promise<void> | void;
  onRetry?: (
    request: InferenceRequest<unknown>,
    error: Error,
    attempt: number,
    context: Context,
  ) => Promise<void> | void;
}
