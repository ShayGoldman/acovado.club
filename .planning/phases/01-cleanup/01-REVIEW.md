---
phase: 01-cleanup
reviewed: 2026-04-11T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - modules/db/src/index.ts
  - modules/db/src/schema.ts
  - modules/db/src/seed.ts
  - tests/e2e/src/health.e2e.test.ts
  - tests/stock-events-simulation/src/simulation.ts
findings:
  critical: 2
  warning: 4
  info: 3
  total: 9
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-04-11T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Five files were reviewed: the `modules/db` barrel (`index.ts`), the schema definition (`schema.ts`), a seed stub (`seed.ts`), the e2e health test suite, and the stock-events simulation runner.

The simulation file (`simulation.ts`) is the most active file and contains the most significant issues. Two critical security vulnerabilities exist in `modules/db/src/migrate.ts` (re-exported via `index.ts`): raw SQL string interpolation of both schema/table identifiers and migration data values. The simulation also references schema tables (`schema.signalMetrics`, `schema.tickers`) that do not exist in `modules/db/src/schema.ts`, which is currently empty (`export const schema = {}`). This is the highest-priority correctness issue.

The remaining files are stubs or placeholders with minor quality notes.

---

## Critical Issues

### CR-01: SQL Injection via String Interpolation in Migration INSERT

**File:** `modules/db/src/migrate.ts:127-130`
**Issue:** The migration tracking `INSERT` statement is built by directly interpolating the `file` (filename) and `checksum` strings into a raw SQL string using `sql.raw(...)`. While these values are derived from the filesystem rather than user input, using `sql.raw` with string interpolation bypasses all parameterization. If a migration filename or checksum ever contained a single quote or SQL metacharacter, this would produce broken or malicious SQL. The pattern normalizes a dangerous practice.
**Fix:**
```typescript
// Use parameterized drizzle sql tagged template instead of sql.raw
const insertQuery = sql`
  INSERT INTO ${sql.identifier(schema)}.${sql.identifier(table)} (filename, checksum)
  VALUES (${file}, ${checksum});
`;
await tx.execute(insertQuery);
```

### CR-02: SQL Injection via Unquoted Schema/Table Identifiers in DDL Queries

**File:** `modules/db/src/migrate.ts:25-36`
**Issue:** `ensureMigrationsTable` and `getAppliedMigrations` build DDL and SELECT statements by directly interpolating the `schema` and `table` strings (e.g., `CREATE SCHEMA IF NOT EXISTS ${schema}`, `SELECT filename, checksum FROM ${schema}.${table}`). These values come from caller-supplied `MigrationOpts`, giving any caller indirect control over the SQL structure. An attacker who can influence config could inject arbitrary SQL.
**Fix:**
```typescript
// Validate schema/table names against a strict allowlist or use identifier quoting
function assertSafeIdentifier(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
}
// Then call assertSafeIdentifier(schema) and assertSafeIdentifier(table)
// before using them in raw SQL strings.
```

---

## Warnings

### WR-01: Simulation References Non-Existent Schema Tables

**File:** `tests/stock-events-simulation/src/simulation.ts:49-61`
**Issue:** The simulation queries `schema.signalMetrics` and `schema.tickers` via `@modules/db`. However, `modules/db/src/schema.ts` exports `export const schema = {}` — an empty object. Both table references will be `undefined` at runtime, causing Drizzle to throw when `.from(schema.signalMetrics)` is called. This makes the entire simulation non-functional.
**Fix:** Define the `signal_metrics` and `tickers` tables in `modules/db/src/schema.ts` under the `acovado` pgSchema. This is a prerequisite for the simulation to run at all.

### WR-02: `and(...conditions)` Called with Potentially Zero Arguments

**File:** `tests/stock-events-simulation/src/simulation.ts:59`
**Issue:** When `inputs.tickers` is empty and `inputs.start`, `inputs.end`, and `inputs.type` are all falsy/empty, the `conditions` array will be empty and `and(...conditions)` is called with no arguments. Drizzle's `and()` returns `undefined` for an empty argument list, which is passed directly as the `.where()` argument. Depending on the Drizzle version, this silently omits the WHERE clause (fetching all rows) rather than signaling intent.
**Fix:**
```typescript
const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
return whereClause;
// Or: if (conditions.length === 0) { c.log.warn('No filters applied — fetching all signals'); }
```

### WR-03: `producer.disconnect()` Never Called — Resource Leak

**File:** `tests/stock-events-simulation/src/simulation.ts:36-93`
**Issue:** `producer.connect()` is called at line 36 but `producer.disconnect()` is never called. If an error is thrown inside `tracer.with(...)`, the AMQP connection is abandoned without cleanup. This is especially visible in the 5-second hardcoded `setTimeout` at line 91 that explicitly notes it's waiting for events to drain — yet still does not close the producer.
**Fix:**
```typescript
try {
  await producer.connect();
  await tracer.with('Running simulation', { attributes: inputs }, async (c) => { ... });
} finally {
  await producer.disconnect();
}
```

### WR-04: Altered Migration Already Applied — Checksum Mismatch Runs the Migration Again

**File:** `modules/db/src/migrate.ts:207-210`
**Issue:** The pending migration filter includes files where `applied.get(filename) !== checksum`, meaning a migration that was already applied but whose file content changed on disk will be run again. Re-running an already-applied schema migration (e.g., `CREATE TABLE`) will fail in most SQL databases. The intent appears to be detecting drift, not re-applying. This logic conflict will cause runtime failures in any environment where a migration file is reformatted or normalized after first apply.
**Fix:**
```typescript
// Only run migrations that have not been applied at all; treat checksum mismatch as drift
const pending = migrationFiles.filter(({ filename }) => !applied.has(filename));
// Add a separate drift check for changed checksums:
const modifiedAfterApply = migrationFiles.filter(
  ({ filename, checksum }) => applied.has(filename) && applied.get(filename) !== checksum,
);
if (modifiedAfterApply.length > 0) {
  throw new Error(`Applied migration files have been modified: ${modifiedAfterApply.map(f => f.filename).join(', ')}`);
}
```

---

## Info

### IN-01: Typo in Log Message

**File:** `tests/stock-events-simulation/src/simulation.ts:20`
**Issue:** `'Intializing simulation...'` is a misspelling of "Initializing".
**Fix:** Change to `'Initializing simulation...'`.

### IN-02: Hardcoded 5-Second Magic Number with TODO Comment

**File:** `tests/stock-events-simulation/src/simulation.ts:91`
**Issue:** `await new Promise((resolve) => setTimeout(resolve, 5000))` uses a magic number and the accompanying `// TODO wait until all events are consumed properly` comment acknowledges this is not correct behavior. The 5-second sleep is unreliable: too short on a slow broker, wasteful otherwise.
**Fix:** Track in-flight messages and await a proper drain signal, or at minimum extract the constant: `const PRODUCER_DRAIN_TIMEOUT_MS = 5_000;`.

### IN-03: `modules/db/src/index.ts` Re-exports `./migrate` — Internal Migration API Becomes Public

**File:** `modules/db/src/index.ts:5`
**Issue:** `export * from './migrate'` exposes `makeMigrateDB` and its option interfaces as part of the public `@modules/db` API. Migration is an internal operational concern and should not be consumed by application modules. Inadvertent use by other modules could result in multiple migration runners or coupling to internal DB tooling details.
**Fix:** Remove `export * from './migrate'` from `index.ts` and import `makeMigrateDB` directly in the migration entry point (`src/migrate.ts`) rather than through the barrel.

---

_Reviewed: 2026-04-11T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
