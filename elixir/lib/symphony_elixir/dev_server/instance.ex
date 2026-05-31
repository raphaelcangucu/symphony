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
      |> persist_status(:provisioning)

    {:ok, state, {:continue, :boot}}
  end

  @impl true
  def handle_continue(:boot, state) do
    {:noreply, boot(state)}
  end

  @impl true
  def handle_call(:status, _from, state), do: {:reply, state.status, state}

  def handle_call(:stop, _from, %{status: :crashed} = state), do: {:stop, :normal, :ok, state}

  def handle_call(:stop, _from, state) do
    {:stop, :normal, :ok, %{state | status: :stopped, stop_requested: true}}
  end

  @impl true
  def handle_info(:probe, %{status: :starting, port: port} = state) when is_integer(port) do
    probe_starting(state, port)
  end

  def handle_info({:probe, token}, %{probe_timer_ref: {_timer_ref, token}, status: :starting, port: port} = state)
      when is_integer(port) do
    probe_starting(%{state | probe_timer_ref: nil}, port)
  end

  def handle_info(:probe, %{status: :ready, port: port} = state) when is_integer(port) do
    probe_ready(state, port)
  end

  def handle_info({:probe, token}, %{probe_timer_ref: {_timer_ref, token}, status: :ready, port: port} = state)
      when is_integer(port) do
    probe_ready(%{state | probe_timer_ref: nil}, port)
  end

  def handle_info({:probe, _token}, state), do: {:noreply, state}

  def handle_info(:idle_timeout, %{status: :crashed} = state), do: {:noreply, state}

  def handle_info(:idle_timeout, state) do
    {:stop, :normal, %{state | status: :stopped, stop_requested: true}}
  end

  def handle_info({:idle_timeout, token}, %{idle_timer_ref: {_timer_ref, token}, status: :crashed} = state) do
    {:noreply, %{state | idle_timer_ref: nil}}
  end

  def handle_info({:idle_timeout, token}, %{idle_timer_ref: {_timer_ref, token}} = state) do
    {:stop, :normal, %{state | status: :stopped, stop_requested: true, idle_timer_ref: nil}}
  end

  def handle_info({:idle_timeout, _token}, state), do: {:noreply, state}

  def handle_info(_message, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, %{status: :crashed} = state) do
    cleanup_session(state)
    :ok
  end

  def terminate(_reason, %{status: :stopped, stop_requested: true} = state) do
    mark_stopped(state)
    :ok
  end

  def terminate(reason, state) when reason in [:normal, :shutdown] do
    mark_stopped(state)
    :ok
  end

  def terminate({:shutdown, _detail}, state) do
    mark_stopped(state)
    :ok
  end

  def terminate(reason, state) do
    Logger.warning("Dev server terminated unexpectedly slug=#{state.slug} reason=#{inspect(reason)}")
    mark_crashed(state)
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
      public_host: SymphonyElixir.PublicRouting.preview_host(project_slug, identifier, slug),
      idle_timeout_ms: Keyword.get(opts, :idle_timeout_ms, @default_idle_timeout_ms),
      tmux: Keyword.get(opts, :tmux, Registry),
      port_allocator: Keyword.get(opts, :port_allocator, &PortAllocator.allocate/2),
      command_sender: Keyword.get(opts, :command_sender, &Tmux.send_keys/2),
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
      probe_attempts: 0,
      probe_timer_ref: nil,
      idle_timer_ref: nil,
      stop_requested: false
    }
  end

  defp boot(state) do
    case state.port_allocator.(Config.dev_server_port_range(), state.claimed_ports) do
      {:ok, port} ->
        launch_with_port(state, port)

      {:error, reason} ->
        Logger.warning("Dev server port allocation failed slug=#{state.slug} reason=#{inspect(reason)}")
        mark_crashed(state)
    end
  end

  defp launch_with_port(state, port) do
    url = build_url(state, port, Map.get(state.step, :url_path, "/"))

    case resolve_cwd(state) do
      {:ok, cwd} ->
        open_session(state, port, url, cwd)

      {:error, reason} ->
        Logger.warning("Dev server working dir rejected slug=#{state.slug} reason=#{inspect(reason)}")
        mark_crashed(%{state | port: port, url: url})
    end
  end

  defp open_session(state, port, url, cwd) do
    case state.tmux.open_dev_session(state.project_slug, state.identifier, state.slug, cwd, []) do
      {:ok, session} ->
        start_command(state, port, url, session)

      {:error, reason} ->
        Logger.warning("Dev server tmux session failed slug=#{state.slug} reason=#{inspect(reason)}")
        mark_crashed(%{state | port: port, url: url})
    end
  end

  defp start_command(state, port, url, session) do
    session_name = Map.fetch!(session, :session_name)
    command = launch_command(state.step, port)

    case send_command(state.command_sender, session_name, command) do
      :ok ->
        state =
          state
          |> Map.merge(%{port: port, url: url, session_name: session_name, status: :starting})
          |> persist_status(:starting)
          |> schedule_probe()
          |> reset_idle_timer()

        state

      {:error, reason} ->
        Logger.warning("Dev server command send failed slug=#{state.slug} reason=#{inspect(reason)}")

        state = Map.merge(state, %{port: port, url: url, session_name: session_name, status: :crashed})
        mark_crashed(state)
    end
  end

  defp probe_starting(state, port) do
    ready_probe = Map.get(state.step, :ready_probe, "tcp") || "tcp"
    ready_path = Map.get(state.step, :ready_path, "/") || "/"

    case state.probe.(@loopback_host, port, ready_probe, normalize_path(ready_path)) do
      :ok ->
        maybe_register_public_host(state, port)

        state =
          state
          |> Map.merge(%{status: :ready, probe_attempts: 0})
          |> persist_status(:ready)
          |> schedule_probe()
          |> reset_idle_timer()

        {:noreply, state}

      {:error, reason} ->
        handle_probe_error(state, reason)
    end
  end

  defp probe_ready(state, port) do
    ready_probe = Map.get(state.step, :ready_probe, "tcp") || "tcp"
    ready_path = Map.get(state.step, :ready_path, "/") || "/"

    case state.probe.(@loopback_host, port, ready_probe, normalize_path(ready_path)) do
      :ok ->
        state =
          state
          |> Map.put(:probe_attempts, 0)
          |> schedule_probe()
          |> reset_idle_timer()

        {:noreply, state}

      {:error, reason} ->
        Logger.warning("Dev server post-ready probe failed slug=#{state.slug} reason=#{inspect(reason)}")
        handle_probe_error(state, reason)
    end
  end

  defp handle_probe_error(state, reason) do
    attempts = state.probe_attempts + 1

    if attempts >= state.max_probe_attempts do
      Logger.warning("Dev server probe failed slug=#{state.slug} attempts=#{attempts} reason=#{inspect(reason)}")
      {:noreply, mark_crashed(%{state | probe_attempts: attempts})}
    else
      {:noreply, schedule_probe(%{state | probe_attempts: attempts})}
    end
  end

  defp launch_command(step, port) do
    command = Map.fetch!(step, :command)

    case Map.get(step, :port_env) do
      port_env when is_binary(port_env) and port_env != "" -> "#{port_env}=#{port} #{command}\n"
      _absent -> "#{command}\n"
    end
  end

  defp send_command(command_sender, session_name, command) when is_function(command_sender, 2) do
    command_sender.(session_name, command)
  rescue
    error -> {:error, error}
  end

  defp send_command(_command_sender, _session_name, _command), do: {:error, :invalid_command_sender}

  defp resolve_cwd(state) do
    root = Path.expand(state.workspace_path)
    cwd = Path.expand(Path.join(root, state.working_dir || "."))

    with {:ok, root_realpath} <- realpath(root),
         {:ok, cwd_realpath} <- realpath(cwd) do
      if cwd_realpath == root_realpath or String.starts_with?(cwd_realpath, root_realpath <> "/") do
        {:ok, cwd_realpath}
      else
        {:error, {:working_dir_outside_workspace, cwd_realpath, root_realpath}}
      end
    end
  end

  defp realpath(path) when is_binary(path) do
    realpath(path, MapSet.new())
  end

  defp realpath(path, seen) when is_binary(path) do
    path
    |> Path.expand()
    |> Path.split()
    |> case do
      ["/" | segments] -> resolve_realpath("/", segments, seen)
      segments -> resolve_realpath("/", segments, seen)
    end
  end

  defp resolve_realpath(resolved, [], _seen), do: {:ok, resolved}

  defp resolve_realpath(resolved, [segment | rest], seen) do
    candidate = Path.join(resolved, segment)

    case File.lstat(candidate) do
      {:ok, %File.Stat{type: :symlink}} ->
        resolve_symlink(candidate, resolved, rest, seen)

      {:ok, _stat} ->
        resolve_realpath(candidate, rest, seen)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp resolve_symlink(candidate, parent, rest, seen) do
    if MapSet.member?(seen, candidate) do
      {:error, :eloop}
    else
      seen = MapSet.put(seen, candidate)

      with {:ok, target} <- File.read_link(candidate),
           target_path = expand_symlink_target(target, parent),
           {:ok, target_realpath} <- realpath(target_path, seen) do
        resolve_realpath(target_realpath, rest, seen)
      end
    end
  end

  defp expand_symlink_target(target, parent) do
    case Path.type(target) do
      :absolute -> Path.expand(target)
      _relative -> Path.expand(target, parent)
    end
  end

  defp build_url(%{public_host: host}, _port, path) when is_binary(host) do
    "https://#{host}" <> normalize_path(path || "/")
  end

  defp build_url(%{base_url: base_url}, _port, path) when is_binary(base_url) and base_url != "" do
    String.trim_trailing(base_url, "/") <> normalize_path(path || "/")
  end

  defp build_url(_state, port, path) do
    "http://127.0.0.1:#{port}" <> normalize_path(path || "/")
  end

  defp normalize_path(path) when is_binary(path) do
    case String.trim(path) do
      "" -> "/"
      "/" <> _rest = normalized -> normalized
      normalized -> "/" <> normalized
    end
  end

  defp schedule_probe(state) do
    cancel_timer(state.probe_timer_ref)

    token = make_ref()
    timer_ref = Process.send_after(self(), {:probe, token}, state.probe_interval_ms)
    %{state | probe_timer_ref: {timer_ref, token}}
  end

  defp reset_idle_timer(state) do
    cancel_timer(state.idle_timer_ref)

    token = make_ref()
    timer_ref = Process.send_after(self(), {:idle_timeout, token}, state.idle_timeout_ms)
    %{state | idle_timer_ref: {timer_ref, token}}
  end

  defp cancel_timers(state) do
    cancel_timer(state.probe_timer_ref)
    cancel_timer(state.idle_timer_ref)
    %{state | probe_timer_ref: nil, idle_timer_ref: nil}
  end

  defp cancel_timer(nil), do: :ok

  defp cancel_timer({timer_ref, _token}) do
    Process.cancel_timer(timer_ref)
    :ok
  end

  defp maybe_register_public_host(%{public_host: host}, port)
       when is_binary(host) and is_integer(port) do
    SymphonyElixir.PublicRouting.register(host, port)
    :ok
  end

  defp maybe_register_public_host(_state, _port), do: :ok

  defp maybe_unregister_public_host(%{public_host: host}) when is_binary(host) do
    SymphonyElixir.PublicRouting.unregister(host)
    :ok
  end

  defp maybe_unregister_public_host(_state), do: :ok

  defp mark_crashed(state) do
    maybe_unregister_public_host(state)
    state = cancel_timers(state)
    cleanup_session(state)
    persist_status(state, :crashed)
  end

  defp mark_stopped(%{status: :crashed} = state), do: mark_crashed(state)

  defp mark_stopped(state) do
    maybe_unregister_public_host(state)
    state = cancel_timers(state)

    case cleanup_session(state) do
      :ok -> persist_status(state, :stopped)
      {:error, _reason} -> persist_status(state, :crashed)
    end
  end

  defp persist_status(state, status) do
    persist(state, status)
    %{state | status: status}
  end

  defp persist(state, status) do
    attrs = persist_attrs(state, status)

    case DevServerRecord.upsert(state.project_id, state.identifier, state.slug, attrs) do
      {:ok, _record} ->
        :ok

      {:error, reason} ->
        Logger.warning("Dev server persistence failed slug=#{state.slug} status=#{status} reason=#{inspect(reason)}")
        {:error, reason}
    end
  rescue
    error ->
      Logger.warning("Dev server persistence failed slug=#{state.slug} status=#{status} reason=#{inspect(error)}")
      {:error, error}
  end

  defp persist_attrs(state, status) do
    %{
      working_dir: state.working_dir,
      port: state.port,
      url: state.url,
      status: Atom.to_string(status),
      primary: state.primary,
      session_name: state.session_name,
      started_at: state.started_at
    }
  end

  defp cleanup_session(%{session_name: nil}), do: :ok

  defp cleanup_session(state) do
    case state.tmux.kill_dev_session(state.project_slug, state.identifier, state.slug, []) do
      :ok ->
        :ok

      {:error, reason} ->
        Logger.warning("Dev server cleanup failed slug=#{state.slug} reason=#{inspect(reason)}")
        {:error, reason}
    end
  rescue
    error ->
      Logger.warning("Dev server cleanup failed slug=#{state.slug} reason=#{inspect(error)}")
      {:error, error}
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
