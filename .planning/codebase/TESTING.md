# Testing Patterns

**Analysis Date:** 2026-04-11

## Test Framework

**Runner:**
- Bun's built-in test runner (`bun test`)
- No separate jest/vitest config — Bun's runner is used directly
- Config: none (uses Bun defaults; tsconfig extended from `@config/tsconfig/node20.json`)

**Assertion Library:**
- Bun's built-in `expect` (Jest-compatible API)

**Run Commands:**
```bash
bun test                    # Run all tests in a package
bun test --watch            # Watch mode
bunx turbo run test         # Run tests across all packages (from root)
```

## Test File Organization

**Location:** Co-located with source files in the same `src/` directory.

**Naming:**
- Unit/integration tests: `[module-name].test.ts`
- E2E tests: `[subject].e2e.test.ts`

**Structure:**
```
modules/
  inference/
    src/
      client.ts
      # (no test yet)
apps/
  example/
    src/
      env.ts
      env.test.ts          # co-located test
tests/
  e2e/
    src/
      health.e2e.test.ts   # dedicated e2e package
  stock-events-simulation/
    src/
      index.ts             # simulation runner (not a test file per se)
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, test } from 'bun:test';
import { environmentSchema } from './env';

describe('environmentSchema', () => {
  test('parses TRACE_EXPORTER_URLS as comma-separated list', () => {
    const parsed = environmentSchema.parse({
      TRACE_EXPORTER_URLS: 'http://localhost:4318/v1/traces, http://127.0.0.1:4318/v1/traces',
    });
    expect(parsed.TRACE_EXPORTER_URLS).toEqual([
      'http://localhost:4318/v1/traces',
      'http://127.0.0.1:4318/v1/traces',
    ]);
  });
});
```

**Import source:**
- Always import explicitly from `bun:test`: `import { describe, expect, test } from 'bun:test'`
- E2E placeholder does not import from `bun:test` (test globals are implied), but unit tests do import explicitly

**Patterns:**
- Group tests by the module or function under test using `describe`
- Test names start with `'should ...'` or describe behavior directly: `'parses TRACE_EXPORTER_URLS as comma-separated list'`
- Async tests use `async` functions when needed

## Mocking

**Framework:** Bun's built-in `mock` (Jest-compatible `jest.fn()` equivalents available as `mock.fn()`).

No mocking patterns are yet established in existing test files — the current test suite only tests pure functions (Zod schema parsing). As tests are added, prefer:
- `mock.fn()` / `mock.module()` from `bun:test` for module-level mocks
- Passing stub implementations via dependency injection (the codebase uses factory functions with options interfaces, making DI-based mocking natural)

**What to Mock:**
- External connections: `amqplib`, `redis`, DB clients — these should be stubbed via the options interfaces (`MakeConsumerOpts.broker`, `MakeDBClientOpts.url`)
- `makeLogger` output in unit tests (use a pino logger with `level: 'silent'` or pass a stub)

**What NOT to Mock:**
- Internal pure logic functions (Zod schemas, ID generators, event builders) — test these directly

## Fixtures and Factories

**Test Data:**
No established fixture/factory pattern yet. Given the pervasive `make*` factory pattern in the codebase, test data should be created with the same domain factories:

```typescript
import { makeTicker } from '@modules/db';
const ticker = makeTicker({ name: 'Apple', symbol: 'AAPL' });
```

**Location:**
- No shared `__fixtures__` or `__factories__` directory exists yet
- Place test helpers adjacent to test files or in a `src/__test-utils__/` directory within each package

## Coverage

**Requirements:** None enforced (no coverage thresholds configured).

**View Coverage:**
```bash
bun test --coverage      # Bun built-in coverage (experimental)
```

## Test Types

**Unit Tests:**
- Scope: Individual functions, Zod schemas, pure transformations
- Location: Co-located with source (`*.test.ts`)
- Current examples: `apps/example/src/env.test.ts`

**Integration Tests:**
- Not yet established. The stock-events-simulation package (`tests/stock-events-simulation/`) acts as a manual integration harness rather than an automated test suite — it runs simulations against live infrastructure.

**E2E Tests:**
- Package: `tests/e2e/` (`@tests/e2e`)
- Runner: `bun test` within the e2e package
- Naming: `*.e2e.test.ts`
- Current state: Placeholder only (`tests/e2e/src/health.e2e.test.ts` contains a trivial `expect(1).toEqual(1)`)
- Intended to test full service health across deployed infrastructure

## Common Patterns

**Schema/Validation Testing:**
```typescript
import { describe, expect, test } from 'bun:test';
import { environmentSchema } from './env';

describe('environmentSchema', () => {
  test('parses comma-separated URLs', () => {
    const parsed = environmentSchema.parse({ TRACE_EXPORTER_URLS: 'http://a.com, http://b.com' });
    expect(parsed.TRACE_EXPORTER_URLS).toEqual(['http://a.com', 'http://b.com']);
  });
});
```

**Async Testing:**
```typescript
test('connects and disconnects', async () => {
  const consumer = makeConsumer({ ... });
  await consumer.connect();
  await consumer.disconnect();
  // assert no errors thrown
});
```

**Error Testing (expected pattern):**
```typescript
test('throws when not connected', async () => {
  const producer = makeProducer({ broker: '...', logger });
  expect(() => producer.send('domain', 'key', {})).toThrow(
    'Producer is not connected. Call `connect()` first.'
  );
});
```

## Notes on Test Coverage State

The test suite is minimal. Only two test files exist:
- `apps/example/src/env.test.ts` — tests Zod env parsing (meaningful)
- `tests/e2e/src/health.e2e.test.ts` — placeholder only

All core modules (`events`, `db`, `graph-db`, `inference`, `tracing`, `logger`, `ids`, `reddit-client`) have zero automated test coverage. Adding unit tests for these modules is a significant gap.

---

*Testing analysis: 2026-04-11*
