# Architecture

**Analysis Date:** 2026-04-11

## Pattern Overview

**Overall:** Event-driven microservices monorepo

**Key Characteristics:**
- Bun-native runtime across all services; no Node.js process manager
- Shared modules are consumed as TypeScript source via workspace protocol — no pre-compilation required at import time
- Services communicate asynchronously through RabbitMQ topic exchanges (AMQP); each domain owns an exchange named `{domain}.exchange`
- OpenTelemetry distributed tracing propagated across process and message boundaries using W3C TraceContext + Baggage headers
- All external I/O clients (`db`, `graph-db`, `events`, `inference`) follow the factory-function pattern: `make{Client}(opts)` returns a typed object with `connect / disconnect` lifecycle methods

## Layers

**Apps (services):**
- Purpose: Runnable Bun HTTP servers or long-running workers
- Location: `apps/`
- Contains: Entry point `src/index.ts`, `src/env.ts` (Zod-validated env), route handlers
- Depends on: `@modules/*`, `@clients/*`
- Used by: Docker Compose deployment, Drone CI

**Modules (shared libraries):**
- Purpose: Reusable infrastructure building blocks shared across all apps
- Location: `modules/`
- Contains: Factory functions, typed clients, schema definitions
- Depends on: Other modules (e.g., `@modules/tracing`, `@modules/logger`, `@modules/types`)
- Used by: Apps, clients, tests

**Clients (thin integration adapters):**
- Purpose: Lightweight adapters that configure or wrap modules for specific use cases
- Location: `clients/`
- Contains: Drizzle Studio configs, environment bridges
- Depends on: `@modules/db`
- Used by: Developer tooling (e.g., `clients/nano` runs Drizzle Studio)

**Infrastructure (infra):**
- Purpose: Docker Compose definitions for stateful services
- Location: `infra/`
- Contains: Per-service `docker-compose.yaml` files for PostgreSQL, RabbitMQ, FalkorDB, observability stack
- Depends on: Nothing in source code
- Used by: `config/compose/` which stitches them together

**Config:**
- Purpose: Shared build and deployment configuration
- Location: `config/`
- Contains: `config/tsconfig/` (shared tsconfig bases), `config/compose/` (top-level Docker Compose merge files), `config/deploy/` (VPS deploy scripts)
- Depends on: Nothing
- Used by: All workspaces extend `@config/tsconfig`

**Tests:**
- Purpose: Integration and simulation test suites
- Location: `tests/`
- Contains: E2E health tests (`tests/e2e/`), stock event simulation CLI (`tests/stock-events-simulation/`)
- Depends on: `@modules/*`
- Used by: Developers, CI

## Data Flow

**HTTP Request (app service):**
1. Bun HTTP server in `apps/{service}/src/index.ts` receives request
2. Route handler calls `tracer.with(spanName, async (ctx) => { ... })` to open a trace span
3. Business logic executes — reads from DB via `@modules/db` `DBClient`, or publishes events via `@modules/events` `Producer`
4. Response returned; span closes automatically on `return` or `throw`

**Event-driven message flow (producer → consumer):**
1. Producing app calls `producer.send(domain, routingKey, event)` — publishes to `{domain}.exchange` topic exchange
2. RabbitMQ routes message to bound queues based on routing key pattern
3. Consuming app's `consumer.connect()` subscribes handlers; each `EventHandler.onMessage(message, ctx)` is called with parsed message and injected trace context
4. On success: `channel.ack(msg)`; on failure: `channel.nack(msg, false, true)` (requeue)

**Reddit API request/response (queue-based RPC):**
1. Caller uses `RedditApiQueueClient.publishRequest(request)` to publish `reddit.api-call.requested` events
2. A worker service consumes that event, calls the Reddit API, then publishes either `reddit.api-call.*.succeeded` or `reddit.api-call.*.failed`
3. `RedditApiQueueClient` listens on `reddit:api-call-responses` queue and resolves a callback keyed by `requestId`

**Inference flow:**
1. App constructs `InferenceRequest<T>` with a `callable` function wrapping the LLM SDK call
2. `inferenceClient.invoke(request)` executes `callable()` with retry/backoff logic
3. Result (success or error) is persisted to `acovado.inference_logs` table via `@modules/db`
4. Grading is performed separately and logged to `acovado.grading_logs`

**State Management:**
- No in-process global state; all stateful resources (DB connection, AMQP connection) are held in module-level closure variables returned by factory functions
- Environment is parsed once at startup via Zod schemas in `src/env.ts`

## Key Abstractions

