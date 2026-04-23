import { describe, expect, it } from 'bun:test';
import { makeTracingDecorator } from './tracing-decorator';
import type { Message } from './types';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const LARGE_PARAMETERS = 'x'.repeat(6000); // >5 KB

function makeSpyCtx() {
  const errorCalls: Array<[Record<string, unknown>, string]> = [];

  const ctx: any = {
    log: {
      info: () => {},
      error: (data: Record<string, unknown>, msg: string) => errorCalls.push([data, msg]),
    },
    annotate: () => {},
    with: async (_name: string, fn: (c: any) => Promise<unknown>) => fn(ctx),
    annotations: new Map(),
    setName: () => {},
  };

  return { ctx, errorCalls };
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

function makeMessage(): Message<{ data: string }> {
  return {
    payload: { data: 'test' },
    metadata: {
      messageId: 'msg-test-1',
      correlationId: 'corr-test-1',
      domain: 'reddit',
      queue: 'signal-processor',
      routingKey: 'post.collected',
      headers: {},
      timestamp: new Date().toISOString(),
      version: '1',
    },
  };
}

// ---------------------------------------------------------------------------
// decorateHandler — error-path logging redaction (ACO-106)
// ---------------------------------------------------------------------------

describe('makeTracingDecorator — decorateHandler error-path logging redaction', () => {
  it('does not pass raw Error (with large own-property) to the logger', async () => {
    const { ctx, errorCalls } = makeSpyCtx();
    const dbError = Object.assign(new Error('DB connection failed'), {
      name: 'PostgresError',
      parameters: LARGE_PARAMETERS,
    });

    const decorator = makeTracingDecorator({ tracer: makeStubTracer(ctx), logger: ctx.log });
    const decorated = decorator.decorateHandler(
      async () => {
        throw dbError;
      },
      { domain: 'reddit', queue: 'signal-processor', routingKey: 'post.collected' },
    );

    await expect(decorated(makeMessage())).rejects.toThrow('DB connection failed');

    expect(errorCalls.length).toBe(1);
    const serialized = JSON.stringify(errorCalls);
    expect(serialized).not.toContain(LARGE_PARAMETERS.slice(0, 50));
  });

  it('logs errorName, errorMessage, messageId, domain, routingKey', async () => {
    const { ctx, errorCalls } = makeSpyCtx();
    const dbError = Object.assign(new Error('Timeout'), { name: 'PostgresError' });

    const decorator = makeTracingDecorator({ tracer: makeStubTracer(ctx), logger: ctx.log });
    const decorated = decorator.decorateHandler(
      async () => {
        throw dbError;
      },
      { domain: 'reddit', queue: 'signal-processor', routingKey: 'post.collected' },
    );

    await expect(decorated(makeMessage())).rejects.toThrow();

    const [logData] = errorCalls[0]!;
    expect(logData['errorName']).toBe('PostgresError');
    expect(logData['errorMessage']).toBe('Timeout');
    expect(logData['messageId']).toBe('msg-test-1');
    expect(logData['domain']).toBe('reddit');
    expect(logData['routingKey']).toBe('post.collected');
  });

  it('caps errorMessage at 200 chars', async () => {
    const { ctx, errorCalls } = makeSpyCtx();
    const dbError = new Error('z'.repeat(1000));

    const decorator = makeTracingDecorator({ tracer: makeStubTracer(ctx), logger: ctx.log });
    const decorated = decorator.decorateHandler(
      async () => {
        throw dbError;
      },
      { domain: 'reddit', queue: 'signal-processor', routingKey: 'post.collected' },
    );

    await expect(decorated(makeMessage())).rejects.toThrow();

    const [logData] = errorCalls[0]!;
    expect((logData['errorMessage'] as string).length).toBeLessThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// decorateProducer — error-path logging redaction (ACO-106)
// ---------------------------------------------------------------------------

describe('makeTracingDecorator — decorateProducer error-path logging redaction', () => {
  it('does not pass raw Error (with large own-property) to the logger', async () => {
    const { ctx, errorCalls } = makeSpyCtx();
    const sendError = Object.assign(new Error('AMQP channel closed'), {
      name: 'AMQPError',
      parameters: LARGE_PARAMETERS,
    });

    const decorator = makeTracingDecorator({ tracer: makeStubTracer(ctx), logger: ctx.log });
    const decorated = decorator.decorateProducer(async () => {
      throw sendError;
    });

    await expect(decorated('reddit', 'post.collected', { data: 'x' })).rejects.toThrow(
      'AMQP channel closed',
    );

    expect(errorCalls.length).toBe(1);
    const serialized = JSON.stringify(errorCalls);
    expect(serialized).not.toContain(LARGE_PARAMETERS.slice(0, 50));
  });

  it('logs errorName, errorMessage, domain, routingKey', async () => {
    const { ctx, errorCalls } = makeSpyCtx();
    const sendError = Object.assign(new Error('Channel error'), { name: 'AMQPError' });

    const decorator = makeTracingDecorator({ tracer: makeStubTracer(ctx), logger: ctx.log });
    const decorated = decorator.decorateProducer(async () => {
      throw sendError;
    });

    await expect(decorated('reddit', 'post.collected', { data: 'x' })).rejects.toThrow();

    const [logData] = errorCalls[0]!;
    expect(logData['errorName']).toBe('AMQPError');
    expect(logData['errorMessage']).toBe('Channel error');
    expect(logData['domain']).toBe('reddit');
    expect(logData['routingKey']).toBe('post.collected');
  });
});
