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

  @doc """
  Returns a heartbeat/liveness snapshot of the reconciler for observability.

  Safe to call even when the reconciler is not running: returns an offline
  snapshot (`running: false`) instead of crashing the caller.
  """
  @spec stats(GenServer.name(), timeout()) :: map()
  def stats(name \\ __MODULE__, timeout \\ 1_000) do
    GenServer.call(name, :stats, timeout)
  catch
    :exit, _reason -> offline_stats()
  end

  @doc false
  @spec issue_state_name(map()) :: String.t() | nil
  def issue_state_name(issue) when is_map(issue), do: issue_state_name_impl(issue)

  @doc false
  @spec issue_in_project_wait_state?(map(), map()) :: boolean()
  def issue_in_project_wait_state?(issue, configs) when is_map(issue) and is_map(configs),
    do: issue_in_project_wait_state_impl(issue, configs)

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
    {:ok, initial_state()}
  end

  defp initial_state do
    %{
      in_flight: %{},
      tick_count: 0,
      last_tick_started_at: nil,
      last_tick_finished_at: nil,
      last_tick_status: nil,
      last_error: nil,
      last_evaluated_count: 0
    }
  end

  @impl true
  def handle_call(:stats, _from, state) do
    {:reply, build_stats(state), state}
  end

  @impl true
  def handle_info(:tick, state) do
    state = run_tick_safely(%{state | last_tick_started_at: DateTime.utc_now()})
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
    run_cycle(state) |> mark_tick_ok()
  rescue
    exception ->
      Logger.debug("PR monitor tick skipped reason=#{inspect(exception)}")
      mark_tick_error(state, exception)
  catch
    kind, reason ->
      Logger.debug("PR monitor tick skipped reason=#{inspect({kind, reason})}")
      mark_tick_error(state, {kind, reason})
  end

  defp mark_tick_ok(state) do
    %{
      state
      | tick_count: state.tick_count + 1,
        last_tick_finished_at: DateTime.utc_now(),
        last_tick_status: :ok,
        last_error: nil
    }
  end

  defp mark_tick_error(state, reason) do
    %{
      state
      | tick_count: state.tick_count + 1,
        last_tick_finished_at: DateTime.utc_now(),
        last_tick_status: :error,
        last_error: inspect(reason)
    }
  end

  defp build_stats(state) do
    %{
      running: true,
      in_flight: map_size(state.in_flight),
      tick_count: state.tick_count,
      last_tick_started_at: state.last_tick_started_at,
      last_tick_finished_at: state.last_tick_finished_at,
      last_tick_status: state.last_tick_status,
      last_error: state.last_error,
      last_evaluated_count: state.last_evaluated_count,
      interval_ms: interval_ms()
    }
  end

  defp offline_stats do
    %{
      running: false,
      in_flight: 0,
      tick_count: 0,
      last_tick_started_at: nil,
      last_tick_finished_at: nil,
      last_tick_status: nil,
      last_error: nil,
      last_evaluated_count: 0,
      interval_ms: interval_ms()
    }
  end

  defp run_cycle(state) do
    configs = enabled_project_configs()

    if configs == %{} do
      %{state | last_evaluated_count: 0}
    else
      enabled_slugs = MapSet.new(Map.keys(configs))
      in_flight_keys = state.in_flight |> Map.keys() |> MapSet.new()

      candidates =
        configs
        |> fetch_wait_state_issues()
        |> Enum.filter(&issue_in_project_wait_state_impl(&1, configs))
        |> candidates(enabled_slugs, in_flight_keys)

      candidates
      |> Enum.reduce(%{state | last_evaluated_count: length(candidates)}, fn issue, acc ->
        start_issue_task(issue, configs, acc)
      end)
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

  defp issue_in_project_wait_state_impl(issue, configs) do
    slug = issue_project_slug(issue)
    state_name = issue_state_name_impl(issue)

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

  # Tracker reads return `%Issue{state: ...}`; API-shaped maps use `status.name`.
  defp issue_state_name_impl(issue) do
    case map_value(issue, :status) |> map_value(:name) do
      name when is_binary(name) and name != "" ->
        name

      _ ->
        case map_value(issue, :state) do
          state when is_binary(state) and state != "" -> state
          _ -> nil
        end
    end
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
