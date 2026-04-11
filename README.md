# acovado.club

![Build Status](https://ci.acovado.club/api/badges/ShayGoldman/acovado.club/status.svg?ref=refs/heads/main)

# Structure

## Apps

| Name    | Path              | Description                                              |
| ------- | ----------------- | -------------------------------------------------------- |
| example | `./apps/example`  | Minimal HTTP service demonstrating logger + tracing usage |

Add new applications under `./apps/<name>` and wire them in `Dockerfile`, `config/compose/docker-compose.apps.yaml`, and `.drone.yml`.

## Modules

| Name    | Path                | Description                                                 |
| ------- | ------------------- | ----------------------------------------------------------- |
| db      | `./modules/db`      | Data access, schema management and model validations        |
| events  | `./modules/events`  | Message broker client both for producing and consuming      |
| ids     | `./modules/ids`     | Simple module for generating ids                            |
| logger  | `./modules/logger`  | Pino based logger                                           |
| tracing | `./modules/tracing` | Tracing library aimed for ease-of-use                       |
| types   | `./modules/types`   | Utility library used for type-coherence in apps and modules |

## Infrastructure

| Name          | Path                    | Description                                                                |
| ------------- | ----------------------- | -------------------------------------------------------------------------- |
| postgres      | `./infra/postgres`      | Self hosted postgres instance                                              |
| rabbitmq      | `./infra/rabbitmq`      | Self hosted rabbitmq instance                                              |
| observability | `./infra/observability` | SigNoz (OpenTelemetry → ClickHouse): traces, metrics, and logs             |

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

## Local Development

Run everything locally by following these instructions from the root of the project:

1. `bunx turbo dev --filter="@infra/*"` — start infrastructure (PostgreSQL, FalkorDB, RabbitMQ, SigNoz observability).
2. Copy `apps/example/.env.example` to `apps/example/.env` and adjust `TRACE_EXPORTER_URLS` if needed (see below).
3. `process-compose -f ./config/compose/local/process-compose.yml up` — run the example app.
4. `bunx turbo test --filter="@tests/*"` — run tests (optional).

Telemetry uses `TRACE_EXPORTER_URLS` (comma-separated OTLP HTTP trace URLs). For app processes running **on your machine** while SigNoz from `infra/observability` is up, use `http://localhost:14318/v1/traces` in `apps/example/.env` (collector OTLP HTTP is mapped to host port **14318**). Deployed apps use Docker networking (`http://otel-collector:4318/v1/traces`).

## dcv (observability)

`dcv` is a simple observability tool to track and monitor the infra services while running locally. Use it to inspect logs, service health, and dependencies in one place during development.

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
