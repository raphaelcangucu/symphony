defmodule SymphonyElixir.KnowledgeBase.SyncWorker do
  @moduledoc """
  Runs the knowledge base git flow (sync -> ensure PR -> evaluate/merge) for one
  repository, updating `SyncState` and broadcasting `kb_sync_updated`. While PR
  checks are pending it reschedules itself; conflicts and check failures are
  terminal and require user action.
  """

  use GenServer

  alias SymphonyElixir.KnowledgeBase.{GitFlow, SyncRegistry, SyncState}
  alias SymphonyElixir.LocalTracker.Broadcaster

  @docs_branch "symphony-docs"
  @pending_recheck_ms 30_000

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    name = Keyword.get(opts, :name, via(opts[:project_slug], opts[:repo_slug]))
    GenServer.start_link(__MODULE__, Map.new(opts), name: name)
  end

  @spec run_now(GenServer.server()) :: :ok
  def run_now(server), do: GenServer.call(server, :run, 60_000)

  @impl true
  def init(state), do: {:ok, Map.put_new_lazy(state, :flow, &default_flow/0)}

  @impl true
  def handle_call(:run, _from, state), do: {:reply, :ok, do_run(state)}

  @impl true
  def handle_info(:run, state), do: {:noreply, do_run(state)}

  defp do_run(%{project_slug: project, repo_slug: repo, flow: flow} = state) do
    set_status(project, repo, %{status: "syncing", last_error: nil})

    with {:ok, ctx} <- flow.resolve.(project, repo),
         {:ok, _} <- flow.sync.(ctx.ws, ctx.default_branch, []) do
      if flow.pending?.(ctx.ws, ctx.default_branch, []) do
        promote(project, repo, ctx, flow, state)
      else
        set_status(project, repo, %{
          status: "synced",
          last_error: nil,
          pr_number: nil,
          pr_url: nil,
          last_synced_at: DateTime.utc_now()
        })
      end
    else
      {:error, :merge_conflict} ->
        set_status(project, repo, %{status: "conflict", last_error: "merge conflict"})

      {:error, reason} ->
        set_status(project, repo, %{status: "error", last_error: inspect(reason)})
    end

    state
  end

  defp promote(project, repo, ctx, flow, state) do
    case flow.ensure_pr.(ctx.repo, @docs_branch, []) do
      {:ok, pr} -> handle_evaluation(project, repo, ctx, pr, flow, state)
      {:error, reason} -> set_status(project, repo, %{status: "error", last_error: inspect(reason)})
    end
  end

  defp handle_evaluation(project, repo, ctx, pr, flow, state) do
    set_status(project, repo, %{status: "open_pr", pr_number: pr.number, pr_url: pr.url})

    case flow.evaluate.(%{repo: ctx.repo, project: ctx.project}, pr.number, []) do
      {:ok, :merged} ->
        set_status(project, repo, %{status: "merged", last_synced_at: DateTime.utc_now()})

      {:ok, :pending} ->
        if recheck?(state), do: Process.send_after(self(), :run, recheck_ms(state))
        :ok

      {:error, :kb_checks_failed} ->
        set_status(project, repo, %{status: "checks_failed", last_error: "PR checks failed"})

      {:error, reason} ->
        set_status(project, repo, %{status: "error", last_error: inspect(reason)})
    end
  end

  defp set_status(project, repo, attrs) do
    {:ok, _} = SyncState.put(project, repo, attrs)
    Broadcaster.kb_event(project, "kb_sync_updated", Map.merge(%{repo_slug: repo}, stringify_status(attrs)))
  end

  defp stringify_status(attrs), do: Map.take(attrs, [:status, :pr_number, :pr_url, :last_error])

  defp recheck?(state), do: Map.get(state, :reschedule, true)
  defp recheck_ms(state), do: Map.get(state, :recheck_ms, @pending_recheck_ms)

  defp default_flow do
    %{
      resolve: &SymphonyElixir.KnowledgeBase.resolve_sync_context/2,
      sync: &GitFlow.sync_branch/3,
      pending?: &GitFlow.pending_changes?/3,
      ensure_pr: &GitFlow.ensure_pull_request/3,
      evaluate: &GitFlow.evaluate_and_merge/3
    }
  end

  defp via(project, repo) when is_binary(project) and is_binary(repo) do
    {:via, Registry, {SyncRegistry, {project, repo}}}
  end

  defp via(_project, _repo), do: nil
end
