defmodule SymphonyElixir.DevServer.Manager do
  @moduledoc """
  Supervises per-issue dev-server instances and exposes lifecycle helpers.
  """

  use Supervisor

  require Logger

  alias SymphonyElixir.Config
  alias SymphonyElixir.DevServer.Broadcaster
  alias SymphonyElixir.DevServer.Instance
  alias SymphonyElixir.DevServer.LeaseStore
  alias SymphonyElixir.DevServer.PortPlan
  alias SymphonyElixir.DevServer.PortReclaimer
  alias SymphonyElixir.DevServer.RuntimeContractStore
  alias SymphonyElixir.LocalTracker.{Context, DevEnv, DevServerRecord, ProjectSetup}
  alias SymphonyElixir.Terminal.Registry, as: TerminalRegistry
  alias SymphonyElixir.Workspace

  @registry Module.concat(__MODULE__, Registry)
  @instance_supervisor Module.concat(__MODULE__, InstanceSupervisor)
  @reservation_table Module.concat(__MODULE__, PortReservations)
  @prior_instance_ready_timeout_ms 600_000
  @prior_instance_ready_poll_ms 2_000
  @serve_with_setup_probe_interval_ms 2_000
  @serve_with_setup_max_probe_attempts 300
  @probe_connect_timeout_ms 1_000
  @probe_loopback_host "127.0.0.1"
  @tracked_live_statuses ~w(pending provisioning starting ready)

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

  @spec start_for_issue(String.t(), String.t(), keyword()) :: {:ok, [pid()]} | {:error, start_error()}
  def start_for_issue(project_slug, identifier, opts \\ [])

  def start_for_issue(project_slug, identifier, opts)
      when is_binary(project_slug) and is_binary(identifier) and is_list(opts) do
    identifier = canonical_identifier(identifier)

    with {:ok, project} <- Context.get_project(project_slug) do
      runtime_options = project |> project_runtime_options() |> apply_runtime_overrides(opts)

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

  def start_for_issue(_project_slug, _identifier, _opts), do: {:error, :invalid_arguments}

  @spec stop_for_issue(String.t(), String.t()) :: :ok
  def stop_for_issue(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    identifier = canonical_identifier(identifier)

    project_slug
    |> registered_instance_pids(identifier)
    |> Enum.each(&stop_instance/1)

    project_slug
    |> reservation_keys_for_issue(identifier)
    |> release_reservations()

    release_issue_slot(project_slug, identifier)
    delete_issue_contracts(project_slug, identifier)

    :ok
  end

  def stop_for_issue(_project_slug, _identifier), do: :ok

  @spec restart_for_issue(String.t(), String.t(), keyword()) :: {:ok, [pid()]} | {:error, term()}
  def restart_for_issue(project_slug, identifier, opts \\ [])

  def restart_for_issue(project_slug, identifier, opts)
      when is_binary(project_slug) and is_binary(identifier) and is_list(opts) do
    identifier = canonical_identifier(identifier)
    :ok = stop_for_issue(project_slug, identifier)
    start_for_issue(project_slug, identifier, opts)
  end

  def restart_for_issue(_project_slug, _identifier, _opts), do: {:error, :invalid_arguments}

  @doc """
  Reserve leased ports and mint `contracted_manual` runtime contracts for an
  issue's serve steps *without* launching them. Returns the exact env + command
  an external caller (agent/user/`vibe`) must run so the process binds a leased
  port and reports its actual port back under the contract.
  """
  @spec prepare_for_issue(String.t(), String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def prepare_for_issue(project_slug, identifier, opts \\ [])

  def prepare_for_issue(project_slug, identifier, opts)
      when is_binary(project_slug) and is_binary(identifier) and is_list(opts) do
    identifier = canonical_identifier(identifier)

    with {:ok, project} <- Context.get_project(project_slug) do
      runtime_options = project |> project_runtime_options() |> apply_runtime_overrides(opts)

      if runtime_options.dev_server_enabled? do
        normalize_lock_result(
          :global.trans({__MODULE__, :prepare_for_issue}, fn ->
            do_prepare_for_issue(project, identifier, runtime_options)
          end)
        )
      else
        {:error, :disabled}
      end
    end
  end

  def prepare_for_issue(_project_slug, _identifier, _opts), do: {:error, :invalid_arguments}

  @spec stop_instance_for_server(String.t(), String.t(), pos_integer()) :: :ok | {:error, :not_found}
  def stop_instance_for_server(project_slug, identifier, server_id)
      when is_binary(project_slug) and is_binary(identifier) and is_integer(server_id) and server_id > 0 do
    identifier = canonical_identifier(identifier)

    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, slug} <- server_slug_for_id(project, identifier, server_id) do
      do_stop_instance_for_server(project.slug, identifier, slug)
      :ok
    end
  end

  def stop_instance_for_server(_project_slug, _identifier, _server_id), do: {:error, :not_found}

  @spec start_instance_for_server(String.t(), String.t(), pos_integer()) ::
          {:ok, [pid()]} | {:error, start_error() | :not_found}
  def start_instance_for_server(project_slug, identifier, server_id)
      when is_binary(project_slug) and is_binary(identifier) and is_integer(server_id) and server_id > 0 do
    identifier = canonical_identifier(identifier)

    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, _slug} <- server_slug_for_id(project, identifier, server_id) do
      runtime_options = project_runtime_options(project)

      if runtime_options.dev_server_enabled? do
        normalize_lock_result(
          :global.trans({__MODULE__, {:start_instance_for_server, server_id}}, fn ->
            do_start_instance_for_server(project, identifier, server_id, runtime_options)
          end)
        )
      else
        {:error, :disabled}
      end
    end
  end

  def start_instance_for_server(_project_slug, _identifier, _server_id), do: {:error, :not_found}

  @spec restart_instance_for_server(String.t(), String.t(), pos_integer()) ::
          {:ok, [pid()]} | {:error, start_error() | :not_found}
  def restart_instance_for_server(project_slug, identifier, server_id)
      when is_binary(project_slug) and is_binary(identifier) and is_integer(server_id) and server_id > 0 do
    identifier = canonical_identifier(identifier)

    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, slug} <- server_slug_for_id(project, identifier, server_id) do
      runtime_options = project_runtime_options(project)

      if runtime_options.dev_server_enabled? do
        normalize_lock_result(
          :global.trans({__MODULE__, {:restart_instance_for_server, server_id}}, fn ->
            with :ok <- do_stop_instance_for_server(project.slug, identifier, slug) do
              do_start_instance_for_server(project, identifier, server_id, runtime_options)
            end
          end)
        )
      else
        {:error, :disabled}
      end
    end
  end

  def restart_instance_for_server(_project_slug, _identifier, _server_id), do: {:error, :not_found}

  @spec list_for_issue(String.t(), String.t()) :: [dev_server_map()]
  def list_for_issue(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    identifier = canonical_identifier(identifier)

    case Context.get_project(project_slug) do
      {:ok, project} ->
        ensure_serve_records(project, project_slug, identifier)

        project.id
        |> DevServerRecord.list_for_issue(identifier)
        |> Enum.map(&reconcile_record_status(&1, project, project_slug, identifier))
        |> Enum.map(&record_to_map/1)

      {:error, _reason} ->
        []
    end
  end

  def list_for_issue(_project_slug, _identifier), do: []

  @spec capture_server_output(String.t(), String.t(), pos_integer()) ::
          {:ok, %{output: String.t(), session_name: String.t()}} | {:error, :not_found | String.t()}
  def capture_server_output(project_slug, identifier, server_id)
      when is_binary(project_slug) and is_binary(identifier) and is_integer(server_id) and server_id > 0 do
    identifier = canonical_identifier(identifier)

    with {:ok, project} <- Context.get_project(project_slug),
         %DevServerRecord{slug: slug, session_name: session_name} <-
           DevServerRecord.get_for_issue(project.id, identifier, server_id),
         true <- is_binary(slug) do
      session_name = session_name || TerminalRegistry.dev_session_name(project_slug, identifier, slug)

      project_slug
      |> TerminalRegistry.capture_dev_session(identifier, slug)
      |> normalize_dev_session_capture(session_name)
    else
      nil -> {:error, :not_found}
      {:error, _reason} -> {:error, :not_found}
      _ -> {:error, :not_found}
    end
  end

  def capture_server_output(_project_slug, _identifier, _server_id), do: {:error, :not_found}

  @spec live_ports() :: [pos_integer()]
  def live_ports do
    registry_ports =
      @registry
      |> all_registered_pids()
      |> Enum.flat_map(&instance_port/1)

    Enum.uniq(reserved_ports() ++ registry_ports)
  end

  @spec running_issue_keys() :: MapSet.t({String.t(), String.t()})
  def running_issue_keys do
    @registry
    |> all_registry_entries()
    |> Enum.map(fn {{project_slug, identifier, _step_slug}, _pid} -> {project_slug, identifier} end)
    |> MapSet.new()
  end

  @doc false
  @spec normalize_lock_result(:aborted | term()) :: {:error, :lock_unavailable} | term()
  def normalize_lock_result(:aborted), do: {:error, :lock_unavailable}
  def normalize_lock_result(result), do: result

  defp do_start_for_issue(project, identifier, runtime_options) do
    with {:ok, workspace_path} <- issue_workspace_path(identifier),
         {:ok, serve_steps} <- serve_steps(project.slug, identifier),
         ctx = allocation_context(project, identifier, runtime_options.dev_server_port_range),
         owned = owned_ports(project.id, identifier),
         {:ok, reserved_steps} <-
           reserve_with_context(
             project.slug,
             identifier,
             serve_steps,
             ctx,
             owned,
             runtime_options.dev_server_reclaim_ports?
           ) do
      contracts =
        maybe_build_managed_contracts(
          project,
          identifier,
          workspace_path,
          serve_steps,
          reserved_steps,
          ctx,
          runtime_options
        )

      setup_issue_session(project.slug, identifier, workspace_path)

      case start_instances(project, identifier, workspace_path, reserved_steps, runtime_options, contracts) do
        {:ok, pids} ->
          {:ok, pids}

        {:error, reason} ->
          release_issue_candidate_reservations(project.slug, identifier)
          {:error, reason}
      end
    end
  end

  defp do_prepare_for_issue(project, identifier, runtime_options) do
    with {:ok, workspace_path} <- issue_workspace_path(identifier),
         {:ok, serve_steps} <- serve_steps(project.slug, identifier),
         ctx = allocation_context(project, identifier, runtime_options.dev_server_port_range),
         owned = owned_ports(project.id, identifier),
         {:ok, reserved_steps} <-
           reserve_with_context(
             project.slug,
             identifier,
             serve_steps,
             ctx,
             owned,
             runtime_options.dev_server_reclaim_ports?
           ) do
      servers = build_manual_contract_plan(project, identifier, workspace_path, serve_steps, reserved_steps, ctx)
      {:ok, %{ok: true, issue: identifier, servers: servers}}
    end
  end

  defp build_manual_contract_plan(project, identifier, workspace_path, serve_steps, reserved_steps, ctx) do
    service_count = max(length(serve_steps), 1)
    canonical = canonical_identifier(identifier)

    reserved_steps
    |> Enum.map(fn {step, port, key} ->
      step_map = step_to_map(step)
      slug = Map.fetch!(step_map, :slug)
      offset = serve_offset(serve_steps, slug)
      allowed = contract_allowed_ports(ctx, offset, service_count, port)
      reserve_candidate_ports(key, allowed)

      case build_service_contract(project, canonical, workspace_path, step_map, port, allowed, :contracted_manual) do
        {:ok, contract} -> manual_server_plan(contract, step_map)
        {:error, _reason} -> nil
      end
    end)
    |> Enum.reject(&is_nil/1)
  end

  defp manual_server_plan(contract, step_map) do
    env = SymphonyElixir.DevServer.RuntimeContract.to_env(contract)
    command = Map.fetch!(step_map, :command)
    prefix = env |> Enum.map(fn {k, v} -> "#{k}=#{shell_quote_env(v)}" end) |> Enum.join(" ")

    %{
      slug: contract.server_slug,
      source: Atom.to_string(contract.source),
      contract_id: contract.contract_id,
      revision: contract.revision,
      preferred_port: contract.preferred_port,
      allowed_ports: contract.allowed_ports,
      report_path: contract.report_path,
      port_env: contract.port_env,
      working_dir: Map.get(step_map, :working_dir),
      env: env,
      command: "#{prefix} #{command}",
      stop_command: Map.get(step_map, :stop_command)
    }
  end

  defp shell_quote_env(value) do
    "'" <> String.replace(to_string(value), "'", "'\"'\"'") <> "'"
  end

  defp do_start_instance_for_server(project, identifier, server_id, runtime_options) do
    with {:ok, slug} <- server_slug_for_id(project, identifier, server_id),
         {:ok, workspace_path} <- issue_workspace_path(identifier),
         {:ok, step} <- serve_step_for_slug(project.slug, identifier, slug),
         {:ok, reserved_steps} <-
           reserve_ports(
             project,
             identifier,
             [step],
             runtime_options.dev_server_port_range,
             runtime_options.dev_server_reclaim_ports?
           ),
         [{step, port, key}] <- reserved_steps do
      setup_issue_session(project.slug, identifier, workspace_path)

      case start_reserved_instance(project, identifier, workspace_path, step, port, key, runtime_options, %{}) do
        {:ok, {pid, _key}} -> {:ok, [pid]}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp do_stop_instance_for_server(project_slug, identifier, slug)
       when is_binary(project_slug) and is_binary(identifier) and is_binary(slug) do
    key = instance_key(project_slug, identifier, slug)

    case Registry.lookup(@registry, key) do
      [{pid, _}] -> stop_instance(pid)
      [] -> :ok
    end

    release_reservations([key])

    if registered_instance_pids(project_slug, identifier) == [] do
      release_issue_slot(project_slug, identifier)
    end

    :ok
  end

  defp server_slug_for_id(project, identifier, server_id) do
    case DevServerRecord.get_for_issue(project.id, identifier, server_id) do
      %DevServerRecord{slug: slug} when is_binary(slug) -> {:ok, slug}
      nil -> {:error, :not_found}
    end
  end

  defp serve_step_for_slug(project_slug, identifier, slug) do
    project_slug
    |> DevEnv.list_serve_steps()
    |> then(&unique_serve_steps(project_slug, identifier, &1))
    |> Enum.find(fn step -> Map.fetch!(step_to_map(step), :slug) == slug end)
    |> case do
      nil -> {:error, :no_serve_step}
      step -> {:ok, step}
    end
  end

  defp running_instance_pid(project_slug, identifier, slug) do
    case Registry.lookup(@registry, instance_key(project_slug, identifier, slug)) do
      [{pid, _}] when is_pid(pid) ->
        if Process.alive?(pid), do: {:ok, pid}, else: {:error, :not_running}

      [] ->
        {:error, :not_running}
    end
  end

  defp instance_key(project_slug, identifier, slug) do
    {project_slug, canonical_identifier(identifier), slug}
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

  defp reserve_ports(project, identifier, serve_steps, port_range, reclaim?) do
    ctx = allocation_context(project, identifier, port_range)
    owned = owned_ports(project.id, identifier)
    reserve_with_context(project.slug, identifier, serve_steps, ctx, owned, reclaim?)
  end

  # Ports each service of this issue was last assigned (from its DevServerRecord),
  # keyed by slug. Used so a restart reclaims a service's own canonical port even
  # when a long-lived resource it owns still holds it (see PortPlan.choose_port/4).
  defp owned_ports(project_id, identifier) do
    for record <- DevServerRecord.list_for_issue(project_id, identifier),
        is_binary(record.slug),
        is_integer(record.port),
        into: %{} do
      {record.slug, record.port}
    end
  end

  defp reserve_with_context(project_slug, identifier, serve_steps, ctx, owned_ports, reclaim?) do
    serve_steps
    |> Enum.with_index()
    |> Enum.reduce_while({:ok, []}, fn {step, offset}, {:ok, reserved_steps} ->
      slug = Map.fetch!(step, :slug)

      if reclaim? do
        reclaim_canonical_port(project_slug, identifier, slug, ctx, offset)
      end

      claimed = live_ports() ++ Enum.map(reserved_steps, fn {_step, port, _key} -> port end)

      case PortPlan.choose_port(ctx, offset, claimed, Map.get(owned_ports, slug)) do
        {:ok, port} ->
          key = {project_slug, identifier, slug}
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

  # Build + persist a managed RuntimeContract for each reserved serve step and
  # reserve every in-slot candidate port so no other issue/scan can grab a port
  # this service's serve script is authorized to switch to. Returns a
  # `%{slug => RuntimeContract}` map (empty when the contract flag is off).
  defp maybe_build_managed_contracts(project, identifier, workspace_path, serve_steps, reserved_steps, ctx, %{
         preview_runtime_contract_v1?: true
       }) do
    service_count = max(length(serve_steps), 1)
    canonical = canonical_identifier(identifier)

    Enum.reduce(reserved_steps, %{}, fn {step, port, key}, acc ->
      step_map = step_to_map(step)
      slug = Map.fetch!(step_map, :slug)
      offset = serve_offset(serve_steps, slug)
      allowed = contract_allowed_ports(ctx, offset, service_count, port)
      reserve_candidate_ports(key, allowed)

      case build_service_contract(project, canonical, workspace_path, step_map, port, allowed, :managed) do
        {:ok, contract} ->
          Map.put(acc, slug, contract)

        {:error, reason} ->
          Logger.warning(
            "preview runtime contract build failed slug=#{slug} issue=#{canonical} reason=#{inspect(reason)}"
          )

          acc
      end
    end)
  end

  defp maybe_build_managed_contracts(_project, _identifier, _workspace_path, _serve_steps, _reserved, _ctx, _opts),
    do: %{}

  defp contract_allowed_ports(ctx, offset, service_count, reserved_port) do
    Enum.uniq([reserved_port | PortPlan.candidate_ports(ctx, offset, service_count)])
  end

  defp serve_offset(serve_steps, slug) do
    Enum.find_index(serve_steps, fn step -> Map.fetch!(step_to_map(step), :slug) == slug end) || 0
  end

  defp build_service_contract(project, identifier, workspace_path, step_map, port, allowed_ports, source) do
    RuntimeContractStore.put(project, %{
      issue_identifier: identifier,
      server_slug: Map.fetch!(step_map, :slug),
      source: source,
      preferred_port: port,
      allowed_ports: allowed_ports,
      report_path: contract_report_path(workspace_path, step_map),
      ready_probe: Map.get(step_map, :ready_probe) || "tcp",
      ready_path: Map.get(step_map, :ready_path) || "/",
      url_path: Map.get(step_map, :url_path) || "/",
      port_env: contract_port_env(step_map)
    })
  end

  defp contract_port_env(step_map) do
    case Map.get(step_map, :port_env) do
      env when is_binary(env) and env != "" -> env
      _absent -> "PORT"
    end
  end

  defp contract_report_path(workspace_path, step_map) do
    serve_root =
      case normalized_working_dir(Map.get(step_map, :working_dir)) do
        nil -> workspace_path
        relative -> expand_working_dir(relative, workspace_path)
      end

    Path.join([serve_root, ".symphony", "preview-report.json"])
  end

  defp reserve_candidate_ports(key, ports) do
    Enum.each(ports, &reserve_candidate_port(key, &1))
  end

  defp reserve_candidate_port({project_slug, identifier, slug}, port) when is_integer(port) and port > 0 do
    with {:ok, table} <- reservation_table() do
      :ets.insert(table, {{project_slug, identifier, slug, {:candidate, port}}, port, nil})
    end

    :ok
  end

  defp reserve_candidate_port(_key, _port), do: :ok

  defp release_issue_candidate_reservations(project_slug, identifier) do
    reservation_entries()
    |> Enum.map(fn {key, _port, _pid} -> key end)
    |> Enum.filter(&candidate_key_for_issue?(&1, project_slug, identifier))
    |> release_reservations()
  end

  defp candidate_key_for_issue?(key, project_slug, identifier) do
    case key do
      {^project_slug, ^identifier, _slug, {:candidate, _port}} -> true
      _ -> false
    end
  end

  # Free a service's *canonical* port (deterministic from its band/slot/offset)
  # before reserving, so a restart reclaims the same port instead of drifting
  # onto the next free one. The canonical port belongs exclusively to this
  # project+issue+service slot by construction, so killing whatever lingers on
  # it is safe. We never touch a port currently served by a healthy, tracked
  # Symphony instance for the same key (that is a legitimate reuse, not a leak).
  defp reclaim_canonical_port(project_slug, identifier, slug, ctx, offset) do
    case canonical_port(ctx, offset) do
      nil ->
        :ok

      port ->
        if port_held_by_tracked_instance?(project_slug, identifier, slug, port) do
          :ok
        else
          case PortReclaimer.reclaim(port) do
            :ok ->
              :ok

            {:error, :still_bound} ->
              Logger.warning(
                "[port-reclaim] could not free canonical port #{port} for " <>
                  "#{project_slug}/#{identifier}/#{slug}; falling back to drift"
              )

              :ok
          end
        end
    end
  end

  defp canonical_port(%{slot_index: nil}, _offset), do: nil

  defp canonical_port(%{slot_index: slot_index, ports_per_slot: ports_per_slot, band: {band_start, _}}, offset) do
    case PortPlan.port(band_start, slot_index, offset, ports_per_slot) do
      {:ok, port} -> port
      {:error, _reason} -> nil
    end
  end

  defp canonical_port(_ctx, _offset), do: nil

  defp port_held_by_tracked_instance?(project_slug, identifier, slug, port) do
    case running_instance_pid(project_slug, identifier, slug) do
      {:ok, pid} -> port in instance_port(pid)
      _ -> false
    end
  end

  defp allocation_context(project, identifier, port_range) do
    pool = preview_pool_config()

    case pinned_band(port_range, pool.ports_per_slot) do
      {:ok, band_start, band_end, slots} ->
        slot_index = lease_slot(project.id, identifier, slots)

        %{
          band: {band_start, band_end},
          slot_index: slot_index,
          ports_per_slot: pool.ports_per_slot,
          pool_range: pool.pool_range,
          auto?: false
        }

      :auto ->
        auto_context(project, identifier, pool)
    end
  end

  defp auto_context(project, identifier, pool) do
    band_size = PortPlan.band_size(pool.slots_per_project, pool.ports_per_slot)
    max_bands = PortPlan.max_bands(pool.pool_range, band_size)

    case LeaseStore.ensure_band(project.id, max_bands) do
      {:ok, band_index} ->
        band_start = PortPlan.band_start(pool.pool_range, band_index, band_size)
        slot_index = lease_slot(project.id, identifier, pool.slots_per_project)

        %{
          band: {band_start, band_start + band_size - 1},
          slot_index: slot_index,
          ports_per_slot: pool.ports_per_slot,
          pool_range: pool.pool_range,
          auto?: true
        }

      {:error, :no_free_band} ->
        Logger.warning("Dev server preview bands exhausted; scanning pool project=#{project.slug}")
        [pool_min, pool_max] = pool.pool_range

        %{
          band: {pool_min, pool_max},
          slot_index: nil,
          ports_per_slot: pool.ports_per_slot,
          pool_range: pool.pool_range,
          auto?: true
        }
    end
  end

  defp pinned_band(port_range, ports_per_slot) do
    case port_range do
      [a, b] when is_integer(a) and is_integer(b) and a > 0 and b > 0 ->
        band_min = min(a, b)
        band_max = max(a, b)
        slots = div(band_max - band_min + 1, ports_per_slot)
        {:ok, band_min, band_max, slots}

      _auto ->
        :auto
    end
  end

  defp lease_slot(project_id, identifier, slots) do
    case LeaseStore.ensure_slot(project_id, identifier, slots) do
      {:ok, slot_index} ->
        slot_index

      {:error, :no_free_slot} ->
        Logger.warning("Dev server preview slots exhausted; scanning band project_id=#{project_id} issue=#{identifier}")

        nil
    end
  end

  defp preview_pool_config do
    %{
      pool_range: Config.preview_pool_range(),
      slots_per_project: Config.preview_slots_per_project(),
      ports_per_slot: Config.preview_ports_per_slot()
    }
  end

  defp setup_issue_session(project_slug, identifier, workspace_path) do
    serve_working_dirs =
      project_slug
      |> DevEnv.list_serve_steps()
      |> Enum.map(&normalized_working_dir(&1.working_dir))
      |> MapSet.new()

    setup_steps =
      project_slug
      |> DevEnv.list_steps()
      |> Enum.filter(fn step ->
        step.role == "setup" and not MapSet.member?(serve_working_dirs, normalized_working_dir(step.working_dir))
      end)

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

  defp start_instances(project, identifier, workspace_path, reserved_steps, runtime_options, contracts) do
    attempt_keys = Enum.map(reserved_steps, fn {_step, _port, key} -> key end)

    reserved_steps
    |> Enum.reduce_while({:ok, []}, fn {step, port, key}, {:ok, started} ->
      case start_reserved_instance(project, identifier, workspace_path, step, port, key, runtime_options, contracts) do
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

  defp start_reserved_instance(project, identifier, workspace_path, step, port, key, runtime_options, contracts) do
    slug = Map.fetch!(step, :slug)
    project_slug = project.slug
    step_map = step_to_map(step)

    ready_timeout_ms = ready_timeout_ms(runtime_options)

    case running_instance_pid(project_slug, identifier, slug) do
      {:ok, pid} ->
        reuse_or_replace_instance(
          pid,
          project_slug,
          identifier,
          port,
          step_map,
          key,
          ready_timeout_ms,
          fn ->
            start_fresh_instance(project, identifier, workspace_path, step, port, key, runtime_options, contracts)
          end
        )

      {:error, :not_running} ->
        start_fresh_instance(project, identifier, workspace_path, step, port, key, runtime_options, contracts)
    end
  end

  defp reuse_or_replace_instance(pid, project_slug, identifier, port, step, key, ready_timeout_ms, start_fresh) do
    slug = Map.fetch!(step, :slug)

    case safe_instance_status(pid) do
      :ready ->
        if port_ready?(port, step) do
          {:ok, {pid, key}}
        else
          with :ok <- do_stop_instance_for_server(project_slug, identifier, slug) do
            start_fresh.()
          end
        end

      status when status in [:starting, :provisioning] ->
        await_reserved_instance_boot(pid, key, ready_timeout_ms)

      _ ->
        with :ok <- do_stop_instance_for_server(project_slug, identifier, slug) do
          start_fresh.()
        end
    end
  end

  defp start_fresh_instance(project, identifier, workspace_path, step, port, key, runtime_options, contracts) do
    case start_instance(project, identifier, workspace_path, step, port, key, runtime_options, contracts) do
      {:ok, pid} -> await_reserved_instance_boot(pid, key, ready_timeout_ms(runtime_options))
      {:error, reason} -> {:error, reason}
    end
  end

  defp await_reserved_instance_boot(pid, key, ready_timeout_ms) do
    case await_instance_ready(pid, ready_timeout_ms) do
      :ok ->
        {:ok, {pid, key}}

      {:error, :crashed} ->
        stop_instance(pid)
        {:error, :crashed}

      :timeout ->
        Logger.warning("Dev server instance not ready within #{ready_timeout_ms}ms; proceeding slug=#{inspect(key)}")
        {:ok, {pid, key}}
    end
  end

  defp await_instance_ready(pid, ready_timeout_ms) when is_pid(pid) and is_integer(ready_timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + ready_timeout_ms
    await_instance_ready_loop(pid, deadline)
  end

  defp await_instance_ready_loop(pid, deadline) when is_pid(pid) do
    case safe_instance_status(pid) do
      :ready ->
        :ok

      :crashed ->
        {:error, :crashed}

      :stopped ->
        {:error, :crashed}

      _status ->
        if System.monotonic_time(:millisecond) >= deadline do
          :timeout
        else
          Process.sleep(@prior_instance_ready_poll_ms)
          await_instance_ready_loop(pid, deadline)
        end
    end
  end

  defp ready_timeout_ms(%{ready_timeout_ms: ms}) when is_integer(ms) and ms >= 0, do: ms
  defp ready_timeout_ms(_runtime_options), do: @prior_instance_ready_timeout_ms

  defp safe_instance_status(pid) do
    Instance.status(pid)
  catch
    # A live process whose status call timed out (e.g. busy probing during a
    # sequential boot) must NOT be treated as stopped — only a dead process is.
    :exit, _reason -> if Process.alive?(pid), do: :starting, else: :stopped
  end

  defp start_instance(project, identifier, workspace_path, step, port, key, runtime_options, contracts) do
    step = serve_step_with_setup(project.slug, step)
    slug = Map.fetch!(step_to_map(step), :slug)

    opts =
      [
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
        contract: Map.get(contracts, slug),
        port_allocator: fn _range, _claimed_ports -> {:ok, port} end
      ] ++ serve_probe_opts(project.slug, step)

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
      :stop_command,
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
      {{^project_slug, ^identifier, _slug, {:candidate, _port}}, _port2, _pid} -> true
      _entry -> false
    end)
    |> Enum.map(fn {key, _port, _pid} -> key end)
  end

  defp release_issue_slot(project_slug, identifier) do
    case Context.get_project(project_slug) do
      {:ok, project} -> LeaseStore.release_slot(project.id, identifier)
      {:error, _reason} -> :ok
    end
  end

  defp delete_issue_contracts(project_slug, identifier) do
    case Context.get_project(project_slug) do
      {:ok, project} -> RuntimeContractStore.delete_for_issue(project.id, identifier)
      {:error, _reason} -> :ok
    end
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

  defp reconcile_record_status(%DevServerRecord{} = record, project, project_slug, identifier) do
    record
    |> reconcile_live_instance_state(project, project_slug, identifier)
    |> reconcile_port_truth(project, project_slug, identifier)
  end

  defp reconcile_live_instance_state(record, project, project_slug, identifier) do
    case running_instance_pid(project_slug, identifier, record.slug) do
      {:ok, pid} ->
        reconcile_with_live_instance(record, project, project_slug, identifier, pid)

      {:error, :not_running} ->
        reconcile_without_live_instance(record, project, project_slug, identifier)
    end
  end

  defp reconcile_port_truth(record, project, project_slug, identifier) do
    step = serve_step_map(project_slug, identifier, record.slug)

    if record.status == "ready" and not port_ready?(record.port, step) do
      persist_reconciled_status(record, project, project_slug, identifier, "crashed")
    else
      record
    end
  end

  # A live, registered instance whose port is actually serving is "ready" — even
  # if a transient status call timed out. Treat the listening port as the source
  # of truth so the periodic reconciler never stamps a serving instance "stopped",
  # and so a record left stale (e.g. by an earlier transient blip) self-heals
  # back to "ready".
  defp reconcile_with_live_instance(record, project, project_slug, identifier, pid) do
    step = serve_step_map(project_slug, identifier, record.slug)

    if port_ready?(record.port, step) do
      persist_reconciled_status(record, project, project_slug, identifier, "ready")
    else
      case safe_instance_status(pid) do
        status when status in [:crashed, :stopped] ->
          persist_reconciled_status(record, project, project_slug, identifier, Atom.to_string(status))

        _ ->
          record
      end
    end
  end

  defp reconcile_without_live_instance(record, project, project_slug, identifier) do
    step = serve_step_map(project_slug, identifier, record.slug)

    if record.status in @tracked_live_statuses do
      reconcile_stale_active_record(record, project, project_slug, identifier, step)
    else
      record
    end
  end

  defp reconcile_stale_active_record(record, project, project_slug, identifier, _step) do
    persist_reconciled_status(record, project, project_slug, identifier, "crashed")
  end

  defp serve_step_map(project_slug, identifier, slug) do
    case serve_step_for_slug(project_slug, identifier, slug) do
      {:ok, step} -> step_to_map(step)
      {:error, _reason} -> %{ready_probe: "tcp", ready_path: "/"}
    end
  end

  defp port_ready?(port, step) when is_integer(port) and port > 0 do
    ready_probe = Map.get(step, :ready_probe) || Map.get(step, "ready_probe") || "tcp"
    ready_path = Map.get(step, :ready_path) || Map.get(step, "ready_path") || "/"
    probe_port(@probe_loopback_host, port, ready_probe, ready_path) == :ok
  end

  defp port_ready?(_port, _step), do: false

  defp probe_port(host, port, "http", ready_path) do
    url = "http://#{host}:#{port}#{normalize_probe_path(ready_path)}"

    case Req.get(url, retry: false, receive_timeout: @probe_connect_timeout_ms) do
      {:ok, %{status: status}} when status in 200..499 -> :ok
      {:ok, %{status: status}} -> {:error, {:http_status, status}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp probe_port(host, port, _ready_probe, _ready_path) do
    case :gen_tcp.connect(String.to_charlist(host), port, [:binary, active: false], @probe_connect_timeout_ms) do
      {:ok, socket} ->
        :gen_tcp.close(socket)
        :ok

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp normalize_probe_path(path) when is_binary(path) do
    case String.trim(path) do
      "" -> "/"
      "/" <> _rest = normalized -> normalized
      normalized -> "/" <> normalized
    end
  end

  defp persist_reconciled_status(record, project, project_slug, identifier, status)
       when is_binary(status) do
    if record.status == status do
      record
    else
      case DevServerRecord.upsert(project.id, identifier, record.slug, %{status: status}) do
        {:ok, updated} ->
          Broadcaster.notify(project_slug, identifier)
          updated

        {:error, reason} ->
          Logger.warning("dev server status reconciliation failed slug=#{record.slug} issue=#{identifier} reason=#{inspect(reason)}")

          record
      end
    end
  end

  defp ensure_serve_records(project, project_slug, identifier) do
    configured = DevEnv.list_serve_steps(project_slug)
    serve_steps = unique_serve_steps(project_slug, identifier, configured)

    existing_slugs =
      project.id
      |> DevServerRecord.list_for_issue(identifier)
      |> MapSet.new(& &1.slug)

    Enum.each(serve_steps, fn step ->
      slug = Map.fetch!(step, :slug)

      unless MapSet.member?(existing_slugs, slug) do
        case DevServerRecord.upsert(project.id, identifier, slug, %{
               working_dir: Map.get(step, :working_dir),
               status: "stopped",
               primary: Map.get(step, :primary, false)
             }) do
          {:ok, _record} ->
            :ok

          {:error, reason} ->
            Logger.warning("dev server placeholder upsert failed slug=#{slug} issue=#{identifier} reason=#{inspect(reason)}")
        end
      end
    end)
  end

  @doc false
  @spec project_public_tunnel_enabled?(String.t()) :: boolean()
  def project_public_tunnel_enabled?(project_slug) when is_binary(project_slug) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        project
        |> project_runtime_options()
        |> Map.get(:public_tunnel, [])
        |> Keyword.get(:enabled) == true

      {:error, _} ->
        false
    end
  end

  defp project_runtime_options(project) do
    opts =
      project
      |> project_workflow_config()
      |> Config.validate_front_matter()

    %{
      dev_server_enabled?: get_in(opts, [:dev_server, :enabled]) == true,
      dev_server_reclaim_ports?: get_in(opts, [:dev_server, :reclaim_ports]) == true,
      preview_runtime_contract_v1?: preview_runtime_contract_v1?(opts),
      dev_server_port_range: get_in(opts, [:dev_server, :port_range]),
      dev_server_base_url: normalize_base_url(get_in(opts, [:dev_server, :base_url])),
      dev_server_idle_timeout_ms: get_in(opts, [:dev_server, :idle_timeout_ms]),
      ready_timeout_ms: @prior_instance_ready_timeout_ms,
      public_tunnel: [
        enabled: get_in(opts, [:public_tunnel, :enabled]),
        base_domain: get_in(opts, [:public_tunnel, :base_domain]),
        namespace: get_in(opts, [:public_tunnel, :namespace])
      ]
    }
  end

  # The versioned preview runtime contract is opt-in per project (workflow
  # front matter) and can be forced globally for tests/dev via application env.
  # When off, allocation and instance lifecycle behave exactly as before.
  defp preview_runtime_contract_v1?(opts) do
    get_in(opts, [:dev_server, :runtime_contract_v1]) == true or
      Application.get_env(:symphony_elixir, :preview_runtime_contract_v1, false) == true
  end

  # Callers (such as the `manage_preview` agent tool) can shorten the synchronous
  # wait for instance readiness so a slow/crashing dev server cannot block the
  # turn for minutes. The instance keeps booting asynchronously regardless; the
  # caller just stops *waiting* and reports the in-flight status instead.
  defp apply_runtime_overrides(runtime_options, opts) do
    case Keyword.get(opts, :ready_timeout_ms) do
      ms when is_integer(ms) and ms >= 0 -> Map.put(runtime_options, :ready_timeout_ms, ms)
      _ -> runtime_options
    end
  end

  defp project_workflow_config(project) do
    case Context.get_project_setup(project.slug) do
      %ProjectSetup{workflow_markdown: md} when is_binary(md) and md != "" ->
        case SymphonyElixir.Workflow.parse_string(md) do
          {:ok, %{config: %{} = config}} -> config
          _ -> %{}
        end

      _setup ->
        %{}
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

  @doc false
  @spec serve_step_with_setup(String.t(), map()) :: map()
  def serve_step_with_setup(project_slug, step) when is_binary(project_slug) and is_map(step) do
    step = step_to_map(step)

    case setup_commands_for_working_dir(project_slug, Map.get(step, :working_dir)) do
      [] ->
        step

      setup_commands ->
        command =
          (setup_commands ++ [Map.fetch!(step, :command)])
          |> Enum.map(&String.trim/1)
          |> Enum.reject(&(&1 == ""))
          |> Enum.join(" && ")

        Map.put(step, :command, wrap_shell_serve_command(command))
    end
  end

  defp wrap_shell_serve_command(command) when is_binary(command) do
    inner = ~s(export PATH="$PWD/node_modules/.bin:$PATH" && #{command})
    "bash -lc #{shell_quote(inner)}"
  end

  defp setup_commands_for_working_dir(project_slug, working_dir) do
    wd = normalized_working_dir(working_dir)

    project_slug
    |> DevEnv.list_steps()
    |> Enum.filter(fn step -> step.role == "setup" and normalized_working_dir(step.working_dir) == wd end)
    |> Enum.sort_by(& &1.position)
    |> Enum.map(fn step -> String.trim(step.command) end)
    |> Enum.reject(&(&1 == ""))
  end

  defp serve_probe_opts(project_slug, step) do
    if setup_commands_for_working_dir(project_slug, Map.get(step, :working_dir)) == [] do
      []
    else
      [
        max_probe_attempts: @serve_with_setup_max_probe_attempts,
        probe_interval_ms: @serve_with_setup_probe_interval_ms
      ]
    end
  end

  defp step_to_map(%_struct{} = step), do: Map.from_struct(step)
  defp step_to_map(step) when is_map(step), do: step
  defp step_to_map(_step), do: %{}

  defp canonical_identifier(identifier) when is_binary(identifier) do
    String.trim_leading(identifier, "#")
  end

  defp normalize_dev_session_capture({:ok, output}, session_name) do
    {:ok, %{output: output, session_name: session_name}}
  end

  # A missing tmux pane just means the server is not running (e.g. it crashed,
  # idled out, or the daemon restarted). Surface an empty buffer instead of
  # leaking the raw tmux error to the preview UI.
  defp normalize_dev_session_capture({:error, message}, session_name) when is_binary(message) do
    if missing_dev_session?(message) do
      {:ok, %{output: "", session_name: session_name}}
    else
      {:error, message}
    end
  end

  @missing_session_markers [
    "can't find pane",
    "can't find session",
    "no server running",
    "session not found"
  ]

  defp missing_dev_session?(message) when is_binary(message) do
    normalized = String.downcase(message)
    Enum.any?(@missing_session_markers, &String.contains?(normalized, &1))
  end

  defp missing_dev_session?(_message), do: false

  defp mark_all_stopped_safely do
    DevServerRecord.mark_all_stopped()
    :ok
  rescue
    error ->
      Logger.warning("Dev server startup status reconciliation failed reason=#{inspect(error)}")
      :ok
  end
end
