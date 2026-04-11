<!-- GSD:project-start source:PROJECT.md -->
## Project

**acovado.club**

A distributed financial signal-tracking system running on a self-hosted VPS. It ingests social and financial data from multiple sources (Reddit first, then YouTube, news agencies, and public figures' trades), groups signals by ticker, and surfaces trends and swing opportunities for a small internal team. AI agents — orchestrated by Paperclip — do the actual data collection, processing, and analysis work.

**Core Value:** A reliable pipeline that continuously collects, processes, and groups financial social signals by ticker — the foundation every analysis and output layer depends on.

### Constraints

- **Infrastructure:** Self-hosted VPS, Docker Compose — no cloud services
- **Runtime:** Bun monorepo — all modules must be Bun-compatible
- **Sources (v1):** Reddit only — additional sources are future milestones
- **Users:** Internal only — no auth, multi-tenancy, or external access needed for v1
- **Orchestration:** Paperclip manages agent goals and scheduling — pipeline logic lives in agents, not in cron jobs or manual scripts
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.7+ - All application and module code
- YAML - Docker Compose infrastructure definitions
- Shell (sh/bash) - Docker entrypoint scripts in `infra/rabbitmq/init-plugins.sh`, `infra/inference-model/docker-compose.yaml` command blocks
## Runtime
- Bun 1.1.36 - Primary runtime for all TypeScript packages. Modules are executed as TypeScript sources directly (no transpile step at runtime). The Dockerfile comment confirms: "Workspace packages under modules/ stay as TypeScript sources; Bun resolves them at runtime (JIT)."
- Bun 1.1.36
- Lockfile: `bun.lockb` (present, binary format)
## Frameworks
- Bun.serve (built-in) - HTTP server in app entry points (e.g., `apps/example/src/index.ts`)
- No web framework (Hono, Express, etc.) — raw Bun HTTP server used directly
- Drizzle ORM ^0.45.1 - PostgreSQL access via `drizzle-orm/bun-sql` driver. Schema defined in `modules/db/src/schema.ts`. Migrations via `drizzle-kit ^0.28.1`.
- Drizzle Zod ^0.8.3 - Schema-to-Zod integration in `modules/db`
- Zod ^4.2.1 - Used across all modules for schema validation and env parsing
- Turborepo ^2.6.3 - Monorepo task orchestration. Config: `turbo.json`. Workspace layout managed via Bun workspaces in `package.json`.
- Bun test (built-in) - Test runner used in `apps/example` and `tests/e2e`. No separate test framework (Jest/Vitest) detected.
- Biome ^1.9.4 - Single tool for linting and formatting. Config: `biome.json` at root.
## Key Dependencies
- `drizzle-orm` ^0.45.1 - Primary data access layer for PostgreSQL (`modules/db`)
- `amqplib` ^0.10.5 - RabbitMQ AMQP client used in `modules/events` and `modules/reddit-client`
- `redis` ^4.7.0 - Used as transport for FalkorDB graph queries in `modules/graph-db` (FalkorDB exposes Redis protocol)
- `pino` ^9.5.0 + `pino-pretty` ^13.0.0 - Structured JSON logging in `modules/logger`
- `@opentelemetry/*` ^1.x / ^0.55.x - Full OpenTelemetry SDK for distributed tracing and log export in `modules/tracing`
- `nanoid` ^5.0.9 - ID generation in `modules/ids` and `modules/types`
- `zod` ^4.x - Env and schema validation across all modules
- `drizzle-kit` ^0.28.1 - Migration generation and Drizzle Studio (`clients/nano` dev command)
- `bluebird` ^3.7.2 - Promise utilities in `modules/db`
- `type-fest` ^4.x - TypeScript utility types used in multiple modules
- `turbo` ^2.6.3 - Build pipeline orchestrator
- `husky` ^9.1.7 - Git hooks
- `lint-staged` ^15.5.2 - Pre-commit linting
- `commitizen` + `cz-conventional-changelog` - Conventional commit tooling
- `@changesets/cli` ^2.29.8 - Versioning and changelog management
- `commander` ^11.1.0 - CLI arg parsing in `tests/stock-events-simulation`
- `date-fns` ^2.30.0 - Date utilities in stock events simulation
- `inquirer` ^9.3.7 / ^12.1.0 - Interactive prompts in simulation and tracing dev tools
## Configuration
- Environment validated at startup using Zod schemas in each module's `src/env.ts`
- Key env vars required per module:
- Production env files are external: loaded via Docker `env_file` pointing to `${ENV_FILES_ROOT}/*.env`
- `turbo.json` - Task graph. Build outputs go to `dist/`. Inputs include `.env*` files.
- `tsconfig.json` per package extends `@config/tsconfig/node20.json` (ESNext modules, bundler resolution, strict mode)
- Base tsconfig at `config/tsconfig/tsconfig.base.json`: strict, isolatedModules, noUncheckedIndexedAccess, exactOptionalPropertyTypes
- Biome config at `biome.json`: 2-space indent, 90-char line width, single quotes, trailing commas, semicolons always
- Husky for hook management (`prepare` script)
- Commitlint with conventional config (`@commitlint/config-conventional`)
## Platform Requirements
- Bun 1.1.36
- Docker + Docker Compose (for local infra: Postgres, RabbitMQ, FalkorDB, observability stack)
- GPU optional (required only for local `inference-model` / Ollama service)
- Docker (container-based deployment via `config/compose/docker-compose.apps.yaml` + `docker-compose.infra.yaml`)
- Traefik reverse proxy (labels on services, TLS via Let's Encrypt `acovado` certresolver)
- No GPU in prod (inference-model service was removed from prod compose per recent commits)
- Base image: `oven/bun:1-alpine`
- Apps built with: `bun build src/index.ts --outdir dist --target node`
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- `kebab-case` for all source files: `reddit-api-client.ts`, `tracing-decorator.ts`, `make-event.ts`
- `index.ts` is the public barrel file for every module
- Model files named after their domain entity in kebab-case: `watch-list.ts`, `inference-log.ts`
- `camelCase` for all functions
- Factory functions use a `make` prefix: `makeConsumer`, `makeProducer`, `makeLogger`, `makeDBClient`, `makeGraphClient`, `makeTracer`, `makeId`
- Constructor-like helpers also use `make`: `makeEvent`, `makeModelCreatedEvent`, `makeMessageMetadata`
- Standalone utility functions use descriptive verbs: `connectToBroker`, `safeClose`, `calculateBackoffDelay`, `parseGraphStats`
- `camelCase` for all local variables and parameters
- `SCREAMING_SNAKE_CASE` for environment variable keys in schemas (e.g., `NODE_ENV`, `TRACE_EXPORTER_URLS`)
- `PascalCase` for all interfaces and types: `EventHandler`, `MakeEventsConsumerOpts`, `MessageMetadata`
- Options interfaces follow the pattern `Make[Name]Opts`: `MakeEventsConsumerOpts`, `MakeDBClientOpts`, `MakeGraphClientOpts`
- Return types derived via `ReturnType<typeof make...>`: `export type Consumer = ReturnType<typeof makeConsumer>`
- Inferred types from Zod schemas via `Z.infer<typeof schema>`: `export type Ticker = Z.infer<typeof selectTickerSchema>`
- Table variable names in `camelCase` plural: `watchLists`, `tickers`, `inferenceLogs`
- Column names in `snake_case` (enforced by drizzle `casing: 'snake_case'`)
## Code Style
- Indent: 2 spaces
- Line width: 90 characters
- Quote style: single quotes
- Trailing commas: always
- Semicolons: always
- `noExplicitAny`: off (any usage is permitted)
- `noNonNullAssertion`: off (non-null assertions `!` are allowed)
- `noUnusedImports`: warn
- `noUnusedVariables`: warn
- `useNodejsImportProtocol`: off
- Strict mode enabled globally (`/Users/shayg/Workspace/acovado.club/config/tsconfig/tsconfig.base.json`)
- `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` all enabled
- `verbatimModuleSyntax`: false — `import type` is used manually for type-only imports as a convention
## Import Organization
- Each package uses `@/*` → `./src/*` within its own tsconfig
- Cross-package imports use workspace names: `@modules/logger`, `@modules/tracing`, `@modules/events`, `@modules/db`, etc.
- Use `import type` for type-only imports consistently: `import type { Logger } from '@modules/logger'`
- Value imports and type imports may be separated into two `import` statements from the same source
## Error Handling
- Functions that connect to external services use try/catch and rethrow after logging: `connectToBroker` in `modules/events/src/utils.ts`
- Long-running operations wrap errors in tracer spans which automatically record exceptions via `span.recordException(error)` in `modules/tracing/src/tracer.ts`
- Consumer message handlers: `channel.nack(msg, false, true)` on error and log with `boundLogger.error(error, 'Error processing message')`
- Failing gracefully with `safeClose` — wraps close calls in try/catch, logs errors but does not rethrow
- Non-null assertions (`!`) are used where type narrowing is already validated at runtime
- Error objects are always passed as the first argument to pino logger: `logger.error({ error }, 'message')` or `logger.error(error, 'message')`
## Logging
- `debug` for query execution, message processing details, retry attempts
- `info` for connection events, lifecycle events (connected, channel created, message sent)
- `error` for failures (connection errors, processing errors)
- `warn` for unexpected-but-recoverable situations (callback not found for response)
## Comments
- Block comments for overloaded function signatures and non-obvious implementation choices
- Inline `//` comments for step explanations in complex logic (e.g., span linking in `tracing-decorator.ts`)
- JSDoc-style `/** */` comments on exported types and interface fields that need clarification: `/** Flush and shutdown OTLP trace and log providers (call on process exit). */`
## Function Design
- Clients and services are returned as plain objects (not classes): `return { connect, send, disconnect }`
- Type aliases capture the return type: `export type Producer = ReturnType<typeof makeProducer>`
## Module Design
## Environment Configuration
## Commit Convention
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Bun-native runtime across all services; no Node.js process manager
- Shared modules are consumed as TypeScript source via workspace protocol — no pre-compilation required at import time
- Services communicate asynchronously through RabbitMQ topic exchanges (AMQP); each domain owns an exchange named `{domain}.exchange`
- OpenTelemetry distributed tracing propagated across process and message boundaries using W3C TraceContext + Baggage headers
- All external I/O clients (`db`, `graph-db`, `events`, `inference`) follow the factory-function pattern: `make{Client}(opts)` returns a typed object with `connect / disconnect` lifecycle methods
## Layers
- Purpose: Runnable Bun HTTP servers or long-running workers
- Location: `apps/`
- Contains: Entry point `src/index.ts`, `src/env.ts` (Zod-validated env), route handlers
- Depends on: `@modules/*`, `@clients/*`
- Used by: Docker Compose deployment, Drone CI
- Purpose: Reusable infrastructure building blocks shared across all apps
- Location: `modules/`
- Contains: Factory functions, typed clients, schema definitions
- Depends on: Other modules (e.g., `@modules/tracing`, `@modules/logger`, `@modules/types`)
- Used by: Apps, clients, tests
- Purpose: Lightweight adapters that configure or wrap modules for specific use cases
- Location: `clients/`
- Contains: Drizzle Studio configs, environment bridges
- Depends on: `@modules/db`
- Used by: Developer tooling (e.g., `clients/nano` runs Drizzle Studio)
- Purpose: Docker Compose definitions for stateful services
- Location: `infra/`
- Contains: Per-service `docker-compose.yaml` files for PostgreSQL, RabbitMQ, FalkorDB, observability stack
- Depends on: Nothing in source code
- Used by: `config/compose/` which stitches them together
- Purpose: Shared build and deployment configuration
- Location: `config/`
- Contains: `config/tsconfig/` (shared tsconfig bases), `config/compose/` (top-level Docker Compose merge files), `config/deploy/` (VPS deploy scripts)
- Depends on: Nothing
- Used by: All workspaces extend `@config/tsconfig`
- Purpose: Integration and simulation test suites
- Location: `tests/`
- Contains: E2E health tests (`tests/e2e/`), stock event simulation CLI (`tests/stock-events-simulation/`)
- Depends on: `@modules/*`
- Used by: Developers, CI
## Data Flow
- No in-process global state; all stateful resources (DB connection, AMQP connection) are held in module-level closure variables returned by factory functions
- Environment is parsed once at startup via Zod schemas in `src/env.ts`
## Key Abstractions
- Purpose: Wraps OpenTelemetry spans with a context object providing `log`, `annotate`, and nested `with` capabilities
- Examples: `modules/tracing/src/tracer.ts`, `modules/tracing/src/types.ts`
- Pattern: `tracer.with(spanName, async (ctx) => { ctx.log.info(...); ctx.annotate(key, value); })`
- Purpose: Drizzle ORM client scoped to the `acovado` Postgres schema, with query tracing baked in
- Examples: `modules/db/src/client.ts`, `modules/db/src/schema.ts`
- Pattern: `makeDBClient({ url, tracer })` returns a fully typed Drizzle client
- Purpose: FalkorDB (graph DB) client that wraps Redis GRAPH.QUERY commands with a Cypher API
- Examples: `modules/graph-db/src/client.ts`
- Pattern: `client.selectGraph('graphName').mergeNode(label, matchProps, setProps)`
- Purpose: AMQP topic-exchange messaging with optional tracing propagation
- Examples: `modules/events/src/producer.ts`, `modules/events/src/consumer.ts`
- Pattern: Factory functions `makeProducer({broker, logger, tracing})` / `makeConsumer({broker, logger, handlers, tracing})`
- Purpose: Typed lifecycle events (`ModelCreatedEvent`, `ModelUpdatedEvent`, `ModelDeletedEvent`) with resource + stage encoded in `type` field
- Examples: `modules/events/src/types.ts`, `modules/events/src/make-event.ts`
- Pattern: `makeModelCreatedEvent('ticker', tickerRecord)` produces `{ type: 'ticker.created', ... }`
- Purpose: Adapter that invokes any LLM-callable with retry, tracing, and automatic DB logging
- Examples: `modules/inference/src/client.ts`
- Pattern: `inferenceClient.invoke({ name, model, callable: () => llmSdk.call(...), retry: { maxAttempts: 3 } })`
- Purpose: Drizzle-Zod derived types and parse/validate helpers per entity
- Examples: `modules/db/src/models/ticker.ts`, `modules/db/src/models/reddit-thread.ts`
- Pattern: `makeTicker(data)` validates and returns typed insert-ready object; `Ticker` type exported for use throughout
## Entry Points
- Location: `apps/{service}/src/index.ts`
- Triggers: `bun run src/index.ts` (dev) or `CMD ["bun", "run", "src/index.ts"]` (Docker)
- Responsibilities: Parse env, construct logger + tracer + infra clients, start Bun HTTP server, register `SIGTERM`/`SIGINT` shutdown handlers
- Location: `modules/db/src/migrate.ts`
- Triggers: `bun src/migrate.ts` (manual or CI step)
- Responsibilities: Runs Drizzle Kit migrations against PostgreSQL
- Location: `tests/stock-events-simulation/src/index.ts`
- Triggers: `bun run src/index.ts [options]`
- Responsibilities: CLI wrapper using Commander that runs configurable stock event simulations against live infrastructure
## Error Handling
- AMQP consumer: catches per-message errors, calls `channel.nack(msg, false, true)` to requeue; logs error via bound logger
- InferenceClient: retry loop with exponential backoff + jitter; always writes a `status: 'error'` row to `inference_logs` before throwing
- HTTP handlers: unhandled errors bubble to Bun's default 500 response (no global error middleware in example app)
- Graceful shutdown: `SIGTERM`/`SIGINT` handlers call `server.stop()`, `tracer.shutdown()`, then `process.exit(0)`
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| playwright-cli | Automate browser interactions, test web pages and work with Playwright tests. | `.claude/skills/playwright-cli/SKILL.md` |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
