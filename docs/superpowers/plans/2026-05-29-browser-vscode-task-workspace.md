# Browser VS Code for Task Workspaces Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Replace example commands with this repo's real tools.

**Goal:** Let a user open a real, browser-based VS Code IDE rooted at a task's isolated workspace directory, launched from the `IssueDrawer` (button + `.` shortcut) in a new browser tab.

**Architecture:** Symphony supervises a single `code-server` process (started only when enabled, on a dedicated port). A new `SymphonyElixir.Editor` module resolves a task's workspace path (using the same normalization `Terminal.Registry` uses) and builds a `<base_url>/?folder=<path>` URL, gated on server readiness and directory existence. A JSON endpoint returns the URL or a structured reason; the tracker SPA renders an "Open in VS Code" button that `window.open`s it.

**Tech Stack:** Elixir/Phoenix (NimbleOptions, GenServer + `Port`, `:gen_tcp`, ExUnit), React 19 + Vite + TypeScript + Tailwind + axios + Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-29-browser-vscode-task-workspace-design.md`

---

## Data contract (shared by all tasks — do not deviate)

Endpoint: `GET /api/tracker/v1/projects/:project_slug/issues/:identifier/editor`

Available response (200):

```json
{ "data": { "available": true, "url": "http://127.0.0.1:4002/?folder=%2Ftmp%2Fsymphony_workspaces%2FMAC-1" } }
```

Unavailable response (200):

```json
{ "data": { "available": false, "reason": "disabled" } }
```

`reason` is one of: `"disabled" | "starting" | "unavailable" | "workspace_missing"`.
Unknown project/issue returns 404 via `TrackerErrors` (`project_not_found` / `issue_not_found`).

Config block in `WORKFLOW.md` front matter:

```yaml
editor:
  enabled: true
  binary: code-server
  host: 127.0.0.1
  port: 4002
  auth: none
  password: null
  base_url: null   # defaults to http://<host>:<port>
```

---

## File structure

**Backend — create:**
- `elixir/lib/symphony_elixir/editor/server.ex` — supervised `Port`-based GenServer that spawns/monitors `code-server` and exposes readiness.
- `elixir/lib/symphony_elixir/editor.ex` — pure URL builder + readiness gate (`editor_target/2`).
- `elixir/lib/symphony_elixir_web/controllers/tracker/editor_controller.ex` — `show` JSON action.
- `elixir/test/symphony_elixir/editor/server_test.exs`
- `elixir/test/symphony_elixir/editor_test.exs`
- `elixir/test/symphony_elixir_web/controllers/tracker/editor_controller_test.exs`

**Backend — modify:**
- `elixir/lib/symphony_elixir/config.ex` — `editor:` schema block, default module attrs, `extract_editor_options/1`, accessors.
- `elixir/lib/symphony_elixir.ex` — conditionally supervise `Editor.Server`.
- `elixir/lib/symphony_elixir_web/router.ex` — add the editor GET route.
- `elixir/test/symphony_elixir/config_test.exs` — editor config tests.

**Frontend — create:**
- `tracker/src/services/editor.ts` — `fetchEditorTarget(projectSlug, identifier)`.
- `tracker/src/hooks/useIssueEditor.ts` — fetch-on-open hook.
- `tracker/src/services/__tests__/editor.test.ts`
- `tracker/src/hooks/__tests__/useIssueEditor.test.tsx`
- `tracker/src/components/issues/__tests__/IssueDrawerEditor.test.tsx`

**Frontend — modify:**
- `tracker/src/components/issues/IssueDrawer.tsx` — button + `.` shortcut.

**Docs — modify:**
- `elixir/README.md`, `elixir/WORKFLOW.macromarkets.example.md`, `elixir/docs/troubleshooting.md`.

---

## Task 1: Config — `editor:` schema, defaults, extraction, accessors

**Files:**
- Modify: `elixir/lib/symphony_elixir/config.ex` (module attrs near line 25; schema near line 149-156; `extract_workflow_options/1` near line 531-541; `extract_server_options/1` near line 607; accessors near line 449-452)
- Test: `elixir/test/symphony_elixir/config_test.exs`

- [ ] **Step 1: Write failing tests**

Open `elixir/test/symphony_elixir/config_test.exs` and reuse the file's existing helper for loading a workflow with front matter (match the helper name already used in that file — e.g. the same one the observability/server tests use). Add:

```elixir
describe "editor config" do
  test "defaults when editor section omitted" do
    load_workflow_with_front_matter("""
    github:
      repo: acme/app
    """)

    refute SymphonyElixir.Config.editor_enabled?()
    assert SymphonyElixir.Config.editor_binary() == "code-server"
    assert SymphonyElixir.Config.editor_host() == "127.0.0.1"
    assert SymphonyElixir.Config.editor_port() == 4002
    assert SymphonyElixir.Config.editor_auth() == "none"
    assert SymphonyElixir.Config.editor_password() == nil
    assert SymphonyElixir.Config.editor_base_url() == "http://127.0.0.1:4002"
  end

  test "reads configured editor keys" do
    load_workflow_with_front_matter("""
    github:
      repo: acme/app
    editor:
      enabled: true
      binary: /opt/code-server/bin/code-server
      host: 0.0.0.0
      port: 5000
      auth: password
      password: hunter2
      base_url: https://editor.example.com
    """)

    assert SymphonyElixir.Config.editor_enabled?()
    assert SymphonyElixir.Config.editor_binary() == "/opt/code-server/bin/code-server"
    assert SymphonyElixir.Config.editor_host() == "0.0.0.0"
    assert SymphonyElixir.Config.editor_port() == 5000
    assert SymphonyElixir.Config.editor_auth() == "password"
    assert SymphonyElixir.Config.editor_password() == "hunter2"
    assert SymphonyElixir.Config.editor_base_url() == "https://editor.example.com"
  end
