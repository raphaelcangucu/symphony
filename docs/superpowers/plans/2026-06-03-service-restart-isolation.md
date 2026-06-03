# Service Restart Isolation (web / orchestrator / code-server) Implementation Plan

**Goal:** Run Symphony as one long-lived detached BEAM whose web, orchestrator, and editor subtrees can be restarted independently, so a web restart never kills in-flight Codex turns or the code-server connection.

**Architecture:** Regroup the flat `SymphonyElixir.Application` tree into four named child supervisors (`Shared`, `Orchestrator`, `Web`, `Editor`). A new `SymphonyElixir.Ctl` module (called over distributed-Erlang `:erpc` from a short-lived control node) reloads changed modules and restarts only the selected subtrees. A new `mix symphony.ctl <serve|update|stop>` task parses real flags (`--web` default, `--orchestrator`, `--code-server`/`--editor`, `--all`) and either boots the daemon detached or RPCs into it. Makefile `serve`/`update`/`stop` wrap the task.

**Tech Stack:** Elixir/OTP (Supervisor, `:erpc`, `:code.modified_modules`, distributed Erlang, EPMD), Mix tasks + `OptionParser`, ExUnit, Make.

**Spec:** `docs/superpowers/specs/2026-06-03-service-restart-isolation-design.md`

---

## File Structure

**Create:**
- `elixir/lib/symphony_elixir/shared_supervisor.ex` — always-on subtree (Repo/single SQLite writer, PubSub, registries, shared `TaskSupervisor`, sync, workflow store, public routing).
- `elixir/lib/symphony_elixir/orchestrator_supervisor.ex` — orchestrator + `Orchestrator.TaskSupervisor` (Codex turn tasks) + dev-server + reporter.
- `elixir/lib/symphony_elixir/web_supervisor.ex` — HttpServer + StatusDashboard.
- `elixir/lib/symphony_elixir/editor_supervisor.ex` — Editor.Server (conditional on `Config.editor_enabled?/0`).
- `elixir/lib/symphony_elixir/ctl.ex` — in-daemon control: reload modified modules + restart/stop subtrees. Also node-name/cookie resolution helpers.
- `elixir/lib/mix/tasks/symphony.ctl.ex` — CLI entrypoint: flag parsing, detached boot, control-node connect + `:erpc`.
- `elixir/test/symphony_elixir/supervision_tree_test.exs` — asserts subtree groupings + TaskSupervisor boundary.
- `elixir/test/symphony_elixir/ctl_test.exs` — asserts restart/stop touch only selected subtrees; reload-fn injection.
- `elixir/test/mix/tasks/symphony_ctl_test.exs` — asserts flag → target parsing + defaults.

**Modify:**
- `elixir/lib/symphony_elixir.ex` (`SymphonyElixir.Application.start/2`) — replace flat child list with the four sub-supervisors.
- `elixir/lib/symphony_elixir/orchestrator.ex:402,581` — switch the two Codex-task sites from `SymphonyElixir.TaskSupervisor` to `SymphonyElixir.Orchestrator.TaskSupervisor`.
- `elixir/Makefile` — `serve`/`update`/`stop` recipes wrap `mix symphony.ctl`; drop the old `pkill` stop.
- `elixir/.env` — document `SYMPHONY_NODE_NAME` / `SYMPHONY_NODE_COOKIE` (dev defaults).
- `elixir/README.md` — document the new serve/update/stop workflow.

**Unchanged but referenced:** `elixir/dev/serve.exs` (still sets workflow path, port, migrates, sleeps; now launched with `--name/--cookie` by the task), `elixir/lib/symphony_elixir/dev_serve_guard.ex` (extended to record node name in Task 6).

---

## Task 1: Split the Codex `TaskSupervisor` from the shared one

**Why first:** smallest safe change, unblocks the subtree grouping. The shared `SymphonyElixir.TaskSupervisor` is used by the web `AssistantChannel` and `GitHub.ReadCache`; only the orchestrator's Codex turns should restart with `:orchestrator`.

**Files:**
- Modify: `elixir/lib/symphony_elixir.ex:49` (add the new Task.Supervisor to the existing flat list — it gets regrouped in Task 3)
- Modify: `elixir/lib/symphony_elixir/orchestrator.ex:402` and `:581`
- Test: `elixir/test/symphony_elixir/orchestrator_task_supervisor_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/orchestrator_task_supervisor_test.exs`:

```elixir
defmodule SymphonyElixir.OrchestratorTaskSupervisorTest do
  use ExUnit.Case, async: true

  test "the orchestrator Task.Supervisor is registered and distinct from the shared one" do
    start_supervised!({Task.Supervisor, name: SymphonyElixir.TaskSupervisor})
    start_supervised!({Task.Supervisor, name: SymphonyElixir.Orchestrator.TaskSupervisor})

    shared = Process.whereis(SymphonyElixir.TaskSupervisor)
    orchestrator = Process.whereis(SymphonyElixir.Orchestrator.TaskSupervisor)

    assert is_pid(shared)
    assert is_pid(orchestrator)
    refute shared == orchestrator
  end

  test "orchestrator source references Orchestrator.TaskSupervisor for dispatch" do
    source = File.read!("lib/symphony_elixir/orchestrator.ex")
    assert source =~ "SymphonyElixir.Orchestrator.TaskSupervisor"
    refute source =~ "Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor"
  end
end
```

- [ ] **Step 2: Run it to confirm it fails**

Run (from `elixir/`): `mix test test/symphony_elixir/orchestrator_task_supervisor_test.exs`
Expected: the second test FAILS (source still references the shared supervisor for dispatch).

- [ ] **Step 3: Switch the two orchestrator dispatch sites**

In `elixir/lib/symphony_elixir/orchestrator.ex`, change line ~402:

