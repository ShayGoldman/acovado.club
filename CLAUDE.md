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
- TypeScript 5.7+ — all application and module code
- YAML — Docker Compose infrastructure definitions
- Shell (sh/bash) — Docker entrypoint scripts and infra init scripts

## Runtime
- **Bun 1.1.36** — primary runtime for all TypeScript packages
  - Dev mode: modules executed as TypeScript sources directly (JIT, no transpile step)
  - Production mode: apps are bundled with `bun build` into `dist/index.js`; the production Docker image runs `bun dist/index.js`
  - Lockfile: `bun.lockb` (binary format)

## Frameworks
- **Bun.serve** (built-in) — HTTP server in app entry points; no web framework (Hono, Express, etc.)
- **Drizzle ORM ^0.45.1** — PostgreSQL access via `drizzle-orm/bun-sql` driver. Schema defined in `modules/db/src/schema.ts`. Migrations via `drizzle-kit ^0.28.1`.
- **Zod ^4.x** — env validation and schema parsing across all modules
- **Turborepo ^2.6.3** — monorepo task orchestration (`turbo.json`)
- **Bun test** (built-in) — test runner; no separate Jest/Vitest

## Key Dependencies
- `drizzle-orm` ^0.45.1 — primary data access layer (`modules/db`)
- `amqplib` ^0.10.5 — RabbitMQ AMQP client (`modules/events`, `modules/reddit-client`)
- `redis` ^4.7.0 — FalkorDB transport via Redis protocol (`modules/graph-db`)
- `pino` ^9.5.0 + `pino-pretty` ^13.0.0 — structured JSON logging (`modules/logger`)
- `@opentelemetry/*` — full OTel SDK for distributed tracing and log export (`modules/tracing`)
- `nanoid` ^5.0.9 — ID generation (`modules/ids`)
- `zod` ^4.x — env and schema validation across all modules
- `drizzle-kit` ^0.28.1 — migration generation and Drizzle Studio (`clients/nano`)
- `bluebird` ^3.7.2 — promise utilities (`modules/db`)
- `type-fest` ^4.x — TypeScript utility types (`modules/types`)
- `turbo` ^2.6.3 — build pipeline orchestrator
- `husky` ^9.1.7 — git hooks
- `lint-staged` ^15.5.2 — pre-commit linting
- `commitizen` + `cz-conventional-changelog` — conventional commit tooling
- `@changesets/cli` ^2.29.8 — changelog management

## Configuration
- Env vars validated at startup using Zod schemas in each module's `src/env.ts`
- Production env files: loaded via Docker `env_file` pointing to `${ENV_FILES_ROOT}/*.env`
- `turbo.json` — task graph; build outputs to `dist/`; inputs include `.env*` files
- `tsconfig.json` per package extends `@config/tsconfig/node20.json` (ESNext modules, bundler resolution, strict)
- Base tsconfig: `config/tsconfig/tsconfig.base.json` — strict, isolatedModules, noUncheckedIndexedAccess, exactOptionalPropertyTypes
- Biome config: `biome.json` — 2-space indent, 90-char line width, single quotes, trailing commas, semicolons always
- Husky hooks: `pre-commit` (lint-staged), `commit-msg` (commitlint)
- Commitlint: conventional config (`@commitlint/config-conventional`)

