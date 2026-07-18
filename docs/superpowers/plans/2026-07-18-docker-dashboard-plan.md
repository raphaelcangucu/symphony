# Docker Dashboard Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Replace example commands with this repo's real tools (package manager, test runner, linter).
>
> **WSL constraint (repo rule):** run only one narrowly targeted test file at a time, sequentially. Never run the full suite. Every test command below is already scoped to a single file.

**Goal:** A `/docker` page in the Symphony tracker that lists local Docker containers (with compose project + codebase path, CPU, memory) and can start/stop/restart/remove them.

**Architecture:** A new `SymphonyElixir.Docker` module shells out to the `docker` CLI through a runner function injectable via the `:docker_runner` application env. A new `SymphonyElixirWeb.Tracker.DockerController` exposes two JSON endpoints under the authenticated `/api/tracker/v1` scope. The React tracker adds a service (`docker.ts`), a page (`DockerPage.tsx`) polling every 5s, a route, a sidebar link, and i18n keys.

**Tech Stack:** Elixir/Phoenix (Jason for JSON), React + TypeScript + axios + react-i18next + Tailwind, ExUnit, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-18-docker-dashboard-design.md`

---

## File map

| Action | Path | Owns |
|---|---|---|
| Create | `elixir/lib/symphony_elixir/docker.ex` | Docker CLI wrapper: list + actions |
| Create | `elixir/test/symphony_elixir/docker_test.exs` | Unit tests for the wrapper |
| Create | `elixir/lib/symphony_elixir_web/controllers/tracker/docker_controller.ex` | JSON endpoints |
| Create | `elixir/test/symphony_elixir_web/controllers/tracker/docker_controller_test.exs` | Endpoint tests |
| Modify | `elixir/lib/symphony_elixir_web/router.ex` (tracker_api scope, near the `/observability` routes at ~line 79) | 2 new routes |
| Create | `tracker/src/services/docker.ts` | DTO types, mapper, sort comparator, HTTP calls |
| Create | `tracker/src/services/__tests__/docker.test.ts` | Mapper + comparator tests |
| Create | `tracker/src/pages/DockerPage.tsx` | The dashboard page |
| Modify | `tracker/src/App.tsx` (~line 139, next to the observability route) | `/docker` route |
| Modify | `tracker/src/components/layout/sidebar/SidebarUtilityNav.tsx` | Sidebar link |
| Modify | `tracker/locales/en/tracker.json`, `tracker/locales/pt-BR/tracker.json` | i18n keys |

Not in scope: `SidebarCollapsedRail.tsx` (collapsed rail keeps only its current items), SPEC.md/README updates (local-only superset), Phoenix channels/log streaming.

---

### Task 1: `SymphonyElixir.Docker.list_containers/0`

**Files:**
- Create: `elixir/test/symphony_elixir/docker_test.exs`
- Create: `elixir/lib/symphony_elixir/docker.ex`

- [ ] **Step 1: Write the failing tests**

Create `elixir/test/symphony_elixir/docker_test.exs`:

```elixir
defmodule SymphonyElixir.DockerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Docker

  @full_id "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc12345"

  @ps_line ~s({"ID":"#{@full_id}","Names":"betting-app","Image":"sail-8.5/app","State":"running","Status":"Up 38 minutes","Ports":"0.0.0.0:80->80/tcp","CreatedAt":"2026-07-17 23:00:00 -0300 -03","Labels":"com.docker.compose.project=backend,com.docker.compose.project.working_dir=/home/user/backend,desktop.docker.io/x=y"})

  @stats_line ~s({"ID":"#{@full_id}","Container":"abc123abc123","Name":"betting-app","CPUPerc":"0.57%","MemUsage":"512MiB / 45.94GiB"})

  setup do
    on_exit(fn -> Application.delete_env(:symphony_elixir, :docker_runner) end)
  end

  defp put_runner(fun), do: Application.put_env(:symphony_elixir, :docker_runner, fun)

  test "list_containers merges ps and stats and extracts compose labels" do
    put_runner(fn
      ["ps" | _rest] -> {@ps_line <> "\n", 0}
      ["stats" | _rest] -> {@stats_line <> "\n", 0}
    end)

    assert {:ok, [container]} = Docker.list_containers()
    assert container.id == @full_id
    assert container.name == "betting-app"
    assert container.image == "sail-8.5/app"
    assert container.state == "running"
    assert container.status == "Up 38 minutes"
    assert container.ports == "0.0.0.0:80->80/tcp"
    assert container.compose_project == "backend"
    assert container.compose_working_dir == "/home/user/backend"
    assert container.cpu_percent == "0.57%"
    assert container.memory_usage == "512MiB / 45.94GiB"
  end

  test "container without stats row keeps nil cpu and memory" do
    put_runner(fn
      ["ps" | _rest] -> {@ps_line <> "\n", 0}
      ["stats" | _rest] -> {"", 0}
    end)

    assert {:ok, [container]} = Docker.list_containers()
    assert container.cpu_percent == nil
    assert container.memory_usage == nil
  end

  test "malformed json lines and empty labels are tolerated" do
    ps = ~s({"ID":"#{@full_id}","Names":"a","Image":"b","State":"exited","Status":"Exited (0)","Ports":"","CreatedAt":"","Labels":""})

    put_runner(fn
      ["ps" | _rest] -> {"not-json\n" <> ps <> "\n", 0}
      ["stats" | _rest] -> {"also-not-json\n", 0}
    end)

    assert {:ok, [container]} = Docker.list_containers()
    assert container.compose_project == nil
    assert container.compose_working_dir == nil
  end

  test "list_containers returns error when the daemon is unreachable" do
    put_runner(fn _args -> {"Cannot connect to the Docker daemon\n", 1} end)

    assert {:error, "Cannot connect to the Docker daemon"} = Docker.list_containers()
  end