end
```

> If `config_test.exs` does not already define a `load_workflow_with_front_matter/1` helper, copy the exact loading approach the existing `describe` blocks in that file use (do not invent a new mechanism).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/config_test.exs`
Expected: FAIL — `editor_enabled?/0` (and siblings) undefined.

- [ ] **Step 3: Add default module attributes**

In `elixir/lib/symphony_elixir/config.ex`, after `@default_server_host "127.0.0.1"` (line 25):

```elixir
  @default_editor_enabled false
  @default_editor_binary "code-server"
  @default_editor_host "127.0.0.1"
  @default_editor_port 4002
  @default_editor_auth "none"
```

- [ ] **Step 4: Add the schema block**

In the `@workflow_options_schema NimbleOptions.new!(...)` keyword list, add after the `server:` block (after line 156, before the closing `)` on line 157):

```elixir
                            ,
                            editor: [
                              type: :map,
                              default: %{},
                              keys: [
                                enabled: [type: :boolean, default: @default_editor_enabled],
                                binary: [type: :string, default: @default_editor_binary],
                                host: [type: :string, default: @default_editor_host],
                                port: [type: :pos_integer, default: @default_editor_port],
                                auth: [type: {:in, ["none", "password"]}, default: @default_editor_auth],
                                password: [type: {:or, [:string, nil]}, default: nil],
                                base_url: [type: {:or, [:string, nil]}, default: nil]
                              ]
                            ]
```

> Note: the existing list ends with the `server:` block immediately before `)`. Insert a comma after the `server:` block's closing `]` and then the `editor:` block. Verify the final `)` still closes `NimbleOptions.new!`.

- [ ] **Step 5: Wire extraction**

In `extract_workflow_options/1` (line 531-541), add the `editor:` key to the returned map:

```elixir
      server: extract_server_options(section_map(config, "server")),
      editor: extract_editor_options(section_map(config, "editor"))
```

Then add a new private function next to `extract_server_options/1` (after line 611):

```elixir
  defp extract_editor_options(section) do
    %{}
    |> put_if_present(:enabled, boolean_value(Map.get(section, "enabled")))
    |> put_if_present(:binary, binary_value(Map.get(section, "binary")))
    |> put_if_present(:host, scalar_string_value(Map.get(section, "host")))
    |> put_if_present(:port, positive_integer_value(Map.get(section, "port")))
    |> put_if_present(:auth, scalar_string_value(Map.get(section, "auth")))
    |> put_if_present(:password, scalar_string_value(Map.get(section, "password")))
    |> put_if_present(:base_url, scalar_string_value(Map.get(section, "base_url")))
  end
```

- [ ] **Step 6: Add public accessors**

After `server_host/0` (line 449-452), add:

```elixir
  @spec editor_enabled?() :: boolean()
  def editor_enabled? do
    get_in(validated_workflow_options(), [:editor, :enabled])
  end

  @spec editor_binary() :: String.t()
  def editor_binary do
    get_in(validated_workflow_options(), [:editor, :binary])
  end

  @spec editor_host() :: String.t()
  def editor_host do
    get_in(validated_workflow_options(), [:editor, :host])
  end

  @spec editor_port() :: pos_integer()
  def editor_port do
    get_in(validated_workflow_options(), [:editor, :port])
  end

  @spec editor_auth() :: String.t()
  def editor_auth do
    get_in(validated_workflow_options(), [:editor, :auth])
  end

  @spec editor_password() :: String.t() | nil
  def editor_password do
    get_in(validated_workflow_options(), [:editor, :password])
  end

  @spec editor_base_url() :: String.t()
  def editor_base_url do
    case get_in(validated_workflow_options(), [:editor, :base_url]) do
      url when is_binary(url) and url != "" -> String.trim_trailing(url, "/")
      _ -> "http://#{editor_host()}:#{editor_port()}"
    end
  end
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/config_test.exs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add elixir/lib/symphony_elixir/config.ex elixir/test/symphony_elixir/config_test.exs
git commit -m "feat(editor): add editor config block and accessors"
```

---

## Task 2: `Editor.Server` — supervised code-server process

**Files:**
- Create: `elixir/lib/symphony_elixir/editor/server.ex`
- Test: `elixir/test/symphony_elixir/editor/server_test.exs`

