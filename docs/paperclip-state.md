# Paperclip state (Acovado)

Canonical IDs and runtime wiring for the **Acovado** company in Paperclip. Update this file when org or adapter settings change.

## Company

| Field | Value |
|--------|--------|
| Company id | `13cc5b1d-21ff-426e-8987-8235899922a1` |
| Monorepo project id | `91e2b5c6-c178-4a89-8567-41746f4ef3b2` |

## Agent runtime (all agents)

| Field | Value |
|--------|--------|
| Adapter (Paperclip) | **`cursor`** (UI: Cursor (local)) |
| Working directory (`cwd`) | `/Users/shayg/.paperclip/instances/default/projects/13cc5b1d-21ff-426e-8987-8235899922a1/91e2b5c6-c178-4a89-8567-41746f4ef3b2/_default` |
| Instructions root (per agent) | `/Users/shayg/.paperclip/instances/default/companies/13cc5b1d-21ff-426e-8987-8235899922a1/agents/<agent-id>/instructions` |
| Entry file | `AGENTS.md` (managed bundle) |
| `maxTurnsPerRun` | `1000` |

Applied in Paperclip: **2026-04-12** (all six agents patched to `adapterType: "cursor"` with the config above).

## Agents

| Name | Paperclip id | Notes |
|------|----------------|--------|
| GM | `073e20f6-9dbd-44ae-ad7e-7fa44504f651` | |
| CTO | `6592e557-dba9-4d48-a269-24609551f2d6` | |
| Principal Engineer | `4d1b0cfb-1fdf-4a51-bc83-aa4a2ac0661d` | |
| DevOps Engineer | `53f36313-4f90-47aa-ab40-274cc40dff63` | |
| Backend Engineer | `553a3304-db22-4ce9-9d7a-b72cb3796e88` | |
| Advisor | `32592a16-922c-42fb-bf08-a00e5510108f` | |

Instruction source of truth in git: [`docs/paperclip-agents/`](./paperclip-agents/README.md).

Each role file in that folder is copied to the agent’s Paperclip managed bundle as `instructions/AGENTS.md` (same basename mapping: `gm.md` → GM, `cto.md` → CTO, `principal-engineer.md` → Principal, `devops-engineer.md` → DevOps, `backend-engineer.md` → Backend, `advisor.md` → Advisor). **`adapterConfig`** paths above must stay aligned with those files.

**Last instruction + API alignment:** 2026-04-13 — repo markdown written to each agent’s `instructions/AGENTS.md`; `PATCH /api/agents/{id}` applied with `adapterType: "cursor"` and merged `adapterConfig` (paths + `maxTurnsPerRun`, bundle mode, entry file).

## API note (board UI)

Authenticated `PATCH` / `POST` to the Paperclip API may return **403** unless the request includes **`Origin`** and **`Referer`** matching the dashboard host (e.g. `http://shays-macbook-pro:3100`).