end
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/docker_test.exs`
Expected: compilation failure — `module SymphonyElixir.Docker is not available`.

- [ ] **Step 3: Write the implementation**

Create `elixir/lib/symphony_elixir/docker.ex`:

```elixir
defmodule SymphonyElixir.Docker do
  @moduledoc """
  Thin wrapper around the local Docker CLI used by the tracker Docker dashboard.

  Shell access goes through a runner function of type
  `([String.t()] -> {String.t(), integer()})` injectable via the
  `:docker_runner` application env so tests never touch a real daemon.

  Known limitation: compose labels are parsed from Docker's comma-joined label
  string, so label values containing commas are truncated at the comma.
  """

  @compose_project_label "com.docker.compose.project"
  @compose_working_dir_label "com.docker.compose.project.working_dir"

  @action_args %{
    "start" => ["start"],
    "stop" => ["stop"],
    "restart" => ["restart"],
    "remove" => ["rm"]
  }

  @container_id_pattern ~r/^[A-Fa-f0-9]{12,64}$/

  @type container :: %{
          id: String.t(),
          name: String.t(),
          image: String.t(),
          state: String.t(),
          status: String.t(),
          ports: String.t(),
          created_at: String.t(),
          compose_project: String.t() | nil,
          compose_working_dir: String.t() | nil,
          cpu_percent: String.t() | nil,
          memory_usage: String.t() | nil
        }

  @spec list_containers() :: {:ok, [container()]} | {:error, String.t()}
  def list_containers do
    with {:ok, ps_rows} <- docker_json_lines(["ps", "-a", "--no-trunc", "--format", "{{json .}}"]),
         {:ok, stats_rows} <-
           docker_json_lines(["stats", "--no-stream", "--no-trunc", "--format", "{{json .}}"]) do
      stats_by_id = Map.new(stats_rows, fn row -> {row["ID"] || row["Container"], row} end)
      {:ok, Enum.map(ps_rows, &build_container(&1, stats_by_id))}
    end
  end

  @spec container_action(String.t(), String.t(), keyword()) ::
          :ok | {:error, :invalid_container_id | :invalid_action | String.t()}
  def container_action(id, action, opts \\ []) do
    cond do
      not (is_binary(id) and Regex.match?(@container_id_pattern, id)) ->
        {:error, :invalid_container_id}

      not Map.has_key?(@action_args, action) ->
        {:error, :invalid_action}

      true ->
        run_action(id, action, Keyword.get(opts, :force, false))
    end
  end

  defp run_action(id, action, force) do
    base = Map.fetch!(@action_args, action)
    args = if action == "remove" and force, do: base ++ ["--force"], else: base

    case run(args ++ [id]) do
      {_output, 0} -> :ok
      {output, _code} -> {:error, String.trim(output)}
    end
  end

  defp docker_json_lines(args) do
    case run(args) do
      {output, 0} -> {:ok, parse_json_lines(output)}
      {output, _code} -> {:error, String.trim(output)}
    end
  end

  defp parse_json_lines(output) do
    output
    |> String.split("\n", trim: true)
    |> Enum.flat_map(fn line ->
      case Jason.decode(line) do
        {:ok, row} when is_map(row) -> [row]
        _ -> []
      end
    end)
  end

  defp build_container(ps_row, stats_by_id) do
    labels = parse_labels(ps_row["Labels"])
    stats = Map.get(stats_by_id, ps_row["ID"], %{})

    %{
      id: ps_row["ID"] || "",
      name: ps_row["Names"] || "",
      image: ps_row["Image"] || "",
      state: ps_row["State"] || "",
      status: ps_row["Status"] || "",
      ports: ps_row["Ports"] || "",
      created_at: ps_row["CreatedAt"] || "",
      compose_project: labels[@compose_project_label],
      compose_working_dir: labels[@compose_working_dir_label],
      cpu_percent: stats["CPUPerc"],
      memory_usage: stats["MemUsage"]
    }
  end

  defp parse_labels(labels) when is_binary(labels) do
    labels
    |> String.split(",")
    |> Enum.reduce(%{}, fn pair, acc ->
      case String.split(pair, "=", parts: 2) do
        [key, value] when value != "" -> Map.put(acc, key, value)
        _ -> acc
      end
    end)
  end

  defp parse_labels(_labels), do: %{}

  defp run(args) do
    runner = Application.get_env(:symphony_elixir, :docker_runner, &default_runner/1)
    runner.(args)
  end

  defp default_runner(args) do
    System.cmd("docker", args, stderr_to_stdout: true)
  rescue
    _error -> {"docker CLI is not available on this host", 127}
  end
