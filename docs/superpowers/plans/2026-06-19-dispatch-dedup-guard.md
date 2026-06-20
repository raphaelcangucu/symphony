# Dispatch De-duplication Guard Implementation Plan

**Goal:** Stop two concurrent top-level agents from ever running in the same worktree, so the existing in-memory dispatch guard (`running`/`claimed`) stays the correct source of truth.

**Architecture:** Two small, independent changes that reuse patterns already in the codebase. (1) **Reap the Codex OS process group on teardown** — spawn the app-server under `setsid` and `kill -9 -<pgid>` before closing the port, exactly like `SymphonyElixir.Cursor.CliRunner` already does — so no orphaned Codex keeps editing a workspace after its managing `Task` dies. (2) **Make workers die with the orchestrator** — pair the `Orchestrator` GenServer and its `Task.Supervisor` under a `:one_for_all` sub-supervisor, so an Orchestrator-only crash also tears down its workers (instead of leaking them under the sibling `Task.Supervisor`). No new lock manager, DB column, heartbeat, or boot-time adoption.

**Tech Stack:** Elixir/OTP (Supervisor, Task.Supervisor, Port), `setsid(1)`/`kill(1)`, ExUnit.

**Spec:** `docs/superpowers/specs/2026-06-19-dispatch-dedup-guard-design.md`

---

## File Structure

- `elixir/lib/symphony_elixir/codex/coding_agent.ex` — modify `start_port/2` (add `setsid`) and `stop_port/1` (add process-group kill). **Lever 1.**
- `elixir/test/symphony_elixir/codex/coding_agent_test.exs` — add a reaping test (Lever 1).
- `elixir/lib/symphony_elixir/orchestrator/runner_supervisor.ex` — **new**: `:one_for_all` pair of `Task.Supervisor` + `Orchestrator`. **Lever 2.**
- `elixir/lib/symphony_elixir/orchestrator_supervisor.ex` — modify `child_specs/0` to use `RunnerSupervisor`. **Lever 2.**
- `elixir/test/symphony_elixir/supervision_tree_test.exs` — update the orchestrator-subtree test for the new nesting (Lever 2).

The two levers are independent; either order works. Do Lever 1 first (it is the primary fix — it closes the orphan that survives `stop_issue`/`hard_reset`).

---

## Task 1: Reap the Codex process group on teardown (Lever 1)

**Files:**
- Modify: `elixir/lib/symphony_elixir/codex/coding_agent.ex` (`start_port/2` ~380-401, `stop_port/1` ~1623-1638)
- Test: `elixir/test/symphony_elixir/codex/coding_agent_test.exs`

Context — the working pattern to mirror lives in `elixir/lib/symphony_elixir/cursor/cli_runner.ex`: spawn via `setsid --wait bash -lc …` (lines 82-89) and `kill -9 -<os_pid>` with a `pkill -P`/`kill` fallback (lines 442-459). Today the Codex `start_port/2` spawns plain `bash -lc …` and `stop_port/1` only does `Port.close/1`, so a killed `Task` can orphan the real Codex process (it keeps writing its rollout).

- [ ] **Step 1: Write the failing test**

Add this test and its two private helpers to `elixir/test/symphony_elixir/codex/coding_agent_test.exs` (put the test inside a new `describe "process group reaping" do … end` block, and the helpers next to the other `defp with_fake_*`/`write_*` helpers near the bottom of the module):

```elixir
  describe "process group reaping" do
    test "stop_session kills the whole Codex process group, not just the immediate child" do
      with_fake_reaper_server(fn workspace, pid_file ->
        assert {:ok, session} = AppServer.start_session(workspace)

        grandchild_pid = wait_for_pid_file!(pid_file)
        assert os_process_alive?(grandchild_pid), "fake grandchild should be running before teardown"

        AppServer.stop_session(session)

        assert eventually_dead?(grandchild_pid),
               "stop_session must reap the backgrounded grandchild (pid #{grandchild_pid})"
      end)
    end
  end
```

