# Assistant Turn & Codex Session Tracking Implementation Plan

**Goal:** Make every assistant chat turn durably trackable (status, Codex session/turn ids, timing) so that after a page refresh *or a full serve restart* we always know whether the last turn is running, completed, failed, or interrupted — and let the operator Resume an interrupted turn with one click.

**Architecture:** Two cooperating layers mirroring the orchestrator. (1) **Durable layer with no new table:** the *current/last* turn state is persisted on the existing `assistant_threads.metadata` JSON column (the same pattern `mode`/`goal_mode`/`goal_objective` already use), written through `History`. Full per-turn audit history stays in `log/symphony.log`. (2) **Live layer:** an always-on `Assistant.TurnManager` GenServer (in `SharedSupervisor`) owns turn start/finish, holds the live worker pid in a `:unique` `Registry` (for cross-channel steer/interrupt), monitors the worker (abnormal exit → `interrupted`), reconciles orphaned `running` threads to `interrupted` on boot, and serializes one main turn per thread (steer-then-queue). The Phoenix channel delegates worker lifecycle to `TurnManager`, keeps streaming on the originating socket, fans lifecycle over the existing per-thread PubSub topic, and exposes `last_turn` + `resume_turn`.

**Tech Stack:** Elixir / Phoenix Channels, Ecto + SQLite (Exqlite), Elixir `Registry` + `Phoenix.PubSub`, React/TypeScript (`tracker/`), ExUnit, Vitest.

**Design doc:** `docs/superpowers/specs/2026-06-21-assistant-turn-session-tracking-design.md` (revised 2026-06-21: persist in metadata, no new table).

---

## Conventions for the executing engineer (read first)

- All Elixir paths below are under the repo's `elixir/` app. Run mix commands **from `elixir/`** (e.g. `cd elixir && mix test ...`).
- **No migration and no new table.** Durable turn state lives in `assistant_threads.metadata["current_turn"]`, exactly like `mode`/`goal_mode`/`goal_objective` (`history.ex:160-240`). Historical audit of past turns is the existing `log/symphony.log`.
- `metadata` is a JSON-encoded `:map`. Store datetimes as **ISO8601 strings** (`DateTime.to_iso8601/1`) and parse with `DateTime.from_iso8601/1`. Use **string keys** for everything inside `current_turn`.
- This project enforces `@spec` on every **public** `def` in `lib/` (checked by `mix specs.check`). Every public function below already includes a `@spec` — keep them.
- Quality gate after each task: `cd elixir && mix test <touched test files>`; before commit run `make all` from repo root. If `make all` is slow mid-task, run the targeted `mix test` shown and defer `make all` to the end of the task.
- DB-backed tests use `migrate_repo()` / `clean_repo()` helpers that already exist (see `elixir/test/symphony_elixir/assistant/history_test.exs:10-11`). Reuse them.
- Reuse `History.update_thread/2` (`history.ex:247-251`) for every metadata write — it runs the `Thread` changeset (which casts `:metadata`) and `Repo.update`. Do not write metadata with raw Ecto.
- The assistant turn already runs in a `Task` under `SymphonyElixir.TaskSupervisor` (always-on, in `SharedSupervisor`). We are not changing where the work runs; we add durable tracking + a manager around it.
- Keep commits small (one per task). Conventional Commits (`feat:`, `refactor:`, `test:`).

---

## File Structure

**New files**

- `elixir/lib/symphony_elixir/assistant/turn_manager.ex` — always-on GenServer: pid registry, monitor, boot reconcile, steer-then-queue, lifecycle broadcast.
- `elixir/test/symphony_elixir/assistant/turn_history_test.exs` — `History` metadata turn-function tests.
- `elixir/test/symphony_elixir/assistant/turn_manager_test.exs` — manager lifecycle/reconcile/queue tests.

**Changed files**

- `elixir/lib/symphony_elixir/assistant/history.ex` — metadata turn helpers (`start_turn_state/2`, `note_turn_codex/2`, `complete_turn_state/2`, `fail_turn_state/2`, `interrupt_turn_state/2`, `current_turn/1`, `turn_running?/1`, `turn_elapsed_seconds/1`, `turn_payload/1`, `reconcile_orphaned_turns/0`).
- `elixir/lib/symphony_elixir/shared_supervisor.ex` — start `TurnManager` + its registry in the always-on subtree (after `Repo`).
- `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` — start turns via `TurnManager`, cross-channel steer via `TurnManager`, subscribe all thread joins to the thread topic + include `last_turn`, handle `{:turn_status, …}`, add `resume_turn`, steer-then-queue on a busy send.
- `tracker/src/services/phoenix/assistantChannel.ts` — bind `turn_status`, surface `last_turn` from join, add a `resumeTurn` push helper.
- `tracker/src/components/assistant/ProjectAssistantPanel.tsx` — render Interrupted state + Resume button; reconcile running indicator from `turn_status`/`last_turn`.

**Unchanged (do not rebuild)**

- `elixir/lib/symphony_elixir/assistant/goal_run.ex` — kept as-is. `TurnManager` reuses its PubSub topic helpers via delegation, so `goal_run_test.exs` stays green.
- Delta/tool-call streaming fan-out — stays on the originating socket.

---

## Task 1: `History` metadata turn functions (durable layer)

No behavior change for users yet — this just adds the durable read/write helpers.

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/history.ex`
- Test: `elixir/test/symphony_elixir/assistant/turn_history_test.exs`

- [ ] **Step 1: Write failing tests**

Create `elixir/test/symphony_elixir/assistant/turn_history_test.exs`:

```elixir
defmodule SymphonyElixir.Assistant.TurnHistoryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.LocalTracker.Context

  setup do
    migrate_repo()
    clean_repo()
    {:ok, _project} = Context.ensure_project(%{name: "Turns", slug: "turns"})
    {:ok, thread} = History.ensure_thread("turns", %{workspace_path: "/tmp/assistant/turns"})
    {:ok, thread: thread}
  end

  test "start_turn_state writes a running current_turn", %{thread: thread} do
    assert {:ok, updated} =
             History.start_turn_state(thread, %{
               trigger: "user",
               prompt: "do the thing",
               agent_kind: "codex",
               model: "gpt-5-codex",
               effort: "high"
             })

    turn = History.current_turn(updated)
    assert turn["status"] == "running"
    assert turn["prompt"] == "do the thing"
    assert turn["agent_kind"] == "codex"
    assert is_binary(turn["started_at"])
    assert turn["finished_at"] == nil
    assert History.turn_running?(updated)
  end

  test "note_turn_codex fills codex ids and composes session_id", %{thread: thread} do
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})

    assert {:ok, updated} =
             History.note_turn_codex(thread, %{codex_thread_id: "ct-1", turn_id: "tn-9"})

    turn = History.current_turn(updated)
    assert turn["codex_thread_id"] == "ct-1"
    assert turn["turn_id"] == "tn-9"
    assert turn["session_id"] == "ct-1-tn-9"
  end

  test "complete_turn_state marks completed with finished_at", %{thread: thread} do
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})

    assert {:ok, updated} =
             History.complete_turn_state(thread, %{codex_thread_id: "ct-2", turn_id: "tn-2"})

    turn = History.current_turn(updated)
    assert turn["status"] == "completed"
    assert is_binary(turn["finished_at"])
    assert turn["session_id"] == "ct-2-tn-2"
    refute History.turn_running?(updated)
  end

  test "fail_turn_state records the error", %{thread: thread} do
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})
    assert {:ok, updated} = History.fail_turn_state(thread, "boom")
    turn = History.current_turn(updated)
    assert turn["status"] == "failed"
    assert turn["error"] == "boom"
    assert is_binary(turn["finished_at"])
  end

  test "interrupt_turn_state marks interrupted with a reason", %{thread: thread} do
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})
    assert {:ok, updated} = History.interrupt_turn_state(thread, "task_crash")
    turn = History.current_turn(updated)
    assert turn["status"] == "interrupted"
    assert turn["interrupted_reason"] == "task_crash"
  end

  test "turn_elapsed_seconds is non-negative while running and nil otherwise", %{thread: thread} do
    {:ok, running} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})
    assert History.turn_elapsed_seconds(running) >= 0

    {:ok, done} = History.complete_turn_state(running, %{})
    assert History.turn_elapsed_seconds(done) == nil
  end

  test "metadata writes preserve sibling keys (mode/goal_mode)", %{thread: thread} do
    {:ok, thread} = History.set_mode(thread, "complex")
    {:ok, thread} = History.set_goal_mode(thread, true)
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})

    assert History.thread_mode(thread) == "complex"
    assert History.thread_goal_mode(thread) == true
    assert History.turn_running?(thread)
  end

  test "reconcile_orphaned_turns flips running threads to interrupted(serve_restart)", %{thread: thread} do
    {:ok, _running} = History.start_turn_state(thread, %{trigger: "user", prompt: "stuck"})

    assert {:ok, 1} = History.reconcile_orphaned_turns()

    {:ok, reloaded} = History.get_thread(thread.id)
    turn = History.current_turn(reloaded)
    assert turn["status"] == "interrupted"
    assert turn["interrupted_reason"] == "serve_restart"
    assert is_binary(turn["finished_at"])
  end
