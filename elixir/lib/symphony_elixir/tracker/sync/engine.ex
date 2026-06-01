defmodule SymphonyElixir.Tracker.Sync.Engine do
  @moduledoc """
  Background coordinator for local-first tracker sync.

  For each sync-enabled project the engine pushes queued outbox writes to the
  remote (`Driver.push/2`) and then pulls remote issues into the local store
  (`Driver.pull/2` -> `LocalStore.upsert_remote_issue/2`). `request_sync/1` is a
  fire-and-forget `cast`, so callers (the orchestrator poll) never block on the
  remote — reads remain local even while the remote is rate limited.

  `sync_project/2` is the synchronous unit of work used by the cast handler and by
  tests; it accepts a `:driver` override and an optional `:max_attempts`.
  """

  use GenServer
  require Logger

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{LocalStore, Outbox, StateRecord}

  @default_max_attempts 5

  @type summary :: %{pushed: non_neg_integer(), failed: non_neg_integer(), pulled: non_neg_integer()}

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []), do: GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))

  @doc "Fire-and-forget request to sync all sync-enabled projects."
  @spec request_sync(keyword()) :: :ok
  def request_sync(opts \\ []) do
    if alive?(), do: GenServer.cast(__MODULE__, {:sync_all, opts}), else: :ok
  end

  @doc "Synchronously sync one project. Returns a `summary`."
  @spec sync_project(map(), keyword()) :: {:ok, summary()} | {:error, term()}
  def sync_project(project, opts \\ []) do
    driver = Keyword.fetch!(opts, :driver)
    max_attempts = Keyword.get(opts, :max_attempts, @default_max_attempts)

    mark_state(project, %{status: "syncing"})

    with {:ok, push_summary} <- push_outbox(project, driver, max_attempts),
         {:ok, pulled} <- pull_remote(project, driver) do
      mark_state(project, %{status: "idle", last_pull_at: now(), last_push_at: now(), last_error: nil})
      {:ok, Map.put(push_summary, :pulled, pulled)}
    else
      {:error, reason} = error ->
        mark_state(project, %{status: "error", last_error: inspect(reason)})
        error
    end
  end

  @impl true
  def init(opts), do: {:ok, %{driver_for: Keyword.get(opts, :driver_for, &default_driver_for/1)}}

  @impl true
  def handle_cast({:sync_all, opts}, state) do
    Enum.each(sync_enabled_projects(), &sync_one(&1, opts, state))
    {:noreply, state}
  end

  defp sync_one(project, opts, state) do
    case Keyword.get(opts, :driver) || state.driver_for.(project) do
      nil -> :ok
      driver -> run_project_sync(project, Keyword.put(opts, :driver, driver))
    end
  end

  defp run_project_sync(project, opts) do
    case sync_project(project, opts) do
      {:ok, _summary} -> :ok
      {:error, reason} -> Logger.warning("Tracker sync failed for #{project.slug}: #{inspect(reason)}")
    end
  end

  # -- push --------------------------------------------------------------------

  defp push_outbox(project, driver, max_attempts) do
    summary =
      project.id
      |> Outbox.claim_pending(50)
      |> Enum.reduce(%{pushed: 0, failed: 0}, &push_entry(&1, &2, project, driver, max_attempts))

    {:ok, summary}
  end

  defp push_entry(entry, acc, project, driver, max_attempts) do
    case safe_push(driver, project, entry) do
      {:ok, remote_id} -> record_pushed(acc, entry, remote_id)
      {:error, reason} -> record_failed(acc, entry, reason, max_attempts)
    end
  end

  defp record_pushed(acc, entry, remote_id) do
    Outbox.mark_done(entry, remote_id)
    %{acc | pushed: acc.pushed + 1}
  end

  defp record_failed(acc, entry, reason, max_attempts) do
    {:ok, updated} = Outbox.mark_failed(entry, inspect(reason), max_attempts)
    if updated.status == "failed", do: %{acc | failed: acc.failed + 1}, else: acc
  end

  defp safe_push(driver, project, entry) do
    driver.push(project, entry)
  rescue
    error -> {:error, error}
  end

  # -- pull --------------------------------------------------------------------

  defp pull_remote(project, driver) do
    case driver.pull(project, []) do
      {:ok, issues} ->
        Enum.each(issues, fn remote -> LocalStore.upsert_remote_issue(project, remote) end)
        {:ok, length(issues)}

      {:error, _reason} = error ->
        error
    end
  end

  # -- sync state --------------------------------------------------------------

  defp mark_state(project, attrs) do
    base = Repo.get_by(StateRecord, project_id: project.id) || %StateRecord{}

    base
    |> StateRecord.changeset(Map.merge(%{project_id: project.id}, attrs))
    |> Repo.insert_or_update!()
  end

  defp sync_enabled_projects do
    Context.list_projects()
    |> Enum.filter(&sync_enabled?/1)
  end

  defp sync_enabled?(project), do: project.tracker_kind in ["github", "linear"]

  defp default_driver_for(project) do
    case project.tracker_kind do
      "github" -> SymphonyElixir.GitHub.SyncDriver
      "linear" -> SymphonyElixir.Linear.SyncDriver
      _ -> nil
    end
  end

  defp now, do: DateTime.utc_now()

  defp alive? do
    case Process.whereis(__MODULE__) do
      pid when is_pid(pid) -> Process.alive?(pid)
      _ -> false
    end
  end
end
