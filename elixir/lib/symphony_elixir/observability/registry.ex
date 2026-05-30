defmodule SymphonyElixir.Observability.Registry do
  @moduledoc """
  In-memory aggregate of per-runtime observability snapshots reported by
  Symphony worker processes. Holds the latest snapshot per `runtime_id` in ETS,
  derives `online`/`stale` status from the hub-stamped `reported_at`, drops
  runtimes that stop reporting, and broadcasts changes over PubSub.
  """

  use GenServer

  @default_pubsub SymphonyElixir.PubSub
  @topic "observability:global"
  @default_stale_after_ms 15_000
  @default_drop_after_ms 60_000
  @default_sweep_interval_ms 5_000

  @type entry :: %{
          runtime_id: String.t(),
          label: String.t() | nil,
          project_slug: String.t() | nil,
          tracker_kind: String.t() | nil,
          agent_kind: String.t() | nil,
          source_url: String.t() | nil,
          status: :online | :stale,
          reported_at: String.t(),
          counts: map(),
          running: list(),
          retrying: list(),
          agent_totals: map(),
          rate_limits: term()
        }

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @spec put_report(GenServer.name(), map()) :: :ok | {:error, :missing_runtime_id}
  def put_report(server \\ __MODULE__, report) when is_map(report) do
    case fetch_runtime_id(report) do
      nil -> {:error, :missing_runtime_id}
      runtime_id -> GenServer.call(server, {:put_report, runtime_id, report})
    end
  end

  @spec list(GenServer.name()) :: [entry()]
  def list(server \\ __MODULE__) do
    GenServer.call(server, :list)
  end

  @impl true
  def init(opts) do
    table = :ets.new(:observability_runtimes, [:set, :private])

    state = %{
      table: table,
      pubsub: Keyword.get(opts, :pubsub, @default_pubsub),
      stale_after_ms: Keyword.get(opts, :stale_after_ms, @default_stale_after_ms),
      drop_after_ms: Keyword.get(opts, :drop_after_ms, @default_drop_after_ms),
      sweep_interval_ms: Keyword.get(opts, :sweep_interval_ms, @default_sweep_interval_ms)
    }

    schedule_sweep(state)
    {:ok, state}
  end

  @impl true
  def handle_call({:put_report, runtime_id, report}, _from, state) do
    entry = build_entry(runtime_id, report)
    :ets.insert(state.table, {runtime_id, entry})
    broadcast(state, "runtime_updated", serialize(entry))
    {:reply, :ok, state}
  end

  @impl true
  def handle_call(:list, _from, state) do
    now = System.monotonic_time(:millisecond)

    entries =
      state.table
      |> :ets.tab2list()
      |> Enum.map(fn {_id, entry} -> apply_status(entry, now, state.stale_after_ms) end)
      |> Enum.map(&serialize/1)

    {:reply, entries, state}
  end

  @impl true
  def handle_info(:sweep, state) do
    now = System.monotonic_time(:millisecond)

    for {runtime_id, entry} <- :ets.tab2list(state.table),
        now - entry.monotonic_ms > state.drop_after_ms do
      :ets.delete(state.table, runtime_id)
      broadcast(state, "runtime_removed", %{runtime_id: runtime_id})
    end

    schedule_sweep(state)
    {:noreply, state}
  end

  defp build_entry(runtime_id, report) do
    snapshot = Map.get(report, "snapshot") || %{}

    %{
      runtime_id: runtime_id,
      label: get(report, "label"),
      project_slug: get(report, "project_slug"),
      tracker_kind: get(report, "tracker_kind"),
      agent_kind: get(report, "agent_kind"),
      source_url: get(report, "source_url"),
      status: :online,
      reported_at: DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601(),
      monotonic_ms: System.monotonic_time(:millisecond),
      counts: atomize_counts(snapshot_get(snapshot, "counts") || %{}),
      running: snapshot_get(snapshot, "running") || [],
      retrying: snapshot_get(snapshot, "retrying") || [],
      agent_totals: snapshot_get(snapshot, "agent_totals") || %{},
      rate_limits: snapshot_get(snapshot, "rate_limits")
    }
  end

  defp apply_status(entry, now, stale_after_ms) do
    status = if now - entry.monotonic_ms > stale_after_ms, do: :stale, else: :online
    %{entry | status: status}
  end

  defp serialize(entry), do: Map.delete(entry, :monotonic_ms)

  defp atomize_counts(counts) when is_map(counts) do
    %{
      running: Map.get(counts, "running", Map.get(counts, :running, 0)),
      retrying: Map.get(counts, "retrying", Map.get(counts, :retrying, 0))
    }
  end

  defp atomize_counts(_counts), do: %{running: 0, retrying: 0}

  defp fetch_runtime_id(report) do
    case Map.get(report, "runtime_id") || Map.get(report, :runtime_id) do
      value when is_binary(value) and value != "" -> value
      _ -> nil
    end
  end

  defp get(report, key), do: Map.get(report, key) || Map.get(report, String.to_atom(key))

  defp snapshot_get(snapshot, key) when is_map(snapshot) do
    Map.get(snapshot, key) || Map.get(snapshot, String.to_atom(key))
  end

  defp snapshot_get(_snapshot, _key), do: nil

  defp broadcast(state, event_name, payload) do
    case Process.whereis(state.pubsub) do
      pid when is_pid(pid) ->
        Phoenix.PubSub.broadcast(state.pubsub, @topic, {:observability_event, event_name, payload})

      _ ->
        :ok
    end
  end

  defp schedule_sweep(state), do: Process.send_after(self(), :sweep, state.sweep_interval_ms)

  @spec topic() :: String.t()
  def topic, do: @topic
end