```elixir
  # Spawns a fake Codex app-server that backgrounds a long-lived `sleep`
  # grandchild at startup (recording its pid), then completes only the
  # start_session handshake (initialize + thread/start). The grandchild lets us
  # prove teardown kills the whole process group, not just the immediate child.
  defp with_fake_reaper_server(fun) when is_function(fun, 2) do
    test_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-elixir-coding-agent-reaper-#{System.unique_integer([:positive])}"
      )

    pid_file = Path.join(test_root, "grandchild.pid")

    try do
      workspace_root = Path.join(test_root, "workspaces")
      workspace = Path.join(workspace_root, "MT-REAP")
      codex_binary = Path.join(test_root, "fake-codex")

      File.mkdir_p!(workspace)

      File.write!(codex_binary, """
      #!/bin/sh
      sleep 300 &
      echo "$!" > "#{pid_file}"

      while IFS= read -r line; do
        case "$line" in
          *'"method":"initialize"'*)
            printf '%s\\n' '{"id":1,"result":{}}'
            ;;
          *'"method":"initialized"'*)
            ;;
          *'"method":"thread/start"'*)
            printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-reaper"}}}'
            ;;
        esac
      done
      """)

      File.chmod!(codex_binary, 0o755)

      write_workflow_file!(Workflow.workflow_file_path(),
        workspace_root: workspace_root,
        command: "#{codex_binary} app-server"
      )

      fun.(workspace, pid_file)
    after
      # Belt-and-suspenders: never leak the sleeper if the test itself fails.
      case File.read(pid_file) do
        {:ok, raw} -> System.cmd("kill", ["-9", String.trim(raw)], stderr_to_stdout: true)
        _ -> :ok
      end

      File.rm_rf(test_root)
    end
  end

  defp wait_for_pid_file!(pid_file), do: wait_for_pid_file!(pid_file, 50)

  defp wait_for_pid_file!(pid_file, 0), do: flunk("fake codex never wrote its pid to #{pid_file}")

  defp wait_for_pid_file!(pid_file, attempts) do
    case File.read(pid_file) do
      {:ok, raw} when raw != "" -> String.trim(raw)
      _ ->
        Process.sleep(20)
        wait_for_pid_file!(pid_file, attempts - 1)
    end
  end

  defp os_process_alive?(pid) when is_binary(pid) do
    match?({_, 0}, System.cmd("kill", ["-0", pid], stderr_to_stdout: true))
  end

  defp eventually_dead?(pid), do: eventually_dead?(pid, 50)

  defp eventually_dead?(_pid, 0), do: false

  defp eventually_dead?(pid, attempts) do
    if os_process_alive?(pid) do
      Process.sleep(20)
      eventually_dead?(pid, attempts - 1)
    else
      true
    end
  end
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/codex/coding_agent_test.exs:<line-of-new-test>`
(target the new test by its line number; do **not** pass `-o`, ExUnit rejects it). Expected: **FAIL** — the backgrounded `sleep` survives `stop_session` because the current `stop_port/1` only calls `Port.close/1`, which kills the immediate child but lets the `sleep` grandchild reparent to init.

> If `eventually_dead?` flakes because the fake child is never spawned, confirm `setsid` exists in the env (`command -v setsid`); the prod path already depends on it.

- [ ] **Step 3: Add `setsid` to the spawn in `start_port/2`**

Replace the body of `start_port/2` in `elixir/lib/symphony_elixir/codex/coding_agent.ex`:

```elixir
  defp start_port(workspace, codex_section) do
    case System.find_executable("bash") do
      nil ->
        {:error, :bash_not_found}

      bash ->
        command = CodexConfig.command(codex_section)

        # setsid puts the app-server in its own process group so teardown can
        # kill the whole group (see stop_port/1). --wait keeps :exit_status
        # tied to the real command. Mirrors SymphonyElixir.Cursor.CliRunner.
        {executable, port_args} =
          case System.find_executable("setsid") do
            nil ->
              {bash, [~c"-lc", String.to_charlist(command)]}

            setsid ->
              {setsid, [~c"--wait", String.to_charlist(bash), ~c"-lc", String.to_charlist(command)]}
          end

        port =
          Port.open(
            {:spawn_executable, String.to_charlist(executable)},
            [
              :binary,
              :exit_status,
              :stderr_to_stdout,
              args: port_args,
              cd: String.to_charlist(workspace),
              line: @port_line_bytes
            ]
          )

        {:ok, port}
    end
  end
```

- [ ] **Step 4: Kill the process group in `stop_port/1`**

Replace `stop_port/1` in `elixir/lib/symphony_elixir/codex/coding_agent.ex` with the following (splits the old close logic into `close_port/1` and adds the group kill — same shape as `CliRunner.kill_port/1`):

