defmodule SymphonyElixir.Observability.Reporter do
  @moduledoc """
  Worker-side reporter. Subscribes to observability updates and pushes the local
  orchestrator snapshot to the hub: immediately on change (coalesced) and on a
  heartbeat interval for liveness. Delivery is in-process when no `hub_url` is
  configured (the hub reports to itself), otherwise an HTTP `POST` to the hub.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.Config
  alias SymphonyElixir.Observability.Registry
  alias SymphonyElixirWeb.{ObservabilityPubSub, Presenter}

  @snapshot_timeout_ms 15_000

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @impl true
  def init(opts) do
    state = %{
      deliver_fun: Keyword.get(opts, :deliver_fun) || default_deliver_fun(),
      snapshot_fun: Keyword.get(opts, :snapshot_fun) || (&default_snapshot/0),
      identity_fun: Keyword.get(opts, :identity_fun) || (&default_identity/0),
      heartbeat_interval_ms:
        Keyword.get(opts, :heartbeat_interval_ms) ||
          Config.observability_heartbeat_interval_ms(),
      min_report_interval_ms:
        Keyword.get(opts, :min_report_interval_ms) ||
          Config.observability_min_report_interval_ms(),
      last_report_ms: nil,
      pending?: false
    }

    ObservabilityPubSub.subscribe()
    schedule_heartbeat(state)
    {:ok, state}
  end

  @impl true
  def handle_info(:observability_updated, state) do
    {:noreply, maybe_report(state)}
  end

  @impl true
  def handle_info(:heartbeat, state) do
    schedule_heartbeat(state)
    {:noreply, do_report(state)}
  end

  @impl true
  def handle_info(:flush_pending, %{pending?: true} = state) do
    {:noreply, do_report(%{state | pending?: false})}
  end

  def handle_info(:flush_pending, state), do: {:noreply, state}

  defp maybe_report(state) do
    now = System.monotonic_time(:millisecond)

    cond do
      is_nil(state.last_report_ms) ->
        do_report(state)

      now - state.last_report_ms >= state.min_report_interval_ms ->
        do_report(state)

      state.pending? ->
        state

      true ->
        delay = state.min_report_interval_ms - (now - state.last_report_ms)
        Process.send_after(self(), :flush_pending, max(delay, 0))
        %{state | pending?: true}
    end
  end

  defp do_report(state) do
    report = Map.put(state.identity_fun.(), "snapshot", state.snapshot_fun.())

    case state.deliver_fun.(report) do
      :ok -> :ok
      {:error, reason} -> Logger.warning("observability report failed: #{inspect(reason)}")
      other -> Logger.warning("observability report unexpected result: #{inspect(other)}")
    end

    %{state | last_report_ms: System.monotonic_time(:millisecond), pending?: false}
  end

  defp schedule_heartbeat(state),
    do: Process.send_after(self(), :heartbeat, state.heartbeat_interval_ms)

  defp default_snapshot do
    Presenter.state_payload(SymphonyElixir.Orchestrator, @snapshot_timeout_ms)
  end

  defp default_identity do
    %{
      "runtime_id" => Config.observability_runtime_id(),
      "label" =>
        Config.observability_label() ||
          Path.basename(SymphonyElixir.Workflow.workflow_file_path()),
      "project_slug" => Config.local_project_slug(),
      "tracker_kind" => Config.tracker_kind(),
      "agent_kind" => Config.agent_kind(),
      "source_url" => source_url()
    }
  end

  defp source_url do
    case {Config.server_host(), Config.server_port()} do
      {host, port} when is_binary(host) and is_integer(port) and port > 0 ->
        "http://#{host}:#{port}"

      _ ->
        nil
    end
  end

  defp default_deliver_fun do
    case Config.observability_hub_url() do
      url when is_binary(url) and url != "" -> &deliver_http(&1, url)
      _ -> &deliver_local/1
    end
  end

  defp deliver_local(report) do
    Registry.put_report(report)
  end

  defp deliver_http(report, hub_url) do
    token = System.get_env(Config.local_api_token_env())
    url = String.trim_trailing(hub_url, "/") <> "/api/tracker/v1/observability/report"

    case Req.post(url,
           json: report,
           headers: [{"authorization", "Bearer #{token}"}],
           retry: false
         ) do
      {:ok, %Req.Response{status: status}} when status in 200..299 -> :ok
      {:ok, %Req.Response{status: status}} -> {:error, {:http_status, status}}
      {:error, reason} -> {:error, reason}
    end
  end
end
