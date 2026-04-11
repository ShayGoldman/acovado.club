import { describe, expect, test } from 'bun:test';
import { environmentSchema } from './env';

describe('environmentSchema', () => {
  test('parses TRACE_EXPORTER_URLS as comma-separated list', () => {
    const parsed = environmentSchema.parse({
      TRACE_EXPORTER_URLS:
        'http://localhost:4318/v1/traces, http://127.0.0.1:4318/v1/traces',
    });
    expect(parsed.TRACE_EXPORTER_URLS).toEqual([
      'http://localhost:4318/v1/traces',
      'http://127.0.0.1:4318/v1/traces',
    ]);
  });
});
