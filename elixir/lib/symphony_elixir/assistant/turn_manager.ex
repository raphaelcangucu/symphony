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

  alias SymphonyElixir.Assistant.{GoalRun, History}

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
          {:ok, %{pid: pid()}} | {:error, :turn_in_progress | term()}
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
  @spec finish_turn(integer(), {:ok, map()} | {:error, term()}) :: :ok
  def finish_turn(thread_id, result) when is_integer(thread_id) do
    GenServer.cast(__MODULE__, {:finish_turn, thread_id, result})
  end

  @doc "Append a turn to the thread's FIFO queue (runs when the current turn finishes)."
  @spec enqueue(integer(), String.t(), start_opts()) :: :ok
  def enqueue(thread_id, prompt, opts) when is_integer(thread_id) do
    GenServer.cast(__MODULE__, {:enqueue, thread_id, prompt, opts})
  end

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
  def handle_call({:start_turn, thread_id, prompt, opts}, _from, state) do
    if running?(thread_id) do
      {:reply, {:error, :turn_in_progress}, state}
    else
      do_start_turn(thread_id, prompt, opts, state)
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

  def handle_cast({:finish_turn, thread_id, result}, state) do
    case Map.pop(state, {:turn, thread_id}) do
      {%{monitor_ref: ref}, rest} ->
        Process.demonitor(ref, [:flush])
        persist_finish(thread_id, result)
        unregister(thread_id)
        broadcast_finish(thread_id, result)
        {:noreply, drain_queue(thread_id, rest)}

      {nil, _rest} ->
        {:noreply, state}
    end
  end

  def handle_cast({:enqueue, thread_id, prompt, opts}, state) do
    if Map.has_key?(state, {:turn, thread_id}) do
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
  def handle_info({:DOWN, ref, :process, _pid, reason}, state) do
    case find_turn_by_ref(state, ref) do
      {thread_id, entry} ->
        maybe_interrupt_running(thread_id, reason)
        unregister(thread_id)
        result = {:error, {:turn_crashed, reason}}
        notify_reply_to(entry, result)
        broadcast_finish(thread_id, result)
        {_popped, rest} = Map.pop(state, {:turn, thread_id})
        {:noreply, drain_queue(thread_id, rest)}

      nil ->
        {:noreply, state}
    end
  end

  def handle_info(_msg, state), do: {:noreply, state}

  # --- internals -------------------------------------------------------------

  defp do_start_turn(thread_id, prompt, opts, state) do
    run = Keyword.get(opts, :run)

    if is_function(run, 0) do
      with {:ok, thread} <- History.get_thread(thread_id),
           {:ok, _updated} <- History.start_turn_state(thread, start_attrs(prompt, opts)),
           {:ok, pid} <- spawn_worker(thread_id, run, Keyword.get(opts, :reply_to)) do
        ref = Process.monitor(pid)
        register(thread_id, {pid, nil})

        {:ok, refreshed} = History.get_thread(thread_id)
        broadcast_from(self(), thread_id, {:turn_status, :running, History.turn_payload(refreshed)})

        reply_to = Keyword.get(opts, :reply_to)

        state =
          Map.put(state, {:turn, thread_id}, %{
            monitor_ref: ref,
            pid: pid,
            reply_to: reply_to
          })

        {:reply, {:ok, %{pid: pid}}, state}
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

  defp start_attrs(prompt, opts) do
    %{
      trigger: Keyword.get(opts, :trigger, "user"),
      prompt: prompt,
      agent_kind: Keyword.get(opts, :agent_kind),
      model: Keyword.get(opts, :model),
      effort: Keyword.get(opts, :effort),
      codex_thread_id: Keyword.get(opts, :codex_thread_id)
    }
  end

  defp spawn_worker(thread_id, run, reply_to) do
    Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor, fn ->
      result = run.()
      __MODULE__.finish_turn(thread_id, result)
      if is_pid(reply_to), do: send(reply_to, {:assistant_turn_finished, result})
    end)
  end

  defp persist_finish(thread_id, result) do
    with {:ok, thread} <- History.get_thread(thread_id) do
      case result do
        {:ok, data} when is_map(data) ->
          History.complete_turn_state(thread, %{
            codex_thread_id: Map.get(data, :codex_thread_id),
            turn_id: Map.get(data, :turn_id)
          })

        {:error, reason} ->
          History.fail_turn_state(thread, reason)
      end
    end
  end

  defp maybe_interrupt_running(thread_id, _reason) do
    with {:ok, thread} <- History.get_thread(thread_id),
         true <- History.turn_running?(thread) do
      History.interrupt_turn_state(thread, "task_crash")
    end
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
    payload =
      case History.get_thread(thread_id) do
        {:ok, thread} -> History.turn_payload(thread)
        _ -> nil
      end

    broadcast_from(self(), thread_id, {:turn_status, finish_status(payload, result), payload})
  end

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

  defp notify_reply_to(%{reply_to: reply_to}, result) when is_pid(reply_to) do
    send(reply_to, {:assistant_turn_finished, result})
  end

  defp notify_reply_to(_entry, _result), do: :ok
end
