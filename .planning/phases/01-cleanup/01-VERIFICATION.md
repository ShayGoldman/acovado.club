---
phase: 01-cleanup
verified: 2026-04-11T21:00:00Z
status: gaps_found
score: 4/5 must-haves verified
overrides_applied: 1
overrides:
  - must_have: "No FalkorDB graph schema definitions, model files, or Cypher query code remain in modules/graph-db/ or modules/db/"
    reason: "Decision D-01 explicitly preserves modules/graph-db/ as reusable infrastructure for future phases. The Cypher query code that remains is in the generic graph client (not app-specific dead code). All app-specific FalkorDB consumers (scripts/reset-reddit-data.ts) and all graph-aware schema/model files in modules/db/ have been removed. The SC wording was broader than the intent."
    accepted_by: "pending — suggest developer accept"
    accepted_at: "2026-04-11T21:00:00Z"
re_verification: null
gaps:
  - truth: "bun run and CI pass with no type errors or import failures caused by removed modules"
    status: failed
    reason: "TypeScript typecheck fails with 17 errors in tests/stock-events-simulation. The schema was blanked to {} but simulation.ts and prompts.ts still reference schema.signalMetrics and schema.tickers. Additionally, db.ts passes logger to makeDBClient() which now requires tracer not logger."
    artifacts:
      - path: "tests/stock-events-simulation/src/simulation.ts"
        issue: "References schema.signalMetrics and schema.tickers (lines 49-61) which are undefined in the blanked schema"
      - path: "tests/stock-events-simulation/src/prompts.ts"
        issue: "References schema.tickers and schema.signalMetrics in 10 locations"
      - path: "tests/stock-events-simulation/src/db.ts"
        issue: "Passes { url, logger } to makeDBClient() but MakeDBClientOpts requires tracer not logger (line 12)"
    missing:
      - "Either stub/comment out schema.signalMetrics and schema.tickers references in simulation.ts and prompts.ts until the schema is defined, OR add a note that these files are known-broken until Phase 2 defines the new schema"
      - "Fix or stub db.ts to pass tracer instead of logger, or suppress the type error with a comment explaining it is a pre-existing mismatch"
human_verification: []
---

# Phase 1: Cleanup Verification Report

**Phase Goal:** The codebase contains no dead FalkorDB graph code and all known pre-existing bugs are fixed
**Verified:** 2026-04-11T21:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | No FalkorDB graph schema definitions, model files, or Cypher query code remain in `modules/graph-db/` or `modules/db/` | PASSED (override) | modules/db/src/models/ deleted, migrations/ deleted, schema.ts reduced to pgSchema declaration + empty {}. modules/graph-db/ retained per D-01 as reusable infrastructure; no app-specific dead graph code remains. |
| 2 | The seed script uses the correct ticker symbol GOOGL and no references to GOOGLE remain in seed data | VERIFIED | seed.ts is empty (single newline). No GOOGLE references found in any .ts file across the codebase. |
| 3 | All producer.send() calls in the simulation are awaited — publish errors surface rather than being silently swallowed | VERIFIED | simulation.ts line 77: `await producer.send('signal', event.type, event)` confirmed. No unawaited producer.send() calls detected. |
| 4 | The E2E test file no longer contains the `expect(1).toBe(1)` stub — it is either a meaningful structural placeholder or deleted | VERIFIED | health.e2e.test.ts contains only `test.todo('health check — add real e2e tests when app services are running')`. No stub assertions remain. |
| 5 | bun run and CI pass with no type errors or import failures caused by removed modules | FAILED | bun tsc --noEmit in tests/stock-events-simulation exits with code 2 and 17 errors. schema.signalMetrics and schema.tickers are referenced but do not exist in the blanked schema ({}). db.ts passes logger to makeDBClient which expects tracer. |

**Score:** 4/5 truths verified (1 override applied)

### Deferred Items

None. No items identified as addressed in later phases — the SC-5 failure is a real gap that should have been prevented in this phase.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `modules/db/src/schema.ts` | pgSchema declaration + empty schema | VERIFIED | Contains only pgSchema('acovado'), empty schema export, and default export |
| `modules/db/src/seed.ts` | Empty (no seed data) | VERIFIED | File contains only a single newline |
| `modules/db/src/index.ts` | No models re-export | VERIFIED | Exports drizzle-orm, schema, client, migrate — no ./models |
| `modules/db/src/models/` | Deleted | VERIFIED | Directory does not exist |
| `modules/db/src/migrations/` | Deleted | VERIFIED | Directory does not exist |
| `scripts/reset-reddit-data.ts` | Deleted | VERIFIED | File does not exist on filesystem |
| `tests/stock-events-simulation/src/simulation.ts` | Contains await producer.send | VERIFIED | Line 77: `await producer.send('signal', event.type, event)` |
| `tests/e2e/src/health.e2e.test.ts` | Contains test.todo, no stub | VERIFIED | `test.todo('health check — add real e2e tests when app services are running')` only |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `simulation.ts` | `producer.send` | `await` | WIRED | `await producer.send('signal', event.type, event)` present at line 77 |
| `simulation.ts` | `@modules/db schema` | `schema.signalMetrics` | BROKEN | schema is {} — signalMetrics and tickers not defined, causes 17 type errors |