```elixir
  defp terminate_task(pid) when is_pid(pid) do
    case Task.Supervisor.terminate_child(SymphonyElixir.Orchestrator.TaskSupervisor, pid) do
      :ok ->
        :ok

      {:error, :not_found} ->
        Process.exit(pid, :shutdown)
    end
  end
```

and line ~581 (inside `do_dispatch_issue/3`):

```elixir
    case Task.Supervisor.start_child(SymphonyElixir.Orchestrator.TaskSupervisor, fn ->
           AgentRunner.run(issue, recipient, attempt: attempt)
         end) do
```

- [ ] **Step 4: Register the new supervisor in the (still flat) tree**

In `elixir/lib/symphony_elixir.ex`, add the new Task.Supervisor right after the existing one (line ~49):

```elixir
      {Task.Supervisor, name: SymphonyElixir.TaskSupervisor},
      {Task.Supervisor, name: SymphonyElixir.Orchestrator.TaskSupervisor},
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `mix test test/symphony_elixir/orchestrator_task_supervisor_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir.ex elixir/lib/symphony_elixir/orchestrator.ex elixir/test/symphony_elixir/orchestrator_task_supervisor_test.exs
git commit -m "refactor: dedicate Orchestrator.TaskSupervisor for Codex turns"
```

---

## Task 2: Create the four sub-supervisor modules

**Files:**
- Create: `elixir/lib/symphony_elixir/shared_supervisor.ex`
- Create: `elixir/lib/symphony_elixir/orchestrator_supervisor.ex`
- Create: `elixir/lib/symphony_elixir/web_supervisor.ex`
- Create: `elixir/lib/symphony_elixir/editor_supervisor.ex`
- Test: `elixir/test/symphony_elixir/supervision_tree_test.exs`

Each module exposes a pure `child_specs/0` (so the grouping is unit-testable without booting) and a standard `Supervisor` `start_link/init`.

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/supervision_tree_test.exs`:

```elixir
defmodule SymphonyElixir.SupervisionTreeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.{SharedSupervisor, OrchestratorSupervisor, WebSupervisor, EditorSupervisor}

  defp ids(child_specs) do
    Enum.map(child_specs, fn
      %{id: id} -> id
      {mod, _opts} -> mod
      mod when is_atom(mod) -> mod
    end)
  end

  test "shared subtree owns the single SQLite writer and the shared TaskSupervisor" do
    ids = ids(SharedSupervisor.child_specs())
    assert SymphonyElixir.Repo in ids
    assert Phoenix.PubSub in ids
    assert {Task.Supervisor, name: SymphonyElixir.TaskSupervisor} in SharedSupervisor.child_specs()
  end

  test "orchestrator subtree owns the Codex TaskSupervisor, not the shared one" do
    specs = OrchestratorSupervisor.child_specs()
    ids = ids(specs)
    assert SymphonyElixir.Orchestrator in ids
    assert {Task.Supervisor, name: SymphonyElixir.Orchestrator.TaskSupervisor} in specs
    refute {Task.Supervisor, name: SymphonyElixir.TaskSupervisor} in specs
  end

  test "web subtree owns the HTTP server and dashboard only" do
    ids = ids(WebSupervisor.child_specs())
    assert SymphonyElixir.HttpServer in ids
    assert SymphonyElixir.StatusDashboard in ids
    refute SymphonyElixir.Orchestrator in ids
  end

  test "editor subtree is empty when the editor is disabled" do
    assert EditorSupervisor.child_specs(false) == []
    assert SymphonyElixir.Editor.Server in ids(EditorSupervisor.child_specs(true))
  end
end
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `mix test test/symphony_elixir/supervision_tree_test.exs`
Expected: FAIL — modules `SharedSupervisor` etc. are undefined.

- [ ] **Step 3: Create `SharedSupervisor`**

Create `elixir/lib/symphony_elixir/shared_supervisor.ex`:

```elixir
defmodule SymphonyElixir.SharedSupervisor do
  @moduledoc """
  Always-on infrastructure subtree: the single SQLite-writing `Repo`, PubSub,
  registries, the shared `Task.Supervisor`, sync engine, workflow store, and
  public routing. Never restarted by `mix symphony.ctl update`; only torn down
  on a full daemon stop.
  """

  use Supervisor

  alias SymphonyElixir.LocalTracker.Templates

  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts \\ []) do
    Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    Supervisor.init(child_specs(), strategy: :one_for_one)
  end

  @spec child_specs() :: [Supervisor.child_spec() | {module(), term()} | module()]
  def child_specs do
    [
      {Phoenix.PubSub, name: SymphonyElixir.PubSub},
      SymphonyElixir.Observability.Registry,
      SymphonyElixir.Repo,
      SymphonyElixir.LocalTracker.CloneSupervisor,
      %{
        id: :seed_builtin_templates,
        start:
          {Task, :start_link,
           [
             fn ->
               try do
                 Templates.import_builtins()
               rescue
                 _ -> :ok
               end
             end
           ]},
        restart: :temporary
      },
      SymphonyElixir.LocalTracker.Viewer.Server,
      {Task.Supervisor, name: SymphonyElixir.TaskSupervisor},
      SymphonyElixir.GitHub.ReadCache,
      SymphonyElixir.GitHub.RequestGateway,
      SymphonyElixir.Tracker.Sync.Engine,
      SymphonyElixir.WorkflowStore,
      SymphonyElixir.PublicRouting
    ]
  end
end
```

- [ ] **Step 4: Create `OrchestratorSupervisor`**

Create `elixir/lib/symphony_elixir/orchestrator_supervisor.ex`:

```elixir
defmodule SymphonyElixir.OrchestratorSupervisor do
  @moduledoc """
  Orchestrator subtree. Owns `Orchestrator.TaskSupervisor` (the Codex turn
  tasks/Ports), the orchestrator itself, dev-server management, and the
  observability reporter. Restarted by `mix symphony.ctl update --orchestrator`;
  untouched by a `--web` restart so in-flight Codex turns survive.
  """

  use Supervisor

  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts \\ []) do
    Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    Supervisor.init(child_specs(), strategy: :one_for_one)
  end

  @spec child_specs() :: [Supervisor.child_spec() | {module(), term()} | module()]
  def child_specs do
    [
      {Task.Supervisor, name: SymphonyElixir.Orchestrator.TaskSupervisor},
      SymphonyElixir.Orchestrator,
      SymphonyElixir.DevServer.Manager,
      SymphonyElixir.DevServer.Reconciler,
      SymphonyElixir.Observability.Reporter
    ]
  end
