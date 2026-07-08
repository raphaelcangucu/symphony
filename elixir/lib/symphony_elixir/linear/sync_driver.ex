defmodule SymphonyElixir.Linear.SyncDriver do
  @moduledoc """
  `Tracker.Sync.Driver` for Linear. Delegates reads/writes to `Linear.IssueAdapter`
  and comment push to `Linear.Comments` (GraphQL `commentCreate`/`commentUpdate`),
  so locally authored comments — including the workpad — reach Linear and are
  edited in place. Pull requests are owned by GitHub source control, so
  `pull_pull_requests/2` returns an empty list here (the engine pulls PRs via the
  GitHub driver in Plan 6's reconciler wiring).
  """

  @behaviour SymphonyElixir.Tracker.Sync.Driver

  alias SymphonyElixir.Evidence.RemoteArtifacts
  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}
  alias SymphonyElixir.Tracker.Sync.{Normalize, OutboxEntry, Push}

  @impl true
  def pull(%Project{} = project, _opts) do
    with {:ok, dtos} <- adapter().list_issues(project, []) do
      {:ok, Enum.map(dtos, &Normalize.issue(&1, comments: []))}
    end
  end

  @impl true
  def push(%Project{} = project, %OutboxEntry{entity_type: "state", operation: "move", payload: payload}) do
    Push.push_state_move(adapter(), project, payload)
  end

  def push(%Project{}, %OutboxEntry{entity_type: "comment", operation: "create", payload: payload} = entry) do
    with {:ok, issue_remote_id} <- issue_remote_id(entry) do
      comments_module().create(issue_remote_id, rewrite_artifacts(payload["body"]))
    end
  end

  def push(
        %Project{},
        %OutboxEntry{entity_type: "comment", operation: "update", payload: %{"remote_id" => remote_id} = payload}
      )
      when is_binary(remote_id) and remote_id != "" do
    comments_module().update(remote_id, rewrite_artifacts(payload["body"]))
  end

  # Update without a known remote id (workpad created before its first push
  # completed): fall back to create so the content still reaches Linear.
  def push(%Project{} = project, %OutboxEntry{entity_type: "comment", operation: "update"} = entry) do
    push(project, %{entry | operation: "create"})
  end

  def push(%Project{}, %OutboxEntry{entity_type: type, operation: op}), do: {:error, {:unsupported_push, type, op}}

  @impl true
  def pull_pull_requests(%Project{}, %IssueRecord{}), do: {:ok, []}

  defp issue_remote_id(%OutboxEntry{} = entry) do
    case SymphonyElixir.Repo.preload(entry, :issue) do
      %OutboxEntry{issue: %IssueRecord{remote_id: remote_id}} when is_binary(remote_id) and remote_id != "" ->
        {:ok, remote_id}

      _missing ->
        {:error, :issue_remote_id_unknown}
    end
  end

  # Evidence comments embed Symphony-served artifact URLs; before they reach
  # Linear, upload the underlying files natively and swap in the Linear-hosted
  # `assetUrl` so the images render without a publicly reachable Symphony.
  defp rewrite_artifacts(body) when is_binary(body) do
    if RemoteArtifacts.contains_artifacts?(body) do
      RemoteArtifacts.rewrite_markdown(body, "linear", uploader())
    else
      body
    end
  end

  defp rewrite_artifacts(body), do: body

  defp uploader do
    Application.get_env(:symphony_elixir, :linear_artifact_uploader, &SymphonyElixir.Linear.Uploads.upload/3)
  end

  defp adapter, do: Application.get_env(:symphony_elixir, :linear_sync_adapter, SymphonyElixir.Linear.IssueAdapter)

  defp comments_module, do: Application.get_env(:symphony_elixir, :linear_comments_module, SymphonyElixir.Linear.Comments)
end
