defmodule SymphonyElixir.KnowledgeBase.DailyPromoter do
  @moduledoc """
  Periodically promotes knowledge base edits to each repository's default branch.

  KB edits commit and push to the `symphony-docs` branch immediately; this worker
  runs on a slow cadence (daily by default) and asks the per-repo `SyncWorker` to
  open — and auto-merge when checks are green — a pull request from `symphony-docs`
  into the default branch. Only repositories already checked out locally are
  considered, so a promotion cycle never triggers a clone storm. Each tick is
  wrapped so a single failing repository can never crash the scheduler.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.KnowledgeBase
  alias SymphonyElixir.KnowledgeBase.Paths
  alias SymphonyElixir.LocalTracker.Context

  @fallback_interval_ms 86_400_000
  @boot_delay_ms 15_000

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) when is_list(opts) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @doc "Runs a promotion cycle immediately and returns how many repositories were promoted."
  @spec promote_now(GenServer.server(), timeout()) :: {:ok, non_neg_integer()}
  def promote_now(server \\ __MODULE__, timeout \\ 60_000) do
    GenServer.call(server, :promote_now, timeout)
  end

  @impl true
  def init(opts) do
    if enabled?(), do: schedule_first_tick()

    state = %{
      tick_count: 0,
      last_promoted_count: 0,
      last_error: nil,
      promote: Keyword.get(opts, :promote, &KnowledgeBase.request_sync/2)
    }

    {:ok, state}
  end

  @impl true
  def handle_call(:promote_now, _from, state) do
    {count, state} = run_tick_safely(state)
    {:reply, {:ok, count}, state}
  end

  @impl true
  def handle_info(:tick, state) do
    {_count, state} = run_tick_safely(state)
    schedule_tick()
    {:noreply, state}
  end

  @impl true
  def handle_info(_message, state), do: {:noreply, state}

  defp run_tick_safely(state) do
    count = run_cycle(state.promote)
    {count, %{state | tick_count: state.tick_count + 1, last_promoted_count: count, last_error: nil}}
  rescue
    exception ->
      Logger.debug("KB promoter tick skipped reason=#{inspect(exception)}")
      {0, %{state | tick_count: state.tick_count + 1, last_error: inspect(exception)}}
  catch
    kind, reason ->
      Logger.debug("KB promoter tick skipped reason=#{inspect({kind, reason})}")
      {0, %{state | tick_count: state.tick_count + 1, last_error: inspect({kind, reason})}}
  end

  defp run_cycle(promote) do
    Context.list_projects()
    |> Enum.flat_map(&promotable_repos/1)
    |> Enum.reduce(0, fn {project_slug, repo_slug}, promoted ->
      case promote_one(promote, project_slug, repo_slug) do
        :ok -> promoted + 1
        :skip -> promoted
      end
    end)
  end

  defp promotable_repos(project) do
    project.slug
    |> Context.list_repositories()
    |> Enum.filter(&checked_out?(project.slug, &1))
    |> Enum.map(fn repo -> {project.slug, Paths.repo_slug(repo.workspace_path)} end)
  end

  # Only repositories Symphony has already materialized are promoted, so a cycle
  # never clones (which `request_sync` would otherwise do via `ensure_workspace`).
  defp checked_out?(project_slug, repo) do
    project_slug
    |> Paths.repo_checkout(repo.workspace_path)
    |> Path.join(".git")
    |> File.dir?()
  end

  defp promote_one(promote, project_slug, repo_slug) do
    case promote.(project_slug, repo_slug) do
      :ok ->
        :ok

      other ->
        Logger.debug(
          "KB promoter skipped #{project_slug}/#{repo_slug} reason=#{inspect(other)}"
        )

        :skip
    end
  end

  defp schedule_first_tick do
    delay = if boot_promote?(), do: @boot_delay_ms, else: interval_ms()
    Process.send_after(self(), :tick, delay)
  end

  defp schedule_tick, do: Process.send_after(self(), :tick, interval_ms())

  defp enabled?, do: Application.get_env(:symphony_elixir, :kb_promote_enabled, true)

  defp boot_promote?, do: Application.get_env(:symphony_elixir, :kb_promote_on_boot, false)

  defp interval_ms do
    case Application.get_env(:symphony_elixir, :kb_promote_interval_ms, @fallback_interval_ms) do
      ms when is_integer(ms) and ms > 0 -> ms
      _invalid -> @fallback_interval_ms
    end
  end
end
