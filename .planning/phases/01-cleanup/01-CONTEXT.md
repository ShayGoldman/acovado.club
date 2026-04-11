# Phase 1: Cleanup - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Remove leftover code from the scrapped FalkorDB graph approach and fix five known pre-existing bugs. The codebase must be fully buildable with no dead imports or broken references after this phase. Schema redesign and new signal model work happen in later phases.

</domain>

<decisions>
## Implementation Decisions

### FalkorDB Removal Scope
- **D-01:** Keep `modules/graph-db/` intact — the FalkorDB client will be reused in a future phase (signal grouping or graph relationships).
- **D-02:** Keep `infra/falkordb/` Docker Compose files and the `config/compose/docker-compose.infra.yaml` reference intact — infra will be needed again.
- **D-03:** Delete `scripts/reset-reddit-data.ts` — it was app-specific to the old graph approach and is no longer useful.

### DB Module Reset
- **D-04:** Remove `modules/db/src/models/` directory entirely — all model files are tied to the old schema.
- **D-05:** Remove `modules/db/src/migrations/` directory entirely — existing migrations correspond to the old schema that will be redesigned.
- **D-06:** Clear `modules/db/src/schema.ts` down to just the `acovado` pgSchema declaration and an empty export. No table definitions — those will be added when the new signal model is built.
- **D-07:** Empty `modules/db/src/seed.ts` — keep the file but remove all content (the seed data was for the old schema).
- **D-08:** Keep `client.ts`, `env.ts`, `migrate.ts`, `index.ts` in `modules/db/src/` — these are infrastructure, not schema-specific.

### E2E Test
- **D-09:** Replace `expect(1).toEqual(1)` stub with `test.todo('health check — add real e2e tests when app services are running')`. Keep the file. CI will skip the todo cleanly.

### Known Bug Fixes
- **D-10:** Add `await` to `producer.send('signal', event.type, event)` on line 77 of `tests/stock-events-simulation/src/simulation.ts` (CLEAN-04).
- **D-11:** With `seed.ts` content removed, the GOOGLE/GOOGL symbol bug (CLEAN-03) is resolved by erasure. No targeted fix needed.

### Claude's Discretion
- Whether to update `modules/db/src/index.ts` exports to reflect removed models — handle as needed to ensure clean build.
- Exact content of the emptied `schema.ts` (just the pgSchema declaration is fine).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — CLEAN-01 through CLEAN-05 with exact acceptance criteria
- `.planning/ROADMAP.md` §Phase 1 — Success criteria checklist (5 items, all must be TRUE)

### Key source files to read before touching
- `modules/db/src/schema.ts` — current schema (being cleared)
- `modules/db/src/models/` — current models (being removed)
- `modules/db/src/index.ts` — barrel exports (may need updating after models removed)
- `scripts/reset-reddit-data.ts` — being deleted
- `tests/stock-events-simulation/src/simulation.ts` — producer.send fix on line 77
- `tests/e2e/src/health.e2e.test.ts` — stub replacement

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `modules/graph-db/` — FalkorDB client stays, no changes needed
- `modules/db/src/client.ts` — Drizzle client factory, stays untouched
- `modules/db/src/env.ts` — Drizzle env config, stays untouched
- `modules/db/src/migrate.ts` — migration runner, stays untouched
- `modules/events/` — RabbitMQ producer/consumer, no changes needed

### Established Patterns
- `modules/db/src/index.ts` is the barrel export — it re-exports from models; after models/ is removed, this file needs its model re-exports stripped
- Factory function pattern (`makeDBClient`, `makeGraphClient`) — kept as-is

### Integration Points
- `config/compose/docker-compose.infra.yaml` references `infra/falkordb/` — leave untouched
- No app (`apps/`) currently imports `modules/graph-db/` — safe to leave in place
- `scripts/reset-reddit-data.ts` is the only non-module consumer of `@modules/graph-db` — deleted

</code_context>

<specifics>
## Specific Ideas

- "I'll still reuse the FalkorDB client later on, anything app-specific or the reset script should be removed"
- DB module reset: keep the client infrastructure, wipe the schema/models/migrations/seed to a blank slate — new schema designed in a later phase

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-cleanup*
*Context gathered: 2026-04-11*
