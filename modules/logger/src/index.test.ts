import { describe, expect, it } from 'bun:test';
import pino from 'pino';
import { boundedErrSerializer } from './index';

describe('boundedErrSerializer', () => {
  it('drops non-allowlisted fields from error payload', () => {
    const err = new Error('test error');
    (err as any).parameters = 'x'.repeat(6 * 1024);

    const result = boundedErrSerializer(err);

    expect(result).not.toHaveProperty('parameters');
    expect(JSON.stringify(result).length).toBeLessThan(3 * 1024);
  });

  it('caps message at 200 characters', () => {
    const err = new Error('a'.repeat(10 * 1024));

    const result = boundedErrSerializer(err);

    expect((result['message'] as string).length).toBe(200);
  });

  it('caps stack at 2048 characters', () => {
    const err = new Error('deep');
    const stackLines = Array.from(
      { length: 100 },
      (_, i) => `    at fn${i} (file.ts:${i}:1)`,
    );
    const longStack = `Error: deep\n${stackLines.join('\n')}`;
    Object.defineProperty(err, 'stack', {
      value: longStack,
      writable: true,
      configurable: true,
    });

    const result = boundedErrSerializer(err);

    expect(longStack.length).toBeGreaterThan(2048);
    expect((result['stack'] as string).length).toBeLessThanOrEqual(2048);
  });

  it('serializes cause chain 2 levels deep', () => {
    const root = new Error('root cause');
    const mid = new Error('intermediate', { cause: root });
    const top = new Error('top', { cause: mid });

    const result = boundedErrSerializer(top);

    const cause1 = result['cause'] as Record<string, unknown>;
    expect(cause1['name']).toBe('Error');
    expect(cause1['message']).toBe('intermediate');
    const cause2 = cause1['cause'] as Record<string, unknown>;
    expect(cause2['name']).toBe('Error');
    expect(cause2['message']).toBe('root cause');
  });

  it('collapses cause chain beyond depth 3', () => {
    // Chain: err(0) → c1(1) → c2(2) → c3(3) → c4(4, collapsed) → c5(never reached)
    const c5 = new Error('cause 5');
    const c4 = new Error('cause 4', { cause: c5 });
    const c3 = new Error('cause 3', { cause: c4 });
    const c2 = new Error('cause 2', { cause: c3 });
    const c1 = new Error('cause 1', { cause: c2 });
    const err = new Error('root', { cause: c1 });

    const result = boundedErrSerializer(err);

    const depth3 = (
      (result['cause'] as Record<string, unknown>)['cause'] as Record<string, unknown>
    )['cause'] as Record<string, unknown>;
    expect(depth3['stack']).toBeDefined();

    const depth4 = depth3['cause'] as Record<string, unknown>;
    expect(depth4['name']).toBe('Error');
    expect(depth4['message']).toBe('cause 4');
    expect(depth4['stack']).toBeUndefined();
    expect(depth4['cause']).toBeUndefined();
  });

  it('preserves safe error fields: code, errno, statusCode', () => {
    const err = new Error('connection error');
    (err as any).code = 'ECONN';
    (err as any).errno = -61;
    (err as any).statusCode = 503;

    const result = boundedErrSerializer(err);

    expect(result['code']).toBe('ECONN');
    expect(result['errno']).toBe(-61);
    expect(result['statusCode']).toBe(503);
  });

  it('returns NonError shape for non-Error input', () => {
    const result = boundedErrSerializer('some string error');

    expect(result['name']).toBe('NonError');
    expect(result['message']).toBe('some string error');
  });

  it('does not emit non-allowlisted fields through pino logger.error', () => {
    const lines: string[] = [];
    const sink = {
      write(data: string) {
        lines.push(data);
        return true;
      },
    };

    const logger = pino(
      {
        level: 'error',
        serializers: {
          err: boundedErrSerializer,
          error: boundedErrSerializer,
        },
      },
      sink as any,
    );

    const err = new Error('test');
    (err as any).parameters = 'payload-must-not-leak';

    logger.error({ err }, 'test log line');

    const logLine = lines[0] ?? '';
    expect(logLine).not.toContain('payload-must-not-leak');
    expect(logLine).toContain('test log line');
  });
});