end
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd elixir && mix test test/symphony_elixir/assistant/turn_history_test.exs`
Expected: FAIL with `function History.start_turn_state/2 is undefined or private` (and similar).

- [ ] **Step 3: Implement the metadata turn helpers**

In `elixir/lib/symphony_elixir/assistant/history.ex`, add the following. Place the public functions near `thread_goal_objective/1` (after the metadata getters around `:240`), and the private helpers in the `defp` region. Add the module attribute near the top of the module (next to other module attributes):

```elixir
  @current_turn_key "current_turn"
```

Public functions:

```elixir
  @doc "Write a fresh `running` current_turn onto the thread's metadata."
  @spec start_turn_state(Thread.t(), map()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def start_turn_state(%Thread{metadata: metadata} = thread, attrs) when is_map(attrs) do
    turn = %{
      "status" => "running",
      "trigger" => Map.get(attrs, :trigger, "user"),
      "prompt" => to_string(Map.get(attrs, :prompt, "")),
      "agent_kind" => stringify(Map.get(attrs, :agent_kind)),
      "model" => stringify(Map.get(attrs, :model)),
      "effort" => stringify(Map.get(attrs, :effort)),
      "codex_thread_id" => stringify(Map.get(attrs, :codex_thread_id)),
      "turn_id" => nil,
      "session_id" => nil,
      "error" => nil,
      "interrupted_reason" => nil,
      "started_at" => now_iso(),
      "finished_at" => nil
    }

    update_thread(thread, %{metadata: Map.put(metadata || %{}, @current_turn_key, turn)})
  end

  @doc "Fill the Codex thread/turn ids (and composed session_id) on the current turn."
  @spec note_turn_codex(Thread.t(), map()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def note_turn_codex(%Thread{} = thread, attrs) when is_map(attrs) do
    patch_current_turn(thread, fn turn -> merge_codex(turn, attrs) end)
  end

  @doc "Transition the current turn to completed."
  @spec complete_turn_state(Thread.t(), map()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def complete_turn_state(%Thread{} = thread, attrs) when is_map(attrs) do
    patch_current_turn(thread, fn turn ->
      turn
      |> merge_codex(attrs)
      |> Map.put("status", "completed")
      |> Map.put("finished_at", now_iso())
    end)
  end

  @doc "Transition the current turn to failed with an error string."
  @spec fail_turn_state(Thread.t(), term()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def fail_turn_state(%Thread{} = thread, reason) do
    patch_current_turn(thread, fn turn ->
      turn
      |> Map.put("status", "failed")
      |> Map.put("error", turn_error_text(reason))
      |> Map.put("finished_at", now_iso())
    end)
  end

  @doc "Transition the current turn to interrupted with a reason."
  @spec interrupt_turn_state(Thread.t(), String.t()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def interrupt_turn_state(%Thread{} = thread, reason) when is_binary(reason) do
    patch_current_turn(thread, fn turn ->
      turn
      |> Map.put("status", "interrupted")
      |> Map.put("interrupted_reason", reason)
      |> Map.put("finished_at", now_iso())
    end)
  end

  @doc "The current turn map stored on the thread metadata, or nil."
  @spec current_turn(Thread.t()) :: map() | nil
  def current_turn(%Thread{metadata: %{@current_turn_key => turn}}) when is_map(turn), do: turn
  def current_turn(%Thread{}), do: nil

  @doc "True when the thread's current turn is running."
  @spec turn_running?(Thread.t()) :: boolean()
  def turn_running?(%Thread{} = thread) do
    match?(%{"status" => "running"}, current_turn(thread))
  end

  @doc "Whole seconds the running turn has been executing, or nil when not running."
  @spec turn_elapsed_seconds(Thread.t()) :: non_neg_integer() | nil
  def turn_elapsed_seconds(%Thread{} = thread) do
    with %{"status" => "running", "started_at" => started} when is_binary(started) <-
           current_turn(thread),
         {:ok, dt, _offset} <- DateTime.from_iso8601(started) do
      max(0, DateTime.diff(DateTime.utc_now(), dt, :second))
    else
      _ -> nil
    end
  end

  @doc "Normalized current-turn payload for the channel/UI, or nil."
  @spec turn_payload(Thread.t() | map() | nil) :: map() | nil
  def turn_payload(nil), do: nil
  def turn_payload(%Thread{} = thread), do: turn_payload(current_turn(thread))

  def turn_payload(turn) when is_map(turn) do
    %{
      status: turn["status"],
      trigger: turn["trigger"],
      session_id: turn["session_id"],
      codex_thread_id: turn["codex_thread_id"],
      turn_id: turn["turn_id"],
      started_at: turn["started_at"],
      finished_at: turn["finished_at"],
      can_resume: turn["status"] == "interrupted"
    }
  end

  @doc "On boot: flip every thread whose current turn is still `running` to interrupted(serve_restart)."
  @spec reconcile_orphaned_turns() :: {:ok, non_neg_integer()}
  def reconcile_orphaned_turns do
    count =
      Thread
      |> Repo.all()
      |> Enum.reduce(0, fn thread, acc ->
        if turn_running?(thread) do
          case interrupt_turn_state(thread, "serve_restart") do
            {:ok, _} -> acc + 1
            _ -> acc
          end
        else
          acc
        end
      end)

    {:ok, count}
  end
```

Private helpers (place in the `defp` section):

```elixir
  defp patch_current_turn(%Thread{metadata: metadata} = thread, fun) do
    case current_turn(thread) do
      nil -> {:ok, thread}
      turn -> update_thread(thread, %{metadata: Map.put(metadata || %{}, @current_turn_key, fun.(turn))})
    end
  end

  defp merge_codex(turn, attrs) do
    codex_thread_id = stringify(Map.get(attrs, :codex_thread_id)) || turn["codex_thread_id"]
    turn_id = stringify(Map.get(attrs, :turn_id)) || turn["turn_id"]

    turn
    |> Map.put("codex_thread_id", codex_thread_id)
    |> Map.put("turn_id", turn_id)
    |> Map.put("session_id", compose_session_id(codex_thread_id, turn_id) || turn["session_id"])
  end

  defp compose_session_id(thread_id, turn_id)
       when is_binary(thread_id) and is_binary(turn_id),
       do: "#{thread_id}-#{turn_id}"

  defp compose_session_id(_thread_id, _turn_id), do: nil

  defp now_iso, do: DateTime.utc_now() |> DateTime.to_iso8601()

  defp stringify(nil), do: nil
  defp stringify(value) when is_binary(value), do: value
  defp stringify(value), do: to_string(value)

  defp turn_error_text(reason) when is_binary(reason), do: reason
  defp turn_error_text(reason), do: inspect(reason)
```

> `Repo.all/1`, `where/3`, `order_by/3` etc. are already imported in `history.ex`. `Thread` and `Repo` are already aliased. No new aliases needed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir/assistant/turn_history_test.exs`
Expected: PASS (9 tests).

- [ ] **Step 5: Spec gate**

Run: `cd elixir && mix specs.check`
Expected: no missing-spec errors for `history.ex`.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/history.ex \
        elixir/test/symphony_elixir/assistant/turn_history_test.exs
git commit -m "feat: persist assistant turn state on thread metadata"
```

---

## Task 2: `Assistant.TurnManager` GenServer + supervisor wiring

Introduces the live layer: a unique-key registry holding the worker pid, a monitor that interrupts on abnormal exit, boot reconciliation, the per-thread lifecycle broadcast, and the steer-then-queue FIFO. The channel is not wired to it yet (Task 3), so this is invisible to users.

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/turn_manager.ex`
- Modify: `elixir/lib/symphony_elixir/shared_supervisor.ex`
- Test: `elixir/test/symphony_elixir/assistant/turn_manager_test.exs`

- [ ] **Step 1: Write the `TurnManager` module**

Create `elixir/lib/symphony_elixir/assistant/turn_manager.ex`:

```elixir
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
    queued = Map.get(state, {:queue, thread_id}, [])
    {:noreply, Map.put(state, {:queue, thread_id}, queued ++ [%{prompt: prompt, opts: opts}])}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, reason}, state) do
    case find_turn_by_ref(state, ref) do
      {thread_id, _entry} ->
        maybe_interrupt_running(thread_id, reason)
        unregister(thread_id)
        broadcast_finish(thread_id, {:error, {:turn_crashed, reason}})
        {_popped, rest} = Map.pop(state, {:turn, thread_id})
        {:noreply, drain_queue(thread_id, rest)}

      nil ->
        {:noreply, state}
    end
  end

  def handle_info(_msg, state), do: {:noreply, state}

  # --- internals -------------------------------------------------------------

  defp do_start_turn(thread_id, prompt, opts, state) do
    with {:ok, thread} <- History.get_thread(thread_id),
         {:ok, _updated} <- History.start_turn_state(thread, start_attrs(prompt, opts)),
         run when is_function(run, 0) <- Keyword.get(opts, :run),
         {:ok, pid} <- spawn_worker(thread_id, run, Keyword.get(opts, :reply_to)) do
      ref = Process.monitor(pid)
      register(thread_id, {pid, nil})

      {:ok, refreshed} = History.get_thread(thread_id)
      broadcast_from(self(), thread_id, {:turn_status, :running, History.turn_payload(refreshed)})

      state = Map.put(state, {:turn, thread_id}, %{monitor_ref: ref, pid: pid})
      {:reply, {:ok, %{pid: pid}}, state}
    else
      {:error, reason} -> {:reply, {:error, reason}, state}
      _ -> {:reply, {:error, :invalid_start_opts}, state}
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

        opts =
          case Keyword.get(next.opts, :run_builder) do
            builder when is_function(builder, 1) -> Keyword.put(next.opts, :run, builder.(next.prompt))
            _ -> next.opts
          end

        case do_start_turn(thread_id, next.prompt, opts, state) do
          {:reply, {:ok, _}, new_state} -> new_state
          {:reply, _err, new_state} -> new_state
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
    status = if match?({:ok, _}, result), do: :finished, else: :failed

    payload =
      case History.get_thread(thread_id) do
        {:ok, thread} -> History.turn_payload(thread)
        _ -> nil
      end

    broadcast_from(self(), thread_id, {:turn_status, status, payload})
  end

  defp register(thread_id, value), do: safe_registry(fn -> Registry.register(@registry, thread_id, value) end)

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
    _ -> :error
  end
end
```

> Design notes for the reviewer:
> - The registry value `{pid, codex_turn_id}` is **owned by `TurnManager`** (it calls `Registry.register`), so it persists across the worker's life and is cleared deterministically by `finish_turn`/`:DOWN`. That's why we `Process.monitor` the worker explicitly.
> - `finish_turn` (normal) demonitors before transitioning, so a normal completion never also fires the `:DOWN` interrupt path.
> - `running?/1` reflects the **live** registry (true only while a worker exists). `last_turn`/Resume read the durable `metadata.current_turn`. After a restart, reconciliation flips metadata to `interrupted` and there is no pid → `running?` is false.
> - The per-thread queue is in-memory only (a non-goal to persist). Queued user messages still live in `assistant_messages` history.

- [ ] **Step 2: Wire `TurnManager` into `SharedSupervisor` (after `Repo`)**

In `elixir/lib/symphony_elixir/shared_supervisor.ex`, add the registry + manager **after** `SymphonyElixir.Repo,` (reconciliation in `handle_continue` needs the Repo up). Edit `child_specs/0`:

```elixir
      SymphonyElixir.Observability.Registry,
      SymphonyElixir.Repo,
      SymphonyElixir.Assistant.TurnManager.registry_child_spec(),
      SymphonyElixir.Assistant.TurnManager,
      SymphonyElixir.LocalTracker.CloneSupervisor,
```

- [ ] **Step 3: Write `TurnManager` tests**

Create `elixir/test/symphony_elixir/assistant/turn_manager_test.exs`:

```elixir
defmodule SymphonyElixir.Assistant.TurnManagerTest do
  # Uses the always-on registry + manager the app boots. Serial to avoid races.
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{History, TurnManager}
  alias SymphonyElixir.LocalTracker.Context

  setup do
    migrate_repo()
    clean_repo()
    {:ok, _project} = Context.ensure_project(%{name: "Mgr", slug: "mgr"})
    {:ok, thread} = History.ensure_thread("mgr", %{workspace_path: "/tmp/assistant/mgr"})
    {:ok, thread: thread}
  end

  test "start_turn writes running, registers a pid, and broadcasts running", %{thread: thread} do
    TurnManager.subscribe(thread.id)
    test_pid = self()

    run = fn ->
      send(test_pid, {:worker, self()})
      receive do: (:go -> :ok)
      {:ok, %{assistant_message: "done", codex_thread_id: "ct", turn_id: "tn"}}
    end

    assert {:ok, %{pid: worker}} =
             TurnManager.start_turn(thread.id, "hello", run: run, reply_to: self(), trigger: "user")

    assert_receive {:worker, ^worker}, 1_000
    assert TurnManager.running?(thread.id)
    assert_receive {:turn_status, :running, %{status: "running"}}, 1_000

    {:ok, reloaded} = History.get_thread(thread.id)
    assert History.turn_running?(reloaded)

    send(worker, :go)
    assert_receive {:assistant_turn_finished, {:ok, _}}, 1_000
    assert_receive {:turn_status, :finished, %{status: "completed"}}, 1_000
    refute TurnManager.running?(thread.id)

    {:ok, done} = History.get_thread(thread.id)
    assert History.current_turn(done)["status"] == "completed"
    assert History.current_turn(done)["session_id"] == "ct-tn"
  end

  test "a second start_turn while running returns :turn_in_progress", %{thread: thread} do
    test_pid = self()

    run = fn ->
      send(test_pid, {:worker, self()})
      receive do: (:go -> :ok)
      {:ok, %{}}
    end

    assert {:ok, %{pid: worker}} = TurnManager.start_turn(thread.id, "first", run: run, reply_to: self())
    assert_receive {:worker, ^worker}, 1_000

    assert {:error, :turn_in_progress} =
             TurnManager.start_turn(thread.id, "second", run: fn -> {:ok, %{}} end, reply_to: self())

    send(worker, :go)
    assert_receive {:assistant_turn_finished, _}, 1_000
  end

  test "abnormal worker exit interrupts the current turn (task_crash)", %{thread: thread} do
    test_pid = self()

    run = fn ->
      send(test_pid, {:worker, self()})
      receive do: (:boom -> exit(:boom))
    end

    assert {:ok, %{pid: worker}} = TurnManager.start_turn(thread.id, "explode", run: run, reply_to: self())
    assert_receive {:worker, ^worker}, 1_000
    send(worker, :boom)

    wait_until(fn ->
      {:ok, t} = History.get_thread(thread.id)
      History.current_turn(t)["status"] == "interrupted"
    end)

    {:ok, t} = History.get_thread(thread.id)
    assert History.current_turn(t)["interrupted_reason"] == "task_crash"
    refute TurnManager.running?(thread.id)
  end

  test "note_codex_turn fills the codex ids on the running turn", %{thread: thread} do
    test_pid = self()

    run = fn ->
      send(test_pid, {:worker, self()})
      receive do: (:go -> :ok)
      {:ok, %{}}
    end

    assert {:ok, %{pid: worker}} = TurnManager.start_turn(thread.id, "x", run: run, reply_to: self())
    assert_receive {:worker, ^worker}, 1_000
    TurnManager.note_codex_turn(thread.id, "ct-7", "tn-7")

    wait_until(fn ->
      {:ok, t} = History.get_thread(thread.id)
      History.current_turn(t)["session_id"] == "ct-7-tn-7"
    end)

    send(worker, :go)
    assert_receive {:assistant_turn_finished, _}, 1_000
  end

  test "enqueue drains the next turn when the current one finishes", %{thread: thread} do
    test_pid = self()

    first = fn ->
      send(test_pid, {:first, self()})
      receive do: (:go -> :ok)
      {:ok, %{}}
    end

    assert {:ok, %{pid: worker1}} = TurnManager.start_turn(thread.id, "first", run: first, reply_to: self())
    assert_receive {:first, ^worker1}, 1_000

    second_builder = fn prompt ->
      fn ->
        send(test_pid, {:second, prompt})
        {:ok, %{}}
      end
    end

    TurnManager.enqueue(thread.id, "second", run_builder: second_builder, reply_to: self())

    send(worker1, :go)
    assert_receive {:assistant_turn_finished, _}, 1_000
    assert_receive {:second, "second"}, 1_000
  end

  defp wait_until(fun, attempts \\ 100) do
    cond do
      attempts <= 0 -> flunk("condition not met in time")
      fun.() -> :ok
      true -> Process.sleep(10); wait_until(fun, attempts - 1)
    end
  end
end
```

- [ ] **Step 4: Run the tests**

Run: `cd elixir && mix test test/symphony_elixir/assistant/turn_manager_test.exs test/symphony_elixir/assistant/goal_run_test.exs`
Expected: PASS (manager tests + `goal_run_test.exs` stays green).

- [ ] **Step 5: Spec gate + commit**

Run: `cd elixir && mix specs.check`

```bash
git add elixir/lib/symphony_elixir/assistant/turn_manager.ex \
        elixir/lib/symphony_elixir/shared_supervisor.ex \
        elixir/test/symphony_elixir/assistant/turn_manager_test.exs
git commit -m "feat: add always-on Assistant.TurnManager with boot reconciliation"
```

---

## Task 3: Channel starts turns via `TurnManager` + `last_turn` on join

After this task, normal threads (not just goal mode) re-attach a running indicator after refresh, the join carries `last_turn`, and the durable metadata is written for every turn.

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex`
- Test: `elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs`

- [ ] **Step 1: Write a failing test for `last_turn` + re-attach**

Add to `elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs`:

```elixir
  test "join exposes last_turn and a reloaded tab re-attaches a running turn" do
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_turn_started).("turn-attach")
      send(test_pid, {:runner_started, self()})
      receive do: (:finish -> :ok)
      {:ok, %{assistant_message: "ok", codex_thread_id: "ct-attach", turn_id: "turn-attach", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)
    topic = "assistant:issue:macro-markets:DIS-1"

    {:ok, _join, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    ref = push(socket, "send_message", %{"message" => "go", "context" => %{}})
    assert_reply(ref, :ok, %{})
    assert_receive {:runner_started, runner_pid}, 2_000

    {:ok, join_payload, _socket2} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    assert %{last_turn: %{status: "running"}} = join_payload
    assert join_payload.turn_running == true

    send(runner_pid, :finish)
    assert_push("assistant_completed", %{message: %{role: "assistant"}})
  end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs -k "re-attach"`
Expected: FAIL — `last_turn` key missing from the join payload.

- [ ] **Step 3: Alias `TurnManager` + add `last_turn` to the thread-scoped joins**

In `assistant_channel.ex`, add `TurnManager` to the alias (`:7`):

```elixir
  alias SymphonyElixir.Assistant.{AuthoringGoalControl, CodexSession, GoalRun, History, Payload, SideQuery, ToolExecutor, TurnManager}
```

In the **issue** join (`:16-44`), replace `GoalRun.subscribe(thread.id)` with `TurnManager.subscribe(thread.id)` (single subscription to the same topic) and add three keys to the payload:

```elixir
      TurnManager.subscribe(thread.id)

      payload = %{
        messages: Enum.map(History.list_messages_for_thread(thread.id), &History.message_payload/1),
        thread_id: thread.id,
        mode: History.thread_mode(thread),
        goal_mode: History.thread_goal_mode(thread),
        goal_objective: History.thread_goal_objective(thread),
        goal_running: GoalRun.running?(thread.id),
        goal_run_elapsed_seconds: GoalRun.elapsed_seconds(thread.id),
        last_turn: History.turn_payload(thread),
        turn_running: TurnManager.running?(thread.id),
        turn_elapsed_seconds: History.turn_elapsed_seconds(thread),
        effective_agent: thread_effective_agent(thread)
      }
```

In the **explore** join (`:52-67`) and the **thread** join (`:75-89`), add `TurnManager.subscribe(thread.id)` just before building `payload`, and add these keys to each payload map:

```elixir
        last_turn: History.turn_payload(thread),
        turn_running: TurnManager.running?(thread.id),
        turn_elapsed_seconds: History.turn_elapsed_seconds(thread),
```

> The project-scoped clause (`assistant:` <> slug, `:97`) has no `thread` at join, so it stays unchanged.

- [ ] **Step 4: Route turn start through `TurnManager` (with a legacy fallback)**

Replace the `true ->` branch body of `do_send_message/3` (`:531-588`). Keep the `context`/`opts` construction, but capture `channel_pid` once and branch on whether a durable thread exists:

```elixir
      true ->
        channel_pid = self()

        context =
          context
          |> Map.put("attachments", Payload.attachment_summary(attachments))
          |> Map.put("model", Map.get(context, "model") || Map.get(context, :model))
          |> Map.put("effort", Map.get(context, "effort") || Map.get(context, :effort))
          |> Map.put("agent", Map.get(context, "agent") || Map.get(context, :agent))

        opts =
          []
          |> maybe_put_runner()
          |> Keyword.merge(Payload.model_opts(context))
          |> Keyword.put(:attachments, attachments)
          |> Keyword.put(:on_message_created, fn message -> push(socket, "message_created", %{message: message}) end)
          |> Keyword.put(:on_assistant_delta, fn delta -> push(socket, "assistant_delta", %{delta: delta}) end)
          |> Keyword.put(:on_tool_call_started, fn tc -> push(socket, "tool_call_started", %{tool_call: tc}) end)
          |> Keyword.put(:on_tool_call_completed, fn tc -> push(socket, "tool_call_completed", %{tool_call: tc}) end)
          |> Keyword.put(:on_documents_changed, fn identifier ->
            push(socket, "assistant_document_changed", %{identifier: identifier})
          end)
          |> Keyword.put(:on_thread_documents_changed, fn thread_id ->
            push(socket, "assistant_document_changed", %{thread_id: thread_id})
          end)
          |> Keyword.put(:on_turn_started, fn turn_id ->
            send(channel_pid, {:assistant_turn_started, turn_id})
            if is_map(thread) and is_integer(Map.get(thread, :id)),
              do: TurnManager.note_codex_turn(thread.id, nil, turn_id)
          end)
          |> Keyword.put(:interactive_user_input, true)
          |> Keyword.put(:on_user_input_required, fn request ->
            send(channel_pid, {:assistant_user_input_required, request})
          end)

        if is_map(thread) and is_integer(Map.get(thread, :id)) do
          start_tracked_turn(thread, project_slug, trimmed, context, opts, socket)
        else
          start_legacy_turn(thread, project_slug, trimmed, context, opts, socket)
        end
```

> Note: every closure uses `channel_pid` (bound in the channel process), **not** `self()` — the closures run inside the worker Task, where `self()` would be the Task.

Add the two helpers near `do_send_message/3`:

```elixir
  defp start_tracked_turn(thread, project_slug, trimmed, context, opts, socket) do
    channel_pid = self()
    goal_run? = goal_thread?(thread)

    run_builder = fn prompt_text ->
      fn ->
        if goal_run?, do: GoalRun.track(thread.id)
        result = run_send_turn(thread, project_slug, prompt_text, context, opts)

        if goal_run? do
          GoalRun.untrack(thread.id)
          GoalRun.broadcast_from(channel_pid, thread.id, {:goal_run_finished, finished_message(result)})
        end

        result
      end
    end

    start_opts = [
      run: run_builder.(trimmed),
      run_builder: run_builder,
      reply_to: channel_pid,
      trigger: "user",
      agent_kind: turn_agent_kind(context),
      model: Map.get(context, "model"),
      effort: Map.get(context, "effort")
    ]

    case TurnManager.start_turn(thread.id, trimmed, start_opts) do
      {:ok, %{pid: pid}} ->
        if goal_run?, do: GoalRun.broadcast_from(self(), thread.id, {:goal_run_started})

        socket =
          socket
          |> assign(:turn_status, :running)
          |> assign(:turn_pid, pid)
          |> assign(:codex_turn_id, nil)

        {:reply, :ok, socket}

      {:error, :turn_in_progress} ->
        steer_or_queue(thread, trimmed, start_opts, socket)

      {:error, _reason} ->
        {:reply, {:error, %{reason: "assistant could not start the turn"}}, socket}
    end
  end

  # Project-scoped chats have no durable thread row; keep the original inline path.
  defp start_legacy_turn(thread, project_slug, trimmed, context, opts, socket) do
    channel_pid = self()

    {:ok, pid} =
      Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor, fn ->
        result = run_send_turn(thread, project_slug, trimmed, context, opts)
        send(channel_pid, {:assistant_turn_finished, result})
      end)

    ref = Process.monitor(pid)

    socket =
      socket
      |> assign(:turn_status, :running)
      |> assign(:turn_pid, pid)
      |> assign(:turn_ref, ref)
      |> assign(:codex_turn_id, nil)

    {:reply, :ok, socket}
  end

  defp turn_agent_kind(context) when is_map(context) do
    AgentPreference.normalize(Map.get(context, "agent") || Map.get(context, :agent))
  end

  defp turn_agent_kind(_context), do: nil
```

For this task, add a temporary minimal `steer_or_queue/4` (expanded in Task 4) so the busy case still serializes and the code compiles:

```elixir
  defp steer_or_queue(_thread, _trimmed, _start_opts, socket) do
    {:reply, {:error, %{reason: "assistant is busy"}}, socket}
  end
```

> The `attachments` variable is already in scope from `resolve_attachments/3` earlier in `do_send_message/3` (`:521`). Keep that line.

- [ ] **Step 5: Add the `{:turn_status, …}` reconcile handler**

Add next to the `{:goal_run_started}` / `{:goal_run_finished, …}` handlers (`:415-433`):

```elixir
  def handle_info({:turn_status, :running, payload}, socket) do
    if socket.assigns[:turn_status] != :running do
      push(socket, "turn_status", Map.put(normalize_turn_payload(payload), :status, "running"))
    end

    {:noreply, socket}
  end

  def handle_info({:turn_status, status, payload}, socket) when status in [:finished, :failed] do
    if socket.assigns[:turn_status] != :running do
      push(socket, "turn_status", normalize_turn_payload(payload))
    end

    {:noreply, socket}
  end
```

Add the helper near `reset_turn/1` (`:508`):

```elixir
  defp normalize_turn_payload(payload) when is_map(payload), do: payload
  defp normalize_turn_payload(_payload), do: %{}
```

- [ ] **Step 6: Run the test + full channel suite**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs`
Expected: PASS, including the new re-attach test. The existing "rejects a concurrent send while running" test still passes (its early guard at `:123` returns `assistant is busy`).

- [ ] **Step 7: Spec gate + commit**

Run: `cd elixir && mix specs.check`

```bash
git add elixir/lib/symphony_elixir_web/channels/assistant_channel.ex \
        elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs
git commit -m "feat: start assistant turns via TurnManager and expose last_turn on join"
```

---

## Task 4: Cross-channel steer + steer-then-queue dedup

Resolve the steer pid from `TurnManager` (so a reloaded tab can steer a turn it didn't start), and turn the "busy" branch into steer-then-queue.

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex`
- Test: `elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs`

- [ ] **Step 1: Write a failing test for cross-channel steer**

Add to `assistant_channel_test.exs`:

```elixir
  test "steer_turn works from a different channel than the one that started the turn" do
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_turn_started).("turn-steer")
      send(test_pid, {:runner, self()})

      receive do
        {:codex_steer, input, reply_to} ->
          send(test_pid, {:steered, input})
          send(reply_to, {:steer_ok, %{}})
      after
        2_000 -> :ok
      end

      {:ok, %{assistant_message: "ok", codex_thread_id: "ct-steer", turn_id: "turn-steer", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)
    topic = "assistant:issue:macro-markets:DIS-2"

    {:ok, _join, socket_a} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    ref = push(socket_a, "send_message", %{"message" => "go", "context" => %{}})
    assert_reply(ref, :ok, %{})
    assert_receive {:runner, _runner_pid}, 2_000

    {:ok, _join, socket_b} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    ref2 = push(socket_b, "steer_turn", %{"message" => "actually do Y"})
    assert_reply(ref2, :ok, %{})
    assert_receive {:steered, [%{"type" => "text", "text" => "actually do Y"}]}, 2_000
  end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs -k "different channel"`
Expected: FAIL — `steer_turn` replies `ActiveTurnNotSteerable` (socket_b has no `turn_pid`).

- [ ] **Step 3: Resolve steer pid via `TurnManager`**

Replace the `steer_turn` handler (`:251-267`) with:

```elixir
  def handle_in("steer_turn", %{"message" => message}, socket) when is_binary(message) do
    trimmed = String.trim(message)

    case {trimmed, steer_target(socket)} do
      {"", _} ->
        {:reply, {:error, %{reason: "message is required"}}, socket}

      {_text, {:ok, pid, _codex_turn_id}} ->
        maybe_persist_steer(socket, trimmed)
        send(pid, {:codex_steer, [%{"type" => "text", "text" => trimmed}], self()})
        {:reply, :ok, assign(socket, :last_steer_text, trimmed)}

      {_text, :error} ->
        {:reply, {:error, %{reason: "ActiveTurnNotSteerable"}}, socket}
    end
  end
```

Add the `steer_target/1` helper near `reset_turn/1`:

```elixir
  # Resolve the live worker for steering: prefer the always-on TurnManager registry
  # (works cross-channel / post-refresh); fall back to this socket's own assigns.
  defp steer_target(%Socket{assigns: %{thread: %{id: id}}} = socket) when is_integer(id) do
    case TurnManager.steer_target(id) do
      {:ok, pid, codex_turn_id} -> {:ok, pid, codex_turn_id}
      :error -> local_steer_target(socket)
    end
  end

  defp steer_target(socket), do: local_steer_target(socket)

  defp local_steer_target(%Socket{assigns: assigns}) do
    if assigns[:turn_status] == :running and is_pid(assigns[:turn_pid]) and
         not is_nil(assigns[:codex_turn_id]) do
      {:ok, assigns[:turn_pid], assigns[:codex_turn_id]}
    else
      :error
    end
  end
```

> Steering only needs the pid; `codex_turn_id` may still be `nil` in the registry (it's filled by `note_codex_turn` after `on_turn_started`). That's fine — the worker validates steerability via the existing `{:codex_steer, …}` path.

- [ ] **Step 4: Write a failing test for steer-then-queue on a busy send**

Add to `assistant_channel_test.exs`:

```elixir
  test "a send while running steers the live turn instead of starting a second one" do
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_turn_started).("turn-busy")
      send(test_pid, {:runner, self()})

      receive do
        {:codex_steer, input, reply_to} ->
          send(test_pid, {:steered, input})
          send(reply_to, {:steer_ok, %{}})
      after
        2_000 -> :ok
      end

      {:ok, %{assistant_message: "ok", codex_thread_id: "ct-busy", turn_id: "turn-busy", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)
    topic = "assistant:issue:macro-markets:DIS-3"

    {:ok, _join, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    ref = push(socket, "send_message", %{"message" => "first", "context" => %{}})
    assert_reply(ref, :ok, %{})
    assert_receive {:runner, _pid}, 2_000

    ref2 = push(socket, "send_message", %{"message" => "second", "context" => %{}})
    assert_reply(ref2, :ok, %{})
    assert_receive {:steered, [%{"type" => "text", "text" => "second"}]}, 2_000
  end
```

- [ ] **Step 5: Run it to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs -k "steers the live turn"`
Expected: FAIL — the same-tab guard at `:123` returns `assistant is busy`.

- [ ] **Step 6: Remove the early busy guard and implement steer-then-queue**

Change `handle_in("send_message", …)` (`:122-128`) to always delegate:

```elixir
  def handle_in("send_message", %{"message" => message} = payload, socket) when is_binary(message) do
    do_send_message(message, payload, socket)
  end
```

Replace the temporary `steer_or_queue/4` from Task 3 with the real one:

```elixir
  # A send arrived while a turn is running. Prefer steering the live turn; if there
  # is no steerable worker, queue it so it runs next. Either way the message is
  # persisted to history so it is never lost.
  defp steer_or_queue(thread, trimmed, start_opts, socket) do
    case TurnManager.steer_target(thread.id) do
      {:ok, pid, _codex_turn_id} ->
        maybe_persist_steer(socket, trimmed)
        send(pid, {:codex_steer, [%{"type" => "text", "text" => trimmed}], self()})
        {:reply, :ok, assign(socket, :last_steer_text, trimmed)}

      :error ->
        maybe_persist_steer(socket, trimmed)
        TurnManager.enqueue(thread.id, trimmed, start_opts)
        {:reply, {:ok, %{queued: true}}, socket}
    end
  end
```

> `start_opts` carries `run_builder`, so `TurnManager.drain_queue` rebuilds `run` with the queued prompt (Task 2). The immediate `:run` in `start_opts` is ignored for queued entries.

- [ ] **Step 7: Update the existing concurrent-send test**

The old "rejects a concurrent send while running" test (`:74-109`) asserted `{:error, "assistant is busy"}`. The server now steers/queues instead. Its runner doesn't handle `{:codex_steer, …}`, so the second send is **queued**. Change the second-send assertion (`:103-108`) to:

```elixir
    ref2 = push(socket, "send_message", %{"message" => "second", "context" => %{"view" => "board"}})
    assert_reply(ref2, :ok, %{queued: true})

    send(runner_pid, :finish)
    assert_push("assistant_delta", %{delta: "hi"})
    assert_push("assistant_completed", %{message: %{role: "assistant", content: "done"}})
```

> This test uses the **project-scoped** topic `assistant:macro-markets`, which has no durable thread (`thread = nil`). With no thread, `start_legacy_turn` runs and there is no `TurnManager` tracking — so the second send would hit `do_send_message` with `thread = nil` and call `start_legacy_turn` again (a real second turn), not queue. To keep the *project-scoped* legacy path's original single-turn protection, **restore a minimal guard** for the no-thread case only. In `handle_in("send_message", …)`:

```elixir
  def handle_in("send_message", %{"message" => message} = payload, socket) when is_binary(message) do
    thread = socket.assigns[:thread]

    if is_nil(thread) and socket.assigns[:turn_status] == :running do
      {:reply, {:error, %{reason: "assistant is busy"}}, socket}
    else
      do_send_message(message, payload, socket)
    end
  end
```

And revert that existing test's second-send assertion back to its original `{:error, %{reason: "assistant is busy"}}` (since the project-scoped path keeps the legacy guard). Net effect: durable threads get steer/queue; the legacy project-scoped path keeps the old busy rejection. Keep the new DIS-3 test (issue topic → steer) as the coverage for steering.

- [ ] **Step 8: Run the channel + manager suites**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs test/symphony_elixir/assistant/turn_manager_test.exs`
Expected: PASS (cross-channel steer + steer-on-busy for issue threads; legacy busy guard for project-scoped).

- [ ] **Step 9: Spec gate + commit**

Run: `cd elixir && mix specs.check`

```bash
git add elixir/lib/symphony_elixir_web/channels/assistant_channel.ex \
        elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs
git commit -m "feat: cross-channel steer and steer-then-queue dedup for assistant turns"
```

---

## Task 5: Resume an interrupted turn (backend)

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex`
- Test: `elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs`

- [ ] **Step 1: Write failing tests for `resume_turn`**

Add to `assistant_channel_test.exs`:

```elixir
  test "resume_turn re-dispatches the interrupted current turn as a resume turn" do
    alias SymphonyElixir.Assistant.History

    test_pid = self()

    runner = fn _workspace, prompt, _issue, opts ->
      send(test_pid, {:resumed_prompt, prompt})
      Keyword.fetch!(opts, :on_turn_started).("turn-resumed")
      {:ok, %{assistant_message: "resumed ok", codex_thread_id: "ct-r", turn_id: "turn-resumed", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)
    topic = "assistant:issue:macro-markets:DIS-4"

    {:ok, join_payload, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    thread_id = join_payload.thread_id
    {:ok, thread} = History.get_thread(thread_id)
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "original work"})
    {:ok, _interrupted} = History.interrupt_turn_state(thread, "serve_restart")

    ref = push(socket, "resume_turn", %{})
    assert_reply(ref, :ok, %{})

    assert_receive {:resumed_prompt, prompt}, 2_000
    assert prompt =~ "original work"
    assert_push("assistant_completed", %{message: %{role: "assistant", content: "resumed ok"}})

    {:ok, after_thread} = History.get_thread(thread_id)
    assert History.current_turn(after_thread)["trigger"] == "resume"
  end

  test "resume_turn rejects when the current turn is not interrupted" do
    alias SymphonyElixir.Assistant.History
    topic = "assistant:issue:macro-markets:DIS-5"

    {:ok, join_payload, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    {:ok, thread} = History.get_thread(join_payload.thread_id)
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "done"})
    {:ok, _completed} = History.complete_turn_state(thread, %{})

    ref = push(socket, "resume_turn", %{})
    assert_reply(ref, :error, %{reason: _})
  end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs -k "resume_turn"`
Expected: FAIL — no `resume_turn` handler.

- [ ] **Step 3: Implement `resume_turn`**

Add the handler near `steer_turn` (`:251`):

```elixir
  def handle_in("resume_turn", _payload, socket) do
    with %{id: thread_id} = thread when is_integer(thread_id) <- socket.assigns[:thread],
         {:ok, reloaded} <- History.get_thread(thread_id),
         %{"status" => "interrupted"} = turn <- History.current_turn(reloaded),
         false <- TurnManager.running?(thread_id) do
      do_resume_turn(reloaded, turn, socket)
    else
      true -> {:reply, {:error, %{reason: "assistant is busy"}}, socket}
      %{"status" => _other} -> {:reply, {:error, %{reason: "turn is not interrupted"}}, socket}
      nil -> {:reply, {:error, %{reason: "no turn to resume"}}, socket}
      {:error, _} -> {:reply, {:error, %{reason: "cannot resume"}}, socket}
      _ -> {:reply, {:error, %{reason: "cannot resume"}}, socket}
    end
  end
```

Add the helper near `do_send_message/3`:

```elixir
  defp do_resume_turn(thread, turn, socket) do
    channel_pid = self()
    context = normalize_context(%{})
    prompt = turn["prompt"] || ""
    codex_thread_id = turn["codex_thread_id"]

    opts =
      []
      |> maybe_put_runner()
      |> Keyword.put(:on_message_created, fn message -> push(socket, "message_created", %{message: message}) end)
      |> Keyword.put(:on_assistant_delta, fn delta -> push(socket, "assistant_delta", %{delta: delta}) end)
      |> Keyword.put(:on_tool_call_started, fn tc -> push(socket, "tool_call_started", %{tool_call: tc}) end)
      |> Keyword.put(:on_tool_call_completed, fn tc -> push(socket, "tool_call_completed", %{tool_call: tc}) end)
      |> Keyword.put(:on_turn_started, fn t_id ->
        send(channel_pid, {:assistant_turn_started, t_id})
        TurnManager.note_codex_turn(thread.id, codex_thread_id, t_id)
      end)
      |> Keyword.put(:interactive_user_input, true)
      |> Keyword.put(:on_user_input_required, fn request ->
        send(channel_pid, {:assistant_user_input_required, request})
      end)

    start_opts = [
      run: fn -> run_send_turn(thread, thread.project_slug, prompt, context, opts) end,
      reply_to: channel_pid,
      trigger: "resume",
      codex_thread_id: codex_thread_id,
      agent_kind: turn["agent_kind"],
      model: turn["model"],
      effort: turn["effort"]
    ]

    case TurnManager.start_turn(thread.id, prompt, start_opts) do
      {:ok, %{pid: pid}} ->
        socket = socket |> assign(:turn_status, :running) |> assign(:turn_pid, pid) |> assign(:codex_turn_id, nil)
        {:reply, :ok, socket}

      {:error, :turn_in_progress} ->
        {:reply, {:error, %{reason: "assistant is busy"}}, socket}

      {:error, _reason} ->
        {:reply, {:error, %{reason: "could not resume the turn"}}, socket}
    end
  end
```

> Codex continuity is automatic: `run_send_turn` → `CodexSession.send_message_to_issue_thread` reloads the thread and passes `History.agent_thread_id(thread, agent_kind)` (`codex_session.ex:146-155`), so Codex continues the persisted thread. `codex_thread_id` on the new turn is for display/trace.

- [ ] **Step 4: Run the resume tests + full channel suite**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs`
Expected: PASS, including both resume tests.

- [ ] **Step 5: Spec gate + commit**

Run: `cd elixir && mix specs.check`

```bash
git add elixir/lib/symphony_elixir_web/channels/assistant_channel.ex \
        elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs
git commit -m "feat: add resume_turn to re-dispatch interrupted assistant turns"
```

---

## Task 6: Frontend — `turn_status` binding, `last_turn`, Resume button

**Files:**
- Modify: `tracker/src/services/phoenix/assistantChannel.ts`
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx`
- Test: `tracker/src/services/phoenix/__tests__/assistantChannel.test.ts`
- Test: `tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx`

> Run all tracker commands from `tracker/`. Test runner: `cd tracker && npx vitest run <file>`.

- [ ] **Step 1: Orient — read current bindings + panel join handling**

Run:

```bash
cd tracker && rg -n "onGoalRunning|goal_running|onHistoryLoaded|\.join\(|last_turn|noopHandlers" src/services/phoenix/assistantChannel.ts src/services/phoenix/__tests__/assistantChannel.test.ts src/components/assistant/ProjectAssistantPanel.tsx
```

Expected: shows the `bindAssistantEvents` handlers (`assistantChannel.ts:135-220`), the test's fake-channel/handlers helper, and where `ProjectAssistantPanel` joins + reads the join reply.

- [ ] **Step 2: Write a failing test for the `turn_status` binding**

Add to `tracker/src/services/phoenix/__tests__/assistantChannel.test.ts` (mirror the existing `goal_running` test in this file):

```ts
it("invokes onTurnStatus when the channel pushes turn_status", () => {
  const channel = createFakeChannel();
  const onTurnStatus = vi.fn();

  bindAssistantEvents(channel as unknown as Channel, {
    ...noopHandlers(),
    onTurnStatus,
  });

  channel.trigger("turn_status", { status: "interrupted", session_id: "ct-tn", can_resume: true });

  expect(onTurnStatus).toHaveBeenCalledWith(
    expect.objectContaining({ status: "interrupted", sessionId: "ct-tn", canResume: true }),
  );
});
```

> Use the file's existing `createFakeChannel` / handlers helper. If there's no `noopHandlers`, build a handlers object of `vi.fn()`s matching the existing tests in that file.

- [ ] **Step 3: Run it to verify it fails**

Run: `cd tracker && npx vitest run src/services/phoenix/__tests__/assistantChannel.test.ts`
Expected: FAIL — `onTurnStatus` not invoked.

- [ ] **Step 4: Add the `turn_status` binding + normalizer + `last_turn`/`resumeTurn`**

In `tracker/src/services/phoenix/assistantChannel.ts`:

Add to `AssistantChannelHandlers` (after `onGoalRunning`, `:34`):

```ts
  onTurnStatus?: (status: AssistantTurnStatus) => void;
```

Add the type + normalizer (near `normalizeGoalStatus`, `:59`):

```ts
export interface AssistantTurnStatus {
  status: string;
  sessionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  canResume: boolean;
}

interface BackendTurnStatusPayload {
  status?: string | null;
  session_id?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  can_resume?: boolean | null;
}

export function normalizeTurnStatus(payload: unknown): AssistantTurnStatus {
  const data = (payload ?? {}) as BackendTurnStatusPayload;
  return {
    status: typeof data.status === "string" ? data.status : "unknown",
    sessionId: typeof data.session_id === "string" ? data.session_id : null,
    startedAt: typeof data.started_at === "string" ? data.started_at : null,
    finishedAt: typeof data.finished_at === "string" ? data.finished_at : null,
    canResume: data.can_resume === true,
  };
}

export function readLastTurn(joinPayload: unknown): AssistantTurnStatus | null {
  const data = (joinPayload ?? {}) as { last_turn?: unknown };
  return data.last_turn ? normalizeTurnStatus(data.last_turn) : null;
}
```

Add the binding inside `bindAssistantEvents` (next to the `goal_running` binding, `:220`):

```ts
  channel.on("turn_status", (payload) => {
    handlers.onTurnStatus?.(normalizeTurnStatus(payload));
  });
```

Add a `resumeTurn` push helper (match the file's existing push-wrapper style — search `channel.push(`):

```ts
export function resumeTurn(channel: Channel): Promise<void> {
  return new Promise((resolve, reject) => {
    channel
      .push("resume_turn", {})
      .receive("ok", () => resolve())
      .receive("error", (resp: { reason?: string }) => reject(new Error(resp?.reason ?? "resume failed")));
  });
}
```

- [ ] **Step 5: Run the channel test to verify pass**

Run: `cd tracker && npx vitest run src/services/phoenix/__tests__/assistantChannel.test.ts`
Expected: PASS.

- [ ] **Step 6: Write a failing panel test for the Resume button**

Add to `tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx` (read the file's existing render harness first — Step 1). Provide a join reply with an interrupted `last_turn` and assert the Resume button pushes `resume_turn`:

```tsx
it("shows a Resume button when the last turn was interrupted and pushes resume_turn on click", async () => {
  const channel = renderPanelWithJoinReply({
    messages: [],
    thread_id: 1,
    last_turn: { status: "interrupted", can_resume: true },
  });

  const button = await screen.findByRole("button", { name: /resume/i });
  fireEvent.click(button);

  expect(channel.push).toHaveBeenCalledWith("resume_turn", {});
});
```

> `renderPanelWithJoinReply` is illustrative — use the panel's existing test harness for a mocked channel whose `join().receive("ok", cb)` calls `cb` with the payload. Match whatever the file already defines.

- [ ] **Step 7: Run it to verify it fails**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx`
Expected: FAIL — no Resume button rendered.

- [ ] **Step 8: Render Interrupted state + Resume button in the panel**

In `ProjectAssistantPanel.tsx`:

1. Track the last turn in state (near the other `useState` hooks):

```tsx
const [lastTurn, setLastTurn] = useState<AssistantTurnStatus | null>(null);
```

2. On join, set it from the reply (in the `.receive("ok", (payload) => { ... })` block that seeds messages):

```tsx
setLastTurn(readLastTurn(payload));
```

3. Wire `onTurnStatus` when calling `bindAssistantEvents`:

```tsx
onTurnStatus: (status) => {
  setLastTurn(status);
  setIsRunning(status.status === "running");
},
```

> Use the panel's existing "assistant is working" state setter (it may be named `setIsRunning`/`setBusy`, or driven by `onAssistantCompleted`/`onAssistantError`). Read the panel to match the real name; intent: a `running` fan-out shows the working indicator on a reloaded tab; a terminal one clears it.

4. Render the Resume affordance above the composer (where errors/working indicators render):

```tsx
{lastTurn?.canResume && !isRunning && (
  <div className="assistant-interrupted-banner">
    <span>The previous turn was interrupted.</span>
    <button
      type="button"
      onClick={() => {
        if (channelRef.current) {
          void resumeTurn(channelRef.current);
          setLastTurn(null);
        }
      }}
    >
      Resume
    </button>
  </div>
)}
```

> `channelRef`/`isRunning`/`setIsRunning` are illustrative — reuse the panel's existing channel handle (the one already used for `send_message`/`steer_turn`) and running-state. Import `readLastTurn`, `resumeTurn`, and `AssistantTurnStatus` from `@/services/phoenix/assistantChannel`.

- [ ] **Step 9: Run the panel + channel tests**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx src/services/phoenix/__tests__/assistantChannel.test.ts`
Expected: PASS.

- [ ] **Step 10: Type-check + commit**

Run: `cd tracker && npx tsc --noEmit`
Expected: no type errors in the touched files.

```bash
git add tracker/src/services/phoenix/assistantChannel.ts \
        tracker/src/components/assistant/ProjectAssistantPanel.tsx \
        tracker/src/services/phoenix/__tests__/assistantChannel.test.ts \
        tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx
git commit -m "feat: show interrupted turn Resume button and reconcile running state"
```

---

## Task 7: Full quality gate + docs

**Files:**
- Modify: `elixir/README.md` (assistant turn tracking + Resume section)

- [ ] **Step 1: Run the full gate**

Run: `make all`
Expected: format, credo, `specs.check`, Elixir tests, and tracker tests all green. Fix any failures. Likely nits: an unused `GoalRun` alias warning in the channel if all direct `GoalRun` calls were replaced — keep `GoalRun` aliased only if still referenced (it is: `GoalRun.track/untrack/broadcast_from/running?/elapsed_seconds` are still used in `start_tracked_turn` + the issue join), so no change expected.

- [ ] **Step 2: Add a short README section**

In `elixir/README.md`, add ~10 lines under the assistant docs describing: durable current-turn state on `assistant_threads.metadata` (no table), `TurnManager` (always-on, boot reconciliation → `interrupted (serve_restart)`), steer-then-queue dedup, the Resume button for interrupted turns, and that full per-turn history is in `log/symphony.log`. Reference the spec at `docs/superpowers/specs/2026-06-21-assistant-turn-session-tracking-design.md`.

- [ ] **Step 3: Manual smoke (the `DIS-1` scenario)**

1. `cd elixir && mix phx.server` (or the project's serve command).
2. Open `http://localhost:4000/tracker/projects/<project>/assistant/issue/<id>`, send a message that starts a long turn.
3. Refresh mid-turn → indicator re-attaches (running).
4. Restart the serve mid-turn → reload → the turn shows **Interrupted** with a **Resume** button; click Resume → a new turn runs continuing the same Codex thread.
5. While a turn runs, send another message → it steers the live turn (no second Codex session).

- [ ] **Step 4: Commit**

```bash
git add elixir/README.md
git commit -m "docs: document durable assistant turn tracking and Resume"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Covered by |
|---|---|
| §4 metadata `current_turn` (no table/migration) | Task 1 |
| §5 `TurnManager` (start/finish/note/steer/running?/elapsed), monitor, boot reconcile, queue | Task 2 |
| §5 `SharedSupervisor` always-on placement (after `Repo`) | Task 2 Step 2 |
| §6 streaming stays on socket; lifecycle via PubSub + metadata | Task 3 (delegated `subscribe`/`broadcast_from`; deltas unchanged) |
| §7 steer-then-queue on busy send | Task 4 |
| §8 join `last_turn` + Resume | Task 3 (join) + Task 5 (`resume_turn`) + Task 6 (button) |
| §9 channel/event changes (`turn_status`, `resume_turn`, cross-channel steer) | Tasks 3–6 |
| §10 error handling (steer race→queue, task crash→interrupted, restart→interrupted, reject bad resume, registry-not-started) | Task 2 (`safe_registry`/monitor/reconcile), Task 4, Task 5 |
| §11 tests (Elixir + frontend) | Tasks 1–6 |
| §13 build order | Task order 1→6 |
| §14 metadata persistence / GoalRun delegation / queue durability | Tasks 1–2 |

**2. Placeholder scan**

Frontend Task 6 uses a few illustrative harness names (`renderPanelWithJoinReply`, `channelRef`, `setIsRunning`) because they depend on the existing panel/test harness, which the engineer reads first (Step 1/Step 6). All Elixir steps and the frontend channel-service code are complete and non-placeholder.

**3. Type/name consistency**

- `History` metadata functions: `start_turn_state/2`, `note_turn_codex/2`, `complete_turn_state/2`, `fail_turn_state/2`, `interrupt_turn_state/2`, `current_turn/1`, `turn_running?/1`, `turn_elapsed_seconds/1`, `turn_payload/1`, `reconcile_orphaned_turns/0` — defined in Task 1, used identically in Tasks 2/3/5.
- `TurnManager`: `start_turn/3`, `note_codex_turn/3`, `finish_turn/2`, `enqueue/3`, `steer_target/1`, `running?/1`, `elapsed_seconds/1`, `subscribe/1`, `broadcast_from/3`, `registry_child_spec/0` — defined in Task 2, used identically in Tasks 3/4/5.
- `steer_target/1` returns `{:ok, pid, codex_turn_id} | :error` consistently in manager and channel.
- `run_builder` contract (`fn prompt -> (fn -> result end) end`) consistent between `start_tracked_turn` (Task 3) and `drain_queue` (Task 2).
- `start_opts` keys (`:run`, `:run_builder`, `:reply_to`, `:trigger`, `:agent_kind`, `:model`, `:effort`, `:codex_thread_id`) match the `@type start_opts` in Task 2.
- Frontend `AssistantTurnStatus` (`status/sessionId/startedAt/finishedAt/canResume`) produced by `normalizeTurnStatus`, consumed by panel + tests consistently. `resumeTurn(channel)` pushes `resume_turn` with `{}`, matching the backend handler (Task 5).
- Metadata `current_turn` keys (string keys, ISO8601 datetimes) are written and read consistently across Task 1 functions and the manager (which only goes through `History`).

**Known risks flagged for the engineer:**
- Closures in `do_send_message/3` must use `channel_pid = self()` bound in the channel process (Task 3 Step 4) — `self()` inside a closure runs in the worker Task.
- The project-scoped topic (`assistant:<slug>`) has no durable thread; it keeps the legacy single-turn busy guard (Task 4 Step 7). Only thread-scoped topics get steer/queue.
- Metadata read-modify-write races with `set_mode`/`set_goal_mode` are possible but match the existing pattern; transitions reload immediately before merging just the `current_turn` key.
