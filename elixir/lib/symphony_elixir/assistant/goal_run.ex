defmodule SymphonyElixir.Assistant.GoalRun do
  @moduledoc """
  Durable, thread-scoped tracking of in-flight assistant goal turns so the
  "executing" state survives a page refresh (and is visible to other open tabs).

  The assistant turn pipeline is otherwise entirely socket-bound: streaming
  callbacks and the `{:assistant_turn_finished}` message target the *originating*
  channel process. When the operator reloads the page that channel dies, the
  continuation Task (which lives under `SymphonyElixir.TaskSupervisor`, not the
  channel) keeps running, and the freshly-joined channel has no idea a turn is in
  flight. The pill then shows idle even though work is happening.

  This module fixes that with two cheap primitives:

    * an Elixir `Registry` (`:duplicate` keys) keyed by `thread_id`. The run Task
      registers itself; because Registry entries are owned by the registering
      process, a crashed/finished Task auto-removes its entry. Any channel can ask
      "is a run active for this thread, and when did it start?" without touching
      the channel that started it.

    * a per-thread `Phoenix.PubSub` topic used to fan run lifecycle events out to
      every channel subscribed to the thread (including a reloaded tab), so the
      result lands and the "executing" indicator clears without a manual refresh.

  All registry operations are tolerant of the registry not being started (e.g. in
  unit tests that don't boot the shared supervisor) so callers never need a guard.
  """

  @registry __MODULE__.Registry
  @pubsub SymphonyElixir.PubSub

  @doc "Child spec for the backing registry; added to the shared (always-on) supervisor."
  @spec registry_child_spec() :: {module(), keyword()}
  def registry_child_spec, do: {Registry, keys: :duplicate, name: @registry}

  @doc """
  Marks the *calling* process as running a goal turn for `thread_id`. Meant to be
  called at the top of the run Task; the entry is removed automatically when the
  Task exits (success or crash), or explicitly via `untrack/1`.
  """
  @spec track(integer()) :: :ok
  def track(thread_id) when is_integer(thread_id) do
    _ = Registry.register(@registry, thread_id, System.system_time(:millisecond))
    :ok
  rescue
    ArgumentError -> :ok
  end

  @doc "Removes the calling process's run entry for `thread_id` (idempotent)."
  @spec untrack(integer()) :: :ok
  def untrack(thread_id) when is_integer(thread_id) do
    _ = Registry.unregister(@registry, thread_id)
    :ok
  rescue
    ArgumentError -> :ok
  end

  @doc "Wall-clock millisecond timestamp of the earliest active run for the thread, or nil."
  @spec started_at(integer()) :: integer() | nil
  def started_at(thread_id) when is_integer(thread_id) do
    case Registry.lookup(@registry, thread_id) do
      [] -> nil
      entries -> entries |> Enum.map(fn {_pid, ts} -> ts end) |> Enum.min()
    end
  rescue
    ArgumentError -> nil
  end

  @doc "True when at least one goal turn is currently running for the thread."
  @spec running?(integer()) :: boolean()
  def running?(thread_id) when is_integer(thread_id), do: started_at(thread_id) != nil

  @doc "Whole seconds the current run has been executing, or nil when idle."
  @spec elapsed_seconds(integer()) :: non_neg_integer() | nil
  def elapsed_seconds(thread_id) when is_integer(thread_id) do
    case started_at(thread_id) do
      nil -> nil
      ts -> max(0, div(System.system_time(:millisecond) - ts, 1000))
    end
  end

  @doc "PubSub topic carrying run lifecycle events for a thread."
  @spec topic(integer()) :: String.t()
  def topic(thread_id) when is_integer(thread_id), do: "assistant_thread:#{thread_id}"

  @doc "Subscribe the calling process (a channel) to a thread's run lifecycle events."
  @spec subscribe(integer()) :: :ok
  def subscribe(thread_id) when is_integer(thread_id) do
    _ = Phoenix.PubSub.subscribe(@pubsub, topic(thread_id))
    :ok
  rescue
    ArgumentError -> :ok
  end

  @doc """
  Broadcast a run lifecycle event to every subscriber *except* `from_pid`.

  `from_pid` is the originating channel: it drives its own socket directly
  (live streaming + `assistant_completed`), so excluding it prevents a duplicate.
  Reloaded/other tabs (different pids) still receive the event and reconcile.
  """
  @spec broadcast_from(pid(), integer(), term()) :: :ok
  def broadcast_from(from_pid, thread_id, message) when is_pid(from_pid) and is_integer(thread_id) do
    _ = Phoenix.PubSub.broadcast_from(@pubsub, from_pid, topic(thread_id), message)
    :ok
  rescue
    ArgumentError -> :ok
  end
end
