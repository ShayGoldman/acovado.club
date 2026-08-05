# v3 Handoff — State of the Repo at Branch Point

**Branch:** `v3` (cut from `main` @ `42997e4`)
**Date:** 2026-08-05
**Purpose:** Snapshot of everything that exists today, so v3 can strip the repo down to a barebone and rebuild without losing knowledge of what was here or why.

This is a *description of the current state*, not a plan. Keep/remove calls in the last section are proposals for discussion.

---

## 1. What the system does today

Reddit / YouTube / news sites → poller apps → RabbitMQ (`content-item.created`) → signal-processor → LLM ticker extraction → Postgres `mentions` → dashboard reads trending tickers.

```
Reddit ──┐
YouTube ─┼─▶ [worker app] ──AMQP──▶ [signal-processor] ──▶ Postgres (mentions)
News ────┘                               │ @modules/ticker-extractor → Anthropic
                                         ▼
                                  [dashboard] GET /api/trending
```

Everything is a Bun process in Docker, deployed to a single self-hosted VPS via Drone CI. Traces go to SigNoz over OTLP.

Scale: 208 commits since 2024-11-27, ~9.4k LOC of TypeScript across 18 workspaces.

---

## 2. Repo layout

```
apps/       5 runnable services
modules/   10 shared infra building blocks
clients/    1 dev tool (Drizzle Studio)
infra/      5 docker-compose definitions for stateful services
config/     tsconfig bases, compose files, deploy scripts, traefik config
tests/      2 packages (one has a single scaffold test, one is empty)
docs/       paperclip agent instructions + paperclip state
```

Bun workspaces are declared in root `package.json`; Turborepo (`turbo.json`) orchestrates `build` / `test` / `typecheck` / `lint` / `dev`.

### Apps (LOC)

| App | LOC | What it is | Notes |
|---|---|---|---|
| `apps/news-worker` | 2683 | node-cron poller: crawls seed URLs, respects robots.txt, fetches article bodies with **Playwright**, publishes content-item events | Biggest and newest app. Pulls Playwright into the Docker image — the single heaviest build dependency in the repo. |
| `apps/signal-processor` | 1074 | AMQP consumer. Three handlers (reddit / youtube / news) → ticker extraction → `mentions` rows | The only LLM consumer. Needs `ANTHROPIC_API_KEY`. |
| `apps/youtube-worker` | 650 | node-cron poller over YouTube RSS feeds | No API key — RSS only. |
| `apps/reddit-worker` | 578 | node-cron poller over the public Reddit JSON API | |
| `apps/dashboard` | 205 | `Bun.serve`. `GET /health`, `GET /api/trending?window=24h\|7d`, `GET /` (SSR HTML) | Only externally-exposed service (Traefik → `dashboard.acovado.club`). |

All five follow the identical shape: `src/env.ts` (Zod) → `src/index.ts` (logger, tracer, clients, `connect()`, `Bun.serve`, SIGTERM/SIGINT teardown).

### Modules (LOC)

| Module | LOC | Purpose | Used by |
|---|---|---|---|
| `@modules/events` | 829 | RabbitMQ topic-exchange producer/consumer with W3C trace propagation | all 4 workers + processor |
| `@modules/reddit-client` | 738 | Reddit HTTP JSON client **+ an unused AMQP RPC queue client** | reddit-worker |
| `@modules/inference` | 596 | LLM adapter (Vercel AI SDK + Anthropic) with retry/backoff, hooks, `inference_logs` audit rows | ticker-extractor |
| `@modules/db` | 573 | Drizzle client on `drizzle-orm/bun-sql`, scoped to the `acovado` pgSchema, query tracing, migrate + seed scripts | all apps |
| `@modules/tracing` | 509 | Full OTel SDK: tracer, log bridge, propagation helpers, `tracer.with(name, ctx => …)` | all apps + db/events |
| `@modules/graph-db` | 392 | FalkorDB/Cypher client | **nobody — zero consumers** |
| `@modules/ticker-extractor` | 329 | Prompt + Zod schema + extractor for pulling tickers out of text | signal-processor |
| `@modules/logger` | 206 | Pino wrapper, bounded error serializer | everything |
| `@modules/ids` | 29 | nanoid with typed prefixes | events, reddit-client |
| `@modules/types` | 7 | type-fest re-export | events, tracing, reddit-client |

Convention across all of them: `make<Thing>(opts)` factory returning a plain object with `connect` / `disconnect`, plus `export type Thing = ReturnType<typeof makeThing>`. No classes, no module-level singletons.

### Database

`modules/db/src/schema.ts` — pgSchema `acovado`, 8 tables:

`sources`, `tickers`, `content_items`, `mentions`, `inference_logs`, `news_source_configs`, `seen_urls`, `news_articles`.

(Note: `ARCHITECTURE.md` still claims the schema is empty — it is stale.)

### Infra (`infra/*` — compose bases extended by `config/compose/*`)

