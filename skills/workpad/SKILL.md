---
name: workpad
description: >-
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
source_plan: docs/superpowers/plans/YYYY-MM-DD-feature-plan.md
mode: full-plan
scope_status: in_progress
final_validate_allowed: false
final_publish_allowed: false

- [ ] Task 1: first plan task
  validation: pending
  evidence: pending
  commit: pending
- [ ] Task 2: second plan task
  validation: pending
  evidence: pending
  commit: pending

### Acceptance criteria
- criterion 1

### Validation
(test commands you ran and their results; updated as you go)

### Outcome
(one of: `in-progress`, `done — PR <url>`, or `no-op — <justification>`)
```

In the workpad comment, keep acceptance criteria as **plain bullets**. The
authoritative *checked* state lives in the **issue body** checklist, which you
update with `update_acceptance_criteria` during validation — see "Issue-body
acceptance criteria" below.

For runs that execute a written implementation plan, `### Plan` is both the
human checklist and the machine-readable runtime contract the orchestrator uses
to avoid treating a partial slice as final completion.

Rules:
- `source_plan` is the repo-relative plan path being executed.
- `mode` is usually `full-plan` for long plan execution.
- `scope_status` is `in_progress` until every plan task is complete.
- `final_validate_allowed` and `final_publish_allowed` stay `false` until
  `scope_status: complete`.
- In the `Plan` checklist, use `[x]` for complete, `[ ]` for not started, and
  `[~]` for partial. A `[~]` task must include a short `remaining:` list or note.
- Every implementation task tracks three independent gates under the checklist
  item:
  - `validation`: `pending`, `passed`, `failed`, `blocked`, or `n/a`
  - `evidence`: `pending`, `done`, `blocked`, or `n/a`
  - `commit`: `pending`, `done`, or `n/a`
- Do not mark a task `[x]` until its implementation is done, focused validation
  has passed, a task-scoped evidence manifest exists when applicable, and a
  task commit exists when applicable.
- Tests passing do NOT mean `evidence: done`. Evidence is done only after a
  fresh `.symphony/evidence/manifest.json` records runs for the current task
  with `task_id` and `task_title`.
- Do not set `scope_status: complete` while any task is `[ ]` or `[~]`, or while
  any `[x]` task has missing/non-terminal validation, evidence, or commit gates.
- Evidence before scope completion is slice evidence only; final evidence runs
  after all plan items are `[x]`.

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
acceptance criteria, validation, and outcome — not the issue body. The one
exception is ticking the issue-body acceptance checklist (next section).

## Issue-body acceptance criteria

When the issue **body** has an `## Acceptance criteria` section written as a
checklist (`- [ ]` items), keep it in sync as you prove each criterion. Use the
dedicated `update_acceptance_criteria` tool — it is the ONLY sanctioned way for
the coding agent to edit the issue body, and it flips just those `- [ ]` ⇄
`- [x]` boxes (never prose, never Plan/Tasks checkboxes).

- During VALIDATE, after evidence covers a criterion, tick it. Call
  `update_acceptance_criteria` with no arguments first to read the current list
  (each item has a 1-based `index`, `text`, and `checked`), then call again with
  the items to check (`{"index": 1, "checked": true}` or `{"text": "..."}`).
- Only tick a criterion your validation actually demonstrates — unchecked boxes
  are an honest signal that work remains, the same as Plan `[ ]` items.
- Criteria recorded as plain bullets (no `- [ ]`) cannot be ticked; leave those
  to the author and do NOT rewrite the body to add checkboxes.
- Do not use `update_issue` (or `gh issue edit`) to toggle these boxes — that
  risks clobbering the description; `update_acceptance_criteria` is surgical.

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
criteria. Plan-driven runs also require contract metadata and a task checklist
inside `### Plan`. Create it BEFORE writing any code.
