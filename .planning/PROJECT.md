# acovado.club

## What This Is

A distributed financial signal-tracking system running on a self-hosted VPS. It ingests social and financial data from multiple sources (Reddit first, then YouTube, news agencies, and public figures' trades), groups signals by ticker, and surfaces trends and swing opportunities for a small internal team. AI agents — orchestrated by Paperclip — do the actual data collection, processing, and analysis work.

## Core Value

A reliable pipeline that continuously collects, processes, and groups financial social signals by ticker — the foundation every analysis and output layer depends on.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Project cleaned up — dead FalkorDB graph models and leftover code removed
- [ ] Paperclip integrated — agent orchestration layer running, agents can be assigned and scheduled
- [ ] Reddit ingestion pipeline running — posts collected, parsed, and stored by agents
- [ ] Signals grouped by ticker — data organized so trends are queryable per ticker
- [ ] Pipeline runs autonomously — agents collect and process without manual intervention

### Out of Scope

- Dashboard / UI — output layer comes after the pipeline is solid
- YouTube transcription — deferred to a later source expansion phase
- News agency ingestion — deferred to a later source expansion phase
- Public figures' trades (SEC filings) — deferred to a later source expansion phase
- External users / auth — internal tool only for now

## Context

**Previous version:** The project previously parsed Reddit posts and stored relationships in FalkorDB as a graph. That approach has been scrapped. Remaining artifacts (FalkorDB schema, dead models, old graph query code) need to be removed before rebuilding.

**Existing infrastructure (reuse):**
- `modules/reddit-client/` — Reddit HTTP client, works, keep
- `modules/events/` — RabbitMQ producer/consumer, keep
- `modules/db/` — PostgreSQL + Drizzle ORM, keep (schema needs redesign for new signal model)
- `modules/graph-db/` — FalkorDB client, evaluate — may be removed or repurposed
- `modules/inference/` — LLM wrapper (Ollama, dev-only removed from prod), keep for analysis
- `modules/tracing/`, `modules/logger/`, `modules/ids/` — keep as-is

**Tech environment:** Bun monorepo with Turborepo, self-hosted via Docker Compose on a VPS. Traefik handles routing, SigNoz handles observability.

**Agent orchestration:** Paperclip (https://github.com/paperclipai/paperclip) is the coordination layer. Agents bring their own prompts and models; Paperclip manages goals, heartbeats (scheduled wake cycles), budgets, and delegation. Most project management will live in Paperclip, not in this repo's planning files.

**Known issues to clean up:**
- Wrong ticker symbol `GOOGLE` (should be `GOOGL`) in seed script
- Unawaited `producer.send()` in simulation
- E2E test suite is a stub (`expect(1).toBe(1)`)
- No RabbitMQ reconnection logic
- Infinite nack-requeue loop risk (no dead-letter queue)

## Constraints

- **Infrastructure:** Self-hosted VPS, Docker Compose — no cloud services
- **Runtime:** Bun monorepo — all modules must be Bun-compatible
- **Sources (v1):** Reddit only — additional sources are future milestones
- **Users:** Internal only — no auth, multi-tenancy, or external access needed for v1
- **Orchestration:** Paperclip manages agent goals and scheduling — pipeline logic lives in agents, not in cron jobs or manual scripts

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Scrap FalkorDB graph model | Previous approach didn't scale to multi-source; relational model better fits ticker-centric signal grouping | — Pending |
| Use Paperclip for agent orchestration | Agent-driven pipeline instead of manual/cron — aligns with goal of gradual autonomous expansion | — Pending |
| Reddit-only for v1 pipeline | Start narrow, validate the full pipeline before adding ingestion complexity | — Pending |
| Output layer deferred | Pipeline correctness matters more than presentation for v1 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-11 after initialization*
