# Technology Stack

**Analysis Date:** 2026-04-11

## Languages

**Primary:**
- TypeScript 5.7+ - All application and module code
- YAML - Docker Compose infrastructure definitions

**Secondary:**
- Shell (sh/bash) - Docker entrypoint scripts in `infra/rabbitmq/init-plugins.sh`, `infra/inference-model/docker-compose.yaml` command blocks

## Runtime

**Environment:**
- Bun 1.1.36 - Primary runtime for all TypeScript packages. Modules are executed as TypeScript sources directly (no transpile step at runtime). The Dockerfile comment confirms: "Workspace packages under modules/ stay as TypeScript sources; Bun resolves them at runtime (JIT)."

**Package Manager:**
- Bun 1.1.36
- Lockfile: `bun.lockb` (present, binary format)

## Frameworks

**Core:**
- Bun.serve (built-in) - HTTP server in app entry points (e.g., `apps/example/src/index.ts`)
- No web framework (Hono, Express, etc.) — raw Bun HTTP server used directly

**ORM:**
- Drizzle ORM ^0.45.1 - PostgreSQL access via `drizzle-orm/bun-sql` driver. Schema defined in `modules/db/src/schema.ts`. Migrations via `drizzle-kit ^0.28.1`.
- Drizzle Zod ^0.8.3 - Schema-to-Zod integration in `modules/db`

**Validation:**
- Zod ^4.2.1 - Used across all modules for schema validation and env parsing

**Build/Monorepo:**
- Turborepo ^2.6.3 - Monorepo task orchestration. Config: `turbo.json`. Workspace layout managed via Bun workspaces in `package.json`.

**Testing:**
- Bun test (built-in) - Test runner used in `apps/example` and `tests/e2e`. No separate test framework (Jest/Vitest) detected.

**Linting/Formatting:**
- Biome ^1.9.4 - Single tool for linting and formatting. Config: `biome.json` at root.

## Key Dependencies

**Critical:**
- `drizzle-orm` ^0.45.1 - Primary data access layer for PostgreSQL (`modules/db`)
- `amqplib` ^0.10.5 - RabbitMQ AMQP client used in `modules/events` and `modules/reddit-client`
- `redis` ^4.7.0 - Used as transport for FalkorDB graph queries in `modules/graph-db` (FalkorDB exposes Redis protocol)
- `pino` ^9.5.0 + `pino-pretty` ^13.0.0 - Structured JSON logging in `modules/logger`
- `@opentelemetry/*` ^1.x / ^0.55.x - Full OpenTelemetry SDK for distributed tracing and log export in `modules/tracing`
- `nanoid` ^5.0.9 - ID generation in `modules/ids` and `modules/types`
- `zod` ^4.x - Env and schema validation across all modules

**Infrastructure:**
- `drizzle-kit` ^0.28.1 - Migration generation and Drizzle Studio (`clients/nano` dev command)
- `bluebird` ^3.7.2 - Promise utilities in `modules/db`
- `type-fest` ^4.x - TypeScript utility types used in multiple modules
- `turbo` ^2.6.3 - Build pipeline orchestrator
- `husky` ^9.1.7 - Git hooks
- `lint-staged` ^15.5.2 - Pre-commit linting
- `commitizen` + `cz-conventional-changelog` - Conventional commit tooling
- `@changesets/cli` ^2.29.8 - Versioning and changelog management

**Test/Simulation:**
- `commander` ^11.1.0 - CLI arg parsing in `tests/stock-events-simulation`
- `date-fns` ^2.30.0 - Date utilities in stock events simulation
- `inquirer` ^9.3.7 / ^12.1.0 - Interactive prompts in simulation and tracing dev tools

## Configuration

**Environment:**
- Environment validated at startup using Zod schemas in each module's `src/env.ts`
- Key env vars required per module:
  - `modules/db`: `DATABASE_URL` (postgres connection URL), `RESET_DB` (optional bool)
  - `modules/graph-db`: `GRAPH_DB_URL` (redis-protocol URL for FalkorDB)
  - `apps/example`: `TRACE_EXPORTER_URLS` (comma-separated OTLP HTTP URLs), `PORT` (default 3000), `NODE_ENV`
- Production env files are external: loaded via Docker `env_file` pointing to `${ENV_FILES_ROOT}/*.env`

**Build:**
- `turbo.json` - Task graph. Build outputs go to `dist/`. Inputs include `.env*` files.
- `tsconfig.json` per package extends `@config/tsconfig/node20.json` (ESNext modules, bundler resolution, strict mode)
- Base tsconfig at `config/tsconfig/tsconfig.base.json`: strict, isolatedModules, noUncheckedIndexedAccess, exactOptionalPropertyTypes
- Biome config at `biome.json`: 2-space indent, 90-char line width, single quotes, trailing commas, semicolons always

**Git Hooks:**
- Husky for hook management (`prepare` script)
- Commitlint with conventional config (`@commitlint/config-conventional`)

## Platform Requirements

**Development:**
- Bun 1.1.36
- Docker + Docker Compose (for local infra: Postgres, RabbitMQ, FalkorDB, observability stack)
- GPU optional (required only for local `inference-model` / Ollama service)

**Production:**
- Docker (container-based deployment via `config/compose/docker-compose.apps.yaml` + `docker-compose.infra.yaml`)
- Traefik reverse proxy (labels on services, TLS via Let's Encrypt `acovado` certresolver)
- No GPU in prod (inference-model service was removed from prod compose per recent commits)
- Base image: `oven/bun:1-alpine`
- Apps built with: `bun build src/index.ts --outdir dist --target node`

---

*Stack analysis: 2026-04-11*