end
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/docker_test.exs`
Expected: `4 tests, 0 failures` (the `container_action` tests come in Task 2).

- [ ] **Step 5: Commit**

```bash
cd /home/raphaelcangucu/symphony
git add elixir/lib/symphony_elixir/docker.ex elixir/test/symphony_elixir/docker_test.exs
git commit -m "feat(elixir): add SymphonyElixir.Docker container listing"
```

---

### Task 2: `SymphonyElixir.Docker.container_action/3`

**Files:**
- Modify: `elixir/test/symphony_elixir/docker_test.exs` (append tests)
- `elixir/lib/symphony_elixir/docker.ex` already contains the implementation from Task 1 Step 3 — this task locks its behavior with tests.

- [ ] **Step 1: Append the action tests**

Add inside `SymphonyElixir.DockerTest`, before the final `end`:

```elixir
  test "container_action rejects a non-hex container id" do
    assert {:error, :invalid_container_id} = Docker.container_action("betting-app", "stop")
    assert {:error, :invalid_container_id} = Docker.container_action("abc; rm -rf /", "stop")
  end

  test "container_action rejects an unknown action" do
    assert {:error, :invalid_action} = Docker.container_action(@full_id, "kill")
  end

  test "container_action runs the expected docker arguments" do
    parent = self()

    put_runner(fn args ->
      send(parent, {:docker_args, args})
      {"", 0}
    end)

    assert :ok = Docker.container_action(@full_id, "restart")
    assert_received {:docker_args, ["restart", @full_id]}

    assert :ok = Docker.container_action(@full_id, "remove", force: true)
    assert_received {:docker_args, ["rm", "--force", @full_id]}
  end

  test "container_action returns trimmed CLI output on failure" do
    put_runner(fn _args -> {"Error response from daemon: boom\n", 1} end)

    assert {:error, "Error response from daemon: boom"} = Docker.container_action(@full_id, "stop")
  end
```

- [ ] **Step 2: Run the test file**

Run: `cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/docker_test.exs`
Expected: `8 tests, 0 failures`.

- [ ] **Step 3: Commit**

```bash
cd /home/raphaelcangucu/symphony
git add elixir/test/symphony_elixir/docker_test.exs
git commit -m "test(elixir): cover Docker.container_action validation and args"
```

---

### Task 3: Controller and routes

**Files:**
- Create: `elixir/test/symphony_elixir_web/controllers/tracker/docker_controller_test.exs`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/docker_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex` (tracker_api scope, after the `/observability` routes around line 81)

- [ ] **Step 1: Write the failing controller test**

Create `elixir/test/symphony_elixir_web/controllers/tracker/docker_controller_test.exs` (setup mirrors `observability_controller_test.exs` in the same directory):

```elixir
defmodule SymphonyElixirWeb.Tracker.DockerControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @token "test-token"
  @full_id "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc12345"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, @token)

    on_exit(fn ->
      if previous_token, do: System.put_env(@token_env, previous_token), else: System.delete_env(@token_env)
      Application.delete_env(:symphony_elixir, :docker_runner)
    end)

    :ok
  end

  defp auth(conn), do: put_req_header(conn, "authorization", "Bearer #{@token}")

  defp put_runner(fun), do: Application.put_env(:symphony_elixir, :docker_runner, fun)

  test "rejects unauthenticated requests" do
    conn = get(build_conn(), "/api/tracker/v1/docker/containers")
    assert json_response(conn, 401)
  end

  test "index returns containers when docker responds" do
    ps = ~s({"ID":"#{@full_id}","Names":"web","Image":"nginx","State":"running","Status":"Up","Ports":"","CreatedAt":"","Labels":"com.docker.compose.project=demo"})

    put_runner(fn
      ["ps" | _rest] -> {ps <> "\n", 0}
      ["stats" | _rest] -> {"", 0}
    end)

    conn = build_conn() |> auth() |> get("/api/tracker/v1/docker/containers")
    data = json_response(conn, 200)["data"]

    assert data["available"] == true
    assert [%{"name" => "web", "compose_project" => "demo"}] = data["containers"]
  end

  test "index reports an unavailable daemon without failing" do
    put_runner(fn _args -> {"Cannot connect to the Docker daemon\n", 1} end)

    conn = build_conn() |> auth() |> get("/api/tracker/v1/docker/containers")
    data = json_response(conn, 200)["data"]

    assert data["available"] == false
    assert data["containers"] == []
    assert data["error"] =~ "Cannot connect"
  end

  test "command runs a whitelisted action" do
    put_runner(fn ["stop", @full_id] -> {"", 0} end)

    conn = build_conn() |> auth() |> post("/api/tracker/v1/docker/containers/#{@full_id}/stop")
    assert json_response(conn, 200)["data"]["ok"] == true
  end

  test "command passes force through to remove" do
    parent = self()

    put_runner(fn args ->
      send(parent, {:docker_args, args})
      {"", 0}
    end)

    conn =
      build_conn()
      |> auth()
      |> post("/api/tracker/v1/docker/containers/#{@full_id}/remove", %{"force" => true})

    assert json_response(conn, 200)["data"]["ok"] == true
    assert_received {:docker_args, ["rm", "--force", @full_id]}
  end

  test "command rejects an unknown action with 422" do
    conn = build_conn() |> auth() |> post("/api/tracker/v1/docker/containers/#{@full_id}/kill")
    assert json_response(conn, 422)["error"]["code"] == "invalid_action"
  end

  test "command rejects a malformed container id with 422" do
    conn = build_conn() |> auth() |> post("/api/tracker/v1/docker/containers/not-hex/stop")
    assert json_response(conn, 422)["error"]["code"] == "invalid_container_id"
  end

  test "command surfaces docker failures as 502" do
    put_runner(fn _args -> {"Error response from daemon: boom\n", 1} end)

    conn = build_conn() |> auth() |> post("/api/tracker/v1/docker/containers/#{@full_id}/stop")
    assert json_response(conn, 502)["error"]["code"] == "docker_action_failed"
  end
end
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir_web/controllers/tracker/docker_controller_test.exs`
Expected: FAIL — routes return 404 / controller module missing.