end
```

- [ ] **Step 5: Create `WebSupervisor`**

Create `elixir/lib/symphony_elixir/web_supervisor.ex`:

```elixir
defmodule SymphonyElixir.WebSupervisor do
  @moduledoc """
  Web subtree: the Phoenix/HTTP listener and the terminal status dashboard.
  This is the default `mix symphony.ctl update` target — restarting it recycles
  only the HTTP listener and leaves the orchestrator and editor running.
  """

  use Supervisor

  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts \\ []) do
    Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    Supervisor.init(child_specs(), strategy: :one_for_one)
  end

  @spec child_specs() :: [Supervisor.child_spec() | module()]
  def child_specs do
    [
      SymphonyElixir.HttpServer,
      SymphonyElixir.StatusDashboard
    ]
  end
end
```

- [ ] **Step 6: Create `EditorSupervisor`**

Create `elixir/lib/symphony_elixir/editor_supervisor.ex`:

```elixir
defmodule SymphonyElixir.EditorSupervisor do
  @moduledoc """
  Editor subtree: the `code-server` manager (`Editor.Server`), present only when
  `Config.editor_enabled?/0`. The managed `code-server` is an external process
  that `Editor.Server` reuses across restarts, so restarting this subtree (or a
  full restart) never drops a live editor session.
  """

  use Supervisor

  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts \\ []) do
    Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    Supervisor.init(child_specs(editor_enabled?()), strategy: :one_for_one)
  end

  @spec child_specs(boolean()) :: [module()]
  def child_specs(true), do: [SymphonyElixir.Editor.Server]
  def child_specs(false), do: []

  @spec child_specs() :: [module()]
  def child_specs, do: child_specs(editor_enabled?())

  defp editor_enabled? do
    SymphonyElixir.Config.editor_enabled?()
  rescue
    _ -> false
  end
end
```

- [ ] **Step 7: Run the test to confirm it passes**

Run: `mix test test/symphony_elixir/supervision_tree_test.exs`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add elixir/lib/symphony_elixir/shared_supervisor.ex elixir/lib/symphony_elixir/orchestrator_supervisor.ex elixir/lib/symphony_elixir/web_supervisor.ex elixir/lib/symphony_elixir/editor_supervisor.ex elixir/test/symphony_elixir/supervision_tree_test.exs
git commit -m "feat: add web/orchestrator/editor/shared sub-supervisor modules"
```

---

## Task 3: Wire the sub-supervisors into the application root

**Files:**
- Modify: `elixir/lib/symphony_elixir.ex` (`SymphonyElixir.Application.start/2`)
- Test: extend `elixir/test/symphony_elixir/supervision_tree_test.exs`

- [ ] **Step 1: Add a failing boot-shape test**

Append to `elixir/test/symphony_elixir/supervision_tree_test.exs`:

```elixir
  test "application root lists exactly the four named sub-supervisors in order" do
    assert SymphonyElixir.Application.root_children() == [
             SymphonyElixir.SharedSupervisor,
             SymphonyElixir.OrchestratorSupervisor,
             SymphonyElixir.WebSupervisor,
             SymphonyElixir.EditorSupervisor
           ]
  end
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `mix test test/symphony_elixir/supervision_tree_test.exs`
Expected: FAIL — `root_children/0` undefined.

- [ ] **Step 3: Replace the flat tree with the sub-supervisors**

In `elixir/lib/symphony_elixir.ex`, replace the `SymphonyElixir.Application` body's `start/2` (and the now-unused `base_children`/`editor_children`/`editor_enabled?` helpers) with:

```elixir
  @impl true
  def start(_type, _args) do
    :ok = SymphonyElixir.LogFile.configure()

    Supervisor.start_link(
      root_children(),
      strategy: :one_for_one,
      name: SymphonyElixir.Supervisor
    )
  end

  @impl true
  def stop(_state) do
    SymphonyElixir.StatusDashboard.render_offline_status()
    :ok
  end

  @spec root_children() :: [module()]
  def root_children do
    [
      SymphonyElixir.SharedSupervisor,
      SymphonyElixir.OrchestratorSupervisor,
      SymphonyElixir.WebSupervisor,
      SymphonyElixir.EditorSupervisor
    ]
  end
```

Remove the old `base_children` list, the `editor_children/0`, the `editor_enabled?/0` helper, and the now-unused `alias SymphonyElixir.LocalTracker.Templates` from this module (it moved to `SharedSupervisor`).

- [ ] **Step 4: Run the boot test + the existing serve smoke**

Run: `mix test test/symphony_elixir/supervision_tree_test.exs`
Expected: PASS (5 tests).

Then verify the app actually boots with the new tree:

Run: `mix run --no-start -e "{:ok, _} = Application.ensure_all_started(:symphony_elixir); IO.inspect(Enum.map(Supervisor.which_children(SymphonyElixir.Supervisor), &elem(&1, 0)), label: :root); :init.stop()"`
Expected output includes:
`root: [SymphonyElixir.SharedSupervisor, SymphonyElixir.OrchestratorSupervisor, SymphonyElixir.WebSupervisor, SymphonyElixir.EditorSupervisor]`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir.ex elixir/test/symphony_elixir/supervision_tree_test.exs
git commit -m "feat: boot Symphony as four restartable sub-supervisors"
```

---

## Task 4: `SymphonyElixir.Ctl` — reload + restart/stop subtrees

