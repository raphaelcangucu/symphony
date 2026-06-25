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
  - child_run: its own run with its own issue, isolated git worktree, branch, validation, and PR. Use for
    independent or cross-repo deliverables.

  Classify deterministically (the runner never re-decides). Rules, in order:
  1. different repo than the parent -> child_run
  2. independent deliverable (deliverable: "pr") -> child_run
  3. produces/consumes a shared contract or depends_on another unit -> child_run
  4. same repo, no isolation needed -> workpad_task
  5. repo unknown -> ambiguous: leave it a draft and ask the user before classifying.

  Shared contracts coordinate child_run units that depend on each other (especially across repos):
  define a shared contract (e.g. an API schema) whose owner is the producing unit and whose consumers are
  the dependent units. Consumers gate on the contract being ready.

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
