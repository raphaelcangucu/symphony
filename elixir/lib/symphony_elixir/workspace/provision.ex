defmodule SymphonyElixir.Workspace.Provision do
  @moduledoc """
  Atomically creates a workspace without exposing partially prepared contents.

  One process owns a normalized workspace path at a time. New contents are
  prepared in a same-parent reserved container, validated, marked ready, and
  published with a no-clobber filesystem move. Concurrent callers join the
  active flight and receive its result.

  Reentry from the flight worker itself is rejected explicitly. A callback
  that spawns another process and then synchronously waits for that process to
  ensure the same path creates an external dependency cycle and is unsupported.

  The `after_create` command intentionally has no timeout: provisioning waits
  until the command exits with success or a real error. Configured workspace
  hook timeouts remain limited to the separate lifecycle hooks.
  """

  require Logger

  alias SymphonyElixir.WorkspaceSkills

  @after_create_hook_name "after_create"
  @attempt_marker ".ownership-token"
  @container_name ".symphony-provisioning"
  @default_log_context "issue_id=n/a issue_identifier=issue"
  @git_validation_commands [
    {:rev_parse, ["rev-parse", "--is-inside-work-tree"]},
    {:index, ["ls-files", "--stage"]},
    {:status, ["status", "--porcelain=v1"]}
  ]
  @max_staging_name_attempts 8
  @ownership_marker Path.join([".symphony", "provisioning-owner"])
  @payload_name "workspace"
  @readiness_marker Path.join([".symphony", "ready"])
  @worker_paths_key {__MODULE__, :worker_paths}

  @type stage ::
          :validate_input
          | :lock
          | :inspect_final
          | :create_staging
          | :after_create
          | :claim_staging
          | :prepare_skills
          | :validate
          | :write_readiness
          | :publish

  @type validator :: (Path.t() -> :ok | {:error, term()})
  @type publish_runner ::
          (String.t(), [String.t()], keyword() -> {String.t(), non_neg_integer()})
  @type container_mkdir :: (Path.t() -> :ok | {:error, File.posix()})

  @type option ::
          {:after_create, String.t() | nil}
          | {:log_context, String.t()}
          | {:validator, validator()}
          | {:publish_runner, publish_runner()}
          | {:container_mkdir, container_mkdir()}

  @type options :: [option()]
  @type filesystem_identity :: {non_neg_integer(), non_neg_integer(), non_neg_integer()}
  @type attempt :: %{
          root: Path.t(),
          staging: Path.t(),
          container: Path.t(),
          token: String.t(),
          root_identity: filesystem_identity(),
          staging_identity: filesystem_identity(),
          move_runner: publish_runner()
        }

  defmodule Error do
    @moduledoc false

    @enforce_keys [:workspace, :stage, :reason, :retryable]
    defstruct [:workspace, :staging, :stage, :reason, :cleanup_error, :retryable]

    @type t :: %__MODULE__{
            workspace: term(),
            staging: Path.t() | nil,
            stage: SymphonyElixir.Workspace.Provision.stage(),
            reason: term(),
            cleanup_error: term() | nil,
            retryable: boolean()
          }
  end

  defmodule AtomicMover do
    @moduledoc false

    @move_arguments ["--no-clobber", "--no-target-directory"]

    @spec ensure_supported(SymphonyElixir.Workspace.Provision.publish_runner()) ::
            :ok | {:error, term()}
    def ensure_supported(runner) when is_function(runner, 3) do
      case runner.("mv", ["--version"], stderr_to_stdout: true) do
        {output, 0} ->
          trimmed_output = String.trim(output)

          if String.contains?(trimmed_output, "GNU coreutils") do
            :ok
          else
            {:error, {:atomic_move_unsupported, "mv", trimmed_output}}
          end

        {output, _status} ->
          {:error, {:atomic_move_unsupported, "mv", String.trim(output)}}

        result ->
          {:error, {:atomic_move_unsupported, "mv", inspect(result)}}
      end
    rescue
      exception ->
        {:error, {:atomic_move_unsupported, "mv", Exception.message(exception)}}
    end

    @spec move(
            Path.t(),
            Path.t(),
            SymphonyElixir.Workspace.Provision.publish_runner()
          ) :: :ok | {:error, term()}
    def move(source, destination, runner)
        when is_binary(source) and is_binary(destination) and is_function(runner, 3) do
      with :ok <- ensure_supported(runner) do
        arguments = @move_arguments ++ [source, destination]

        case runner.("mv", arguments, stderr_to_stdout: true) do
          {output, 0} -> verify_move_result(source, destination, output)
          {output, status} -> {:error, {:move_command_failed, status, String.trim_trailing(output)}}
          result -> {:error, {:unexpected_move_result, result}}
        end
      end
    end

    defp verify_move_result(source, destination, output) do
      case File.lstat(source) do
        {:error, :enoent} ->
          case File.lstat(destination) do
            {:ok, _stat} -> :ok
            {:error, reason} -> {:error, {:move_destination_unavailable, destination, reason}}
          end

        {:ok, _stat} ->
          {:error, {:move_no_clobber, destination, :source_remains, String.trim_trailing(output)}}

        {:error, reason} ->
          {:error, {:move_source_unreadable, source, reason}}
      end
    end
  end

  defmodule FlightRegistry do
    @moduledoc false

    use GenServer

    alias SymphonyElixir.Workspace.Provision
    alias SymphonyElixir.Workspace.Provision.Error

    @type flight_event ::
            {:attempt, Provision.attempt()} | {:stage, SymphonyElixir.Workspace.Provision.stage()}
    @type flight_reporter :: (flight_event() -> :ok)
    @type operation :: (flight_reporter() -> {:ok, Path.t()} | {:error, Error.t()})

    @spec start_link(keyword()) :: GenServer.on_start()
    def start_link(opts \\ []) do
      GenServer.start_link(__MODULE__, :ok, Keyword.put(opts, :name, __MODULE__))
    end

    @spec join(Path.t(), operation()) :: {:ok, Path.t()} | {:error, Error.t()}
    def join(workspace, operation) when is_binary(workspace) and is_function(operation, 1) do
      GenServer.call(__MODULE__, {:join, workspace, operation}, :infinity)
    end

    @impl true
    def init(:ok) do
      {:ok, %{flights: %{}, monitors: %{}, cleanups: %{}}}
    end

    @impl true
    def handle_call({:join, workspace, operation}, from, state) do
      case Map.get(state.flights, workspace) do
        nil ->
          start_flight(workspace, operation, from, state)

        flight ->
          updated_flight = %{flight | waiters: [from | flight.waiters]}
          {:noreply, put_in(state, [:flights, workspace], updated_flight)}
      end
    end

    @impl true
    def handle_call({:register_event, workspace, worker, event}, _from, state) do
      case Map.get(state.flights, workspace) do
        %{worker: ^worker} = flight ->
          updated_flight = apply_flight_event(flight, event)
          {:reply, :ok, put_in(state, [:flights, workspace], updated_flight)}

        _other ->
          {:reply, {:error, :flight_not_found}, state}
      end
    end

    defp apply_flight_event(flight, {:attempt, attempt}), do: %{flight | attempt: attempt}
    defp apply_flight_event(flight, {:stage, stage}), do: %{flight | stage: stage}

    @impl true
    def handle_info({reference, result}, state) when is_reference(reference) do
      cond do
        workspace = Map.get(state.monitors, reference) ->
          complete_worker(state, workspace, reference, result)

        cleanup = Map.get(state.cleanups, reference) ->
          complete_cleanup(state, cleanup, reference, result)

        true ->
          {:noreply, state}
      end
    end

    @impl true
    def handle_info({:DOWN, monitor, :process, worker, reason}, state) do
      cond do
        workspace = Map.get(state.monitors, monitor) ->
          start_worker_down_reconciliation(state, workspace, worker, monitor, reason)

        cleanup = Map.get(state.cleanups, monitor) ->
          cleanup_task_down(state, cleanup, monitor, reason)

        true ->
          {:noreply, state}
      end
    end

    defp start_flight(workspace, operation, from, state) do
      registry = self()

      task =
        Task.Supervisor.async_nolink(SymphonyElixir.TaskSupervisor, fn ->
          reporter = fn event ->
            GenServer.call(
              registry,
              {:register_event, workspace, self(), event},
              :infinity
            )
          end

          operation.(reporter)
        end)

      flight = %{
        worker: task.pid,
        monitor: task.ref,
        waiters: [from],
        attempt: nil,
        stage: :lock,
        cleanup_ref: nil,
        worker_down_reason: nil
      }

      next_state = %{
        flights: Map.put(state.flights, workspace, flight),
        monitors: Map.put(state.monitors, task.ref, workspace),
        cleanups: state.cleanups
      }

      {:noreply, next_state}
    end

    defp complete_worker(state, workspace, reference, result) do
      case Map.get(state.flights, workspace) do
        %{monitor: ^reference} = flight ->
          Process.demonitor(reference, [:flush])
          reply_waiters(flight.waiters, result)
          {:noreply, remove_flight(state, workspace)}

        _other ->
          {:noreply, %{state | monitors: Map.delete(state.monitors, reference)}}
      end
    end

    defp start_worker_down_reconciliation(state, workspace, worker, monitor, reason) do
      case Map.get(state.flights, workspace) do
        %{worker: ^worker, monitor: ^monitor} = flight ->
          cleanup_task =
            Task.Supervisor.async_nolink(SymphonyElixir.TaskSupervisor, fn ->
              Provision.reconcile_worker_down(workspace, flight.attempt)
            end)

          updated_flight = %{
            flight
            | worker: nil,
              monitor: nil,
              cleanup_ref: cleanup_task.ref,
              worker_down_reason: reason
          }

          next_state = %{
            flights: Map.put(state.flights, workspace, updated_flight),
            monitors: Map.delete(state.monitors, monitor),
            cleanups:
              Map.put(state.cleanups, cleanup_task.ref, %{
                workspace: workspace,
                worker_reason: reason
              })
          }

          {:noreply, next_state}

        _other ->
          {:noreply, %{state | monitors: Map.delete(state.monitors, monitor)}}
      end
    end

    defp complete_cleanup(state, cleanup, reference, reconciliation) do
      case Map.get(state.flights, cleanup.workspace) do
        %{cleanup_ref: ^reference} = flight ->
          Process.demonitor(reference, [:flush])
          result = reconciliation_result(cleanup.workspace, flight, reconciliation)
          reply_waiters(flight.waiters, result)
          {:noreply, remove_flight(state, cleanup.workspace)}

        _other ->
          {:noreply, %{state | cleanups: Map.delete(state.cleanups, reference)}}
      end
    end

    defp cleanup_task_down(state, cleanup, reference, reason) do
      case Map.get(state.flights, cleanup.workspace) do
        %{cleanup_ref: ^reference} = flight ->
          result =
            worker_down_error(
              cleanup.workspace,
              flight,
              cleanup.worker_reason,
              {:worker_down_cleanup_failed, reason}
            )

          reply_waiters(flight.waiters, result)
          {:noreply, remove_flight(state, cleanup.workspace)}

        _other ->
          {:noreply, %{state | cleanups: Map.delete(state.cleanups, reference)}}
      end
    end

    defp reconciliation_result(_workspace, _flight, {:completed, result}), do: result

    defp reconciliation_result(workspace, flight, {:incomplete, cleanup_error}) do
      worker_down_error(workspace, flight, flight.worker_down_reason, cleanup_error)
    end

    defp reconciliation_result(workspace, flight, result) do
      worker_down_error(
        workspace,
        flight,
        flight.worker_down_reason,
        {:unexpected_reconciliation_result, result}
      )
    end

    defp worker_down_error(workspace, flight, reason, cleanup_error) do
      {:error,
       %Error{
         workspace: workspace,
         staging: attempt_root(flight.attempt),
         stage: flight.stage,
         reason: {:workspace_provision_worker_down, workspace, reason},
         cleanup_error: cleanup_error,
         retryable: true
       }}
    end

    defp attempt_root(nil), do: nil
    defp attempt_root(attempt), do: attempt.root

    defp reply_waiters(waiters, result) do
      Enum.each(waiters, &GenServer.reply(&1, result))
    end

    defp remove_flight(state, workspace) do
      flight = Map.get(state.flights, workspace, %{})

      %{
        flights: Map.delete(state.flights, workspace),
        monitors: Map.delete(state.monitors, Map.get(flight, :monitor)),
        cleanups: Map.delete(state.cleanups, Map.get(flight, :cleanup_ref))
      }
    end
  end

  @doc false
  @spec cleanup_abandoned_attempt(attempt()) :: nil | term()
  def cleanup_abandoned_attempt(attempt) when is_map(attempt) do
    quarantine_and_delete_attempt(attempt, false, :if_present)
  rescue
    exception ->
      {:abandoned_attempt_cleanup_failed, Map.get(attempt, :root), {:exception, exception}}
  catch
    kind, reason ->
      {:abandoned_attempt_cleanup_failed, Map.get(attempt, :root), {kind, reason}}
  end

  @doc false
  @spec reconcile_worker_down(Path.t(), attempt() | nil) ::
          {:completed, {:ok, Path.t()}} | {:incomplete, term()}
  def reconcile_worker_down(_workspace, nil), do: {:incomplete, nil}

  def reconcile_worker_down(workspace, attempt) do
    case verify_ready_final(workspace, attempt.token) do
      :ok ->
        cleanup_error = quarantine_and_delete_attempt(attempt, true, false)
        log_reconciled_cleanup_error(attempt, cleanup_error)
        {:completed, {:ok, workspace}}

      {:error, _reason} ->
        {:incomplete, cleanup_abandoned_attempt(attempt)}
    end
  rescue
    exception ->
      {:incomplete, {:worker_down_reconciliation_failed, Map.get(attempt, :root), {:exception, exception}}}
  catch
    kind, reason ->
      {:incomplete, {:worker_down_reconciliation_failed, Map.get(attempt, :root), {kind, reason}}}
  end

  defp log_reconciled_cleanup_error(_attempt, nil), do: :ok

  defp log_reconciled_cleanup_error(attempt, cleanup_error) do
    Logger.warning(
      "Reconciled published workspace wrapper cleanup failed staging=#{attempt.root} " <>
        "cleanup_error=#{inspect(cleanup_error)}"
    )
  end

  @type classified_error ::
          {:workspace_provision_incomplete, Error.t()} | {:workspace_provision_failed, term()}

  @doc """
  Classifies a provisioning failure for callers that need to distinguish a
  workspace left incomplete by a previous attempt (safe and expected to
  retry) from any other provisioning failure.

  Accepts both the `Error.t()` this module returns and any other term a
  caller further up the stack (e.g. `Workspace.ensure_at/2`'s rescued
  exceptions or path-validation tuples) may have wrapped it in, so error
  mapping stays consistent regardless of where in the stack it is applied.
  """
  @spec classify_error(term()) :: classified_error()
  def classify_error(%Error{reason: {:workspace_incomplete, _workspace, _verification_error, _rollback}} = error),
    do: {:workspace_provision_incomplete, error}

  def classify_error(%Error{} = error), do: {:workspace_provision_failed, error}
  def classify_error(reason), do: {:workspace_provision_failed, reason}

  @doc """
  The reserved basename of the same-parent staging container.

  Never a valid workspace path (see `ensure/2`); callers that enumerate a
  workspace root (e.g. the working-tree inventory) use this to skip it.
  """
  @spec reserved_container_name() :: String.t()
  def reserved_container_name, do: @container_name

  @doc """
  Ensures `workspace` exists, provisioning it atomically when it is absent.

  Directories without Symphony ownership metadata are legacy workspaces and
  remain untouched. Owned directories must also carry matching readiness
  metadata; otherwise they are quarantined as incomplete.
  """
  @spec ensure(Path.t(), options()) :: {:ok, Path.t()} | {:error, Error.t()}
  def ensure(workspace, options) when is_binary(workspace) and is_list(options) do
    with :ok <- validate_workspace(workspace),
         {:ok, settings} <- validate_options(options),
         {:ok, normalized_workspace} <- normalize_workspace(workspace),
         :ok <- validate_workspace_basename(normalized_workspace) do
      join_flight(normalized_workspace, settings)
    else
      {:error, reason} -> error(workspace, :validate_input, reason, false)
    end
  end

  def ensure(workspace, options) do
    error(
      workspace,
      :validate_input,
      {:invalid_arguments, %{workspace: workspace, options: options}},
      false
    )
  end

  defp validate_workspace(""), do: {:error, {:invalid_workspace_path, :empty}}

  defp validate_workspace(workspace) do
    cond do
      not String.valid?(workspace) ->
        {:error, {:invalid_workspace_path, :invalid_utf8}}

      String.contains?(workspace, <<0>>) ->
        {:error, {:invalid_workspace_path, :null_byte}}

      true ->
        :ok
    end
  end

  defp validate_options(options) do
    if Keyword.keyword?(options) do
      validate_keyword_options(options)
    else
      {:error, {:invalid_provision_options, options}}
    end
  end

  defp validate_keyword_options(options) do
    allowed_options = [
      :after_create,
      :log_context,
      :validator,
      :publish_runner,
      :container_mkdir
    ]

    unknown_options = Keyword.keys(options) -- allowed_options

    if unknown_options == [] do
      with {:ok, after_create} <- validate_after_create(Keyword.get(options, :after_create)),
           {:ok, log_context} <- validate_log_context(Keyword.get(options, :log_context)),
           {:ok, validator} <-
             validate_validator(Keyword.get(options, :validator, &validate_staging/1)),
           {:ok, publish_runner} <-
             validate_publish_runner(Keyword.get(options, :publish_runner, &System.cmd/3)),
           {:ok, container_mkdir} <-
             validate_container_mkdir(Keyword.get(options, :container_mkdir, &File.mkdir/1)) do
        {:ok,
         %{
           after_create: after_create,
           log_context: log_context,
           validator: validator,
           publish_runner: publish_runner,
           container_mkdir: container_mkdir
         }}
      end
    else
      {:error, {:unknown_provision_options, unknown_options}}
    end
  end

  defp validate_after_create(nil), do: {:ok, nil}
  defp validate_after_create(""), do: {:ok, nil}
  defp validate_after_create(command) when is_binary(command), do: {:ok, command}
  defp validate_after_create(command), do: {:error, {:invalid_after_create_hook, command}}

  defp validate_log_context(nil), do: {:ok, @default_log_context}
  defp validate_log_context(context) when is_binary(context) and context != "", do: {:ok, context}
  defp validate_log_context(context), do: {:error, {:invalid_log_context, context}}

  defp validate_validator(validator) when is_function(validator, 1), do: {:ok, validator}
  defp validate_validator(validator), do: {:error, {:invalid_validator, validator}}

  defp validate_publish_runner(runner) when is_function(runner, 3), do: {:ok, runner}
  defp validate_publish_runner(runner), do: {:error, {:invalid_publish_runner, runner}}

  defp validate_container_mkdir(mkdir) when is_function(mkdir, 1), do: {:ok, mkdir}
  defp validate_container_mkdir(mkdir), do: {:error, {:invalid_container_mkdir, mkdir}}

  defp normalize_workspace(workspace) do
    {:ok, Path.expand(workspace)}
  rescue
    exception -> {:error, {:invalid_workspace_path, exception}}
  end

  defp validate_workspace_basename(workspace) do
    if Path.basename(workspace) == @container_name do
      {:error, {:reserved_workspace_name, workspace}}
    else
      :ok
    end
  end

  defp join_flight(workspace, settings) do
    if worker_active_for?(workspace) do
      error(workspace, :lock, {:reentrant_provision, workspace}, true)
    else
      FlightRegistry.join(workspace, fn flight_reporter ->
        run_flight_worker(workspace, settings, flight_reporter)
      end)
    end
  rescue
    exception -> error(workspace, :lock, {:flight_registry_failed, exception}, true)
  catch
    kind, reason -> error(workspace, :lock, {:flight_registry_failed, kind, reason}, true)
  end

  defp worker_active_for?(workspace) do
    case Process.get(@worker_paths_key) do
      %MapSet{} = paths -> MapSet.member?(paths, workspace)
      _other -> false
    end
  end

  defp run_flight_worker(workspace, settings, flight_reporter) do
    previous_paths = Process.get(@worker_paths_key)
    active_paths = if match?(%MapSet{}, previous_paths), do: previous_paths, else: MapSet.new()
    Process.put(@worker_paths_key, MapSet.put(active_paths, workspace))
    worker_settings = Map.put(settings, :flight_reporter, flight_reporter)

    try do
      with :ok <- flight_reporter.({:stage, :inspect_final}) do
        ensure_owned(workspace, worker_settings)
      end
    rescue
      exception -> error(workspace, :lock, {:provision_exception, exception}, true)
    catch
      kind, reason -> error(workspace, :lock, {:provision_exit, kind, reason}, true)
    after
      restore_worker_paths(previous_paths)
    end
  end

  defp restore_worker_paths(nil), do: Process.delete(@worker_paths_key)
  defp restore_worker_paths(paths), do: Process.put(@worker_paths_key, paths)

  defp ensure_owned(workspace, settings) do
    case File.lstat(workspace) do
      {:ok, %File.Stat{type: :directory}} ->
        classify_existing_workspace(workspace)

      {:ok, %File.Stat{type: type}} ->
        error(workspace, :inspect_final, {:workspace_path_blocked, workspace, type}, false)

      {:error, :enoent} ->
        provision_new_workspace(workspace, settings)

      {:error, reason} ->
        error(workspace, :inspect_final, {:file_error, workspace, reason}, true)
    end
  end

  defp classify_existing_workspace(workspace) do
    owner_marker = Path.join(workspace, @ownership_marker)

    case read_token_marker(owner_marker) do
      {:error, :marker_missing} ->
        {:ok, workspace}

      {:ok, token} ->
        classify_owned_workspace(workspace, token)

      {:error, reason} ->
        workspace_incomplete_error(
          workspace,
          :inspect_final,
          {:ownership_marker_invalid, owner_marker, reason},
          :preserved
        )
    end
  end

  defp classify_owned_workspace(workspace, token) do
    case verify_token_file(Path.join(workspace, @readiness_marker), token) do
      :ok ->
        {:ok, workspace}

      {:error, verification_error} ->
        rollback = rollback_owned_final(workspace, token)
        workspace_incomplete_error(workspace, :inspect_final, verification_error, rollback)
    end
  end

  defp workspace_incomplete_error(workspace, stage, verification_error, rollback) do
    error(
      workspace,
      stage,
      {:workspace_incomplete, workspace, verification_error, rollback},
      true
    )
  end

  defp provision_new_workspace(workspace, settings) do
    with :ok <- settings.flight_reporter.({:stage, :create_staging}) do
      case AtomicMover.ensure_supported(settings.publish_runner) do
        :ok ->
          case create_attempt(
                 workspace,
                 settings.container_mkdir,
                 &System.cmd/3,
                 settings.flight_reporter
               ) do
            {:ok, attempt} -> provision_attempt(workspace, attempt, settings)
            {:error, reason} -> error(workspace, :create_staging, reason, true)
          end

        {:error, reason} ->
          error(workspace, :create_staging, reason, true)
      end
    end
  end

  defp create_attempt(workspace, container_mkdir, move_runner, flight_reporter) do
    container = provisioning_container(workspace)

    case ensure_provisioning_container(container, container_mkdir) do
      :ok ->
        create_unique_attempt(
          workspace,
          container,
          move_runner,
          flight_reporter,
          @max_staging_name_attempts
        )

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp ensure_provisioning_container(container, container_mkdir) do
    parent = Path.dirname(container)

    with :ok <- normalize_file_result(File.mkdir_p(parent), parent),
         :ok <- ensure_reserved_directory(container, container_mkdir),
         :ok <- ensure_same_filesystem(parent, container) do
      :ok
    end
  end

  defp ensure_reserved_directory(container, container_mkdir) do
    case File.lstat(container) do
      {:ok, %File.Stat{type: :directory}} ->
        :ok

      {:ok, %File.Stat{type: type}} ->
        {:error, {:provisioning_container_invalid, container, type}}

      {:error, :enoent} ->
        create_or_revalidate_container(container, container_mkdir)

      {:error, reason} ->
        {:error, {:file_error, container, reason}}
    end
  end

  defp create_or_revalidate_container(container, container_mkdir) do
    case container_mkdir.(container) do
      :ok -> validate_reserved_directory(container)
      {:error, :eexist} -> validate_reserved_directory(container)
      {:error, reason} -> {:error, {:file_error, container, reason}}
    end
  end

  defp validate_reserved_directory(container) do
    case File.lstat(container) do
      {:ok, %File.Stat{type: :directory}} ->
        :ok

      {:ok, %File.Stat{type: type}} ->
        {:error, {:provisioning_container_invalid, container, type}}

      {:error, reason} ->
        {:error, {:file_error, container, reason}}
    end
  end

  defp ensure_same_filesystem(parent, container) do
    with {:ok, parent_stat} <- File.stat(parent),
         {:ok, container_stat} <- File.stat(container) do
      parent_device = {parent_stat.major_device, parent_stat.minor_device}
      container_device = {container_stat.major_device, container_stat.minor_device}

      if parent_device == container_device do
        :ok
      else
        {:error, {:provisioning_container_filesystem_mismatch, container, parent_device, container_device}}
      end
    else
      {:error, reason} -> {:error, {:file_error, container, reason}}
    end
  end

  defp create_unique_attempt(
         _workspace,
         _container,
         _move_runner,
         _flight_reporter,
         0
       ) do
    {:error, {:staging_name_collision, @max_staging_name_attempts}}
  end

  defp create_unique_attempt(
         workspace,
         container,
         move_runner,
         flight_reporter,
         attempts_remaining
       ) do
    token = random_token()
    root = Path.join(container, "#{Path.basename(workspace)}-#{token}")

    case File.mkdir(root) do
      :ok ->
        initialize_attempt(root, container, token, move_runner, flight_reporter)

      {:error, :eexist} ->
        create_unique_attempt(
          workspace,
          container,
          move_runner,
          flight_reporter,
          attempts_remaining - 1
        )

      {:error, reason} ->
        {:error, {:file_error, root, reason}}
    end
  end

  defp initialize_attempt(root, container, token, move_runner, flight_reporter) do
    marker = Path.join(root, @attempt_marker)
    staging = Path.join(root, @payload_name)

    with :ok <- normalize_file_result(File.write(marker, token_content(token), [:exclusive]), marker),
         :ok <- normalize_file_result(File.mkdir(staging), staging),
         {:ok, root_identity} <- filesystem_identity(root),
         {:ok, staging_identity} <- filesystem_identity(staging) do
      attempt = %{
        root: root,
        staging: staging,
        container: container,
        token: token,
        root_identity: root_identity,
        staging_identity: staging_identity,
        move_runner: move_runner
      }

      with :ok <- flight_reporter.({:attempt, attempt}), do: {:ok, attempt}
    else
      {:error, reason} ->
        cleanup_error = remove_new_attempt_parts(root, staging, marker)
        {:error, {:attempt_initialization_failed, root, reason, cleanup_error}}
    end
  end

  defp remove_new_attempt_parts(root, staging, marker) do
    results = [
      remove_directory_if_empty(staging),
      remove_file_if_present(marker),
      remove_directory_if_empty(root)
    ]

    Enum.find(results, &(&1 != nil))
  end

  defp remove_directory_if_empty(path) do
    case File.rmdir(path) do
      :ok -> nil
      {:error, :enoent} -> nil
      {:error, reason} -> {:file_error, path, reason}
    end
  end

  defp remove_file_if_present(path) do
    case File.rm(path) do
      :ok -> nil
      {:error, :enoent} -> nil
      {:error, reason} -> {:file_error, path, reason}
    end
  end

  defp provision_attempt(workspace, attempt, settings) do
    case run_provisioning_stages(workspace, attempt, settings) do
      :ok ->
        {:ok, workspace}

      {:error, {stage, reason}} ->
        fail_attempt(workspace, attempt, stage, reason)
    end
  end

  defp run_provisioning_stages(workspace, attempt, settings) do
    with :ok <-
           run_flight_stage(settings, :after_create, fn ->
             run_after_create(
               settings.after_create,
               workspace,
               attempt.staging,
               settings.log_context
             )
           end),
         :ok <- run_flight_stage(settings, :claim_staging, fn -> claim_payload(attempt) end),
         :ok <-
           run_flight_stage(settings, :prepare_skills, fn ->
             WorkspaceSkills.prepare(attempt.staging)
           end),
         :ok <-
           run_flight_stage(settings, :validate, fn ->
             settings.validator.(attempt.staging)
           end),
         :ok <-
           run_flight_stage(settings, :write_readiness, fn ->
             write_readiness_marker(attempt)
           end),
         :ok <-
           run_flight_stage(settings, :publish, fn ->
             publish(attempt, workspace, settings.publish_runner)
           end) do
      :ok
    end
  end

  defp run_flight_stage(settings, stage, operation) do
    with :ok <- settings.flight_reporter.({:stage, stage}) do
      run_stage(stage, operation)
    end
  end

  defp run_stage(stage, operation) do
    case operation.() do
      :ok -> :ok
      {:error, reason} -> {:error, {stage, reason}}
      result -> {:error, {stage, {:unexpected_stage_result, result}}}
    end
  rescue
    exception -> {:error, {stage, {:exception, exception}}}
  catch
    kind, reason -> {:error, {stage, {kind, reason}}}
  end

  defp claim_payload(attempt) do
    marker = Path.join(attempt.staging, @ownership_marker)

    with :ok <- verify_attempt_paths(attempt, false),
         :ok <- ensure_controlled_directory(Path.dirname(marker)),
         :ok <- write_new_token_marker(marker, attempt.token) do
      :ok
    end
  end

  defp write_readiness_marker(attempt) do
    marker = Path.join(attempt.staging, @readiness_marker)

    with :ok <- verify_attempt_paths(attempt, true),
         :ok <- ensure_controlled_directory(Path.dirname(marker)),
         :ok <- write_new_token_marker(marker, attempt.token) do
      :ok
    end
  end

  defp ensure_controlled_directory(path) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :directory}} ->
        :ok

      {:ok, %File.Stat{type: type}} ->
        {:error, {:controlled_path_not_directory, path, type}}

      {:error, :enoent} ->
        case File.mkdir(path) do
          :ok -> validate_controlled_directory(path)
          {:error, :eexist} -> validate_controlled_directory(path)
          {:error, reason} -> {:error, {:file_error, path, reason}}
        end

      {:error, reason} ->
        {:error, {:file_error, path, reason}}
    end
  end

  defp validate_controlled_directory(path) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :directory}} -> :ok
      {:ok, %File.Stat{type: type}} -> {:error, {:controlled_path_not_directory, path, type}}
      {:error, reason} -> {:error, {:file_error, path, reason}}
    end
  end

  defp write_new_token_marker(marker, token) do
    case File.lstat(marker) do
      {:error, :enoent} ->
        with :ok <-
               normalize_file_result(
                 File.write(marker, token_content(token), [:exclusive]),
                 marker
               ),
             :ok <- verify_token_file(marker, token) do
          :ok
        end

      {:ok, %File.Stat{type: type}} ->
        {:error, {:controlled_marker_exists, marker, type}}

      {:error, reason} ->
        {:error, {:file_error, marker, reason}}
    end
  end

  defp publish(attempt, workspace, runner) do
    with :ok <- verify_attempt_paths(attempt, true),
         :ok <- verify_token_file(Path.join(attempt.staging, @readiness_marker), attempt.token),
         :ok <- AtomicMover.move(attempt.staging, workspace, runner) do
      finish_publication(attempt, workspace)
    end
  end

  defp finish_publication(attempt, workspace) do
    case verify_ready_final(workspace, attempt.token) do
      :ok ->
        cleanup_published_wrapper(attempt)
        :ok

      {:error, verification_error} ->
        rollback = rollback_owned_final(workspace, attempt.token)
        {:error, {:workspace_incomplete, workspace, verification_error, rollback}}
    end
  end

  defp cleanup_published_wrapper(attempt) do
    case quarantine_and_delete_attempt(attempt, true, false) do
      nil ->
        :ok

      cleanup_error ->
        Logger.warning(
          "Published workspace wrapper cleanup failed staging=#{attempt.root} " <>
            "cleanup_error=#{inspect(cleanup_error)}"
        )

        :ok
    end
  end

  defp verify_ready_final(workspace, token) do
    with :ok <- verify_token_file(Path.join(workspace, @ownership_marker), token),
         :ok <- verify_token_file(Path.join(workspace, @readiness_marker), token) do
      :ok
    end
  end

  defp fail_attempt(workspace, attempt, stage, reason) do
    require_payload_token = stage in [:prepare_skills, :validate, :write_readiness, :publish]
    allow_missing_payload = stage == :publish

    cleanup_error =
      quarantine_and_delete_attempt(attempt, allow_missing_payload, require_payload_token)

    Logger.warning(
      "Workspace provisioning failed workspace=#{workspace} staging=#{attempt.root} " <>
        "stage=#{stage} retryable=true reason=#{inspect(reason)} " <>
        "cleanup_error=#{inspect(cleanup_error)}"
    )

    error(workspace, stage, reason, true, attempt.root, cleanup_error)
  end

  defp quarantine_and_delete_attempt(attempt, allow_missing_payload, require_payload_token) do
    quarantine = quarantine_path(attempt.container, "attempt")

    case AtomicMover.move(attempt.root, quarantine, attempt.move_runner) do
      :ok ->
        verify_and_delete_attempt_quarantine(
          attempt,
          quarantine,
          allow_missing_payload,
          require_payload_token
        )

      {:error, reason} ->
        {:quarantine_move_failed, attempt.root, quarantine, reason}
    end
  end

  defp verify_and_delete_attempt_quarantine(
         attempt,
         quarantine,
         allow_missing_payload,
         require_payload_token
       ) do
    case verify_attempt_quarantine(
           attempt,
           quarantine,
           allow_missing_payload,
           require_payload_token
         ) do
      :ok ->
        remove_verified_quarantine(quarantine)

      {:error, reason} ->
        {:quarantine_ownership_mismatch, quarantine, reason}
    end
  end

  defp verify_attempt_quarantine(
         attempt,
         quarantine,
         allow_missing_payload,
         require_payload_token
       ) do
    quarantined_payload = Path.join(quarantine, @payload_name)

    with :ok <- verify_identity(quarantine, attempt.root_identity, :attempt_identity_mismatch),
         :ok <- verify_token_file(Path.join(quarantine, @attempt_marker), attempt.token),
         :ok <-
           verify_quarantined_payload(
             quarantined_payload,
             attempt,
             allow_missing_payload,
             require_payload_token
           ) do
      :ok
    end
  end

  defp verify_quarantined_payload(path, attempt, allow_missing_payload, require_payload_token) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :directory}} ->
        with :ok <- verify_identity(path, attempt.staging_identity, :payload_identity_mismatch),
             :ok <- maybe_verify_payload_token(path, attempt.token, require_payload_token) do
          :ok
        end

      {:error, :enoent} when allow_missing_payload ->
        :ok

      {:error, :enoent} ->
        {:error, :payload_missing}

      {:ok, %File.Stat{type: type}} ->
        {:error, {:payload_not_directory, type}}

      {:error, reason} ->
        {:error, {:payload_unreadable, reason}}
    end
  end

  defp maybe_verify_payload_token(_path, _token, false), do: :ok

  defp maybe_verify_payload_token(path, token, :if_present) do
    case verify_token_file(Path.join(path, @ownership_marker), token) do
      :ok -> :ok
      {:error, :marker_missing} -> :ok
      {:error, :token_mismatch} -> {:error, :payload_token_mismatch}
      {:error, reason} -> {:error, {:payload_token_invalid, reason}}
    end
  end

  defp maybe_verify_payload_token(path, token, true) do
    case verify_token_file(Path.join(path, @ownership_marker), token) do
      :ok -> :ok
      {:error, :marker_missing} -> {:error, :payload_token_missing}
      {:error, :token_mismatch} -> {:error, :payload_token_mismatch}
      {:error, reason} -> {:error, {:payload_token_invalid, reason}}
    end
  end

  defp rollback_owned_final(workspace, token) do
    container = provisioning_container(workspace)
    quarantine = quarantine_path(container, "final")
    runner = &System.cmd/3

    case AtomicMover.ensure_supported(runner) do
      :ok ->
        case ensure_provisioning_container(container, &File.mkdir/1) do
          :ok ->
            case AtomicMover.move(workspace, quarantine, runner) do
              :ok -> verify_and_delete_final_quarantine(quarantine, token)
              {:error, reason} -> {:rollback_failed, reason}
            end

          {:error, reason} ->
            {:rollback_failed, reason}
        end

      {:error, reason} ->
        {:rollback_failed, reason}
    end
  end

  defp verify_and_delete_final_quarantine(quarantine, token) do
    case verify_token_file(Path.join(quarantine, @ownership_marker), token) do
      :ok ->
        case remove_verified_quarantine(quarantine) do
          nil -> :rolled_back
          error -> {:rollback_failed, error}
        end

      {:error, reason} ->
        {:rollback_preserved, quarantine, reason}
    end
  end

  defp remove_verified_quarantine(quarantine) do
    case File.rm_rf(quarantine) do
      {:ok, _removed} -> nil
      {:error, reason, failed_path} -> {:file_error, failed_path, reason}
    end
  end

  defp verify_attempt_paths(attempt, require_payload_token) do
    with :ok <- verify_identity(attempt.root, attempt.root_identity, :attempt_identity_mismatch),
         :ok <- verify_token_file(Path.join(attempt.root, @attempt_marker), attempt.token),
         :ok <- verify_identity(attempt.staging, attempt.staging_identity, :payload_identity_mismatch),
         :ok <- maybe_verify_payload_token(attempt.staging, attempt.token, require_payload_token) do
      :ok
    end
  end

  defp verify_identity(path, expected_identity, error_tag) do
    case filesystem_identity(path) do
      {:ok, ^expected_identity} -> :ok
      {:ok, actual_identity} -> {:error, {error_tag, expected_identity, actual_identity}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp filesystem_identity(path) do
    case File.lstat(path) do
      {:ok,
       %File.Stat{
         type: :directory,
         major_device: major_device,
         minor_device: minor_device,
         inode: inode
       }} ->
        {:ok, {major_device, minor_device, inode}}

      {:ok, %File.Stat{type: type}} ->
        {:error, {:not_directory, path, type}}

      {:error, :enoent} ->
        {:error, {:path_missing, path}}

      {:error, reason} ->
        {:error, {:path_unreadable, path, reason}}
    end
  end

  defp validate_staging(staging) do
    with {:ok, repositories} <- immediate_git_repositories(staging) do
      Enum.reduce_while(repositories, :ok, fn repository, :ok ->
        case validate_git_repository(repository) do
          :ok -> {:cont, :ok}
          {:error, reason} -> {:halt, {:error, reason}}
        end
      end)
    end
  end

  defp immediate_git_repositories(staging) do
    case File.lstat(staging) do
      {:ok, %File.Stat{type: :directory}} ->
        list_immediate_git_repositories(staging)

      {:ok, %File.Stat{type: type}} ->
        {:error, {:staging_not_directory, staging, type}}

      {:error, reason} ->
        {:error, {:staging_unavailable, staging, reason}}
    end
  end

  defp list_immediate_git_repositories(staging) do
    case File.ls(staging) do
      {:ok, entries} ->
        child_repositories =
          entries
          |> Enum.map(&Path.join(staging, &1))
          |> Enum.filter(&(File.dir?(&1) and git_metadata_present?(&1)))

        repositories =
          if git_metadata_present?(staging) do
            [staging | child_repositories]
          else
            child_repositories
          end

        {:ok, repositories}

      {:error, reason} ->
        {:error, {:staging_unreadable, staging, reason}}
    end
  end

  defp git_metadata_present?(repository) do
    match?({:ok, _stat}, File.lstat(Path.join(repository, ".git")))
  end

  defp validate_git_repository(repository) do
    Enum.reduce_while(@git_validation_commands, :ok, fn {check, arguments}, :ok ->
      result = System.cmd("git", arguments, cd: repository, stderr_to_stdout: true)

      case validate_git_command_result(repository, check, result) do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp validate_git_command_result(repository, :rev_parse, {output, 0}) do
    if String.trim(output) == "true" do
      :ok
    else
      {:error, {:git_repository_not_worktree, repository, String.trim(output)}}
    end
  end

  defp validate_git_command_result(_repository, _check, {_output, 0}), do: :ok

  defp validate_git_command_result(repository, check, {output, status}) do
    {:error, {:git_repository_unusable, repository, check, status, String.trim_trailing(output)}}
  end

  defp run_after_create(nil, _workspace, _staging, _log_context), do: :ok

  defp run_after_create(command, workspace, staging, log_context) do
    Logger.info(
      "Running workspace hook hook=#{@after_create_hook_name} #{log_context} " <>
        "workspace=#{workspace} staging=#{staging}"
    )

    command
    |> then(&System.cmd("sh", ["-e", "-lc", &1], cd: staging, stderr_to_stdout: true))
    |> handle_hook_result(workspace, log_context)
  end

  defp handle_hook_result({_output, 0}, _workspace, _log_context), do: :ok

  defp handle_hook_result({output, status}, workspace, log_context) do
    sanitized_output = sanitize_hook_output_for_log(output)

    Logger.warning(
      "Workspace hook failed hook=#{@after_create_hook_name} #{log_context} " <>
        "workspace=#{workspace} status=#{status} output=#{inspect(sanitized_output)}"
    )

    {:error, {:workspace_hook_failed, @after_create_hook_name, status, output}}
  end

  defp read_token_marker(path) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :regular}} ->
        read_token_marker_content(path)

      {:ok, %File.Stat{type: type}} ->
        {:error, {:marker_not_regular, type}}

      {:error, :enoent} ->
        {:error, :marker_missing}

      {:error, reason} ->
        {:error, {:marker_unreadable, reason}}
    end
  end

  defp read_token_marker_content(path) do
    case File.read(path) do
      {:ok, content} ->
        token = String.trim_trailing(content, "\n")

        if token != "" and not String.contains?(token, "\n") and content == token_content(token) do
          {:ok, token}
        else
          {:error, :invalid_token}
        end

      {:error, reason} ->
        {:error, {:marker_unreadable, reason}}
    end
  end

  defp verify_token_file(path, token) do
    case read_token_marker(path) do
      {:ok, ^token} -> :ok
      {:ok, _other_token} -> {:error, :token_mismatch}
      {:error, reason} -> {:error, reason}
    end
  end

  defp provisioning_container(workspace) do
    Path.join(Path.dirname(workspace), @container_name)
  end

  defp quarantine_path(container, label) do
    Path.join(container, ".quarantine-#{label}-#{random_token()}")
  end

  defp random_token do
    18
    |> :crypto.strong_rand_bytes()
    |> Base.url_encode64(padding: false)
  end

  defp token_content(token), do: token <> "\n"

  defp sanitize_hook_output_for_log(output, max_bytes \\ 2_048) do
    binary_output = IO.iodata_to_binary(output)

    if byte_size(binary_output) <= max_bytes do
      binary_output
    else
      binary_part(binary_output, 0, max_bytes) <> "... (truncated)"
    end
  end

  defp normalize_file_result(:ok, _path), do: :ok
  defp normalize_file_result({:error, reason}, path), do: {:error, {:file_error, path, reason}}

  defp error(workspace, stage, reason, retryable, staging \\ nil, cleanup_error \\ nil) do
    {:error,
     %Error{
       workspace: workspace,
       staging: staging,
       stage: stage,
       reason: reason,
       cleanup_error: cleanup_error,
       retryable: retryable
     }}
  end
end