**Files:**
- Create: `elixir/lib/symphony_elixir/ctl.ex`
- Test: `elixir/test/symphony_elixir/ctl_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/ctl_test.exs`:

```elixir
defmodule SymphonyElixir.CtlTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Ctl

  # Build a throwaway top supervisor whose "subtrees" are Agents, so we can
  # observe which ones get restarted (pid changes) without booting the real app.
  defp start_fake_tree do
    children = [
      Supervisor.child_spec({Agent, fn -> :web end}, id: :web_sup),
      Supervisor.child_spec({Agent, fn -> :orchestrator end}, id: :orchestrator_sup),
      Supervisor.child_spec({Agent, fn -> :editor end}, id: :editor_sup)
    ]

    {:ok, sup} = Supervisor.start_link(children, strategy: :one_for_one)
    sup
  end

  defp child_pid(sup, id) do
    {^id, pid, _, _} = Enum.find(Supervisor.which_children(sup), &(elem(&1, 0) == id))
    pid
  end

  test "restart/2 restarts only the requested subtrees and reloads modules first" do
    sup = start_fake_tree()
    ids = %{web: :web_sup, orchestrator: :orchestrator_sup, editor: :editor_sup}

    test_pid = self()
    reload_fun = fn -> send(test_pid, :reloaded); [SomeModule] end

    before_web = child_pid(sup, :web_sup)
    before_orch = child_pid(sup, :orchestrator_sup)

    assert {:ok, %{restarted: [:web], reloaded: [SomeModule]}} =
             Ctl.restart([:web], supervisor: sup, ids: ids, reload_fun: reload_fun)

    assert_received :reloaded
    refute child_pid(sup, :web_sup) == before_web
    assert child_pid(sup, :orchestrator_sup) == before_orch
  end

  test "stop_subtrees/2 terminates only the requested subtrees (no restart)" do
    sup = start_fake_tree()
    ids = %{web: :web_sup, orchestrator: :orchestrator_sup, editor: :editor_sup}

    assert :ok = Ctl.stop_subtrees([:web], supervisor: sup, ids: ids)

    assert {:web_sup, :undefined, _, _} =
             Enum.find(Supervisor.which_children(sup), &(elem(&1, 0) == :web_sup))

    assert {:orchestrator_sup, pid, _, _} =
             Enum.find(Supervisor.which_children(sup), &(elem(&1, 0) == :orchestrator_sup))

    assert is_pid(pid)
  end

  test "node_name/0 and cookie/0 honor env overrides with dev defaults" do
    assert Ctl.node_name(%{}) == "symphony@127.0.0.1"
    assert Ctl.node_name(%{"SYMPHONY_NODE_NAME" => "sym2"}) == "sym2@127.0.0.1"
    assert Ctl.cookie(%{}) == "symphony-dev-cookie"
    assert Ctl.cookie(%{"SYMPHONY_NODE_COOKIE" => "abc"}) == "abc"
  end
end
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `mix test test/symphony_elixir/ctl_test.exs`
Expected: FAIL — `SymphonyElixir.Ctl` undefined.

- [ ] **Step 3: Implement `SymphonyElixir.Ctl`**

Create `elixir/lib/symphony_elixir/ctl.ex`:

```elixir
defmodule SymphonyElixir.Ctl do
  @moduledoc """
  In-daemon control surface invoked over distributed Erlang (`:erpc`) by the
  `mix symphony.ctl` task. Reloads modules whose `.beam` changed on disk, then
  restarts or stops the requested supervision subtrees. Pure helpers
  (`node_name/1`, `cookie/1`) are shared with the CLI for node discovery.
  """

  require Logger

  @type target :: :web | :orchestrator | :editor

  @default_ids %{
    web: SymphonyElixir.WebSupervisor,
    orchestrator: SymphonyElixir.OrchestratorSupervisor,
    editor: SymphonyElixir.EditorSupervisor
  }

  @default_node_name "symphony"
  @default_cookie "symphony-dev-cookie"

  @spec restart([target()], keyword()) :: {:ok, %{reloaded: [module()], restarted: [target()]}}
  def restart(targets, opts \\ []) when is_list(targets) do
    supervisor = Keyword.get(opts, :supervisor, SymphonyElixir.Supervisor)
    ids = Keyword.get(opts, :ids, @default_ids)
    reload_fun = Keyword.get(opts, :reload_fun, &reload_modified_modules/0)

    reloaded = reload_fun.()

    restarted =
      Enum.map(targets, fn target ->
        id = Map.fetch!(ids, target)
        _ = Supervisor.terminate_child(supervisor, id)

        case Supervisor.restart_child(supervisor, id) do
          {:ok, _pid} -> :ok
          {:ok, _pid, _info} -> :ok
          {:error, reason} -> Logger.error("ctl: restart #{inspect(id)} failed: #{inspect(reason)}")
        end

        target
      end)

    {:ok, %{reloaded: reloaded, restarted: restarted}}
  end

  @spec stop_subtrees([target()], keyword()) :: :ok
  def stop_subtrees(targets, opts \\ []) when is_list(targets) do
    supervisor = Keyword.get(opts, :supervisor, SymphonyElixir.Supervisor)
    ids = Keyword.get(opts, :ids, @default_ids)

    Enum.each(targets, fn target ->
      id = Map.fetch!(ids, target)
      _ = Supervisor.terminate_child(supervisor, id)
    end)

    :ok
  end

  @spec reload_modified_modules() :: [module()]
  def reload_modified_modules do
    Enum.map(:code.modified_modules(), fn module ->
      :code.purge(module)
      :code.load_file(module)
      module
    end)
  end

  @spec node_name(map()) :: String.t()
  def node_name(env \\ System.get_env()) do
    base = Map.get(env, "SYMPHONY_NODE_NAME", @default_node_name)
    "#{base}@127.0.0.1"
  end

  @spec cookie(map()) :: String.t()
  def cookie(env \\ System.get_env()) do
    Map.get(env, "SYMPHONY_NODE_COOKIE", @default_cookie)
  end
