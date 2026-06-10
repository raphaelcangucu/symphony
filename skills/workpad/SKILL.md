---
name: workpad
description:
  Create and maintain the single `## Codex Workpad` comment on the tracked
  issue: plan, acceptance criteria, validation results, and outcome. Use at
  the start of every issue run and whenever progress changes.
---

# Workpad

## Goals

- Exactly ONE comment per issue whose body starts with `## Codex Workpad`.
- It is the human-readable source of truth: plan, acceptance criteria,
  validation, outcome.
- Always EDIT the existing workpad in place; never post a second one.

## Structure (use exactly these sections)

```markdown
## Codex Workpad

### Plan
- [ ] step 1
- [ ] step 2

### Acceptance criteria
- criterion 1

### Validation
(test commands you ran and their results; updated as you go)

### Outcome
(one of: `in-progress`, `done — PR <url>`, or `no-op — <justification>`)
```

## Creating / updating

Use the tracker tool available in your session:

- Local-first projects (Linear/GitHub/Jira synced): create or update the
  comment through the project's comment mechanism (`add_comment` API /
  `linear_graphql` `commentCreate`-`commentUpdate` / `gh issue comment` with
  `--edit-last` for updates). Symphony syncs it to the remote tracker.
- To update: fetch the existing workpad comment id first; only create a new
  comment when none exists.

## No-op outcome

If after investigation the task requires no changes, record it explicitly:

```markdown
### Outcome
no-op — <why nothing needed to change>
```

Symphony's gates accept a clean working tree only when this outcome is
recorded.

## Definition of done (Symphony plan gate)

Symphony verifies after your first turn that a comment whose body starts with
`## Codex Workpad` exists on the issue, containing a Plan and Acceptance
criteria. Create it BEFORE writing any code.
