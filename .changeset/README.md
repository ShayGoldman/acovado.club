# Changesets

This project uses [Changesets](https://github.com/changesets/changesets) to manage **per-package** semver and **per-package** `CHANGELOG.md` files for every app and module. Versions are never published to npm — they are inlined at `bun build` time and surfaced on each app's `/health` response (or on worker startup logs).

## Model

- Every `apps/*` and `modules/*` package has its own `version` field in `package.json`, starting at `0.1.0`.
- Every `apps/*` and `modules/*` package has its own `CHANGELOG.md` adjacent to its `package.json`.
- Internal dependency bumps cascade mechanically: when a `modules/*` package gets a `minor` or `major` bump, each app that consumes it picks up a `patch` bump automatically (`updateInternalDependencies: patch`).
- Dev-only packages (`clients/*`, `tests/*`, `infra/*`, `config/*`) are ignored by Changesets — they do not carry versions or changelogs.
- No root `CHANGELOG.md`. No npm publish. No git tags. The version string lives in each container and is visible via `/health` or startup logs.

## When to add a changeset

Add a changeset whenever your change would be visible to somebody outside the package:

- **Apps** (`apps/dashboard`, `apps/reddit-worker`, `apps/signal-processor`, `apps/youtube-worker`) — any change to behavior visible to the internal team: new endpoint, changed response shape, changed pipeline semantics, changed env-var handling, changed logging that the team relies on.
- **Modules** (`modules/*`) — any change to the module's **public API surface**: exported types, exported factory-function signatures, exported schema fields, etc. Internal refactors with no exported-surface change do not need a changeset.

Skip changesets for:

- Pure test additions or refactors.
- Doc-only changes (this file, `README.md`, `docs/*`, `.cursor/*`).
- CI-only changes (`.drone.yml`, `.github/*`) unless they change what gets deployed.
- Dependency bumps that do not alter behavior (lockfile-only changes from `bun install`).

## Adding a changeset

```bash
bun changeset
```

This prompts you to:
1. Pick which packages the change affects.
2. Pick a **bump type** per affected package (see below).
3. Write a one-line description of the change.

The prompt writes a `.changeset/<slug>.md` file. Commit it alongside the code change in the same PR.

## Bump types

- **`patch`** — bug fixes, internal-only changes that leak into behavior (e.g. logging format shifts), or reactive dependency updates. Default choice.
- **`minor`** — new backward-compatible behavior: a new endpoint, a new exported function, a new optional config field. Existing callers keep working.
- **`major`** — a **breaking** change to a module's public API or to an app's contract (removed endpoint, renamed exported symbol, changed required env var, changed response shape). **Coordinate with Principal Engineer before choosing `major`.** Major bumps require a documented rationale in the PR and — when crossing module boundaries — a Principal review on the contract shift itself, not just on the changeset entry.

If you are unsure between `patch` and `minor`: if an external caller (another app in this repo) needs to know the change happened to take advantage of it, it's `minor`. If they do not need to know, it's `patch`.

## Release flow

**Developers do not run `bun changeset:version`.** That command is run exclusively by the **Release Manager** as part of the release-PR workflow:

1. Cut `release/YYYY-MM-DD` from `main`.
2. `bun changeset version` bumps `version` in affected `package.json` files, writes/updates each affected `CHANGELOG.md`, and deletes the consumed `.changeset/*.md` files — all in one mechanical commit.
3. Open the release PR. Principal Engineer reviews the diff (mechanical only).
4. Merge with `[trigger-main-deploy]`. Drone builds the bumped containers; `/health` reports the new semver.

Full workflow, rollback procedure, and boundaries live in [`docs/paperclip-agents/release-manager.md`](../docs/paperclip-agents/release-manager.md).

## Config

`.changeset/config.json`:

- `ignore: ["@clients/*", "@tests/*", "@infra/*", "@config/*"]` — dev-only workspaces never get versions.
- `updateInternalDependencies: "patch"` — module bumps cascade into app patches mechanically.
- `commit: false` — Changesets never auto-commits; the release PR is a single mechanical commit by the Release Manager.
- `access: "restricted"` — never publish to npm (defensive; the flow never runs `changeset publish` anyway).
