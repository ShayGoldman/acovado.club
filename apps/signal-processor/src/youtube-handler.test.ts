import { describe, expect, it } from 'bun:test';
import type { Message } from '@modules/events';
import { makeYouTubeMessageHandler } from './youtube-handler';
import type { YouTubeVideoCollectedPayload } from './youtube-types';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const LARGE_DESCRIPTION = 'video description content line '.repeat(70); // ~2 KB

function makeSpyCtx() {
  const errorCalls: Array<[Record<string, unknown>, string]> = [];
  const infoCalls: Array<[Record<string, unknown>, string]> = [];

  const ctx: any = {
    log: {
      info: (data: Record<string, unknown>, msg: string) => infoCalls.push([data, msg]),
      error: (data: Record<string, unknown>, msg: string) =>
        errorCalls.push([data, msg]),
    },
    annotate: () => {},
    with: async (_name: string, fn: (c: any) => Promise<unknown>) => fn(ctx),
    annotations: new Map(),
    setName: () => {},
  };

  return { ctx, errorCalls, infoCalls };
}

function makeStubTracer(ctx: any) {
  return {
    with: async (_name: string, optsOrFn: unknown, maybeFn?: unknown) => {
      const fn =
        typeof optsOrFn === 'function'
          ? (optsOrFn as (c: any) => Promise<unknown>)
          : (maybeFn as (c: any) => Promise<unknown>);
      return fn(ctx);
    },
  } as any;
}

function makeMessage(description = LARGE_DESCRIPTION): Message<YouTubeVideoCollectedPayload> {
  return {
    payload: {
      id: 'msg-1',
      sourceId: 'src-uuid-yt',
      channelId: 'UCxyz123',
      externalId: 'dQw4w9WgXcQ',
      title: 'Market Analysis — AAPL Q1',
      description,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      publishedAt: new Date().toISOString(),
    },
    metadata: {
      messageId: 'msg-1',
      domain: 'youtube',
      queue: 'signal-processor',
      routingKey: 'video.collected',
      headers: {},
    },
  };
}

// ---------------------------------------------------------------------------
// Error-path logging redaction
// ---------------------------------------------------------------------------

describe('makeYouTubeMessageHandler — error-path logging redaction (ACO-106)', () => {
  it('logs bounded error context and rethrows when DB throws', async () => {
    const { ctx, errorCalls } = makeSpyCtx();
    const dbError = Object.assign(new Error('Connection closed'), {
      name: 'PostgresError',
    });

    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => ({
            returning: () => Promise.reject(dbError),
          }),
        }),
      }),
    } as any;

    const handler = makeYouTubeMessageHandler({
      db,
      tickerExtractor: { extractTickers: () => Promise.resolve([]) } as any,
      tracer: makeStubTracer(ctx),
    });

    await expect(handler(makeMessage())).rejects.toThrow('Connection closed');

    expect(errorCalls.length).toBe(1);
    const [logData, logMsg] = errorCalls[0]!;
    expect(logMsg).toBe('signal.error');
    expect(logData['externalId']).toBe('dQw4w9WgXcQ');
    expect(logData['sourceId']).toBe('src-uuid-yt');
    expect(logData['errorName']).toBe('PostgresError');
    expect(typeof logData['errorMessage']).toBe('string');
  });

  it('never includes the video description in the error log', async () => {
    const { ctx, errorCalls } = makeSpyCtx();
    const dbError = new Error('Connection closed');

    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => ({
            returning: () => Promise.reject(dbError),
          }),
        }),
      }),
    } as any;

    const handler = makeYouTubeMessageHandler({
      db,
      tickerExtractor: { extractTickers: () => Promise.resolve([]) } as any,
      tracer: makeStubTracer(ctx),
    });

    await expect(handler(makeMessage(LARGE_DESCRIPTION))).rejects.toThrow();

    const serialized = JSON.stringify(errorCalls);
    expect(serialized).not.toContain(LARGE_DESCRIPTION.slice(0, 50));
  });

  it('caps errorMessage at 200 chars for very long error messages', async () => {
    const { ctx, errorCalls } = makeSpyCtx();
    const dbError = new Error('x'.repeat(1000));

    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => ({
            returning: () => Promise.reject(dbError),
          }),
        }),
      }),
    } as any;

    const handler = makeYouTubeMessageHandler({
      db,
      tickerExtractor: { extractTickers: () => Promise.resolve([]) } as any,
      tracer: makeStubTracer(ctx),
    });

    await expect(handler(makeMessage())).rejects.toThrow();

    const [logData] = errorCalls[0]!;
    expect((logData['errorMessage'] as string).length).toBeLessThanOrEqual(200);
  });

  it('does not log an error on the success path', async () => {
    const { ctx, errorCalls, infoCalls } = makeSpyCtx();
    const fakeItem = { id: 'item-uuid-1', processedAt: null };

    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => ({
            returning: () => Promise.resolve([fakeItem]),
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
    } as any;

    const handler = makeYouTubeMessageHandler({
      db,
      tickerExtractor: { extractTickers: () => Promise.resolve([]) } as any,
      tracer: makeStubTracer(ctx),
    });

    await handler(makeMessage('short description'));

    expect(errorCalls.length).toBe(0);
    expect(infoCalls.some(([, msg]) => msg === 'signal.done')).toBe(true);
  });
});
