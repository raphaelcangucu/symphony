defmodule SymphonyElixir.PullRequestMonitor.Reconciler do
  @moduledoc """
  Periodically reconciles PR-monitor follow-up checks for wait-state issues.

  Every tick, the reconciler finds wait-state issues for projects where
  `pr_monitor.enabled` is true and delegates each candidate issue to
  `SymphonyElixir.PullRequestMonitor.process_issue/3` inside supervised tasks.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.{Config, Repo, Tracker}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.PullRequestMonitor

  @max_issues_per_tick 10
  @fallback_interval_ms 60_000

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) when is_list(opts) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @doc false
  @spec candidates([map()], MapSet.t(), MapSet.t()) :: [map()]
  def candidates(issues, enabled_slugs, in_flight) do
    issues
    |> Enum.filter(fn issue ->
      identifier = issue_identifier(issue)
      slug = issue_project_slug(issue)
      key = issue_key(slug, identifier)

      not is_nil(key) and
        MapSet.member?(enabled_slugs, slug) and
        not MapSet.member?(in_flight, key)
    end)
    |> Enum.take(@max_issues_per_tick)
  end

  @impl true
  def init(_opts) do
    schedule_tick_safely()
    {:ok, %{in_flight: %{}}}
  end

  @impl true
  def handle_info(:tick, state) do
    state = run_tick_safely(state)
    schedule_tick_safely()
    {:noreply, state}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, _reason}, state) do
    in_flight = for {key, tracked_ref} <- state.in_flight, tracked_ref != ref, into: %{}, do: {key, tracked_ref}
    {:noreply, %{state | in_flight: in_flight}}
  end

  @impl true
  # Task.Supervisor.async_nolink sends `{ref, result}`; `:DOWN` handles in-flight cleanup.
  def handle_info(_message, state), do: {:noreply, state}

  defp run_tick_safely(state) do
    run_cycle(state)
  rescue
    exception ->
      Logger.debug("PR monitor tick skipped reason=#{inspect(exception)}")
      state
  catch
    kind, reason ->
      Logger.debug("PR monitor tick skipped reason=#{inspect({kind, reason})}")
      state
  end

  defp run_cycle(state) do
    configs = enabled_project_configs()

    if configs == %{} do
      state
    else
      enabled_slugs = MapSet.new(Map.keys(configs))
      in_flight_keys = state.in_flight |> Map.keys() |> MapSet.new()

      configs
      |> fetch_wait_state_issues()
      |> Enum.filter(&issue_in_project_wait_state?(&1, configs))
      |> candidates(enabled_slugs, in_flight_keys)
      |> Enum.reduce(state, fn issue, acc -> start_issue_task(issue, configs, acc) end)
    end
  end

  defp enabled_project_configs do
    Context.list_projects()
    |> Enum.map(fn project -> {project, project |> Repo.preload(:setup) |> ProjectConfig.resolve()} end)
    |> Enum.filter(fn {_project, config} -> ProjectConfig.pr_monitor_enabled?(config) end)
    |> Map.new(fn {project, config} -> {project.slug, {project, config}} end)
  end

  defp fetch_wait_state_issues(configs) when map_size(configs) == 0, do: []

  defp fetch_wait_state_issues(configs) do
    states =
      configs
      |> Map.values()
      |> Enum.flat_map(fn {_project, config} -> List.wrap(config.wait_states) end)
      |> Enum.uniq()

    case states do
      [] ->
        []

      _ ->
        case Tracker.fetch_issues_by_states(states) do
          {:ok, issues} when is_list(issues) ->
            issues

          {:ok, unexpected} ->
            Logger.debug("PR monitor issue fetch skipped reason={:unexpected_result, #{inspect(unexpected)}}")
            []

          {:error, reason} ->
            Logger.debug("PR monitor issue fetch skipped reason=#{inspect(reason)}")
            []
        end
    end
  end

  defp issue_in_project_wait_state?(issue, configs) do
    slug = issue_project_slug(issue)
    state_name = issue_state_name(issue)

    case Map.get(configs, slug) do
      {_project, %{wait_states: wait_states}} when is_list(wait_states) and is_binary(state_name) ->
        state_name in wait_states

      _ ->
        false
    end
  end

  defp start_issue_task(issue, configs, state) do
    identifier = issue_identifier(issue)
    slug = issue_project_slug(issue)
    key = issue_key(slug, identifier)

    case {key, Map.get(configs, slug)} do
      {nil, _} ->
        state

      {_key, nil} ->
        state

      {valid_key, {project, config}} ->
        task =
          Task.Supervisor.async_nolink(SymphonyElixir.Orchestrator.TaskSupervisor, fn ->
            PullRequestMonitor.process_issue(project, issue, config: config)
          end)

        %{state | in_flight: Map.put(state.in_flight, valid_key, task.ref)}
    end
  end

  defp schedule_tick_safely do
    Process.send_after(self(), :tick, interval_ms())
  rescue
    exception ->
      Logger.debug("PR monitor tick scheduling skipped reason=#{inspect(exception)}")
  catch
    kind, reason ->
      Logger.debug("PR monitor tick scheduling skipped reason=#{inspect({kind, reason})}")
  end

  defp interval_ms do
    case Config.pr_monitor_interval_ms() do
      ms when is_integer(ms) and ms > 0 -> ms
      _invalid -> @fallback_interval_ms
    end
  rescue
    _exception -> @fallback_interval_ms
  catch
    _kind, _reason -> @fallback_interval_ms
  end

  defp issue_state_name(issue) do
    issue
    |> map_value(:status)
    |> map_value(:name)
  end

  defp issue_project_slug(issue) do
    issue
    |> map_value(:project_slug)
    |> non_empty_string()
  end

  defp issue_identifier(issue) do
    issue
    |> map_value(:identifier)
    |> non_empty_string()
  end

  defp issue_key(slug, identifier) when is_binary(slug) and slug != "" and is_binary(identifier) and identifier != "" do
    {slug, identifier}
  end

  defp issue_key(_slug, _identifier), do: nil

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
