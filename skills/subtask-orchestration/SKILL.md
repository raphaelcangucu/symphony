---
name: subtask-orchestration
description: Break a parent task into subtasks using Symphony's execution-bundle model. Use when an issue is large enough to split, spans multiple repositories, or has independently shippable parts. Covers the three execution shapes (workpad_task, subagent_unit, child_run), deterministic classification, shared contracts for cross-unit coordination, and the authoring tool sequence.
---

# Subtask orchestration

Symphony executes a parent task as an **execution bundle**: an ordered set of units, plus shared
contracts and dependency edges, stored as a YAML block in the parent's `## Codex Workpad` comment.
The authoring assistant builds the bundle; the runner consumes it and never re-derives structure.

## The three execution shapes

| Shape | Where it runs | Use when |
| --- | --- | --- |
| `workpad_task` | Inline, in the parent's run and workspace. Ships with the parent (no separate PR). | Tightly coupled, same-repo work. |
| `subagent_unit` | A Symphony-managed subagent inside the **parent's** working tree; ships in the **parent's PR** (no own clone/branch/PR). The parent spawns it once its consumed contracts are `ready`, supervises its TDD + evidence slice, and only then accepts the produced contract. | Same-repo work that depends on, or shares a contract with, sibling units. |
| `child_run` | Its own run: own issue, isolated git worktree, branch, validation, and PR. | Independent or cross-repo deliverables. |

## Deterministic classification (do not re-decide at run time)

Apply these rules in order; the first match wins:

1. **`:different_repo`** — the unit targets a different repo than the parent → `child_run`.
2. **`:independent_deliverable`** — the unit is independently shippable (`deliverable: "pr"`) → `child_run`.
3. **`:same_repo_subagent`** — same repo as the parent **and** it `produces`/`consumes` a shared contract or `depends_on` another unit → `subagent_unit` (+ `shared_contract`). Use this, not `child_run`, for same-repo dependent work.
4. **`:shared_contract`** — contract-coupled but the parent's repo is unknown → `child_run` (conservative fallback).
5. **`:same_repo_inline`** — same repo, no isolation needed → `workpad_task`.
6. **`:unknown_repo`** — repo is unknown → **ambiguous**: keep the subtask a draft and ask the user.

Use `classify_execution_unit` to preview a classification without writing anything.

## Shared contracts

When a `child_run` depends on an artifact another unit must produce first (e.g. a backend API a frontend
consumes — often across repos), define a **shared contract**:

- `owner_unit` = the unit that **produces** the contract.
- `consumers` = units that depend on it. Consumers gate on the contract being `ready`.
- Status flows `draft -> ready -> changing`. Editing the body of a `ready` contract flips it to
  `changing` so consumers re-sync.

## Authoring tool sequence

1. `classify_execution_unit` — preview a subtask's shape when unsure (no writes).
2. `create_subtask` — create the child issue, link it under the parent, and add it to the bundle
   (auto-classifies when `unit_type` is omitted).
3. `set_issue_parent` — reparent or detach a subtask (rejects cycles).
4. `define_shared_contract` / `update_shared_contract` — declare and evolve cross-unit dependencies.
5. `preview_execution_plan` — validate the bundle (dependency cycles, contracts consumed but never
   produced, cross-repo inline units) before handing off.
6. `get_execution_bundle` — inspect the current plan (units, contracts, dependencies).

## Ambiguity fallback

If classification is ambiguous (unknown repo) or the user is undecided about scope, keep the subtask as
a **draft** and ask one clarifying question. Never guess the execution shape.
