defmodule SymphonyElixir.Assistant.TurnManager do
  @moduledoc """
  Always-on owner of assistant turn lifecycle. Centralizes what the channel did
  ad-hoc: it writes the durable `metadata.current_turn` state, runs the worker
  `Task` under the shared `Task.Supervisor`, holds the live worker pid in a
  `:unique` `Registry` keyed by `thread_id` (so any channel — including a reloaded
  tab — can steer/interrupt the in-flight turn), monitors the worker, and
  transitions the metadata on completion / failure / abnormal exit.

  On boot it reconciles orphaned `running` threads (a full serve restart kills
  every worker) to `interrupted (serve_restart)`.

  A per-thread FIFO queue serializes additional turns requested while one is
  running, eliminating the parallel-Codex-session failure mode.

  Live streaming (deltas / tool calls) is unchanged: it stays on the originating
  socket via closures the channel passes in `opts`. This module only owns
  lifecycle + status.
  """

  use GenServer

  alias SymphonyElixir.Assistant.{GoalRun, History, TitleGenerator}

  require Logger

  @registry __MODULE__.Registry

  @type start_opts :: [
          trigger: String.t(),
          agent_kind: String.t() | nil,
          model: String.t() | nil,
          effort: String.t() | nil,
          codex_thread_id: String.t() | nil,
          reply_to: pid(),
          run: (-> {:ok, map()} | {:error, term()}),
          run_builder: (String.t() -> (-> {:ok, map()} | {:error, term()}))
        ]

  # --- child specs -----------------------------------------------------------

  @doc "Child spec for the backing pid registry; added to the shared supervisor."
  @spec registry_child_spec() :: {module(), keyword()}
  def registry_child_spec, do: {Registry, keys: :unique, name: @registry}

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # --- public API ------------------------------------------------------------

  @doc """
  Start a turn for `thread_id`. Writes `metadata.current_turn` running, spawns +
  monitors the worker running `opts[:run]`, registers the worker pid, and
  broadcasts `{:turn_status, :running, payload}` on the thread topic.

  Returns `{:error, :turn_in_progress}` if a live worker is already registered for
  the thread (the channel then routes the message to steer/queue).
  """
  @spec start_turn(integer(), String.t(), start_opts()) ::
          {:ok, %{pid: pid(), generation: String.t()}} | {:error, :turn_in_progress | term()}
  def start_turn(thread_id, prompt, opts)
      when is_integer(thread_id) and is_binary(prompt) and is_list(opts) do
    GenServer.call(__MODULE__, {:start_turn, thread_id, prompt, opts})
  end

  @doc "Record the live Codex thread/turn ids once the turn has started."
  @spec note_codex_turn(integer(), String.t() | nil, String.t() | nil) :: :ok
  def note_codex_turn(thread_id, codex_thread_id, turn_id) when is_integer(thread_id) do
    GenServer.cast(__MODULE__, {:note_codex, thread_id, codex_thread_id, turn_id})
  end

  @doc "Mark the running turn finished (completed/failed) and drain the queue."
  @spec finish_turn(integer(), String.t(), {:ok, map()} | {:error, term()}) ::
          {:accepted, {:ok, map()} | {:error, term()}} | :stale | {:error, term()}
  def finish_turn(thread_id, generation, result)
      when is_integer(thread_id) and is_binary(generation) do
    GenServer.call(__MODULE__, {:finish_turn, thread_id, generation, result})
  end

  @doc "Append a turn to the thread's FIFO queue (runs when the current turn finishes)."
  @spec enqueue(integer(), String.t(), start_opts()) :: :ok
  def enqueue(thread_id, prompt, opts) when is_integer(thread_id) do
    GenServer.cast(__MODULE__, {:enqueue, thread_id, prompt, opts})
  end

  @doc "Interrupt the live worker for a thread and persist an interrupted turn state."
  @spec interrupt(integer(), String.t()) :: :ok | {:ok, :already_finished} | {:error, term()}
  def interrupt(thread_id, reason) when is_integer(thread_id) and is_binary(reason) do
    GenServer.call(__MODULE__, {:interrupt, thread_id, reason, nil, false})
  end

  @doc "Interrupts the registered worker and waits until it has terminated."
  @spec interrupt_and_await(integer(), String.t(), timeout()) ::
          :ok | {:ok, :already_finished} | {:error, term()}
  def interrupt_and_await(thread_id, reason, timeout \\ 5_000)
      when is_integer(thread_id) and is_binary(reason) and
             (is_integer(timeout) or timeout == :infinity) do
    worker_pid =
      case steer_target(thread_id) do
        {:ok, pid, _turn_id} -> pid
        :error -> nil
      end

    monitor_ref = if is_pid(worker_pid), do: Process.monitor(worker_pid)

    try do
      case GenServer.call(__MODULE__, {:interrupt, thread_id, reason, worker_pid, true}) do
        :ok ->
          with :ok <- await_worker_termination(worker_pid, monitor_ref, timeout),
               :ok <- confirm_interrupted(thread_id) do
            :ok
          end

        {:ok, :already_finished} = result ->
          result

        {:error, _reason} = error ->
          error
      end
    after
      if is_reference(monitor_ref), do: Process.demonitor(monitor_ref, [:flush])
    end
  end

  @doc "Cancel a running tool on the live worker and fan out its canceled status."
  @spec kill_tool(integer(), String.t()) :: :ok | {:error, :tool_not_running | :no_worker | term()}
  def kill_tool(thread_id, tool_call_id) when is_integer(thread_id) and is_binary(tool_call_id) do
    GenServer.call(__MODULE__, {:kill_tool, thread_id, tool_call_id})
  end

  def kill_tool(_thread_id, _tool_call_id), do: {:error, :invalid_tool_call_id}

  @doc "Resolve the live worker pid + codex turn id for cross-channel steer/interrupt."
  @spec steer_target(integer()) :: {:ok, pid(), String.t() | nil} | :error
  def steer_target(thread_id) when is_integer(thread_id) do
    case lookup(thread_id) do
      {pid, codex_turn_id} when is_pid(pid) -> {:ok, pid, codex_turn_id}
      _ -> :error
    end
  end

  @doc "True when a live worker is registered for the thread."
  @spec running?(integer()) :: boolean()
  def running?(thread_id) when is_integer(thread_id), do: lookup(thread_id) != nil

  @spec goal_mutation(integer(), boolean(), (-> term()), keyword()) :: term()
  def goal_mutation(thread_id, allow_running, operation, opts \\ [])
      when is_integer(thread_id) and is_boolean(allow_running) and is_function(operation, 0) and is_list(opts) do
    GenServer.call(__MODULE__, {:goal_mutation, thread_id, allow_running, operation, opts}, :infinity)
  end

  @doc "Coalesces authoritative Goal provider reads by thread."
  @spec resolve_goal_status(integer(), integer(), (-> term()), pid(), map()) ::
          :ok | {:error, term()}
  def resolve_goal_status(thread_id, request_order, operation, reply_to, metadata)
      when is_integer(thread_id) and is_integer(request_order) and is_function(operation, 0) and
             is_pid(reply_to) and is_map(metadata) do
    GenServer.call(
      __MODULE__,
      {:resolve_goal_status, thread_id, request_order, operation, reply_to, metadata}
    )
  end

  @doc "Runs a coalesced Goal provider read and waits for its explicit result."
  @spec resolve_goal_status_sync(integer(), (-> term()), timeout()) ::
          {:ok, term(), integer()} | {:error, term()}
  def resolve_goal_status_sync(thread_id, operation, timeout \\ 10_000)
      when is_integer(thread_id) and is_function(operation, 0) and
             (is_integer(timeout) or timeout == :infinity) do
    request_order = System.unique_integer([:positive, :monotonic])
    metadata = %{broadcast: false, changed: false, reply_refs: []}

    case resolve_goal_status(thread_id, request_order, operation, self(), metadata) do
      :ok ->
        receive do
          {:goal_status_resolved, resolved_order, _metadata, result} ->
            {:ok, result, resolved_order}

          {:goal_status_resolution_failed, _failed_order, _metadata, reason} ->
            {:error, reason}
        after
          timeout -> {:error, :goal_status_read_timeout}
        end

      {:error, reason} ->
        receive do
          {:goal_status_resolution_failed, _failed_order, _metadata, failure_reason} ->
            {:error, failure_reason}
        after
          0 -> {:error, reason}
        end
    end
  catch
    kind, reason -> {:error, {:goal_status_resolver_unavailable, {kind, reason}}}
  end

  @doc "Whole seconds the current turn has been running (from thread metadata), or nil."
  @spec elapsed_seconds(integer()) :: non_neg_integer() | nil
  def elapsed_seconds(thread_id) when is_integer(thread_id) do
    case History.get_thread(thread_id) do
      {:ok, thread} -> History.turn_elapsed_seconds(thread)
      _ -> nil
    end
  end

  # --- PubSub passthrough (reuse the existing per-thread topic) ---------------

  @doc "Subscribe the calling process to a thread's lifecycle topic."
  @spec subscribe(integer()) :: :ok
  defdelegate subscribe(thread_id), to: GoalRun

  @doc "Broadcast a lifecycle event to a thread's subscribers, excluding `from_pid`."
  @spec broadcast_from(pid(), integer(), term()) :: :ok
  defdelegate broadcast_from(from_pid, thread_id, message), to: GoalRun

  # --- GenServer -------------------------------------------------------------

  @impl true
  def init(_opts), do: {:ok, %{}, {:continue, :reconcile}}

  @impl true
  def handle_continue(:reconcile, state) do
    case safe_reconcile() do
      {:ok, n} when n > 0 ->
        Logger.info("assistant turns: reconciled #{n} orphaned turn(s) to interrupted")

      _ ->
        :ok
    end

    {:noreply, state}
  end

  @impl true
  def handle_call({:goal_mutation, thread_id, allow_running, operation, opts}, from, state) do
    if not allow_running and running?(thread_id) do
      {:reply, {:error, :assistant_busy}, state}
    else
      request = %{
        from: from,
        operation: operation,
        queue_policy: Keyword.get(opts, :queue_policy, :drain)
      }

      {:noreply, enqueue_goal_mutation(state, thread_id, request)}
    end
  end

  def handle_call(
        {:resolve_goal_status, thread_id, request_order, operation, reply_to, metadata},
        _from,
        state
      ) do
    request = %{
      request_order: request_order,
      operation: operation,
      reply_to: reply_to,
      reply_targets: [reply_to],
      metadata: metadata
    }

    case Map.get(state, {:goal_status_read, thread_id}) do
      nil ->
        case start_goal_status_read(state, thread_id, request) do
          {:ok, state} -> {:reply, :ok, state}
          {:error, reason, state} -> {:reply, {:error, reason}, state}
        end

      resolver ->
        pending = newest_goal_status_request(resolver.pending, request)
        {:reply, :ok, Map.put(state, {:goal_status_read, thread_id}, %{resolver | pending: pending})}
    end
  end

  def handle_call({:start_turn, thread_id, prompt, opts}, _from, state) do
    if running?(thread_id) or Map.has_key?(state, {:goal_mutation, thread_id}) do
      {:reply, {:error, :turn_in_progress}, state}
    else
      do_start_turn(thread_id, prompt, opts, state)
    end
  end

  @impl true
  def handle_call({:interrupt, thread_id, reason, expected_worker_pid, preserve_queue?}, _from, state) do
    worker_pid = interrupt_worker_pid(thread_id, state)

    cond do
      is_pid(expected_worker_pid) and worker_pid != expected_worker_pid ->
        {:reply, {:ok, :already_finished}, state}

      true ->
        do_interrupt_running_turn(thread_id, reason, worker_pid, preserve_queue?, state)
    end
  end

  @impl true
  def handle_call({:finish_turn, thread_id, generation, result}, _from, state) do
    case Map.get(state, {:turn, thread_id}) do
      %{generation: ^generation, monitor_ref: ref} ->
        case persist_finish(thread_id, generation, result) do
          :ok ->
            Process.demonitor(ref, [:flush])
            unregister(thread_id)
            broadcast_finish(thread_id, result)
            state = Map.delete(state, {:turn, thread_id})
            {:reply, {:accepted, result}, maybe_drain_after_turn(thread_id, state)}

          :stale ->
            {:reply, :stale, state}

          {:error, reason} ->
            {:reply, {:error, reason}, state}
        end

      _ ->
        {:reply, :stale, state}
    end
  end

  @impl true
  def handle_call({:kill_tool, thread_id, tool_call_id}, _from, state) do
    with {:ok, thread} <- History.get_thread(thread_id),
         {:ok, active_tool} <- fetch_active_tool(thread, tool_call_id),
         worker_pid when is_pid(worker_pid) <- interrupt_worker_pid(thread_id, state),
         :ok <- send_kill_tool(worker_pid, tool_call_id),
         {:ok, _updated_thread} <- History.remove_active_tool(thread, tool_call_id) do
      broadcast_killed_tool(thread_id, active_tool)
      {:reply, :ok, state}
    else
      {:error, reason} ->
        {:reply, {:error, reason}, state}

      nil ->
        {:reply, {:error, :no_worker}, state}
    end
  end

  defp do_interrupt_running_turn(thread_id, reason, worker_pid, preserve_queue?, state) do
    case persist_interrupt(thread_id, reason) do
      {:ok, updated_thread} ->
        if is_pid(worker_pid), do: send(worker_pid, {:agent_interrupt})
        state |> Map.get({:turn, thread_id}) |> notify_reply_to({:error, :interrupted})
        state = cleanup_interrupted_turn(thread_id, preserve_queue?, state)
        broadcast_from(self(), thread_id, {:turn_status, :interrupted, History.turn_payload(updated_thread)})
        {:reply, :ok, state}

      {:already_finished, _thread} ->
        {:reply, {:ok, :already_finished}, state}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_cast({:note_codex, thread_id, codex_thread_id, turn_id}, state) do
    case lookup(thread_id) do
      {pid, _old} when is_pid(pid) ->
        update_registry(thread_id, {pid, turn_id})

        with {:ok, thread} <- History.get_thread(thread_id) do
          History.note_turn_codex(thread, %{codex_thread_id: codex_thread_id, turn_id: turn_id})
        end

      _ ->
        :ok
    end

    {:noreply, state}
  end

  def handle_cast({:enqueue, thread_id, prompt, opts}, state) do
    if Map.has_key?(state, {:turn, thread_id}) or Map.has_key?(state, {:goal_mutation, thread_id}) do
      queued = Map.get(state, {:queue, thread_id}, [])
      {:noreply, Map.put(state, {:queue, thread_id}, queued ++ [%{prompt: prompt, opts: opts}])}
    else
      case do_start_turn(thread_id, prompt, ensure_run(opts, prompt), state) do
        {:reply, {:ok, _}, new_state} -> {:noreply, new_state}
        {:reply, _err, new_state} -> {:noreply, new_state}
      end
    end
  end

  @impl true
  def handle_info({:goal_mutation_done, thread_id, result}, state) do
    case Map.get(state, {:goal_mutation, thread_id}) do
      %{current: %{from: from, queue_policy: queue_policy}, queue: queue} ->
        mutation = Map.fetch!(state, {:goal_mutation, thread_id})
        Process.demonitor(mutation.monitor_ref, [:flush])
        GenServer.reply(from, result)
        state = start_next_goal_mutation(state, thread_id, queue)

        state =
          if queue_policy == :hold and match?({:ok, _, _}, result),
            do: state,
            else: maybe_drain_after_goal_mutation(thread_id, state)

        {:noreply, state}

      _ ->
        {:noreply, state}
    end
  end

  def handle_info({:goal_status_read_done, thread_id, request_order, result}, state) do
    case Map.get(state, {:goal_status_read, thread_id}) do
      %{current: %{request_order: ^request_order} = current, pending: pending} = resolver ->
        Process.demonitor(resolver.monitor_ref, [:flush])

        Enum.each(current.reply_targets, fn target ->
          send(target, {:goal_status_resolved, request_order, current.metadata, result})
        end)

        state = Map.delete(state, {:goal_status_read, thread_id})
        {:noreply, start_pending_goal_status_read(state, thread_id, pending)}

      _ ->
        {:noreply, state}
    end
  end

  def handle_info({:DOWN, ref, :process, _pid, reason}, state) do
    case find_goal_status_read_by_ref(state, ref) do
      {thread_id, %{current: current, pending: pending}} ->
        Enum.each(current.reply_targets, fn target ->
          send(
            target,
            {:goal_status_resolution_failed, current.request_order, current.metadata, {:goal_status_read_crashed, reason}}
          )
        end)

        state = Map.delete(state, {:goal_status_read, thread_id})
        {:noreply, start_pending_goal_status_read(state, thread_id, pending)}

      nil ->
        case find_goal_mutation_by_ref(state, ref) do
          {thread_id, %{current: %{from: from}, queue: queue}} ->
            GenServer.reply(from, {:error, {:goal_mutation_crashed, reason}})
            state = start_next_goal_mutation(state, thread_id, queue)

            {:noreply, maybe_drain_after_goal_mutation(thread_id, state)}

          nil ->
            handle_turn_down(ref, reason, state)
        end
    end
  end

  def handle_info(_msg, state), do: {:noreply, state}

  defp handle_turn_down(ref, reason, state) do
    case find_turn_by_ref(state, ref) do
      {thread_id, entry} ->
        interrupt_result = maybe_interrupt_running(thread_id, entry.generation, reason)
        unregister(thread_id)
        result = {:error, {:turn_crashed, reason}}

        if match?({:ok, _updated_thread}, interrupt_result) do
          notify_reply_to(entry, result)
          broadcast_finish(thread_id, result)
        end

        {_popped, rest} = Map.pop(state, {:turn, thread_id})
        {:noreply, maybe_drain_after_turn(thread_id, rest)}

      nil ->
        {:noreply, state}
    end
  end

  # --- internals -------------------------------------------------------------

  defp start_goal_status_read(state, thread_id, request) do
    manager = self()

    case Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor, fn ->
           result =
             try do
               request.operation.()
             rescue
               error -> {:error, {:goal_status_read_failed, Exception.message(error)}}
             catch
               kind, reason -> {:error, {:goal_status_read_failed, {kind, reason}}}
             end

           send(manager, {:goal_status_read_done, thread_id, request.request_order, result})
         end) do
      {:ok, pid} ->
        resolver = %{
          current: request,
          pending: nil,
          pid: pid,
          monitor_ref: Process.monitor(pid)
        }

        {:ok, Map.put(state, {:goal_status_read, thread_id}, resolver)}

      {:error, reason} ->
        Enum.each(request.reply_targets, fn target ->
          send(
            target,
            {:goal_status_resolution_failed, request.request_order, request.metadata, {:goal_status_read_start_failed, reason}}
          )
        end)

        {:error, {:goal_status_read_start_failed, reason}, state}
    end
  end

  defp start_pending_goal_status_read(state, _thread_id, nil), do: state

  defp start_pending_goal_status_read(state, thread_id, request) do
    case start_goal_status_read(state, thread_id, request) do
      {:ok, state} -> state
      {:error, _reason, state} -> state
    end
  end

  defp newest_goal_status_request(nil, request), do: request

  defp newest_goal_status_request(%{request_order: current_order} = current, %{request_order: new_order} = request) do
    if new_order > current_order do
      %{
        request
        | metadata: merge_goal_status_metadata(current.metadata, request.metadata),
          reply_targets: Enum.uniq(current.reply_targets ++ request.reply_targets)
      }
    else
      %{
        current
        | metadata: merge_goal_status_metadata(request.metadata, current.metadata),
          reply_targets: Enum.uniq(current.reply_targets ++ request.reply_targets)
      }
    end
  end

  defp merge_goal_status_metadata(older, newer) do
    reply_refs =
      (List.wrap(Map.get(older, :reply_refs)) ++ List.wrap(Map.get(newer, :reply_refs)))
      |> Enum.reject(&is_nil/1)
      |> Enum.uniq()

    newer
    |> Map.put(:reply_refs, reply_refs)
    |> Map.put(:broadcast, Map.get(older, :broadcast, false) or Map.get(newer, :broadcast, false))
    |> Map.put(:changed, Map.get(older, :changed, false) or Map.get(newer, :changed, false))
  end

  defp find_goal_status_read_by_ref(state, ref) do
    Enum.find_value(state, fn
      {{:goal_status_read, thread_id}, %{monitor_ref: ^ref} = resolver} -> {thread_id, resolver}
      _ -> nil
    end)
  end

  defp enqueue_goal_mutation(state, thread_id, request) do
    case Map.get(state, {:goal_mutation, thread_id}) do
      nil -> start_next_goal_mutation(state, thread_id, [request])
      mutation -> Map.put(state, {:goal_mutation, thread_id}, %{mutation | queue: mutation.queue ++ [request]})
    end
  end

  defp start_next_goal_mutation(state, thread_id, []) do
    Map.delete(state, {:goal_mutation, thread_id})
  end

  defp start_next_goal_mutation(state, thread_id, [request | rest]) do
    manager = self()

    {:ok, pid} =
      Task.start(fn ->
        result =
          try do
            request.operation.()
          rescue
            error -> {:error, {:goal_mutation_failed, Exception.message(error)}}
          catch
            kind, reason -> {:error, {:goal_mutation_failed, {kind, reason}}}
          end

        send(manager, {:goal_mutation_done, thread_id, result})
      end)

    Map.put(state, {:goal_mutation, thread_id}, %{
      current: request,
      queue: rest,
      worker: pid,
      monitor_ref: Process.monitor(pid)
    })
  end

  defp maybe_drain_after_goal_mutation(thread_id, state) do
    if Map.has_key?(state, {:goal_mutation, thread_id}) or
         Map.has_key?(state, {:turn, thread_id}),
       do: state,
       else: drain_queue(thread_id, state)
  end

  defp find_goal_mutation_by_ref(state, ref) do
    Enum.find_value(state, fn
      {{:goal_mutation, thread_id}, %{monitor_ref: ^ref} = mutation} -> {thread_id, mutation}
      _ -> nil
    end)
  end

  defp do_start_turn(thread_id, prompt, opts, state) do
    run = Keyword.get(opts, :run)
    generation = System.unique_integer([:positive, :monotonic]) |> Integer.to_string()

    if is_function(run, 0) do
      with {:ok, thread} <- History.get_thread(thread_id),
           {:ok, _updated} <- History.start_turn_state(thread, start_attrs(prompt, opts, generation)),
           {:ok, pid} <- spawn_worker(thread_id, generation, run, Keyword.get(opts, :reply_to)) do
        ref = Process.monitor(pid)
        register(thread_id, {pid, nil})

        {:ok, refreshed} = History.get_thread(thread_id)
        broadcast_from(self(), thread_id, {:turn_status, :running, History.turn_payload(refreshed)})

        reply_to = Keyword.get(opts, :reply_to)

        state =
          Map.put(state, {:turn, thread_id}, %{
            monitor_ref: ref,
            pid: pid,
            reply_to: reply_to,
            generation: generation
          })

        {:reply, {:ok, %{pid: pid, generation: generation}}, state}
      else
        {:error, reason} ->
          rollback_failed_start(thread_id, reason)
          {:reply, {:error, reason}, state}

        _ ->
          rollback_failed_start(thread_id, :invalid_start_opts)
          {:reply, {:error, :invalid_start_opts}, state}
      end
    else
      {:reply, {:error, :invalid_start_opts}, state}
    end
  end

  defp rollback_failed_start(thread_id, reason) do
    with {:ok, thread} <- History.get_thread(thread_id),
         true <- History.turn_running?(thread) do
      History.fail_turn_state(thread, reason)
    else
      _ -> :ok
    end
  end

  defp start_attrs(prompt, opts, generation) do
    %{
      generation: generation,
      trigger: Keyword.get(opts, :trigger, "user"),
      prompt: prompt,
      agent_kind: Keyword.get(opts, :agent_kind),
      model: Keyword.get(opts, :model),
      effort: Keyword.get(opts, :effort),
      codex_thread_id: Keyword.get(opts, :codex_thread_id)
    }
  end

  defp spawn_worker(thread_id, generation, run, reply_to) do
    Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor, fn ->
      result = run.()

      case __MODULE__.finish_turn(thread_id, generation, result) do
        {:accepted, accepted_result} ->
          if is_pid(reply_to),
            do: send(reply_to, {:assistant_turn_finished, generation, accepted_result})

        _ ->
          :ok
      end
    end)
  end

  defp persist_finish(thread_id, generation, result) do
    with {:ok, thread} <- History.get_thread(thread_id) do
      case History.current_turn(thread) do
        %{"generation" => ^generation, "status" => "running"} ->
          persistence_result =
            case result do
              {:ok, data} when is_map(data) ->
                History.complete_turn_state(thread, %{
                  codex_thread_id: Map.get(data, :codex_thread_id),
                  turn_id: Map.get(data, :turn_id)
                })

              {:error, reason} ->
                History.fail_turn_state(thread, reason)
            end

          case persistence_result do
            {:ok, _updated_thread} -> :ok
            {:error, reason} -> {:error, reason}
          end

        _ ->
          :stale
      end
    end
  end

  defp maybe_interrupt_running(thread_id, generation, _reason) do
    with {:ok, thread} <- History.get_thread(thread_id),
         %{"status" => "running", "generation" => ^generation} <- History.current_turn(thread) do
      History.interrupt_turn_state_if_running(thread, "task_crash")
    end
  end

  defp persist_interrupt(thread_id, reason) do
    with {:ok, thread} <- History.get_thread(thread_id),
         result <- History.interrupt_turn_state_if_running(thread, reason) do
      result
    end
  end

  defp await_worker_termination(nil, _monitor_ref, _timeout), do: :ok

  defp await_worker_termination(worker_pid, monitor_ref, timeout)
       when is_pid(worker_pid) and is_reference(monitor_ref) do
    receive do
      {:DOWN, ^monitor_ref, :process, ^worker_pid, _reason} -> :ok
    after
      timeout ->
        Process.exit(worker_pid, :kill)

        receive do
          {:DOWN, ^monitor_ref, :process, ^worker_pid, _reason} -> {:error, :interrupt_timeout}
        after
          1_000 -> {:error, :interrupt_termination_unconfirmed}
        end
    end
  end

  defp confirm_interrupted(thread_id) do
    with false <- running?(thread_id),
         {:ok, thread} <- History.get_thread(thread_id),
         %{"status" => "interrupted"} <- History.current_turn(thread) do
      :ok
    else
      true -> {:error, :assistant_still_running}
      _ -> {:error, :interrupt_not_confirmed}
    end
  end

  defp fetch_active_tool(thread, tool_call_id) do
    thread
    |> History.current_turn()
    |> active_tools()
    |> Enum.find(&active_tool_id?(&1, tool_call_id))
    |> case do
      nil -> {:error, :tool_not_running}
      active_tool -> {:ok, active_tool}
    end
  end

  defp active_tools(%{"active_tools" => tools}) when is_list(tools), do: Enum.filter(tools, &is_map/1)
  defp active_tools(_turn), do: []

  defp active_tool_id?(tool, tool_call_id) when is_map(tool) do
    Map.get(tool, "id") == tool_call_id or Map.get(tool, :id) == tool_call_id
  end

  defp send_kill_tool(worker_pid, tool_call_id) do
    send(worker_pid, {:kill_tool, tool_call_id})
    :ok
  end

  defp broadcast_killed_tool(thread_id, active_tool) do
    broadcast_from(
      self(),
      thread_id,
      {:turn_stream, "tool_call_completed", %{tool_call: canceled_tool_payload(active_tool)}}
    )
  end

  defp canceled_tool_payload(active_tool) do
    %{
      id: Map.get(active_tool, "id") || Map.get(active_tool, :id),
      name: Map.get(active_tool, "name") || Map.get(active_tool, :name),
      status: "canceled"
    }
  end

  defp interrupt_worker_pid(thread_id, state) do
    case lookup(thread_id) do
      {pid, _turn_id} when is_pid(pid) ->
        pid

      _ ->
        case Map.get(state, {:turn, thread_id}) do
          %{pid: pid} when is_pid(pid) -> pid
          _ -> nil
        end
    end
  end

  defp cleanup_interrupted_turn(thread_id, preserve_queue?, state) do
    case Map.pop(state, {:turn, thread_id}) do
      {%{monitor_ref: ref}, rest} ->
        Process.demonitor(ref, [:flush])
        unregister(thread_id)
        maybe_delete_turn_queue(rest, thread_id, preserve_queue?)

      {_entry, rest} ->
        unregister(thread_id)
        maybe_delete_turn_queue(rest, thread_id, preserve_queue?)
    end
  end

  defp maybe_delete_turn_queue(state, _thread_id, true), do: state
  defp maybe_delete_turn_queue(state, thread_id, false), do: Map.delete(state, {:queue, thread_id})

  defp maybe_drain_after_turn(thread_id, state) do
    if Map.has_key?(state, {:goal_mutation, thread_id}),
      do: state,
      else: drain_queue(thread_id, state)
  end

  defp drain_queue(thread_id, state) do
    case Map.get(state, {:queue, thread_id}, []) do
      [] ->
        state

      [next | rest] ->
        state =
          if rest == [],
            do: Map.delete(state, {:queue, thread_id}),
            else: Map.put(state, {:queue, thread_id}, rest)

        case do_start_turn(thread_id, next.prompt, ensure_run(next.opts, next.prompt), state) do
          {:reply, {:ok, _}, new_state} -> new_state
          {:reply, _err, new_state} -> drain_queue(thread_id, new_state)
        end
    end
  end

  defp ensure_run(opts, prompt) do
    case Keyword.get(opts, :run) do
      run when is_function(run, 0) ->
        opts

      _ ->
        case Keyword.get(opts, :run_builder) do
          builder when is_function(builder, 1) -> Keyword.put(opts, :run, builder.(prompt))
          _ -> opts
        end
    end
  end

  defp find_turn_by_ref(state, ref) do
    Enum.find_value(state, fn
      {{:turn, thread_id}, %{monitor_ref: ^ref} = entry} -> {thread_id, entry}
      _ -> nil
    end)
  end

  defp broadcast_finish(thread_id, result) do
    thread =
      case History.get_thread(thread_id) do
        {:ok, thread} -> thread
        _ -> nil
      end

    payload = History.turn_payload(thread)
    status = finish_status(payload, result)

    maybe_push_turn_completed(thread, status)
    maybe_schedule_auto_title(thread_id, status)
    broadcast_from(self(), thread_id, {:turn_status, status, payload})
  end

  defp maybe_schedule_auto_title(thread_id, :finished) when is_integer(thread_id) do
    _ =
      Task.start(fn ->
        TitleGenerator.maybe_auto_generate(thread_id)
      end)

    :ok
  end

  defp maybe_schedule_auto_title(_thread_id, _status), do: :ok

  defp maybe_push_turn_completed(thread, status) when is_map(thread) and status in [:finished, :failed] do
    dispatcher =
      Application.get_env(:symphony_elixir, :push_dispatcher, SymphonyElixir.PushNotifications.Dispatcher)

    dispatcher.assistant_turn_completed(thread, status)
  end

  defp maybe_push_turn_completed(_thread, _status), do: :ok

  defp finish_status(%{status: "completed"}, _result), do: :finished
  defp finish_status(%{status: "interrupted"}, _result), do: :interrupted
  defp finish_status(%{status: "failed"}, _result), do: :failed
  defp finish_status(_payload, {:ok, _}), do: :finished
  defp finish_status(_payload, _result), do: :failed

  defp register(thread_id, value),
    do: safe_registry(fn -> Registry.register(@registry, thread_id, value) end)

  defp update_registry(thread_id, value) do
    safe_registry(fn -> Registry.update_value(@registry, thread_id, fn _ -> value end) end)
  end

  defp unregister(thread_id), do: safe_registry(fn -> Registry.unregister(@registry, thread_id) end)

  defp lookup(thread_id) do
    case safe_registry(fn -> Registry.lookup(@registry, thread_id) end) do
      [{_owner, value} | _] -> value
      _ -> nil
    end
  end

  defp safe_registry(fun) do
    fun.()
  rescue
    ArgumentError -> nil
  end

  defp safe_reconcile do
    History.reconcile_orphaned_turns()
  rescue
    error ->
      Logger.warning("assistant turns: boot reconcile failed: #{inspect(error)}")
      :error
  end

  defp notify_reply_to(%{reply_to: reply_to, generation: generation}, result) when is_pid(reply_to) do
    send(reply_to, {:assistant_turn_finished, generation, result})
  end

  defp notify_reply_to(_entry, _result), do: :ok
end
