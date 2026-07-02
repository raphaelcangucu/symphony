defmodule SymphonyElixir.Assistant.SubtaskAuthoring do
  @moduledoc """
  Guidance woven into the issue authoring prompt so the assistant knows how to
  break a task into subtasks using the execution-bundle model and the authoring
  tools (`classify_execution_unit`, `create_subtask`, `set_issue_parent`,
  `define_shared_contract`/`update_shared_contract`, `preview_execution_plan`,
  `get_execution_bundle`).
  """

  @guidance """
  SUBTASKS & EXECUTION BUNDLE

  A parent task can be broken into subtasks. Each subtask is one of two execution shapes:
  - workpad_task: runs inline in the parent's run/workspace (same repo, no separate PR). Use for tightly
    coupled, same-repo work that ships with the parent.
  - child_run: its own run with its own issue, isolated git worktree and branch. It opens a PR against the
    parent's per-repo integration branch `symphony/{parent}/{repo}` (NOT the repo default). The parent
    merges child PRs into that integration branch and opens one final PR per repo. Use for independent or
    cross-repo deliverables, or same-repo work that depends on / coordinates with sibling units.

  Both shapes are held to the same quality bar: TDD plus per-subtask evidence (tests + artifacts). A
  same-repo child_run reuses the parent's checkout, installed dependencies, and preview (no re-clone /
  re-install / re-provision) but still runs its own tests and captures its own evidence.

  Classify deterministically (the runner never re-decides). Rules, in order:
  1. different repo than the parent -> child_run (its own worktree for that repo)
  2. independent deliverable (deliverable: "pr") -> child_run
  3. produces/consumes a shared contract or depends_on another unit -> child_run
  4. same repo, no isolation needed -> workpad_task
  5. repo unknown -> ambiguous: leave it a draft and ask the user before classifying.

  Shared contracts coordinate child_run units that depend on each other (especially across repos):
  define a shared contract (e.g. an API schema) whose owner is the producing unit and whose consumers are
  the dependent units. Consumers gate on the contract being ready. At runtime, children coordinate with the
  parent via `report_unit_status` (push structured progress) and `query_bundle_status` (read sibling/parent
  state) instead of polling each other.

  Tool sequence when authoring subtasks:
  1. classify_execution_unit to preview a subtask's shape (no writes) when unsure.
  2. create_subtask to create the child and attach it to the parent's execution bundle (auto-classifies
     when unit_type is omitted).
  3. set_issue_parent to reparent or detach a subtask (rejects cycles).
  4. define_shared_contract / update_shared_contract for cross-unit dependencies.
  5. preview_execution_plan to validate the bundle (cycles, missing producers, cross-repo inline units)
     before handing off; get_execution_bundle to inspect the current plan.

  Ambiguity fallback: if classification is ambiguous (unknown repo) or the user is undecided, keep the
  subtask as a draft and ask one clarifying question instead of guessing.
  """

  @spec guidance() :: String.t()
  def guidance, do: @guidance
end
