# REQUIREMENTS.md

> Milestone 1 — Cleanup
> Generated: 2026-04-11

---

## v1 Requirements

### Cleanup

- [ ] **CLEAN-01**: Remove dead FalkorDB graph models and schema definitions from `modules/graph-db/` and `modules/db/`
- [ ] **CLEAN-02**: Remove leftover graph query code and any modules that served only the old graph approach
- [ ] **CLEAN-03**: Fix seed script: wrong ticker symbol `GOOGLE` → `GOOGL`
- [ ] **CLEAN-04**: Fix unawaited `producer.send()` in simulation — add `await` to prevent silent publish errors
- [ ] **CLEAN-05**: Remove E2E stub (`expect(1).toBe(1)`) — replace with a structural placeholder or delete the file

---

## Deferred (future milestones)

- Paperclip agent orchestration integration
- Reddit ingestion pipeline
- Signal processing and ticker grouping
- Dashboard / output layer
- Additional sources: YouTube, news, SEC trades

---

## Out of Scope

- Dashboard / UI — deferred to a later milestone
- External users / auth — internal tool only
- YouTube transcription — future source expansion
- News agency ingestion — future source expansion
- Public figures' trades — future source expansion

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CLEAN-01 | Phase 1: Cleanup | Pending |
| CLEAN-02 | Phase 1: Cleanup | Pending |
| CLEAN-03 | Phase 1: Cleanup | Pending |
| CLEAN-04 | Phase 1: Cleanup | Pending |
| CLEAN-05 | Phase 1: Cleanup | Pending |