end
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `mix test test/symphony_elixir/ctl_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/ctl.ex elixir/test/symphony_elixir/ctl_test.exs
git commit -m "feat: add SymphonyElixir.Ctl reload + subtree restart/stop"
```

---

## Task 5: `mix symphony.ctl` — flag parsing

**Files:**
- Create: `elixir/lib/mix/tasks/symphony.ctl.ex`
- Test: `elixir/test/mix/tasks/symphony_ctl_test.exs`

This task adds only the task module + the pure `parse/1` helper (boot/RPC wiring lands in Task 6 so the CLI behavior is testable in isolation first).

- [ ] **Step 1: Write the failing test**

Create `elixir/test/mix/tasks/symphony_ctl_test.exs`:

```elixir
defmodule Mix.Tasks.Symphony.CtlTest do
  use ExUnit.Case, async: true

  alias Mix.Tasks.Symphony.Ctl, as: Task

  test "update defaults to web-only" do
    assert {:update, [:web]} = Task.parse(["update"])
  end

  test "stop defaults to all subtrees (full shutdown)" do
    assert {:stop, :all} = Task.parse(["stop"])
  end

  test "explicit flags accumulate and de-dupe in canonical order" do
    assert {:update, [:web, :orchestrator]} =
             Task.parse(["update", "--orchestrator", "--web", "--web"])
  end

  test "--code-server and --editor are aliases" do
    assert {:update, [:editor]} = Task.parse(["update", "--code-server"])
    assert {:update, [:editor]} = Task.parse(["update", "--editor"])
  end

  test "--all expands to every subtree for update, and :all for stop" do
    assert {:update, [:web, :orchestrator, :editor]} = Task.parse(["update", "--all"])
    assert {:stop, :all} = Task.parse(["stop", "--all"])
  end

  test "stop with a single flag targets just that subtree" do
    assert {:stop, [:orchestrator]} = Task.parse(["stop", "--orchestrator"])
  end

  test "serve ignores subtree flags (full bring-up)" do
    assert {:serve, :all} = Task.parse(["serve"])
    assert {:serve, :all} = Task.parse(["serve", "--web"])
  end

  test "unknown subcommand raises a clear error" do
    assert_raise Mix.Error, ~r/unknown command/i, fn -> Task.parse(["frobnicate"]) end
  end
end
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `mix test test/mix/tasks/symphony_ctl_test.exs`
Expected: FAIL — task module undefined.

- [ ] **Step 3: Implement the task with the pure `parse/1`**

Create `elixir/lib/mix/tasks/symphony.ctl.ex`:

```elixir
defmodule Mix.Tasks.Symphony.Ctl do
  @shortdoc "Control the Symphony dev daemon (serve | update | stop)"
  @moduledoc """
  Controls the long-lived Symphony dev daemon so subtrees restart independently.

      mix symphony.ctl serve                 # boot/ensure the daemon (all subtrees)
      mix symphony.ctl update                # recompile + restart the web subtree (default)
      mix symphony.ctl update --orchestrator # restart only the orchestrator subtree
      mix symphony.ctl update --all          # restart web + orchestrator + editor
      mix symphony.ctl stop                  # full daemon shutdown (default)
      mix symphony.ctl stop --web            # stop only the web subtree, daemon stays up

  Subtree flags: --web, --orchestrator, --code-server (alias --editor), --all.
  `update` with no flag means --web. `stop` with no flag means a full shutdown.
  """

  use Mix.Task

  @canonical_order [:web, :orchestrator, :editor]

  @switches [web: :boolean, orchestrator: :boolean, editor: :boolean, code_server: :boolean, all: :boolean]
  @aliases []

  @impl true
  def run(argv) do
    case parse(argv) do
      {:serve, _} -> Mix.raise("serve wiring lands in the next task")
      {:update, _targets} -> Mix.raise("update wiring lands in the next task")
      {:stop, _targets} -> Mix.raise("stop wiring lands in the next task")
    end
  end

  @doc false
  @spec parse([String.t()]) :: {:serve, :all} | {:update, [atom()]} | {:stop, [atom()] | :all}
  def parse([command | rest]) when command in ~w(serve update stop) do
    {opts, _argv, _invalid} = OptionParser.parse(rest, switches: @switches, aliases: @aliases)
    targets = targets_from_opts(opts)
    build(String.to_atom(command), targets)
  end

  def parse([command | _]), do: Mix.raise("unknown command #{inspect(command)} (use serve | update | stop)")
  def parse([]), do: Mix.raise("unknown command (use serve | update | stop)")

  defp build(:serve, _targets), do: {:serve, :all}
  defp build(:update, []), do: {:update, [:web]}
  defp build(:update, targets), do: {:update, targets}
  defp build(:stop, []), do: {:stop, :all}
  defp build(:stop, @canonical_order), do: {:stop, :all}
  defp build(:stop, targets), do: {:stop, targets}

  defp targets_from_opts(opts) do
    cond do
      Keyword.get(opts, :all) ->
        @canonical_order

      true ->
        selected =
          opts
          |> Enum.flat_map(fn
            {:web, true} -> [:web]
            {:orchestrator, true} -> [:orchestrator]
            {:editor, true} -> [:editor]
            {:code_server, true} -> [:editor]
            _ -> []
          end)
          |> Enum.uniq()

        Enum.filter(@canonical_order, &(&1 in selected))
    end
  end
end
```

Note: `OptionParser` maps `--code-server` to the `:code_server` switch automatically (dashes → underscores).

- [ ] **Step 4: Run the test to confirm it passes**

Run: `mix test test/mix/tasks/symphony_ctl_test.exs`
Expected: PASS (8 tests). The `run/1` stubs raise on purpose; they are replaced in Task 6 and are not exercised by `parse/1` tests.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/mix/tasks/symphony.ctl.ex elixir/test/mix/tasks/symphony_ctl_test.exs
git commit -m "feat: add mix symphony.ctl flag parsing (web default, all, stop=full)"
```

