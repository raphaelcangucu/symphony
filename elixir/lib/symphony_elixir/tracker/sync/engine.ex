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

  alias SymphonyElixir.LocalTracker.{Context, Project}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.Tracker.Sync.{LocalStore, Normalize, Outbox, StateRecord}

  @default_seed_retry_seconds 60

  @default_max_attempts 5

  @type summary :: %{
          required(:pushed) => non_neg_integer(),
          required(:failed) => non_neg_integer(),
          required(:pulled) => non_neg_integer(),
          optional(:skipped_pull) => boolean(),
          optional(:enriched) => non_neg_integer()
        }

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

  @doc """
  Returns the persisted sync state row for a project (`nil` when the project has
  never synced, e.g. local-only projects). Used by the tracker API to surface
  sync health in the UI.
  """
  @spec state_for(%{required(:id) => term()}) :: StateRecord.t() | nil
  def state_for(%{id: project_id}), do: Repo.get_by(StateRecord, project_id: project_id)

  @doc """
  Synchronously sync one project. Returns a `summary`.

  Queued outbox writes are always pushed, but the remote pull is coalesced: a
  project pulled more recently than `InstanceConfig.tracker_sync_min_pull_ms/0`
  is skipped (`skipped_pull: true`) unless `force: true` is passed. This keeps a
  fast orchestrator poll from multiplying GitHub reads.
  """
  @spec sync_project(map(), keyword()) :: {:ok, summary()} | {:error, term()}
  def sync_project(project, opts \\ []) do
    driver = Keyword.fetch!(opts, :driver)
    max_attempts = Keyword.get(opts, :max_attempts, @default_max_attempts)

    mark_state(project, %{status: "syncing"})

    with {:ok, push_summary} <- push_outbox(project, driver, max_attempts) do
      if pull_due?(project, Keyword.get(opts, :force, false)) do
        finish_with_pull(project, driver, opts, push_summary)
      else
        mark_state(project, push_only_attrs())
        {:ok, Map.merge(push_summary, %{pulled: 0, skipped_pull: true})}
      end
    else
      {:error, reason} = error ->
        mark_state(project, %{status: "error", last_error: inspect(reason)})
        error
    end
  end

  defp finish_with_pull(project, driver, opts, push_summary) do
    pr_driver = Keyword.get(opts, :pr_driver, SymphonyElixir.GitHub.SyncDriver)

    with :ok <- seed_statuses(project),
         :ok <- seed_users(project),
         {:ok, %{pulled: pulled, enriched: enriched}} <- pull_remote(project, driver, pr_driver) do
      mark_state(project, success_attrs(project))
      {:ok, Map.merge(push_summary, %{pulled: pulled, enriched: enriched, skipped_pull: false})}
    else
      {:error, reason} = error ->
        mark_state(project, %{status: "error", last_error: inspect(reason)})
        error
    end
  end

  # Forced syncs always pull. Otherwise pull only when the project has never been
  # pulled or the last pull is older than the configured minimum interval.
  defp pull_due?(_project, true), do: true

  defp pull_due?(project, false) do
    case Repo.get_by(StateRecord, project_id: project.id) do
      %StateRecord{last_pull_at: %DateTime{} = last_pull_at} ->
        DateTime.diff(now(), last_pull_at, :millisecond) >= min_pull_interval_ms()

      _ ->
        true
    end
  end

  defp min_pull_interval_ms, do: SymphonyElixir.InstanceConfig.tracker_sync_min_pull_ms()

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
    seed_users(project)

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

  defp seed_users(project) do
    case remote_list_assignable_users(project) do
      {:ok, users} -> LocalStore.upsert_users(project, users)
      {:error, _reason} -> :ok
    end
  rescue
    error ->
      Logger.warning("Tracker seed users failed for #{project.slug}: #{inspect(error)}")
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

  defp remote_list_assignable_users(project) do
    case IssueAdapter.remote_for(project.tracker_kind) do
      nil -> {:error, :no_remote_adapter}
      adapter -> adapter.list_assignable_users(project)
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
  def init(opts) do
    ensure_enrich_table()
    {:ok, %{driver_for: Keyword.get(opts, :driver_for, &default_driver_for/1)}}
  end

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
    Logger.info(
      "tracker_sync project=#{project.slug} pushed=#{summary.pushed} failed=#{summary.failed} " <>
        "pulled=#{summary.pulled} enriched=#{Map.get(summary, :enriched, 0)} " <>
        "skipped_pull=#{Map.get(summary, :skipped_pull, false)}"
    )
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
    link_pushed_remote_id(entry, remote_id)
    %{acc | pushed: acc.pushed + 1}
  end

  # After a successful push, stamp the returned remote id onto the matching local
  # row so a later pull reconciles it by `remote_id` instead of inserting a
  # duplicate:
  #   - comment "create": link the locally authored comment.
  #   - issue "create": link the locally drafted issue, which was mirrored with a
  #     `nil` `remote_id`. Skipping this is what lets the pull duplicate the card.
  defp link_pushed_remote_id(%{entity_type: "comment", operation: "create", payload: payload}, remote_id)
       when is_map(payload) do
    LocalStore.link_comment_remote_id(payload["comment_id"], remote_id)
    mark_comment_synced(payload)
  end

  defp link_pushed_remote_id(%{entity_type: "comment", operation: "update", payload: payload}, _remote_id)
       when is_map(payload) do
    mark_comment_synced(payload)
  end

  defp link_pushed_remote_id(%{entity_type: "issue", operation: "create", issue_id: issue_id}, remote_id) do
    LocalStore.link_issue_remote_id(issue_id, remote_id)
  end

  defp link_pushed_remote_id(%{entity_type: "state", operation: "move", project_id: project_id, payload: payload}, _remote_id)
       when is_map(payload) do
    with %{"identifier" => identifier} <- payload,
         %Project{slug: slug} <- Repo.get(Project, project_id) do
      LocalStore.clear_dirty_fields(identifier, slug, ["state"])
    end

    :ok
  end

  defp link_pushed_remote_id(
         %{entity_type: "issue", operation: "update", project_id: project_id, payload: payload},
         _remote_id
       )
       when is_map(payload) do
    with %{"identifier" => identifier} <- payload,
         %Project{slug: slug} <- Repo.get(Project, project_id),
         fields when fields != [] <- pushed_dirty_fields(payload) do
      LocalStore.clear_dirty_fields(identifier, slug, fields)
    end

    :ok
  end

  defp link_pushed_remote_id(_entry, _remote_id), do: :ok

  defp pushed_dirty_fields(payload) when is_map(payload) do
    []
    |> put_pushed_field(payload, "agent", "labels")
    |> put_pushed_field(payload, "label_ids", "labels")
    |> put_pushed_field(payload, "labels", "labels")
    |> put_pushed_field(payload, "title", "title")
    |> put_pushed_field(payload, "description", "description")
    |> put_pushed_field(payload, "priority", "priority")
    |> put_pushed_field(payload, "assignee_ids", "assignee_id")
    |> Enum.uniq()
  end

  defp put_pushed_field(fields, payload, payload_key, dirty_key) do
    if Map.has_key?(payload, payload_key), do: [dirty_key | fields], else: fields
  end

  defp record_failed(acc, entry, reason, max_attempts) do
    {:ok, updated} = Outbox.mark_failed(entry, inspect(reason), max_attempts)

    if updated.status == "failed" do
      mark_comment_push_exhausted(updated)
      %{acc | failed: acc.failed + 1}
    else
      acc
    end
  end

  defp mark_comment_synced(%{"comment_id" => comment_id}) when is_integer(comment_id) do
    LocalStore.mark_comment_sync_status(comment_id, "synced")
    :ok
  end

  defp mark_comment_synced(_payload), do: :ok

  defp mark_comment_push_exhausted(%{entity_type: "comment", payload: %{"comment_id" => comment_id}})
       when is_integer(comment_id) do
    LocalStore.mark_comment_sync_status(comment_id, "error")
    :ok
  end

  defp mark_comment_push_exhausted(_entry), do: :ok

  defp safe_push(driver, project, entry) do
    driver.push(project, entry)
  rescue
    error -> {:error, error}
  end

  # -- pull --------------------------------------------------------------------

  # The background pull is "light": the driver returns issue metadata only (no
  # per-issue comments). Comments and pull requests are enriched from the remote
  # only for issues in an active state, and at most once per
  # `InstanceConfig.tracker_pr_sync_ttl_ms/0`, so a routine pull does not spend a
  # GitHub call per issue on boards that are mostly idle.
  defp pull_remote(project, driver, pr_driver) do
    case driver.pull(project, []) do
      {:ok, issues} ->
        active = active_state_set(project)
        enriched = Enum.reduce(issues, 0, fn remote, acc -> acc + upsert_one(project, remote, pr_driver, active) end)
        {:ok, %{pulled: length(issues), enriched: enriched}}

      {:error, _reason} = error ->
        error
    end
  end

  # Returns 1 when the issue was enriched (comments + PRs), 0 otherwise.
  defp upsert_one(project, remote, pr_driver, active) do
    if enrich?(project, remote, active) do
      enrich_issue(project, remote, pr_driver)
    else
      LocalStore.upsert_remote_issue(project, remote)
      0
    end
  end

  defp enrich_issue(project, remote, pr_driver) do
    identifier = remote[:identifier]
    comments = enrich_comments(project, identifier)

    case LocalStore.upsert_remote_issue(project, Map.put(remote, :comments, comments)) do
      {:ok, issue} ->
        sync_pull_requests(project, issue, pr_driver)
        mark_enriched(project, identifier)
        1

      {:error, _reason} ->
        0
    end
  end

  defp enrich?(project, remote, active) do
    active_state?(remote[:state], active) and enrich_ttl_due?(project, remote[:identifier])
  end

  defp active_state?(state, active) when is_binary(state), do: MapSet.member?(active, normalize_state(state))
  defp active_state?(_state, _active), do: false

  defp active_state_set(project) do
    project
    |> SymphonyElixir.ProjectConfig.resolve()
    |> Map.get(:active_states)
    |> List.wrap()
    |> Enum.map(&normalize_state/1)
    |> MapSet.new()
  end

  defp enrich_comments(project, identifier) do
    case IssueAdapter.remote_for(project.tracker_kind) do
      nil -> []
      adapter -> remote_comments(adapter, project, identifier)
    end
  end

  defp normalize_state(state) when is_binary(state), do: state |> String.trim() |> String.downcase()
  defp normalize_state(_state), do: ""

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

  # A coalesced (push-only) sync leaves `last_pull_at` untouched so the pull gate
  # still measures against the last real remote pull.
  defp push_only_attrs, do: %{status: "idle", last_push_at: now(), last_error: nil}

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

  # -- enrich TTL --------------------------------------------------------------
  #
  # Per-issue "last enriched at" markers live in a process-global ETS table owned
  # by the engine. They are intentionally not persisted: a fresh boot simply
  # re-enriches active issues once. When the table is absent (e.g. `sync_project/2`
  # called directly in a test without the engine running) every issue is treated
  # as due, preserving the pre-gate behavior.
  @enrich_table :symphony_tracker_enrich_ttl

  defp ensure_enrich_table do
    if :ets.whereis(@enrich_table) == :undefined do
      :ets.new(@enrich_table, [:named_table, :public, :set])
    end

    :ok
  rescue
    ArgumentError -> :ok
  end

  defp enrich_ttl_due?(project, identifier) do
    ttl = pr_sync_ttl_ms()

    cond do
      ttl <= 0 -> true
      :ets.whereis(@enrich_table) == :undefined -> true
      true -> enrich_marker_expired?({project.id, identifier}, ttl)
    end
  end

  defp enrich_marker_expired?(key, ttl) do
    case safe_enrich_lookup(key) do
      last when is_integer(last) -> System.monotonic_time(:millisecond) - last >= ttl
      _ -> true
    end
  end

  defp safe_enrich_lookup(key) do
    case :ets.lookup(@enrich_table, key) do
      [{^key, last}] -> last
      _ -> nil
    end
  rescue
    ArgumentError -> nil
  end

  defp mark_enriched(project, identifier) do
    if :ets.whereis(@enrich_table) != :undefined do
      :ets.insert(@enrich_table, {{project.id, identifier}, System.monotonic_time(:millisecond)})
    end

    :ok
  rescue
    ArgumentError -> :ok
  end

  defp pr_sync_ttl_ms, do: SymphonyElixir.InstanceConfig.tracker_pr_sync_ttl_ms()

  defp now, do: DateTime.utc_now()

  defp alive? do
    case Process.whereis(__MODULE__) do
      pid when is_pid(pid) -> Process.alive?(pid)
      _ -> false
    end
  end
end
