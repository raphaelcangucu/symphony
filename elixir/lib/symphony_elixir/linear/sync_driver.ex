defmodule SymphonyElixir.Linear.SyncDriver do
  @moduledoc """
  `Tracker.Sync.Driver` for Linear. Delegates reads/writes to `Linear.IssueAdapter`.
  Linear comments are not yet exposed by the adapter, so `pull/2` mirrors issues
  without comments. Pull requests are owned by GitHub source control, so
  `pull_pull_requests/2` returns an empty list here (the engine pulls PRs via the
  GitHub driver in Plan 6's reconciler wiring).
  """

  @behaviour SymphonyElixir.Tracker.Sync.Driver

  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}
  alias SymphonyElixir.Tracker.Sync.{Normalize, OutboxEntry}

  @impl true
  def pull(%Project{} = project, _opts) do
    with {:ok, dtos} <- adapter().list_issues(project, []) do
      {:ok, Enum.map(dtos, &Normalize.issue(&1, comments: []))}
    end
  end

  @impl true
  def push(%Project{} = project, %OutboxEntry{entity_type: "state", operation: "move", payload: payload}) do
    case adapter().move_issue(project, payload["identifier"], %{"status" => payload["state"]}) do
      {:ok, dto} -> {:ok, dto.id}
      error -> error
    end
  end

  def push(%Project{}, %OutboxEntry{entity_type: type, operation: op}), do: {:error, {:unsupported_push, type, op}}

  @impl true
  def pull_pull_requests(%Project{}, %IssueRecord{}), do: {:ok, []}

  defp adapter, do: Application.get_env(:symphony_elixir, :linear_sync_adapter, SymphonyElixir.Linear.IssueAdapter)
end
