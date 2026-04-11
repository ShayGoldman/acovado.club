---
phase: 01-cleanup
plan: 01
subsystem: database
tags: [drizzle-orm, postgres, typescript, schema]

# Dependency graph
requires: []
provides:
  - "modules/db blank-slate: no tables, no models, no migrations"
  - "schema.ts with only pgSchema declaration and empty schema export"
  - "index.ts barrel with drizzle-orm, schema, client, migrate — no models"
affects: [02-signal-schema, future db plans]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Blank schema pattern: pgSchema declaration + empty object export for future table additions"

key-files:
  created: []
  modified:
    - modules/db/src/schema.ts
    - modules/db/src/seed.ts
    - modules/db/src/index.ts

key-decisions:
  - "Schema object exported as empty {} — client.ts default import still works, Schema type resolves to empty object (intentional per D-06 and D-08)"
  - "Deleted all migration files — old migrations belong to scrapped relational approach and should not carry forward"

patterns-established:
  - "DB module reset: delete models/ and migrations/, then rewrite schema.ts and index.ts for clean-slate approach"

requirements-completed:
  - CLEAN-01
  - CLEAN-03

# Metrics
duration: 8min
completed: 2026-04-11
---

# Phase 1 Plan 01: DB Module Clean-Slate Summary

**Wiped all old table definitions, model helpers, and migrations from modules/db — schema.ts now contains only the pgSchema declaration with an empty schema object, ready for the new signal model**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-11T18:58:00Z
- **Completed:** 2026-04-11T19:06:00Z
- **Tasks:** 2
- **Files modified:** 3 (schema.ts, seed.ts, index.ts) + 24 deleted (16 migration files, 11 model files, 1 models/index.ts)

## Accomplishments

- Deleted entire `modules/db/src/models/` directory (11 model files + index barrel)
- Deleted entire `modules/db/src/migrations/` directory (4 SQL migration files + 5 meta JSON snapshots)
- Rewrote `schema.ts` to only the pgSchema declaration and empty schema export
- Emptied `seed.ts` — no seed logic remains
- Removed dead `export * from './models'` from `index.ts` barrel
- TypeScript type-check passes with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete models/ and migrations/ directories** - `a941891` (feat)
2. **Task 2: Clear schema.ts and seed.ts; update index.ts barrel** - `88d230d` (feat)

## Files Created/Modified

- `modules/db/src/schema.ts` - Rewritten to pgSchema declaration + empty schema object only
- `modules/db/src/seed.ts` - Emptied (single newline, no imports or logic)
- `modules/db/src/index.ts` - Removed `./models` re-export; now exports drizzle-orm, schema, client, migrate

**Deleted:**
- `modules/db/src/models/` (entire directory — 12 files)
- `modules/db/src/migrations/` (entire directory — 9 files including meta/ snapshots)

## Decisions Made

- Schema exports empty `{}` as the schema object so `client.ts`'s `Schema = typeof schema` type resolves to empty object — this is intentional and correct for the blank-slate state
- `export default schema` retained in schema.ts so `client.ts` default import continues to work without changes

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `modules/db` is a clean blank slate ready for the new signal-centric schema to be added in a later phase
- `client.ts` and `migrate.ts` remain intact — they will work once tables are added to the schema
- No apps currently import model helpers from `@modules/db` (confirmed by T-01-03 threat disposition: accept)

---
*Phase: 01-cleanup*
*Completed: 2026-04-11*