**Tracer:**
- Purpose: Wraps OpenTelemetry spans with a context object providing `log`, `annotate`, and nested `with` capabilities
- Examples: `modules/tracing/src/tracer.ts`, `modules/tracing/src/types.ts`
- Pattern: `tracer.with(spanName, async (ctx) => { ctx.log.info(...); ctx.annotate(key, value); })`

**DBClient (`BunSQLDatabase<Schema>`):**
- Purpose: Drizzle ORM client scoped to the `acovado` Postgres schema, with query tracing baked in
- Examples: `modules/db/src/client.ts`, `modules/db/src/schema.ts`
- Pattern: `makeDBClient({ url, tracer })` returns a fully typed Drizzle client

**GraphClient:**
- Purpose: FalkorDB (graph DB) client that wraps Redis GRAPH.QUERY commands with a Cypher API
- Examples: `modules/graph-db/src/client.ts`
- Pattern: `client.selectGraph('graphName').mergeNode(label, matchProps, setProps)`

**Producer / Consumer:**
- Purpose: AMQP topic-exchange messaging with optional tracing propagation
- Examples: `modules/events/src/producer.ts`, `modules/events/src/consumer.ts`
- Pattern: Factory functions `makeProducer({broker, logger, tracing})` / `makeConsumer({broker, logger, handlers, tracing})`

**Event Payload Types:**
- Purpose: Typed lifecycle events (`ModelCreatedEvent`, `ModelUpdatedEvent`, `ModelDeletedEvent`) with resource + stage encoded in `type` field
- Examples: `modules/events/src/types.ts`, `modules/events/src/make-event.ts`
- Pattern: `makeModelCreatedEvent('ticker', tickerRecord)` produces `{ type: 'ticker.created', ... }`

**InferenceClient:**
- Purpose: Adapter that invokes any LLM-callable with retry, tracing, and automatic DB logging
- Examples: `modules/inference/src/client.ts`
- Pattern: `inferenceClient.invoke({ name, model, callable: () => llmSdk.call(...), retry: { maxAttempts: 3 } })`

**Model factories (db/models):**
- Purpose: Drizzle-Zod derived types and parse/validate helpers per entity
- Examples: `modules/db/src/models/ticker.ts`, `modules/db/src/models/reddit-thread.ts`
- Pattern: `makeTicker(data)` validates and returns typed insert-ready object; `Ticker` type exported for use throughout

## Entry Points

**App service entry point:**
- Location: `apps/{service}/src/index.ts`
- Triggers: `bun run src/index.ts` (dev) or `CMD ["bun", "run", "src/index.ts"]` (Docker)
- Responsibilities: Parse env, construct logger + tracer + infra clients, start Bun HTTP server, register `SIGTERM`/`SIGINT` shutdown handlers

**DB migration:**
- Location: `modules/db/src/migrate.ts`
- Triggers: `bun src/migrate.ts` (manual or CI step)
- Responsibilities: Runs Drizzle Kit migrations against PostgreSQL

**Stock events simulation CLI:**
- Location: `tests/stock-events-simulation/src/index.ts`
- Triggers: `bun run src/index.ts [options]`
- Responsibilities: CLI wrapper using Commander that runs configurable stock event simulations against live infrastructure

## Error Handling

**Strategy:** Propagate errors up to the outermost trace span, which records the exception and sets span status to `ERROR` before re-throwing.

**Patterns:**
- AMQP consumer: catches per-message errors, calls `channel.nack(msg, false, true)` to requeue; logs error via bound logger
- InferenceClient: retry loop with exponential backoff + jitter; always writes a `status: 'error'` row to `inference_logs` before throwing
- HTTP handlers: unhandled errors bubble to Bun's default 500 response (no global error middleware in example app)
- Graceful shutdown: `SIGTERM`/`SIGINT` handlers call `server.stop()`, `tracer.shutdown()`, then `process.exit(0)`

## Cross-Cutting Concerns

**Logging:** Pino via `@modules/logger`; `makeLogger({ name })` returns a Pino instance. Pretty-print in non-production. Inside trace spans, logging goes through `ctx.log` (a `TracingLogger` that attaches span IDs to every log entry and optionally exports via OTLP).

**Validation:** Zod everywhere — env vars (`src/env.ts` per app), DB model insert/select schemas (`drizzle-zod`), event payload types. Parse at the boundary; internals use inferred TypeScript types.

**Authentication:** No application-level auth visible in current apps. Infrastructure services (RabbitMQ, Postgres, FalkorDB) use connection-string credentials.

**Tracing:** OpenTelemetry SDK (`@modules/tracing`). Traces exported via OTLP HTTP to SigNoz collector. W3C TraceContext + Baggage propagators active. Trace context is injected into AMQP message headers by the tracing decorator (`modules/events/src/tracing-decorator.ts`) and extracted by consumers.

---

*Architecture analysis: 2026-04-11*
