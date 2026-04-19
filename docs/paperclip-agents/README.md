# Paperclip agent instructions (end-state)

Company IDs, adapter type, and `cwd` / instructions paths live in **[`../paperclip-state.md`](../paperclip-state.md)**.

These files are the **canonical instruction text** for Acovado agents in Paperclip. Copy or symlink them into each agent’s Paperclip `instructions/` directory (where `AGENTS.md` is configured), or merge changes into the managed bundles your instance uses.

| File | Role |
|------|------|
| [`gm.md`](./gm.md) | General Manager (CEO) |
| [`cto.md`](./cto.md) | CTO |
| [`principal-engineer.md`](./principal-engineer.md) | Principal Engineer |
| [`devops-engineer.md`](./devops-engineer.md) | DevOps Engineer |
| [`backend-engineer.md`](./backend-engineer.md) | Backend Engineer |
| [`advisor.md`](./advisor.md) | Advisor (daily team performance) |

**Communication:** be concise — give what is needed for the next action (facts, decisions, next steps). Do not over-explain; add detail only when ambiguity or risk requires it.

Shared engineering norms (see IC + CTO `AGENTS.md`): branches `aco-<n>-slug`, **main** must stay green on merge, **review** chain (Principal/CTO), **handoff** = comment + assign, **specs** = explore + board questions before locking; **Advisor** watches handoffs/idleness.

`$AGENT_HOME` and other placeholders match Paperclip’s usual instruction layout.