| Service | Role | Actually used? |
|---|---|---|
| Postgres 15 | primary store | yes |
| RabbitMQ (custom image w/ plugins) | message bus | yes |
| SigNoz stack (ClickHouse, Zookeeper, otel-collector, migrator) | traces/logs/metrics | yes, but **degraded in prod** — see §5 |
| FalkorDB | graph DB | **deployed but unused by any app** |
| Portainer (`stats`) | container UI | ops only |
| Ollama | local LLM | dev only; managed service was removed, run it yourself |

---

## 3. Build, CI, deploy

- **Dev:** modules are imported as TypeScript source; Bun resolves workspace deps JIT. `bun run dev` per app (with `--inspect`), or `process-compose -f config/compose/local/process-compose.yml up`.
- **Prod:** three-stage root `Dockerfile` — `dependencies` (frozen lockfile) → `app-builder` (`bun build` bundles the app *and its workspace modules* into one `dist/index.js`) → `production` (copies `dist/` only, runs `bun dist/index.js`). Build arg `APP_PATH=<app>`.
- **CI (`.drone.yml`, self-hosted Drone at ci.acovado.club):** triggers on push to `main` **only when the commit is a GitHub merge commit** — escape hatch is `[trigger-main-deploy]` in the message. Steps: `validate-merge-commit` → 5 parallel `build-<app>` (push to `docker-registry.acovado.club/<app>:${SHA}`) → `deploy` (compose up on the host via mounted docker.sock) → `cleanup`. A `release-versions` changesets step exists but is commented out pending GitHub auth.
- **VPS:** env files in `/srv/env/*.env`, volumes in `/srv/volumes/`, external Docker networks `internal-network` and `proxy-network`, Traefik + oauth2-proxy for TLS/ingress. `config/deploy/prepare-vps-for-cd.sh` does one-time host prep. Details in `DEPLOYMENT.md`.

### Env vars per app

| App | Required | Optional/tuning |
|---|---|---|
| dashboard | `DATABASE_URL` | `NODE_ENV`, `PORT`, `TRACE_EXPORTER_URLS` |
| reddit-worker | `DATABASE_URL`, `RABBITMQ_URL` | `REDDIT_FETCH_LIMIT`, `REDDIT_POLL_CRON` |
| youtube-worker | `DATABASE_URL`, `RABBITMQ_URL` | `YOUTUBE_FETCH_LIMIT`, `POLL_CRON` |
| news-worker | `DATABASE_URL`, `RABBITMQ_URL` | `NEWS_POLL_CRON`, `NEWS_NAV_TIMEOUT_MS`, `NEWS_FETCH_MAX_RETRIES`, `NEWS_FETCH_CONCURRENCY`, `NEWS_ROBOTS_CACHE_TTL_MS`, `PORT` |
| signal-processor | `DATABASE_URL`, `RABBITMQ_URL`, `ANTHROPIC_API_KEY` | `PORT` |
| `@modules/db` | `DATABASE_URL` | `RESET_DB` |

Templates: `config/deploy/env-templates/`.

---

## 4. Tooling and conventions

- Bun 1.1.36 (runtime, package manager, test runner, bundler) · Turborepo 2.6.3 · Biome 1.9.4 (2-space, 90 cols, single quotes, semicolons) · TypeScript 5.7 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Husky `pre-commit` → lint-staged (Biome); `commit-msg` → commitlint (conventional). `bun commit` runs commitizen.
- Changesets configured (`.changeset/`) — every app/module carries its own version + CHANGELOG. `changeset:version` is Release-Manager-only.
- Files `kebab-case`; functions `camelCase`; factories `make*`; types/interfaces `PascalCase`; opts as `Make<Name>Opts`; env keys `SCREAMING_SNAKE_CASE`; DB columns `snake_case`.
- Branch naming `aco-<n>-slug`; merge to `main` via GitHub PR.

### Agent orchestration (Paperclip)

The repo is driven by a Paperclip agent org, not by a human writing all the code. `docs/paperclip-agents/` holds the canonical instruction text for GM, CTO, Principal Engineer, DevOps Engineer, Backend Engineer, Release Manager, and Advisor. `docs/paperclip-state.md` holds the company/project/agent UUIDs and adapter wiring (adapter type `cursor`, `maxTurnsPerRun: 1000`). `.paperclip/worktrees/` (untracked) contains 12 stale agent worktrees — full repo copies.

`CLAUDE.md` also declares a **GSD workflow enforcement** section requiring `/gsd-quick`, `/gsd-debug`, `/gsd-execute-phase` before file edits — but `.claude/commands/` is empty, so those commands do not exist in this checkout. Either restore them or drop that section in v3.

---

## 5. Known broken / rotting things at the branch point

Verified by running the tooling on this branch:

1. **`bun typecheck` fails repo-wide.** `@modules/events` does not compile against the installed `amqplib` types (`Connection` vs `ChannelModel` drift — `consumer.ts:114`, `producer.ts:42,85`, `utils.ts:19,49`). This cascades into reddit-client, all three workers, and signal-processor: **6 of 16 workspaces fail typecheck.** The pre-commit hook trips on this for unrelated changes.
2. **`apps/news-worker` tests fail** — `Cannot find package 'robots-parser'` from `src/article-fetcher.ts` (118 pass, 1 fail). Declared in package.json but not resolvable from the workspace.
3. **`bunx turbo run test` aborts on `@apps/dashboard`** — it has no test files and `bun test` exits 1 on "No tests found", so the whole run fails before reaching other packages. Must run with `--filter='!@apps/dashboard' --continue` to get real results.
4. **`@modules/graph-db` has zero consumers** and FalkorDB is still deployed in prod compose, burning VPS resources.
5. **`makeRedditApiQueueClient`** in `@modules/reddit-client` is defined and exported but never called.
6. **Prod observability is degraded** — SigNoz stack up but `signoz`/`clickhouse` unhealthy, `zookeeper`/migrator exited, sustained 800%+ CPU (ACO-110). TTL/schema work was parked until ClickHouse + ZK recover.
7. **`ARCHITECTURE.md` is stale** — claims `schema = {}` (there are 8 tables) and omits `news-worker` from the app list. `README.md` omits news-worker too.
8. **`tests/stock-events-simulation` is completely empty**; `tests/e2e` has one 5-line scaffold.
9. **`release-versions`** CI step is commented out (GitHub auth unresolved), so changeset versions never get published automatically.
10. **12 stale worktrees** under `.paperclip/worktrees/` and ~10 stale local branches; `apps/dashboard/.env.example` is untracked.

`TASKS.md` and `DRAFTS.md` carry a further backlog of never-actioned items (Docker cache/turbo prune, healthz endpoints everywhere, Prometheus metrics, coded errors, correlation IDs, number/float handling, Reddit reply reprocessing optimization).

---

## 6. What's worth keeping — proposal, not a decision

Read as "my recommendation", to be argued with before anything is deleted.

**Keep (earned its place, low cost):**
- `@modules/logger`, `@modules/ids`, `@modules/types` — small, correct, dependency-light.
- `@modules/db` — the Drizzle-on-`bun-sql` setup and migrate/seed harness are solid; the *schema* is the part to reconsider.
- The tooling spine: Bun workspaces + Turbo + Biome + strict tsconfig bases + husky/commitlint.
- The `make*(opts) → { connect, disconnect }` factory convention and Zod-per-app env validation. This is the most valuable thing the repo learned; carry it forward verbatim.
- `Dockerfile` bundling strategy (`bun build` → single `dist/index.js`) — genuinely good, tiny prod images.
- `DEPLOYMENT.md` + `config/deploy/prepare-vps-for-cd.sh` — the VPS is real and the host layout is not something to rediscover.

**Drop or park:**
- `@modules/graph-db` + FalkorDB infra — unused, costs prod RAM.
- `makeRedditApiQueueClient` — dead code.
- `apps/news-worker` — by far the most complexity and the whole reason Playwright is in the image. If news isn't day-one for v3, cutting it removes ~2.7k LOC and the heaviest build dep in one move.
- `tests/stock-events-simulation` — empty.
- Paperclip agent org docs — keep only if v3 continues the multi-agent workflow; otherwise `docs/paperclip-*` and the GSD section in `CLAUDE.md` are ~7 files of instructions for a process that isn't running.
- SigNoz — the full stack is heavy for one VPS and is currently the top source of prod instability. Worth re-deciding between "keep OTel instrumentation, ship to something lighter" and "keep SigNoz and fix it".

**Decide deliberately:**
- `@modules/events` — the tracing-propagation design is good, but it's the source of the repo-wide typecheck failure. Rewrite against current `amqplib` types rather than port as-is; or reconsider whether v3 needs a broker at all at this scale (a single process with an in-memory queue would remove RabbitMQ, `@modules/events`, and a whole class of ops).
- `@modules/tracing` — 509 LOC of OTel wiring. Excellent when the backend is healthy; dead weight when it isn't.
- `@modules/inference` — the retry + `inference_logs` audit trail is worth keeping, but it's built on the Vercel AI SDK; re-check against the current Anthropic SDK before porting.
- The 8-table schema — `sources` / `content_items` / `mentions` / `tickers` is the durable core. The four news-specific tables (`news_source_configs`, `seen_urls`, `news_articles`) follow whatever the news-worker decision is.

**Before deleting anything:** `main` at `42997e4` stays as the full record, and this file names the pieces. Nothing here needs to be preserved defensively.

---

## 7. Reference commands

```bash
bun install
bunx turbo run test --filter='!@apps/dashboard' --continue   # dashboard has no tests, aborts the run
bunx turbo run typecheck --continue                          # currently fails on @modules/events
bun check                                                    # biome lint + format
cd apps/<name> && bun run dev                                # single app, watch + inspect
process-compose -f config/compose/local/process-compose.yml up
cd modules/db && bun src/migrate.ts                          # migrations
cd clients/nano && bun run dev                               # Drizzle Studio
docker build --target production --build-arg APP_PATH=dashboard -t dashboard:latest .
```
