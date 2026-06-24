# Subtask Orchestration & Execution Bundles — Design

Date: 2026-06-23
Status: Draft (pending user review)
Topic: Let Symphony model **subtasks** as first-class work, classify each subtask
deterministically into one of two execution shapes (`workpad_task` or
`child_run`), coordinate cross-repository work through explicit **shared
contracts**, and make the authoring assistant create this structure correctly.
Child runs execute in isolated git worktrees and are visible **hierarchically**
in observability and on the parent task.

## Background / Motivation

Today Symphony has two unrelated "multi-issue" concepts:

1. **Issue groups** (`group_lead_id` on `local_tracker_issues`,
   `Orchestrator.Grouping`): several board issues collapse into **one** run, one
   workspace, one branch, one all-or-nothing PR. See
   `docs/superpowers/specs/2026-06-18-task-grouping-board-design.md`.
2. **Workpad plan tasks** (`Workpad.ExecutionContract`): a checklist inside a
   single issue that drives continuation turns and gates, all in one run.

Neither lets a parent task fan out into **separately deliverable** units. When a
GitHub Project is imported (e.g. `xipcash/projects/3`), the native hierarchy
(`Issue.parent`, `Issue.subIssues`, `Issue.subIssuesSummary`) and per-issue
**repository** identity are not surfaced on cards, and there is no execution
semantics for "parent coordinates, children deliver".

The current execution-methodology guidance in
`elixir/lib/symphony_elixir/prompt_builder.ex` injects the
`subagent-driven-development` skill, but leaves the *structure* of execution to
the agent's interpretation. That is exactly where ambiguity (and confusion) is
highest: a single agent has to infer, from prose, whether two subtasks share a
repo, a PR, or an API contract.

### The two motivating cases (from the user)

- **Cross-repo with a shared contract** (very common): a backend API and a
  mobile/web client. Each can be built independently, but both must agree on the
  API surface (inputs/outputs/errors). Example: Macro Markets lottery landing
  page where a `spinLotteryWheel` GraphQL mutation awards tickets
  (`[0, 1, 2, 5, 7, 10]`). Backend owns prize selection + eligibility;
  frontend animates to the backend-decided prize.
- **Many related changes in one repo**: e.g. several frontend bugfixes. Spawning
  separate runs/branches/PRs here causes conflicts and overhead; one run with one
  PR is better.

### Decisions made with the user

- **Two execution shapes, not three.** `workpad_task` (inline, same run) and
  `child_run` (own issue/workpad/workspace/branch/validation/PR). A shared
  contract is an **artifact**, not a third mode.
- **Deterministic classification, set at authoring time.** The executor must not
  re-derive structure from prose. The authoring assistant emits a preclassified
  `execution_bundle`. Ambiguity ⇒ draft + ask a human.
- **Cross-repo dependencies ⇒ `child_run` + `shared_contract`.** The contract is
  produced by one unit and consumed by others; the owner decides changes.
- **GitHub hierarchy is native.** Preserve `parent`/`subIssues` and run
  parent + subtasks as an automatic bundle (per the earlier brainstorming
  answers).
- **Isolation via git worktree.** Child runs use isolated worktrees, not the
  current workspace.
- **Hierarchical visibility.** Child runs must be visible as a tree in
  observability and on the parent task — not flattened into one list.

## Goals

- Surface, for GitHub-backed projects, each card's **repository** and
  **sub-issue progress** (`total / completed`, percent).
- Model an **execution bundle** on a parent task: ordered units, each
  classified `workpad_task` or `child_run`, with dependencies and shared
  contracts.
- A parent run **coordinates**: it resolves the bundle, runs/validates inline
  `workpad_task`s, dispatches `child_run`s, tracks shared-contract state, and
  only finishes when the bundle's deliverables are satisfied.
- Authoring assistant tools to **create subtasks, reparent them, define/update
  shared contracts, classify units, and preview the bundle** before publishing.
- Child runs execute in isolated git worktrees with a verified clean baseline.
- Observability and the parent task render the **parent → child runs → PRs /
  evidence** hierarchy with per-child status, blockers, and dependency state.

## Non-goals

- Replacing local **issue groups** (v1 groups stay as-is; bundles are a distinct,
  parent/child concept). A later phase may unify them.
- Nested bundles beyond one parent level (a `child_run` is not itself a bundle in
  v1).
