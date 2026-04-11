# Phase 1: Cleanup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the discussion history.

**Date:** 2026-04-11
**Phase:** 01-cleanup
**Mode:** discuss
**Areas discussed:** FalkorDB scope, E2E test fate, DB module reset

---

## Areas Discussed

### FalkorDB Scope

| Question | Options Presented | Decision |
|----------|------------------|----------|
| How far should FalkorDB removal go? | Full removal / Modules only / Keep graph-db, strip graph code | Keep graph-db client + infra, delete reset script only |
| What should happen to scripts/reset-reddit-data.ts? | Delete it / Strip graph-db, keep rest | Delete it |

**User note:** "I'll still reuse the falkordb and the client later on, anything app-specific or the reset script should be removed"

---

### E2E Test

| Question | Options Presented | Decision |
|----------|------------------|----------|
| What should replace the stub? | Delete file / test.todo() placeholder / Empty describe block | test.todo() placeholder |

---

### Seed Script / DB Module

| Question | Options Presented | Decision |
|----------|------------------|----------|
| Seed script fix scope | Fix query only / Fix + refactor / Keep seedfile, reset DB module | Keep seedfile, remove content — entire DB reset |
| DB module reset scope | Keep client+schema+env, wipe data layer / Wipe everything / Wipe models+migrations only | Keep client, schema, env — wipe data layer |
| schema.ts fate | Wipe table definitions / Keep as-is | Wipe table definitions |

**User note:** "keep seedfile, remove the content - the entire db module should be reset (migrations and existing models removed)"

---

## Deferred Ideas

None.