---

## Task 6: Detached daemon boot + control-node RPC wiring

**Files:**
- Modify: `elixir/lib/mix/tasks/symphony.ctl.ex` (`run/1`, boot + RPC helpers)
- Modify: `elixir/lib/symphony_elixir/dev_serve_guard.ex` (record node name in the lock)
- Test: extend `elixir/test/symphony_elixir/dev_serve_guard_test.exs` (node-name recording) — create if it does not exist.

- [ ] **Step 1: Record the node name in the serve lock (failing test first)**

Create or extend `elixir/test/symphony_elixir/dev_serve_guard_test.exs`:

```elixir
defmodule SymphonyElixir.DevServeGuardTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServeGuard

  test "acquire records the node name so ctl can discover the daemon" do
    lock = Path.join(System.tmp_dir!(), "symphony-test-#{:erlang.unique_integer([:positive])}.lock")
    on_exit(fn -> File.rm_rf(lock) end)

    assert :ok =
             DevServeGuard.acquire(
               lock_path: lock,
               workflow_path: "WORKFLOW.md",
               node_name: "symphony@127.0.0.1"
             )

    assert {:ok, %{"node_name" => "symphony@127.0.0.1"}} = DevServeGuard.read(lock)
  end
end
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `mix test test/symphony_elixir/dev_serve_guard_test.exs`
Expected: FAIL — `:node_name` option ignored / `read/1` undefined.

- [ ] **Step 3: Extend `DevServeGuard` to persist + expose the node name**

In `elixir/lib/symphony_elixir/dev_serve_guard.ex`:

Add a public reader near `default_lock_path/0`:

```elixir
  @spec read(Path.t()) :: {:ok, lock_info()} | :error
  def read(lock_path \\ default_lock_path()), do: read_lock(lock_path)
```

Thread a `:node_name` option through `acquire/1` and `write_lock/3`:

```elixir
  def acquire(opts \\ []) when is_list(opts) do
    lock_path = Keyword.get(opts, :lock_path, default_lock_path())
    self_pid = opts |> Keyword.get(:self_pid, System.pid()) |> to_string()
    workflow_path = opts |> Keyword.get(:workflow_path) |> normalize_workflow_path()
    node_name = Keyword.get(opts, :node_name, "")
    alive? = Keyword.get(opts, :alive?, &os_process_alive?/1)

    case read_lock(lock_path) do
      {:ok, %{"pid" => pid} = existing} when is_binary(pid) and pid != "" ->
        cond do
          pid == self_pid -> write_lock(lock_path, self_pid, workflow_path, node_name)
          alive?.(pid) -> {:error, {:already_running, existing}}
          true -> write_lock(lock_path, self_pid, workflow_path, node_name)
        end

      _ ->
        write_lock(lock_path, self_pid, workflow_path, node_name)
    end
  end
```

```elixir
  defp write_lock(lock_path, self_pid, workflow_path, node_name) do
    payload = %{
      "pid" => self_pid,
      "workflow_path" => workflow_path,
      "node_name" => node_name,
      "acquired_at" => DateTime.utc_now() |> DateTime.to_iso8601()
    }

    File.mkdir_p!(Path.dirname(lock_path))
    File.write!(lock_path, Jason.encode!(payload))
    :ok
  end
```

- [ ] **Step 4: Pass the node name from `dev/serve.exs`**

In `elixir/dev/serve.exs`, update `ensure_single_instance!/1` to record the running node:

```elixir
  defp ensure_single_instance!(workflow_path) do
    case SymphonyElixir.DevServeGuard.acquire(
           workflow_path: workflow_path,
           node_name: to_string(node())
         ) do