```elixir
  defp stop_port(port) when is_port(port) do
    case :erlang.port_info(port, :os_pid) do
      {:os_pid, os_pid} -> kill_process_group(os_pid)
      _ -> :ok
    end

    close_port(port)
  end

  defp kill_process_group(os_pid) do
    pid_str = to_string(os_pid)

    if System.find_executable("setsid") do
      System.cmd("kill", ["-9", "-#{pid_str}"], stderr_to_stdout: true)
    else
      System.cmd("pkill", ["-9", "-P", pid_str], stderr_to_stdout: true)
      System.cmd("kill", ["-9", pid_str], stderr_to_stdout: true)
    end

    :ok
  end

  defp close_port(port) when is_port(port) do
    case :erlang.port_info(port) do
      :undefined ->
        :ok

      _ ->
        try do
          Port.close(port)
          :ok
        rescue
          ArgumentError ->
            :ok
        end
    end
  end
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/codex/coding_agent_test.exs`
Expected: **PASS** — the new reaping test passes and all existing CodingAgent tests still pass (the fake app-server still talks over the same stdio through `setsid`).

- [ ] **Step 6: Commit**

```bash
cd elixir && git add lib/symphony_elixir/codex/coding_agent.ex test/symphony_elixir/codex/coding_agent_test.exs
git commit -m "$(cat <<'EOF'
fix(codex): reap the app-server process group on teardown

Spawn the Codex app-server under setsid and kill -9 the whole process
group before closing the port, mirroring Cursor.CliRunner. Prevents an
orphaned Codex process from surviving stop_session/stop_issue and
continuing to edit a worktree (the CDE-1139 duplicate-agent incident).
EOF
)"
```

---

## Task 2: Make workers die with the orchestrator (Lever 2)

**Files:**
- Create: `elixir/lib/symphony_elixir/orchestrator/runner_supervisor.ex`
- Modify: `elixir/lib/symphony_elixir/orchestrator_supervisor.ex` (`child_specs/0`, ~22-31)
- Test: `elixir/test/symphony_elixir/supervision_tree_test.exs`

Context — today `OrchestratorSupervisor` lists `{Task.Supervisor, name: Orchestrator.TaskSupervisor}` and `Orchestrator` as siblings under `:one_for_one`, so an `Orchestrator`-only crash leaves the `Task.Supervisor` (and its live workers) running while the orchestrator reboots with empty `running`/`claimed`. Pairing them under `:one_for_all` makes them restart together.

- [ ] **Step 1: Write the failing tests**

Replace the test `"orchestrator subtree owns the Codex TaskSupervisor, not the shared one"` (lines ~21-27) in `elixir/test/symphony_elixir/supervision_tree_test.exs` with:

```elixir
  test "orchestrator subtree pairs the Orchestrator and its Codex TaskSupervisor" do
    assert SymphonyElixir.Orchestrator.RunnerSupervisor in ids(OrchestratorSupervisor.child_specs())

    runner_specs = SymphonyElixir.Orchestrator.RunnerSupervisor.child_specs()
    assert SymphonyElixir.Orchestrator in ids(runner_specs)
    assert {Task.Supervisor, name: SymphonyElixir.Orchestrator.TaskSupervisor} in runner_specs
    refute {Task.Supervisor, name: SymphonyElixir.TaskSupervisor} in runner_specs
  end

  test "runner subtree restarts the Orchestrator and TaskSupervisor together (one_for_all)" do
    assert {:ok, {flags, _children}} = SymphonyElixir.Orchestrator.RunnerSupervisor.init([])
    assert flags.strategy == :one_for_all
  end
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd elixir && mix test test/symphony_elixir/supervision_tree_test.exs`
Expected: **FAIL** with a compile/`UndefinedFunctionError` for `SymphonyElixir.Orchestrator.RunnerSupervisor` (module does not exist yet).

- [ ] **Step 3: Create the `RunnerSupervisor`**

Create `elixir/lib/symphony_elixir/orchestrator/runner_supervisor.ex`:

```elixir
defmodule SymphonyElixir.Orchestrator.RunnerSupervisor do
  @moduledoc """
  Pairs the `Orchestrator` GenServer with its Codex `Task.Supervisor` under a
  `:one_for_all` strategy so the two live and die together.

  If the orchestrator crashes it loses its in-memory `running`/`claimed` state;
  restarting the `Task.Supervisor` alongside it tears down any in-flight workers,
  so a rebooted orchestrator never re-dispatches an issue whose previous worker
  is still alive (the CDE-1139 duplicate-agent incident). The `Task.Supervisor`
  is started first so it is available before the orchestrator's first dispatch.
  """

  use Supervisor

  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts \\ []) do
    Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    Supervisor.init(child_specs(), strategy: :one_for_all)
  end

  @spec child_specs() :: [Supervisor.child_spec() | {module(), term()} | module()]
  def child_specs do
    [
      {Task.Supervisor, name: SymphonyElixir.Orchestrator.TaskSupervisor},
      SymphonyElixir.Orchestrator
    ]
  end
end
```

