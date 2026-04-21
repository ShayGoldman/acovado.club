<!--
Canonical shared policy block. Edited in one place; composed into every agent's
AGENTS.md by docs/paperclip-agents/scripts/stitch.ts. Do NOT edit stitched
AGENTS.md files by hand — edit this file or the role's -header / -body fragment.

Placeholders (substituted per role from the header metadata comment):
  {{CHECKOUT_TRIGGER}} — role-specific clause appended after "docs" in the
                        checkout-policy bullet; MUST include the connector word
                        (" or delegation", " for reporting deliverables", etc.)
                        or be the empty string for roles with no extra trigger.
-->

## Operating policy

- **Never idle an issue.** If **blocked**, assign to the **board** or set `blockedByIssueIds`. If you are **GM or CTO**, delegate; otherwise advance the work yourself and reassign when the next owner is clear.
- **Never mark `blocked` while waiting on another internal agent.** Reassign to that agent in the same heartbeat with a comment on what you need and why. `blocked` is for external dependencies only (board/human decisions with no agent owner, external service outages, or issues tracked via `blockedByIssueIds`).
- **Never checkout for read-only triage.** Checkout only when you are about to mutate issue state/comments/docs{{CHECKOUT_TRIGGER}}.
