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

  A durable per-thread FIFO queue serializes additional turns requested while
  one is running, preventing overlapping provider conversations and surviving
  process restarts.

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
          model: String.t() | nil,
          effort: String.t() | nil,
          provider: String.t() | nil,
          conversation_id: String.t() | nil,
          client_message_id: String.t() | nil,
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
          {:ok, %{pid: pid(), execution_id: String.t()}}
          | {:ok, :duplicate}
          | {:error, :turn_in_progress | term()}
  def start_turn(thread_id, prompt, opts)
      when is_integer(thread_id) and is_binary(prompt) and is_list(opts) do
    GenServer.call(__MODULE__, {:start_turn, thread_id, prompt, opts})
  end

  @doc "Records provider-neutral conversation/run identity after a turn starts."
  @spec note_run(integer(), String.t(), String.t() | nil, String.t() | nil) :: :ok
  def note_run(thread_id, provider, conversation_id, run_id)
      when is_integer(thread_id) and is_binary(provider) do
    GenServer.cast(
      __MODULE__,
      {:note_run, thread_id, provider, conversation_id, run_id}
    )
  end

  @doc "Mark the running turn finished (completed/failed) and drain the queue."
  @spec finish_turn(integer(), String.t(), {:ok, map()} | {:error, term()}) ::
          {:accepted, {:ok, map()} | {:error, term()}} | :stale | {:error, term()}
  def finish_turn(thread_id, execution_id, result)
      when is_integer(thread_id) and is_binary(execution_id) do
    GenServer.call(__MODULE__, {:finish_turn, thread_id, execution_id, result})
  end

  @doc "Append a turn to the thread's FIFO queue (runs when the current turn finishes)."
  @spec enqueue(integer(), String.t(), start_opts()) :: :ok | {:error, term()}
  def enqueue(thread_id, prompt, opts) when is_integer(thread_id) do
    GenServer.call(__MODULE__, {:enqueue, thread_id, prompt, opts})
  end

  @doc """
  Rehydrates durable pending turn intents with fresh runtime closures.

  Durable queue entries intentionally contain no pids or functions. A channel
  reconnect supplies a builder and the manager resumes FIFO execution.
  """
  @spec recover_pending(integer(), (map() -> (-> term())), keyword()) ::
          {:ok, non_neg_integer()} | {:error, term()}
  def recover_pending(thread_id, recovery_builder, opts \\ [])
      when is_integer(thread_id) and is_function(recovery_builder, 1) and is_list(opts) do
    GenServer.call(
      __MODULE__,
      {:recover_pending, thread_id, recovery_builder, opts}
    )
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

  @doc "Resolve the live worker pid + provider run id for cross-channel steer/interrupt."
  @spec steer_target(integer()) :: {:ok, pid(), String.t() | nil} | :error
  def steer_target(thread_id) when is_integer(thread_id) do
    case lookup(thread_id) do
      {pid, run_id} when is_pid(pid) -> {:ok, pid, run_id}
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
    cond do
      duplicate_running_client_message?(state, thread_id, opts) ->
        {:reply, {:ok, :duplicate}, state}

      running?(thread_id) or Map.has_key?(state, {:goal_mutation, thread_id}) ->
        {:reply, {:error, :turn_in_progress}, state}

      true ->
        do_start_turn(thread_id, prompt, opts, state)
    end
  end

  def handle_call({:enqueue, thread_id, prompt, opts}, _from, state) do
    case persist_queued_turn(thread_id, prompt, opts) do
      {:ok, queue_id} ->
        queued_entry = %{prompt: prompt, opts: opts, queue_id: queue_id}

        if Map.has_key?(state, {:turn, thread_id}) or
             Map.has_key?(state, {:goal_mutation, thread_id}) do
          queued = Map.get(state, {:queue, thread_id}, [])
          {:reply, :ok, Map.put(state, {:queue, thread_id}, queued ++ [queued_entry])}
        else
          case start_queued_turn(thread_id, queued_entry, state) do
            {:ok, new_state} -> {:reply, :ok, new_state}
            {:error, reason, new_state} -> {:reply, {:error, reason}, new_state}
          end
        end

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call(
        {:recover_pending, thread_id, recovery_builder, base_opts},
        _from,
        state
      ) do
    with {:ok, thread} <- History.get_thread(thread_id) do
      entries =
        thread
        |> History.pending_turns()
        |> Enum.reject(&queue_id_loaded?(state, thread_id, &1["id"]))
        |> Enum.map(&rehydrate_queued_entry(&1, recovery_builder, base_opts))

      state = append_recovered_queue(state, thread_id, entries)
      {:reply, {:ok, length(entries)}, maybe_start_recovered_queue(thread_id, state)}
    else
      {:error, reason} -> {:reply, {:error, reason}, state}
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
  def handle_call({:finish_turn, thread_id, execution_id, result}, _from, state) do
    case Map.get(state, {:turn, thread_id}) do
      %{execution_id: ^execution_id, monitor_ref: ref} ->
        case persist_finish(thread_id, execution_id, result) do
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
        interrupted_entry = Map.get(state, {:turn, thread_id})
        if is_pid(worker_pid), do: send(worker_pid, {:agent_interrupt})
        updated_thread = maybe_clear_durable_queue(updated_thread, preserve_queue?)
        state = cleanup_interrupted_turn(thread_id, preserve_queue?, state)
        notify_reply_to(interrupted_entry, {:error, :interrupted})
        broadcast_from(self(), thread_id, {:turn_status, :interrupted, History.turn_payload(updated_thread)})
        {:reply, :ok, state}

      {:already_finished, _thread} ->
        {:reply, {:ok, :already_finished}, state}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_cast({:note_run, thread_id, provider, conversation_id, run_id}, state) do
    case lookup(thread_id) do
      {pid, _old} when is_pid(pid) ->
        update_registry(thread_id, {pid, run_id})

        with {:ok, thread} <- History.get_thread(thread_id) do
          History.note_run_identity(thread, %{
            provider: provider,
            conversation_id: conversation_id,
            run_id: run_id
          })
        end

      _ ->
        :ok
    end

    {:noreply, state}
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
        interrupt_result = maybe_interrupt_running(thread_id, entry.execution_id, reason)
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
    execution_id = System.unique_integer([:positive, :monotonic]) |> Integer.to_string()

    if is_function(run, 0) do
      with {:ok, thread} <- History.get_thread(thread_id),
           {:ok, _updated} <- History.start_turn_state(thread, start_attrs(prompt, opts, execution_id)),
           {:ok, pid} <- spawn_worker(thread_id, execution_id, run, Keyword.get(opts, :reply_to)) do
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
            execution_id: execution_id,
            client_message_id: Keyword.get(opts, :client_message_id)
          })

        {:reply, {:ok, %{pid: pid, execution_id: execution_id}}, state}
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

  defp duplicate_running_client_message?(state, thread_id, opts) do
    client_message_id = Keyword.get(opts, :client_message_id)

    is_binary(client_message_id) and client_message_id != "" and
      match?(
        %{client_message_id: ^client_message_id},
        Map.get(state, {:turn, thread_id})
      )
  end

  defp start_attrs(prompt, opts, execution_id) do
    %{
      execution_id: execution_id,
      trigger: Keyword.get(opts, :trigger, "user"),
      prompt: prompt,
      model: Keyword.get(opts, :model),
      effort: Keyword.get(opts, :effort),
      provider: Keyword.get(opts, :provider),
      conversation_id: Keyword.get(opts, :conversation_id),
      queue_id: Keyword.get(opts, :queue_id),
      client_message_id: Keyword.get(opts, :client_message_id)
    }
  end

  defp spawn_worker(thread_id, execution_id, run, reply_to) do
    Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor, fn ->
      result = run.()

      case __MODULE__.finish_turn(thread_id, execution_id, result) do
        {:accepted, accepted_result} ->
          if is_pid(reply_to),
            do: send(reply_to, {:assistant_turn_finished, execution_id, accepted_result})

        _ ->
          :ok
      end
    end)
  end

  defp persist_finish(thread_id, execution_id, result) do
    with {:ok, thread} <- History.get_thread(thread_id) do
      case History.current_turn(thread) do
        %{"execution_id" => ^execution_id, "status" => "running"} ->
          persistence_result =
            case result do
              {:ok, data} when is_map(data) ->
                History.complete_turn_state(thread, result_identity_attrs(data))

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

  defp result_identity_attrs(data) do
    %{
      provider: Map.get(data, :provider),
      conversation_id: Map.get(data, :conversation_id),
      run_id: Map.get(data, :run_id),
      execution_id: Map.get(data, :execution_id)
    }
  end

  defp maybe_interrupt_running(thread_id, execution_id, _reason) do
    with {:ok, thread} <- History.get_thread(thread_id),
         %{"status" => "running", "execution_id" => ^execution_id} <- History.current_turn(thread) do
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

  defp maybe_clear_durable_queue(thread, true), do: thread

  defp maybe_clear_durable_queue(thread, false) do
    case History.clear_pending_turns(thread) do
      {:ok, updated} ->
        updated

      {:error, reason} ->
        Logger.warning("assistant turns: could not clear durable queue thread_id=#{thread.id} reason=#{inspect(reason)}")

        thread
    end
  end

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

        case start_queued_turn(thread_id, next, state) do
          {:ok, new_state} -> new_state
          {:error, _reason, new_state} -> drain_queue(thread_id, new_state)
        end
    end
  end

  defp start_queued_turn(thread_id, queued_entry, state) do
    opts =
      queued_entry.opts
      |> ensure_run(queued_entry.prompt)
      |> Keyword.put(:queue_id, queued_entry.queue_id)

    case do_start_turn(thread_id, queued_entry.prompt, opts, state) do
      {:reply, {:ok, _}, new_state} ->
        {:ok, new_state}

      {:reply, {:error, reason}, new_state} ->
        {:error, reason, new_state}
    end
  end

  defp rehydrate_queued_entry(entry, recovery_builder, base_opts) do
    opts =
      base_opts
      |> Keyword.put(:run, recovery_builder.(entry))
      |> Keyword.put(:trigger, entry["trigger"] || "recovery")
      |> Keyword.put(:provider, entry["provider"])
      |> Keyword.put(:model, entry["model"])
      |> Keyword.put(:effort, entry["effort"])

    %{prompt: entry["prompt"], opts: opts, queue_id: entry["id"]}
  end

  defp append_recovered_queue(state, _thread_id, []), do: state

  defp append_recovered_queue(state, thread_id, entries) do
    existing = Map.get(state, {:queue, thread_id}, [])
    Map.put(state, {:queue, thread_id}, existing ++ entries)
  end

  defp maybe_start_recovered_queue(thread_id, state) do
    if running?(thread_id) or Map.has_key?(state, {:turn, thread_id}) or
         Map.has_key?(state, {:goal_mutation, thread_id}),
       do: state,
       else: drain_queue(thread_id, state)
  end

  defp queue_id_loaded?(state, thread_id, queue_id) do
    state
    |> Map.get({:queue, thread_id}, [])
    |> Enum.any?(&(&1.queue_id == queue_id))
  end

  defp persist_queued_turn(thread_id, prompt, opts) do
    with {:ok, thread} <- History.get_thread(thread_id),
         {:ok, _updated, entry} <-
           History.enqueue_pending_turn(thread, %{
             prompt: prompt,
             trigger: Keyword.get(opts, :trigger, "user"),
             provider: Keyword.get(opts, :provider),
             model: Keyword.get(opts, :model),
             effort: Keyword.get(opts, :effort),
             context: Keyword.get(opts, :queue_context, %{})
           }) do
      {:ok, entry["id"]}
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

  defp notify_reply_to(%{reply_to: reply_to, execution_id: execution_id}, result) when is_pid(reply_to) do
    send(reply_to, {:assistant_turn_finished, execution_id, result})
  end

  defp notify_reply_to(_entry, _result), do: :ok
end
