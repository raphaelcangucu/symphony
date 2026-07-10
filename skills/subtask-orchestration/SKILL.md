---
name: subtask-orchestration
description: Break a parent task into subtasks using Symphony's execution-bundle model. Use when an issue is large enough to split, spans multiple repositories, or has independently shippable parts. Covers the two execution shapes (workpad_task, child_run), lab-aware classification, shared contracts, and the authoring tool sequence. Default (Lab off) keeps same-repo work in one working tree.
---

# Subtask orchestration

Symphony executes a parent task as an **execution bundle**: an ordered set of units, plus shared
contracts and dependency edges, stored as a YAML block in the parent's `## Codex Workpad` comment.
The authoring assistant builds the bundle; the runner consumes it and never re-derives structure.

## Lab flag: two orchestration modes (read this first)

Instance setting **`lab.bundle_child_orchestration`** (Settings → Lab, default **off**):

| Flag | Meaning | Orchestrator |
| --- | --- | --- |
| **off** (default) | **Unified parent** — one working tree / one feature branch per repo / one PR per repo. `child_run` is a board unit executed as a native subagent inside the parent run. | Dispatches **only the parent**; parent uses `subagent-driven-development` |
| **on** (lab) | **Isolated child runs** — separate orchestrator run per `child_run`, git worktrees, integration branch, child PRs | Parent coordinator + orchestrator child dispatches |

The bundle YAML (units, deps, contracts) is required in **both** modes. Only execution topology changes.

**Authoring rule:** when Lab is OFF, never recommend isolated worktrees, `symphony/{parent}/{repo}` integration branches, or per-unit PRs. Prefer `workpad_task` for same-repo work. Check `orchestration_mode` on `classify_execution_unit` / `create_subtask` responses (`unified` vs `bundle_child`).

## The two execution shapes (default: Lab OFF)

| Shape | Where it runs (Lab OFF) | Use when |
| --- | --- | --- |
| `workpad_task` | Inline in the parent's run and **same working tree**. Ships on the parent feature branch / PR. | Same-repo work — including units with `depends_on` / shared contracts. |
| `child_run` | Board sub-issue + native subagent **inside the parent session** (still same tree / one PR). | Different-repo units, or when the user wants a separate tracked issue. |

## The two execution shapes (only when Lab ON)

| Shape | Where it runs | Use when |
| --- | --- | --- |
| `workpad_task` | Inline, in the parent's run and workspace. Ships with the parent (no separate PR). | Tightly coupled, same-repo work. |
| `child_run` | Its own run: own issue, isolated git worktree and branch. Opens a PR **against the parent's per-repo integration branch** (not the repo default); the parent merges it and owns the final per-repo PR. | Independent or cross-repo deliverables, or same-repo work that depends on / shares a contract with sibling units. |

Both shapes are held to the **same quality bar**: TDD plus per-subtask **evidence** (tests +
artifacts). Native subagents (Codex/Claude/Cursor) are allowed inside **both** shapes for independent
slices of a unit.

## Per-repo integration branch (Lab ON only)

Skip this section when Lab is OFF.

For each repo touched by the bundle, the parent owns one integration branch
`symphony/{parent}/{repo}`:

1. The parent ensures the integration branch exists before the first child for that repo.
2. Each `child_run` opens its PR with `--base symphony/{parent}/{repo}` (Symphony sets the base
   automatically when it publishes). Its worktree forks off the integration branch **unless it
   `depends_on` a same-repo sibling** — then it forks off that **predecessor's branch** so the
   dependency's committed work is present as its starting reference. Its PR still targets
   `symphony/{parent}/{repo}` (never the predecessor branch).
3. The **parent coordinator** merges green child PRs into the integration branch and, once a repo's
   units are all merged, opens exactly **one** final PR per repo
   (`symphony/{parent}/{repo}` → that repo's default branch).

**Dependency chains** (Lab ON): a dependent releases when its predecessor reaches human review (PR open) —
before that predecessor is merged into the integration branch. Forking the dependent's worktree off
the predecessor's branch is what hands it the predecessor's schema/API without waiting for the merge.
In a linear chain (A → B → C), C forks off B (which already contains A). Cross-repo predecessors are
ignored for forking (their branch lives in another checkout); such children fork off the integration branch.

Even same-repo children get their own worktree + branch + PR into the integration branch. A same-repo
child **reuses the parent's checkout, installed dependencies, and preview** (no re-clone / re-install /
re-provision) but still runs its own tests and captures its own evidence.

## Deterministic classification (do not re-decide at run time)

`classify_execution_unit` / `create_subtask` pass the current Lab flag into the classifier.

### Lab OFF (default)

1. **`:different_repo`** — unit repo ≠ parent repo (both known) → `child_run` (board unit; still unified topology).
2. **`:same_repo_inline`** — otherwise → `workpad_task` (same repo, or parent repo unknown — cannot prove isolation is needed).
3. **`:unknown_repo`** — unit repo unknown → **ambiguous**: keep the subtask a draft and ask the user.

### Lab ON

1. **`:different_repo`** — different repo than the parent → `child_run`.
2. **`:independent_deliverable`** — `deliverable: "pr"` → `child_run`.
3. **`:contract_coupled`** — produces/consumes a shared contract or `depends_on` another unit → `child_run`.
4. **`:same_repo_inline`** — same repo, no isolation needed → `workpad_task`.
5. **`:unknown_repo`** — repo unknown → **ambiguous**.

Use `classify_execution_unit` to preview a classification without writing anything.

## Shared contracts

When a unit depends on an artifact another unit must produce first (e.g. a backend API a frontend
consumes — often across repos), define a **shared contract**:

- `owner_unit` = the unit that **produces** the contract.
- `consumers` = units that depend on it. Consumers gate on the contract being `ready`.
- Status flows `draft -> ready -> changing`. Editing the body of a `ready` contract flips it to
  `changing` so consumers re-sync.

## Runtime coordination tools (coding-agent surface)

While the bundle runs, the parent and children coordinate through tools instead of polling each other:

- `report_unit_status({phase, summary, blockers?, contracts_ready?, pr_url?})` — a child pushes a
  durable, structured status block to the parent's workpad at each phase transition (started,
  contract_ready, pr_open, blocked, done).
- `query_bundle_status(parent_identifier?)` — read every unit's `{type, status, blocked_by,
  pending_contracts, pr_url, tokens, turns, last_summary}` to sequence work and see what is waiting.
- `update_shared_contract(...)` — the owner marks a contract `ready` (or `changing`) so consumers
  unblock or re-sync.

## Authoring tool sequence

1. `classify_execution_unit` — preview a subtask's shape when unsure (no writes). Read `orchestration_mode`.
2. `create_subtask` — create the child issue, link it under the parent, and add it to the bundle
   (auto-classifies when `unit_type` is omitted).
3. `set_issue_parent` — reparent or detach a subtask (rejects cycles).
4. `define_shared_contract` / `update_shared_contract` — declare and evolve cross-unit dependencies.
5. `preview_execution_plan` — validate the bundle (dependency cycles, contracts consumed but never
   produced, cross-repo inline units) before handing off.
6. `get_execution_bundle` — inspect the current plan (units, contracts, dependencies).

## Ambiguity fallback

If classification is ambiguous (unknown repo) or the user is undecided about scope, keep the subtask as
a **draft** and ask one clarifying question. Never guess the execution shape. Never invent Lab-ON
topology (worktrees / integration branches) while Lab is OFF.
