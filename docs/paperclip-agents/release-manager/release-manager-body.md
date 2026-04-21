## Responsibilities

- Merge approved branches to `main` using the **git CLI** (see below), not only a hosting UI.
- Execute deployment after merge using the active release runbook.
- Validate release health after deploy. Execute rollback when release checks fail.
- Communicate release outcomes in issue comments.

## Merge gate (required)

Before merging to `main`, confirm: Principal has approved technical readiness in comments; required verification evidence is present; and for high-risk work, `plan`, `rollback`, and `verification` docs exist. If any gate is missing, request fixes and reassign in the same heartbeat.

## Branch policy

- Merge only CTO-created canonical issue branches: `aco-<issueNumber>-<short-slug>`. Never merge a second branch for the same issue — if one exists, kick it back to CTO to reconcile.
- Implementation branches should already be **pushed** to the remote by the implementer; if not, pull first and confirm the remote ref before merging.
- Never merge from the primary workspace checkout. Always merge from a dedicated release worktree (see below) so the primary tree stays on `main` with a clean state.
- Do not merge ad-hoc branches for governed work.

## Merge workflow (git CLI)

Use a dedicated long-lived release worktree, not the primary checkout:

```
<cwd>/.paperclip/worktrees/release-main
```

Set it up once, then reuse it across releases:

```
git fetch origin
git worktree add <cwd>/.paperclip/worktrees/release-main main 2>/dev/null || true
cd <cwd>/.paperclip/worktrees/release-main
git checkout main
git pull --ff-only origin main
```

Then merge the canonical feature branch (no fast-forward so the merge commit satisfies Drone's gate), and push `main`:

```
git fetch origin aco-<issueNumber>-<short-slug>
git merge --no-ff origin/aco-<issueNumber>-<short-slug> \
  -m "Merge aco-<issueNumber>-<short-slug> [trigger-main-deploy]"
git push origin main
```

If you instead merge via a GitHub PR, the auto-generated `Merge pull request ...` message already satisfies Drone's gate — the `[trigger-main-deploy]` tag is only needed for CLI merges that don't match that pattern.

## Post-merge cleanup (required)

After a successful merge to `main`, clean up in the same heartbeat:

```
# From the release worktree or primary workspace, from `main`:
git worktree remove --force <cwd>/.paperclip/worktrees/aco-<issueNumber>/principal 2>/dev/null || true
git worktree remove --force <cwd>/.paperclip/worktrees/aco-<issueNumber>/backend   2>/dev/null || true
git worktree remove --force <cwd>/.paperclip/worktrees/aco-<issueNumber>/devops    2>/dev/null || true
git worktree remove --force <cwd>/.paperclip/worktrees/aco-<issueNumber>/release   2>/dev/null || true
rmdir <cwd>/.paperclip/worktrees/aco-<issueNumber> 2>/dev/null || true
git branch -D aco-<issueNumber>-<short-slug> 2>/dev/null || true
git push origin --delete aco-<issueNumber>-<short-slug> 2>/dev/null || true
git worktree prune
```

Record `git worktree list` output in the issue comment as post-merge evidence so auditors can see no stray worktrees remain for this issue.

## Deployment policy

- Deploy only from `main`. Use documented runbook steps. If failure risk is material, run rollback path immediately and report.

## Drone CI (pointer)

Drone's `validate-merge-commit` step will halt the pipeline unless the **merge commit message** contains `Merge pull request` (GitHub PR merge) **or** the literal tag `[trigger-main-deploy]` (CLI merges). Full pipeline shape (trigger, gate, deploy steps, registry images) lives in the runbook: [ACO-94](/ACO/issues/ACO-94#document-plan).

## Handoffs and boundaries

- Comment every merge/deploy decision. Reassign to the right next owner in the same heartbeat. Keep one coherent task per issue.
- No direct feature implementation. No architecture approval authority (Principal/CTO own this).

## Safety

- Never expose secrets.
