# acovado.club

![Build Status](https://ci.acovado.club/api/badges/ShayGoldman/acovado.club/status.svg?ref=refs/heads/main)

# Structure

## Apps

| Name    | Path              | Description                                              |
| ------- | ----------------- | -------------------------------------------------------- |
| example | `./apps/example`  | Minimal HTTP service demonstrating logger + tracing usage |

Add new applications under `./apps/<name>` and wire them in `Dockerfile`, `config/compose/docker-compose.apps.yaml`, and `.drone.yml`.

## Modules

| Name           | Path                     | Description                                                    |
| -------------- | ------------------------ | -------------------------------------------------------------- |
| db             | `./modules/db`           | Data access, schema management and model validations           |
| events         | `./modules/events`       | RabbitMQ producer/consumer with optional tracing decorators    |
| ids            | `./modules/ids`          | ID generation helpers                                          |
| logger         | `./modules/logger`     | Pino-based structured logging                                  |
| tracing        | `./modules/tracing`      | OpenTelemetry tracing + OTLP log export (see package README) |
| types          | `./modules/types`        | Shared primitives for events and tracing                       |
| graph-db       | `./modules/graph-db`     | FalkorDB / graph client                                        |
| inference      | `./modules/inference`    | LLM / inference client abstractions                            |
| reddit-client  | `./modules/reddit-client`| Reddit API + messaging helpers (used by future Reddit workers) |

## Infrastructure

| Name          | Path                    | Description                                                                |
| ------------- | ----------------------- | -------------------------------------------------------------------------- |
| postgres      | `./infra/postgres`      | PostgreSQL via Docker Compose (`bun run start` runs `docker compose up`) |
| rabbitmq      | `./infra/rabbitmq`      | RabbitMQ via Docker Compose                                                |
| falkordb      | `./infra/falkordb`      | FalkorDB graph database via Docker Compose                                 |
| observability | `./infra/observability` | SigNoz stack (OTel Collector → ClickHouse). See `infra/observability/README.md` |
| inference-model | `./infra/inference-model` | Ollama / local LLM (optional; not part of prod infra compose)            |

## Config

| Name       | Path                  | Description                          |
| ---------- | --------------------- | ------------------------------------ |
| compose    | `./config/compose`    | Production deployment configurations |
| tsconfig   | `./config/tsconfig`   | Shared tsconfig configurations       |
| typescript | `./config/typescript` | Shared typescript configurations     |

## Clients

| Name | Path             | Description                                   |
| ---- | ---------------- | --------------------------------------------- |
| nano | `./clients/nano` | Drizzle Studio client for database management |

## Tests

| Name                    | Path                              | Description                                        |
| ----------------------- | --------------------------------- | -------------------------------------------------- |
| e2e                     | `./tests/e2e`                     | End-to-end tests                                   |
| stock-events-simulation | `./tests/stock-events-simulation` | CLI tool for simulating stock market signal events |

## CI/CD

- **Drone** at [ci.acovado.club](https://ci.acovado.club) (badge above): runs on **push to `main`** when the latest commit is a **GitHub merge commit** (see `.drone.yml` `validate-merge-commit`).
- **Build**: `Dockerfile` installs the monorepo and runs each app with Bun against TypeScript sources; workspace packages under `modules/` are resolved JIT (no separate modules build or image).
- **Registry**: images are pushed to `docker-registry.acovado.club` (e.g. `example`).
- **Deploy step**: copies `infra/` to `/srv/volumes/deployment` on the host, then runs `docker compose` for `config/compose/docker-compose.infra.yaml` and `config/compose/docker-compose.apps.yaml` with `COMMIT_HASH` / `REGISTRY_URL` / volume paths from the Drone environment.

## Production deployment (overview)

The compose files under `config/compose/` assume:

- Docker **external networks** `internal-network` and `proxy-network` (e.g. Traefik).
- **Env files** on the host (e.g. under `/srv/env`) referenced by compose `env_file` entries.
- **Persistent volumes** under `/srv/volumes` for Postgres, SigNoz, FalkorDB, etc.
- App env files such as `/srv/env/example.env` for the `example` service (see `config/compose/docker-compose.apps.yaml`).

Do not commit production secrets; keep them only on the server or in your secrets store.

## Local Development

1. **Infrastructure** — from each directory, run Compose in the background (there is no `dev` script on `@infra/*`; use `docker compose` directly), for example:
   - `cd infra/postgres && docker compose up -d`
   - `cd infra/rabbitmq && docker compose up -d`
   - `cd infra/falkordb && docker compose up -d`
   - `cd infra/observability && docker compose up -d`  
   Or start only what you need. Details: `infra/*/README.md` where present, and `infra/observability/README.md` for SigNoz.
2. Copy `apps/example/.env.example` to `apps/example/.env` and set `TRACE_EXPORTER_URLS` (see below).
3. `process-compose -f ./config/compose/local/process-compose.yml up` — run the example app (requires [process-compose](https://github.com/F1bonacc1/process-compose)).
4. `bunx turbo test --filter="@tests/*"` — run tests (optional).

### Resetting local data

To wipe databases and re-apply migrations from scratch: stop Compose stacks, remove the Docker volumes used by PostgreSQL, RabbitMQ, FalkorDB, and other stateful services, then start infra again and run your migration workflow against an empty database (see `@modules/db` and Drizzle). The example HTTP app does not require Postgres.

Telemetry uses `TRACE_EXPORTER_URLS` (comma-separated OTLP HTTP trace URLs). For app processes running **on your machine** while SigNoz from `infra/observability` is up, use `http://localhost:4318/v1/traces` in `apps/example/.env` (see `infra/observability/docker-compose.yaml` port mappings). Deployed apps use Docker networking (`http://otel-collector:4318/v1/traces`).

## Debugging

Each app can be run with `bun run dev` (uses `--inspect`). Attach with the VSCode debugger (see `.vscode/launch.json` for the example app).

## Contributing

We welcome contributions to this project! To get started:

- Clone the repository to your machine.
- Create a new branch for your feature or bugfix according to [Conventional Commits](https://www.conventionalcommits.org/) guidelines.
- Follow our commit and versioning process:
  - Use `commitizen` for structured and detailed commit messages by running `bun commit` before each commit.
  - Use `bun changeset` to document changes that should appear in the changelog (managed at the monorepo level).
  - `husky` hooks execute before a commit is made
- Changesets workflow:
  - Run `bun changeset` to create a new changeset describing your changes
  - Changesets are tracked in the root `CHANGELOG.md` file
  - All packages are private and unversioned - we use changesets for documentation only
- Code quality:
  - Run `bun check` to lint and format your code with Biome
  - Run `bun lint` for linting only
  - Run `bun format` for formatting only
- Submit a pull request with a clear explanation of your changes.
- Merging to `main` branch deploys the code to production and applies changesets.

#### Drizzle studio theme

https://drizzle.studio/themes/elKOzCWRB2NDOTHL8_f8C/edit?token=0ad6fab842e81f61d5f2d2679526e7a3823b96b4