- [ ] **Step 3: Implement the controller**

Create `elixir/lib/symphony_elixir_web/controllers/tracker/docker_controller.ex`.
Note: the action is named `command`, not `action` — `Phoenix.Controller` already defines an overridable `action/2` plug and shadowing it would break dispatch.

```elixir
defmodule SymphonyElixirWeb.Tracker.DockerController do
  @moduledoc "JSON API for the local Docker dashboard (list containers, run lifecycle commands)."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Docker

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, _params) do
    case Docker.list_containers() do
      {:ok, containers} ->
        json(conn, %{data: %{available: true, error: nil, containers: containers}})

      {:error, reason} ->
        json(conn, %{data: %{available: false, error: reason, containers: []}})
    end
  end

  @spec command(Conn.t(), map()) :: Conn.t()
  def command(conn, %{"id" => id, "command" => command} = params) do
    case Docker.container_action(id, command, force: params["force"] == true) do
      :ok ->
        json(conn, %{data: %{ok: true}})

      {:error, :invalid_container_id} ->
        render_error(conn, 422, "invalid_container_id", "Container id must be a 12-64 character hex string.")

      {:error, :invalid_action} ->
        render_error(conn, 422, "invalid_action", "Command must be one of: start, stop, restart, remove.")

      {:error, reason} when is_binary(reason) ->
        render_error(conn, 502, "docker_action_failed", reason)
    end
  end

  defp render_error(conn, status, code, message) do
    conn
    |> Conn.put_status(status)
    |> json(%{error: %{code: code, message: message}})
  end
end
```

- [ ] **Step 4: Add the routes**

In `elixir/lib/symphony_elixir_web/router.ex`, inside the `scope "/api/tracker/v1"` block that pipes through `:tracker_api`, directly after `post("/observability/report", ObservabilityController, :report)`:

```elixir
    get("/docker/containers", DockerController, :index)
    post("/docker/containers/:id/:command", DockerController, :command)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir_web/controllers/tracker/docker_controller_test.exs`
Expected: `8 tests, 0 failures`.

- [ ] **Step 6: Verify specs and formatting**

Run: `cd /home/raphaelcangucu/symphony/elixir && mix specs.check && mix format --check-formatted lib/symphony_elixir/docker.ex lib/symphony_elixir_web/controllers/tracker/docker_controller.ex lib/symphony_elixir_web/router.ex`
Expected: exit 0 (run `mix format <files>` first if the check complains).

- [ ] **Step 7: Commit**

```bash
cd /home/raphaelcangucu/symphony
git add elixir/lib/symphony_elixir_web/controllers/tracker/docker_controller.ex \
        elixir/lib/symphony_elixir_web/router.ex \
        elixir/test/symphony_elixir_web/controllers/tracker/docker_controller_test.exs
git commit -m "feat(elixir): docker dashboard tracker endpoints"
```

---

### Task 4: Frontend service

**Files:**
- Create: `tracker/src/services/__tests__/docker.test.ts`
- Create: `tracker/src/services/docker.ts`

- [ ] **Step 1: Write the failing tests**

