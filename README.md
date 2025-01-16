# acovado.club

![Build Status](https://ci.acovado.club/api/badges/ShayGoldman/acovado.club/status.svg?ref=refs/heads/main)

# Structure

## Apps

| Name       | Path                | Description                                                 | Changelog                                                                                                         |
| ---------- | ------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| bebe       | `./apps/bebe`       | An orchestrator in charge of running background processes   | [![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](./apps/bebe/CHANGELOG.md)       |
| collection | `./apps/collection` | A worker in charge of collecting information                | [![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](./apps/collection/CHANGELOG.md) |
| ana-liese  | `./apps/ana-liese`  | A worker in charge of analyzing data and generating stories | [![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](./apps/ana-liese/CHANGELOG.md)  |

## Modules

| Name    | Path                | Description                                                 | Changelog                                                                                                         |
| ------- | ------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| db      | `./modules/db`      | Data access, schema management and model validations        | [![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](./modules/db/CHANGELOG.md)      |
| events  | `./modules/events`  | Message broker client both for producing and consuming      | [![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](./modules/events/CHANGELOG.md)  |
| ids     | `./modules/ids`     | Simple module for generating ids                            | [![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](./modules/ids/CHANGELOG.md)     |
| logger  | `./modules/logger`  | Pino based logger                                           | [![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](./modules/logger/CHANGELOG.md)  |
| tracing | `./modules/tracing` | Tracing library aimed for ease-of-use                       | [![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](./modules/tracing/CHANGELOG.md) |
| types   | `./modules/types`   | Utility library used for type-coherence in apps and modules | [![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](./modules/types/CHANGELOG.md)   |

## Infrastrcture

| Name     | Path               | Description                                                                |
| -------- | ------------------ | -------------------------------------------------------------------------- |
| postgres | `./infra/postgres` | Self hosted postgres instance                                              |
| rabbitmq | `./infra/rabbitmq` | Self hosted rabbitmq instance                                              |
| tracing  | `./infra/tracing ` | Tracing stack consisting of: Grafana, Tempo, otel-collector and Prometheus |

## Config

| Name       | Path                  | Description                          | Changelog                                                                                                           |
| ---------- | --------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| compose    | `./config/compose`    | Production deployment configurations | -                                                                                                                   |
| eslint     | `./config/eslint`     | Shared eslint configurations         | [![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](./config/eslint/CHANGELOG.md)     |
| prettier   | `./config/prettier`   | Shared prettier configurations       | [![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](./config/prettier/CHANGELOG.md)   |
| tsconfig   | `./config/tsconfig`   | Shared tsconfig configurations       | [![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](./config/tsconfig/CHANGELOG.md)   |
| typescript | `./config/typescript` | Shared typescript configurations     | [![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](./config/typescript/CHANGELOG.md) |

## Local Development

Run everything locally by following these instructions from the root of the project:

1. `bunx turbo start --filter="@infra/*"`
2. `bunx turbo dev --filter="@modules/*"`
3. `bunx turbo dev --filter="@clients/*"`
4. `bunx turbo dev --filter="@apps/*"`

## Debugging

It won't be the easiest to debug locally, but each of the apps has a `debug` script that will start the app with the `--inspect` flag.
You can then attach to the process using the VSCode debugger.

## Contributing

We welcome contributions to this project! To get started:

- Clone the repository to your message.
- Create a new branch for your feature or bugfix according to [Conventional Commits](https://www.conventionalcommits.org/) guidelines.
- Follow our commit and versioning process:
  - Use `commitizen` for structured and detailed commit messages by running `bun commit` before each commit.
  - Use `bun changeset` if a version bump is required for your changes.
  - `husky` hooks execute before a commit is made
- Submit a pull request with a clear explanation of your changes.
- Merging to `main` branch deploys the code to production and applies changesets.

#### Drizzle studio theme

https://drizzle.studio/themes/elKOzCWRB2NDOTHL8_f8C/edit?token=0ad6fab842e81f61d5f2d2679526e7a3823b96b4
