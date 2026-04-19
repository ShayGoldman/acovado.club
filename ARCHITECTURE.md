# Architecture

**acovado.club** is a distributed financial signal-tracking monorepo. It ingests social data (Reddit first), groups signals by ticker, and surfaces trends for an internal team. AI agents orchestrated by Paperclip drive data collection, processing, and analysis.

---

## System Overview

```
Reddit
    │  HTTP
    ▼
[Reddit Worker App]  ──AMQP──▶  [Signal Processor App]  ──▶  PostgreSQL
                                          │                 ──▶  FalkorDB (graph)
                                          ▼
                               [Inference / Analysis App]
                                          │
                                          ▼
                                   Internal consumers
```

All apps are Bun processes (HTTP servers or long-running workers) deployed as Docker containers. They communicate asynchronously over RabbitMQ topic exchanges. OpenTelemetry traces flow to SigNoz via the OTLP collector.

> **Note**: Production apps today are `apps/reddit-worker`, `apps/youtube-worker`, `apps/signal-processor`, and `apps/dashboard`. Additional sources and the inference worker are tracked as future work.

---

## Monorepo Layout

```
acovado.club/
├── apps/          # Runnable services
├── modules/       # Shared infrastructure building blocks
├── clients/       # Developer tooling adapters
├── infra/         # Docker Compose definitions for stateful services
├── config/        # Shared build + deployment configuration
└── tests/         # E2E and simulation test suites
```

### Layer Responsibilities

| Layer | Location | Depends On | Used By |
|-------|----------|-----------|---------|
| **Apps** | `apps/` | `@modules/*` | Docker Compose, Drone CI |
| **Modules** | `modules/` | Other modules | Apps, clients, tests |
| **Clients** | `clients/` | `@modules/db` | Developer tooling |
| **Infrastructure** | `infra/` | Nothing (Docker only) | `config/compose/` |
| **Config** | `config/` | Nothing | All workspaces |
| **Tests** | `tests/` | `@modules/*` | Developers, CI |

---

## Apps

Each app follows the same structure — Zod-validated env (`src/env.ts`), a single entry point (`src/index.ts`) that wires a logger, tracer, and any required clients, and `SIGTERM`/`SIGINT` shutdown handlers.

- **`apps/reddit-worker`** — cron-driven poller. Fetches new Reddit posts for seeded sources and publishes `content-item.created` events to RabbitMQ.
- **`apps/youtube-worker`** — cron-driven poller. Fetches new videos from YouTube RSS feeds and publishes `content-item.created` events to RabbitMQ.
- **`apps/signal-processor`** — event consumer. Reads `content-item.created` events, runs ticker extraction via `@modules/ticker-extractor`, writes `mentions` rows.
- **`apps/dashboard`** — internal HTTP service. Exposes `GET /health`, `GET /api/trending?window=24h|7d`, and `GET /` (SSR HTML trending view).

**Adding a new app**: create `apps/<name>/` mirroring an existing app's layout (`src/index.ts`, `src/env.ts`, `package.json`, `tsconfig.json`), add a service in `config/compose/docker-compose.apps.yaml`, and add a `build-<name>` step in `.drone.yml`.

---

## Modules

All modules follow the same factory-function pattern:

```typescript
// Factory — preferred construction method
export function makeClient(opts: MakeClientOpts): Client { ... }

// Return type exported as type alias
export type Client = ReturnType<typeof makeClient>;
```

Every client has explicit `connect()` / `disconnect()` lifecycle methods. Resources (DB pools, AMQP channels, OTel providers) are held in closure variables — no module-level singletons.

---

### `@modules/logger`

Pino-based structured JSON logging.

```typescript
const logger = makeLogger({ name: 'my-service', level: 'info' });
logger.info('started');
logger.error(error, 'failed to connect');
```

Log levels:
- `debug` — query execution, message processing, retry attempts
- `info` — connection events, lifecycle events
- `warn` — unexpected-but-recoverable situations
- `error` — failures (always pass the `Error` object as first arg)

Automatically enables pretty-printing when `NODE_ENV !== 'production'`.

**Env vars**: none (configured via `LoggerOpts`).

---

### `@modules/tracing`

OpenTelemetry distributed tracing with OTLP HTTP export and W3C propagation.

```typescript
const tracer = makeTracer({ serviceName: 'my-service', exporterUrls: [...] });

await tracer.with('process-ticker', async (ctx) => {
  ctx.annotate('ticker.symbol', 'AAPL');
  ctx.log.info('processing');
  await ctx.with('fetch-data', async (inner) => { ... }); // nested span
});

await tracer.shutdown(); // flush on process exit
```

Trace context propagates across AMQP messages via W3C `traceparent`/`tracestate` headers injected by the producer and extracted by the consumer.

**Env vars**: none (configured via `TracerOptions`).

---

### `@modules/db`

