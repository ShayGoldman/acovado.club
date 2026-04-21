## Branch workflow (required)

- Work only on the canonical branch created by CTO: `aco-<issueNumber>-<short-slug>`. Never create a second branch for the same issue; if the name looks wrong, stop and return the issue to CTO.
- Never implement or commit in the primary workspace checkout. Never work on a detached HEAD.

### Worktree lifecycle (concrete commands)

Your per-issue worktree path is:

```
<cwd>/.paperclip/worktrees/aco-<issueNumber>/backend
```

Before starting work on an issue:

```
git fetch origin
# If the path already exists and is stale, detached, or on the wrong branch:
git worktree remove --force <cwd>/.paperclip/worktrees/aco-<issueNumber>/backend || true
git worktree add <cwd>/.paperclip/worktrees/aco-<issueNumber>/backend aco-<issueNumber>-<short-slug>
cd <cwd>/.paperclip/worktrees/aco-<issueNumber>/backend
```

Before every commit, verify branch identity:

```
test "$(git rev-parse --abbrev-ref HEAD)" = "aco-<issueNumber>-<short-slug>"
```

If that check fails — or HEAD is detached — STOP, do not commit, and return the issue to CTO with the mismatch reported in a comment.

After each work heartbeat, push the branch so Release Manager can fetch it:

```
git push origin aco-<issueNumber>-<short-slug>
```

If the feature branch has fallen behind `main`, **you** rebase it onto `main` (not Release Manager). Release Manager only merges.

- Commit only to that canonical branch. Do not merge to `main`.
- Release Manager owns merge and deploy, and is responsible for removing the worktree and deleting the local branch after merge.

## Gate awareness

- If the task is marked high-risk, implementation starts only after the docs gate is approved (`plan`, `rollback`, `verification`). If the gate is missing, request clarification from CTO before coding.

## Execution quality

- Follow repo standards: Bun, Drizzle, tracing, structured logging, tests.
- Keep changes scoped and testable. Record verification evidence in issue comments.

## Handoffs and boundaries

- On completion/blocker, comment clear state and next action, and reassign to the next owner in the same heartbeat.
- Keep one coherent task per issue.
- When implementation is complete: if Principal review is still required, assign **Principal**. When work is complete **and** ready for merge/deploy (including after Principal approval when that applied), assign **Release Manager**.
- No direct merge to `main`. No silent assignee changes. No infra ownership drift; coordinate infra work with DevOps.

## Safety

- Never expose secrets.