Design notes (injectable for tests, mirroring the `:terminal_tmux` Application-env pattern):
- Executable resolution via `:editor_executable_finder` (fun `binary -> path | nil`), default `&System.find_executable/1`.
- Spawn via `:editor_spawner` (fun `{executable, args, env} -> {:ok, term} | {:error, term}`), default real `Port.open` wrapper.
- Readiness probe via `:editor_probe` (fun `{host, port} -> :ok | {:error, term}`), default `:gen_tcp` connect.

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.Editor.ServerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Editor.Server

  setup do
    previous = %{
      finder: Application.get_env(:symphony_elixir, :editor_executable_finder),
      spawner: Application.get_env(:symphony_elixir, :editor_spawner),
      probe: Application.get_env(:symphony_elixir, :editor_probe)
    }

    on_exit(fn ->
      restore(:editor_executable_finder, previous.finder)
      restore(:editor_spawner, previous.spawner)
      restore(:editor_probe, previous.probe)
    end)

    :ok
  end

  test "marks unavailable when binary is not found" do
    Application.put_env(:symphony_elixir, :editor_executable_finder, fn _binary -> nil end)
    Application.put_env(:symphony_elixir, :editor_spawner, fn _args -> flunk("should not spawn") end)

    pid = start_supervised!({Server, name: :editor_server_missing})
    assert Server.status(pid) == :unavailable
  end

  test "transitions starting -> ready once the probe succeeds" do
    test_pid = self()
    Application.put_env(:symphony_elixir, :editor_executable_finder, fn _binary -> "/usr/bin/code-server" end)
    Application.put_env(:symphony_elixir, :editor_spawner, fn _args -> {:ok, make_ref()} end)
    Application.put_env(:symphony_elixir, :editor_probe, fn _hp ->
      send(test_pid, :probed)
      :ok
    end)

    pid = start_supervised!({Server, name: :editor_server_ready})
    send(pid, :probe)
    assert_receive :probed, 1_000
    assert Server.status(pid) == :ready
  end

  test "stays starting while the probe keeps failing" do
    Application.put_env(:symphony_elixir, :editor_executable_finder, fn _binary -> "/usr/bin/code-server" end)
    Application.put_env(:symphony_elixir, :editor_spawner, fn _args -> {:ok, make_ref()} end)
    Application.put_env(:symphony_elixir, :editor_probe, fn _hp -> {:error, :econnrefused} end)

    pid = start_supervised!({Server, name: :editor_server_starting})
    send(pid, :probe)
    assert Server.status(pid) == :starting
  end

  defp restore(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore(key, value), do: Application.put_env(:symphony_elixir, key, value)
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/editor/server_test.exs`
Expected: FAIL — `SymphonyElixir.Editor.Server` undefined.

- [ ] **Step 3: Write the implementation**

```elixir
defmodule SymphonyElixir.Editor.Server do
  @moduledoc """
  Supervises a single `code-server` process and tracks its readiness.

  Started only when `Config.editor_enabled?/0`. Spawns `code-server` bound to the
  configured host/port, then TCP-probes the bind address until it accepts
  connections (`:starting` -> `:ready`). A missing binary or spawn failure marks
  the server `:unavailable` without crashing the orchestrator.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.Config

  @probe_interval_ms 1_000
  @probe_connect_timeout_ms 500

  @type status :: :starting | :ready | :unavailable

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @spec status() :: status()
  def status do
    case GenServer.whereis(__MODULE__) do
      nil -> :unavailable
      pid -> status(pid)
    end
  end

  @spec status(pid() | atom()) :: status()
  def status(server), do: GenServer.call(server, :status)

  @impl true
  def init(_opts) do
    state = %{port: nil, os_pid: nil, status: :starting}
    {:ok, boot(state)}
  end

  defp boot(state) do
    binary = Config.editor_binary()

    case executable_finder().(binary) do
      nil ->
        Logger.warning("Editor server unavailable: binary not found binary=#{binary}")
        %{state | status: :unavailable}

      executable ->
        spawn_code_server(state, executable)
    end
  end

  defp spawn_code_server(state, executable) do
    args = [
      "--bind-addr",
      "#{Config.editor_host()}:#{Config.editor_port()}",
      "--auth",
      Config.editor_auth(),
      "--disable-telemetry"
    ]

    env = build_env(Config.editor_auth(), Config.editor_password())

    case spawner().({executable, args, env}) do
      {:ok, port} ->
        Process.send_after(self(), :probe, @probe_interval_ms)
        %{state | port: port, status: :starting}

      {:error, reason} ->
        Logger.warning("Editor server failed to spawn reason=#{inspect(reason)}")
        %{state | status: :unavailable}
    end
  end

  defp build_env("password", password) when is_binary(password) and password != "" do
    [{~c"PASSWORD", String.to_charlist(password)}]
  end

  defp build_env(_auth, _password), do: []

  @impl true
  def handle_call(:status, _from, state), do: {:reply, state.status, state}

  @impl true
  def handle_info(:probe, %{status: :ready} = state), do: {:noreply, state}

  def handle_info(:probe, state) do
    case probe().({Config.editor_host(), Config.editor_port()}) do
      :ok ->
        Logger.info("Editor server ready host=#{Config.editor_host()} port=#{Config.editor_port()}")
        {:noreply, %{state | status: :ready}}

      {:error, _reason} ->
        Process.send_after(self(), :probe, @probe_interval_ms)
        {:noreply, %{state | status: :starting}}
    end
  end

  def handle_info({port, {:exit_status, code}}, %{port: port} = state) do
    Logger.warning("Editor server process exited code=#{code}")
    {:stop, {:editor_exited, code}, %{state | status: :unavailable}}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, %{port: port}) when is_port(port) do
    case Port.info(port, :os_pid) do
      {:os_pid, os_pid} -> System.cmd("kill", ["-TERM", Integer.to_string(os_pid)])
      _ -> :ok
    end

    :ok
  rescue
    _ -> :ok
  end

  def terminate(_reason, _state), do: :ok

  defp executable_finder do
    Application.get_env(:symphony_elixir, :editor_executable_finder, &System.find_executable/1)
  end

  defp spawner do
    Application.get_env(:symphony_elixir, :editor_spawner, &default_spawn/1)
  end

  defp probe do
    Application.get_env(:symphony_elixir, :editor_probe, &default_probe/1)
  end

  defp default_spawn({executable, args, env}) do
    port =
      Port.open(
        {:spawn_executable, String.to_charlist(executable)},
        [
          :binary,
          :exit_status,
          :stderr_to_stdout,
          args: Enum.map(args, &String.to_charlist/1),
          env: env
        ]
      )

    {:ok, port}
  rescue
    error -> {:error, error}
  end

  defp default_probe({host, port}) do
    case :gen_tcp.connect(String.to_charlist(host), port, [:binary, active: false], @probe_connect_timeout_ms) do
      {:ok, socket} ->
        :gen_tcp.close(socket)
        :ok

      {:error, reason} ->
        {:error, reason}
    end
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/editor/server_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/editor/server.ex elixir/test/symphony_elixir/editor/server_test.exs
git commit -m "feat(editor): supervise code-server process with readiness probe"
```

---

## Task 3: `SymphonyElixir.Editor` — URL builder + readiness gate

**Files:**
- Create: `elixir/lib/symphony_elixir/editor.ex`
- Test: `elixir/test/symphony_elixir/editor_test.exs`

`editor_target/2` order of checks: disabled → server status (`:starting`/`:unavailable`) → resolve path → dir exists → build URL. Path normalization strips a leading `#` to match `Terminal.Registry.workspace_identifier/1`, then uses `Workspace.path_for_issue/1`.

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.EditorTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Editor

  setup do
    previous = %{
      workflow: Application.get_env(:symphony_elixir, :workflow_override),
      status_fun: Application.get_env(:symphony_elixir, :editor_status_fun)
    }

    on_exit(fn ->
      restore(:workflow_override, previous.workflow)
      restore(:editor_status_fun, previous.status_fun)
    end)

    :ok
  end

  test "returns :disabled when editor is off" do
    put_editor(enabled: false)
    assert Editor.editor_target("macro-markets", "MAC-1") == {:error, :disabled}
  end

  test "returns :starting while the server warms up" do
    put_editor(enabled: true)
    Application.put_env(:symphony_elixir, :editor_status_fun, fn -> :starting end)
    assert Editor.editor_target("macro-markets", "MAC-1") == {:error, :starting}
  end

  test "returns :workspace_missing when the dir does not exist" do
    put_editor(enabled: true)
    Application.put_env(:symphony_elixir, :editor_status_fun, fn -> :ready end)
    assert Editor.editor_target("macro-markets", "MAC-DOES-NOT-EXIST") == {:error, :workspace_missing}
  end

  test "builds an encoded ?folder URL for an existing workspace" do
    put_editor(enabled: true, base_url: "http://127.0.0.1:4002")
    Application.put_env(:symphony_elixir, :editor_status_fun, fn -> :ready end)

    path = SymphonyElixir.Workspace.path_for_issue("MAC-EXISTS")
    File.mkdir_p!(path)
    on_exit(fn -> File.rm_rf(path) end)

    assert {:ok, url} = Editor.editor_target("macro-markets", "#MAC-EXISTS")
    assert url == "http://127.0.0.1:4002/?folder=" <> URI.encode_www_form(path)
  end

  # `put_editor/1` writes a WORKFLOW override that Config reads. Match the
  # mechanism config_test.exs already uses to inject front matter in tests; if
  # that helper lives in a shared support module, import it here instead.
  defp put_editor(_opts), do: raise("wire to the project's test workflow loader")
  defp restore(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore(key, value), do: Application.put_env(:symphony_elixir, key, value)
end
```

> Before running, replace `put_editor/1` with the same workflow-injection helper used by `config_test.exs` (Task 1). Set the front matter `editor:` block from the keyword opts. Keep `editor_status_fun` injection as written.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/editor_test.exs`
Expected: FAIL — `SymphonyElixir.Editor` undefined.

- [ ] **Step 3: Write the implementation**

```elixir
defmodule SymphonyElixir.Editor do
  @moduledoc """
  Builds the browser URL that opens a task's workspace in code-server.

  Resolves the workspace path the same way the issue terminal does, gated on the
  editor being enabled, the code-server process being ready, and the workspace
  directory existing on disk.
  """

  alias SymphonyElixir.Config
  alias SymphonyElixir.Editor.Server
  alias SymphonyElixir.Workspace

  @type reason :: :disabled | :starting | :unavailable | :workspace_missing

  @spec editor_target(String.t(), String.t()) :: {:ok, String.t()} | {:error, reason()}
  def editor_target(_project_slug, issue_identifier) when is_binary(issue_identifier) do
    with :ok <- ensure_enabled(),
         :ok <- ensure_ready(),
         {:ok, path} <- ensure_workspace(issue_identifier) do
      {:ok, build_url(path)}
    end
  end

  defp ensure_enabled do
    if Config.editor_enabled?(), do: :ok, else: {:error, :disabled}
  end

  defp ensure_ready do
    case status_fun().() do
      :ready -> :ok
      :starting -> {:error, :starting}
      _ -> {:error, :unavailable}
    end
  end

  defp ensure_workspace(issue_identifier) do
    path = Workspace.path_for_issue(workspace_identifier(issue_identifier))

    if File.dir?(path), do: {:ok, path}, else: {:error, :workspace_missing}
  end

  defp build_url(path) do
    "#{Config.editor_base_url()}/?folder=#{URI.encode_www_form(path)}"
  end

  defp workspace_identifier(issue_identifier) do
    String.trim_leading(issue_identifier, "#")
  end

  defp status_fun do
    Application.get_env(:symphony_elixir, :editor_status_fun, &Server.status/0)
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/editor_test.exs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/editor.ex elixir/test/symphony_elixir/editor_test.exs
git commit -m "feat(editor): resolve task workspace editor URL with readiness gate"
```

---

## Task 4: Supervise `Editor.Server` when enabled

**Files:**
- Modify: `elixir/lib/symphony_elixir.ex` (children list, lines 28-55)

- [ ] **Step 1: Add the conditional child**

In `SymphonyElixir.Application.start/2`, build the children list so `Editor.Server` is only included when enabled. Replace the static `children = [ ... ]` assignment's tail so it appends conditionally:

```elixir
    base_children = [
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
      SymphonyElixir.WorkflowStore,
      SymphonyElixir.Orchestrator,
      SymphonyElixir.Observability.Reporter,
      SymphonyElixir.HttpServer,
      SymphonyElixir.StatusDashboard
    ]

    children = base_children ++ editor_children()

    Supervisor.start_link(
      children,
      strategy: :one_for_one,
      name: SymphonyElixir.Supervisor
    )
  end

  defp editor_children do
    if editor_enabled?() do
      [SymphonyElixir.Editor.Server]
    else
      []
    end
  end

  defp editor_enabled? do
    SymphonyElixir.Config.editor_enabled?()
  rescue
    _ -> false
  end
```

> Keep the `@impl true def stop/1` callback unchanged. The `rescue` guards against `Config` raising when no workflow is loaded (e.g. some boot paths), so the app never fails to start because of the editor.

- [ ] **Step 2: Verify the app compiles and boots**

Run: `cd elixir && mix compile --warnings-as-errors`
Expected: compiles with no warnings.

- [ ] **Step 3: Commit**

```bash
git add elixir/lib/symphony_elixir.ex
git commit -m "feat(editor): supervise editor server when enabled"
```

---

## Task 5: HTTP endpoint + route

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/editor_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex` (after line 62, the terminal route)
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/editor_controller_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixirWeb.Tracker.EditorControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous_token = System.get_env(@token_env)
    previous_status = Application.get_env(:symphony_elixir, :editor_status_fun)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      restore_application_env(:editor_status_fun, previous_status)
    end)

    :ok
  end

  test "returns disabled when the editor is off" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Edit me", "status" => "Todo"})

    conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-1/editor")

    assert json_response(conn, 200) == %{"data" => %{"available" => false, "reason" => "disabled"}}
  end

  test "returns 404 for an unknown issue" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-404/editor")

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "issue_not_found", "message" => "Issue not found"}
           }
  end

  defp authorized_conn do
    build_conn() |> put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_issue_labels",
          "local_tracker_labels",
          "local_tracker_comments",
          "local_tracker_issues",
          "local_tracker_workflow_statuses",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
  defp restore_application_env(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore_application_env(key, value), do: Application.put_env(:symphony_elixir, key, value)
end
```

> The "disabled" test relies on the default config (editor disabled) when no `editor:` block is present. If the test workflow loaded in this suite enables the editor, set `editor_status_fun` and front matter accordingly — but the default path should already yield `:disabled`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/editor_controller_test.exs`
Expected: FAIL — no route / controller.

- [ ] **Step 3: Write the controller**

```elixir
defmodule SymphonyElixirWeb.Tracker.EditorController do
  @moduledoc "Resolves the browser VS Code (code-server) URL for a task workspace."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Editor
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixirWeb.TrackerErrors

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, _issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      render_target(conn, project_slug, identifier)
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp render_target(conn, project_slug, identifier) do
    case Editor.editor_target(project_slug, identifier) do
      {:ok, url} -> json(conn, %{data: %{available: true, url: url}})
      {:error, reason} -> json(conn, %{data: %{available: false, reason: Atom.to_string(reason)}})
    end
  end
end
```

> Verify `Context.get_project/1` returns `{:error, :project_not_found}` and the issue fetch returns `{:error, :issue_not_found}` for misses (matches `PullRequestController` and `TerminalController` usage). If `IssueAdapter.dispatch(project, :get_issue, [identifier])` is not the exact call those controllers use to validate an issue exists, copy the validation approach from `TerminalController`/`Registry.default_fetch_issue/2` instead.

- [ ] **Step 4: Add the route**

In `elixir/lib/symphony_elixir_web/router.ex`, after the terminal route (line 62):

```elixir
    get("/projects/:project_slug/issues/:identifier/editor", EditorController, :show)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/editor_controller_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/editor_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/test/symphony_elixir_web/controllers/tracker/editor_controller_test.exs
git commit -m "feat(editor): add task workspace editor endpoint"
```

---

## Task 6: Frontend service `editor.ts`

**Files:**
- Create: `tracker/src/services/editor.ts`
- Test: `tracker/src/services/__tests__/editor.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, vi } from "vitest";

import { fetchEditorTarget } from "@/services/editor";
import { http } from "@/services/http";

describe("editor service", () => {
  it("returns an available target with the editor URL", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: { data: { available: true, url: "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1" } },
    });

    const target = await fetchEditorTarget("macro-markets", "MAC-1");

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues/MAC-1/editor");
    expect(target).toEqual({ available: true, url: "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1", reason: null });
  });

  it("returns an unavailable target with a reason", async () => {
    vi.spyOn(http, "get").mockResolvedValueOnce({
      data: { data: { available: false, reason: "workspace_missing" } },
    });

    const target = await fetchEditorTarget("macro-markets", "MAC-2");

    expect(target).toEqual({ available: false, url: null, reason: "workspace_missing" });
  });

  it("validates arguments", async () => {
    await expect(fetchEditorTarget(" ", "MAC-1")).rejects.toThrow(/projectSlug/);
    await expect(fetchEditorTarget("macro-markets", " ")).rejects.toThrow(/identifier/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/services/__tests__/editor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

```ts
import { http, trackerPath, unwrapData } from "./http";

export type EditorReason = "disabled" | "starting" | "unavailable" | "workspace_missing";

export interface EditorTarget {
  available: boolean;
  url: string | null;
  reason: EditorReason | null;
}

interface BackendEditorDto {
  available?: boolean | null;
  url?: string | null;
  reason?: string | null;
}

const REASONS: readonly EditorReason[] = ["disabled", "starting", "unavailable", "workspace_missing"];

function normalizeReason(value: string | null | undefined): EditorReason | null {
  if (typeof value === "string" && (REASONS as readonly string[]).includes(value)) {
    return value as EditorReason;
  }
  return null;
}

export async function fetchEditorTarget(projectSlug: string, identifier: string): Promise<EditorTarget> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");

  const response = await http.get(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/editor`),
  );

  const dto = unwrapData<BackendEditorDto>(response);
  const available = dto.available ?? false;

  return {
    available,
    url: available ? dto.url ?? null : null,
    reason: available ? null : normalizeReason(dto.reason),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/services/__tests__/editor.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/services/editor.ts tracker/src/services/__tests__/editor.test.ts
git commit -m "feat(editor): add tracker editor target service"
```

---

## Task 7: Frontend hook `useIssueEditor`

**Files:**
- Create: `tracker/src/hooks/useIssueEditor.ts`
- Test: `tracker/src/hooks/__tests__/useIssueEditor.test.tsx`

Behavior: fetch once when enabled + identifier present; expose `{ url, available, reason, loading }`; lightly re-poll only while `reason === "starting"`.

- [ ] **Step 1: Write failing tests**

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { useIssueEditor } from "@/hooks/useIssueEditor";
import * as editorService from "@/services/editor";

describe("useIssueEditor", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads an available editor target", async () => {
    vi.spyOn(editorService, "fetchEditorTarget").mockResolvedValue({
      available: true,
      url: "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1",
      reason: null,
    });

    const { result } = renderHook(() =>
      useIssueEditor({ projectSlug: "macro-markets", identifier: "MAC-1", enabled: true }),
    );

    await waitFor(() => expect(result.current.available).toBe(true));
    expect(result.current.url).toContain("?folder=");
    expect(result.current.reason).toBeNull();
  });

  it("stays inactive when disabled", async () => {
    const spy = vi.spyOn(editorService, "fetchEditorTarget");

    const { result } = renderHook(() =>
      useIssueEditor({ projectSlug: "macro-markets", identifier: "MAC-1", enabled: false }),
    );

    expect(spy).not.toHaveBeenCalled();
    expect(result.current.available).toBe(false);
    expect(result.current.url).toBeNull();
  });

  it("exposes the unavailable reason", async () => {
    vi.spyOn(editorService, "fetchEditorTarget").mockResolvedValue({
      available: false,
      url: null,
      reason: "workspace_missing",
    });

    const { result } = renderHook(() =>
      useIssueEditor({ projectSlug: "macro-markets", identifier: "MAC-1", enabled: true }),
    );

    await waitFor(() => expect(result.current.reason).toBe("workspace_missing"));
    expect(result.current.available).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/hooks/__tests__/useIssueEditor.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the hook**

```ts
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchEditorTarget, type EditorReason } from "@/services/editor";

const STARTING_POLL_MS = 2_000;

interface UseIssueEditorArgs {
  projectSlug: string;
  identifier: string | null;
  enabled?: boolean;
}

export interface UseIssueEditorResult {
  url: string | null;
  available: boolean;
  reason: EditorReason | null;
  loading: boolean;
}

export function useIssueEditor({ projectSlug, identifier, enabled = true }: UseIssueEditorArgs): UseIssueEditorResult {
  const [url, setUrl] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const [reason, setReason] = useState<EditorReason | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);

  const active = enabled && Boolean(identifier && projectSlug);

  const refetch = useCallback(async () => {
    if (!identifier || !projectSlug || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const target = await fetchEditorTarget(projectSlug, identifier);
      setUrl(target.url);
      setAvailable(target.available);
      setReason(target.reason);
    } catch {
      setUrl(null);
      setAvailable(false);
      setReason("unavailable");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [identifier, projectSlug]);

  useEffect(() => {
    if (!active) {
      setUrl(null);
      setAvailable(false);
      setReason(null);
      setLoading(false);
      return undefined;
    }

    void refetch();
    return undefined;
  }, [active, refetch]);

  useEffect(() => {
    if (!active || reason !== "starting") return undefined;
    const timer = setInterval(() => void refetch(), STARTING_POLL_MS);
    return () => clearInterval(timer);
  }, [active, reason, refetch]);

  return { url, available, reason, loading };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/hooks/__tests__/useIssueEditor.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/hooks/useIssueEditor.ts tracker/src/hooks/__tests__/useIssueEditor.test.tsx
git commit -m "feat(editor): add useIssueEditor hook"
```

---

## Task 8: `IssueDrawer` button + `.` shortcut

**Files:**
- Modify: `tracker/src/components/issues/IssueDrawer.tsx`
- Test: `tracker/src/components/issues/__tests__/IssueDrawerEditor.test.tsx`

UI rules:
- Hide the button entirely when `reason === "disabled"` (editor feature off).
- Otherwise show it; disabled with a tooltip (`title`) when `!available`.
- Clicking (and pressing `.` while the drawer is open and focus is not in a text field) opens `url` via `window.open(url, "_blank", "noopener")`.

- [ ] **Step 1: Write failing test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { IssueDrawer } from "@/components/issues/IssueDrawer";
import * as editorService from "@/services/editor";
import type { Issue } from "@/types/issue";

const issue = {
  id: "1",
  identifier: "MAC-1",
  title: "Open me in VS Code",
  status: "Todo",
  priority: "none",
  assignee: null,
  projectSlug: "macro-markets",
  blockedBy: [],
} as unknown as Issue;

describe("IssueDrawer editor button", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("opens the workspace in a new tab when available", async () => {
    vi.spyOn(editorService, "fetchEditorTarget").mockResolvedValue({
      available: true,
      url: "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1",
      reason: null,
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    render(<IssueDrawer issue={issue} projectSlug="macro-markets" open onOpenChange={() => {}} />);

    const button = await screen.findByRole("button", { name: /open in vs code/i });
    fireEvent.click(button);

    expect(open).toHaveBeenCalledWith(
      "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1",
      "_blank",
      "noopener",
    );
  });

  it("opens via the '.' keyboard shortcut", async () => {
    vi.spyOn(editorService, "fetchEditorTarget").mockResolvedValue({
      available: true,
      url: "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1",
      reason: null,
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    render(<IssueDrawer issue={issue} projectSlug="macro-markets" open onOpenChange={() => {}} />);
    await screen.findByRole("button", { name: /open in vs code/i });

    fireEvent.keyDown(window, { key: "." });

    expect(open).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/issues/__tests__/IssueDrawerEditor.test.tsx`
Expected: FAIL — no "Open in VS Code" button.

- [ ] **Step 3: Implement in `IssueDrawer.tsx`**

Add imports near the top (with the other icon + hook imports):

```tsx
import { Code2 } from "lucide-react";
import { useCallback, useEffect } from "react";
import { useIssueEditor } from "@/hooks/useIssueEditor";
```

> `Activity, AlertTriangle, ...` are already imported from `lucide-react` (lines 1-10) — add `Code2` to that existing import list instead of a second import statement. Likewise merge `useCallback, useEffect` into any existing `react` import if present.

Inside the `IssueDrawer` component body, after the `commentsState` hook (line 78), add:

```tsx
  const editor = useIssueEditor({
    projectSlug,
    identifier: issue?.identifier ?? null,
    enabled: open && Boolean(issue),
  });

  const openEditor = useCallback(() => {
    if (editor.available && editor.url) {
      window.open(editor.url, "_blank", "noopener");
    }
  }, [editor.available, editor.url]);

  useEffect(() => {
    if (!open) return undefined;

    const handler = (event: KeyboardEvent) => {
      if (event.key !== "." || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      event.preventDefault();
      openEditor();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, openEditor]);

  const editorButtonHidden = editor.reason === "disabled";
  const editorTitle = editor.available
    ? "Open this task's workspace in VS Code (.)"
    : editorUnavailableTitle(editor.reason, editor.loading);
```

Add this helper near the bottom of the file (outside the component, after the closing brace of `IssueDrawer`):

```tsx
function editorUnavailableTitle(reason: string | null, loading: boolean): string {
  if (loading) return "Checking editor…";
  switch (reason) {
    case "starting":
      return "Editor is starting…";
    case "workspace_missing":
      return "Workspace not created yet — run the agent or open the terminal first";
    default:
      return "Editor unavailable";
  }
}
```

Render the button inside the `SheetHeader`, in the `<div className="flex items-center gap-2 text-xs">` row (lines 86-97), after the `{execution ? <AgentStatusBadge .../> : null}` line:

```tsx
                {editorButtonHidden ? null : (
                  <button
                    type="button"
                    onClick={openEditor}
                    disabled={!editor.available}
                    title={editorTitle}
                    aria-label="Open in VS Code"
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Code2 className="h-3 w-3" />
                    Open in VS Code
                  </button>
                )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/issues/__tests__/IssueDrawerEditor.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Run type check + lint**

Run: `cd tracker && npx tsc --noEmit && npm run lint`
Expected: no type errors; lint clean (fix any issues introduced).

- [ ] **Step 6: Commit**

```bash
git add tracker/src/components/issues/IssueDrawer.tsx tracker/src/components/issues/__tests__/IssueDrawerEditor.test.tsx
git commit -m "feat(editor): add Open in VS Code button and shortcut to issue drawer"
```

---

## Task 9: Docs

**Files:**
- Modify: `elixir/README.md`, `elixir/WORKFLOW.macromarkets.example.md`, `elixir/docs/troubleshooting.md`

- [ ] **Step 1: Document the `editor:` block**

In `elixir/WORKFLOW.macromarkets.example.md`, add a commented `editor:` section near the other optional blocks (e.g. after `server:` / `observability:`):

```yaml
# Browser VS Code (code-server) for task workspaces. Disabled by default.
# Requires code-server installed on the host. --auth none is only safe on localhost.
editor:
  enabled: false
  binary: code-server
  host: 127.0.0.1
  port: 4002
  auth: none
  # password: your-password   # only when auth: password
  # base_url: https://editor.example.com   # browser-facing URL override (remote/proxy)
```

- [ ] **Step 2: Document the feature in the README**

In `elixir/README.md`, add a short "Browser editor" subsection describing: enable via the `editor:` block, install `code-server`, Symphony supervises it, and the `IssueDrawer` "Open in VS Code" button + `.` shortcut open the task workspace via `?folder=`.

- [ ] **Step 3: Add troubleshooting entries**

In `elixir/docs/troubleshooting.md`, add entries for:
- "Open in VS Code" button missing → `editor.enabled` is false.
- Button disabled "Editor is starting…" → code-server still booting; wait a moment.
- Button disabled "Workspace not created yet" → run the agent / open the Terminal tab first.
- code-server not found in logs → install it or set `editor.binary` to its absolute path.
- Port in use → change `editor.port`.
- Exposing remotely → set `auth: password` + `base_url`; never use `auth: none` off localhost.

- [ ] **Step 4: Commit**

```bash
git add elixir/README.md elixir/WORKFLOW.macromarkets.example.md elixir/docs/troubleshooting.md
git commit -m "docs(editor): document browser VS Code task workspace editor"
```

---

## Final validation

- [ ] **Backend gates**

Run: `cd elixir && make all`
Expected: format check, lint, coverage, dialyzer all pass. (Public `def`s in `lib/` have adjacent `@spec` — verify `Editor`, `Editor.Server`, controller, and Config accessors comply; run `mix specs.check`.)

- [ ] **Frontend gates**

Run: `cd tracker && npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Manual smoke (optional)**

Install code-server, set `editor.enabled: true` in your `WORKFLOW.md`, start Symphony, open a task that has an existing workspace, click "Open in VS Code" → a new tab opens code-server at that workspace folder.

---

## Self-review

**Spec coverage:**
- Single supervised code-server (D1, D5) → Tasks 2, 4.
- Shared instance, `?folder=` per task (D2, D6) → Task 3 (`build_url`, `workspace_identifier`).
- New tab launch (D3) → Task 8 (`window.open(_, "_blank")` + `.` shortcut).
- Dedicated port, direct URL, `base_url` override (D4, D8) → Tasks 1 (`editor_base_url/0`), 3.
- No auto-create / `workspace_missing` (D7) → Task 3 (`ensure_workspace`), Task 8 (tooltip).
- Auth none/password, localhost default (D9) → Task 2 (`build_env`), Task 9 (docs).
- Config via `SymphonyElixir.Config` only (D10) → Task 1.
- Endpoint contract + reasons → Task 5; service/hook/UI consume them → Tasks 6-8.
- Error/edge cases (disabled, starting, unavailable, missing binary, port in use, encoding, unknown issue, focus guard) → Tasks 2, 3, 5, 8 + docs in 9.
- Tests for every unit → each task's Step 1.

**Placeholder scan:** No `TBD`/`TODO`/"implement later". Two helper-reuse notes (Task 1 `load_workflow_with_front_matter`, Task 3 `put_editor`) explicitly instruct copying the existing test loader rather than leaving a gap — resolve them against `config_test.exs` while implementing.

**Type consistency:** `EditorReason` = `"disabled" | "starting" | "unavailable" | "workspace_missing"` consistent across `editor.ts`, `useIssueEditor.ts`, backend atoms, and controller string-encoding. `editor_target/2` return type `{:ok, String.t()} | {:error, reason()}` matches the controller's pattern match. Accessor names (`editor_enabled?/0`, `editor_binary/0`, `editor_host/0`, `editor_port/0`, `editor_auth/0`, `editor_password/0`, `editor_base_url/0`) are identical across Tasks 1-4.