Create `tracker/src/services/__tests__/docker.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
  compareDockerContainers,
  mapDockerContainer,
  type DockerContainer,
} from "../docker";

function container(overrides: Partial<DockerContainer>): DockerContainer {
  return {
    id: "a".repeat(64),
    name: "web",
    image: "nginx",
    state: "running",
    status: "Up",
    ports: "",
    createdAt: "",
    composeProject: null,
    composeWorkingDir: null,
    cpuPercent: null,
    memoryUsage: null,
    ...overrides,
  };
}

describe("mapDockerContainer", () => {
  it("maps snake_case backend fields and defaults missing values", () => {
    const mapped = mapDockerContainer({
      id: "abc",
      name: "betting-app",
      image: "sail-8.5/app",
      state: "running",
      status: "Up 38 minutes",
      ports: "0.0.0.0:80->80/tcp",
      created_at: "2026-07-17",
      compose_project: "backend",
      compose_working_dir: "/home/user/backend",
      cpu_percent: "0.57%",
      memory_usage: "512MiB / 45.94GiB",
    });

    expect(mapped).toEqual({
      id: "abc",
      name: "betting-app",
      image: "sail-8.5/app",
      state: "running",
      status: "Up 38 minutes",
      ports: "0.0.0.0:80->80/tcp",
      createdAt: "2026-07-17",
      composeProject: "backend",
      composeWorkingDir: "/home/user/backend",
      cpuPercent: "0.57%",
      memoryUsage: "512MiB / 45.94GiB",
    });
  });

  it("defaults null and missing fields", () => {
    const mapped = mapDockerContainer({});
    expect(mapped.name).toBe("");
    expect(mapped.composeProject).toBeNull();
    expect(mapped.cpuPercent).toBeNull();
  });
});

describe("compareDockerContainers", () => {
  it("sorts strings case-insensitively with null compose projects last", () => {
    const a = container({ composeProject: "backend" });
    const b = container({ composeProject: null });
    expect(compareDockerContainers(a, b, "composeProject")).toBeLessThan(0);
    expect(compareDockerContainers(b, a, "composeProject")).toBeGreaterThan(0);
  });

  it("sorts cpuPercent numerically treating missing values as lowest", () => {
    const low = container({ cpuPercent: "0.5%" });
    const high = container({ cpuPercent: "17.4%" });
    const none = container({ cpuPercent: null });
    expect(compareDockerContainers(low, high, "cpuPercent")).toBeLessThan(0);
    expect(compareDockerContainers(none, low, "cpuPercent")).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/services/__tests__/docker.test.ts`
Expected: FAIL — `Cannot find module '../docker'`.

- [ ] **Step 3: Implement the service**

Create `tracker/src/services/docker.ts`:

```typescript
import axios from "axios";

import { http, trackerPath, unwrapData } from "./http";

export type DockerCommand = "start" | "stop" | "restart" | "remove";

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  createdAt: string;
  composeProject: string | null;
  composeWorkingDir: string | null;
  cpuPercent: string | null;
  memoryUsage: string | null;
}

export interface DockerOverview {
  available: boolean;
  error: string | null;
  containers: DockerContainer[];
}

export type DockerSortKey = "name" | "composeProject" | "image" | "state" | "cpuPercent";

interface BackendDockerContainerDto {
  id?: string | null;
  name?: string | null;
  image?: string | null;
  state?: string | null;
  status?: string | null;
  ports?: string | null;
  created_at?: string | null;
  compose_project?: string | null;
  compose_working_dir?: string | null;
  cpu_percent?: string | null;
  memory_usage?: string | null;
}

interface BackendDockerOverviewDto {
  available?: boolean | null;
  error?: string | null;
  containers?: BackendDockerContainerDto[] | null;
}

export function mapDockerContainer(dto: BackendDockerContainerDto): DockerContainer {
  return {
    id: dto.id ?? "",
    name: dto.name ?? "",
    image: dto.image ?? "",
    state: dto.state ?? "",
    status: dto.status ?? "",
    ports: dto.ports ?? "",
    createdAt: dto.created_at ?? "",
    composeProject: dto.compose_project ?? null,
    composeWorkingDir: dto.compose_working_dir ?? null,
    cpuPercent: dto.cpu_percent ?? null,
    memoryUsage: dto.memory_usage ?? null,
  };
}

export function compareDockerContainers(
  a: DockerContainer,
  b: DockerContainer,
  key: DockerSortKey,
): number {
  if (key === "cpuPercent") {
    return parseCpuPercent(a.cpuPercent) - parseCpuPercent(b.cpuPercent);
  }

  const left = a[key];
  const right = b[key];
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.toLowerCase().localeCompare(right.toLowerCase());
}

function parseCpuPercent(value: string | null): number {
  if (!value) return -1;
  const parsed = Number.parseFloat(value.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : -1;
}

export async function fetchDockerOverview(signal?: AbortSignal): Promise<DockerOverview> {
  const response = await http.get<unknown>(trackerPath("/docker/containers"), { signal });
  const dto = unwrapData<BackendDockerOverviewDto>(response);
  return {
    available: dto.available ?? false,
    error: dto.error ?? null,
    containers: (dto.containers ?? []).map(mapDockerContainer),
  };
}

export async function runDockerCommand(
  containerId: string,
  command: DockerCommand,
  options?: { force?: boolean },
): Promise<void> {
  await http.post(trackerPath(`/docker/containers/${containerId}/${command}`), {
    force: options?.force ?? false,
  });
}

export function describeDockerError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: { message?: unknown } } | undefined)?.error
      ?.message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/services/__tests__/docker.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/raphaelcangucu/symphony
git add tracker/src/services/docker.ts tracker/src/services/__tests__/docker.test.ts
git commit -m "feat(tracker): docker service with mapper and sort comparator"
```