```

(Leave the rest of `ensure_single_instance!/1` unchanged.)

- [ ] **Step 5: Run the guard test**

Run: `mix test test/symphony_elixir/dev_serve_guard_test.exs`
Expected: PASS.

- [ ] **Step 6: Implement boot + RPC in the task**

Replace `run/1` in `elixir/lib/mix/tasks/symphony.ctl.ex` and add the helpers:

```elixir
  @impl true
  def run(argv) do
    case parse(argv) do
      {:serve, _} -> serve()
      {:update, targets} -> rpc_restart(targets)
      {:stop, :all} -> stop_daemon()
      {:stop, targets} -> rpc_stop_subtrees(targets)
    end
  end

  defp serve do
    env = System.get_env()
    node = SymphonyElixir.Ctl.node_name(env)

    case running_daemon() do
      {:ok, info} ->
        Mix.shell().info("Symphony daemon already running (node #{info["node_name"]}). #{status_line()}")

      :none ->
        boot_detached(node, SymphonyElixir.Ctl.cookie(env))
        wait_until_ready()
        Mix.shell().info("Symphony daemon started (node #{node}). #{status_line()}")
    end
  end

  defp boot_detached(node, cookie) do
    workflow = System.get_env("SYMPHONY_WORKFLOW", "WORKFLOW.md")
    File.mkdir_p!(".symphony")

    command =
      "setsid elixir --name #{node} --cookie #{cookie} -S mix run --no-start dev/serve.exs " <>
        "#{shell_escape(workflow)} > .symphony/serve.log 2>&1 < /dev/null &"

    {_out, 0} = System.cmd("sh", ["-c", command])
    :ok
  end

  defp rpc_restart(targets) do
    on_daemon(fn node ->
      case :erpc.call(node, SymphonyElixir.Ctl, :restart, [targets]) do
        {:ok, %{restarted: restarted, reloaded: reloaded}} ->
          Mix.shell().info("restarted: #{inspect(restarted)} (reloaded #{length(reloaded)} module(s))")
      end
    end)
  end

  defp rpc_stop_subtrees(targets) do
    on_daemon(fn node ->
      :ok = :erpc.call(node, SymphonyElixir.Ctl, :stop_subtrees, [targets])
      Mix.shell().info("stopped subtree(s): #{inspect(targets)} (daemon still running)")
    end)
  end

  defp stop_daemon do
    case running_daemon() do
      :none ->
        Mix.shell().info("No running Symphony daemon.")

      {:ok, info} ->
        on_daemon(fn node ->
          _ = :erpc.call(node, :init, :stop, [])
          File.rm(lock_path())
          Mix.shell().info("Symphony daemon stopped (node #{info["node_name"]}).")
        end)
    end
  end

  # --- daemon discovery / connection ---------------------------------------

  defp on_daemon(fun) do
    case running_daemon() do
      :none ->
        Mix.raise("No running Symphony daemon. Run `make serve` first.")

      {:ok, _info} ->
        node = String.to_atom(SymphonyElixir.Ctl.node_name())
        ensure_distributed!()
        Node.set_cookie(String.to_atom(SymphonyElixir.Ctl.cookie()))

        case Node.connect(node) do
          true -> fun.(node)
          _ -> Mix.raise("Could not connect to Symphony daemon node #{node}.")
        end
    end
  end

  defp ensure_distributed! do
    if node() == :nonode@nohost do
      ctl_node = :"symphony_ctl_#{:erlang.unique_integer([:positive])}@127.0.0.1"
      {:ok, _} = Node.start(ctl_node, :longnames)
    end

    :ok
  end

  defp running_daemon do
    case SymphonyElixir.DevServeGuard.read(lock_path()) do
      {:ok, %{"pid" => pid} = info} when is_binary(pid) and pid != "" ->
        if os_alive?(pid), do: {:ok, info}, else: :none

      _ ->
        :none
    end
  end

  defp lock_path, do: SymphonyElixir.DevServeGuard.default_lock_path()

  defp os_alive?(pid) do
    match?({_, 0}, System.cmd("kill", ["-0", pid], stderr_to_stdout: true))
  rescue
    _ -> false
  end

  defp wait_until_ready(attempts \\ 60)
  defp wait_until_ready(0), do: Mix.shell().info("(daemon still starting; check .symphony/serve.log)")

  defp wait_until_ready(attempts) do
    case running_daemon() do
      {:ok, _} -> :ok
      :none -> Process.sleep(500) && wait_until_ready(attempts - 1)
    end
  end

  defp status_line, do: "Logs: .symphony/serve.log"

  defp shell_escape(value), do: "'" <> String.replace(value, "'", "'\\''") <> "'"
```

- [ ] **Step 7: Verify the full daemon lifecycle by hand**

Run (from `elixir/`):

```bash
mix symphony.ctl serve
sleep 2
# confirm the orchestrator subtree pid, restart web, confirm it changed and orchestrator did not:
mix run --no-start -e '
  node = String.to_atom(SymphonyElixir.Ctl.node_name())
  {:ok, _} = Node.start(:"probe@127.0.0.1", :longnames)
  Node.set_cookie(String.to_atom(SymphonyElixir.Ctl.cookie()))
  true = Node.connect(node)
  pid = fn id -> :erpc.call(node, Supervisor, :which_children, [SymphonyElixir.Supervisor]) |> Enum.find(&(elem(&1,0)==id)) |> elem(1) end
  before_orch = pid.(SymphonyElixir.OrchestratorSupervisor)
  before_web = pid.(SymphonyElixir.WebSupervisor)
  {:ok, _} = :erpc.call(node, SymphonyElixir.Ctl, :restart, [[:web]])
  IO.inspect(orch_unchanged: pid.(SymphonyElixir.OrchestratorSupervisor) == before_orch, web_changed: pid.(SymphonyElixir.WebSupervisor) != before_web)
'
mix symphony.ctl stop
```

Expected: `[orch_unchanged: true, web_changed: true]`, then "Symphony daemon stopped".

- [ ] **Step 8: Commit**

```bash
git add elixir/lib/mix/tasks/symphony.ctl.ex elixir/lib/symphony_elixir/dev_serve_guard.ex elixir/dev/serve.exs elixir/test/symphony_elixir/dev_serve_guard_test.exs
git commit -m "feat: detached daemon boot + erpc subtree control via mix symphony.ctl"
```

---

## Task 7: Makefile targets

**Files:**
- Modify: `elixir/Makefile`

- [ ] **Step 1: Replace the serve/stop recipes and add update**

In `elixir/Makefile`, update the `.PHONY` line to include `update`, and replace the `serve` and `stop` recipes (lines ~127-149) with:

```make
# --- Run -------------------------------------------------------------------

# Ensure the long-lived Symphony daemon is running (boots it detached if not).
# The daemon owns the DB + orchestrator + web + editor; restarting one subtree
# does not disturb the others. Logs: .symphony/serve.log
serve: ensure-deps migrate
	@$(MIX) symphony.ctl serve $(ARGS)

# Recompile + restart selected subtree(s) against the running daemon.
# Default: web only (so web edits never kill in-flight orchestrator turns).
# Examples: make update ARGS="--orchestrator" | "--code-server" | "--all"
update: ensure-deps
	@$(MIX) symphony.ctl update $(ARGS)

# Default: full daemon shutdown. `make stop ARGS="--web"` stops one subtree.
stop:
	@$(MIX) symphony.ctl stop $(ARGS)
```

Update the `.PHONY` declaration at the top to add `update`:

```make
.PHONY: help all setup deps ensure-deps build fmt fmt-check lint test coverage ci dialyzer repo-ci \
	check-tools install-code-server configure-code-server db-create db-migrate migrate migration new-migration rollback \
	serve update stop tracker-setup tracker-deps tracker-build tracker-lint tracker-test tracker-ci \
	tracker-api tracker-api-escript tracker-dev
