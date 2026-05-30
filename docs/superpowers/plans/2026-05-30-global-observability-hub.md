# Global Observability Hub Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Replace example commands with this repo's real tools.

**Goal:** Aggregate live agent/runtime state from many per-project Symphony orchestrator processes into one global observability page inside the tracker SPA, served by the `:4000` hub process, replacing the single-workflow `/` LiveView.

**Architecture:** Worker processes report their `Orchestrator.snapshot` to a hub via `POST /api/tracker/v1/observability/report` (event-driven on `:observability_updated` plus a heartbeat). The hub keeps the latest snapshot per runtime in an ETS-backed `Observability.Registry`, pushes updates over a Phoenix channel (`observability:global`), and serves the aggregate at `GET /api/tracker/v1/observability`. The tracker SPA renders per-runtime cards + a global active-sessions table, with a client-side 1s tick for the runtime clock. The old `/` LiveView is retired; `/` redirects to `/tracker`.

**Tech Stack:** Elixir/Phoenix (Bandit, Phoenix.Channels, NimbleOptions, Req, ExUnit), React 19 + Vite + TypeScript + Tailwind + `phoenix` JS + Vitest.

**Spec:** `docs/superpowers/specs/2026-05-30-global-observability-hub-design.md`

---

## Data contract (shared by all tasks — do not deviate)

Report body (JSON the worker POSTs; also the shape stored/served):

```json
{
  "runtime_id": "/abs/path/WORKFLOW.md",
  "label": "macro-markets",
  "project_slug": "macro-markets",
  "tracker_kind": "local",
  "agent_kind": "codex",
  "source_url": "http://127.0.0.1:4001",
  "snapshot": {
    "generated_at": "2026-05-30T00:00:00Z",
    "counts": { "running": 1, "retrying": 0 },
    "running": [ /* Presenter running_entry_payload */ ],
    "retrying": [ /* Presenter retry_entry_payload */ ],
    "agent_totals": { "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "seconds_running": 0 },
    "rate_limits": null
  }
}
```

`project_slug`, `source_url`, `rate_limits` may be `null`. `runtime_id` is required.

Registry serialized entry (returned by `GET .../observability` inside `{ "data": [ ... ] }`, and pushed as the `runtime_updated` channel event payload): the identity fields above plus `"status"` (`"online"` | `"stale"`) and `"reported_at"` (ISO8601, hub-stamped), and the flattened snapshot fields `counts`, `running`, `retrying`, `agent_totals`, `rate_limits`.

`runtime_removed` channel event payload: `{ "runtime_id": "..." }`.

---

## File structure

**Backend — create:**
- `elixir/lib/symphony_elixir/observability/registry.ex` — ETS-backed aggregate store + staleness sweep + PubSub broadcast.
- `elixir/lib/symphony_elixir/observability/reporter.ex` — worker-side event-driven reporter.
- `elixir/lib/symphony_elixir_web/controllers/tracker/observability_controller.ex` — `report`/`index` JSON actions.
- `elixir/lib/symphony_elixir_web/channels/observability_channel.ex` — `observability:global` channel.
- Tests mirroring each module under `elixir/test/...`.

**Backend — modify:**
- `elixir/lib/symphony_elixir/config.ex` — observability hub config keys + accessors.
- `elixir/lib/symphony_elixir.ex` — supervise `Registry` and `Reporter`.
- `elixir/lib/symphony_elixir_web/router.ex` — add observability API routes; replace `live("/", ...)` with redirect to `/tracker`.
- `elixir/lib/symphony_elixir_web/channels/user_socket.ex` — register the channel.

**Backend — delete:**
- `elixir/lib/symphony_elixir_web/live/dashboard_live.ex` (and its test, if any).

**Frontend — create:**
- `tracker/src/types/observability.ts`
- `tracker/src/services/observability.ts`
- `tracker/src/services/phoenix/observabilityChannel.ts`
- `tracker/src/hooks/useObservability.ts`
- `tracker/src/pages/ObservabilityPage.tsx`
- Vitest specs alongside (`*.test.ts(x)`).

**Frontend — modify:**
- `tracker/src/App.tsx` — add `/observability` route.
- `tracker/src/components/layout/ProjectSidebar.tsx` — add nav item.

---

## Task 1: Config — observability hub keys & accessors

**Files:**
- Modify: `elixir/lib/symphony_elixir/config.ex` (schema block ~118-135; `extract_observability_options/1` ~550-555; accessors ~384-397; module attrs ~20-22)
- Test: `elixir/test/symphony_elixir/config_test.exs`

- [ ] **Step 1: Write failing tests**

