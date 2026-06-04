defmodule SymphonyElixir.GitHub.SyncDriver do
  @moduledoc """
  `Tracker.Sync.Driver` for GitHub Projects. Delegates to `GitHub.IssueAdapter`
  for remote reads/writes and to `GitHub.PullRequests` for linked PRs (GitHub is
  the standard source control for every tracker — see `pull_pull_requests/2`).
  """

  @behaviour SymphonyElixir.Tracker.Sync.Driver

  require Logger

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

  def push(%Project{} = project, %OutboxEntry{entity_type: "issue", operation: "archive", payload: payload}) do
    adapter().archive_issue(project, payload["identifier"])
  end

  def push(%Project{} = project, %OutboxEntry{entity_type: "issue", operation: "restore", payload: payload}) do
    adapter().restore_issue(project, payload["identifier"])
  end

  def push(%Project{} = project, %OutboxEntry{entity_type: "issue", operation: "delete", payload: payload}) do
    adapter().delete_issue(project, payload["identifier"])
  end

  def push(%Project{}, %OutboxEntry{entity_type: type, operation: op}) do
    {:error, {:unsupported_push, type, op}}
  end

  @impl true
  def pull_pull_requests(%Project{} = project, %IssueRecord{} = issue) do
    with {:ok, repo} <- pull_requests_module().resolve_repo(project),
         {:ok, prs} <- pull_requests_module().for_issue(repo, issue.identifier) do
      {:ok, Enum.map(prs, &to_pr_record/1)}
    else
      {:error, {:rate_limited, _}} -> pr_fallback(project, issue)
      _ -> {:ok, []}
    end
  rescue
    error ->
      Logger.warning("PR pull failed for #{issue.identifier}: #{inspect(error)}")
      {:ok, []}
  end

  # GraphQL PR resolution is rate-limited: degrade to the REST-backed
  # `GitHub.Api.list_issue_prs` (basic linkage + state) keyed by the issue branch.
  defp pr_fallback(%Project{} = project, %IssueRecord{} = issue) do
    with {:ok, repo} <- pull_requests_module().resolve_repo(project),
         {:ok, prs} <- api_module().list_issue_prs(repo, issue.identifier, issue.branch_name) do
      {:ok, Enum.map(prs, &to_pr_record/1)}
    else
      _ -> {:ok, []}
    end
  end

  defp to_pr_record(pr) do
    %{
      remote_id: pr[:url] || "pr-#{pr[:number]}",
      number: pr[:number],
      url: pr[:url],
      title: pr[:title],
      state: normalize_state(pr[:state])
    }
  end

  defp normalize_state(state) when state in ["open", "closed", "merged"], do: state
  defp normalize_state("draft"), do: "open"
  defp normalize_state(_state), do: "closed"

  defp adapter, do: Application.get_env(:symphony_elixir, :github_sync_adapter, SymphonyElixir.GitHub.IssueAdapter)

  defp pull_requests_module, do: Application.get_env(:symphony_elixir, :github_pr_module, SymphonyElixir.GitHub.PullRequests)

  defp api_module, do: Application.get_env(:symphony_elixir, :github_api_module, SymphonyElixir.GitHub.Api)
end
