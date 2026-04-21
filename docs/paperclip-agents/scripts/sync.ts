#!/usr/bin/env bun
/**
 * Sync stitched per-role AGENTS.md into each agent's Paperclip managed bundle.
 *
 * For each role listed in docs/paperclip-agents/agents.json:
 *   - copies <role>/AGENTS.md → $PAPERCLIP_HOME/instances/<instance>/companies/<companyId>/agents/<agentId>/instructions/AGENTS.md
 *   - removes orphan HEARTBEAT.md / SOUL.md / TOOLS.md siblings in that directory,
 *     since persona + heartbeat + tools content has been folded into AGENTS.md.
 *
 * Usage:
 *   bun docs/paperclip-agents/scripts/sync.ts                       # apply
 *   bun docs/paperclip-agents/scripts/sync.ts --dry-run             # print plan, no writes
 *   bun docs/paperclip-agents/scripts/sync.ts --paperclip-home=DIR  # override $PAPERCLIP_HOME
 *   bun docs/paperclip-agents/scripts/sync.ts --instance=NAME       # override instance name (default: "default")
 *
 * Flags can also come from env: PAPERCLIP_HOME, PAPERCLIP_INSTANCE.
 *
 * Pre-flight: run `bun docs/paperclip-agents/scripts/stitch.ts --check` first.
 * Sync will refuse to run if any <role>/AGENTS.md is stale versus source fragments.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MANIFEST = join(ROOT, 'agents.json');
const ORPHAN_FILES = ['HEARTBEAT.md', 'SOUL.md', 'TOOLS.md'];

type Role = { slug: string; name: string; agentId: string };
type Manifest = { companyId: string; roles: Role[] };

function die(msg: string): never {
  console.error(`sync: ${msg}`);
  process.exit(1);
}

function parseFlag(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(`--${name}=`.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function loadManifest(): Manifest {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
  } catch (err) {
    die(`cannot read ${MANIFEST}: ${(err as Error).message}`);
  }
}

function paperclipHome(): string {
  return (
    parseFlag('paperclip-home') ??
    process.env.PAPERCLIP_HOME ??
    join(homedir(), '.paperclip')
  );
}

function instanceName(): string {
  return parseFlag('instance') ?? process.env.PAPERCLIP_INSTANCE ?? 'default';
}

function ensureStitchClean(): void {
  const proc = Bun.spawnSync({
    cmd: ['bun', join(HERE, 'stitch.ts'), '--check'],
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (proc.exitCode !== 0) {
    die(
      'stitched AGENTS.md files are stale — run `bun docs/paperclip-agents/scripts/stitch.ts` first',
    );
  }
}

function main(): void {
  const manifest = loadManifest();
  const dryRun = hasFlag('dry-run');
  const home = paperclipHome();
  const instance = instanceName();

  if (!dryRun) ensureStitchClean();

  for (const role of manifest.roles) {
    const srcAgents = join(ROOT, role.slug, 'AGENTS.md');
    if (!existsSync(srcAgents)) {
      die(`role "${role.slug}": source ${srcAgents} does not exist — run stitch first`);
    }
    const destDir = join(
      home,
      'instances',
      instance,
      'companies',
      manifest.companyId,
      'agents',
      role.agentId,
      'instructions',
    );
    const destAgents = join(destDir, 'AGENTS.md');
    const body = readFileSync(srcAgents, 'utf8');
    const prev = existsSync(destAgents) ? readFileSync(destAgents, 'utf8') : '';
    const changed = prev !== body;

    console.log(
      `${role.slug} (${role.name}) → ${destAgents}${changed ? '' : ' [unchanged]'}`,
    );

    const orphans: string[] = [];
    if (existsSync(destDir)) {
      for (const name of readdirSync(destDir)) {
        if (ORPHAN_FILES.includes(name)) orphans.push(join(destDir, name));
      }
    }
    if (orphans.length > 0) {
      for (const o of orphans) console.log(`  prune ${o}`);
    }

    if (dryRun) continue;

    mkdirSync(destDir, { recursive: true });
    if (changed) writeFileSync(destAgents, body, 'utf8');
    for (const o of orphans) rmSync(o, { force: true });
  }

  if (dryRun) console.log('sync: dry run, no changes applied');
}

main();
