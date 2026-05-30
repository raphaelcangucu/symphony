defmodule SymphonyElixir.DevServer.Instance do
  @moduledoc """
  Owns one dev-server serve step for one issue workspace.

  The instance allocates a port, launches the serve command in a dedicated tmux
  session, probes readiness, and mirrors last-known status into the local tracker.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.Config
  alias SymphonyElixir.DevServer.PortAllocator
  alias SymphonyElixir.LocalTracker.DevServerRecord
  alias SymphonyElixir.Terminal.{Registry, Tmux}

  @default_idle_timeout_ms 1_800_000
  @default_probe_interval_ms 1_000
  @default_max_probe_attempts 60
  @probe_connect_timeout_ms 1_000
  @loopback_host "127.0.0.1"

  @type status :: :provisioning | :starting | :ready | :crashed | :stopped

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) when is_list(opts) do
    case Keyword.fetch(opts, :registry_name) do
      {:ok, registry_name} -> GenServer.start_link(__MODULE__, opts, name: registry_name)
      :error -> GenServer.start_link(__MODULE__, opts)
    end
  end

  @spec status(GenServer.server()) :: status()
  def status(server), do: GenServer.call(server, :status)

  @spec stop(GenServer.server()) :: :ok
  def stop(server), do: GenServer.call(server, :stop)

  @impl true
  def init(opts) do
    Process.flag(:trap_exit, true)

    state =
      opts
      |> initial_state()
      |> persist_status!(:provisioning)

    {:ok, state, {:continue, :boot}}
  end

  @impl true
  def handle_continue(:boot, state) do
    {:noreply, boot(state)}
  end

  @impl true
  def handle_call(:status, _from, state), do: {:reply, state.status, state}

  def handle_call(:stop, _from, state), do: {:stop, :normal, :ok, %{state | status: :stopped}}

  @impl true
  def handle_info(:probe, %{status: :starting, port: port} = state) when is_integer(port) do
    ready_probe = Map.get(state.step, :ready_probe, "tcp") || "tcp"
    ready_path = Map.get(state.step, :ready_path, "/") || "/"

    case state.probe.(@loopback_host, port, ready_probe, normalize_path(ready_path)) do
      :ok ->
        {:noreply, persist_status!(%{state | status: :ready}, :ready)}

      {:error, reason} ->
        handle_probe_error(state, reason)
    end
  end

  def handle_info(:idle_timeout, state), do: {:stop, :normal, %{state | status: :stopped}}

  def handle_info(_message, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, state) do
    cleanup_session(state)
    persist_stopped(state)
    :ok
  end

  defp initial_state(opts) do
    project_id = Keyword.fetch!(opts, :project_id)
    project_slug = Keyword.fetch!(opts, :project_slug)
    identifier = Keyword.fetch!(opts, :identifier)
    workspace_path = Keyword.fetch!(opts, :workspace_path)
    step = Keyword.fetch!(opts, :step)
    slug = Map.fetch!(step, :slug)
    working_dir = Map.get(step, :working_dir)

    %{
      project_id: project_id,
      project_slug: project_slug,
      identifier: identifier,
      workspace_path: workspace_path,
      step: step,
      slug: slug,
      working_dir: working_dir,
      base_url: Keyword.get(opts, :base_url),
      idle_timeout_ms: Keyword.get(opts, :idle_timeout_ms, @default_idle_timeout_ms),
      tmux: Keyword.get(opts, :tmux, Registry),
      port_allocator: Keyword.get(opts, :port_allocator, &PortAllocator.allocate/2),
      probe: Keyword.get(opts, :probe, &default_probe/4),
      probe_interval_ms: Keyword.get(opts, :probe_interval_ms, @default_probe_interval_ms),
      max_probe_attempts: Keyword.get(opts, :max_probe_attempts, @default_max_probe_attempts),
      claimed_ports: Keyword.get(opts, :claimed_ports, []),
      started_at: DateTime.utc_now(),
      status: :provisioning,
      port: nil,
      url: nil,
      primary: Map.get(step, :primary, false) || false,
      session_name: nil,
      probe_attempts: 0
    }
  end

  defp boot(state) do
    case state.port_allocator.(Config.dev_server_port_range(), state.claimed_ports) do
      {:ok, port} ->
        launch_with_port(state, port)

      {:error, reason} ->
        Logger.warning("Dev server port allocation failed slug=#{state.slug} reason=#{inspect(reason)}")
        persist_status!(%{state | status: :crashed}, :crashed)
    end
  end

  defp launch_with_port(state, port) do
    url = build_url(state.base_url, port, Map.get(state.step, :url_path, "/"))
    cwd = Path.join(state.workspace_path, state.working_dir || ".")

    case state.tmux.open_dev_session(state.project_slug, state.identifier, state.slug, cwd, []) do
      {:ok, session} ->
        start_command(state, port, url, session)

      {:error, reason} ->
        Logger.warning("Dev server tmux session failed slug=#{state.slug} reason=#{inspect(reason)}")
        persist_status!(%{state | port: port, url: url, status: :crashed}, :crashed)
    end
  end

  defp start_command(state, port, url, session) do
    session_name = Map.fetch!(session, :session_name)
    command = launch_command(state.step, port)

    case send_command(state.tmux, session_name, command) do
      :ok ->
        state =
          state
          |> Map.merge(%{port: port, url: url, session_name: session_name, status: :starting})
          |> persist_status!(:starting)

        Process.send_after(self(), :probe, state.probe_interval_ms)
        Process.send_after(self(), :idle_timeout, state.idle_timeout_ms)
        state

      {:error, reason} ->
        Logger.warning("Dev server command send failed slug=#{state.slug} reason=#{inspect(reason)}")

        state
        |> Map.merge(%{port: port, url: url, session_name: session_name, status: :crashed})
        |> persist_status!(:crashed)
    end
  end

  defp handle_probe_error(state, reason) do
    attempts = state.probe_attempts + 1

    if attempts >= state.max_probe_attempts do
      Logger.warning("Dev server probe failed slug=#{state.slug} attempts=#{attempts} reason=#{inspect(reason)}")
      {:noreply, persist_status!(%{state | status: :crashed, probe_attempts: attempts}, :crashed)}
    else
      Process.send_after(self(), :probe, state.probe_interval_ms)
      {:noreply, %{state | probe_attempts: attempts}}
    end
  end

  defp launch_command(step, port) do
    command = Map.fetch!(step, :command)

    case Map.get(step, :port_env) do
      port_env when is_binary(port_env) and port_env != "" -> "#{port_env}=#{port} #{command}\n"
      _absent -> "#{command}\n"
    end
  end

  defp send_command(tmux, session_name, command) do
    if function_exported?(tmux, :send_keys, 2) do
      tmux.send_keys(session_name, command)
    else
      Tmux.send_keys(session_name, command)
    end
  end

  defp build_url(base_url, port, path) do
    base =
      case base_url do
        url when is_binary(url) and url != "" -> String.trim_trailing(url, "/")
        _absent -> "http://127.0.0.1:#{port}"
      end

    base <> normalize_path(path || "/")
  end

  defp normalize_path(path) when is_binary(path) do
    case String.trim(path) do
      "" -> "/"
      "/" <> _rest = normalized -> normalized
      normalized -> "/" <> normalized
    end
  end

  defp persist_status!(state, status) do
    attrs = %{
      working_dir: state.working_dir,
      port: state.port,
      url: state.url,
      status: Atom.to_string(status),
      primary: state.primary,
      session_name: state.session_name,
      started_at: state.started_at
    }

    {:ok, _record} = DevServerRecord.upsert(state.project_id, state.identifier, state.slug, attrs)
    %{state | status: status}
  end

  defp cleanup_session(state) do
    state.tmux.kill_dev_session(state.project_slug, state.identifier, state.slug, [])
  rescue
    error -> Logger.debug("Dev server cleanup failed slug=#{state.slug} reason=#{inspect(error)}")
  end

  defp persist_stopped(state) do
    persist_status!(%{state | status: :stopped}, :stopped)
  rescue
    error -> Logger.debug("Dev server stopped persistence failed slug=#{state.slug} reason=#{inspect(error)}")
  end

  defp default_probe(host, port, "http", ready_path) do
    url = "http://#{host}:#{port}#{normalize_path(ready_path)}"

    case Req.get(url, retry: false, receive_timeout: 1_000) do
      {:ok, %{status: status}} when status in 200..499 -> :ok
      {:ok, %{status: status}} -> {:error, {:http_status, status}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp default_probe(host, port, _ready_probe, _ready_path) do
    case :gen_tcp.connect(String.to_charlist(host), port, [:binary, active: false], @probe_connect_timeout_ms) do
      {:ok, socket} ->
        :gen_tcp.close(socket)
        :ok

      {:error, reason} ->
        {:error, reason}
    end
  end
end
