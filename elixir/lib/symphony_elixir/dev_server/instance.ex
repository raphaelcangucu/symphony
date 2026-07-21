defmodule SymphonyElixir.DevServer.Instance do
  @moduledoc """
  Owns one dev-server serve step for one issue workspace.

  The instance allocates a port, launches the serve command in a dedicated tmux
  session, probes readiness, and mirrors last-known status into the local tracker.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.Config
  alias SymphonyElixir.DevServer.Broadcaster
  alias SymphonyElixir.DevServer.PortAllocator
  alias SymphonyElixir.DevServer.RuntimeContract
  alias SymphonyElixir.DevServer.RuntimeReport
  alias SymphonyElixir.LocalTracker.DevServerRecord
  alias SymphonyElixir.PublicRouting
  alias SymphonyElixir.Terminal.{Registry, Tmux}

  @default_idle_timeout_ms 1_800_000
  @default_probe_interval_ms 1_000
  @default_max_probe_attempts 60
  # A booting serve process is never killed for being slow. Instead, its tmux
  # output is sampled every @default_stall_check_interval_ms; when it stops
  # evolving for @default_stall_after_ms the record surfaces as "stalled"
  # (still probed — it flips back to starting/ready as soon as output or the
  # port move again).
  @default_stall_after_ms 180_000
  @default_stall_check_interval_ms 10_000
  @probe_connect_timeout_ms 1_000
  @loopback_host "127.0.0.1"

  @type status :: :provisioning | :starting | :stalled | :ready | :crashed | :stopped

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
  def handle_info(:probe, %{status: status, port: port} = state)
      when status in [:starting, :stalled] and is_integer(port) do
    probe_starting(state, port)
  end

  def handle_info({:probe, token}, %{probe_timer_ref: {_timer_ref, token}, status: status, port: port} = state)
      when status in [:starting, :stalled] and is_integer(port) do
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
    record_scope = Keyword.get(opts, :record_scope, {:issue, identifier})
    step = Keyword.fetch!(opts, :step)
    slug = Map.fetch!(step, :slug)
    working_dir = Map.get(step, :working_dir)
    public_tunnel = Keyword.get(opts, :public_tunnel) || []

    %{
      project_id: project_id,
      project_slug: project_slug,
      identifier: identifier,
      record_scope: record_scope,
      workspace_path: workspace_path,
      step: step,
      slug: slug,
      working_dir: working_dir,
      base_url: Keyword.get(opts, :base_url),
      public_host: public_host(project_slug, identifier, slug, public_tunnel, record_scope),
      idle_timeout_ms: Keyword.get(opts, :idle_timeout_ms, @default_idle_timeout_ms),
      tmux: Keyword.get(opts, :tmux, Registry),
      port_allocator: Keyword.get(opts, :port_allocator, &PortAllocator.allocate/2),
      command_sender: Keyword.get(opts, :command_sender, &Tmux.send_keys/2),
      probe: Keyword.get(opts, :probe, &default_probe/4),
      probe_interval_ms: Keyword.get(opts, :probe_interval_ms, @default_probe_interval_ms),
      max_probe_attempts: Keyword.get(opts, :max_probe_attempts, @default_max_probe_attempts),
      capture_output: Keyword.get(opts, :capture_output, capture_output_function(record_scope)),
      stall_after_ms: Keyword.get(opts, :stall_after_ms, @default_stall_after_ms),
      stall_check_interval_ms: Keyword.get(opts, :stall_check_interval_ms, @default_stall_check_interval_ms),
      claimed_ports: Keyword.get(opts, :claimed_ports, []),
      contract: Keyword.get(opts, :contract),
      report_reader: Keyword.get(opts, :report_reader, &File.read/1),
      started_at: DateTime.utc_now(),
      status: :provisioning,
      port: nil,
      url: nil,
      primary: Map.get(step, :primary, false) || false,
      session_name: nil,
      probe_attempts: 0,
      probe_timer_ref: nil,
      idle_timer_ref: nil,
      stop_requested: false,
      last_output_hash: nil,
      last_progress_at: nil,
      last_stall_check_at: nil
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
    # A previous serve process may still occupy this slug's tmux session (e.g.
    # a daemon restart left nobody to stop it). Sending the launch command into
    # a busy pane just types into the running process's stdin — it never
    # executes — so always recycle the session to get a clean shell first.
    safe_kill_session(state)

    case open_dev_session(state, cwd) do
      {:ok, session} ->
        start_command(state, port, url, session)

      {:error, reason} ->
        Logger.warning("Dev server tmux session failed slug=#{state.slug} reason=#{inspect(reason)}")
        mark_crashed(%{state | port: port, url: url})
    end
  end

  defp start_command(state, port, url, session) do
    session_name = Map.fetch!(session, :session_name)
    command = launch_command(state.step, port, state.contract)

    case send_command(state.command_sender, session_name, command) do
      :ok ->
        state =
          state
          |> Map.merge(%{
            port: port,
            url: url,
            session_name: session_name,
            status: :starting,
            last_progress_at: System.monotonic_time(:millisecond)
          })
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

  defp probe_starting(state, _port) do
    # Under a runtime contract the serve script may bind an allowed fallback port
    # (e.g. its preferred host port was already published). Adopt the reported
    # actual port before probing so readiness is confirmed on the live port.
    state = maybe_adopt_reported_port(state)
    port = state.port
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

      {:error, _reason} ->
        handle_boot_probe_error(state)
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

  # A booting server is never killed for taking long (image builds, dependency
  # installs). Instead the tmux output is sampled: while it keeps evolving the
  # instance stays `starting`; when it freezes past the stall threshold it is
  # surfaced as `stalled` and keeps being probed until the port answers, output
  # resumes, or a human/agent stops it.
  defp handle_boot_probe_error(state) do
    state =
      %{state | probe_attempts: state.probe_attempts + 1}
      |> maybe_check_stall()

    {:noreply, schedule_probe(state)}
  end

  defp maybe_check_stall(state) do
    now = System.monotonic_time(:millisecond)

    if is_integer(state.last_stall_check_at) and
         now - state.last_stall_check_at < state.stall_check_interval_ms do
      state
    else
      run_stall_check(%{state | last_stall_check_at: now}, now)
    end
  end

  defp run_stall_check(state, now) do
    case capture_output(state) do
      {:ok, output} ->
        evaluate_output_progress(state, :erlang.phash2(output), now)

      {:error, _reason} ->
        # Capture hiccups (tmux busy, session mid-restart) are not a liveness
        # verdict; treat as "no new signal" and keep the current status.
        evaluate_stall_deadline(state, now)
    end
  end

  defp evaluate_output_progress(state, output_hash, now) do
    if output_hash == state.last_output_hash do
      evaluate_stall_deadline(state, now)
    else
      state = %{state | last_output_hash: output_hash, last_progress_at: now}

      case state.status do
        :stalled -> state |> persist_status(:starting) |> reset_idle_timer()
        _status -> reset_idle_timer(state)
      end
    end
  end

  defp evaluate_stall_deadline(state, now) do
    stalled_for = now - (state.last_progress_at || now)

    if state.status == :starting and stalled_for >= state.stall_after_ms do
      Logger.warning("Dev server output stalled slug=#{state.slug} stalled_for_ms=#{stalled_for}")
      persist_status(state, :stalled)
    else
      state
    end
  end

  defp capture_output(%{capture_output: capture} = state) when is_function(capture, 3) do
    capture.(state.project_slug, state.identifier, state.slug)
  rescue
    error -> {:error, error}
  end

  defp capture_output(_state), do: {:error, :invalid_capture}

  defp capture_output_function({:workspace, workspace_path}) do
    fn project_slug, _identifier, slug ->
      Registry.capture_workspace_dev_session(project_slug, workspace_path, slug)
    end
  end

  defp capture_output_function(_record_scope), do: &Registry.capture_dev_session/3

  defp launch_command(step, _port, %RuntimeContract{} = contract) do
    command = Map.fetch!(step, :command)

    prefix =
      contract
      |> RuntimeContract.to_env()
      |> Enum.map(fn {key, value} -> "#{key}=#{shell_quote(value)}" end)
      |> Enum.join(" ")

    "#{prefix} #{command}\n"
  end

  defp launch_command(step, port, _contract) do
    command = Map.fetch!(step, :command)

    case Map.get(step, :port_env) do
      port_env when is_binary(port_env) and port_env != "" -> "#{port_env}=#{port} #{command}\n"
      _absent -> "#{command}\n"
    end
  end

  defp maybe_adopt_reported_port(%{contract: nil} = state), do: state

  defp maybe_adopt_reported_port(%{contract: %RuntimeContract{} = contract} = state) do
    case read_and_evaluate_report(state, contract) do
      {:ok, actual_port} when is_integer(actual_port) and actual_port != state.port ->
        url = build_url(state, actual_port, Map.get(state.step, :url_path, "/"))

        state
        |> Map.merge(%{port: actual_port, url: url})
        |> persist_status(:starting)

      _no_change ->
        state
    end
  end

  defp read_and_evaluate_report(state, contract) do
    with {:ok, json} <- read_report(state.report_reader, contract.report_path),
         {:ok, report} <- RuntimeReport.parse(json) do
      RuntimeReport.evaluate(report, contract)
    else
      _ -> {:error, :no_report}
    end
  end

  defp read_report(reader, path) when is_function(reader, 1) do
    reader.(path)
  rescue
    error -> {:error, error}
  end

  defp read_report(_reader, _path), do: {:error, :invalid_reader}

  defp shell_quote(value) do
    "'" <> String.replace(to_string(value), "'", "'\"'\"'") <> "'"
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
    PublicRouting.register(host, port)
    :ok
  end

  defp maybe_register_public_host(_state, _port), do: :ok

  defp maybe_unregister_public_host(%{public_host: host}) when is_binary(host) do
    PublicRouting.unregister(host)
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

    case persist_record(state, attrs) do
      {:ok, _record} ->
        notify_scope(state)
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

  defp persist_record(%{record_scope: {:workspace, workspace_path}} = state, attrs) do
    DevServerRecord.upsert_workspace(state.project_id, workspace_path, state.slug, attrs)
  end

  defp persist_record(state, attrs) do
    DevServerRecord.upsert(state.project_id, state.identifier, state.slug, attrs)
  end

  defp notify_scope(%{record_scope: {:workspace, workspace_path}} = state) do
    Broadcaster.notify_workspace(state.project_slug, workspace_path)
  end

  defp notify_scope(state), do: Broadcaster.notify(state.project_slug, state.identifier)

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

  defp safe_kill_session(state) do
    kill_dev_session(state)
    :ok
  rescue
    _error -> :ok
  catch
    _kind, _reason -> :ok
  end

  defp cleanup_session(%{session_name: nil}), do: :ok

  defp cleanup_session(state) do
    case kill_dev_session(state) do
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

  defp open_dev_session(
         %{tmux: Registry, record_scope: {:workspace, workspace_path}} = state,
         cwd
       ) do
    Registry.open_workspace_dev_session(
      state.project_slug,
      workspace_path,
      state.slug,
      cwd
    )
  end

  defp open_dev_session(state, cwd) do
    state.tmux.open_dev_session(
      state.project_slug,
      state.identifier,
      state.slug,
      cwd,
      []
    )
  end

  defp kill_dev_session(
         %{
           tmux: Registry,
           record_scope: {:workspace, workspace_path}
         } = state
       ) do
    Registry.kill_workspace_dev_session(
      state.project_slug,
      workspace_path,
      state.slug
    )
  end

  defp kill_dev_session(state) do
    state.tmux.kill_dev_session(
      state.project_slug,
      state.identifier,
      state.slug,
      []
    )
  end

  defp public_host(
         _project_slug,
         _identifier,
         _slug,
         _public_tunnel,
         {:workspace, _workspace_path}
       ),
       do: nil

  defp public_host(project_slug, identifier, slug, public_tunnel, _record_scope) do
    PublicRouting.preview_host(project_slug, identifier, slug, public_tunnel)
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
