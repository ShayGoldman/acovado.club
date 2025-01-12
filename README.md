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

## Infrastrcture

| Name     | Path               | Description                                                                |
| -------- | ------------------ | -------------------------------------------------------------------------- |
| postgres | `./infra/postgres` | Self hosted postgres instance                                              |
| rabbitmq | `./infra/rabbitmq` | Self hosted rabbitmq instance                                              |
| tracing  | `./infra/tracing ` | Tracing stack consisting of: Grafana, Tempo, otel-collector and Prometheus |

## Config

| Name       | Path                  | Description                          |
| ---------- | --------------------- | ------------------------------------ |
| compose    | `./config/compose`    | Production deployment configurations |
| eslint     | `./config/eslint`     | -                                    |
| prettier   | `./config/prettier`   | -                                    |
| tsconfig   | `./config/tsconfig`   | -                                    |
| typescript | `./config/typescript` | -                                    |

## Local Development

Run everything locally by following these instructions from the root of the project:

1. `bunx turbo start --filter="@infra/*"`
2. `bunx turbo dev --filter="@modules/*"`
3. `bunx turbo dev --filter="@clients/*"`
4. `bunx turbo dev --filter="@apps/*"`

## Debugging

It won't be the easiest to debug locally, but each of the apps has a `debug` script that will start the app with the `--inspect` flag.
You can then attach to the process using the VSCode debugger.

# Drizzle studio theme

https://drizzle.studio/themes/elKOzCWRB2NDOTHL8_f8C/edit?token=0ad6fab842e81f61d5f2d2679526e7a3823b96b4