```

Update the `help` "Run:" line:

```make
	@echo "Run:      serve (boot daemon), update (restart web by default; ARGS=--orchestrator/--code-server/--all), stop, check-tools"
```

- [ ] **Step 2: Verify the targets dispatch correctly**

Run (from `elixir/`): `make -n update` and `make -n stop`
Expected: prints `mix symphony.ctl update` and `mix symphony.ctl stop` respectively (mise prefix allowed).

Run the live path: `make serve && make update && make update ARGS="--orchestrator" && make stop`
Expected: daemon boots; web restart message; orchestrator restart message; full stop message.

- [ ] **Step 3: Commit**

```bash
git add elixir/Makefile
git commit -m "feat: make serve/update/stop drive the symphony.ctl daemon"
```

---

## Task 8: Docs + env defaults

**Files:**
- Modify: `elixir/.env`
- Modify: `elixir/README.md`

- [ ] **Step 1: Document the node env vars in `.env`**

Append to `elixir/.env`:

```bash

# --- Dev daemon (make serve/update/stop) -----------------------------------
# The detached daemon runs as a localhost-only distributed node so `make update`
# / `make stop` can restart individual subtrees without killing the orchestrator.
# Dev defaults are fine locally; override to run multiple daemons or harden.
SYMPHONY_NODE_NAME=symphony
SYMPHONY_NODE_COOKIE=symphony-dev-cookie
```

- [ ] **Step 2: Document the workflow in `README.md`**

Add a "Running the dev daemon" subsection to `elixir/README.md` (under the existing run/serve docs) explaining:

```markdown
### Running the dev daemon

`make serve` boots Symphony as a single long-lived **detached** BEAM (logs to
`.symphony/serve.log`). It owns the SQLite DB, the orchestrator (and its in-flight
Codex turns), the web server, and the code-server manager — each in its own
restartable subtree.

Restart only what you changed (the orchestrator keeps running otherwise):

| Command | Restarts |
|---|---|
| `make update` | web only (default) |
| `make update ARGS="--orchestrator"` | orchestrator only |
| `make update ARGS="--code-server"` | code-server manager only |
| `make update ARGS="--all"` | web + orchestrator + editor |
| `make stop` | full daemon shutdown |
| `make stop ARGS="--web"` | stop just the web subtree (daemon stays up) |

`make update` recompiles first; a compile error aborts the restart (the daemon
keeps running the old code). The daemon runs as a localhost-only distributed
node — see `SYMPHONY_NODE_NAME` / `SYMPHONY_NODE_COOKIE` in `.env`.
```

- [ ] **Step 3: Commit**

```bash
git add elixir/.env elixir/README.md
git commit -m "docs: document the serve/update/stop dev daemon workflow"
```

---

## Task 9: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run format, lint, specs**

Run (from `elixir/`):
- `mix format`
- `mix specs.check` — Expected: passes (new public `def`s have `@spec`; verify `Ctl`, the sub-supervisors, and the mix task).
- `mix lint` — Expected: clean.

- [ ] **Step 2: Run the full test suite**

Run: `make test`
Expected: all green, including the new `supervision_tree_test`, `ctl_test`, `symphony_ctl_test`, `orchestrator_task_supervisor_test`, `dev_serve_guard_test`.

- [ ] **Step 3: Run dialyzer + coverage gate**

Run: `make ci`
Expected: format-check, lint, coverage, dialyzer all pass.

- [ ] **Step 4: Manual isolation acceptance check**

Run the lifecycle from Task 6 Step 7 once more to confirm: a `--web` restart leaves the orchestrator subtree pid and any running task pids unchanged. If the editor is enabled, confirm the code-server process (`pgrep -f 'code-server.*--bind-addr'`) keeps the **same** PID across a `make update` (web restart).

- [ ] **Step 5: Final commit (if format/lint touched files)**

```bash
git add -A
git commit -m "chore: format + lint pass for service restart isolation"
```

---

## Self-Review

**1. Spec coverage:**
- Supervision tree restructure (spec §"Supervision Tree Restructure") → Tasks 2-3; `TaskSupervisor` split → Task 1. ✓
- Detached daemon boot + node identity + lock node-name (spec §"Detached Daemon Boot") → Task 6 (boot) + Task 8 (env). ✓
- Control module reload→restart, fail-fast on compile (spec §"Control Module & Mix Task") → Task 4 (`Ctl`) + Task 5/6 (task). Compile fail-fast is provided by `mix` compiling before the task body runs (documented in spec §"update flow"); the task's `update` path runs only after a successful compile. ✓
- Flag surface (spec §"Flag surface") → Task 5. ✓
- Makefile surface (spec §"Makefile Surface") → Task 7. ✓
- Stop semantics (full default; subtree via flags) → Task 5 (`build/2`) + Task 6 (`stop_daemon`/`rpc_stop_subtrees`). ✓
- Editor independence / reuse → covered by `EditorSupervisor` + acceptance check Task 9 Step 4. ✓
- Testing strategy (spec §"Testing Strategy") → Tasks 1,2,3,4,5,6 tests + Task 9 gates. ✓

**2. Placeholder scan:** The only intentional stubs are the `run/1` `Mix.raise` placeholders created in Task 5 Step 3 and **replaced** in Task 6 Step 6; the parse-only tests do not exercise them. No `TBD`/`TODO` remain.

**3. Type consistency:** `Ctl.restart/2` returns `{:ok, %{reloaded: _, restarted: _}}` — consumed identically in Task 6 `rpc_restart`. `Ctl.stop_subtrees/2` returns `:ok` — matched in `rpc_stop_subtrees`. Target atoms `:web/:orchestrator/:editor` consistent across `parse/1`, `@default_ids`, and `child_specs`. `node_name/1`/`cookie/1` signatures match between `Ctl` and task callers. `DevServeGuard.read/1` + `:node_name` option consistent across guard, serve.exs, and task discovery.
