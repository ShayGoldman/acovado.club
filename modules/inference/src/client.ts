import type { DBClient } from '@modules/db';
import { schema } from '@modules/db';
import type { Tracer } from '@modules/tracing';
import type {
  InferenceClient,
  InferenceHooks,
  InferenceRequest,
  RetryConfig,
} from './types';

export interface MakeInferenceClientOpts {
  db: DBClient;
  tracer: Tracer;
  hooks?: InferenceHooks;
}

function defaultRetryableErrors(error: Error): boolean {
  const errorMessage = error.message.toLowerCase();
  const errorName = error.name.toLowerCase();

  if (
    errorName.includes('network') ||
    errorName.includes('timeout') ||
    errorName.includes('econnrefused') ||
    errorName.includes('enotfound') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('429') ||
    errorMessage.includes('503') ||
    errorMessage.includes('502') ||
    errorMessage.includes('500')
  ) {
    return true;
  }

  return false;
}

function calculateBackoffDelay(attempt: number, retryConfig: RetryConfig): number {
  const baseDelay = retryConfig.baseDelayMs ?? 1000;
  const maxDelay = retryConfig.maxDelayMs ?? 60000;
  const useExponential = retryConfig.exponentialBackoff ?? true;
  const useJitter = retryConfig.jitter ?? true;

  let delay: number;

  if (useExponential) {
    delay = baseDelay * 2 ** (attempt - 1);
  } else {
    delay = retryConfig.backoffMs ?? baseDelay;
  }

  delay = Math.min(delay, maxDelay);

  if (useJitter) {
    const jitterAmount = delay * 0.25;
    const jitter = (Math.random() * 2 - 1) * jitterAmount;
    delay = Math.max(0, delay + jitter);
  }

  return Math.round(delay);
}

function shouldRetry(error: Error, attempt: number, retryConfig: RetryConfig): boolean {
  if (attempt >= retryConfig.maxAttempts) {
    return false;
  }

  if (retryConfig.retryableErrors) {
    return retryConfig.retryableErrors(error);
  }

  return defaultRetryableErrors(error);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePrompt(prompt: unknown): string {
  // Handle string prompts
  if (typeof prompt === 'string') {
    return prompt;
  }

  // Handle arrays (e.g., LangChain messages)
  if (Array.isArray(prompt)) {
    return prompt
      .map((item) =>
        item.toFormattedString ? item.toFormattedString('pretty') : item.toString(),
      )
      .join('\n\n');
  }

  // Handle objects
  if (typeof prompt === 'object' && prompt !== null) {
    return JSON.stringify(prompt, null, 2);
  }

  // Handle primitives
  return String(prompt);
}

export function makeInferenceClient(opts: MakeInferenceClientOpts): InferenceClient {
  const { db, tracer, hooks } = opts;

  return {
    async invoke<T>(request: InferenceRequest<T>): Promise<T> {
      const spanName = request.name
        ? `${request.name} (${request.model})`
        : `Model invocation: ${request.model}`;
      return tracer.with(spanName, async (ctx) => {
        const startTime = performance.now();
        let retryCount = 0;
        const retryConfig = request.retry ?? { maxAttempts: 1 };
        let lastError: Error | null = null;
        let response: T | null = null;

        if (request.name) {
          ctx.annotate('name', request.name);
        }
        ctx.annotate('model', request.model);
        ctx.annotate('retry.maxAttempts', retryConfig.maxAttempts);

        if (hooks?.beforeInvoke) {
          await hooks.beforeInvoke(request as InferenceRequest<unknown>, ctx);
        }

        ctx.log.info(
          {
            name: request.name,
            model: request.model,
            metadata: request.metadata,
          },
          'Invoking model',
        );

        while (retryCount < retryConfig.maxAttempts) {
          try {
            response = await request.callable();
            break;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            const isRetriable = shouldRetry(lastError, retryCount + 1, retryConfig);

            if (!isRetriable) {
              ctx.log.debug(
                { error: lastError, attempt: retryCount + 1 },
                'Non-retriable error, stopping retries',
              );
              break;
            }

            retryCount++;

            if (retryCount < retryConfig.maxAttempts) {
              const delay = calculateBackoffDelay(retryCount, retryConfig);

              ctx.log.debug(
                {
                  error: lastError,
                  attempt: retryCount,
                  maxAttempts: retryConfig.maxAttempts,
                  delayMs: delay,
                },
                'Retrying model invocation',
              );

              if (hooks?.onRetry) {
                await hooks.onRetry(
                  request as InferenceRequest<unknown>,
                  lastError,
                  retryCount,
                  ctx,
                );
              }

              await sleep(delay);
            }
          }
        }

        const durationMs = performance.now() - startTime;
        const status = response !== null ? 'success' : 'error';
        const errorMessage = lastError?.message ?? null;

        ctx.annotate('duration_ms', Math.round(durationMs));
        ctx.annotate('status', status);
        ctx.annotate('retry_count', retryCount);

        if (status === 'success') {
          ctx.log.debug(
            {
              model: request.model,
              durationMs: Math.round(durationMs),
              retryCount,
            },
            'Model invocation succeeded',
          );

          if (hooks?.afterInvoke) {
            await hooks.afterInvoke(
              request as InferenceRequest<unknown>,
              response as unknown,
              ctx,
            );
          }
        } else {
          ctx.log.error(
            {
              error: lastError,
              model: request.model,
              durationMs: Math.round(durationMs),
              retryCount,
            },
            'Model invocation failed',
          );

          if (hooks?.onError) {
            await hooks.onError(request as InferenceRequest<unknown>, lastError!, ctx);
          }
        }

        const normalizedPrompt = normalizePrompt(request.prompt);

        const [inferenceLog] = await db
          .insert(schema.inferenceLogs)
          .values({
            name: request.name ?? null,
            model: request.model,
            config: request.config,
            prompt: normalizedPrompt,
            response: response !== null ? response : null,
            durationMs: (Math.round(durationMs * 100) / 100).toString(),
            status,
            error: errorMessage,
            retryCount,
            metadata: request.metadata ?? null,
          })
          .returning();

        if (!inferenceLog) {
          throw new Error('Failed to create inference log');
        }

        if (status === 'error') {
          throw lastError!;
        }

        return response as T;
      });
    },
  };
}
