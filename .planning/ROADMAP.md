# Roadmap: acovado.club

## Overview

Milestone 1 is a single cleanup phase: remove all FalkorDB graph artifacts left over from the previous scrapped approach, fix the known bugs identified in the codebase audit, and leave the codebase in a clean state ready for the Paperclip integration and Reddit ingestion pipeline milestones that follow.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Cleanup** - Remove FalkorDB graph artifacts and fix known bugs from the previous iteration

## Phase Details

### Phase 1: Cleanup
**Goal**: The codebase contains no dead FalkorDB graph code and all known pre-existing bugs are fixed
**Depends on**: Nothing (first phase)
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04, CLEAN-05
**Success Criteria** (what must be TRUE):
  1. No FalkorDB graph schema definitions, model files, or Cypher query code remain in `modules/graph-db/` or `modules/db/`
  2. The seed script uses the correct ticker symbol `GOOGL` and no references to `GOOGLE` remain in seed data
  3. All `producer.send()` calls in the simulation are awaited — publish errors surface rather than being silently swallowed
  4. The E2E test file no longer contains the `expect(1).toBe(1)` stub — it is either a meaningful structural placeholder or deleted
  5. `bun run` and CI pass with no type errors or import failures caused by removed modules
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — Reset modules/db: delete models/ and migrations/, clear schema.ts and seed.ts, update barrel export
- [x] 01-02-PLAN.md — Point fixes: delete reset-reddit-data.ts, await producer.send(), replace E2E stub with test.todo

## Progress

**Execution Order:**
Phases execute in numeric order: 1

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Cleanup | 2/2 | Complete | 2026-04-11 |
