# Pre-merge snapshot — ACO-91 instruction-bundle rewrite

This file is the rollback anchor for [ACO-91](/ACO/issues/ACO-91) (instruction-bundle
dedupe + collapse + Drone runbook extraction). It exists so anyone can recover the
pre-rewrite state from this repo alone, without needing to replay memory or inspect
a live Paperclip instance.

## Baseline

- Pre-merge `main` SHA: `631121b`
- Git tag (pushed to `origin`): `aco-91-prebaseline`
- Snapshot attachment on ACO-91: `aco-91-prebaseline.json` (attachment id
  `2457e485-a0a5-4698-a528-ec89f4e7e2b0`, sha256
  `d019d90e2adb5fb714ed1406eda71c170130f02042220fca4d7a8bd4a4b74899`,
  fetch via `/api/attachments/2457e485-a0a5-4698-a528-ec89f4e7e2b0/content`)

The snapshot contains, for every agent: `instructionsDir`, `instructionsFilePath`,
and the full byte content of every file in its managed bundle at the moment of
capture — including `HEARTBEAT.md` / `SOUL.md` / `TOOLS.md` siblings that are not
part of repo source. It also contains the full content of every file in
`docs/paperclip-agents/` at that SHA.

## Per-agent file tree at baseline

| Agent | Managed bundle files |
|-------|----------------------|
| GM (`073e20f6`) | `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md`, `TOOLS.md` |
| Principal Engineer (`4d1b0cfb`) | `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md` |
| CTO (`6592e557`) | `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md` |
| Backend Engineer (`553a3304`) | `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md` |
| DevOps Engineer (`53f36313`) | `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md` |
| Release Manager (`d06ebdbb`) | `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md` |
| Product Manager (`355856ce`) | `AGENTS.md` |
| Project Manager (`78a2f99d`) | `AGENTS.md` |
| Advisor (`32592a16`) | `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md`, `TOOLS.md` |

## `instructionsFilePath` per agent

All agents use `adapterType: claude_local`,
`instructionsBundleMode: "managed"`, `instructionsEntryFile: "AGENTS.md"`, and
`instructionsFilePath` of the form:

```
$PAPERCLIP_HOME/instances/default/companies/13cc5b1d-21ff-426e-8987-8235899922a1/agents/<agentId>/instructions/AGENTS.md
```

After this PR merges and the agent-bundle sync runs, every agent's
`instructionsFilePath` MUST still resolve to an `AGENTS.md` at the same path.
The stitch script writes `AGENTS.md` at the same managed-bundle location, so no
`adapterConfig` change is required.

## Rollback entry point

If the cut regresses a load-bearing rule in production:

1. Pause routines for every affected agent.
2. Revert the merge commit of this PR on `main` (see rollback document on
   [ACO-91](/ACO/issues/ACO-91#document-rollback), Phase 2).
3. Re-run the agent-bundle sync.
4. Diff each managed-bundle `AGENTS.md` against the corresponding entry in the
   snapshot attachment. Any drift means the sync did not restore cleanly —
   restore from the attachment directly.

Partial rollback of a single role is in the rollback document Phase 4.

## Why this file exists

The rollback document gives the procedure; this file makes the procedure
executable from the repo. The snapshot attachment lives on the Paperclip issue,
which is fine during normal operation but fragile if the issue tracker is
unreachable. Keeping the tag name and attachment id in-tree is deliberate
belt-and-braces.