Drizzle ORM client scoped to the `acovado` PostgreSQL schema, with query-level tracing.

```typescript
const db = makeDBClient({ url: env.DATABASE_URL, tracer });
await db.connect();

const rows = await db.client.select().from(schema.myTable);
```

- **Schema**: `src/schema.ts` — declares the `acovado` pgSchema. Currently empty (`schema = {}`); tables are added as features are built.
- **Migrations**: `bun src/migrate.ts` — runs Drizzle Kit migrations against PostgreSQL.
- **Column naming**: `snake_case` (enforced via Drizzle `casing: 'snake_case'`).

**Env vars** (from `src/env.ts`):
- `DATABASE_URL` — PostgreSQL connection URL (required)
- `RESET_DB` — if truthy, resets the DB on init (default: `false`)

---

### `@modules/events`

RabbitMQ AMQP client using topic exchanges for async messaging.

```typescript
// Producer
const producer = makeProducer({ broker: env.RABBITMQ_URL, logger, tracing });
await producer.connect();
await producer.send('ticker', 'ticker.created', [payload]);

// Consumer
const consumer = makeConsumer({
  broker: env.RABBITMQ_URL,
  logger,
  tracing,
  handlers: [{
    domain: 'ticker',
    queue: 'my-service-ticker-created',
    routingKey: 'ticker.created',
    onMessage: async (msg, ctx) => { ... },
  }],
});
await consumer.connect();
```

Each domain owns an exchange named `{domain}.exchange`. On consumer error the message is `nack`'d with requeue.

**Env vars**: none (broker URL passed via config).

---

### `@modules/graph-db`

FalkorDB client using the Redis protocol for Cypher graph queries.

```typescript
const client = makeGraphClient({ url: env.FALKORDB_URL, logger });
await client.connect();

await client
  .selectGraph('signals')
  .mergeNode('Ticker', { symbol: 'AAPL' }, { updatedAt: new Date() });
```

**Env vars**: none (URL passed via config).

---

### `@modules/inference`

LLM inference adapter with retry, lifecycle hooks, tracing, and automatic DB logging.

```typescript
const inference = makeInferenceClient({ db, tracer, logger });

const result = await inference.invoke({
  name: 'classify-signal',
  model: 'llama3',
  callable: () => ollama.generate({ model: 'llama3', prompt }),
  retry: { maxAttempts: 3 },
});
```

Every invocation writes a row to an `inference_logs` table (once the DB schema defines it) with `status: 'success'` or `'error'`. Retry uses exponential backoff with jitter.

**Env vars**: none (configured via factory opts).

---

### `@modules/reddit-client`

Two clients in one module:

1. **`makeRedditClient`** — HTTP client for the public Reddit JSON API. Fetches subreddit threads, thread replies, and subreddit metadata.
2. **`makeRedditApiQueueClient`** — AMQP RPC client that wraps Reddit API calls in a request/response queue pattern (for use by distributed workers that need to delegate API calls).

```typescript
// HTTP client
const reddit = makeRedditClient({ logger });
const threads = await reddit.fetchSubredditThreads('wallstreetbets', 25);
const replies = await reddit.fetchThreadReplies(thread.id, 'wallstreetbets');
const about   = await reddit.fetchSubredditAbout('wallstreetbets');
```

**Env vars**: none (configured via factory opts).

---

### `@modules/ids`

Nanoid-based ID generation with typed prefixes.

```typescript
const id    = makeId({ prefix: 'ticker' }); // "ticker_abc123..."
const msgId = makeMessageId();               // "msg_..."
```

**Env vars**: none.

---

### `@modules/types`

Shared TypeScript utility types. Thin re-export of `type-fest` plus project-specific primitives (`Identified<T>`, etc.). No runtime code — import with `import type` only.

**Env vars**: none.

---

## Clients

### `@clients/nano`

Drizzle Studio browser UI for inspecting and querying the PostgreSQL database. Reads `DATABASE_URL` from `clients/nano/.env`.

```bash
cd clients/nano && bun run dev   # launches Drizzle Studio
```

---

## Data Flow

### Startup Sequence (per app)

1. Parse and validate env vars (Zod schemas in `src/env.ts`)
2. Construct `logger` and `tracer`
3. Construct infrastructure clients (`db`, `events`, `graph-db`, etc.)
4. Call `client.connect()` on each
5. Start `Bun.serve` HTTP server
6. Register `SIGTERM`/`SIGINT` handlers → `server.stop()`, `tracer.shutdown()`, `process.exit(0)`

### No Global State

No module uses process-level singletons. All state (DB connection pools, AMQP channels, OTel providers) is scoped to the closure returned by each `make*` factory.

---

## Infrastructure Services

Each service has a `infra/<name>/docker-compose.yaml` base config extended by the production compose files in `config/compose/`.

