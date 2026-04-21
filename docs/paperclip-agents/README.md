# Paperclip agent instructions (source-of-truth)

Company IDs, adapter type, and `cwd` / instructions paths live in **[`../paperclip-state.md`](../paperclip-state.md)**.

This directory is the **canonical source** for every Acovado agent's instruction bundle. Each agent's managed `AGENTS.md` is composed (stitched) from three fragments; shared policy is edited in one place and substituted into every role.

## Layout

```
docs/paperclip-agents/
├── README.md                   ← this file
├── agents.json                 ← role-slug → name → agentId manifest (used by sync)
├── shared/
│   └── policy-blocks.md        ← 3-bullet shared Operating policy (edited ONCE)
├── scripts/
│   ├── stitch.ts               ← composes <role>/AGENTS.md from source fragments
│   └── sync.ts                 ← copies stitched AGENTS.md into Paperclip bundles
└── <role>/
    ├── <role>-header.md        ← preamble + Heartbeat communication + metadata
    ├── <role>-body.md          ← role-specific responsibilities
    └── AGENTS.md               ← stitched output (do NOT edit by hand)
```

## How a role's AGENTS.md is composed

Stitch order, per role:

1. `<role>/<role>-header.md` — identity, cadence, heartbeat communication norms. Leading HTML comment carries metadata (`slug:` + `checkout_trigger:`).
2. `shared/policy-blocks.md` — three non-negotiable rules (idle issue, waiting-on-agent, read-only-checkout). The `{{CHECKOUT_TRIGGER}}` placeholder is replaced with the role's metadata value.
3. `<role>/<role>-body.md` — role-specific responsibilities, gates, boundaries, safety.

Output is byte-deterministic: re-running `stitch` without source changes produces the same bytes.

## Editing workflow

1. Edit the right fragment:
   - Shared rule change → `shared/policy-blocks.md`.
   - Role-specific change (responsibilities, safety, boundaries, tooling) → `<role>/<role>-body.md`.
   - Identity / heartbeat tone / examples → `<role>/<role>-header.md`.
2. Regenerate stitched outputs: `bun run agents:stitch` (or `bun docs/paperclip-agents/scripts/stitch.ts`).
3. Commit both the source fragment(s) **and** every `<role>/AGENTS.md` the change touched.
4. Push to each agent's Paperclip managed bundle: `bun run agents:sync`.

**Never edit `<role>/AGENTS.md` directly.** CI (and `agents:stitch:check`) will fail the build if a stitched file drifts from its source fragments.

## Commands

| Command | Purpose |
|---------|---------|
| `bun run agents:stitch` | Rebuild every `<role>/AGENTS.md` from source fragments. |
| `bun run agents:stitch:check` | Verify committed `AGENTS.md` match source (CI + pre-push). |
| `bun run agents:sync` | Copy stitched `AGENTS.md` into each agent's Paperclip instructions dir and prune orphan `HEARTBEAT.md` / `SOUL.md` / `TOOLS.md` siblings. Refuses to run if stitch is stale. |

Sync resolves each agent's target path from `agents.json`:
`$PAPERCLIP_HOME/instances/<instance>/companies/<companyId>/agents/<agentId>/instructions/AGENTS.md`
(defaults: `PAPERCLIP_HOME=~/.paperclip`, `PAPERCLIP_INSTANCE=default`; override with flags or env).

## Roles

| Slug | Agent |
|------|-------|
| [`gm`](./gm/AGENTS.md) | General Manager (GM / CEO) |
| [`cto`](./cto/AGENTS.md) | CTO |
| [`principal-engineer`](./principal-engineer/AGENTS.md) | Principal Engineer |
| [`backend-engineer`](./backend-engineer/AGENTS.md) | Backend Engineer |
| [`devops-engineer`](./devops-engineer/AGENTS.md) | DevOps Engineer |
| [`release-manager`](./release-manager/AGENTS.md) | Release Manager |
| [`advisor`](./advisor/AGENTS.md) | Advisor |
| [`product-manager`](./product-manager/AGENTS.md) | Product Manager |
| [`project-manager`](./project-manager/AGENTS.md) | Project Manager |

## Runbooks

Large role-adjacent reference material is extracted into sibling issues rather than inlined:

- [ACO-94](/ACO/issues/ACO-94#document-plan) — Drone CI pipeline shape, merge-gate semantics, deploy stages, registry image layout.

Add further runbook pointers here when new long-form references are extracted.

## Shared norms

Branches: `aco-<issueNumber>-<short-slug>` — created by CTO and pushed upstream before delegation.
Worktrees: one per implementer at `<cwd>/.paperclip/worktrees/aco-<issueNumber>/<agent-short-key>`.
Handoff: comment + reassign in the same heartbeat. Main stays green. Principal + CTO sign off high-risk work before Release Manager merges.
