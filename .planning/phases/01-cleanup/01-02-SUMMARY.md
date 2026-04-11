---
phase: 01-cleanup
plan: 02
subsystem: tests, scripts
tags: [cleanup, bug-fix, simulation, e2e]
dependency_graph:
  requires: []
  provides: [awaited-producer-send, e2e-todo-placeholder]
  affects: [tests/stock-events-simulation, tests/e2e]
tech_stack:
  added: []
  patterns: [await-async-fire-and-forget-fix, test.todo-placeholder]
key_files:
  created: []
  modified:
    - tests/stock-events-simulation/src/simulation.ts
    - tests/e2e/src/health.e2e.test.ts
decisions:
  - "scripts/reset-reddit-data.ts was not in the worktree (never git-tracked) — file didn't exist, deletion task satisfied trivially"
  - "await added to producer.send() ensures publish failures surface in tracer spans rather than being silently dropped"
  - "E2E stub replaced with test.todo() so CI reports a pending test rather than a trivially-passing no-op"
metrics:
  duration: "~5 minutes"
  completed: "2026-04-11"
---

# Phase 1 Plan 02: Point Fixes — Await, E2E Stub, Script Deletion Summary

Removed dead reset script (never existed in worktree), awaited unawaited `producer.send()` in simulation, and replaced trivially-passing E2E stub with `test.todo()` placeholder — leaving CI in a clean, honest state.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Delete reset-reddit-data.ts script | n/a (file not in worktree) | scripts/reset-reddit-data.ts (never existed) |
| 2 | Await producer.send and replace E2E stub | 1dad2ae | tests/stock-events-simulation/src/simulation.ts, tests/e2e/src/health.e2e.test.ts |

## What Was Built

**Task 1 — Delete reset-reddit-data.ts:**
The script `scripts/reset-reddit-data.ts` was identified in the plan as a dead FalkorDB-coupled reset tool. It did not exist in the worktree (was never git-tracked), so the acceptance criterion was already satisfied. The file imports `@modules/graph-db` to reset graph data — with graph approach scrapped, this script has no future use. The main repo copy was also removed.

**Task 2 — Await producer.send:**
`tests/stock-events-simulation/src/simulation.ts` line 77 had an unawaited `producer.send()` call. This caused publish failures to be silently dropped rather than surfacing as errors. Adding `await` ensures the Promise rejection propagates into the tracer span and becomes observable.

**Task 2 — Replace E2E stub:**
`tests/e2e/src/health.e2e.test.ts` contained `expect(1).toEqual(1)` — a trivially-passing stub that gave false CI confidence. Replaced with `test.todo('health check — add real e2e tests when app services are running')` so CI accurately reports a pending test.

## Deviations from Plan

### Auto-fixed Issues

None.

### Other Deviations

**1. Task 1 — No git commit needed**
- **Found during:** Task 1 pre-flight read
- **Issue:** `scripts/reset-reddit-data.ts` was never git-tracked in the worktree; it existed only as an untracked file in the main working directory
- **Outcome:** Acceptance criterion satisfied trivially — file doesn't exist on worktree disk. No git operation required. File removed from main repo copy as well.

## Known Stubs

None introduced by this plan.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

- tests/stock-events-simulation/src/simulation.ts: contains `await producer.send` - FOUND
- tests/e2e/src/health.e2e.test.ts: contains `test.todo` - FOUND
- scripts/reset-reddit-data.ts: does not exist - CONFIRMED
- Commit 1dad2ae: exists in git log - CONFIRMED
