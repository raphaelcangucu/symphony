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
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.Tracker.Sync.{LocalStore, Normalize, Outbox, StateRecord}

  @default_seed_retry_seconds 60

  @default_max_attempts 5

  @type summary :: %{pushed: non_neg_integer(), failed: non_neg_integer(), pulled: non_neg_integer()}

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []), do: GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))

  @doc """
  Fire-and-forget request to sync all sync-enabled projects. No-op (still returns
  `:ok`) when the engine is down or local-first sync is globally disabled, so a
  stray request can never schedule background work that would otherwise race with
  callers that toggle the flag (e.g. tests).
  """
  @spec request_sync(keyword()) :: :ok
  def request_sync(opts \\ []) do
    if alive?() and SymphonyElixir.Config.tracker_sync_enabled?() do
      GenServer.cast(__MODULE__, {:sync_all, opts})
    end

    :ok
  end

  @doc "Synchronously sync one project. Returns a `summary`."
  @spec sync_project(map(), keyword()) :: {:ok, summary()} | {:error, term()}
  def sync_project(project, opts \\ []) do
    driver = Keyword.fetch!(opts, :driver)
    pr_driver = Keyword.get(opts, :pr_driver, SymphonyElixir.GitHub.SyncDriver)
    max_attempts = Keyword.get(opts, :max_attempts, @default_max_attempts)

    mark_state(project, %{status: "syncing"})

    with {:ok, push_summary} <- push_outbox(project, driver, max_attempts),
         :ok <- seed_statuses(project),
         {:ok, pulled} <- pull_remote(project, driver, pr_driver) do
      mark_state(project, success_attrs(project))
      {:ok, Map.put(push_summary, :pulled, pulled)}
    else
      {:error, reason} = error ->
        mark_state(project, %{status: "error", last_error: inspect(reason)})
        error
    end
  end

  @doc """
  Force-sync a single issue straight from the remote, bypassing the background
  cadence. Pulls the issue, its comments (classified, including workpads) and its
  pull requests, then upserts them into the local store. Used by the on-demand
  "Sync from remote" action so a user can immediately reconcile a discrepancy.

  Returns `{:error, :sync_disabled}` when local-first sync is off globally and
  `{:error, :not_supported_on_remote}` for projects without a remote tracker.
  """
  @spec sync_issue(map(), String.t(), keyword()) :: {:ok, struct()} | {:error, term()}
  def sync_issue(project, identifier, opts \\ []) do
    cond do
      not SymphonyElixir.Config.tracker_sync_enabled?() -> {:error, :sync_disabled}
      not sync_enabled?(project) -> {:error, :not_supported_on_remote}
      true -> do_sync_issue(project, identifier, opts)
    end
  end

  defp do_sync_issue(project, identifier, opts) do
    case IssueAdapter.remote_for(project.tracker_kind) do
      nil ->
        {:error, :no_remote_adapter}

      adapter ->
        with {:ok, dto} <- adapter.get_issue(project, identifier) do
          remote = Normalize.issue(dto, comments: remote_comments(adapter, project, identifier))
          pr_driver = Keyword.get(opts, :pr_driver, default_driver_for(project))

          case LocalStore.upsert_remote_issue(project, remote) do
            {:ok, issue} ->
              maybe_sync_pull_requests(project, issue, pr_driver)
              {:ok, issue}

            {:error, _reason} = error ->
              error
          end
        end
    end
  end

  defp remote_comments(adapter, project, identifier) do
    case adapter.list_comments(project, identifier) do
      {:ok, comments} -> comments
      _other -> []
    end
  end

  defp maybe_sync_pull_requests(_project, _issue, nil), do: :ok
  defp maybe_sync_pull_requests(project, issue, pr_driver), do: sync_pull_requests(project, issue, pr_driver)

  @doc """
  Seeds a cold project's issue list from the remote on first read so the board is
  not empty at cold start. Synchronous and bounded (issue list only — no comments
  or PRs), then requests a full background sync to enrich. It is a no-op once the
  project has been synced (`last_full_sync_at`), when a recent attempt already ran
  (to avoid hammering a rate-limited remote), or when seeding is disabled.
  """
  @spec ensure_seeded(map()) :: :ok
  def ensure_seeded(project) do
    if seed_on_empty?() and seed_needed?(project), do: seed_light(project)
    :ok
  end

  defp seed_needed?(project), do: mirror_empty?(project) and attempt_allowed?(project)

  defp mirror_empty?(project) do
    [project.id]
    |> Context.count_issues_by_project_ids()
    |> Map.get(project.id, 0) == 0
  end

  defp attempt_allowed?(project) do
    case Repo.get_by(StateRecord, project_id: project.id) do
      %StateRecord{last_full_sync_at: %DateTime{}} -> false
      %StateRecord{updated_at: %DateTime{} = attempted_at} -> stale_attempt?(attempted_at)
      _ -> true
    end
  end

  defp stale_attempt?(attempted_at), do: DateTime.diff(now(), attempted_at, :second) >= seed_retry_seconds()

  defp seed_light(project) do
    mark_state(project, %{status: "syncing"})
    seed_statuses(project)

    case remote_list_issues(project) do
      {:ok, dtos} ->
        seeded = Enum.count(dtos, fn dto -> seed_issue(project, dto) == :ok end)
        finalize_seed(project, dtos, seeded)

      {:error, reason} = error ->
        mark_state(project, %{status: "error", last_error: inspect(reason)})
        error
    end
  end

  # Marks a full sync (locking re-seed) only when issues were actually mirrored
  # or the remote is genuinely empty. A partial failure (had issues, seeded none)
  # leaves `last_full_sync_at` unset so the next read retries instead of locking
  # an empty board forever.
  defp finalize_seed(project, _dtos, seeded) when seeded > 0 do
    mark_state(project, success_attrs(project))
    request_sync()
    {:ok, seeded}
  end

  # An empty remote board is only "fully synced" once its statuses are mirrored.
  # If status seeding failed (e.g. the remote was rate limited) the mirror stays
  # empty; leaving `last_full_sync_at` unset lets the next read retry instead of
  # locking an empty, status-less board forever.
  defp finalize_seed(project, [], 0) do
    if has_statuses?(project) do
      mark_state(project, success_attrs(project))
      {:ok, 0}
    else
      mark_state(project, %{status: "error", last_error: "status seed incomplete; will retry"})
      {:error, :status_seed_incomplete}
    end
  end

  defp finalize_seed(project, dtos, 0) do
    mark_state(project, %{status: "error", last_error: "seeded 0 of #{length(dtos)} issues"})
    {:error, :seed_incomplete}
  end

  defp seed_statuses(project) do
    case remote_list_statuses(project) do
      {:ok, statuses} -> LocalStore.upsert_statuses(project, statuses)
      {:error, _reason} -> :ok
    end
  rescue
    error ->
      Logger.warning("Tracker seed statuses failed for #{project.slug}: #{inspect(error)}")
      :ok
  end

  defp remote_list_statuses(project) do
    case IssueAdapter.remote_for(project.tracker_kind) do
      nil -> {:error, :no_remote_adapter}
      adapter -> adapter.list_statuses(project)
    end
  end

  defp remote_list_issues(project) do
    case IssueAdapter.remote_for(project.tracker_kind) do
      nil -> {:error, :no_remote_adapter}
      adapter -> adapter.list_issues(project, [])
    end
  end

  defp seed_issue(project, dto) do
    case LocalStore.upsert_remote_issue(project, Normalize.issue(dto, comments: [])) do
      {:ok, _issue} -> :ok
      _other -> :error
    end
  rescue
    error ->
      Logger.warning("Tracker seed upsert failed for #{project.slug}: #{inspect(error)}")
      :error
  end

  defp has_statuses?(project), do: Context.list_statuses(project.slug) != []

  defp seed_on_empty?, do: Application.get_env(:symphony_elixir, :tracker_seed_on_empty, true) == true

  defp seed_retry_seconds do
    case Application.get_env(:symphony_elixir, :tracker_seed_retry_seconds, @default_seed_retry_seconds) do
      seconds when is_integer(seconds) and seconds >= 0 -> seconds
      _ -> @default_seed_retry_seconds
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
      {:ok, summary} -> log_summary(project, summary)
      {:error, reason} -> Logger.warning("Tracker sync failed for #{project.slug}: #{inspect(reason)}")
    end
  end

  @doc "Emits a structured, single-line sync summary for observability."
  @spec log_summary(map(), summary()) :: :ok
  def log_summary(project, summary) do
    Logger.info("tracker_sync project=#{project.slug} pushed=#{summary.pushed} failed=#{summary.failed} pulled=#{summary.pulled}")
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
    link_pushed_comment(entry, remote_id)
    %{acc | pushed: acc.pushed + 1}
  end

  defp link_pushed_comment(%{entity_type: "comment", operation: "create", payload: payload}, remote_id)
       when is_map(payload) do
    LocalStore.link_comment_remote_id(payload["comment_id"], remote_id)
  end

  defp link_pushed_comment(_entry, _remote_id), do: :ok

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

  defp pull_remote(project, driver, pr_driver) do
    case driver.pull(project, []) do
      {:ok, issues} ->
        Enum.each(issues, &upsert_with_prs(project, &1, pr_driver))
        {:ok, length(issues)}

      {:error, _reason} = error ->
        error
    end
  end

  defp upsert_with_prs(project, remote, pr_driver) do
    case LocalStore.upsert_remote_issue(project, remote) do
      {:ok, issue} -> sync_pull_requests(project, issue, pr_driver)
      {:error, _reason} -> :ok
    end
  end

  defp sync_pull_requests(project, issue, pr_driver) do
    case pr_driver.pull_pull_requests(project, issue) do
      {:ok, prs} -> LocalStore.upsert_pull_requests(issue, prs)
      {:error, _reason} -> :ok
    end
  end

  # -- sync state --------------------------------------------------------------

  defp mark_state(project, attrs) do
    base = Repo.get_by(StateRecord, project_id: project.id) || %StateRecord{}

    base
    |> StateRecord.changeset(Map.merge(%{project_id: project.id}, attrs))
    |> Repo.insert_or_update!()
  end

  defp success_attrs(project) do
    base = %{status: "idle", last_pull_at: now(), last_push_at: now(), last_error: nil}

    case Repo.get_by(StateRecord, project_id: project.id) do
      %StateRecord{last_full_sync_at: %DateTime{}} -> base
      _ -> Map.put(base, :last_full_sync_at, now())
    end
  end

  defp sync_enabled_projects do
    if SymphonyElixir.Config.tracker_sync_enabled?() do
      Context.list_projects() |> Enum.filter(&sync_enabled?/1)
    else
      []
    end
  end

  defp sync_enabled?(project), do: project.tracker_kind in ["github", "linear", "jira"]

  defp default_driver_for(project) do
    case project.tracker_kind do
      "github" -> SymphonyElixir.GitHub.SyncDriver
      "linear" -> SymphonyElixir.Linear.SyncDriver
      "jira" -> SymphonyElixir.Jira.SyncDriver
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