- Cross-project bundles (a bundle is per-project, like groups).
- Pushing Symphony-internal contract artifacts to remote trackers as new field
  types (contracts live in the workpad + repo `docs/`; GitHub parent/sub-issue
  links are reused where they already exist).
- Auto-merging child PRs or cross-repo atomic deploys.

## Execution model

```mermaid
flowchart TD
  authoring["Authoring assistant"] --> bundle["execution_bundle (on parent)"]
  bundle --> classifier["Deterministic classifier"]
  classifier --> wt["workpad_task (inline)"]
  classifier --> cr["child_run (own run)"]
  bundle --> contract["shared_contract artifact"]
  contract --> cr
  parentRun["Parent run (coordinator)"] --> wt
  parentRun --> cr
  cr --> worktree["isolated git worktree"]
  cr --> childPr["child PR (per repo)"]
  wt --> parentPr["parent PR"]
  parentRun --> obs["Observability tree"]
```

### Unit shapes

- **`workpad_task`** — executed by the parent run, in the parent's workspace,
  recorded as a task line in the parent `## Codex Workpad` `### Plan`. No own PR;
  contributes to the parent's deliverable(s). Best for small, related,
  same-repo work.
- **`child_run`** — executed as its own run keyed by its own issue identifier,
  with its own workpad, **isolated worktree**, branch, validation/evidence, and
  PR. The parent run does not write that unit's code; it dispatches, waits, and
  aggregates. Best for different repos or independently deliverable work.

### Deterministic classification rules

Applied by the authoring assistant when building the bundle; encoded as a pure
function so it is testable and the executor never re-decides:

1. Unit targets a **different repository** than the parent's primary repo ⇒
   `child_run`.
2. Unit needs an **independent** branch, PR, validation, or can ship alone ⇒
   `child_run`.
3. Unit **produces a contract** another unit **consumes** ⇒ both `child_run`,
   plus a `shared_contract` linking them.
4. Otherwise (same repo, low isolation, small related change) ⇒ `workpad_task`.
5. If rules conflict or repo/independence is unknown ⇒ **do not publish**; create
   a draft and ask the human to confirm classification.

### Shared contracts

A `shared_contract` is a named artifact with one **owner unit** (`produces`) and
one or more **consumers** (`consumes`). It is the single source of truth for the
cross-unit interface (e.g. a GraphQL mutation, REST schema, event shape).

- Stored as a markdown artifact in the parent workpad and, for durability, under
  `docs/contracts/<contract-id>.md` in the owner repo (so the consumer can read
  it from the workspace).
- The owner implements against it; consumers read it. A consumer that needs a
  change raises a **contract change request** in the parent workpad rather than
  editing the contract; the parent coordinates the update and notifies consumers.
- Dependency ordering: a consumer `child_run` is gated on its contract reaching
  `ready` (and, when `depends_on` is set, on the producer unit reaching a
  contract-ready phase) before it dispatches.

## Data model

### Execution bundle (authoring artifact)

Persisted on the parent issue (workpad `### Execution bundle` section, mirrored
in a structured field for the runner). YAML shape:

```yaml
execution_bundle:
  version: 1
  mode: bundle            # bundle | single (single = today's behavior)
  parent: macro-markets#42
  shared_contracts:
    - id: lottery-wheel-api
      kind: graphql_mutation        # graphql_mutation | rest | event | schema | other
      owner_unit: backend-wheel-api
      consumers: [frontend-landing-wheel]
      artifact: docs/contracts/lottery-wheel-api.md
      status: draft                  # draft | ready | changing
  units:
    - id: backend-wheel-api
      type: child_run
      issue: macro-markets/backend#101    # created subtask issue
      repo: macro-markets/backend
      produces: [lottery-wheel-api]
      deliverable: pr
    - id: frontend-landing-wheel
      type: child_run
      issue: macro-markets/frontend#77
      repo: macro-markets/frontend
      consumes: [lottery-wheel-api]
      depends_on: [backend-wheel-api]
      deliverable: pr
```

Same-repo bugfix example:

```yaml
execution_bundle:
  version: 1
  mode: bundle
  parent: macro-markets#50
  units:
    - { id: fix-wheel-mobile-layout, type: workpad_task, repo: macro-markets/frontend }
    - { id: fix-wheel-loading-state, type: workpad_task, repo: macro-markets/frontend }
    - { id: fix-prize-copy,          type: workpad_task, repo: macro-markets/frontend }
```

### Issue metadata (repository + hierarchy)

