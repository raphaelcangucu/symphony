defmodule SymphonyElixir.Tracker.Sync.SubtaskRollup do
  @moduledoc """
  Helpers for pushing a parent's derived ("rolled-up") status to the remote after
  a child's status changes.

  The rollup itself is computed and persisted locally by `LocalTracker.Context`
  (a parent takes the least-advanced status among its direct children). These
  helpers let the sync wrappers detect the resulting parent change and enqueue the
  matching remote status move so the next pull does not revert it.
  """

  alias SymphonyElixir.LocalTracker.{Context, Project}

  @typedoc "A `{parent_identifier, status_name}` snapshot, or nil when there is no parent."
  @type snapshot :: {String.t(), String.t()} | nil

  @doc """
  Captures the current parent identifier and status name for `identifier`, taken
  BEFORE a child move so it can be compared afterwards. Returns nil when the issue
  has no parent.
  """
  @spec parent_snapshot(Project.t(), String.t()) :: snapshot()
  def parent_snapshot(%Project{} = project, identifier) do
    case Context.parent_issue(project.slug, identifier) do
      {:ok, %{identifier: parent_identifier, status: %{name: status_name}}} ->
        {parent_identifier, status_name}

      _ ->
        nil
    end
  end

  @doc """
  Compares the parent snapshot taken before a child move with the parent's current
  state. Returns `{parent_identifier, status_name}` when the same parent's status
  changed (so the caller pushes it), otherwise nil.
  """
  @spec changed_parent(snapshot(), Project.t(), String.t()) :: {String.t(), String.t()} | nil
  def changed_parent(before_snapshot, %Project{} = project, identifier) do
    case {before_snapshot, parent_snapshot(project, identifier)} do
      {{parent_identifier, before_name}, {parent_identifier, after_name}}
      when before_name != after_name ->
        {parent_identifier, after_name}

      _ ->
        nil
    end
  end
end
