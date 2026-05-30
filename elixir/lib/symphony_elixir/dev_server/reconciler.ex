defmodule SymphonyElixir.DevServer.Reconciler do
  @moduledoc """
  Periodically reconciles configured dev-server auto-start triggers.

  The reconciler is intentionally conservative: every tick gathers a bounded set
  of wait-state issues, computes identifiers selected by configured triggers,
  and asks the dev-server manager to start only those issues.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.{Config, Tracker}
  alias SymphonyElixir.DevServer.Manager
  alias SymphonyElixir.GitHub.Config, as: GitHubConfig
  alias SymphonyElixir.GitHub.PullRequests
  alias SymphonyElixir.LocalTracker.Project

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

  @impl true
  def init(_opts) do
    schedule_tick()
    {:ok, %{}}
  end

  @impl true
  def handle_info(:tick, state) do
    if Config.dev_server_enabled?() do
      run_cycle_safely()
    end

    schedule_tick()
    {:noreply, state}
  end

  defp schedule_tick do
    Process.send_after(self(), :tick, Config.poll_interval_ms())
  end

  defp run_cycle_safely do
    run_cycle()
  rescue
    exception ->
      Logger.debug("Dev server reconciler cycle skipped reason=#{inspect(exception)}")
  catch
    kind, reason ->
      Logger.debug("Dev server reconciler cycle skipped reason=#{inspect({kind, reason})}")
  end

  defp run_cycle do
    wait_state_issues = fetch_wait_state_issues()
    issue_index = issue_index(wait_state_issues)

    candidates = %{
      human_review: issue_identifiers(wait_state_issues),
      pull_request: pull_request_issue_identifiers(wait_state_issues)
    }

    Config.dev_server_auto_start_on()
    |> reconcile(candidates)
    |> Enum.each(&start_candidate(&1, issue_index))
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

  defp pull_request_issue_identifiers(issues) do
    issues
    |> Enum.flat_map(&pull_request_issue_identifier/1)
    |> Enum.uniq()
  end

  defp pull_request_issue_identifier(issue) do
    case issue_identifier(issue) do
      nil ->
        []

      identifier ->
        pull_request_issue_identifier(issue, identifier)
    end
  end

  defp pull_request_issue_identifier(issue, identifier) do
    case repo_for_issue(issue) do
      {:ok, repo} ->
        case PullRequests.for_issue(repo, identifier) do
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

  defp repo_for_issue(issue) do
    case map_value(issue, :project) do
      nil -> configured_github_repo()
      project -> repo_for_project(project)
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

  defp configured_github_repo do
    case Config.tracker_kind() do
      "github" -> repo_from_tracker_config(%{"repo" => GitHubConfig.repo()})
      kind -> {:error, {:unsupported_tracker_kind, kind}}
    end
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

    case project_slug_for_issue(issue) do
      nil ->
        Logger.debug("Dev server auto-start skipped issue=#{identifier} reason=:missing_project_slug")

      project_slug ->
        case Manager.start_for_issue(project_slug, identifier) do
          {:ok, _pids} ->
            :ok

          {:error, reason} ->
            Logger.debug("Dev server auto-start skipped project=#{project_slug} issue=#{identifier} reason=#{inspect(reason)}")
        end
    end
  rescue
    exception ->
      Logger.debug("Dev server auto-start skipped issue=#{identifier} reason=#{inspect(exception)}")
  catch
    kind, reason ->
      Logger.debug("Dev server auto-start skipped issue=#{identifier} reason=#{inspect({kind, reason})}")
  end

  defp project_slug_for_issue(issue) do
    explicit_project_slug(issue) || Config.local_project_slug()
  end

  defp explicit_project_slug(nil), do: nil

  defp explicit_project_slug(issue) do
    case non_empty_string(map_value(issue, :project_slug)) do
      nil -> issue |> map_value(:project) |> project_slug()
      slug -> slug
    end
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