Add to `IssueDTO` (`elixir/lib/symphony_elixir/tracker/issue_dto.ex`) and the
presenter (`elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`):

- `repository_full_name` (e.g. `xipcash/ios`) — for GitHub, from
  `repository { nameWithOwner }`; fallback parse from `url`.
- `parent_identifier` — native `Issue.parent` (GitHub) or local parent relation.
- `sub_issue_summary: { total, completed, percent_completed }` — native
  `Issue.subIssuesSummary` (confirmed available on the GitHub schema; the sample
  `xipcash/ios#2` returns `total: 4, completed: 4, percent: 100`).

GitHub UI list query (`elixir/lib/symphony_elixir/github/issue_adapter/query.ex`,
`@list_items`) gains `repository { nameWithOwner }`, `parent { number repository { nameWithOwner } }`,
and `subIssuesSummary { total completed percentCompleted }`. The orchestrator
poll query (`elixir/lib/symphony_elixir/github/client.ex`) already fetches
`repository { nameWithOwner }`.

Frontend: extend `Issue` (`tracker/src/types/issue.ts`) +
`normalizeIssue` (`tracker/src/services/mappers.ts`) with `repositoryFullName`,
`parentIdentifier`, `subIssueSummary`; render a repo badge and a `4 / 4 100%`
progress pill on `tracker/src/components/board/IssueCard.tsx` (mirroring
`GroupCard`'s count badge pattern).

Additionally, a parent issue with sub-issues renders an **expandable subtask
list** on the board — a `SubtaskParentCard` that mirrors `GroupCard`'s
collapsible chevron + count, but is **additive, not absorbing**: unlike local
groups (which hide members and travel together), parent/subtask is a reference
relationship, so subtasks keep their own cards in their own columns/repos and
are merely also listed (read-only, navigate-on-click) under the parent. The
parent card itself stays an ordinary draggable issue. Subtasks present on the
board are matched by `parentIdentifier` (same approach `groupIssuesIntoUnits`
uses to resolve group members), so no extra fetch is needed for multi-repo
GitHub project boards where sub-issues are already board items.

### Parent/child run relationship (observability)

`AgentExecution` (`elixir/lib/symphony_elixir/agent_execution.ex`) is derived
from the orchestrator snapshot, keyed by issue identifier. Extend the projected
view with:

- `parent_identifier` — set on a child run to its bundle parent.
- `bundle_role` — `:parent` | `:child` | `:standalone`.
- `unit_id`, `repo`, `phase` (e.g. `:awaiting_contract`, `:running`,
  `:validating`, `:publishing`, `:done`, `:blocked`).
- `child_identifiers` — on a parent, the child run identifiers.

This lets observability and the issue drawer build the tree without inventing a
new persistence layer; the relationship comes from the bundle on the parent plus
the orchestrator's running map.

## Authoring assistant tools

These extend the existing tool surface (`ToolExecutor` + `ProjectBoardTools`,
mirrored to coding-agent `DynamicTool` where it makes sense). Names/shapes follow
the conventions in `elixir/lib/symphony_elixir/assistant/tool_executor.ex`
(`create_issue`, `create_draft_issue`, `move_issue`, `add_comment`). All scoped
tools take `project_slug` via `ToolSchema.with_project_slug/1`.

### Creation & hierarchy

- **`create_subtask`** — create a child issue under a parent and attach it to the
  parent's bundle.
  - Required: `parent_identifier`, `title`.
  - Optional: `description`, `repo` (defaults to parent's primary repo),
    `unit_type` (`workpad_task` | `child_run`; omitted ⇒ classifier decides),
    `produces[]`, `consumes[]`, `depends_on[]`, `deliverable` (`pr` | `none`).
  - Behavior: creates the issue (GitHub: also create the native sub-issue link
    via `addSubIssue`; local: set the parent relation), runs the classifier when
    `unit_type` is omitted, and upserts the unit into the parent's
    `execution_bundle`. Returns the created unit + resulting classification.

- **`set_issue_parent`** (reparent) — change or clear a subtask's parent.
  - Required: `identifier`.
  - Optional: `parent_identifier` (omit/`null` ⇒ detach to standalone).
  - Behavior: validates no cycles and single-level nesting; moves the unit
    between bundles (removing it from the old parent's bundle, adding to the new),
    re-runs classification, and rewrites shared-contract references that pointed
    at the moved unit. GitHub: `addSubIssue`/`removeSubIssue` as needed.

- **`list_subtasks` / `get_issue_hierarchy`** — return the parent, its units, the
  shared contracts, and per-unit `repo`/`type`/`status`/dependencies. Read-only;
  used before reparenting or editing the bundle.

### Bundle & classification

- **`get_execution_bundle`** — return the parent's current `execution_bundle`
  (units, contracts, dependencies, classification + reasons). Read-only.

- **`classify_execution_unit`** — given `repo`, `produces`, `consumes`,
  `depends_on`, and the parent's primary repo, return the deterministic
  classification and the rule that fired (or `ambiguous` + why). Pure preview; no
  writes. Lets the assistant explain its choice to the user.

- **`set_execution_unit`** — set/override a unit's `type`, `repo`,
  `deliverable`, and dependency edges (`produces`/`consumes`/`depends_on`). Used
  for manual override after `classify_execution_unit` returns `ambiguous`.

- **`preview_execution_plan`** — assemble and validate the full bundle for a
  parent (detects cycles, missing contract owners, consumers without a producer,
  cross-repo `workpad_task`s) and return a human-readable plan + warnings. Run
  before publishing the parent into a dispatch state.

### Shared contracts

- **`define_shared_contract`** — create a contract artifact.
  - Required: `parent_identifier`, `id`, `owner_unit`, `kind`.
  - Optional: `consumers[]`, `body` (markdown), `artifact_path` (defaults to
    `docs/contracts/<id>.md`).
  - Behavior: writes the artifact to the parent workpad + (when a workspace
    exists) the owner repo path, links it into the bundle, sets `status: draft`.

- **`update_shared_contract`** — edit a contract body or `status`
  (`draft` → `ready` → `changing`). Updating an already-consumed contract marks
  it `changing` and flags dependent `child_run`s for re-sync, so consumers re-read
  before continuing.

### Why these tools

- `create_subtask` + `set_issue_parent` give the assistant safe primitives to
  build/repair the tree (the user explicitly asked for reparenting).
- `classify_execution_unit` + `preview_execution_plan` keep classification
  **deterministic and inspectable**, which is the core anti-confusion measure.
- `define_shared_contract` / `update_shared_contract` make the cross-repo
  interface an explicit, owned artifact instead of tribal knowledge in prose.

### Authoring prompt + skills

The authoring flow (`assistant_channel.ex` `@issue_authoring_tools`, the issue
authoring prompt, and a new/updated skill) must teach the agent:

- the two unit shapes and the 5 classification rules,
- when to create a `shared_contract` and who owns it,
- to call `preview_execution_plan` and resolve warnings before publishing,
- to fall back to a draft + a `user question` when classification is `ambiguous`.

## Orchestrator & runner changes

- **Parent dispatch builds a bundle run.** Around
  `elixir/lib/symphony_elixir/orchestrator.ex` dispatch, when an eligible issue
  has `execution_bundle.mode == bundle`, the run becomes a **coordinator**:
  inline `workpad_task`s run in the parent workspace; each `child_run` is
  dispatched as its own run (own issue identifier, own claim).
- **Child runs are gated by dependencies/contracts.** A `child_run` with
  `depends_on`/`consumes` only dispatches once its producer reached a
  contract-ready phase and the contract `status == ready`.
- **Isolated worktrees.** Child runs (and, when configured, the parent) execute
  in a git worktree per the `using-git-worktrees` skill: pick `.worktrees/`
  (verify it is git-ignored), create a feature-branch worktree, run project
  setup, verify a clean baseline before implementing. This keeps multiple
  same-project runs from colliding in one checkout.
- **Aggregation / completion.** The parent finishes only when every unit's
  deliverable is satisfied (inline tasks done; child PRs open/linked; evidence
  recorded). `Workpad.ExecutionContract`
  (`elixir/lib/symphony_elixir/workpad/execution_contract.ex`) is extended to
  parse the `### Execution bundle` section: units, types, contract status,
  dependencies, and per-unit `validation`/`evidence`/`pr`. Scope/validate/publish
  gates consider child state, not just local tasks.
- **Prompt assembly.** `prompt_builder.ex` injects the **preclassified** bundle:
  the parent prompt explains it is a coordinator and lists units/contracts; each
  child prompt is scoped to its unit + the relevant contract, and tells the child
  it is one unit of a parent bundle (with the parent identifier for back-links).

## Observability & parent task UI

- **Backend:** extend the agent-execution projection (and its controller
  `elixir/lib/symphony_elixir_web/controllers/tracker/agent_execution_controller.ex`)
  with `parent_identifier`, `bundle_role`, `unit_id`, `repo`, `phase`,
  `child_identifiers`, so the existing observability channel can carry the tree.
- **Observability page** (`tracker/src/pages/ObservabilityPage.tsx`,
  `tracker/src/services/observability.ts`, `tracker/src/types/observability.ts`):
  group child runs under their parent run as an expandable node showing per-child
  status, repo, phase, blockers/errors, and linked PRs — instead of a flat list.
- **Parent task drawer** (`tracker/src/components/issues/issue-detail/AgentTab.tsx`
  / `AgentTabs.tsx`): render the bundle as a control center — units with
  status/phase, shared-contract status, dependency/blocked state, child PR links,
  and validation state. The parent is the place to see "waiting on contract" vs
  "waiting on child" vs "waiting on validation".
- **Cards** (`tracker/src/components/board/IssueCard.tsx`): repo badge +
  `total / completed` sub-issue pill for GitHub-backed issues.

## Implementation phases

1. **Metadata + cards (read-only):** repository, parent, sub-issue summary
   through the GitHub adapter → DTO → presenter → frontend; render repo badge +
   progress pill. Lowest risk, immediate value, no execution change.
2. **Bundle model + parser:** `execution_bundle` schema, classifier (pure
   function), `Workpad.ExecutionContract` parsing the `### Execution bundle`
   section. Backend-only, fully unit-testable.
3. **Authoring tools + prompt/skill:** `create_subtask`, `set_issue_parent`,
   `classify_execution_unit`, `set_execution_unit`, `preview_execution_plan`,
   `define_shared_contract`, `update_shared_contract`; wire into authoring prompt
   + a subtask-authoring skill.
4. **Coordinator runner + worktrees:** parent-coordinates dispatch, dependency/
   contract gating, isolated worktrees, aggregated completion gates.
5. **Hierarchical observability + parent control center:** projection fields +
   tree UI on observability and the parent drawer.

## Error handling & edge cases

- **Ambiguous classification:** never publish; draft + `user question`.
- **Consumer without a ready contract:** child stays `:awaiting_contract`;
  surfaced as a parent blocker, not a silent stall.
- **Contract changes mid-flight:** `status: changing` flags dependent children to
  re-read before continuing; the parent shows a "contract changing" blocker.
- **Reparent of a unit referenced by a contract:** `set_issue_parent` rewrites or
  rejects dangling `owner_unit`/`consumers` references.
- **Worktree not ignored:** add to `.gitignore` and commit before creating
  (per the worktree skill) — do not pollute the repo.
- **Cycles / nested bundles:** validation in `preview_execution_plan` and
  `set_issue_parent` rejects cycles and >1 level of nesting in v1.
- **Mixed/legacy issues:** `mode: single` (or absent bundle) ⇒ exactly today's
  behavior; groups remain independent.

## Testing strategy

- **Classifier (pure):** rule-by-rule table tests, including the `ambiguous`
  path.
- **Bundle parsing:** extend
  `elixir/test/symphony_elixir/workpad/execution_contract_test.exs` for the
  `### Execution bundle` section (units, contracts, deps, statuses).
- **GitHub adapter:** `repository`, `parent`, `subIssuesSummary` normalization.
- **Authoring tools:** `create_subtask`/`set_issue_parent`/contract tools
  create/repair the bundle and reject cycles/dangling refs; `preview_execution_plan`
  warnings.
- **Runner/orchestrator:** `workpad_task` stays inline; `child_run` dispatches
  with its own claim/worktree; dependency/contract gating; aggregated completion.
- **Frontend:** card repo badge + progress pill; observability tree grouping;
  parent control-center rendering (`ObservabilityPage.test.tsx`, `AgentTabs.test.tsx`).

## Open questions

- Should `child_run` subtasks be **real tracker issues** in every case, or may a
  bundle unit be a virtual unit without its own issue (e.g. ephemeral same-repo
  child)? Default assumption: cross-repo `child_run`s are real issues; same-repo
  small work is `workpad_task` (no issue), so this mostly resolves itself.
- Do we eventually **unify groups and bundles** (a group becomes a
  same-repo/one-PR bundle)? Out of scope for v1, but the bundle model is a
  superset.
- Where do shared contracts live canonically when there is **no owner workspace
  yet** (contract defined before any code)? Default: parent workpad first, mirror
  into the owner repo at first child dispatch.
