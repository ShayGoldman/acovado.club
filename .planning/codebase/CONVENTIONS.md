# Coding Conventions

**Analysis Date:** 2026-04-11

## Naming Patterns

**Files:**
- `kebab-case` for all source files: `reddit-api-client.ts`, `tracing-decorator.ts`, `make-event.ts`
- `index.ts` is the public barrel file for every module
- Model files named after their domain entity in kebab-case: `watch-list.ts`, `inference-log.ts`

**Functions:**
- `camelCase` for all functions
- Factory functions use a `make` prefix: `makeConsumer`, `makeProducer`, `makeLogger`, `makeDBClient`, `makeGraphClient`, `makeTracer`, `makeId`
- Constructor-like helpers also use `make`: `makeEvent`, `makeModelCreatedEvent`, `makeMessageMetadata`
- Standalone utility functions use descriptive verbs: `connectToBroker`, `safeClose`, `calculateBackoffDelay`, `parseGraphStats`

**Variables:**
- `camelCase` for all local variables and parameters
- `SCREAMING_SNAKE_CASE` for environment variable keys in schemas (e.g., `NODE_ENV`, `TRACE_EXPORTER_URLS`)

**Types and Interfaces:**
- `PascalCase` for all interfaces and types: `EventHandler`, `MakeEventsConsumerOpts`, `MessageMetadata`
- Options interfaces follow the pattern `Make[Name]Opts`: `MakeEventsConsumerOpts`, `MakeDBClientOpts`, `MakeGraphClientOpts`
- Return types derived via `ReturnType<typeof make...>`: `export type Consumer = ReturnType<typeof makeConsumer>`
- Inferred types from Zod schemas via `Z.infer<typeof schema>`: `export type Ticker = Z.infer<typeof selectTickerSchema>`

**DB Schema:**
- Table variable names in `camelCase` plural: `watchLists`, `tickers`, `inferenceLogs`
- Column names in `snake_case` (enforced by drizzle `casing: 'snake_case'`)

## Code Style

**Formatter:** Biome (`/Users/shayg/Workspace/acovado.club/biome.json`)
- Indent: 2 spaces
- Line width: 90 characters
- Quote style: single quotes
- Trailing commas: always
- Semicolons: always

**Linter:** Biome (recommended rules enabled)
- `noExplicitAny`: off (any usage is permitted)
- `noNonNullAssertion`: off (non-null assertions `!` are allowed)
- `noUnusedImports`: warn
- `noUnusedVariables`: warn
- `useNodejsImportProtocol`: off

**TypeScript:**
- Strict mode enabled globally (`/Users/shayg/Workspace/acovado.club/config/tsconfig/tsconfig.base.json`)
- `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` all enabled
- `verbatimModuleSyntax`: false — `import type` is used manually for type-only imports as a convention

## Import Organization

Biome `organizeImports` is enabled. Typical ordering observed in source files:

1. Workspace module imports (`@modules/*`, `@apps/*`)
2. Third-party imports (alphabetically)
3. Relative imports

**Path Aliases:**
- Each package uses `@/*` → `./src/*` within its own tsconfig
- Cross-package imports use workspace names: `@modules/logger`, `@modules/tracing`, `@modules/events`, `@modules/db`, etc.

**Type vs Value imports:**
- Use `import type` for type-only imports consistently: `import type { Logger } from '@modules/logger'`
- Value imports and type imports may be separated into two `import` statements from the same source

## Error Handling

**Patterns:**
- Functions that connect to external services use try/catch and rethrow after logging: `connectToBroker` in `modules/events/src/utils.ts`
- Long-running operations wrap errors in tracer spans which automatically record exceptions via `span.recordException(error)` in `modules/tracing/src/tracer.ts`
- Consumer message handlers: `channel.nack(msg, false, true)` on error and log with `boundLogger.error(error, 'Error processing message')`
- Failing gracefully with `safeClose` — wraps close calls in try/catch, logs errors but does not rethrow
- Non-null assertions (`!`) are used where type narrowing is already validated at runtime
- Error objects are always passed as the first argument to pino logger: `logger.error({ error }, 'message')` or `logger.error(error, 'message')`

## Logging

**Framework:** `pino` via `@modules/logger`

**Creating a logger:**
```typescript
import { makeLogger } from '@modules/logger';
const logger = makeLogger({ name: 'my-service', level: 'info' });
```

**Bound loggers:** Use `makeBoundLogger(logger, { domain, topic })` from `@modules/events` to create child loggers with contextual bindings.

**Log levels:**
- `debug` for query execution, message processing details, retry attempts
- `info` for connection events, lifecycle events (connected, channel created, message sent)
- `error` for failures (connection errors, processing errors)
- `warn` for unexpected-but-recoverable situations (callback not found for response)

**Structured log objects:** Always pass a structured object as the first argument for contextual data:
```typescript
logger.info({ event: 'rabbitmq.connected' }, 'Connected to RabbitMQ');
logger.error({ event: 'rabbitmq.connection_error', error }, 'Failed to connect');
```

**Pretty printing:** Automatically enabled when `NODE_ENV !== 'production'`.

## Comments

**When to Comment:**
- Block comments for overloaded function signatures and non-obvious implementation choices
- Inline `//` comments for step explanations in complex logic (e.g., span linking in `tracing-decorator.ts`)
- JSDoc-style `/** */` comments on exported types and interface fields that need clarification: `/** Flush and shutdown OTLP trace and log providers (call on process exit). */`

**TODO comments:** Used sparingly for known gaps — always descriptive: `// TODO add anotate object support (Date -> ISOString)`

## Function Design

**Size:** Functions are kept focused. Long modules (e.g., `tracer.ts`, `client.ts` in graph-db) decompose logic into private helpers within the same file.

**Parameters:** Complex functions use an options interface (`Make*Opts`) for named parameters. Simpler functions use positional args.

**Return Values:**
- Clients and services are returned as plain objects (not classes): `return { connect, send, disconnect }`
- Type aliases capture the return type: `export type Producer = ReturnType<typeof makeProducer>`

## Module Design

**Exports:** Each module has an `index.ts` that re-exports from internal files with `export * from './...'`.

**Barrel Files:** `index.ts` at the `src/` root of every package serves as the barrel. Modules do not use deep re-export chains beyond one level.

**Internal helpers:** Private/internal functions are defined in the same file as the public API and are not exported.

## Environment Configuration

**Pattern:** Every module/app that needs env vars defines:
1. A Zod schema named `environmentSchema`
2. A `parseEnv(env: NodeJS.ProcessEnv)` function that calls `environmentSchema.parse(env)`
3. An `Environment` type inferred from the schema

Example in `apps/example/src/env.ts` and `modules/db/src/env.ts`.

## Commit Convention

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) enforced by `commitlint` with `@commitlint/config-conventional`. Husky runs commitlint on `commit-msg` and `lint-staged` on `pre-commit`.

---

*Convention analysis: 2026-04-11*