| Service | Role | Default Ports | Local Start |
|---------|------|--------------|-------------|
| **PostgreSQL 15** | Relational data store | 5432 | `cd infra/postgres && bun run start` |
| **RabbitMQ** | Async message broker (AMQP) | 5672, 15672 (UI) | `cd infra/rabbitmq && bun run start` |
| **FalkorDB** | Graph database (Redis protocol) | 6379, 3000 (UI) | `cd infra/falkordb && bun run start` |
| **SigNoz** | Observability: traces, metrics, logs | 8080 (UI), 4317/4318 (OTLP) | `cd infra/observability && docker compose up -d` |
| **Ollama** | Local LLM (optional, dev only) | 11434 | `cd infra/inference-model && docker compose up -d` |

Production additionally runs Traefik (reverse proxy + TLS) and Portainer (`stats.acovado.club`), managed outside this repo.

---

## Build & Deployment

### Development

Modules are consumed as TypeScript sources at runtime — Bun resolves workspace imports JIT. No pre-compilation step is needed.

```bash
cd apps/dashboard && bun run dev   # starts with --watch --inspect
```

### Production (Docker)

The `Dockerfile` uses three stages:

1. **`dependencies`**: `bun install --frozen-lockfile --ignore-scripts` — installs all packages into the monorepo.
2. **`app-builder`**: `bun run build` inside `apps/<APP_PATH>/` — bundles the entry point and all imported workspace modules into a single `dist/index.js`.
3. **`production`**: Copies only `dist/` and root `node_modules` into the final image. Runs `bun dist/index.js`.

Production images run the **pre-bundled** output — not JIT TypeScript. This is different from the development workflow.

```bash
# Build an app image (example: dashboard)
docker build --target production --build-arg APP_PATH=dashboard -t dashboard:latest .
```

---

## Toolchain

| Tool | Role |
|------|------|
| **Bun 1.1.36** | Runtime, package manager, test runner, bundler |
| **Turborepo 2.6.3** | Monorepo task orchestration (`turbo.json`) |
| **Biome 1.9.4** | Linting + formatting |
| **Drizzle Kit** | Migration generation, Drizzle Studio |
| **Husky + lint-staged** | Pre-commit Biome checks |
| **Commitizen + Commitlint** | Conventional commit enforcement |
| **Changesets** | Changelog management (private packages — docs only) |
| **Drone CI** | CI/CD pipeline (build → push → deploy) |

---

## CI/CD Pipeline (`.drone.yml`)

Triggers on push to `main` when commit is a PR merge commit (or has `[trigger-main-deploy]` in message).

| Step | What it does |
|------|-------------|
| `validate-merge-commit` | Guards against non-merge pushes |
| `pre-build` | Log placeholder |
| `build-<app>` (parallel: signal-processor, youtube-worker, reddit-worker, dashboard) | `bun build` → push to `docker-registry.acovado.club/<app>:${SHA}` |
| `post-build` | Log confirmation |
| `release-versions` | *(commented out — pending GitHub auth fix)* Changeset versioning |
| `deploy` | `docker compose up` for infra + apps stacks on the VPS |
| `cleanup` | Remove unused Docker images |

---

## Cross-Cutting Concerns

### Observability

Every app initializes a tracer and passes it to all infrastructure clients. Trace context propagates:

- **In-process**: via `ctx` objects threaded through `tracer.with()` call chains
- **Across AMQP messages**: via W3C `traceparent`/`tracestate` headers injected by the producer and extracted by the consumer

### Error Handling

| Boundary | Strategy |
|----------|----------|
| AMQP consumer | `nack` + requeue; log with bound logger |
| Inference client | Retry with backoff + jitter; write `status: 'error'` row before rethrowing |
| External service connect | `try/catch`, log, rethrow |
| HTTP handlers | Unhandled errors bubble to Bun's default 500 response |
| Process shutdown | `safeClose` wrappers (catch + log, no rethrow) |

### Environment Configuration

Each module validates its own env slice at startup using Zod schemas in `src/env.ts`. No central config object — each factory receives only what it needs.

---

## Adding a New Service

1. Create `apps/<name>/` mirroring an existing app's layout (`src/index.ts`, `src/env.ts`, `package.json`, `tsconfig.json`).
2. Wire in `@modules/logger` and `@modules/tracing`; add any other needed modules.
3. Add a `Dockerfile` build stage (`--build-arg APP_PATH=<name>`).
4. Add a service in `config/compose/docker-compose.apps.yaml`.
5. Add a build step in `.drone.yml`.
6. Add `/srv/env/<name>.env` on the VPS.

## Adding a New Module

1. Create `modules/<name>/` with `src/index.ts`, `src/env.ts` (if needed), `package.json`, `tsconfig.json`.
2. Export a `make<Name>(opts)` factory and `export type <Name> = ReturnType<typeof make<Name>>`.
3. Validate env in `src/env.ts` using Zod if the module needs environment variables.
