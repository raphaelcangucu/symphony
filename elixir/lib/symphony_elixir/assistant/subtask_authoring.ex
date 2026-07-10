defmodule SymphonyElixir.Assistant.SubtaskAuthoring do
  @moduledoc """
  Guidance woven into the issue authoring prompt so the assistant knows how to
  break a task into subtasks using the execution-bundle model and the authoring
  tools (`classify_execution_unit`, `create_subtask`, `set_issue_parent`,
  `define_shared_contract`/`update_shared_contract`, `preview_execution_plan`,
  `get_execution_bundle`).

  Text is lab-aware: when `lab.bundle_child_orchestration` is off (default), the
  assistant must not recommend isolated worktrees or integration-branch PRs.
  """

  alias SymphonyElixir.Settings.Lab

  @unified_guidance """
  SUBTASKS & EXECUTION BUNDLE

  Instance Lab: lab.bundle_child_orchestration is OFF (default / unified parent mode).
  Do NOT suggest isolated git worktrees, per-unit feature branches, or PRs against
  `symphony/{parent}/{repo}`. Those only apply when the Lab flag is ON.

  A parent task can be broken into subtasks. Each subtask is one of two execution shapes:
  - workpad_task: runs inline in the parent's run and the same working tree. Ships on the
    parent's feature branch / PR. Prefer this for same-repo work — including units that
    depend_on siblings or share contracts.
  - child_run: a tracked sub-issue in the parent's execution bundle. With Lab OFF it still
    executes inside the parent run (native subagent), on the same working tree and one
    feature branch per repo, with one final PR per repo. Use child_run mainly for
    different-repo units (or when the user explicitly wants a separate board issue).
    Never describe child_run as opening its own worktree or integration-branch PR while Lab is OFF.

  Both shapes share the same quality bar: TDD plus per-subtask evidence (tests + artifacts).

  Classify deterministically (the runner never re-decides). With Lab OFF, rules in order:
  1. different repo than the parent -> child_run (board unit; still same parent session topology)
  2. same repo (even with depends_on / shared contracts / deliverable: "pr") -> workpad_task
  3. repo unknown -> ambiguous: leave it a draft and ask the user before classifying.

  Shared contracts still coordinate units that depend on each other (especially across repos):
  define a shared contract whose owner is the producing unit and whose consumers are the
  dependent units. Consumers gate on the contract being ready. At runtime, units coordinate via
  `report_unit_status` and `query_bundle_status`.

  Tool sequence when authoring subtasks:
  1. classify_execution_unit to preview a subtask's shape (no writes) when unsure — read
     `orchestration_mode` in the response (`unified` means same-tree).
  2. create_subtask to create the child and attach it to the parent's execution bundle
     (auto-classifies when unit_type is omitted). Prefer omitting unit_type, or pass
     workpad_task for same-repo coupled work.
  3. set_issue_parent to reparent or detach a subtask (rejects cycles).
  4. define_shared_contract / update_shared_contract for cross-unit dependencies.
  5. preview_execution_plan to validate the bundle before handing off; get_execution_bundle
     to inspect the current plan.

  Ambiguity fallback: if classification is ambiguous (unknown repo) or the user is undecided,
  keep the subtask as a draft and ask one clarifying question instead of guessing.
  """

  @bundle_child_guidance """
  SUBTASKS & EXECUTION BUNDLE

  Instance Lab: lab.bundle_child_orchestration is ON (experimental isolated child runs).

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
  def guidance, do: guidance([])

  @spec guidance(keyword()) :: String.t()
  def guidance(opts) when is_list(opts) do
    case Keyword.get(opts, :orchestration_mode) || default_orchestration_mode() do
      :bundle_child -> @bundle_child_guidance
      _ -> @unified_guidance
    end
  end

  @spec orchestration_mode() :: :unified | :bundle_child
  def orchestration_mode, do: default_orchestration_mode()

  @spec orchestration_mode_string() :: String.t()
  def orchestration_mode_string do
    case default_orchestration_mode() do
      :bundle_child -> "bundle_child"
      _ -> "unified"
    end
  end

  defp default_orchestration_mode do
    if Lab.bundle_child_orchestration?(), do: :bundle_child, else: :unified
  end
end
