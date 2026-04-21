#!/usr/bin/env bun
/**
 * Stitch per-role AGENTS.md from source fragments.
 *
 * Composition (in order):
 *   <role>/<role>-header.md
 *   shared/policy-blocks.md   (with {{CHECKOUT_TRIGGER}} substituted)
 *   <role>/<role>-body.md
 *
 * Role metadata lives in an HTML comment at the top of <role>-header.md, e.g.:
 *
 *   <!--
 *   slug: principal-engineer
 *   checkout_trigger: " or review outcomes"
 *   -->
 *
 * Determinism: output is byte-identical on re-runs when inputs are unchanged.
 * Fail-loud: missing fragments, missing metadata, or unknown placeholders exit non-zero.
 *
 * Usage:
 *   bun docs/paperclip-agents/scripts/stitch.ts           # write <role>/AGENTS.md
 *   bun docs/paperclip-agents/scripts/stitch.ts --check   # verify committed files match source
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SHARED_POLICY = join(ROOT, 'shared', 'policy-blocks.md');

type RoleMeta = {
  slug: string;
  checkout_trigger: string;
};

const ALLOWED_META_KEYS: readonly (keyof RoleMeta)[] = ['slug', 'checkout_trigger'];

function die(msg: string): never {
  console.error(`stitch: ${msg}`);
  process.exit(1);
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    die(`cannot read ${path}: ${(err as Error).message}`);
  }
}

function stripHtmlMetaComment(src: string): {
  meta: Record<string, string>;
  rest: string;
} {
  const match = src.match(/^<!--([\s\S]*?)-->\s*\n/);
  if (!match) return { meta: {}, rest: src };
  const body = match[1] ?? '';
  const meta: Record<string, string> = {};
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    meta[key] = val;
  }
  return { meta, rest: src.slice(match[0].length) };
}

function requireMeta(role: string, meta: Record<string, string>): RoleMeta {
  for (const key of ALLOWED_META_KEYS) {
    if (!(key in meta)) {
      die(`role "${role}": header is missing metadata key "${key}"`);
    }
  }
  for (const key of Object.keys(meta)) {
    if (!ALLOWED_META_KEYS.includes(key as keyof RoleMeta)) {
      die(`role "${role}": header has unknown metadata key "${key}"`);
    }
  }
  return {
    slug: meta.slug!,
    checkout_trigger: meta.checkout_trigger!,
  };
}

function renderPolicy(policySrc: string, trigger: string): string {
  // Drop the leading <!-- ... --> authoring note before substitution.
  const { rest } = stripHtmlMetaComment(policySrc);
  const out = rest.replace(/\{\{CHECKOUT_TRIGGER\}\}/g, trigger);
  if (/\{\{[A-Z_]+\}\}/.test(out)) {
    const leftover = out.match(/\{\{[A-Z_]+\}\}/)![0];
    die(`unsubstituted placeholder ${leftover} in shared policy block`);
  }
  return out;
}

function stitchRole(
  roleDir: string,
  policySrc: string,
): {
  slug: string;
  outPath: string;
  content: string;
} {
  const slug = basename(roleDir);
  const headerPath = join(roleDir, `${slug}-header.md`);
  const bodyPath = join(roleDir, `${slug}-body.md`);

  const rawHeader = readText(headerPath);
  const { meta, rest: header } = stripHtmlMetaComment(rawHeader);
  const parsed = requireMeta(slug, meta);
  if (parsed.slug !== slug) {
    die(`role "${slug}": header slug "${parsed.slug}" does not match directory name`);
  }

  const body = readText(bodyPath);
  const policy = renderPolicy(policySrc, parsed.checkout_trigger);

  // Determinism: fragments always joined with exactly one blank line between them,
  // and the final file ends with a single trailing newline.
  const pieces = [header, policy, body].map((p) => p.replace(/\s+$/, ''));
  const content = `${pieces.join('\n\n')}\n`;

  const outPath = join(roleDir, 'AGENTS.md');
  return { slug, outPath, content };
}

function listRoleDirs(): string[] {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => name !== 'shared' && name !== 'scripts')
    .map((name) => join(ROOT, name))
    .filter((dir) => {
      const slug = basename(dir);
      const header = join(dir, `${slug}-header.md`);
      try {
        return statSync(header).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

function main(): void {
  const check = process.argv.includes('--check');
  const policySrc = readText(SHARED_POLICY);

  const roleDirs = listRoleDirs();
  if (roleDirs.length === 0) {
    die('no role directories found under docs/paperclip-agents/');
  }

  const results = roleDirs.map((dir) => stitchRole(dir, policySrc));

  if (check) {
    let drift = 0;
    for (const r of results) {
      let current = '';
      try {
        current = readFileSync(r.outPath, 'utf8');
      } catch {
        console.error(`stitch --check: ${r.outPath} missing`);
        drift++;
        continue;
      }
      if (current !== r.content) {
        console.error(`stitch --check: ${r.outPath} is stale (re-run stitch)`);
        drift++;
      }
    }
    if (drift > 0) process.exit(1);
    console.log(`stitch --check: OK (${results.length} roles)`);
    return;
  }

  for (const r of results) {
    writeFileSync(r.outPath, r.content, 'utf8');
    console.log(`stitch: wrote ${r.outPath.slice(ROOT.length + 1)}`);
  }
}

main();