---

### Task 5: Page, route, sidebar, i18n

**Files:**
- Create: `tracker/src/pages/DockerPage.tsx`
- Modify: `tracker/src/App.tsx` (import + route next to `observability`, ~line 139)
- Modify: `tracker/src/components/layout/sidebar/SidebarUtilityNav.tsx`
- Modify: `tracker/locales/en/tracker.json`, `tracker/locales/pt-BR/tracker.json`

- [ ] **Step 1: Add i18n keys**

In `tracker/locales/en/tracker.json`, inside the top-level `"nav"` object (around line 3437, next to its `"observability"` entry), add:

```json
"docker": "Docker",
```

Then add a new top-level section (e.g. right after the `"observability"` page section that starts around line 2075):

```json
"docker": {
  "title": "Docker",
  "subtitle": "Containers on the local Docker daemon",
  "searchPlaceholder": "Search containers…",
  "onlyRunning": "Only running",
  "unavailable": "Docker daemon is unavailable",
  "empty": "No containers match the current filters.",
  "columns": {
    "name": "Name",
    "project": "Compose project",
    "path": "Path",
    "image": "Image",
    "status": "Status",
    "ports": "Ports",
    "cpu": "CPU",
    "memory": "Memory"
  },
  "rowActions": {
    "start": "Start",
    "stop": "Stop",
    "restart": "Restart",
    "remove": "Remove"
  },
  "removeTitle": "Remove container",
  "removeDescription": "Remove {{name}}? Running containers are force-removed. This cannot be undone.",
  "removeConfirm": "Remove",
  "cancel": "Cancel",
  "actionFailed": "Docker action failed: {{message}}"
},
```

In `tracker/locales/pt-BR/tracker.json`, mirror both additions:

```json
"docker": "Docker",
```

```json
"docker": {
  "title": "Docker",
  "subtitle": "Containers no daemon Docker local",
  "searchPlaceholder": "Buscar containers…",
  "onlyRunning": "Somente em execução",
  "unavailable": "O daemon do Docker está indisponível",
  "empty": "Nenhum container corresponde aos filtros atuais.",
  "columns": {
    "name": "Nome",
    "project": "Projeto compose",
    "path": "Caminho",
    "image": "Imagem",
    "status": "Status",
    "ports": "Portas",
    "cpu": "CPU",
    "memory": "Memória"
  },
  "rowActions": {
    "start": "Iniciar",
    "stop": "Parar",
    "restart": "Reiniciar",
    "remove": "Remover"
  },
  "removeTitle": "Remover container",
  "removeDescription": "Remover {{name}}? Containers em execução são removidos à força. Esta ação não pode ser desfeita.",
  "removeConfirm": "Remover",
  "cancel": "Cancelar",
  "actionFailed": "A ação do Docker falhou: {{message}}"
},
```

- [ ] **Step 2: Create the page**

