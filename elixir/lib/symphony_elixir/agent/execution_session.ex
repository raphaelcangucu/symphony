defmodule SymphonyElixir.Agent.ExecutionSession do
  @moduledoc """
  Creates and closes real `issue_execution` sessions for orchestrator runs, so
  every autonomous run has its own session id, channel, and log file.

  Run outcomes ("aborted"/"completed"/"paused") are mapped onto the coarse
  `Thread` status enum (`active|closed|error|archived`); the operator-facing
  distinction is carried in the session transcript + metadata. Richer status is
  a deferred follow-up.
  """

  import Ecto.Query, only: [from: 2]

  alias SymphonyElixir.AgentExecution
  alias SymphonyElixir.Assistant.{History, Thread}
  alias SymphonyElixir.Recents
  alias SymphonyElixir.Repo

  @statuses ~w(active completed aborted paused error closed archived)
  @recent_window_hours 24

  @spec ensure(String.t(), String.t(), keyword()) :: {:ok, Thread.t()} | {:error, term()}
  def ensure(project_slug, issue_identifier, opts)
      when is_binary(project_slug) and is_binary(issue_identifier) and is_list(opts) do
    case active_execution(project_slug, issue_identifier) do
      %Thread{} = thread -> {:ok, thread}
      nil -> create(project_slug, issue_identifier, opts)
    end
  end

  @spec finish(integer(), String.t()) :: {:ok, Thread.t()} | {:error, term()}
  def finish(session_id, status) when is_integer(session_id) and status in @statuses do
    with {:ok, thread} <- History.get_thread(session_id) do
      case thread
           |> Thread.changeset(%{status: normalize_status(status)})
           |> Repo.update() do
        {:ok, _updated} = result ->
          notify_execution_change()
          result

        other ->
          other
      end
    end
  end

  @spec recent_non_live() :: [Thread.t()]
  def recent_non_live do
    since = DateTime.add(DateTime.utc_now(), -@recent_window_hours * 3600, :second)

    Repo.all(
      from(t in Thread,
        where:
          t.scope == "issue_execution" and t.status != "active" and t.updated_at >= ^since,
        order_by: [desc: t.updated_at]
      )
    )
  end

  defp active_execution(project_slug, issue_identifier) do
    Repo.one(
      from(t in Thread,
        where:
          t.scope == "issue_execution" and t.project_slug == ^project_slug and
            t.issue_identifier == ^issue_identifier and t.status == "active",
        order_by: [desc: t.id],
        limit: 1
      )
    )
  end

  defp create(project_slug, issue_identifier, opts) do
    workspace = Keyword.fetch!(opts, :workspace_path)
    agent_kind = Keyword.get(opts, :agent_kind)

    metadata =
      %{"origin" => "orchestrator"}
      |> maybe_put("unit_id", Keyword.get(opts, :unit_id))
      |> maybe_put("bundle_role", Keyword.get(opts, :bundle_role))

    case %Thread{}
         |> Thread.changeset(%{
           scope: "issue_execution",
           project_slug: project_slug,
           issue_identifier: issue_identifier,
           workspace_path: workspace,
           agent_kind: agent_kind,
           title: Keyword.get(opts, :title) || issue_identifier,
           status: "active",
           metadata: metadata
         })
         |> Repo.insert() do
      {:ok, _thread} = result ->
        notify_execution_change()
        result

      other ->
        other
    end
  end

  defp notify_execution_change do
    _ = Recents.Broadcaster.notify()
    _ = AgentExecution.Broadcaster.notify()
    :ok
  rescue
    _ -> :ok
  end

  # Thread status enum is active|closed|error|archived; map run outcomes onto it.
  defp normalize_status("aborted"), do: "error"
  defp normalize_status("completed"), do: "closed"
  defp normalize_status("paused"), do: "active"
  defp normalize_status(other), do: other

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)
end