### Data-Flow Trace (Level 4)

Not applicable — this phase contains no components that render dynamic data. It is a cleanup/bug-fix phase.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| simulation.ts has no unawaited producer.send | `grep -n "producer.send" simulation.ts` | `await producer.send(...)` only | PASS |
| health.e2e.test.ts has no expect(1) stub | `grep -n "expect(1)" health.e2e.test.ts` | no matches | PASS |
| schema.ts is blank-slate | `grep -n "createTable\|pgTable" schema.ts` | no matches | PASS |
| TypeScript typecheck passes | `bun tsc --noEmit` in stock-events-simulation | exit code 2, 17 errors | FAIL |
| Build passes for apps/example | `bunx turbo run build` | example builds; stock-events-simulation fails (target node issue + schema refs) | FAIL |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CLEAN-01 | 01-01-PLAN.md | Remove dead FalkorDB graph models and schema definitions from modules/graph-db/ and modules/db/ | SATISFIED | models/ and migrations/ deleted from modules/db; graph-db retained per D-01 |
| CLEAN-02 | 01-02-PLAN.md | Remove leftover graph query code and any modules that served only the old graph approach | SATISFIED | scripts/reset-reddit-data.ts (the only non-module consumer of graph-db) was absent from worktree; no other app-specific graph consumers found |
| CLEAN-03 | 01-01-PLAN.md | Fix seed script: wrong ticker symbol GOOGLE -> GOOGL | SATISFIED | seed.ts emptied entirely per D-11 — GOOGLE reference removed by erasure |
| CLEAN-04 | 01-02-PLAN.md | Fix unawaited producer.send() in simulation | SATISFIED | await added, commit 1dad2ae confirmed in git log |
| CLEAN-05 | 01-02-PLAN.md | Remove E2E stub (expect(1).toBe(1)) — replace with structural placeholder or delete | SATISFIED | test.todo() placeholder in place, commit 1dad2ae |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `tests/stock-events-simulation/src/simulation.ts` | 49-61 | `schema.signalMetrics` and `schema.tickers` reference non-existent schema properties | Blocker | Causes 6 type errors; simulation is non-functional at runtime (Drizzle throws on undefined table) |
| `tests/stock-events-simulation/src/prompts.ts` | multiple | Same schema.tickers / schema.signalMetrics references | Blocker | 10 type errors in prompts.ts |
| `tests/stock-events-simulation/src/db.ts` | 12 | Passes `logger` to `makeDBClient()` which requires `tracer` | Blocker | 1 type error — `logger` is not a property of `MakeDBClientOpts` |
| `tests/stock-events-simulation/src/simulation.ts` | 90-91 | `// TODO wait until all events are consumed properly` with hardcoded 5s timeout | Info | Technical debt marker — does not block compilation |

### Human Verification Required

None. All verification items can be assessed programmatically.

### Gaps Summary

One real gap blocks the SC-5 success criterion: the simulation test package fails TypeScript type checking with 17 errors. When `modules/db` schema was blanked to `export const schema = {}`, the simulation code that references `schema.signalMetrics` and `schema.tickers` became broken at the type level. The `db.ts` wrapper also passes a `logger` argument that is no longer accepted by `makeDBClient()` (which was updated to require `tracer`).

The phase plan acknowledged that the simulation references these schema tables (the SUMMARY notes the simulation as a key-file), but neither plan addressed the downstream impact of blanking the schema on the simulation's type correctness.

**Root cause:** The two cleanup plans were executed in isolation. Plan 01 blanked the schema. Plan 02 fixed the await bug in simulation.ts. Neither plan updated the simulation's schema references or verified the combined typecheck across all packages.

**SC-5 is violated:** "bun run and CI pass with no type errors or import failures caused by removed modules." The type errors are directly caused by the schema removal in this phase.

**Note on SC-1 / modules/graph-db:** The roadmap SC-1 states "no Cypher query code remain in modules/graph-db/". The graph-db module still contains Cypher query infrastructure (GRAPH.QUERY commands, Cypher string building). However, decision D-01 in the approved context explicitly preserves modules/graph-db/ as future-use infrastructure. This is an intentional deviation. An override is suggested in the frontmatter — the developer should confirm it.

---

_Verified: 2026-04-11T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
