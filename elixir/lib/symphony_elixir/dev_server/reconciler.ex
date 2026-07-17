defmodule SymphonyElixir.DevServer.Reconciler do
  @moduledoc """
  Periodically reconciles configured dev-server auto-start triggers.

  The reconciler is intentionally conservative: every tick gathers a bounded set
  of wait-state issues, computes identifiers selected by configured triggers,
  and asks the dev-server manager to start only those issues.
  """

  use GenServer

  alias Ecto.Association.NotLoaded

  require Logger

  alias SymphonyElixir.{Config, Repo, Tracker}
  alias SymphonyElixir.DevServer.LeaseStore
  alias SymphonyElixir.DevServer.Manager
  alias SymphonyElixir.DevServer.RuntimeContractStore
  alias SymphonyElixir.GitHub.Config, as: GitHubConfig
  alias SymphonyElixir.GitHub.PullRequests
  alias SymphonyElixir.LocalTracker.{Context, Project}
  alias SymphonyElixir.ProjectConfig

  @fallback_poll_interval_ms 30_000
  @slot_gc_grace_seconds 120

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) when is_list(opts) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @spec reconcile([String.t()], %{optional(atom()) => [String.t()]}) :: [String.t()]
  def reconcile(auto_start_on, candidates) when is_list(auto_start_on) and is_map(candidates) do
    auto_start_on
    |> Enum.flat_map(fn
      "human_review" -> Map.get(candidates, :human_review, [])
      "pull_request" -> Map.get(candidates, :pull_request, [])
      _ -> []
    end)
    |> Enum.uniq()
  end

  @doc false
  @spec candidates([String.t()], [term()]) :: %{optional(atom()) => [String.t()]}
  def candidates(auto_start_on, issues), do: candidates(auto_start_on, issues, [])

  @doc false
  @spec candidates([String.t()], [term()], keyword()) :: %{optional(atom()) => [String.t()]}
  def candidates(auto_start_on, issues, opts)
      when is_list(auto_start_on) and is_list(issues) and is_list(opts) do
    requested = MapSet.new(auto_start_on)

    %{}
    |> maybe_put_human_review_candidates(requested, issues)
    |> maybe_put_pull_request_candidates(requested, issues, opts)
  end

  @doc false
  @spec project_slug_for(term()) :: String.t() | nil
  def project_slug_for(issue), do: project_slug_for(issue, [])

  @doc false
  @spec project_slug_for(term(), keyword()) :: String.t() | nil
  def project_slug_for(issue, opts) when is_list(opts) do
    explicit_project_slug(issue) ||
      project_slug_from_project_id(issue, opts) ||
      local_project_slug(opts)
  end

  @doc false
  @spec repo_for(term()) :: {:ok, String.t()} | {:error, term()}
  def repo_for(issue), do: repo_for(issue, [])

  @doc false
  @spec repo_for(term(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def repo_for(issue, opts) when is_list(opts) do
    case loaded_project(map_value(issue, :project)) do
      nil -> repo_for_project_context(opts)
      project -> repo_for_project(project)
    end
  end

  @impl true
  def init(_opts) do
    schedule_tick_safely()
    {:ok, %{}}
  end

  @impl true
  def handle_info(:tick, state) do
    run_tick_safely()

    schedule_tick_safely()
    {:noreply, state}
  end

  defp schedule_tick_safely do
    Process.send_after(self(), :tick, poll_interval_ms())
  rescue
    exception ->
      Logger.debug("Dev server reconciler tick scheduling skipped reason=#{inspect(exception)}")
  catch
    kind, reason ->
      Logger.debug("Dev server reconciler tick scheduling skipped reason=#{inspect({kind, reason})}")
  end

  defp run_tick_safely do
    run_cycle()
  rescue
    exception ->
      Logger.debug("Dev server reconciler tick skipped reason=#{inspect(exception)}")
  catch
    kind, reason ->
      Logger.debug("Dev server reconciler tick skipped reason=#{inspect({kind, reason})}")
  end

  defp run_cycle do
    auto_start_on = configured_auto_start_triggers()

    wait_state_issues = fetch_wait_state_issues()

    if known_trigger_requested?(auto_start_on) do
      issue_index = issue_index(wait_state_issues)

      auto_start_on
      |> reconcile(candidates(auto_start_on, wait_state_issues))
      |> Enum.each(&start_candidate(&1, issue_index))
    end

    reconcile_contracted_previews()

    gc_preview_slots(wait_state_issues)
  end

  # Converge persisted dev-server records with runtime truth for every issue
  # holding an unexpired runtime contract. `Manager.list_for_issue/2` probes
  # each record's port, adopts externally serving contracted processes back to
  # "ready" (e.g. docker containers that outlived a Symphony restart), demotes
  # dead ones, and broadcasts changes to the Preview dock — so the dock stays
  # in sync without depending on a UI poll.
  defp reconcile_contracted_previews do
    Enum.each(Context.list_projects(), fn project ->
      project.id
      |> RuntimeContractStore.active_issue_identifiers()
      |> Enum.each(fn identifier -> Manager.list_for_issue(project.slug, identifier) end)
    end)
  rescue
    exception ->
      Logger.debug("Dev server contracted preview reconcile skipped reason=#{inspect(exception)}")
  catch
    kind, reason ->
      Logger.debug("Dev server contracted preview reconcile skipped reason=#{inspect({kind, reason})}")
  end

  @doc false
  @spec slots_to_release([{String.t(), String.t(), DateTime.t()}], MapSet.t(), DateTime.t()) ::
          [{String.t(), String.t()}]
  def slots_to_release(leased, alive, now) when is_list(leased) and is_map(alive) do
    leased
    |> Enum.filter(fn {project_slug, identifier, inserted_at} ->
      not MapSet.member?(alive, {project_slug, identifier}) and
        DateTime.diff(now, inserted_at, :second) >= @slot_gc_grace_seconds
    end)
    |> Enum.map(fn {project_slug, identifier, _inserted_at} -> {project_slug, identifier} end)
  end

  defp gc_preview_slots(wait_state_issues) do
    case LeaseStore.leased_issue_slots() do
      [] -> :ok
      leased -> sweep_leased_slots(leased, wait_state_issues)
    end
  rescue
    exception -> Logger.debug("Dev server preview slot GC skipped reason=#{inspect(exception)}")
  catch
    kind, reason ->
      Logger.debug("Dev server preview slot GC skipped reason=#{inspect({kind, reason})}")
  end

  defp sweep_leased_slots(leased, wait_state_issues) do
    slugs_by_id = Map.new(Context.list_projects(), &{&1.id, &1.slug})
    {orphaned, resolvable} = split_leases_by_project(leased, slugs_by_id)

    # Slots whose project no longer exists are always released.
    Enum.each(orphaned, fn {project_id, identifier} ->
      LeaseStore.release_slot(project_id, identifier)
    end)

    release_stale_slots(resolvable, wait_state_issues)
  end

  defp split_leases_by_project(leased, slugs_by_id) do
    {orphaned, resolvable} =
      Enum.reduce(leased, {[], []}, fn {project_id, identifier, inserted_at}, {orphaned, resolvable} ->
        case Map.get(slugs_by_id, project_id) do
          nil -> {[{project_id, identifier} | orphaned], resolvable}
          slug -> {orphaned, [{slug, identifier, inserted_at, project_id} | resolvable]}
        end
      end)

    {Enum.reverse(orphaned), Enum.reverse(resolvable)}
  end

  defp release_stale_slots(resolvable, wait_state_issues) do
    alive = alive_issue_keys(wait_state_issues)
    now = DateTime.utc_now()
    ids_by_slug_identifier = ids_by_slug_identifier(resolvable)

    resolvable
    |> Enum.map(fn {slug, identifier, inserted_at, _project_id} ->
      {slug, identifier, inserted_at}
    end)
    |> slots_to_release(alive, now)
    |> Enum.each(fn {_slug, identifier} = key ->
      project_id = Map.fetch!(ids_by_slug_identifier, key)
      LeaseStore.release_slot(project_id, identifier)
    end)
  end

  defp ids_by_slug_identifier(resolvable) do
    Map.new(resolvable, fn {slug, identifier, _inserted_at, project_id} ->
      {{slug, identifier}, project_id}
    end)
  end

  defp alive_issue_keys(wait_state_issues) do
    from_issues =
      Enum.flat_map(wait_state_issues, fn issue ->
        with slug when is_binary(slug) <- project_slug_for(issue),
             identifier when is_binary(identifier) <- issue_identifier(issue) do
          [{slug, identifier}]
        else
          _missing -> []
        end
      end)

    from_issues
    |> MapSet.new()
    |> MapSet.union(Manager.running_issue_keys())
    # DB-live keys keep the slot of an adopted external process (ready record,
    # no registered instance) from being GC'd while it is still serving.
    |> MapSet.union(Manager.db_live_issue_keys())
  end

  defp known_trigger_requested?(auto_start_on) when is_list(auto_start_on) do
    Enum.any?(auto_start_on, &(&1 in ["human_review", "pull_request"]))
  end

  defp known_trigger_requested?(_auto_start_on), do: false

  defp configured_auto_start_triggers do
    Context.list_projects()
    |> Enum.flat_map(fn project ->
      project
      |> Repo.preload(:setup)
      |> ProjectConfig.resolve()
      |> ProjectConfig.dev_server_auto_start_on()
    end)
    |> Enum.uniq()
  end

  defp fetch_wait_state_issues do
    case Config.wait_states() do
      [] ->
        []

      states ->
        case Tracker.fetch_issues_by_states(states) do
          {:ok, issues} when is_list(issues) ->
            issues

          {:ok, unexpected} ->
            Logger.debug("Dev server issue fetch skipped reason={:unexpected_result, #{inspect(unexpected)}}")
            []

          {:error, reason} ->
            Logger.debug("Dev server issue fetch skipped reason=#{inspect(reason)}")
            []
        end
    end
  end

  defp maybe_put_human_review_candidates(candidates, requested, issues) do
    if MapSet.member?(requested, "human_review") do
      Map.put(candidates, :human_review, issue_identifiers(issues))
    else
      candidates
    end
  end

  defp maybe_put_pull_request_candidates(candidates, requested, issues, opts) do
    if MapSet.member?(requested, "pull_request") do
      Map.put(candidates, :pull_request, pull_request_issue_identifiers(issues, opts))
    else
      candidates
    end
  end

  defp pull_request_issue_identifiers(issues, opts) do
    repo_resolver = Keyword.get(opts, :repo_resolver, &repo_for/1)
    pull_request_reader = Keyword.get(opts, :pull_request_reader, &PullRequests.for_issue/2)

    issues
    |> Enum.flat_map(&pull_request_issue_identifier(&1, repo_resolver, pull_request_reader))
    |> Enum.uniq()
  end

  defp pull_request_issue_identifier(issue, repo_resolver, pull_request_reader) do
    case issue_identifier(issue) do
      nil ->
        []

      identifier ->
        pull_request_issue_identifier(issue, identifier, repo_resolver, pull_request_reader)
    end
  end

  defp pull_request_issue_identifier(issue, identifier, repo_resolver, pull_request_reader) do
    case resolve_repo(repo_resolver, issue) do
      {:ok, repo} ->
        case read_pull_requests(pull_request_reader, repo, identifier) do
          {:ok, [_ | _]} ->
            [identifier]

          {:ok, []} ->
            []

          {:error, reason} ->
            Logger.debug("Dev server pull-request trigger skipped issue=#{identifier} reason=#{inspect(reason)}")
            []
        end

      {:error, reason} ->
        Logger.debug("Dev server pull-request trigger skipped issue=#{identifier} reason=#{inspect(reason)}")
        []
    end
  end

  defp resolve_repo(repo_resolver, issue) when is_function(repo_resolver, 1) do
    repo_resolver.(issue)
  rescue
    exception -> {:error, exception}
  catch
    kind, reason -> {:error, {kind, reason}}
  end

  defp read_pull_requests(pull_request_reader, repo, identifier)
       when is_function(pull_request_reader, 2) do
    pull_request_reader.(repo, identifier)
  rescue
    exception -> {:error, exception}
  catch
    kind, reason -> {:error, {kind, reason}}
  end

  defp repo_for_project_context(opts) do
    case local_project_slug(opts) do
      nil ->
        configured_github_repo(opts)

      project_slug ->
        case lookup_project(project_slug, opts) do
          {:ok, project} -> repo_for_project(project)
          {:error, _reason} -> configured_github_repo(opts)
        end
    end
  end

  defp repo_for_project(%Project{} = project), do: PullRequests.resolve_repo(project)

  defp repo_for_project(project) when is_map(project) do
    case map_value(project, :tracker_kind) do
      "github" -> repo_from_tracker_config(map_value(project, :tracker_config))
      kind when is_binary(kind) -> {:error, {:unsupported_tracker_kind, kind}}
      _missing -> {:error, :missing_github_repo}
    end
  end

  defp repo_for_project(_project), do: {:error, :missing_github_repo}

  defp configured_github_repo(opts) do
    case tracker_kind(opts) do
      "github" -> repo_from_tracker_config(%{"repo" => github_repo(opts)})
      kind -> {:error, {:unsupported_tracker_kind, kind}}
    end
  rescue
    exception -> {:error, exception}
  catch
    kind, reason -> {:error, {kind, reason}}
  end

  defp repo_from_tracker_config(config) when is_map(config) do
    case non_empty_string(map_value(config, :repo)) do
      nil -> {:error, :missing_github_repo}
      repo -> {:ok, repo}
    end
  end

  defp repo_from_tracker_config(_config), do: {:error, :missing_github_repo}

  defp start_candidate(identifier, issue_index) do
    issue = Map.get(issue_index, identifier)

    case project_slug_for(issue) do
      nil ->
        Logger.debug("Dev server auto-start skipped issue=#{identifier} reason=:missing_project_slug")

      project_slug ->
        case Context.get_project(project_slug) do
          {:ok, project} ->
            config = project |> Repo.preload(:setup) |> ProjectConfig.resolve()

            if ProjectConfig.dev_server_auto_start_on(config) != [] do
              case Manager.start_for_issue(project_slug, identifier) do
                {:ok, _pids} ->
                  :ok

                {:error, reason} ->
                  Logger.debug("Dev server auto-start skipped project=#{project_slug} issue=#{identifier} reason=#{inspect(reason)}")
              end
            end

          {:error, :project_not_found} ->
            Logger.debug("Dev server auto-start skipped issue=#{identifier} reason=:project_not_found")
        end
    end
  rescue
    exception ->
      Logger.debug("Dev server auto-start skipped issue=#{identifier} reason=#{inspect(exception)}")
  catch
    kind, reason ->
      Logger.debug("Dev server auto-start skipped issue=#{identifier} reason=#{inspect({kind, reason})}")
  end

  defp explicit_project_slug(nil), do: nil

  defp explicit_project_slug(issue) do
    case non_empty_string(map_value(issue, :project_slug)) do
      nil -> issue |> map_value(:project) |> loaded_project() |> project_slug()
      slug -> slug
    end
  end

  defp project_slug_from_project_id(issue, opts) do
    with project_id when not is_nil(project_id) <- map_value(issue, :project_id),
         lookup when is_function(lookup, 1) <- Keyword.get(opts, :project_lookup_by_id),
         {:ok, project} <- lookup_project_by_id(lookup, project_id) do
      project_slug(project)
    else
      _missing -> nil
    end
  end

  defp lookup_project_by_id(lookup, project_id) do
    lookup.(project_id)
  rescue
    exception -> {:error, exception}
  catch
    kind, reason -> {:error, {kind, reason}}
  end

  defp project_slug(project) do
    project
    |> map_value(:slug)
    |> non_empty_string()
  end

  defp issue_index(issues) do
    Enum.reduce(issues, %{}, fn issue, acc ->
      case issue_identifier(issue) do
        nil -> acc
        identifier -> Map.put_new(acc, identifier, issue)
      end
    end)
  end

  defp issue_identifiers(issues) do
    issues
    |> Enum.flat_map(fn issue ->
      case issue_identifier(issue) do
        nil -> []
        identifier -> [identifier]
      end
    end)
    |> Enum.uniq()
  end

  defp issue_identifier(issue) do
    issue
    |> map_value(:identifier)
    |> non_empty_string()
  end

  defp lookup_project(project_slug, opts) do
    project_lookup = Keyword.get(opts, :project_lookup, &Context.get_project/1)

    project_lookup.(project_slug)
  rescue
    exception -> {:error, exception}
  catch
    kind, reason -> {:error, {kind, reason}}
  end

  defp local_project_slug(opts) do
    if Keyword.has_key?(opts, :local_project_slug) do
      opts
      |> Keyword.get(:local_project_slug)
      |> non_empty_string()
    else
      Config.local_project_slug()
    end
  rescue
    _exception -> nil
  catch
    _kind, _reason -> nil
  end

  defp tracker_kind(opts) do
    case Keyword.fetch(opts, :tracker_kind) do
      {:ok, kind} -> kind
      :error -> Config.tracker_kind()
    end
  end

  defp github_repo(opts) do
    case Keyword.fetch(opts, :github_repo) do
      {:ok, repo_fun} when is_function(repo_fun, 0) -> repo_fun.()
      {:ok, repo} -> repo
      :error -> GitHubConfig.repo()
    end
  end

  defp poll_interval_ms do
    case Config.poll_interval_ms() do
      interval when is_integer(interval) and interval > 0 -> interval
      _invalid -> @fallback_poll_interval_ms
    end
  rescue
    _exception -> @fallback_poll_interval_ms
  catch
    _kind, _reason -> @fallback_poll_interval_ms
  end

  defp loaded_project(nil), do: nil
  defp loaded_project(%NotLoaded{}), do: nil
  defp loaded_project(project), do: project

  defp map_value(value, key) when is_map(value) and is_atom(key) do
    Map.get(value, key) || Map.get(value, Atom.to_string(key))
  end

  defp map_value(_value, _key), do: nil

  defp non_empty_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp non_empty_string(_value), do: nil
end
