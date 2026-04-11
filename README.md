# acovado.club

![Build Status](https://ci.acovado.club/api/badges/ShayGoldman/acovado.club/status.svg?ref=refs/heads/main)

# Structure

## Apps

| Name       | Path                | Description                                                 |
| ---------- | ------------------- | ----------------------------------------------------------- |
| bebe       | `./apps/bebe`       | An orchestrator in charge of running background processes   |
| collection | `./apps/collection` | A worker in charge of collecting information                |
| ana-liese  | `./apps/ana-liese`  | A worker in charge of analyzing data and generating stories |

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

| Name     | Path               | Description                                                                |
| -------- | ------------------ | -------------------------------------------------------------------------- |
| postgres | `./infra/postgres` | Self hosted postgres instance                                              |
| rabbitmq | `./infra/rabbitmq` | Self hosted rabbitmq instance                                              |
| observability | `./infra/observability` | SigNoz (OpenTelemetry → ClickHouse): traces, metrics, and logs |

## Config

| Name       | Path                  | Description                          |
| ---------- | --------------------- | ------------------------------------ |
| compose    | `./config/compose`    | Production deployment configurations |
| tsconfig   | `./config/tsconfig`   | Shared tsconfig configurations       |
| typescript | `./config/typescript` | Shared typescript configurations     |

## Clients

| Name | Path             | Description                                         |
| ---- | ---------------- | --------------------------------------------------- |
| nano | `./clients/nano` | Drizzle Studio client for database management       |
| zook | `./clients/zook` | Metabase analytics dashboard for data visualization |

## Tests

| Name                    | Path                              | Description                                        |
| ----------------------- | --------------------------------- | -------------------------------------------------- |
| e2e                     | `./tests/e2e`                     | End-to-end tests                                   |
| stock-events-simulation | `./tests/stock-events-simulation` | CLI tool for simulating stock market signal events |

## Local Development

Run everything locally by following these instructions from the root of the project:

1. `bunx turbo dev --filter="@infra/*"` - Start infrastructure (PostgreSQL, FalkorDB, RabbitMQ, SigNoz observability)
2. Use `dcv` to track the infra services (see the section below)
3. `process-compose -f ./config/compose/local/process-compose.yml up` - Start the reddit-related apps
4. `bunx turbo test --filter="@tests/*"` - Run tests (optional)

Telemetry uses the same `TRACE_EXPORTER_URLS` as production (`http://otel-collector:4318/v1/traces`). For app processes running **on your machine** (not inside Docker), add `127.0.0.1 otel-collector` to `/etc/hosts` (on Windows: `%SystemRoot%\System32\drivers\etc\hosts`) so that hostname resolves while SigNoz from `infra/observability` is up (OTLP HTTP on host port **4318**). Deployed apps use Docker networking and do not need this.

## dcv (observability)

`dcv` is a simple observability tool to track and monitor the infra services while running locally. Use it to inspect logs, service health, and dependencies in one place during development.

## Debugging

It won't be the easiest to debug locally, but each of the apps has a `debug` script that will start the app with the `--inspect` flag.
You can then attach to the process using the VSCode debugger.

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
