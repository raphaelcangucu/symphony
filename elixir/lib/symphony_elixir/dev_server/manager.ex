defmodule SymphonyElixir.DevServer.Manager do
  @moduledoc """
  Supervises per-issue dev-server instances and exposes lifecycle helpers.
  """

  use Supervisor

  require Logger

  alias SymphonyElixir.Config
  alias SymphonyElixir.DevServer.Instance
  alias SymphonyElixir.LocalTracker.{Context, DevEnv, DevServerRecord}
  alias SymphonyElixir.Terminal.Registry, as: TerminalRegistry
  alias SymphonyElixir.Workspace

  @registry Module.concat(__MODULE__, Registry)
  @instance_supervisor Module.concat(__MODULE__, InstanceSupervisor)

  @type start_error :: :disabled | :workspace_missing | :no_serve_step | :capacity | term()
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
    mark_all_stopped_safely()

    children = [
      {Registry, keys: :unique, name: @registry},
      {DynamicSupervisor, strategy: :one_for_one, name: @instance_supervisor}
    ]

    Supervisor.init(children, strategy: :one_for_all)
  end

  @spec start_for_issue(String.t(), String.t()) :: {:ok, [pid()]} | {:error, start_error()}
  def start_for_issue(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    if Config.dev_server_enabled?() do
      do_start_for_issue(project_slug, identifier)
    else
      {:error, :disabled}
    end
  end

  def start_for_issue(_project_slug, _identifier), do: {:error, :invalid_arguments}

  @spec stop_for_issue(String.t(), String.t()) :: :ok
  def stop_for_issue(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    project_slug
    |> registered_instance_pids(identifier)
    |> Enum.each(&stop_instance/1)

    :ok
  end

  def stop_for_issue(_project_slug, _identifier), do: :ok

  @spec restart_for_issue(String.t(), String.t()) :: {:ok, [pid()]} | {:error, term()}
  def restart_for_issue(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    :ok = stop_for_issue(project_slug, identifier)
    start_for_issue(project_slug, identifier)
  end

  def restart_for_issue(_project_slug, _identifier), do: {:error, :invalid_arguments}

  @spec list_for_issue(String.t(), String.t()) :: [dev_server_map()]
  def list_for_issue(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    with {:ok, project} <- Context.get_project(project_slug) do
      project.id
      |> DevServerRecord.list_for_issue(identifier)
      |> Enum.map(&record_to_map/1)
    else
      {:error, _reason} -> []
    end
  end

  def list_for_issue(_project_slug, _identifier), do: []

  @spec live_ports() :: [pos_integer()]
  def live_ports do
    @registry
    |> all_registered_pids()
    |> Enum.flat_map(&instance_port/1)
    |> Enum.uniq()
  end

  defp do_start_for_issue(project_slug, identifier) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, workspace_path} <- issue_workspace_path(identifier),
         {:ok, serve_steps} <- serve_steps(project.slug),
         :ok <- ensure_capacity(serve_steps) do
      setup_issue_session(project.slug, identifier)
      start_instances(project, identifier, workspace_path, serve_steps)
    end
  end

  defp issue_workspace_path(identifier) do
    workspace_path = Workspace.path_for_issue(String.trim_leading(identifier, "#"))

    if File.dir?(workspace_path) do
      {:ok, workspace_path}
    else
      {:error, :workspace_missing}
    end
  end

  defp serve_steps(project_slug) do
    case DevEnv.list_serve_steps(project_slug) do
      [] -> {:error, :no_serve_step}
      steps -> {:ok, unique_serve_steps(steps)}
    end
  end

  defp ensure_capacity(serve_steps) do
    live_count = @registry |> all_registered_pids() |> length()

    if live_count + length(serve_steps) > Config.dev_server_max_concurrent() do
      {:error, :capacity}
    else
      :ok
    end
  end

  defp setup_issue_session(project_slug, identifier) do
    setup_steps =
      project_slug
      |> DevEnv.list_steps()
      |> Enum.filter(&(&1.role == "setup"))

    if setup_steps != [] do
      send_setup_steps(project_slug, identifier, setup_steps)
    end
  end

  defp send_setup_steps(project_slug, identifier, setup_steps) do
    case TerminalRegistry.open_project_issue_session(project_slug, identifier) do
      {:ok, _session} ->
        Enum.each(setup_steps, &send_setup_step(project_slug, identifier, &1))

      {:error, reason} ->
        Logger.warning("Dev server setup session unavailable project=#{project_slug} issue=#{identifier} reason=#{inspect(reason)}")
    end
  rescue
    error ->
      Logger.warning("Dev server setup session failed project=#{project_slug} issue=#{identifier} reason=#{inspect(error)}")
  end

  defp send_setup_step(project_slug, identifier, step) do
    data = setup_command(step)

    case TerminalRegistry.send_input(project_slug, identifier, data) do
      :ok ->
        :ok

      {:error, reason} ->
        Logger.warning("Dev server setup command send failed project=#{project_slug} issue=#{identifier} reason=#{inspect(reason)}")
    end
  rescue
    error ->
      Logger.warning("Dev server setup command send failed project=#{project_slug} issue=#{identifier} reason=#{inspect(error)}")
  end

  defp setup_command(step) do
    command = Map.fetch!(step, :command)

    case normalized_working_dir(Map.get(step, :working_dir)) do
      nil -> command <> "\n"
      working_dir -> "cd #{shell_quote(working_dir)} && #{command}\n"
    end
  end

  defp start_instances(project, identifier, workspace_path, serve_steps) do
    serve_steps
    |> Enum.reduce_while({:ok, []}, fn step, {:ok, pids} ->
      case start_instance(project, identifier, workspace_path, step) do
        {:ok, pid} -> {:cont, {:ok, [pid | pids]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, pids} -> {:ok, Enum.reverse(pids)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp start_instance(project, identifier, workspace_path, step) do
    key = {project.slug, identifier, Map.fetch!(step, :slug)}

    opts = [
      registry_name: {:via, Registry, {@registry, key}},
      project_id: project.id,
      project_slug: project.slug,
      identifier: identifier,
      workspace_path: workspace_path,
      step: step,
      base_url: Config.dev_server_base_url(),
      idle_timeout_ms: Config.dev_server_idle_timeout_ms(),
      claimed_ports: live_ports()
    ]

    DynamicSupervisor.start_child(@instance_supervisor, {Instance, opts})
  end

  defp unique_serve_steps(steps) do
    {_counts, steps} =
      Enum.map_reduce(steps, %{}, fn step, counts ->
        base_slug = serve_slug(Map.get(step, :working_dir))
        count = Map.get(counts, base_slug, 0) + 1
        slug = if count == 1, do: base_slug, else: "#{base_slug}-#{count}"
        {put_step_slug(step, slug), Map.put(counts, base_slug, count)}
      end)

    steps
  end

  defp serve_slug(working_dir) do
    case normalized_working_dir(working_dir) do
      nil -> "app"
      slug -> slug
    end
  end

  defp put_step_slug(step, slug) do
    step
    |> Map.from_struct()
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

  defp registered_instance_pids(project_slug, identifier) do
    @registry
    |> all_registry_entries()
    |> Enum.filter(fn
      {{^project_slug, ^identifier, _slug}, _pid} -> true
      _entry -> false
    end)
    |> Enum.map(fn {_key, pid} -> pid end)
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

  defp shell_quote(value) do
    "'" <> String.replace(value, "'", "'\"'\"'") <> "'"
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
