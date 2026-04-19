# acovado.club

![Build Status](https://ci.acovado.club/api/badges/ShayGoldman/acovado.club/status.svg?ref=refs/heads/main)

A distributed financial signal-tracking system. Ingests social data (Reddit in v1), groups signals by ticker, and surfaces trends for an internal team. AI agents orchestrated by Paperclip handle data collection, processing, and analysis.

# Structure

## Apps

| Name    | Path             | Description                                               |
| ------- | ---------------- | --------------------------------------------------------- |
| example | `./apps/example` | Minimal HTTP service demonstrating logger + tracing usage |

Add new applications under `./apps/<name>` and wire them into `Dockerfile`, `config/compose/docker-compose.apps.yaml`, and `.drone.yml`.

## Modules

| Name          | Path                      | Description                                                         |
| ------------- | ------------------------- | ------------------------------------------------------------------- |
| db            | `./modules/db`            | Drizzle ORM client for PostgreSQL with schema management            |
| events        | `./modules/events`        | RabbitMQ producer/consumer with optional tracing                    |
| ids           | `./modules/ids`           | Nanoid-based ID generation with typed prefixes                      |
| logger        | `./modules/logger`        | Pino-based structured logging                                       |
| tracing       | `./modules/tracing`       | OpenTelemetry tracing + OTLP export                                 |
| types         | `./modules/types`         | Shared TypeScript primitives (type-fest re-export)                  |
| graph-db      | `./modules/graph-db`      | FalkorDB / Redis graph client                                       |
| inference     | `./modules/inference`     | LLM inference client with retry, hooks, and DB logging              |
| reddit-client | `./modules/reddit-client` | Reddit HTTP API client + AMQP queue client for Reddit API workers   |

## Infrastructure

Each infra package has `bun run start` / `stop` / `logs` / `status` scripts wrapping `docker compose`.

| Name            | Path                      | Description                                                                       |
| --------------- | ------------------------- | --------------------------------------------------------------------------------- |
| postgres        | `./infra/postgres`        | PostgreSQL 15 via Docker Compose                                                  |
| rabbitmq        | `./infra/rabbitmq`        | RabbitMQ with management UI (ports 5672, 15672)                                   |
| falkordb        | `./infra/falkordb`        | FalkorDB graph database via Redis protocol (ports 6379, 3000 UI)                 |
| observability   | `./infra/observability`   | SigNoz stack: OTel Collector → ClickHouse. See `infra/observability/README.md`   |

## Config

| Name       | Path               | Description                                                     |
| ---------- | ------------------ | --------------------------------------------------------------- |
| compose    | `./config/compose` | Docker Compose files for prod infra, prod apps, and local dev   |
| tsconfig   | `./config/tsconfig`| Shared tsconfig base (`tsconfig.base.json`)                     |
| typescript | `./config/typescript` | TypeScript peer-dep package                                  |

## Clients

| Name | Path             | Description                                    |
| ---- | ---------------- | ---------------------------------------------- |
| nano | `./clients/nano` | Drizzle Studio client for database inspection  |

## Tests

| Name                    | Path                              | Description                                            |
| ----------------------- | --------------------------------- | ------------------------------------------------------ |
| e2e                     | `./tests/e2e`                     | End-to-end tests (scaffold — real tests pending infra) |
| stock-events-simulation | `./tests/stock-events-simulation` | Stock event simulation CLI (scaffold — not yet implemented) |

## CI/CD

- **Drone** at [ci.acovado.club](https://ci.acovado.club) (badge above): runs on **push to `main`** when the latest commit is a **GitHub merge commit** (see `.drone.yml` step `validate-merge-commit`). Escape hatch: include `[trigger-main-deploy]` in the commit message to trigger on a direct push.
- **Build**: `Dockerfile` uses `bun build` to bundle each app's entry point into `apps/<name>/dist/index.js`. Production image runs `bun dist/index.js` — not JIT TypeScript.
- **Registry**: images pushed to `docker-registry.acovado.club` (e.g. image `example`).
- **Deploy step**: copies `infra/` to `/srv/volumes/deployment`, then runs `docker compose` for `config/compose/docker-compose.infra.yaml` and `config/compose/docker-compose.apps.yaml` using `COMMIT_HASH` / `REGISTRY_URL` / volume paths from the Drone environment.

## Production deployment (overview)

The compose files under `config/compose/` assume:

- Docker **external networks** `internal-network` and `proxy-network` (managed by Traefik).
- **Env files** on the host under `/srv/env/` referenced via compose `env_file` entries.
- **Persistent volumes** under `/srv/volumes/` for Postgres, SigNoz, FalkorDB, etc.
- App env files such as `/srv/env/example.env` (see `config/compose/docker-compose.apps.yaml`).

Do not commit production secrets; keep them only on the server.

## Local Development

1. **Infrastructure** — from each infra directory, start the services you need:
   - `cd infra/postgres && bun run start` (or `docker compose up -d`)
   - `cd infra/rabbitmq && bun run start`
   - `cd infra/falkordb && bun run start`
   - `cd infra/observability && docker compose up -d` (SigNoz — no bun run start script here)
   - **LLM inference (hard dependency):** Ollama must be running locally on `http://localhost:11434` before starting any app that uses `@modules/inference`. The managed Docker service has been removed — install and start Ollama manually (`ollama serve`, then `ollama pull <model>`).
   - Start only what your app actually uses; `apps/example` requires nothing except optionally the OTel collector.
2. Copy `apps/example/.env.example` to `apps/example/.env` and set `TRACE_EXPORTER_URLS`.
3. Run the example app in watch mode:
   - **Via process-compose**: `process-compose -f ./config/compose/local/process-compose.yml up` (requires [process-compose](https://github.com/F1bonacc1/process-compose))
   - **Directly**: `cd apps/example && bun run dev`
4. Run tests (optional): `bunx turbo test --filter="@tests/*"`

### Telemetry

`TRACE_EXPORTER_URLS` is a comma-separated list of OTLP HTTP trace URLs.

- **Local dev** (app on host, SigNoz via Docker): `http://localhost:4318/v1/traces`
- **Production** (app in Docker on `internal-network`): `http://otel-collector:4318/v1/traces`

### Resetting local data

Stop Compose stacks, remove Docker volumes for PostgreSQL / RabbitMQ / FalkorDB, restart infra, then re-run migrations (`bun src/migrate.ts` inside `modules/db`). The `apps/example` app does not use a database.

## Debugging

Run any app with `bun run dev` — it passes `--inspect=localhost:16000/<name>` to Bun. Attach via the VS Code debugger using `.vscode/launch.json` at the repo root.

## Contributing

- Clone the repo and create a feature branch using [Conventional Commits](https://www.conventionalcommits.org/) naming.
- Use `bun commit` (commitizen) for structured commit messages — this is enforced by the `commit-msg` hook.
- Use `bun changeset` to document changelog-worthy changes; changesets are tracked in `CHANGELOG.md`.
- Code quality:
  - `bun check` — lint + format (Biome)
  - `bun lint` — lint only
  - `bun format` — format only
- The `pre-commit` hook runs `lint-staged` (Biome on staged `.ts`/`.js`/`.json` files).
- Submit a PR. Merging to `main` via GitHub PR triggers the Drone CI pipeline and deploys to production.

### Drizzle Studio theme

https://drizzle.studio/themes/elKOzCWRB2NDOTHL8_f8C/edit?token=0ad6fab842e81f61d5f2d2679526e7a3823b96b4
