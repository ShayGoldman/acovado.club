/**
 * Board acceptance gate evidence capture for M3.
 * Queries news_articles for the 5 most recent success rows per source,
 * evaluates acceptance criteria, and emits a JSON evidence file + markdown table.
 *
 * Usage (on VPS or inside news-worker container):
 *   DATABASE_URL=... bun run scripts/news-fetch-gate.ts --output /tmp/gate-evidence.json
 */

import { writeFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/bun-sql';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema, newsArticles, sources } from '@modules/db';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const outputIdx = args.indexOf('--output');
const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : '/tmp/gate-evidence.json';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('ERROR: DATABASE_URL env var is required.');
  process.exit(1);
}

const db = drizzle({ connection: databaseUrl, casing: 'snake_case', schema });

// ---------------------------------------------------------------------------
// V1 sources
// ---------------------------------------------------------------------------

const V1_SOURCES = [
  'cnbc',
  'yahoo-finance',
  'marketwatch',
  'reuters',
  'bloomberg',
  'wsj',
  'ft',
  'seeking-alpha',
];

// ---------------------------------------------------------------------------
// Query: top-5 success rows per source
// ---------------------------------------------------------------------------

const sourceRows = await db
  .select({
    id: sources.id,
    externalId: sources.externalId,
    displayName: sources.displayName,
  })
  .from(sources)
  .where(and(eq(sources.kind, 'news'), inArray(sources.externalId, V1_SOURCES)));

const articleRows = await db
  .select({
    sourceId: newsArticles.sourceId,
    url: newsArticles.url,
    title: newsArticles.title,
    extractedBody: newsArticles.extractedBody,
    fetchedAt: newsArticles.fetchedAt,
  })
  .from(newsArticles)
  .where(eq(newsArticles.fetchStatus, 'success'))
  .orderBy(desc(newsArticles.fetchedAt));

// Group top-5 per source.
const bySource = new Map<string, typeof articleRows>();
for (const row of articleRows) {
  const existing = bySource.get(row.sourceId) ?? [];
  if (existing.length < 5) existing.push(row);
  bySource.set(row.sourceId, existing);
}

// ---------------------------------------------------------------------------
// Evaluate acceptance criteria per source
// ---------------------------------------------------------------------------

type SampleResult = {
  url: string;
  title: string | null;
  bodyLen: number;
  nonEmpty: boolean;
  minChars: boolean;
  distinctFromTitle: boolean;
  pass: boolean;
};

type SourceResult = {
  externalId: string;
  displayName: string | null;
  samples: SampleResult[];
  pass: boolean;
  failReason: string | null;
};

const results: SourceResult[] = [];

for (const externalId of V1_SOURCES) {
  const src = sourceRows.find((s) => s.externalId === externalId);
  const displayName = src?.displayName ?? null;
  const srcId = src?.id;
  const rows = srcId ? (bySource.get(srcId) ?? []) : [];

  if (rows.length < 5) {
    results.push({
      externalId,
      displayName,
      samples: [],
      pass: false,
      failReason: `Only ${rows.length} success rows (need 5)`,
    });
    continue;
  }

  const samples: SampleResult[] = rows.map((row) => {
    const body = row.extractedBody ?? '';
    const title = row.title ?? '';
    const nonEmpty = body.length > 0;
    const minChars = body.length >= 500;
    const distinctFromTitle = body !== title && !title.includes(body);
    return {
      url: row.url,
      title: row.title,
      bodyLen: body.length,
      nonEmpty,
      minChars,
      distinctFromTitle,
      pass: nonEmpty && minChars && distinctFromTitle,
    };
  });

  const allPass = samples.every((s) => s.pass);
  const failReason = allPass
    ? null
    : samples
        .filter((s) => !s.pass)
        .map((s) => {
          const reasons: string[] = [];
          if (!s.nonEmpty) reasons.push('empty body');
          if (!s.minChars) reasons.push(`body < 500 chars (${s.bodyLen})`);
          if (!s.distinctFromTitle) reasons.push('body is substring of title');
          return `${s.url}: ${reasons.join(', ')}`;
        })
        .join('; ');

  results.push({ externalId, displayName, samples, pass: allPass, failReason });
}

// ---------------------------------------------------------------------------
// Emit JSON evidence file
// ---------------------------------------------------------------------------

writeFileSync(
  outputPath!,
  JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2),
  'utf-8',
);
console.log(`Evidence written to ${outputPath}`);

// ---------------------------------------------------------------------------
// Print markdown table to stdout
// ---------------------------------------------------------------------------

const tableHeader =
  '| Source | `sources.external_id` | Samples captured | Non-empty | ≥ 500 chars | Distinct from title | **Result** |';
const tableSep =
  '|--------|----------------------|-----------------|-----------|-------------|---------------------|------------|';

console.log('\n## Board Acceptance Gate — Per-Source Results\n');
console.log(tableHeader);
console.log(tableSep);

for (const r of results) {
  const name = r.displayName ?? r.externalId;
  const count = r.samples.length;
  const nonEmpty = count > 0 ? (r.samples.every((s) => s.nonEmpty) ? '✓' : '✗') : '—';
  const minChars = count > 0 ? (r.samples.every((s) => s.minChars) ? '✓' : '✗') : '—';
  const distinct =
    count > 0 ? (r.samples.every((s) => s.distinctFromTitle) ? '✓' : '✗') : '—';
  const result = r.pass ? '**PASS**' : '**FAIL**';
  console.log(
    `| ${name} | \`${r.externalId}\` | ${count}/5 | ${nonEmpty} | ${minChars} | ${distinct} | ${result} |`,
  );
}

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log(`\n**${passed} PASS / ${failed} FAIL** of ${results.length} v1 sources.\n`);

if (passed < 3) {
  console.error(
    'INTAKE GATE FAILED: Fewer than 3 of 8 v1 sources passed. Surface to CTO before finalising the outlet list.',
  );
  process.exit(2);
}

if (failed > 0) {
  console.log('Failed sources should be dropped per Verification §6.');
  for (const r of results.filter((r) => !r.pass)) {
    console.log(`  - ${r.externalId}: ${r.failReason}`);
  }
}

process.exit(0);
