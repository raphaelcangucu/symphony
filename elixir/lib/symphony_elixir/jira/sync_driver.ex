defmodule SymphonyElixir.Jira.SyncDriver do
  @moduledoc """
  `Tracker.Sync.Driver` for JIRA Cloud. Delegates reads/writes to
  `Jira.IssueAdapter`. Pull requests are owned by GitHub source control, so
  `pull_pull_requests/2` returns an empty list (the engine pulls PRs via the
  GitHub driver).
  """

  @behaviour SymphonyElixir.Tracker.Sync.Driver

  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}
  alias SymphonyElixir.Tracker.Sync.{Normalize, OutboxEntry}

  @impl true
  def pull(%Project{} = project, _opts) do
    with {:ok, dtos} <- adapter().list_issues(project, []) do
      issues =
        Enum.map(dtos, fn dto ->
          Normalize.issue(dto, comments: fetch_comments(project, dto.identifier))
        end)

      {:ok, issues}
    end
  end

  @impl true
  def push(%Project{} = project, %OutboxEntry{entity_type: "state", operation: "move", payload: payload}) do
    case adapter().move_issue(project, payload["identifier"], %{"status" => payload["state"]}) do
      {:ok, dto} -> {:ok, dto.id}
      error -> error
    end
  end

  def push(%Project{} = project, %OutboxEntry{entity_type: "comment", operation: "create", payload: payload}) do
    case adapter().add_comment(project, payload["identifier"], payload["body"], %{}) do
      {:ok, %{remote_id: remote_id}} -> {:ok, remote_id}
      {:ok, _other} -> {:ok, nil}
      error -> error
    end
  end

  def push(%Project{} = project, %OutboxEntry{entity_type: "issue", operation: "create", payload: payload}) do
    case adapter().create_issue(project, payload) do
      {:ok, dto} -> {:ok, dto.id}
      error -> error
    end
  end

  def push(%Project{}, %OutboxEntry{entity_type: type, operation: op}) do
    {:error, {:unsupported_push, type, op}}
  end

  @impl true
  def pull_pull_requests(%Project{}, %IssueRecord{}), do: {:ok, []}

  defp fetch_comments(project, identifier) do
    case adapter().list_comments(project, identifier) do
      {:ok, comments} -> comments
      {:error, _reason} -> []
    end
  end

  defp adapter, do: Application.get_env(:symphony_elixir, :jira_sync_adapter, SymphonyElixir.Jira.IssueAdapter)
end