Add to `elixir/test/symphony_elixir/config_test.exs` (follow the file's existing setup for loading a workflow; if it uses a helper to set front matter, reuse it). Use a workflow whose front matter has an `observability:` block.

```elixir
describe "observability hub config" do
  test "defaults when observability section omits hub keys" do
    load_workflow_with_front_matter("""
    github:
      repo: acme/app
    """)

    assert SymphonyElixir.Config.observability_hub_url() == nil
    assert SymphonyElixir.Config.observability_heartbeat_interval_ms() == 5_000
    assert SymphonyElixir.Config.observability_min_report_interval_ms() == 250
  end

  test "reads configured hub keys" do
    load_workflow_with_front_matter("""
    github:
      repo: acme/app
    observability:
      hub_url: http://localhost:4000
      heartbeat_interval_ms: 2000
      min_report_interval_ms: 100
      label: acme-app
      runtime_id: acme-runtime-1
    """)

    assert SymphonyElixir.Config.observability_hub_url() == "http://localhost:4000"
    assert SymphonyElixir.Config.observability_heartbeat_interval_ms() == 2_000
    assert SymphonyElixir.Config.observability_min_report_interval_ms() == 100
    assert SymphonyElixir.Config.observability_label() == "acme-app"
    assert SymphonyElixir.Config.observability_runtime_id() == "acme-runtime-1"
  end

  test "runtime_id falls back to the workflow file path" do
    load_workflow_with_front_matter("""
    github:
      repo: acme/app
    """)

    assert SymphonyElixir.Config.observability_runtime_id() ==
             SymphonyElixir.Workflow.workflow_file_path()
  end
end
```

> If `config_test.exs` has no `load_workflow_with_front_matter/1` helper, copy the workflow-loading approach already used by neighbouring tests in that file (they set `SymphonyElixir.Workflow` state); match the existing pattern exactly.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd elixir && mix test test/symphony_elixir/config_test.exs`
Expected: FAIL with `UndefinedFunctionError` for `observability_hub_url/0` (and the others).

- [ ] **Step 3: Add module attributes**

In `config.ex`, next to the existing observability attrs (~lines 20-22), add:

```elixir
  @default_observability_heartbeat_interval_ms 5_000
  @default_observability_min_report_interval_ms 250
```

- [ ] **Step 4: Extend the NimbleOptions schema**

In the `observability:` schema `keys:` list (~lines 121-134), add after `render_interval_ms`:

```elixir
                                 hub_url: [type: {:or, [:string, nil]}, default: nil],
                                 heartbeat_interval_ms: [
                                   type: :pos_integer,
                                   default: @default_observability_heartbeat_interval_ms
                                 ],
                                 min_report_interval_ms: [
                                   type: :pos_integer,
                                   default: @default_observability_min_report_interval_ms
                                 ],
                                 label: [type: {:or, [:string, nil]}, default: nil],
                                 runtime_id: [type: {:or, [:string, nil]}, default: nil]
```

- [ ] **Step 5: Extend extraction**

In `extract_observability_options/1` (~line 550) append:

```elixir
    |> put_if_present(:hub_url, scalar_string_value(Map.get(section, "hub_url")))
    |> put_if_present(:heartbeat_interval_ms, positive_integer_value(Map.get(section, "heartbeat_interval_ms")))
    |> put_if_present(:min_report_interval_ms, positive_integer_value(Map.get(section, "min_report_interval_ms")))
    |> put_if_present(:label, scalar_string_value(Map.get(section, "label")))
    |> put_if_present(:runtime_id, scalar_string_value(Map.get(section, "runtime_id")))
```

- [ ] **Step 6: Add accessor functions**

After `observability_render_interval_ms/0` (~line 397) add (each public `def` needs an `@spec` per `AGENTS.md`):

```elixir
  @spec observability_hub_url() :: String.t() | nil
  def observability_hub_url do
    get_in(validated_workflow_options(), [:observability, :hub_url])
  end

  @spec observability_heartbeat_interval_ms() :: pos_integer()
  def observability_heartbeat_interval_ms do
    get_in(validated_workflow_options(), [:observability, :heartbeat_interval_ms])
  end

  @spec observability_min_report_interval_ms() :: pos_integer()
  def observability_min_report_interval_ms do
    get_in(validated_workflow_options(), [:observability, :min_report_interval_ms])
  end

  @spec observability_label() :: String.t() | nil
  def observability_label do
    get_in(validated_workflow_options(), [:observability, :label])
  end

  @spec observability_runtime_id() :: String.t()
  def observability_runtime_id do
    get_in(validated_workflow_options(), [:observability, :runtime_id]) ||
      SymphonyElixir.Workflow.workflow_file_path()
  end
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir/config_test.exs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add elixir/lib/symphony_elixir/config.ex elixir/test/symphony_elixir/config_test.exs
git commit -m "feat(config): add observability hub config keys and accessors"
```

---

## Task 2: Observability.Registry (ETS aggregate + staleness)

**Files:**
- Create: `elixir/lib/symphony_elixir/observability/registry.ex`
- Test: `elixir/test/symphony_elixir/observability/registry_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.Observability.RegistryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Observability.Registry

  setup do
    start_supervised!({Phoenix.PubSub, name: :registry_test_pubsub})

    name = :"registry_#{System.unique_integer([:positive])}"

    pid =
      start_supervised!(
        {Registry,
         name: name,
         pubsub: :registry_test_pubsub,
         stale_after_ms: 50,
         drop_after_ms: 120,
         sweep_interval_ms: 20}
      )

    %{registry: pid, name: name}
  end

  defp report(runtime_id, overrides \\ %{}) do
    Map.merge(
      %{
        "runtime_id" => runtime_id,
        "label" => "proj",
        "project_slug" => "proj",
        "tracker_kind" => "local",
        "agent_kind" => "codex",
        "source_url" => "http://localhost:4001",
        "snapshot" => %{
          "generated_at" => "2026-05-30T00:00:00Z",
          "counts" => %{"running" => 1, "retrying" => 0},
          "running" => [],
          "retrying" => [],
          "agent_totals" => %{"input_tokens" => 0, "output_tokens" => 0, "total_tokens" => 0, "seconds_running" => 0},
          "rate_limits" => nil
        }
      },
      overrides
    )
  end

  test "upserts a report and lists it as online", %{name: name} do
    assert :ok = Registry.put_report(name, report("r1"))

    assert [entry] = Registry.list(name)
    assert entry.runtime_id == "r1"
    assert entry.status == :online
    assert entry.counts == %{running: 1, retrying: 0}
    assert is_binary(entry.reported_at)
  end

  test "second report from same runtime upserts in place", %{name: name} do
    Registry.put_report(name, report("r1", %{"label" => "a"}))
    Registry.put_report(name, report("r1", %{"label" => "b"}))

    assert [entry] = Registry.list(name)
    assert entry.label == "b"
  end

  test "rejects a report without runtime_id", %{name: name} do
    assert {:error, :missing_runtime_id} = Registry.put_report(name, report(nil) |> Map.delete("runtime_id"))
    assert Registry.list(name) == []
  end

  test "marks stale then drops after TTL", %{name: name} do
    Registry.put_report(name, report("r1"))
    Process.sleep(80)
    assert [%{status: :stale}] = Registry.list(name)
    Process.sleep(80)
    assert Registry.list(name) == []
  end

  test "broadcasts runtime_updated on report and runtime_removed on drop", %{name: name} do
    Phoenix.PubSub.subscribe(:registry_test_pubsub, "observability:global")

    Registry.put_report(name, report("r1"))
    assert_receive {:observability_event, "runtime_updated", %{runtime_id: "r1"}}, 500

    assert_receive {:observability_event, "runtime_removed", %{runtime_id: "r1"}}, 1_000
  end
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd elixir && mix test test/symphony_elixir/observability/registry_test.exs`
Expected: FAIL — module `SymphonyElixir.Observability.Registry` is not available.

- [ ] **Step 3: Implement the Registry**

```elixir
defmodule SymphonyElixir.Observability.Registry do
  @moduledoc """
  In-memory aggregate of per-runtime observability snapshots reported by
  Symphony worker processes. Holds the latest snapshot per `runtime_id` in ETS,
  derives `online`/`stale` status from the hub-stamped `reported_at`, drops
  runtimes that stop reporting, and broadcasts changes over PubSub.
  """

  use GenServer

  @default_pubsub SymphonyElixir.PubSub
  @topic "observability:global"
  @default_stale_after_ms 15_000
  @default_drop_after_ms 60_000
  @default_sweep_interval_ms 5_000

  @type entry :: %{
          runtime_id: String.t(),
          label: String.t() | nil,
          project_slug: String.t() | nil,
          tracker_kind: String.t() | nil,
          agent_kind: String.t() | nil,
          source_url: String.t() | nil,
          status: :online | :stale,
          reported_at: String.t(),
          counts: map(),
          running: list(),
          retrying: list(),
          agent_totals: map(),
          rate_limits: term()
        }

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @spec put_report(GenServer.name(), map()) :: :ok | {:error, :missing_runtime_id}
  def put_report(server \\ __MODULE__, report) when is_map(report) do
    case fetch_runtime_id(report) do
      nil -> {:error, :missing_runtime_id}
      runtime_id -> GenServer.call(server, {:put_report, runtime_id, report})
    end
  end

  @spec list(GenServer.name()) :: [entry()]
  def list(server \\ __MODULE__) do
    GenServer.call(server, :list)
  end

  @impl true
  def init(opts) do
    table = :ets.new(:observability_runtimes, [:set, :private])

    state = %{
      table: table,
      pubsub: Keyword.get(opts, :pubsub, @default_pubsub),
      stale_after_ms: Keyword.get(opts, :stale_after_ms, @default_stale_after_ms),
      drop_after_ms: Keyword.get(opts, :drop_after_ms, @default_drop_after_ms),
      sweep_interval_ms: Keyword.get(opts, :sweep_interval_ms, @default_sweep_interval_ms)
    }

    schedule_sweep(state)
    {:ok, state}
  end

  @impl true
  def handle_call({:put_report, runtime_id, report}, _from, state) do
    entry = build_entry(runtime_id, report)
    :ets.insert(state.table, {runtime_id, entry})
    broadcast(state, "runtime_updated", serialize(entry))
    {:reply, :ok, state}
  end

  @impl true
  def handle_call(:list, _from, state) do
    now = System.monotonic_time(:millisecond)

    entries =
      state.table
      |> :ets.tab2list()
      |> Enum.map(fn {_id, entry} -> apply_status(entry, now, state.stale_after_ms) end)
      |> Enum.map(&serialize/1)

    {:reply, entries, state}
  end

  @impl true
  def handle_info(:sweep, state) do
    now = System.monotonic_time(:millisecond)

    for {runtime_id, entry} <- :ets.tab2list(state.table),
        now - entry.monotonic_ms > state.drop_after_ms do
      :ets.delete(state.table, runtime_id)
      broadcast(state, "runtime_removed", %{runtime_id: runtime_id})
    end

    schedule_sweep(state)
    {:noreply, state}
  end

  defp build_entry(runtime_id, report) do
    snapshot = Map.get(report, "snapshot", %{})

    %{
      runtime_id: runtime_id,
      label: get(report, "label"),
      project_slug: get(report, "project_slug"),
      tracker_kind: get(report, "tracker_kind"),
      agent_kind: get(report, "agent_kind"),
      source_url: get(report, "source_url"),
      status: :online,
      reported_at: DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601(),
      monotonic_ms: System.monotonic_time(:millisecond),
      counts: atomize_counts(Map.get(snapshot, "counts", %{})),
      running: Map.get(snapshot, "running", []),
      retrying: Map.get(snapshot, "retrying", []),
      agent_totals: Map.get(snapshot, "agent_totals", %{}),
      rate_limits: Map.get(snapshot, "rate_limits")
    }
  end

  defp apply_status(entry, now, stale_after_ms) do
    status = if now - entry.monotonic_ms > stale_after_ms, do: :stale, else: :online
    %{entry | status: status}
  end

  defp serialize(entry), do: Map.delete(entry, :monotonic_ms)

  defp atomize_counts(counts) when is_map(counts) do
    %{
      running: Map.get(counts, "running", Map.get(counts, :running, 0)),
      retrying: Map.get(counts, "retrying", Map.get(counts, :retrying, 0))
    }
  end

  defp fetch_runtime_id(report) do
    case Map.get(report, "runtime_id") || Map.get(report, :runtime_id) do
      value when is_binary(value) and value != "" -> value
      _ -> nil
    end
  end

  defp get(report, key), do: Map.get(report, key) || Map.get(report, String.to_atom(key))

  defp broadcast(state, event_name, payload) do
    case Process.whereis(state.pubsub) do
      pid when is_pid(pid) ->
        Phoenix.PubSub.broadcast(state.pubsub, @topic, {:observability_event, event_name, payload})

      _ ->
        :ok
    end
  end

  defp schedule_sweep(state), do: Process.send_after(self(), :sweep, state.sweep_interval_ms)

  @spec topic() :: String.t()
  def topic, do: @topic
end
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir/observability/registry_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/observability/registry.ex elixir/test/symphony_elixir/observability/registry_test.exs
git commit -m "feat(observability): add ETS-backed runtime registry with staleness sweep"
```

---

## Task 3: Supervise the Registry

**Files:**
- Modify: `elixir/lib/symphony_elixir.ex:28-53`
- Test: covered by Task 2 + a smoke assertion here

- [ ] **Step 1: Write failing test**

Create `elixir/test/symphony_elixir/observability/registry_supervision_test.exs`:

```elixir
defmodule SymphonyElixir.Observability.RegistrySupervisionTest do
  use ExUnit.Case, async: false

  test "registry is started by the application" do
    assert is_pid(Process.whereis(SymphonyElixir.Observability.Registry))
  end
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/observability/registry_supervision_test.exs`
Expected: FAIL — `whereis` returns `nil`.

- [ ] **Step 3: Add to supervision tree**

In `elixir/lib/symphony_elixir.ex`, add `SymphonyElixir.Observability.Registry` to `children` after `{Phoenix.PubSub, name: SymphonyElixir.PubSub}` (the Registry depends on PubSub):

```elixir
    children = [
      {Phoenix.PubSub, name: SymphonyElixir.PubSub},
      SymphonyElixir.Observability.Registry,
      SymphonyElixir.Repo,
      # ... rest unchanged ...
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/observability/registry_supervision_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir.ex elixir/test/symphony_elixir/observability/registry_supervision_test.exs
git commit -m "feat(observability): supervise the runtime registry"
```

---

## Task 4: ObservabilityController + routes (report/index)

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/observability_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex:37-76`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/observability_controller_test.exs`

- [ ] **Step 1: Write failing tests**

Match the existing tracker controller test style (look at a sibling test, e.g. `viewer_controller_test.exs`, for `ConnCase`, auth header setup, and the env var that holds the token — `SYMPHONY_TRACKER_TOKEN`).

```elixir
defmodule SymphonyElixirWeb.Tracker.ObservabilityControllerTest do
  use SymphonyElixirWeb.ConnCase, async: false

  alias SymphonyElixir.Observability.Registry

  @token "test-token"

  setup do
    System.put_env("SYMPHONY_TRACKER_TOKEN", @token)
    on_exit(fn -> System.delete_env("SYMPHONY_TRACKER_TOKEN") end)
    :ok
  end

  defp auth(conn), do: Plug.Conn.put_req_header(conn, "authorization", "Bearer #{@token}")

  defp valid_report do
    %{
      "runtime_id" => "r1",
      "label" => "proj",
      "project_slug" => "proj",
      "tracker_kind" => "local",
      "agent_kind" => "codex",
      "source_url" => "http://localhost:4001",
      "snapshot" => %{
        "generated_at" => "2026-05-30T00:00:00Z",
        "counts" => %{"running" => 0, "retrying" => 0},
        "running" => [],
        "retrying" => [],
        "agent_totals" => %{"input_tokens" => 0, "output_tokens" => 0, "total_tokens" => 0, "seconds_running" => 0},
        "rate_limits" => nil
      }
    }
  end

  test "rejects unauthenticated report", %{conn: conn} do
    conn = post(conn, "/api/tracker/v1/observability/report", valid_report())
    assert json_response(conn, 401)
  end

  test "accepts a valid report and stores it", %{conn: conn} do
    conn = conn |> auth() |> post("/api/tracker/v1/observability/report", valid_report())
    assert response(conn, 202)
    assert Enum.any?(Registry.list(), &(&1.runtime_id == "r1"))
  end

  test "rejects a report missing runtime_id with 422", %{conn: conn} do
    body = Map.delete(valid_report(), "runtime_id")
    conn = conn |> auth() |> post("/api/tracker/v1/observability/report", body)
    assert json_response(conn, 422)["error"]["code"] == "invalid_report"
  end

  test "index returns the aggregate", %{conn: conn} do
    Registry.put_report(valid_report())
    conn = conn |> auth() |> get("/api/tracker/v1/observability")
    data = json_response(conn, 200)["data"]
    assert Enum.any?(data, &(&1["runtime_id"] == "r1"))
  end
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/observability_controller_test.exs`
Expected: FAIL — route/controller not found (404 / `UndefinedFunctionError`).

- [ ] **Step 3: Implement the controller**

```elixir
defmodule SymphonyElixirWeb.Tracker.ObservabilityController do
  @moduledoc "JSON API for the global observability aggregate (hub side)."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Observability.Registry

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, _params) do
    json(conn, %{data: Registry.list()})
  end

  @spec report(Conn.t(), map()) :: Conn.t()
  def report(conn, params) do
    case Registry.put_report(params) do
      :ok ->
        conn |> put_status(202) |> json(%{data: %{accepted: true}})

      {:error, :missing_runtime_id} ->
        conn
        |> put_status(422)
        |> json(%{error: %{code: "invalid_report", message: "runtime_id is required"}})
    end
  end
end
```

- [ ] **Step 4: Add the routes**

In `router.ex`, inside the `scope "/api/tracker/v1", SymphonyElixirWeb.Tracker do` block (after the `get("/viewer", ...)` line is fine):

```elixir
    get("/observability", ObservabilityController, :index)
    post("/observability/report", ObservabilityController, :report)
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/observability_controller_test.exs`
Expected: PASS.

> Note: the controller receives the full JSON body as `params` (string keys). `Registry.put_report/1` reads string keys, so no extra parsing is needed.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/observability_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/test/symphony_elixir_web/controllers/tracker/observability_controller_test.exs
git commit -m "feat(observability): add hub report/index JSON API"
```

---

## Task 5: ObservabilityChannel (observability:global)

**Files:**
- Create: `elixir/lib/symphony_elixir_web/channels/observability_channel.ex`
- Modify: `elixir/lib/symphony_elixir_web/channels/user_socket.ex:9-10`
- Test: `elixir/test/symphony_elixir_web/channels/observability_channel_test.exs`

- [ ] **Step 1: Write failing test**

Use Phoenix's `ChannelCase` (check the repo for `SymphonyElixirWeb.ChannelCase`; if absent, build the socket with `Phoenix.ChannelTest` like other channel tests in the repo).

```elixir
defmodule SymphonyElixirWeb.ObservabilityChannelTest do
  use SymphonyElixirWeb.ChannelCase, async: false

  alias SymphonyElixir.Observability.Registry
  alias SymphonyElixirWeb.UserSocket

  setup do
    {:ok, _, socket} =
      UserSocket
      |> socket("user", %{tracker_token_valid: true})
      |> subscribe_and_join(SymphonyElixirWeb.ObservabilityChannel, "observability:global")

    %{socket: socket}
  end

  test "pushes runtime_updated when a report arrives", %{socket: _socket} do
    Registry.put_report(%{
      "runtime_id" => "r1",
      "snapshot" => %{"counts" => %{"running" => 0, "retrying" => 0}, "running" => [], "retrying" => [], "agent_totals" => %{}, "rate_limits" => nil}
    })

    assert_push "runtime_updated", %{runtime_id: "r1"}
  end
end
```

> If joining requires the `tracker_token_valid` assign differently, mirror the existing `TrackerChannel` test setup. Authorization mirrors `TrackerChannel.authorized?/1`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/observability_channel_test.exs`
Expected: FAIL — `ObservabilityChannel` undefined.

- [ ] **Step 3: Implement the channel**

```elixir
defmodule SymphonyElixirWeb.ObservabilityChannel do
  @moduledoc "Global observability channel: pushes runtime updates to tracker clients."

  use Phoenix.Channel

  alias Phoenix.Socket
  alias SymphonyElixir.Config
  alias SymphonyElixirWeb.TrackerAuth

  @impl true
  def join("observability:global", _payload, socket) do
    if authorized?(socket) do
      {:ok, %{}, socket}
    else
      {:error, %{reason: "unauthorized"}}
    end
  end

  def join(_topic, _payload, _socket), do: {:error, %{reason: "invalid_topic"}}

  @impl true
  def handle_info({:observability_event, event_name, payload}, socket) do
    push(socket, event_name, payload)
    {:noreply, socket}
  end

  defp authorized?(%Socket{assigns: %{tracker_token_valid: true}}), do: true

  defp authorized?(%Socket{assigns: %{token: token}}) when is_binary(token) do
    TrackerAuth.valid_token?(token, System.get_env(Config.local_api_token_env()))
  end

  defp authorized?(_socket), do: false
end
```

- [ ] **Step 4: Register the channel**

In `user_socket.ex`, after the existing `channel(...)` lines:

```elixir
  channel("observability:global", SymphonyElixirWeb.ObservabilityChannel)
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/observability_channel_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/channels/observability_channel.ex elixir/lib/symphony_elixir_web/channels/user_socket.ex elixir/test/symphony_elixir_web/channels/observability_channel_test.exs
git commit -m "feat(observability): add observability:global channel"
```

---

## Task 6: Observability.Reporter (worker-side, event-driven + heartbeat)

**Files:**
- Create: `elixir/lib/symphony_elixir/observability/reporter.ex`
- Modify: `elixir/lib/symphony_elixir.ex` (supervise after `Orchestrator`)
- Test: `elixir/test/symphony_elixir/observability/reporter_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.Observability.ReporterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Observability.Reporter
  alias SymphonyElixirWeb.ObservabilityPubSub

  setup do
    start_supervised!({Phoenix.PubSub, name: SymphonyElixir.PubSub})
    test_pid = self()

    deliver = fn report ->
      send(test_pid, {:reported, report})
      :ok
    end

    %{deliver: deliver}
  end

  defp opts(deliver, extra \\ []) do
    Keyword.merge(
      [
        name: :"reporter_#{System.unique_integer([:positive])}",
        deliver_fun: deliver,
        snapshot_fun: fn -> %{counts: %{running: 0, retrying: 0}, running: [], retrying: []} end,
        identity_fun: fn -> %{"runtime_id" => "r1", "label" => "proj"} end,
        heartbeat_interval_ms: 30,
        min_report_interval_ms: 5
      ],
      extra
    )
  end

  test "reports on heartbeat", %{deliver: deliver} do
    start_supervised!({Reporter, opts(deliver)})
    assert_receive {:reported, %{"runtime_id" => "r1", "snapshot" => _}}, 500
  end

  test "reports immediately on observability_updated", %{deliver: deliver} do
    start_supervised!({Reporter, opts(deliver, heartbeat_interval_ms: 10_000)})
    # drain any initial heartbeat
    receive do
      {:reported, _} -> :ok
    after
      200 -> :ok
    end

    ObservabilityPubSub.broadcast_update()
    assert_receive {:reported, %{"runtime_id" => "r1"}}, 500
  end

  test "coalesces bursts within min_report_interval_ms", %{deliver: deliver} do
    start_supervised!({Reporter, opts(deliver, heartbeat_interval_ms: 10_000, min_report_interval_ms: 200)})
    receive do
      {:reported, _} -> :ok
    after
      200 -> :ok
    end

    for _ <- 1..5, do: ObservabilityPubSub.broadcast_update()

    assert_receive {:reported, _}, 500
    refute_receive {:reported, _}, 100
  end
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/observability/reporter_test.exs`
Expected: FAIL — `Reporter` undefined.

- [ ] **Step 3: Implement the Reporter**

```elixir
defmodule SymphonyElixir.Observability.Reporter do
  @moduledoc """
  Worker-side reporter. Subscribes to observability updates and pushes the local
  orchestrator snapshot to the hub: immediately on change (coalesced) and on a
  heartbeat interval for liveness. Delivery is in-process when no `hub_url` is
  configured (the hub reports to itself), otherwise an HTTP `POST` to the hub.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.Config
  alias SymphonyElixir.Observability.Registry
  alias SymphonyElixirWeb.{ObservabilityPubSub, Presenter}

  @snapshot_timeout_ms 15_000

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @impl true
  def init(opts) do
    state = %{
      deliver_fun: Keyword.get(opts, :deliver_fun) || default_deliver_fun(),
      snapshot_fun: Keyword.get(opts, :snapshot_fun) || (&default_snapshot/0),
      identity_fun: Keyword.get(opts, :identity_fun) || (&default_identity/0),
      heartbeat_interval_ms: Keyword.get(opts, :heartbeat_interval_ms) || Config.observability_heartbeat_interval_ms(),
      min_report_interval_ms: Keyword.get(opts, :min_report_interval_ms) || Config.observability_min_report_interval_ms(),
      last_report_ms: nil,
      pending?: false
    }

    ObservabilityPubSub.subscribe()
    schedule_heartbeat(state)
    {:ok, state}
  end

  @impl true
  def handle_info(:observability_updated, state) do
    {:noreply, maybe_report(state)}
  end

  @impl true
  def handle_info(:heartbeat, state) do
    schedule_heartbeat(state)
    {:noreply, do_report(state)}
  end

  @impl true
  def handle_info(:flush_pending, %{pending?: true} = state) do
    {:noreply, do_report(%{state | pending?: false})}
  end

  def handle_info(:flush_pending, state), do: {:noreply, state}

  defp maybe_report(state) do
    now = System.monotonic_time(:millisecond)

    cond do
      is_nil(state.last_report_ms) -> do_report(state)
      now - state.last_report_ms >= state.min_report_interval_ms -> do_report(state)
      state.pending? -> state
      true ->
        delay = state.min_report_interval_ms - (now - state.last_report_ms)
        Process.send_after(self(), :flush_pending, max(delay, 0))
        %{state | pending?: true}
    end
  end

  defp do_report(state) do
    report = Map.put(state.identity_fun.(), "snapshot", state.snapshot_fun.())

    case state.deliver_fun.(report) do
      :ok -> :ok
      {:error, reason} -> Logger.warning("observability report failed: #{inspect(reason)}")
      other -> Logger.warning("observability report unexpected result: #{inspect(other)}")
    end

    %{state | last_report_ms: System.monotonic_time(:millisecond), pending?: false}
  end

  defp schedule_heartbeat(state), do: Process.send_after(self(), :heartbeat, state.heartbeat_interval_ms)

  defp default_snapshot do
    Presenter.state_payload(SymphonyElixir.Orchestrator, @snapshot_timeout_ms)
  end

  defp default_identity do
    %{
      "runtime_id" => Config.observability_runtime_id(),
      "label" => Config.observability_label() || Path.basename(SymphonyElixir.Workflow.workflow_file_path()),
      "project_slug" => Config.local_project_slug(),
      "tracker_kind" => Config.tracker_kind(),
      "agent_kind" => Config.agent_kind(),
      "source_url" => source_url()
    }
  end

  defp source_url do
    case {Config.server_host(), Config.server_port()} do
      {host, port} when is_binary(host) and is_integer(port) and port > 0 -> "http://#{host}:#{port}"
      _ -> nil
    end
  end

  defp default_deliver_fun do
    case Config.observability_hub_url() do
      url when is_binary(url) and url != "" -> &deliver_http(&1, url)
      _ -> &deliver_local/1
    end
  end

  defp deliver_local(report) do
    Registry.put_report(report)
  end

  defp deliver_http(report, hub_url) do
    token = System.get_env(Config.local_api_token_env())
    url = String.trim_trailing(hub_url, "/") <> "/api/tracker/v1/observability/report"

    case Req.post(url, json: report, headers: [{"authorization", "Bearer #{token}"}], retry: false) do
      {:ok, %Req.Response{status: status}} when status in 200..299 -> :ok
      {:ok, %Req.Response{status: status}} -> {:error, {:http_status, status}}
      {:error, reason} -> {:error, reason}
    end
  end
end
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/observability/reporter_test.exs`
Expected: PASS.

- [ ] **Step 5: Supervise the Reporter**

In `elixir/lib/symphony_elixir.ex`, add `SymphonyElixir.Observability.Reporter` to `children` **after** `SymphonyElixir.Orchestrator` (it reports the orchestrator's snapshot) and after `SymphonyElixir.HttpServer` is fine too:

```elixir
      SymphonyElixir.Orchestrator,
      SymphonyElixir.Observability.Reporter,
      SymphonyElixir.HttpServer,
      SymphonyElixir.StatusDashboard
```

- [ ] **Step 6: Run the focused app boot test**

Run: `cd elixir && mix test test/symphony_elixir/observability/registry_supervision_test.exs`
Expected: PASS (app still boots with the Reporter child).

- [ ] **Step 7: Commit**

```bash
git add elixir/lib/symphony_elixir/observability/reporter.ex elixir/lib/symphony_elixir.ex elixir/test/symphony_elixir/observability/reporter_test.exs
git commit -m "feat(observability): add worker reporter (event-driven + heartbeat)"
```

---

## Task 7: Retire the `/` LiveView, redirect to `/tracker`

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/router.ex:31-35,78-88`
- Delete: `elixir/lib/symphony_elixir_web/live/dashboard_live.ex` (+ its test if present)
- Test: `elixir/test/symphony_elixir_web/root_redirect_test.exs`

- [ ] **Step 1: Write failing test**

```elixir
defmodule SymphonyElixirWeb.RootRedirectTest do
  use SymphonyElixirWeb.ConnCase, async: true

  test "GET / redirects to /tracker", %{conn: conn} do
    conn = get(conn, "/")
    assert redirected_to(conn, 302) == "/tracker"
  end
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/root_redirect_test.exs`
Expected: FAIL — `/` currently mounts the LiveView (200, not 302).

- [ ] **Step 3: Replace the LiveView route with a redirect**

In `router.ex`, replace the `scope "/", SymphonyElixirWeb do pipe_through(:browser) live("/", DashboardLive, :index) end` block (lines ~31-35) with:

```elixir
  scope "/", SymphonyElixirWeb do
    pipe_through(:browser)

    get("/", RootRedirectController, :index)
  end
```

Create `elixir/lib/symphony_elixir_web/controllers/root_redirect_controller.ex`:

```elixir
defmodule SymphonyElixirWeb.RootRedirectController do
  @moduledoc "Redirects the root path to the tracker SPA."

  use Phoenix.Controller, formats: [:html]

  alias Plug.Conn

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, _params) do
    redirect(conn, to: "/tracker")
  end
end
```

Also remove the now-dead `match(:*, "/", ObservabilityApiController, :method_not_allowed)` line (~82) so the redirect owns `/`. Leave the other `/api/v1/*` routes intact.

> Remove `import Phoenix.LiveView.Router` from `router.ex` only if no other `live(...)` routes remain (there are none after this change) — otherwise leave it. Verify with a search before deleting.

- [ ] **Step 4: Delete the LiveView**

```bash
git rm elixir/lib/symphony_elixir_web/live/dashboard_live.ex
# remove its test too if one exists:
# git rm elixir/test/symphony_elixir_web/live/dashboard_live_test.exs
```

- [ ] **Step 5: Run tests + compile to catch references**

Run: `cd elixir && mix compile --warnings-as-errors && mix test test/symphony_elixir_web/root_redirect_test.exs`
Expected: PASS, no compile warnings about undefined `DashboardLive`.

> If compilation flags a leftover reference (e.g. `endpoint.ex`, `layouts.ex`, or a `live_session`), follow the warning and remove the dead reference. The dashboard CSS/vendor static routes (`router.ex:23-26`) can stay; the SPA does not need them but they are harmless. Removing them is optional cleanup, not required.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/router.ex elixir/lib/symphony_elixir_web/controllers/root_redirect_controller.ex elixir/test/symphony_elixir_web/root_redirect_test.exs
git commit -m "feat(observability): redirect / to /tracker and retire dashboard LiveView"
```

---

## Task 8: Frontend types

**Files:**
- Create: `tracker/src/types/observability.ts`
- Test: none (types only); validated by later tasks.

- [ ] **Step 1: Create the types file**

```typescript
export type RuntimeStatus = "online" | "stale";

export interface RuntimeTokens {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface RunningSession {
  issueIdentifier: string;
  state: string | null;
  sessionId: string | null;
  turnCount: number;
  lastEvent: string | null;
  lastMessage: string | null;
  startedAt: string | null;
  lastEventAt: string | null;
  tokens: RuntimeTokens;
}

export interface RetryEntry {
  issueIdentifier: string;
  attempt: number;
  dueAt: string | null;
  error: string | null;
}

export interface RuntimeObservability {
  runtimeId: string;
  label: string;
  projectSlug: string | null;
  trackerKind: string | null;
  agentKind: string | null;
  sourceUrl: string | null;
  status: RuntimeStatus;
  reportedAt: string;
  counts: { running: number; retrying: number };
  agentTotals: { inputTokens: number; outputTokens: number; totalTokens: number; secondsRunning: number };
  rateLimits: unknown | null;
  running: RunningSession[];
  retrying: RetryEntry[];
}

export interface GlobalRunningRow extends RunningSession {
  runtimeId: string;
  runtimeLabel: string;
  projectSlug: string | null;
}
```

- [ ] **Step 2: Type-check**

Run: `cd tracker && pnpm tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add tracker/src/types/observability.ts
git commit -m "feat(tracker): add observability domain types"
```

---

## Task 9: Frontend service + mapper

**Files:**
- Create: `tracker/src/services/observability.ts`
- Test: `tracker/src/services/observability.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, it } from "vitest";

import { normalizeRuntime } from "./observability";

describe("normalizeRuntime", () => {
  it("maps snake_case backend DTO to camelCase domain", () => {
    const runtime = normalizeRuntime({
      runtime_id: "r1",
      label: "proj",
      project_slug: "proj",
      tracker_kind: "local",
      agent_kind: "codex",
      source_url: "http://localhost:4001",
      status: "online",
      reported_at: "2026-05-30T00:00:00Z",
      counts: { running: 2, retrying: 1 },
      agent_totals: { input_tokens: 10, output_tokens: 20, total_tokens: 30, seconds_running: 5 },
      rate_limits: null,
      running: [
        {
          issue_identifier: "PROJ-1",
          state: "In Progress",
          session_id: "sess-1",
          turn_count: 3,
          last_event: "agent_message",
          last_message: "working",
          started_at: "2026-05-30T00:00:00Z",
          last_event_at: "2026-05-30T00:00:01Z",
          tokens: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        },
      ],
      retrying: [{ issue_identifier: "PROJ-2", attempt: 1, due_at: null, error: "boom" }],
    });

    expect(runtime.runtimeId).toBe("r1");
    expect(runtime.counts).toEqual({ running: 2, retrying: 1 });
    expect(runtime.agentTotals.totalTokens).toBe(30);
    expect(runtime.running[0]).toMatchObject({ issueIdentifier: "PROJ-1", turnCount: 3 });
    expect(runtime.running[0].tokens).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3 });
    expect(runtime.retrying[0]).toEqual({ issueIdentifier: "PROJ-2", attempt: 1, dueAt: null, error: "boom" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tracker && pnpm vitest run src/services/observability.test.ts`
Expected: FAIL — cannot import `normalizeRuntime`.

- [ ] **Step 3: Implement the service**

```typescript
import type {
  RetryEntry,
  RunningSession,
  RuntimeObservability,
  RuntimeStatus,
} from "@/types/observability";

import { http, trackerPath, unwrapData } from "./http";

interface BackendTokensDto {
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
}

interface BackendRunningDto {
  issue_identifier?: string | null;
  state?: string | null;
  session_id?: string | null;
  turn_count?: number | null;
  last_event?: string | null;
  last_message?: string | null;
  started_at?: string | null;
  last_event_at?: string | null;
  tokens?: BackendTokensDto | null;
}

interface BackendRetryDto {
  issue_identifier?: string | null;
  attempt?: number | null;
  due_at?: string | null;
  error?: string | null;
}

export interface BackendRuntimeDto {
  runtime_id?: string | null;
  label?: string | null;
  project_slug?: string | null;
  tracker_kind?: string | null;
  agent_kind?: string | null;
  source_url?: string | null;
  status?: string | null;
  reported_at?: string | null;
  counts?: { running?: number | null; retrying?: number | null } | null;
  agent_totals?: { input_tokens?: number | null; output_tokens?: number | null; total_tokens?: number | null; seconds_running?: number | null } | null;
  rate_limits?: unknown | null;
  running?: BackendRunningDto[] | null;
  retrying?: BackendRetryDto[] | null;
}

function normalizeStatus(status: string | null | undefined): RuntimeStatus {
  return status === "stale" ? "stale" : "online";
}

function normalizeRunning(dto: BackendRunningDto): RunningSession {
  return {
    issueIdentifier: dto.issue_identifier ?? "",
    state: dto.state ?? null,
    sessionId: dto.session_id ?? null,
    turnCount: dto.turn_count ?? 0,
    lastEvent: dto.last_event ?? null,
    lastMessage: dto.last_message ?? null,
    startedAt: dto.started_at ?? null,
    lastEventAt: dto.last_event_at ?? null,
    tokens: {
      inputTokens: dto.tokens?.input_tokens ?? 0,
      outputTokens: dto.tokens?.output_tokens ?? 0,
      totalTokens: dto.tokens?.total_tokens ?? 0,
    },
  };
}

function normalizeRetry(dto: BackendRetryDto): RetryEntry {
  return {
    issueIdentifier: dto.issue_identifier ?? "",
    attempt: dto.attempt ?? 0,
    dueAt: dto.due_at ?? null,
    error: dto.error ?? null,
  };
}

export function normalizeRuntime(dto: BackendRuntimeDto): RuntimeObservability {
  return {
    runtimeId: dto.runtime_id ?? "",
    label: dto.label ?? dto.project_slug ?? dto.runtime_id ?? "unknown",
    projectSlug: dto.project_slug ?? null,
    trackerKind: dto.tracker_kind ?? null,
    agentKind: dto.agent_kind ?? null,
    sourceUrl: dto.source_url ?? null,
    status: normalizeStatus(dto.status),
    reportedAt: dto.reported_at ?? "",
    counts: { running: dto.counts?.running ?? 0, retrying: dto.counts?.retrying ?? 0 },
    agentTotals: {
      inputTokens: dto.agent_totals?.input_tokens ?? 0,
      outputTokens: dto.agent_totals?.output_tokens ?? 0,
      totalTokens: dto.agent_totals?.total_tokens ?? 0,
      secondsRunning: dto.agent_totals?.seconds_running ?? 0,
    },
    rateLimits: dto.rate_limits ?? null,
    running: (dto.running ?? []).map(normalizeRunning),
    retrying: (dto.retrying ?? []).map(normalizeRetry),
  };
}

export async function listObservability(): Promise<RuntimeObservability[]> {
  const response = await http.get(trackerPath("/observability"));
  return unwrapData<BackendRuntimeDto[]>(response).map(normalizeRuntime);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tracker && pnpm vitest run src/services/observability.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/services/observability.ts tracker/src/services/observability.test.ts
git commit -m "feat(tracker): add observability service + DTO normalization"
```

---

## Task 10: Phoenix channel binding + useObservability hook

**Files:**
- Create: `tracker/src/services/phoenix/observabilityChannel.ts`
- Create: `tracker/src/hooks/useObservability.ts`
- Test: `tracker/src/services/phoenix/observabilityChannel.test.ts`

- [ ] **Step 1: Write failing test for the channel binding**

```typescript
import { describe, expect, it, vi } from "vitest";

import { bindObservabilityEvents, OBSERVABILITY_TOPIC } from "./observabilityChannel";

describe("observability channel binding", () => {
  it("binds runtime_updated and runtime_removed", () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const channel = { on: (event: string, cb: (payload: unknown) => void) => (handlers[event] = cb) } as never;

    const onUpdated = vi.fn();
    const onRemoved = vi.fn();
    bindObservabilityEvents(channel, { onUpdated, onRemoved });

    handlers["runtime_updated"]({ runtime_id: "r1", label: "proj", counts: { running: 0, retrying: 0 } });
    handlers["runtime_removed"]({ runtime_id: "r1" });

    expect(OBSERVABILITY_TOPIC).toBe("observability:global");
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ runtimeId: "r1" }));
    expect(onRemoved).toHaveBeenCalledWith("r1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tracker && pnpm vitest run src/services/phoenix/observabilityChannel.test.ts`
Expected: FAIL — cannot import module.

- [ ] **Step 3: Implement the channel binding**

```typescript
import type { Channel } from "phoenix";

import { normalizeRuntime, type BackendRuntimeDto } from "@/services/observability";
import type { RuntimeObservability } from "@/types/observability";

export const OBSERVABILITY_TOPIC = "observability:global";

export interface ObservabilityHandlers {
  onUpdated: (runtime: RuntimeObservability) => void;
  onRemoved: (runtimeId: string) => void;
}

export function bindObservabilityEvents(channel: Channel, handlers: ObservabilityHandlers): void {
  channel.on("runtime_updated", (payload) => {
    handlers.onUpdated(normalizeRuntime(payload as BackendRuntimeDto));
  });
  channel.on("runtime_removed", (payload) => {
    const runtimeId = (payload as { runtime_id?: string }).runtime_id;
    if (runtimeId) handlers.onRemoved(runtimeId);
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tracker && pnpm vitest run src/services/phoenix/observabilityChannel.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the hook (no separate test; exercised in the page test)**

```typescript
import { useEffect, useRef, useState } from "react";

import { listObservability } from "@/services/observability";
import { bindObservabilityEvents, OBSERVABILITY_TOPIC } from "@/services/phoenix/observabilityChannel";
import { createTrackerSocket } from "@/services/phoenix/socket";
import type { RuntimeObservability } from "@/types/observability";

interface UseObservabilityResult {
  runtimes: RuntimeObservability[];
  loading: boolean;
}

export function useObservability(): UseObservabilityResult {
  const [runtimes, setRuntimes] = useState<RuntimeObservability[]>([]);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    void listObservability()
      .then((items) => {
        if (active && requestId === requestIdRef.current) setRuntimes(items);
      })
      .finally(() => {
        if (active && requestId === requestIdRef.current) setLoading(false);
      });

    const socket = createTrackerSocket();
    socket.connect();
    const channel = socket.channel(OBSERVABILITY_TOPIC);

    bindObservabilityEvents(channel, {
      onUpdated: (runtime) =>
        setRuntimes((current) => {
          const next = current.filter((entry) => entry.runtimeId !== runtime.runtimeId);
          next.push(runtime);
          return next;
        }),
      onRemoved: (runtimeId) =>
        setRuntimes((current) => current.filter((entry) => entry.runtimeId !== runtimeId)),
    });

    channel.join().receive("error", (reason) => console.error("observability channel join failed", reason));

    return () => {
      active = false;
      channel.leave();
      socket.disconnect();
    };
  }, []);

  return { runtimes, loading };
}
```

- [ ] **Step 6: Commit**

```bash
git add tracker/src/services/phoenix/observabilityChannel.ts tracker/src/services/phoenix/observabilityChannel.test.ts tracker/src/hooks/useObservability.ts
git commit -m "feat(tracker): add observability channel binding and realtime hook"
```

---

## Task 11: ObservabilityPage (cards + global table + 1s tick)

**Files:**
- Create: `tracker/src/pages/ObservabilityPage.tsx`
- Test: `tracker/src/pages/ObservabilityPage.test.tsx`

- [ ] **Step 1: Write failing test**

Mock the hook so the test is deterministic.

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ObservabilityPage } from "./ObservabilityPage";
import type { RuntimeObservability } from "@/types/observability";

const runtime: RuntimeObservability = {
  runtimeId: "r1",
  label: "macro-markets",
  projectSlug: "macro-markets",
  trackerKind: "local",
  agentKind: "codex",
  sourceUrl: "http://localhost:4001",
  status: "online",
  reportedAt: new Date().toISOString(),
  counts: { running: 1, retrying: 0 },
  agentTotals: { inputTokens: 1, outputTokens: 2, totalTokens: 3, secondsRunning: 0 },
  rateLimits: null,
  running: [
    {
      issueIdentifier: "MM-1",
      state: "In Progress",
      sessionId: "sess-1",
      turnCount: 2,
      lastEvent: "agent_message",
      lastMessage: "working",
      startedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
      tokens: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    },
  ],
  retrying: [],
};

vi.mock("@/hooks/useObservability", () => ({
  useObservability: () => ({ runtimes: [runtime], loading: false }),
}));

describe("ObservabilityPage", () => {
  it("renders a runtime card and the global sessions table row", () => {
    render(<ObservabilityPage />);
    expect(screen.getByText("macro-markets")).toBeInTheDocument();
    expect(screen.getByText("MM-1")).toBeInTheDocument();
    expect(screen.getByText(/online/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tracker && pnpm vitest run src/pages/ObservabilityPage.test.tsx`
Expected: FAIL — cannot import `ObservabilityPage`.

- [ ] **Step 3: Implement the page**

```tsx
import { useEffect, useMemo, useState } from "react";

import { useObservability } from "@/hooks/useObservability";
import type { GlobalRunningRow, RuntimeObservability } from "@/types/observability";

function formatRuntime(startedAt: string | null, nowMs: number): string {
  if (!startedAt) return "--";
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return "--";
  const seconds = Math.max(Math.floor((nowMs - started) / 1000), 0);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function flattenRows(runtimes: RuntimeObservability[]): GlobalRunningRow[] {
  return runtimes.flatMap((runtime) =>
    runtime.running.map((session) => ({
      ...session,
      runtimeId: runtime.runtimeId,
      runtimeLabel: runtime.label,
      projectSlug: runtime.projectSlug,
    })),
  );
}

export function ObservabilityPage() {
  const { runtimes, loading } = useObservability();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const rows = useMemo(() => flattenRows(runtimes), [runtimes]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Observability</h1>
        <p className="text-sm text-muted-foreground">Live runtime state across all reporting Symphony processes.</p>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading runtimes…</p> : null}
      {!loading && runtimes.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No runtimes are reporting yet.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {runtimes.map((runtime) => (
          <article key={runtime.runtimeId} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="truncate font-medium">{runtime.label}</h2>
              <span
                className={
                  runtime.status === "online"
                    ? "rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-600"
                    : "rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600"
                }
              >
                {runtime.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {runtime.trackerKind ?? "?"} · {runtime.agentKind ?? "?"}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Running</dt>
                <dd className="font-medium tabular-nums">{runtime.counts.running}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Retrying</dt>
                <dd className="font-medium tabular-nums">{runtime.counts.retrying}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Total tokens</dt>
                <dd className="font-medium tabular-nums">{runtime.agentTotals.totalTokens.toLocaleString()}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      <section className="rounded-lg border">
        <div className="border-b p-3">
          <h2 className="font-medium">Running sessions</h2>
          <p className="text-xs text-muted-foreground">All active sessions across runtimes.</p>
        </div>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No active sessions.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="p-2">Project</th>
                  <th className="p-2">Issue</th>
                  <th className="p-2">State</th>
                  <th className="p-2">Runtime / turns</th>
                  <th className="p-2">Agent update</th>
                  <th className="p-2">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.runtimeId}:${row.issueIdentifier}`} className="border-t">
                    <td className="p-2">{row.runtimeLabel}</td>
                    <td className="p-2 font-medium">{row.issueIdentifier}</td>
                    <td className="p-2">{row.state ?? "--"}</td>
                    <td className="p-2 tabular-nums">
                      {formatRuntime(row.startedAt, nowMs)}
                      {row.turnCount > 0 ? ` / ${row.turnCount}` : ""}
                    </td>
                    <td className="p-2">{row.lastMessage ?? row.lastEvent ?? "--"}</td>
                    <td className="p-2 tabular-nums">{row.tokens.totalTokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tracker && pnpm vitest run src/pages/ObservabilityPage.test.tsx`
Expected: PASS.

> If the repo's Vitest setup lacks `@testing-library/jest-dom` matchers (`toBeInTheDocument`), use `screen.getByText(...)` assertions with `expect(...).toBeTruthy()` instead — match the assertion style used by existing page tests in `tracker/src`.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/pages/ObservabilityPage.tsx tracker/src/pages/ObservabilityPage.test.tsx
git commit -m "feat(tracker): add global observability page with runtime cards and sessions table"
```

---

## Task 12: Wire route + sidebar nav

**Files:**
- Modify: `tracker/src/App.tsx:14-20,64-65`
- Modify: `tracker/src/components/layout/ProjectSidebar.tsx:1,70-81`
- Test: `tracker/src/App.test.tsx` (route smoke) — optional if an App test harness exists; otherwise rely on manual verification step.

- [ ] **Step 1: Add the route in `App.tsx`**

Add the import alongside the other page imports:

```tsx
import { ObservabilityPage } from "@/pages/ObservabilityPage";
```

Add the route inside the `<Route path="/" element={<Layout />}>` block, as a sibling of `templates`:

```tsx
            <Route path="observability" element={<ObservabilityPage />} />
```

- [ ] **Step 2: Add the sidebar nav item**

In `ProjectSidebar.tsx`, add `Activity` to the lucide import on line 1:

```tsx
import { Activity, FolderKanban, KeyRound, LayoutTemplate, ListTodo } from "lucide-react";
```

Add a `NavLink` after the Templates link (after line ~81):

```tsx
      <NavLink
        to="/observability"
        className={({ isActive }) =>
          cn(
            "mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
            isActive && "bg-accent text-foreground",
          )
        }
      >
        <Activity className="h-4 w-4" />
        Observability
      </NavLink>
```

- [ ] **Step 3: Type-check + run the full frontend test suite**

Run: `cd tracker && pnpm tsc --noEmit && pnpm vitest run`
Expected: PASS (all suites).

- [ ] **Step 4: Manual verification**

Run: `cd elixir && make serve` (port 4000), then in another shell `cd tracker && pnpm dev`.
- Open the dev URL → confirm `/` redirects to `/tracker`.
- Click "Observability" → page loads; the hub's own runtime appears as a card (in-process self-register) with status `online`.
- Start an issue so a session becomes active → it appears in the global table and the runtime clock ticks each second.
Expected: card + table populate; status flips to `stale` if you stop the orchestrator for ~3 heartbeats.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/App.tsx tracker/src/components/layout/ProjectSidebar.tsx
git commit -m "feat(tracker): route and sidebar entry for global observability"
```

---

## Task 13: Full quality gates + docs

**Files:**
- Modify: `elixir/README.md`, `elixir/WORKFLOW.macromarkets.example.md`, root `README.md` (per `AGENTS.md` docs policy)

- [ ] **Step 1: Document the `observability` hub config**

In `elixir/WORKFLOW.macromarkets.example.md`, add a commented block near the existing config:

```yaml
# observability:
#   hub_url: http://localhost:4000      # omit on the hub process itself
#   heartbeat_interval_ms: 5000
#   min_report_interval_ms: 250
#   label: macro-markets
```

Add a short "Global observability" subsection to `elixir/README.md` describing the hub model, the `/api/tracker/v1/observability` endpoints, and the `/tracker/observability` page. Update root `README.md` if it lists product surfaces (mention `/` now redirects to the tracker).

- [ ] **Step 2: Run backend gates**

Run: `cd elixir && mix specs.check && mix format --check-formatted && mix test`
Expected: PASS. Fix any `@spec`/format issues before proceeding.

- [ ] **Step 3: Run frontend gates**

Run: `cd tracker && pnpm tsc --noEmit && pnpm vitest run && pnpm lint`
Expected: PASS. (Use the repo's actual lint script if different.)

- [ ] **Step 4: Commit**

```bash
git add elixir/README.md elixir/WORKFLOW.macromarkets.example.md README.md
git commit -m "docs(observability): document global observability hub"
```

---

## Self-review

**Spec coverage:**
- Single global URL aggregating many runtimes → Tasks 2, 4, 12.
- Aggregate inside the tracker SPA → Tasks 8–12.
- No hub change when adding/removing a project process → Task 6 (workers configured with `hub_url`); hub passively receives.
- Offline worker reflected (stale/removed) → Task 2 (staleness sweep) + Task 11 (badge).
- Reuse bearer auth + Phoenix channels; volatile state out of SQLite → Tasks 4, 5 (auth/channel), Task 2 (ETS only).
- Realtime feel: near-instant on change + per-second tick → Task 6 (event-driven push), Task 5/10 (channel), Task 11 (1s client tick).
- `/` → `/tracker`; old LiveView retired → Task 7.
- Config keys (`hub_url`, `heartbeat_interval_ms`, `min_report_interval_ms`, `runtime_id`, `label`) → Task 1.

**Placeholder scan:** No `TBD`/`TODO`; every code step has complete code and exact commands.

**Type consistency:** `runtime_id`/`runtimeId`, `RuntimeObservability`, `BackendRuntimeDto`, `OBSERVABILITY_TOPIC`, channel events `runtime_updated`/`runtime_removed`, and the report body shape are consistent across backend (Tasks 2,4,5,6) and frontend (Tasks 8,9,10,11). The Registry `{:observability_event, name, payload}` PubSub message matches the channel `handle_info` clause.

**Known follow-ups (out of scope, per spec):** time-series history/persistence; remote control actions; automatic worker discovery.