Create `tracker/src/pages/DockerPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, Play, RotateCw, Square, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  compareDockerContainers,
  describeDockerError,
  fetchDockerOverview,
  runDockerCommand,
  type DockerCommand,
  type DockerContainer,
  type DockerOverview,
  type DockerSortKey,
} from "@/services/docker";
import { isCanceledError } from "@/services/http";

const POLL_INTERVAL_MS = 5000;

const STATE_DOT_CLASS: Record<string, string> = {
  running: "bg-emerald-500",
  restarting: "bg-amber-500 animate-pulse",
  paused: "bg-amber-500",
  created: "bg-sky-500",
  exited: "bg-zinc-400",
  dead: "bg-red-500",
};

const SORTABLE_COLUMNS: ReadonlyArray<{ key: DockerSortKey; labelKey: string }> = [
  { key: "name", labelKey: "docker.columns.name" },
  { key: "composeProject", labelKey: "docker.columns.project" },
  { key: "image", labelKey: "docker.columns.image" },
  { key: "state", labelKey: "docker.columns.status" },
  { key: "cpuPercent", labelKey: "docker.columns.cpu" },
];

function shortenPath(path: string | null): string {
  if (!path) return "—";
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 3) return path;
  return `…/${segments.slice(-3).join("/")}`;
}

export function DockerPage() {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<DockerOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyRunning, setOnlyRunning] = useState(false);
  const [sortKey, setSortKey] = useState<DockerSortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [removeTarget, setRemoveTarget] = useState<DockerContainer | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const data = await fetchDockerOverview(controller.signal);
      setOverview(data);
      setLoadError(null);
    } catch (error) {
      if (!isCanceledError(error)) {
        setLoadError(describeDockerError(error));
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [refresh]);

  const rows = useMemo(() => {
    const containers = overview?.containers ?? [];
    const query = search.trim().toLowerCase();
    const filtered = containers.filter((item) => {
      if (onlyRunning && item.state !== "running") return false;
      if (!query) return true;
      return [item.name, item.image, item.composeProject ?? "", item.composeWorkingDir ?? ""].some(
        (field) => field.toLowerCase().includes(query),
      );
    });
    const sorted = [...filtered].sort((a, b) => compareDockerContainers(a, b, sortKey));
    return sortAsc ? sorted : sorted.reverse();
  }, [overview, search, onlyRunning, sortKey, sortAsc]);

  const executeCommand = useCallback(
    async (target: DockerContainer, command: DockerCommand, force = false) => {
      setPendingIds((previous) => new Set(previous).add(target.id));
      setActionError(null);
      try {
        await runDockerCommand(target.id, command, { force });
        await refresh();
      } catch (error) {
        setActionError(t("docker.actionFailed", { message: describeDockerError(error) }));
      } finally {
        setPendingIds((previous) => {
          const next = new Set(previous);
          next.delete(target.id);
          return next;
        });
      }
    },
    [refresh, t],
  );

  const toggleSort = useCallback(
    (key: DockerSortKey) => {
      if (key === sortKey) {
        setSortAsc((previous) => !previous);
        return;
      }
      setSortKey(key);
      setSortAsc(true);
    },
    [sortKey],
  );

  const confirmRemove = useCallback(async () => {
    if (!removeTarget) return;
    const target = removeTarget;
    setRemoveTarget(null);
    await executeCommand(target, "remove", target.state === "running");
  }, [executeCommand, removeTarget]);

  const daemonError = loadError ?? (overview && !overview.available ? overview.error : null);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-xl font-semibold">{t("docker.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("docker.subtitle")}</p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("docker.searchPlaceholder")}
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyRunning}
            onChange={(event) => setOnlyRunning(event.target.checked)}
            className="h-4 w-4"
          />
          {t("docker.onlyRunning")}
        </label>
      </div>

      {daemonError ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          {t("docker.unavailable")}: {daemonError}
        </div>
      ) : null}
      {actionError ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100">
          {actionError}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              {SORTABLE_COLUMNS.slice(0, 2).map((column) => (
                <th key={column.key} className="px-3 py-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1"
                    onClick={() => toggleSort(column.key)}
                  >
                    {t(column.labelKey)}
                    <ArrowUpDown className="h-3 w-3" aria-hidden />
                  </button>
                </th>
              ))}
              <th className="px-3 py-2">{t("docker.columns.path")}</th>
              <th className="px-3 py-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1"
                  onClick={() => toggleSort("image")}
                >
                  {t("docker.columns.image")}
                  <ArrowUpDown className="h-3 w-3" aria-hidden />
                </button>
              </th>
              <th className="px-3 py-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1"
                  onClick={() => toggleSort("state")}
                >
                  {t("docker.columns.status")}
                  <ArrowUpDown className="h-3 w-3" aria-hidden />
                </button>
              </th>
              <th className="px-3 py-2">{t("docker.columns.ports")}</th>
              <th className="px-3 py-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1"
                  onClick={() => toggleSort("cpuPercent")}
                >
                  {t("docker.columns.cpu")}
                  <ArrowUpDown className="h-3 w-3" aria-hidden />
                </button>
              </th>
              <th className="px-3 py-2">{t("docker.columns.memory")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((container) => {
              const pending = pendingIds.has(container.id);
              return (
                <tr key={container.id} className="border-t">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT_CLASS[container.state] ?? "bg-zinc-400"}`}
                        aria-hidden
                      />
                      <span className="font-medium">{container.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">{container.composeProject ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground" title={container.composeWorkingDir ?? undefined}>
                    {shortenPath(container.composeWorkingDir)}
                  </td>
                  <td className="max-w-56 truncate px-3 py-2" title={container.image}>
                    {container.image}
                  </td>
                  <td className="px-3 py-2">{container.status}</td>
                  <td className="max-w-48 truncate px-3 py-2" title={container.ports}>
                    {container.ports || "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{container.cpuPercent ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{container.memoryUsage ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center justify-end gap-1">
                      {container.state === "running" ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={pending}
                            aria-label={t("docker.rowActions.stop")}
                            title={t("docker.rowActions.stop")}
                            onClick={() => void executeCommand(container, "stop")}
                          >
                            <Square className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={pending}
                            aria-label={t("docker.rowActions.restart")}
                            title={t("docker.rowActions.restart")}
                            onClick={() => void executeCommand(container, "restart")}
                          >
                            <RotateCw className="h-4 w-4" aria-hidden />
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={pending}
                          aria-label={t("docker.rowActions.start")}
                          title={t("docker.rowActions.start")}
                          onClick={() => void executeCommand(container, "start")}
                        >
                          <Play className="h-4 w-4" aria-hidden />
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={pending}
                        aria-label={t("docker.rowActions.remove")}
                        title={t("docker.rowActions.remove")}
                        onClick={() => setRemoveTarget(container)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                      </Button>
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  {t("docker.empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Dialog open={removeTarget !== null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("docker.removeTitle")}</DialogTitle>
            <DialogDescription>
              {t("docker.removeDescription", { name: removeTarget?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRemoveTarget(null)}>
              {t("docker.cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmRemove()}>
              {t("docker.removeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

Implementation notes for this step:
- Check `tracker/src/components/ui/dialog.tsx` exports; if `DialogFooter` / `DialogDescription` are not exported there, compose the footer with a plain `div className="flex justify-end gap-2"` instead.
- Check `tracker/src/components/ui/button.tsx` for the available variants; if `destructive` or `size="icon"` are missing, use the closest existing variant (`ghost` + explicit `h-8 w-8 p-0` classes).

- [ ] **Step 3: Register the route**

In `tracker/src/App.tsx`, add the import next to the `ObservabilityPage` import:

```tsx
import { DockerPage } from "@/pages/DockerPage";
```

and add the route directly under `<Route path="observability" element={<ObservabilityPage />} />` (~line 139):

```tsx
<Route path="docker" element={<DockerPage />} />
```

- [ ] **Step 4: Add the sidebar link**

In `tracker/src/components/layout/sidebar/SidebarUtilityNav.tsx`, extend the lucide import:

```tsx
import { Activity, Container, Plus, Search, Settings } from "lucide-react";
```

and insert after the Observability button (the `<Button asChild ...><Link to="/observability">` block ending at line 58):

```tsx
      <Button asChild variant="ghost" className={actionClass}>
        <Link to="/docker">
          <Container className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{t("nav.docker")}</span>
        </Link>
      </Button>
```

- [ ] **Step 5: Verify with lint and the existing targeted test**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx eslint src/pages/DockerPage.tsx src/services/docker.ts src/components/layout/sidebar/SidebarUtilityNav.tsx src/App.tsx`
Expected: exit 0, no errors.

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/services/__tests__/docker.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 6: Manual smoke check**

With the Symphony daemon and tracker dev server running (`npm run dev` in `tracker/` if not already up), open `http://localhost:<tracker-port>/docker` and verify:
1. The table lists the same containers as `docker ps -a` (betting-app, cde-1131-*, etc.), with compose project and path columns filled.
2. CPU/Mem show values for running containers and `—` for stopped ones.
3. Stopping and restarting a disposable container (e.g. `betting-shared-mailpit`) works and the row status updates within one poll cycle.
4. The remove flow shows the confirm dialog and cancel works.

- [ ] **Step 7: Commit**

```bash
cd /home/raphaelcangucu/symphony
git add tracker/src/pages/DockerPage.tsx tracker/src/App.tsx \
        tracker/src/components/layout/sidebar/SidebarUtilityNav.tsx \
        tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json
git commit -m "feat(tracker): docker dashboard page, route, and sidebar entry"
```

> Note: `tracker/locales/*.json` currently have unrelated uncommitted edits from other in-flight work. Stage hunks selectively (`git add -p`) if that work is still uncommitted when this task lands.

---

### Task 6: Final gates

- [ ] **Step 1: Elixir gates (targeted, not the full suite)**

Run sequentially, waiting for each:

```bash
cd /home/raphaelcangucu/symphony/elixir
mix specs.check
mix format --check-formatted lib/symphony_elixir/docker.ex lib/symphony_elixir_web/controllers/tracker/docker_controller.ex lib/symphony_elixir_web/router.ex test/symphony_elixir/docker_test.exs test/symphony_elixir_web/controllers/tracker/docker_controller_test.exs
mix test test/symphony_elixir/docker_test.exs
```

then, separately:

```bash
mix test test/symphony_elixir_web/controllers/tracker/docker_controller_test.exs
```

Expected: all exit 0. (`make all` runs the full suite — per the WSL rule, ask the user before running it.)

- [ ] **Step 2: Tracker build check**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx tsc -b`
Expected: exit 0, no type errors.

- [ ] **Step 3: Commit any formatting fallout**

```bash
cd /home/raphaelcangucu/symphony
git add -u elixir tracker/src
git commit -m "chore: formatting for docker dashboard" # only if Step 1/2 changed files
```

---

## Self-review

- **Spec coverage:** listing endpoint (Tasks 1, 3), actions with whitelist/force (Tasks 2, 3), flat sortable table with search/only-running/polling/actions/confirm (Task 5), daemon-down behavior (Tasks 1, 3, 5 error banner), compose project + path columns (Tasks 1, 5), sidebar + route + i18n (Task 5), tests one-file-at-a-time (all test commands are single-file).
- **Placeholder scan:** none; the two "check exports" notes in Task 5 Step 2 give concrete fallbacks.
- **Type consistency:** `Docker.container_action/3` (Tasks 1–3), `command` controller action name matches the `:command` route segment (Task 3), `DockerContainer`/`DockerSortKey`/`compareDockerContainers` names match between service, tests, and page (Tasks 4–5).
