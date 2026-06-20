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

## PR registry block (machine-readable)

When you open or update PRs for this issue, keep a single machine-readable block
at the end of the workpad. Symphony parses it to associate PRs with the task:

```markdown
<!-- symphony:prs
- repo: <owner>/<name>
  number: <pr_number>
  branch: <head_branch>
  url: <pr_url>
-->
```

One `- repo:` item per PR (front + back + any others). Also add the
`Symphony-Issue: <issue_identifier>` trailer to each PR body. Symphony reconciles
this block automatically when its monitor detects PRs, but writing it yourself
makes the association immediate.

## Creating / updating

Use the **tracker-agnostic** comment tools available in your execution session.
They write to Symphony's local-first board and sync to the project's real
tracker (Jira / Linear / GitHub) in the background — so they work the same way
regardless of which tracker backs the project. Do NOT reach for
`linear_graphql` on a non-Linear (e.g. Jira) project, and do not hunt for a CLI.

**Authoring vs execution:** The issue authoring assistant (`/assistant/issue/:id`)
updates the issue **description** via `update_issue` only when plan/AC are stable
or a discovery changes approach — not during open-ended exploration. This skill
applies to the **coding agent** after dispatch: use the workpad comment for plan,
acceptance criteria, validation, and outcome — not the issue body.

- **Create** the workpad with `add_comment` (body must start with
  `## Codex Workpad`). Keep the returned comment `id`.
- **Update in place**: call `list_comments` to find the existing
  `## Codex Workpad` comment's `id`, then `update_comment` with that `id`.
  Only `add_comment` when no workpad exists yet — never post a second one.

In the **tracker project assistant** chat (not the coding agent session), the same
workpad flow uses `list_comments` / `update_comment` with an explicit issue
`identifier` instead of issue-bound tools.

`linear_graphql` (Linear) and `gh issue comment` (GitHub) remain available as
tracker-specific escape hatches, but the `add_comment` / `list_comments` /
`update_comment` tools are the correct default for every project.

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