- [ ] **Step 4: Point `OrchestratorSupervisor` at the new pair**

In `elixir/lib/symphony_elixir/orchestrator_supervisor.ex`, replace the first two entries of `child_specs/0` with the `RunnerSupervisor` (leave the rest unchanged):

```elixir
  def child_specs do
    [
      SymphonyElixir.Orchestrator.RunnerSupervisor,
      SymphonyElixir.DevServer.Manager,
      SymphonyElixir.DevServer.Reconciler,
      SymphonyElixir.PullRequestMonitor.Reconciler,
      SymphonyElixir.Observability.Reporter
    ]
  end
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir/supervision_tree_test.exs test/symphony_elixir/orchestrator_task_supervisor_test.exs`
Expected: **PASS** — the new pairing/strategy tests pass and the `Orchestrator.TaskSupervisor` is still reachable by name (its registered name is unchanged; only its parent supervisor changed).

- [ ] **Step 6: Commit**

```bash
cd elixir && git add lib/symphony_elixir/orchestrator/runner_supervisor.ex lib/symphony_elixir/orchestrator_supervisor.ex test/symphony_elixir/supervision_tree_test.exs
git commit -m "$(cat <<'EOF'
fix(orchestrator): restart workers with the orchestrator (one_for_all)

Pair the Orchestrator GenServer and its Codex Task.Supervisor under a
one_for_all RunnerSupervisor so an orchestrator-only crash also tears
down in-flight workers. Stops a rebooted orchestrator (empty
running/claimed) from re-dispatching an issue whose worker is still
alive — the second half of the CDE-1139 duplicate-agent fix.
EOF
)"
```

---

## Task 3: Deploy and verify the invariant end-to-end

**Files:** none (manual verification of the acceptance criteria in the spec).

- [ ] **Step 1: Compile and reload the orchestrator subtree**

Run: `cd elixir && mix compile && make update ARGS="--orchestrator"`
Expected: compiles cleanly; orchestrator subtree restarts. (If reloading a new supervisor module via hot-update misbehaves, do a clean cycle: `make stop` then `make serve`.)

- [ ] **Step 2: Verify no orphaned Codex survives a stop**

Dispatch/resume any issue so a Codex agent is live, note its `codex_app_server_pid` (logged at session start), then stop it from the tracker (or `Orchestrator.stop_issue/1`).
Run: `ps -o pid,pgid,cmd -p <codex_app_server_pid>` after the stop.
Expected: the pid (and its group) is **gone** — no rollout under that workspace keeps growing.

- [ ] **Step 3: Verify no duplicate worker after an orchestrator restart**

With an agent live for an issue, run `make update ARGS="--orchestrator"`. After it settles, confirm there is **exactly one** live agent for that workspace:
Run: `ls -1 ~/.codex/sessions/$(date +%Y/%m/%d)/ | …` (inspect rollouts) and check the orchestrator's running set.
Expected: a single live worker per workspace — never two rollouts with the same `cwd` growing at once (the CDE-1139 symptom).

- [ ] **Step 4: Full suite sanity check**

Run: `cd elixir && mix test`
Expected: no new failures versus the pre-change baseline. (Note: `agent_runner_test` has known pre-existing flaky `{:incomplete, :max_turns}` cases unrelated to this change.)

---

## Self-Review

- **Spec coverage:** Lever 1 (reaping, spec §4.1) → Task 1. Lever 2 (workers die with orchestrator, spec §4.2) → Task 2. Acceptance criteria (spec §5: reaping, restart de-dup, no regression) → Task 3 + the unit tests. The `flock` alternative (spec §4 note) is intentionally **not** implemented — Levers 1+2 are the chosen path.
- **No new tracking system:** confirmed — no lock file, DB column, heartbeat, or boot adoption added; the existing `should_dispatch_issue?`/`:already_running` guards are untouched and remain sufficient once workers can no longer outlive the orchestrator's memory.
- **Type/name consistency:** `RunnerSupervisor` exposes `child_specs/0` + `init/1` (mirrors `OrchestratorSupervisor`); the `Task.Supervisor` keeps its registered name `SymphonyElixir.Orchestrator.TaskSupervisor` (no callers break); `stop_port/1` keeps its name and delegates to new `kill_process_group/1` + `close_port/1`.
- **Placeholders:** none — every step has complete code and exact commands.