## Platform Requirements
- Bun 1.1.36 (local development)
- Docker + Docker Compose (for local infra: Postgres, RabbitMQ, FalkorDB, observability)
- Docker (container-based deployment via `config/compose/docker-compose.apps.yaml` + `docker-compose.infra.yaml`)
- Traefik reverse proxy (labels on services, TLS via Let's Encrypt `acovado` certresolver)
- Base Docker image: `oven/bun:1-alpine`
- Production CMD: `bun run dist/index.js` (pre-bundled output)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- `kebab-case` for all source files: `reddit-api-client.ts`, `make-event.ts`
- `index.ts` is the public barrel file for every module
- `camelCase` for all functions and local variables
- Factory functions use a `make` prefix: `makeConsumer`, `makeProducer`, `makeLogger`, `makeDBClient`, `makeGraphClient`, `makeTracer`, `makeId`
- `SCREAMING_SNAKE_CASE` for environment variable keys (`NODE_ENV`, `TRACE_EXPORTER_URLS`)
- `PascalCase` for all interfaces and types: `EventHandler`, `MakeEventsConsumerOpts`
- Options interfaces follow `Make[Name]Opts`: `MakeEventsConsumerOpts`, `MakeDBClientOpts`
- Return types derived via `ReturnType<typeof make...>`: `export type Consumer = ReturnType<typeof makeConsumer>`
- Table variable names in `camelCase` plural; column names in `snake_case` (Drizzle enforced)

## Code Style
- Indent: 2 spaces | Line width: 90 characters | Quotes: single | Trailing commas: always | Semicolons: always
- `noExplicitAny`: off | `noNonNullAssertion`: off | `noUnusedImports`: warn | `noUnusedVariables`: warn
- Strict mode globally enabled

## Import Organization
- Each package uses `@/*` → `./src/*` within its own tsconfig
- Cross-package imports use workspace names: `@modules/logger`, `@modules/tracing`, etc.
- Use `import type` for type-only imports consistently

## Error Handling
- External service connects: `try/catch`, log, rethrow
- AMQP consumers: `channel.nack(msg, false, true)` on error + log
- Inference: retry with backoff + jitter; write `status: 'error'` row before rethrowing
- Graceful shutdown: `SIGTERM`/`SIGINT` handlers → `server.stop()`, `tracer.shutdown()`, `process.exit(0)`
- `safeClose` wrappers for cleanup (catch + log, no rethrow)
- Error objects always first arg to pino: `logger.error(error, 'message')`

## Function Design
- Clients and services returned as plain objects: `return { connect, send, disconnect }`
- Type aliases capture return type: `export type Producer = ReturnType<typeof makeProducer>`
- No class-based clients

## Commit Convention
- Use `bun commit` (commitizen) for interactive conventional commits
- `commit-msg` hook validates via commitlint
- `pre-commit` hook runs lint-staged (Biome on `.ts`/`.js`/`.json` staged files)
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Bun-native runtime across all services
- **Dev**: shared modules consumed as TypeScript source via workspace protocol — no pre-compilation at import time
- **Prod**: apps bundled with `bun build` into `dist/index.js`; Docker image runs the bundle
- Services communicate asynchronously via RabbitMQ topic exchanges; each domain owns `{domain}.exchange`
- OpenTelemetry tracing propagated across process and message boundaries via W3C TraceContext + Baggage headers
- All I/O clients (`db`, `graph-db`, `events`, `inference`) follow the factory pattern: `make{Client}(opts)` returns typed object with `connect / disconnect`

## Layers
- **Apps** (`apps/`) — Bun HTTP servers or long-running workers. Entry point `src/index.ts`, Zod env `src/env.ts`.
- **Modules** (`modules/`) — Reusable infrastructure building blocks. Factory functions, typed clients, schema definitions.
- **Clients** (`clients/`) — Developer tooling adapters (e.g. Drizzle Studio).
- **Infrastructure** (`infra/`) — Docker Compose definitions for stateful services.
- **Config** (`config/`) — Shared tsconfig bases, Docker Compose merge files, deploy scripts.
- **Tests** (`tests/`) — E2E and simulation test suites.

## Apps
- `apps/dashboard` — internal dashboard HTTP API (trending tickers, HTML view).
- `apps/reddit-worker` — Reddit polling cron, publishes content-item events.
- `apps/youtube-worker` — YouTube RSS polling cron, publishes content-item events.
- `apps/signal-processor` — consumes content-item events, extracts tickers, writes mentions.

## Modules Quick Reference

| Module | Factory | Key Env Vars |
|--------|---------|-------------|
| `@modules/logger` | `makeLogger(opts)` | none |
| `@modules/tracing` | `makeTracer(opts)` | none |
| `@modules/db` | `makeDBClient(opts)` | `DATABASE_URL`, `RESET_DB` |
| `@modules/events` | `makeProducer(opts)`, `makeConsumer(opts)` | none |
| `@modules/graph-db` | `makeGraphClient(opts)` | none |
| `@modules/inference` | `makeInferenceClient(opts)` | none |
| `@modules/reddit-client` | `makeRedditClient(opts)`, `makeRedditApiQueueClient(opts)` | none |
| `@modules/ids` | `makeId(opts)`, `makeMessageId()` | none |
| `@modules/types` | (type-only re-exports) | none |

## DB Schema Status
`modules/db/src/schema.ts` declares the `acovado` pgSchema but currently has no tables (`schema = {}`). Tables are added as features are built.

## Key Abstractions
- `tracer.with(spanName, async (ctx) => { ... })` — wraps code in a span; `ctx.log`, `ctx.annotate(key, val)`, `ctx.with(...)` for nesting
- `makeDBClient({ url, tracer })` — Drizzle client scoped to `acovado` schema with query tracing
- `makeGraphClient(opts).selectGraph('name').mergeNode(label, matchProps, setProps)` — Cypher graph operations
- `makeProducer / makeConsumer` — AMQP topic-exchange messaging with tracing propagation
- `inferenceClient.invoke({ name, model, callable, retry })` — LLM calls with retry + DB logging

## Startup Sequence (per app)
1. Parse env (Zod)
2. Construct logger + tracer
3. Construct infra clients, call `connect()`
4. Start `Bun.serve`
5. Register SIGTERM/SIGINT → `server.stop()`, `tracer.shutdown()`, `process.exit(0)`
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
