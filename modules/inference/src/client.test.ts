import { describe, expect, it } from 'bun:test';
import { APICallError } from '@ai-sdk/provider';
import { makeInferenceClient } from './client';

const SECRET_BODY = 'SECRET ARTICLE BODY: extremely confidential stock tip content';

function makeTestHarness() {
  const errorCalls: unknown[][] = [];
  const debugCalls: unknown[][] = [];

  const mockCtx: Record<string, unknown> = {
    log: {
      info: () => {},
      debug: (...args: unknown[]) => {
        debugCalls.push(args);
      },
      error: (...args: unknown[]) => {
        errorCalls.push(args);
      },
      warn: () => {},
    },
    annotate: () => {},
    annotations: new Map(),
    setName: () => {},
    with: async (_: string, fn: (ctx: unknown) => Promise<unknown>) => fn(mockCtx),
  };

  const mockTracer = {
    with: async (_: string, fn: (ctx: unknown) => Promise<unknown>) => fn(mockCtx),
    shutdown: async () => {},
  };

  const mockDb = {
    insert: () => ({
      values: () => ({
        returning: () =>
          Promise.resolve([
            {
              id: '1',
              name: null,
              model: 'claude-3-5-sonnet',
              config: {},
              prompt: 'test prompt',
              response: null,
              durationMs: '10',
              status: 'error',
              error: 'auth error',
              retryCount: 0,
              metadata: null,
            },
          ]),
      }),
    }),
  };

  return { errorCalls, debugCalls, mockTracer, mockDb };
}

describe('makeInferenceClient error redaction', () => {
  it('does not log requestBodyValues or prompt content on Model invocation failed', async () => {
    const { errorCalls, mockTracer, mockDb } = makeTestHarness();

    const client = makeInferenceClient({
      db: mockDb as never,
      tracer: mockTracer as never,
    });

    const sensitiveError = new APICallError({
      message: 'auth error: invalid api key',
      url: 'https://api.anthropic.com/v1/messages',
      requestBodyValues: {
        model: 'claude-3-5-sonnet',
        messages: [{ role: 'user', content: SECRET_BODY }],
      },
      statusCode: 401,
      isRetryable: false,
    });

    await expect(
      client.invoke({
        name: 'test-invocation',
        model: 'claude-3-5-sonnet',
        config: {},
        prompt: SECRET_BODY,
        callable: async () => {
          throw sensitiveError;
        },
        retry: { maxAttempts: 1 },
      }),
    ).rejects.toThrow('auth error');

    expect(errorCalls.length).toBe(1);
    const payload = errorCalls[0]![0] as Record<string, unknown>;
    const payloadJson = JSON.stringify(payload);

    expect(payloadJson).not.toContain('requestBodyValues');
    expect(payloadJson).not.toContain(SECRET_BODY);
    expect(payloadJson).not.toContain('messages');

    expect(payload['errorName']).toBe('AI_APICallError');
    expect(typeof payload['errorMessage']).toBe('string');
    expect((payload['errorMessage'] as string).length).toBeLessThanOrEqual(200);
    expect(payload['errorStatus']).toBe(401);
    expect(payload['isRetryable']).toBe(false);
    expect(payload['model']).toBe('claude-3-5-sonnet');
    expect(typeof payload['durationMs']).toBe('number');
    expect(payload['retryCount']).toBe(0);
  });

  it('does not log requestBodyValues in retry debug logs', async () => {
    const { debugCalls, mockTracer, mockDb } = makeTestHarness();

    const client = makeInferenceClient({
      db: mockDb as never,
      tracer: mockTracer as never,
    });

    const retriableError = new APICallError({
      message: 'rate limited',
      url: 'https://api.anthropic.com/v1/messages',
      requestBodyValues: {
        model: 'claude-3-5-sonnet',
        messages: [{ role: 'user', content: SECRET_BODY }],
      },
      statusCode: 429,
      isRetryable: true,
    });

    let callCount = 0;
    await expect(
      client.invoke({
        name: 'retry-test',
        model: 'claude-3-5-sonnet',
        config: {},
        prompt: SECRET_BODY,
        callable: async () => {
          callCount++;
          if (callCount < 2) throw retriableError;
          return 'success';
        },
        retry: { maxAttempts: 2, baseDelayMs: 1, jitter: false },
      }),
    ).resolves.toBe('success');

    const allDebugJson = JSON.stringify(debugCalls);
    expect(allDebugJson).not.toContain('requestBodyValues');
    expect(allDebugJson).not.toContain(SECRET_BODY);
    expect(allDebugJson).not.toContain('messages');
  });

  it('caps errorMessage at 200 characters', async () => {
    const { errorCalls, mockTracer, mockDb } = makeTestHarness();

    const client = makeInferenceClient({
      db: mockDb as never,
      tracer: mockTracer as never,
    });

    const longMessage = 'x'.repeat(500);
    const err = new Error(longMessage);

    await expect(
      client.invoke({
        name: 'cap-test',
        model: 'claude-3-5-sonnet',
        config: {},
        prompt: 'prompt',
        callable: async () => {
          throw err;
        },
        retry: { maxAttempts: 1 },
      }),
    ).rejects.toThrow();

    const payload = errorCalls[0]![0] as Record<string, unknown>;
    expect((payload['errorMessage'] as string).length).toBe(200);
  });
});
