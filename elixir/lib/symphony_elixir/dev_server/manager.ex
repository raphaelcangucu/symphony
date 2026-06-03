defmodule SymphonyElixir.DevServer.Manager do
  @moduledoc """
  Supervises per-issue dev-server instances and exposes lifecycle helpers.
  """

  use Supervisor

  require Logger

  alias SymphonyElixir.Config
  alias SymphonyElixir.DevServer.Instance
  alias SymphonyElixir.DevServer.PortAllocator
  alias SymphonyElixir.LocalTracker.{Context, DevEnv, DevServerRecord, ProjectSetup}
  alias SymphonyElixir.Terminal.Registry, as: TerminalRegistry
  alias SymphonyElixir.Workspace

  @registry Module.concat(__MODULE__, Registry)
  @instance_supervisor Module.concat(__MODULE__, InstanceSupervisor)
  @reservation_table Module.concat(__MODULE__, PortReservations)
  @initial_boot_timeout_ms 250

  @type start_error ::
          :disabled
          | :workspace_missing
          | :no_serve_step
          | :no_free_port
          | :crashed
          | :lock_unavailable
          | term()
  @type dev_server_map :: %{
          id: integer(),
          slug: String.t(),
          working_dir: String.t() | nil,
          port: pos_integer() | nil,
          url: String.t() | nil,
          status: String.t(),
          primary: boolean(),
          session_name: String.t() | nil
        }

  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts) when is_list(opts) do
    Supervisor.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @impl true
  def init(_opts) do
    ensure_reservation_table()
    mark_all_stopped_safely()

    children = [
      {Registry, keys: :unique, name: @registry},
      {DynamicSupervisor, strategy: :one_for_one, name: @instance_supervisor}
    ]

    Supervisor.init(children, strategy: :one_for_all)
  end

  @spec start_for_issue(String.t(), String.t()) :: {:ok, [pid()]} | {:error, start_error()}
  def start_for_issue(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    identifier = canonical_identifier(identifier)

    with {:ok, project} <- Context.get_project(project_slug) do
      runtime_options = project_runtime_options(project)

      if runtime_options.dev_server_enabled? do
        normalize_lock_result(
          :global.trans({__MODULE__, :start_for_issue}, fn ->
            do_start_for_issue(project, identifier, runtime_options)
          end)
        )
      else
        {:error, :disabled}
      end
    end
  end

  def start_for_issue(_project_slug, _identifier), do: {:error, :invalid_arguments}

  @spec stop_for_issue(String.t(), String.t()) :: :ok
  def stop_for_issue(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    identifier = canonical_identifier(identifier)

    project_slug
    |> registered_instance_pids(identifier)
    |> Enum.each(&stop_instance/1)

    project_slug
    |> reservation_keys_for_issue(identifier)
    |> release_reservations()

    :ok
  end

  def stop_for_issue(_project_slug, _identifier), do: :ok

  @spec restart_for_issue(String.t(), String.t()) :: {:ok, [pid()]} | {:error, term()}
  def restart_for_issue(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    identifier = canonical_identifier(identifier)
    :ok = stop_for_issue(project_slug, identifier)
    start_for_issue(project_slug, identifier)
  end

  def restart_for_issue(_project_slug, _identifier), do: {:error, :invalid_arguments}

  @spec list_for_issue(String.t(), String.t()) :: [dev_server_map()]
  def list_for_issue(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    identifier = canonical_identifier(identifier)

    case Context.get_project(project_slug) do
      {:ok, project} ->
        project.id
        |> DevServerRecord.list_for_issue(identifier)
        |> Enum.map(&record_to_map/1)

      {:error, _reason} ->
        []
    end
  end

  def list_for_issue(_project_slug, _identifier), do: []

  @spec live_ports() :: [pos_integer()]
  def live_ports do
    registry_ports =
      @registry
      |> all_registered_pids()
      |> Enum.flat_map(&instance_port/1)

    Enum.uniq(reserved_ports() ++ registry_ports)
  end

  @doc false
  @spec normalize_lock_result(:aborted | term()) :: {:error, :lock_unavailable} | term()
  def normalize_lock_result(:aborted), do: {:error, :lock_unavailable}
  def normalize_lock_result(result), do: result

  defp do_start_for_issue(project, identifier, runtime_options) do
    with {:ok, workspace_path} <- issue_workspace_path(identifier),
         {:ok, serve_steps} <- serve_steps(project.slug, identifier),
         {:ok, reserved_steps} <- reserve_ports(project.slug, identifier, serve_steps, runtime_options.dev_server_port_range) do
      setup_issue_session(project.slug, identifier, workspace_path)
      start_instances(project, identifier, workspace_path, reserved_steps, runtime_options)
    end
  end

  defp issue_workspace_path(identifier) do
    workspace_path = Workspace.path_for_issue(identifier)

    if File.dir?(workspace_path) do
      {:ok, workspace_path}
    else
      {:error, :workspace_missing}
    end
  end

  defp serve_steps(project_slug, identifier) do
    case DevEnv.list_serve_steps(project_slug) do
      [] -> {:error, :no_serve_step}
      steps -> {:ok, unique_serve_steps(project_slug, identifier, steps)}
    end
  end

  defp reserve_ports(project_slug, identifier, serve_steps, port_range) do
    serve_steps
    |> Enum.reduce_while({:ok, []}, fn step, {:ok, reserved_steps} ->
      claimed_ports = live_ports() ++ Enum.map(reserved_steps, fn {_step, port, _key} -> port end)

      case PortAllocator.allocate(port_range, claimed_ports) do
        {:ok, port} ->
          key = {project_slug, identifier, Map.fetch!(step, :slug)}
          reserve_port_for_key(key, port)
          {:cont, {:ok, [{step, port, key} | reserved_steps]}}

        {:error, _reason} ->
          release_reserved_steps(reserved_steps)
          {:halt, {:error, :no_free_port}}
      end
    end)
    |> case do
      {:ok, reserved_steps} -> {:ok, Enum.reverse(reserved_steps)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp setup_issue_session(project_slug, identifier, workspace_path) do
    setup_steps =
      project_slug
      |> DevEnv.list_steps()
      |> Enum.filter(&(&1.role == "setup"))

    if setup_steps != [] do
      send_setup_steps(project_slug, identifier, workspace_path, setup_steps)
    end
  end

  defp send_setup_steps(project_slug, identifier, workspace_path, setup_steps) do
    case TerminalRegistry.open_project_issue_session(project_slug, identifier) do
      {:ok, _session} ->
        Enum.each(setup_steps, &send_setup_step(project_slug, identifier, workspace_path, &1))

      {:error, reason} ->
        Logger.warning("Dev server setup session unavailable project=#{project_slug} issue=#{identifier} reason=#{inspect(reason)}")
    end
  rescue
    error ->
      Logger.warning("Dev server setup session failed project=#{project_slug} issue=#{identifier} reason=#{inspect(error)}")
  end

  defp send_setup_step(project_slug, identifier, workspace_path, step) do
    case setup_command_for_workspace(workspace_path, step) do
      nil ->
        Logger.warning("Dev server setup command skipped project=#{project_slug} issue=#{identifier} reason=:unsafe_working_dir")

      data ->
        case TerminalRegistry.send_input(project_slug, identifier, data) do
          :ok ->
            :ok

          {:error, reason} ->
            Logger.warning("Dev server setup command send failed project=#{project_slug} issue=#{identifier} reason=#{inspect(reason)}")
        end
    end
  rescue
    error ->
      Logger.warning("Dev server setup command send failed project=#{project_slug} issue=#{identifier} reason=#{inspect(error)}")
  end

  @doc false
  @spec setup_command_for_workspace(Path.t(), map() | struct()) :: String.t() | nil
  def setup_command_for_workspace(workspace_path, step) when is_binary(workspace_path) do
    step = step_to_map(step)
    command = Map.get(step, :command)

    with true <- is_binary(command) and String.trim(command) != "",
         {:ok, root_realpath} <- realpath(workspace_path),
         {:ok, cwd_realpath} <- setup_cwd_realpath(root_realpath, Map.get(step, :working_dir)),
         :ok <- ensure_contained(cwd_realpath, root_realpath) do
      case normalized_working_dir(Map.get(step, :working_dir)) do
        nil -> command <> "\n"
        _working_dir -> "cd #{shell_quote(cwd_realpath)} && #{command}\n"
      end
    else
      _invalid -> nil
    end
  end

  def setup_command_for_workspace(_workspace_path, _step), do: nil

  defp start_instances(project, identifier, workspace_path, reserved_steps, runtime_options) do
    attempt_keys = Enum.map(reserved_steps, fn {_step, _port, key} -> key end)

    reserved_steps
    |> Enum.reduce_while({:ok, []}, fn {step, port, key}, {:ok, started} ->
      case start_reserved_instance(project, identifier, workspace_path, step, port, key, runtime_options) do
        {:ok, started_instance} ->
          {:cont, {:ok, [started_instance | started]}}

        {:error, reason} ->
          rollback_start_attempt(started, attempt_keys)
          {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, started} -> {:ok, started |> Enum.map(fn {pid, _key} -> pid end) |> Enum.reverse()}
      {:error, reason} -> {:error, reason}
    end
  end

  defp start_reserved_instance(project, identifier, workspace_path, step, port, key, runtime_options) do
    case start_instance(project, identifier, workspace_path, step, port, key, runtime_options) do
      {:ok, pid} -> await_reserved_instance_boot(pid, key)
      {:error, reason} -> {:error, reason}
    end
  end

  defp await_reserved_instance_boot(pid, key) do
    case await_initial_boot(pid) do
      :ok ->
        {:ok, {pid, key}}

      {:error, reason} ->
        stop_instance(pid)
        {:error, reason}
    end
  end

  defp start_instance(project, identifier, workspace_path, step, port, key, runtime_options) do
    opts = [
      registry_name: {:via, Registry, {@registry, key}},
      project_id: project.id,
      project_slug: project.slug,
      identifier: identifier,
      workspace_path: workspace_path,
      step: step,
      base_url: runtime_options.dev_server_base_url,
      idle_timeout_ms: runtime_options.dev_server_idle_timeout_ms,
      public_tunnel: runtime_options.public_tunnel,
      claimed_ports: live_ports(),
      port_allocator: fn _range, _claimed_ports -> {:ok, port} end
    ]

    case DynamicSupervisor.start_child(@instance_supervisor, instance_child_spec(key, opts)) do
      {:ok, pid} ->
        attach_reserved_pid(key, pid)
        {:ok, pid}

      {:ok, pid, _info} ->
        attach_reserved_pid(key, pid)
        {:ok, pid}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc false
  @spec instance_child_spec(term(), keyword()) :: Supervisor.child_spec()
  def instance_child_spec(key, opts) when is_list(opts) do
    %{
      id: {Instance, key},
      start: {Instance, :start_link, [opts]},
      restart: :temporary,
      type: :worker
    }
  end

  @doc false
  @spec unique_serve_steps(String.t(), String.t(), [map() | struct()]) :: [map()]
  def unique_serve_steps(project_slug, identifier, steps)
      when is_binary(project_slug) and is_binary(identifier) and is_list(steps) do
    {steps, _session_names} =
      Enum.map_reduce(steps, MapSet.new(), fn step, session_names ->
        base_slug = serve_slug(Map.get(step_to_map(step), :working_dir))
        {slug, session_names} = unique_slug(project_slug, identifier, base_slug, session_names, 1)
        {put_step_slug(step, slug), session_names}
      end)

    steps
  end

  def unique_serve_steps(_project_slug, _identifier, _steps), do: []

  defp unique_slug(project_slug, identifier, base_slug, session_names, attempt) do
    slug = if attempt == 1, do: base_slug, else: "#{base_slug}-#{attempt}"
    session_name = TerminalRegistry.dev_session_name(project_slug, identifier, slug)

    if MapSet.member?(session_names, session_name) do
      unique_slug(project_slug, identifier, base_slug, session_names, attempt + 1)
    else
      {slug, MapSet.put(session_names, session_name)}
    end
  end

  defp serve_slug(working_dir) do
    case normalized_working_dir(working_dir) do
      nil -> "app"
      slug -> slug
    end
  end

  defp put_step_slug(step, slug) do
    step
    |> step_to_map()
    |> Map.take([
      :command,
      :working_dir,
      :port_env,
      :url_path,
      :ready_probe,
      :ready_path,
      :primary
    ])
    |> Map.put(:slug, slug)
  end

  defp normalized_working_dir(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      "." -> nil
      working_dir -> working_dir
    end
  end

  defp normalized_working_dir(_value), do: nil

  defp setup_cwd_realpath(root_realpath, working_dir) do
    case normalized_working_dir(working_dir) do
      nil ->
        {:ok, root_realpath}

      working_dir ->
        working_dir
        |> expand_working_dir(root_realpath)
        |> realpath()
    end
  end

  defp expand_working_dir(working_dir, root_realpath) do
    case Path.type(working_dir) do
      :absolute -> Path.expand(working_dir)
      _relative -> Path.expand(Path.join(root_realpath, working_dir))
    end
  end

  defp ensure_contained(cwd_realpath, root_realpath) do
    if cwd_realpath == root_realpath or String.starts_with?(cwd_realpath, root_realpath <> "/") do
      :ok
    else
      {:error, {:working_dir_outside_workspace, cwd_realpath, root_realpath}}
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

  defp registered_instance_pids(project_slug, identifier) do
    @registry
    |> all_registry_entries()
    |> Enum.filter(fn
      {{^project_slug, ^identifier, _slug}, _pid} -> true
      _entry -> false
    end)
    |> Enum.map(fn {_key, pid} -> pid end)
  end

  defp reservation_keys_for_issue(project_slug, identifier) do
    reservation_entries()
    |> Enum.filter(fn
      {{^project_slug, ^identifier, _slug}, _port, _pid} -> true
      _entry -> false
    end)
    |> Enum.map(fn {key, _port, _pid} -> key end)
  end

  defp all_registered_pids(registry) do
    registry
    |> all_registry_entries()
    |> Enum.map(fn {_key, pid} -> pid end)
  end

  defp all_registry_entries(registry) do
    Registry.select(registry, [{{:"$1", :"$2", :"$3"}, [], [{{:"$1", :"$2"}}]}])
  rescue
    ArgumentError -> []
  catch
    :exit, _reason -> []
  end

  defp stop_instance(pid) when is_pid(pid) do
    Instance.stop(pid)
  catch
    :exit, _reason -> :ok
  end

  defp rollback_start_attempt(started, attempt_keys) do
    Enum.each(started, fn {pid, _key} -> stop_instance(pid) end)
    release_reservations(attempt_keys)
  end

  defp release_reserved_steps(reserved_steps) do
    reserved_steps
    |> Enum.map(fn {_step, _port, key} -> key end)
    |> release_reservations()
  end

  defp await_initial_boot(pid) when is_pid(pid) do
    task = Task.async(fn -> Instance.status(pid) end)

    case Task.yield(task, @initial_boot_timeout_ms) || Task.shutdown(task, :brutal_kill) do
      {:ok, :crashed} -> {:error, :crashed}
      {:ok, _status} -> :ok
      {:exit, reason} -> {:error, reason}
      nil -> :ok
    end
  end

  defp instance_port(pid) when is_pid(pid) do
    case :sys.get_state(pid, 100) do
      %{port: port} when is_integer(port) and port > 0 -> [port]
      _state -> []
    end
  catch
    :exit, _reason -> []
  end

  defp record_to_map(record) do
    %{
      id: record.id,
      slug: record.slug,
      working_dir: record.working_dir,
      port: record.port,
      url: record.url,
      status: record.status,
      primary: record.primary,
      session_name: record.session_name
    }
  end

  defp project_runtime_options(project) do
    opts =
      project
      |> project_workflow_config()
      |> Config.validate_front_matter()

    %{
      dev_server_enabled?: get_in(opts, [:dev_server, :enabled]) == true,
      dev_server_port_range: get_in(opts, [:dev_server, :port_range]),
      dev_server_base_url: normalize_base_url(get_in(opts, [:dev_server, :base_url])),
      dev_server_idle_timeout_ms: get_in(opts, [:dev_server, :idle_timeout_ms]),
      public_tunnel: [
        enabled: get_in(opts, [:public_tunnel, :enabled]),
        base_domain: get_in(opts, [:public_tunnel, :base_domain]),
        namespace: get_in(opts, [:public_tunnel, :namespace])
      ]
    }
  end

  defp project_workflow_config(project) do
    case Context.get_project_setup(project.slug) do
      %ProjectSetup{workflow_config: %{} = config} -> config
      _setup -> %{}
    end
  end

  defp normalize_base_url(url) when is_binary(url) and url != "", do: String.trim_trailing(url, "/")
  defp normalize_base_url(_url), do: nil

  defp shell_quote(value) do
    "'" <> String.replace(value, "'", "'\"'\"'") <> "'"
  end

  @doc false
  @spec reserve_port_for_key(term(), pos_integer()) :: :ok
  def reserve_port_for_key(key, port) when is_integer(port) and port > 0 do
    with {:ok, table} <- reservation_table() do
      :ets.insert(table, {key, port, nil})
    end

    :ok
  end

  @doc false
  @spec release_reservations([term()]) :: :ok
  def release_reservations(keys) when is_list(keys) do
    with {:ok, table} <- reservation_table() do
      Enum.each(keys, &:ets.delete(table, &1))
    end

    :ok
  end

  def release_reservations(_keys), do: :ok

  defp attach_reserved_pid(key, pid) when is_pid(pid) do
    with {:ok, table} <- reservation_table() do
      case :ets.lookup(table, key) do
        [{^key, port, _old_pid}] -> :ets.insert(table, {key, port, pid})
        [] -> :ok
      end
    end

    :ok
  end

  defp reserved_ports do
    reservation_entries()
    |> Enum.map(fn {_key, port, _pid} -> port end)
  end

  defp reservation_entries do
    cleanup_dead_reservations()

    case reservation_table() do
      {:ok, table} -> :ets.tab2list(table)
      :error -> []
    end
  end

  defp cleanup_dead_reservations do
    case reservation_table() do
      {:ok, table} -> cleanup_dead_reservations(table)
      :error -> :ok
    end
  end

  defp cleanup_dead_reservations(table) do
    table
    |> :ets.tab2list()
    |> Enum.each(&cleanup_reservation_entry(table, &1))
  end

  defp cleanup_reservation_entry(table, {key, _port, pid}) when is_pid(pid) do
    unless Process.alive?(pid), do: :ets.delete(table, key)

    :ok
  end

  defp cleanup_reservation_entry(_table, _entry), do: :ok

  defp ensure_reservation_table do
    case :ets.whereis(@reservation_table) do
      :undefined ->
        try do
          :ets.new(@reservation_table, [:named_table, :public, :set, read_concurrency: true])
        rescue
          ArgumentError -> :ok
        end

      _table ->
        :ok
    end

    :ok
  end

  defp reservation_table do
    case :ets.whereis(@reservation_table) do
      :undefined -> :error
      table -> {:ok, table}
    end
  end

  defp step_to_map(%_struct{} = step), do: Map.from_struct(step)
  defp step_to_map(step) when is_map(step), do: step
  defp step_to_map(_step), do: %{}

  defp canonical_identifier(identifier) when is_binary(identifier) do
    String.trim_leading(identifier, "#")
  end

  defp mark_all_stopped_safely do
    DevServerRecord.mark_all_stopped()
    :ok
  rescue
    error ->
      Logger.warning("Dev server startup status reconciliation failed reason=#{inspect(error)}")
      :ok
  end
end
