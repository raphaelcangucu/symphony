defmodule SymphonyElixir.Jira.SyncDriver do
  @moduledoc """
  `Tracker.Sync.Driver` for JIRA Cloud. Delegates reads/writes to
  `Jira.IssueAdapter`. Pull requests are owned by GitHub source control, so
  `pull_pull_requests/2` returns an empty list (the engine pulls PRs via the
  GitHub driver).

  `pull/2` is intentionally "light": it returns issue metadata with no comments
  (one list call), mirroring the GitHub driver. The engine then enriches comments
  lazily — only for active-state issues, at most once per TTL — via
  `Tracker.Sync.Engine`'s enrichment path. This avoids an N+1 comment fetch over
  every issue on large boards each pull cycle.
  """

  @behaviour SymphonyElixir.Tracker.Sync.Driver

  alias SymphonyElixir.Evidence.RemoteArtifacts
  alias SymphonyElixir.Jira.Uploads
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
    body = rewrite_artifacts(payload["body"], payload["identifier"])

    case adapter().add_comment(project, payload["identifier"], body, %{}) do
      {:ok, %{remote_id: remote_id}} -> {:ok, remote_id}
      {:ok, _other} -> {:ok, nil}
      error -> error
    end
  end

  def push(%Project{} = project, %OutboxEntry{entity_type: "comment", operation: "update", payload: payload} = entry) do
    case payload["remote_id"] do
      remote_id when is_binary(remote_id) and remote_id != "" ->
        body = rewrite_artifacts(payload["body"], payload["identifier"])

        case adapter().update_comment(project, payload["identifier"], remote_id, body) do
          {:ok, %{remote_id: updated_id}} -> {:ok, updated_id || remote_id}
          {:ok, _other} -> {:ok, remote_id}
          error -> error
        end

      # Workpad updated before its create was pushed: degrade to create so the
      # content still reaches JIRA.
      _missing ->
        push(project, %{entry | operation: "create"})
    end
  end

  def push(%Project{} = project, %OutboxEntry{entity_type: "comment", operation: "delete", payload: payload}) do
    case payload["remote_id"] do
      remote_id when is_binary(remote_id) and remote_id != "" ->
        case adapter().delete_comment(project, payload["identifier"], remote_id) do
          {:ok, %{id: id}} -> {:ok, id}
          {:ok, _other} -> {:ok, remote_id}
          error -> error
        end

      _missing ->
        {:ok, nil}
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

  # Evidence comments embed Symphony-served artifact URLs; before they reach
  # JIRA, attach the underlying files to the issue natively and swap in the
  # Jira-hosted `content` URL so the evidence is reachable without a publicly
  # exposed Symphony. Attachments are issue-scoped, so the cache provider key
  # carries the issue identifier (repeated in-place updates still skip re-upload).
  defp rewrite_artifacts(body, identifier) when is_binary(body) and is_binary(identifier) and identifier != "" do
    if RemoteArtifacts.contains_artifacts?(body) do
      RemoteArtifacts.rewrite_markdown(body, "jira:" <> identifier, uploader(identifier))
    else
      body
    end
  end

  defp rewrite_artifacts(body, _identifier), do: body

  defp uploader(identifier) do
    upload = Application.get_env(:symphony_elixir, :jira_artifact_uploader, &Uploads.upload/4)
    fn path, filename, content_type -> upload.(identifier, path, filename, content_type) end
  end

  defp adapter, do: Application.get_env(:symphony_elixir, :jira_sync_adapter, SymphonyElixir.Jira.IssueAdapter)
end
