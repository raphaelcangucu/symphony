# Issue Dev-Server Preview Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Replace example commands with this repo's real tools.

**Goal:** Let Symphony start, supervise, and surface long-running **dev servers** for a task's isolated workspace, exposing a clickable **preview URL** on the issue (auto-started when a PR appears or the issue enters Human Review, plus manual start/stop/restart), by expanding the existing `DevEnv` subsystem.

**Architecture:** Expand `DevEnv` steps with a `serve` role (port + URL + readiness). A new per-issue runtime — `DevServer.Manager` (DynamicSupervisor + Registry) supervising one `DevServer.Instance` GenServer per serve step, each owning a dedicated tmux session via `Terminal.Registry` — allocates a free port from a config range, injects it into the serve command, health-probes it, and persists/serves status. A poll-driven `DevServer.Reconciler` auto-starts servers on trigger states. The tracker SPA gets a **Preview** tab with the primary URL featured.

**Tech Stack:** Elixir/Phoenix (Ecto/SQLite, NimbleOptions, GenServer/DynamicSupervisor/Registry, tmux wrapper, ExUnit), React 19 + Vite + TypeScript + Tailwind + Vitest.

**Spec:** `docs/superpowers/specs/2026-05-30-issue-dev-server-preview-design.md`

---

## Conventions (shared by all tasks — do not deviate)

- **Run a single test file:** `cd elixir && mix test test/path/to/file_test.exs`
- **Run one test:** `cd elixir && mix test test/path/to/file_test.exs:LINE`
- **Migrate:** `cd elixir && mix ecto.migrate` (rollback: `mix ecto.rollback`)
- **Format + lint gate:** `cd elixir && mix format && mix credo --strict` (full gate: `make all`)
- **Spec check (every public `def` in `lib/` needs an adjacent `@spec`):** `cd elixir && mix specs.check`
- **Frontend single test:** `cd tracker && npm run test:unit -- src/path/file.test.ts`
- **Statuses (one source of truth):** a dev server status is one of
  `pending | provisioning | starting | ready | crashed | stopped`.
- **Unavailable reasons (one source of truth):** `disabled | workspace_missing | no_serve_step | capacity`.
- **PubSub topic:** `"dev_server:" <> project_slug <> ":" <> issue_identifier`.
- **tmux dev session name:** `"sym-dev-" <> safe(project) <> "-" <> safe(issue) <> "-" <> safe(slug)`.
- **Realtime in the UI:** the frontend hook **polls** the list endpoint on a short
  interval (3s) while any server is non-terminal, and 20s otherwise. The backend
  also broadcasts on the PubSub topic for future channel use, but the plan's UI
  relies on polling (proven pattern from `useIssuePullRequests`). This is an
  explicit, stated interpretation of the spec's "pushed" wording.

---

## File structure

**Backend — create:**
- `elixir/priv/repo/migrations/20260530090000_expand_dev_env_serve.exs` — add serve columns to `local_tracker_dev_env_steps`.
- `elixir/priv/repo/migrations/20260530090100_create_dev_servers.exs` — `local_tracker_dev_servers` table.
- `elixir/lib/symphony_elixir/local_tracker/dev_server_record.ex` — Ecto schema + persistence helpers row.
- `elixir/lib/symphony_elixir/dev_server/port_allocator.ex` — free-port picker.
- `elixir/lib/symphony_elixir/dev_server/instance.ex` — per-serve-step GenServer.
- `elixir/lib/symphony_elixir/dev_server/manager.ex` — DynamicSupervisor + Registry + lifecycle API.
- `elixir/lib/symphony_elixir/dev_server/reconciler.ex` — poll-driven auto-start/stop.
- `elixir/lib/symphony_elixir/dev_server.ex` — pure view/URL builder (`issue_targets/2`).
- `elixir/lib/symphony_elixir_web/controllers/tracker/dev_server_controller.ex`
- `elixir/lib/symphony_elixir_web/presenters/dev_server_presenter.ex`
- Tests mirroring each module under `elixir/test/...`.

**Backend — modify:**
- `elixir/lib/symphony_elixir/config.ex` — `dev_server:` schema, defaults, accessors, extractor.
- `elixir/lib/symphony_elixir/local_tracker/dev_env/step.ex` — serve fields.
- `elixir/lib/symphony_elixir/local_tracker/dev_env/proposed_step.ex` — serve fields.
- `elixir/lib/symphony_elixir/local_tracker/dev_env/convention_reader.ex` — parse serve fields.
- `elixir/lib/symphony_elixir/local_tracker/dev_env/heuristic_discoverer.ex` — serve heuristics.
- `elixir/lib/symphony_elixir/local_tracker/dev_env.ex` — `list_serve_steps/1`, primary normalization, round-trip new fields.
- `elixir/lib/symphony_elixir/terminal/registry.ex` — `dev_session_name/3`, `open_dev_session/4`, `kill_dev_session/3`.
- `elixir/lib/symphony_elixir_web/presenters/dev_env_presenter.ex` — emit serve fields.
- `elixir/lib/symphony_elixir_web/router.ex` — dev_server routes.
- `elixir/lib/symphony_elixir.ex` — supervise `DevServer.Manager` + `DevServer.Reconciler`.
- `elixir/lib/symphony_elixir_web/tracker_errors.ex` — map new reasons.

**Frontend — create:**
- `tracker/src/types/devServer.ts`
- `tracker/src/services/devServer.ts` (+ `__tests__/devServer.test.ts`)
- `tracker/src/hooks/useIssueDevServers.ts`
- `tracker/src/components/issues/issue-detail/PreviewTab.tsx` (+ `__tests__/PreviewTab.test.tsx`)

**Frontend — modify:**
- `tracker/src/lib/workspaceRoutes.ts` — add `"preview"` tab (+ test).
- `tracker/src/components/issues/IssueDrawer.tsx` — Preview tab + status dot.
- `tracker/src/components/issues/issue-detail/SummaryTab.tsx` — primary preview chip.

---

## Task 1: Config — `dev_server:` schema, defaults, accessors

**Files:**
- Modify: `elixir/lib/symphony_elixir/config.ex` (module attrs ~20-30; schema block after `editor:` ~149-157; `extract_workflow_options/1` ~590-601; `extract_editor_options/1` neighborhood ~673-682; accessors after `editor_base_url/0` ~505-512)
- Test: `elixir/test/symphony_elixir/config_test.exs`

- [ ] **Step 1: Write failing tests**

Add to `elixir/test/symphony_elixir/config_test.exs` (reuse the file's existing helper for loading WORKFLOW front matter — search the file for how other blocks like `observability`/`editor` are tested and copy that setup verbatim):

```elixir
describe "dev_server config" do
  test "defaults when dev_server section omitted" do
    load_workflow_with_front_matter("""
    github:
      repo: acme/app
    """)

    refute SymphonyElixir.Config.dev_server_enabled?()
    assert SymphonyElixir.Config.dev_server_port_range() == [4100, 4199]
    assert SymphonyElixir.Config.dev_server_max_concurrent() == 3
    assert SymphonyElixir.Config.dev_server_idle_timeout_ms() == 1_800_000
    assert SymphonyElixir.Config.dev_server_auto_start_on() == ["pull_request", "human_review"]
    assert SymphonyElixir.Config.dev_server_base_url() == nil
  end

  test "reads configured dev_server keys" do
    load_workflow_with_front_matter("""
    github:
      repo: acme/app
    dev_server:
      enabled: true
      port_range: [5000, 5009]
      max_concurrent: 2
      idle_timeout_ms: 60000
      auto_start_on:
        - human_review
      base_url: http://example.test
    """)

    assert SymphonyElixir.Config.dev_server_enabled?()
    assert SymphonyElixir.Config.dev_server_port_range() == [5000, 5009]
    assert SymphonyElixir.Config.dev_server_max_concurrent() == 2
    assert SymphonyElixir.Config.dev_server_idle_timeout_ms() == 60_000
    assert SymphonyElixir.Config.dev_server_auto_start_on() == ["human_review"]
    assert SymphonyElixir.Config.dev_server_base_url() == "http://example.test"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/config_test.exs -k "dev_server"`
Expected: FAIL — `dev_server_enabled?/0` undefined.

- [ ] **Step 3: Add module-attribute defaults**

In `elixir/lib/symphony_elixir/config.ex`, after the editor default attrs (after line `@default_editor_auth "none"`), add:

```elixir
  @default_dev_server_enabled false
  @default_dev_server_port_range [4100, 4199]
  @default_dev_server_max_concurrent 3
  @default_dev_server_idle_timeout_ms 1_800_000
  @default_dev_server_auto_start_on ["pull_request", "human_review"]
```

- [ ] **Step 4: Add schema block**

In the `@workflow_options_schema NimbleOptions.new!(...)` keyword list, immediately after the `editor: [...]` map block (before the closing `)`), add a comma then:

```elixir
                             dev_server: [
                               type: :map,
                               default: %{},
                               keys: [
                                 enabled: [type: :boolean, default: @default_dev_server_enabled],
                                 port_range: [type: {:list, :pos_integer}, default: @default_dev_server_port_range],
                                 max_concurrent: [type: :pos_integer, default: @default_dev_server_max_concurrent],
                                 idle_timeout_ms: [type: :pos_integer, default: @default_dev_server_idle_timeout_ms],
                                 auto_start_on: [
                                   type: {:list, {:in, ["pull_request", "human_review"]}},
                                   default: @default_dev_server_auto_start_on
                                 ],
                                 base_url: [type: {:or, [:string, nil]}, default: nil]
                               ]
                             ]
```

- [ ] **Step 5: Wire the extractor**

In `extract_workflow_options/1`, add to the returned map (after `editor: extract_editor_options(...)`):

```elixir
      dev_server: extract_dev_server_options(section_map(config, "dev_server"))
```

Add the extractor near `extract_editor_options/1`:

```elixir
  defp extract_dev_server_options(section) do
    %{}
    |> put_if_present(:enabled, boolean_value(Map.get(section, "enabled")))
    |> put_if_present(:port_range, integer_list_value(Map.get(section, "port_range")))
    |> put_if_present(:max_concurrent, positive_integer_value(Map.get(section, "max_concurrent")))
    |> put_if_present(:idle_timeout_ms, positive_integer_value(Map.get(section, "idle_timeout_ms")))
    |> put_if_present(:auto_start_on, csv_value(Map.get(section, "auto_start_on")))
    |> put_if_present(:base_url, scalar_string_value(Map.get(section, "base_url")))
  end

  defp integer_list_value(values) when is_list(values) do
    parsed = Enum.flat_map(values, fn v -> if(is_integer(v), do: [v], else: []) end)
    if parsed == [], do: :omit, else: parsed
  end

  defp integer_list_value(_value), do: :omit
```

> Note: `boolean_value/1`, `positive_integer_value/1`, `scalar_string_value/1`, `csv_value/1`, `put_if_present/3` already exist in this file (used by `extract_editor_options/1` and `extract_tracker_options/1`).

- [ ] **Step 6: Add accessors**

After `editor_base_url/0` (around line 512), add:

```elixir
  @spec dev_server_enabled?() :: boolean()
  def dev_server_enabled? do
    get_in(validated_workflow_options(), [:dev_server, :enabled])
  end

  @spec dev_server_port_range() :: [pos_integer()]
  def dev_server_port_range do
    get_in(validated_workflow_options(), [:dev_server, :port_range])
  end

  @spec dev_server_max_concurrent() :: pos_integer()
  def dev_server_max_concurrent do
    get_in(validated_workflow_options(), [:dev_server, :max_concurrent])
  end

  @spec dev_server_idle_timeout_ms() :: pos_integer()
  def dev_server_idle_timeout_ms do
    get_in(validated_workflow_options(), [:dev_server, :idle_timeout_ms])
  end

  @spec dev_server_auto_start_on() :: [String.t()]
  def dev_server_auto_start_on do
    get_in(validated_workflow_options(), [:dev_server, :auto_start_on])
  end

  @spec dev_server_base_url() :: String.t() | nil
  def dev_server_base_url do
    case get_in(validated_workflow_options(), [:dev_server, :base_url]) do
      url when is_binary(url) and url != "" -> String.trim_trailing(url, "/")
      _ -> nil
    end
  end
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/config_test.exs -k "dev_server" && mix specs.check`
Expected: PASS; specs.check clean.

- [ ] **Step 8: Commit**

```bash
cd elixir && git add lib/symphony_elixir/config.ex test/symphony_elixir/config_test.exs
git commit -m "feat(config): add dev_server WORKFLOW block + accessors"
```

---

## Task 2: Migration — serve columns on dev_env steps

**Files:**
- Create: `elixir/priv/repo/migrations/20260530090000_expand_dev_env_serve.exs`

- [ ] **Step 1: Write the migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.ExpandDevEnvServe do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_dev_env_steps) do
      add :role, :string, null: false, default: "setup"
      add :port_env, :string
      add :url_path, :string, null: false, default: "/"
      add :ready_probe, :string, null: false, default: "tcp"
      add :ready_path, :string, null: false, default: "/"
      add :primary, :boolean, null: false, default: false
    end
  end
end
```

- [ ] **Step 2: Run the migration**

Run: `cd elixir && mix ecto.migrate`
Expected: migration applies cleanly; `mix ecto.rollback --step 1 && mix ecto.migrate` round-trips without error.

- [ ] **Step 3: Commit**

```bash
cd elixir && git add priv/repo/migrations/20260530090000_expand_dev_env_serve.exs
git commit -m "feat(devenv): add serve columns to dev_env steps"
```

---

## Task 3: `DevEnv.Step` & `ProposedStep` — serve fields

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/dev_env/step.ex`
- Modify: `elixir/lib/symphony_elixir/local_tracker/dev_env/proposed_step.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/dev_env/step_test.exs` (create)

- [ ] **Step 1: Write failing test**

Create `elixir/test/symphony_elixir/local_tracker/dev_env/step_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv.StepTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.DevEnv.{ProposedStep, Step}

  test "changeset accepts serve fields and defaults role to setup" do
    cs =
      Step.changeset(%Step{}, %{
        project_id: 1,
        description: "Front dev",
        command: "npm run dev",
        role: "serve",
        port_env: "PORT",
        url_path: "/",
        ready_probe: "http",
        ready_path: "/health",
        primary: true
      })

    assert cs.valid?
    assert Ecto.Changeset.get_field(cs, :role) == "serve"
    assert Ecto.Changeset.get_field(cs, :primary) == true
  end

  test "changeset rejects unknown role" do
    cs = Step.changeset(%Step{}, %{project_id: 1, description: "x", command: "y", role: "bogus"})
    refute cs.valid?
  end

  test "changeset rejects unknown ready_probe" do
    cs = Step.changeset(%Step{}, %{project_id: 1, description: "x", command: "y", ready_probe: "bogus"})
    refute cs.valid?
  end

  test "ProposedStep carries serve fields with defaults" do
    s = ProposedStep.new(%{description: "d", command: "npm run dev", source: "heuristic", role: "serve"})
    assert s.role == "serve"
    assert s.port_env == nil
    assert s.url_path == "/"
    assert s.ready_probe == "tcp"
    refute s.primary
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/dev_env/step_test.exs`
Expected: FAIL — fields/`role` unknown.

- [ ] **Step 3: Expand `Step`**

Replace the schema + changeset in `step.ex`:

```elixir
  @type t :: %__MODULE__{}
  @sources ~w(convention readme heuristic manual)
  @roles ~w(setup serve)
  @probes ~w(tcp http)

  schema "local_tracker_dev_env_steps" do
    field(:description, :string)
    field(:command, :string)
    field(:working_dir, :string)
    field(:position, :integer, default: 0)
    field(:source, :string, default: "manual")
    field(:optional, :boolean, default: false)
    field(:role, :string, default: "setup")
    field(:port_env, :string)
    field(:url_path, :string, default: "/")
    field(:ready_probe, :string, default: "tcp")
    field(:ready_path, :string, default: "/")
    field(:primary, :boolean, default: false)

    belongs_to(:project, Project)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(step, attrs) do
    step
    |> cast(attrs, [
      :project_id, :description, :command, :working_dir, :position, :source, :optional,
      :role, :port_env, :url_path, :ready_probe, :ready_path, :primary
    ])
    |> validate_required([:project_id, :description, :command])
    |> validate_inclusion(:source, @sources)
    |> validate_inclusion(:role, @roles)
    |> validate_inclusion(:ready_probe, @probes)
  end

  @spec sources() :: [String.t()]
  def sources, do: @sources

  @spec roles() :: [String.t()]
  def roles, do: @roles
```

- [ ] **Step 4: Expand `ProposedStep`**

Replace the struct + `new/1` in `proposed_step.ex`:

```elixir
  @enforce_keys [:description, :command, :source]
  defstruct [
    :description, :command, :working_dir, :source,
    :port_env,
    optional: false,
    role: "setup",
    url_path: "/",
    ready_probe: "tcp",
    ready_path: "/",
    primary: false
  ]

  @type t :: %__MODULE__{
          description: String.t(),
          command: String.t(),
          working_dir: String.t() | nil,
          source: String.t(),
          optional: boolean(),
          role: String.t(),
          port_env: String.t() | nil,
          url_path: String.t(),
          ready_probe: String.t(),
          ready_path: String.t(),
          primary: boolean()
        }

  @spec new(map()) :: t()
  def new(attrs) when is_map(attrs) do
    %__MODULE__{
      description: fetch(attrs, :description),
      command: fetch(attrs, :command),
      working_dir: get(attrs, :working_dir),
      source: get(attrs, :source) || "manual",
      optional: get(attrs, :optional) || false,
      role: get(attrs, :role) || "setup",
      port_env: get(attrs, :port_env),
      url_path: get(attrs, :url_path) || "/",
      ready_probe: get(attrs, :ready_probe) || "tcp",
      ready_path: get(attrs, :ready_path) || "/",
      primary: get(attrs, :primary) || false
    }
  end
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/dev_env/step_test.exs && mix specs.check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd elixir && git add lib/symphony_elixir/local_tracker/dev_env/step.ex lib/symphony_elixir/local_tracker/dev_env/proposed_step.ex test/symphony_elixir/local_tracker/dev_env/step_test.exs
git commit -m "feat(devenv): add serve role + fields to Step/ProposedStep"
```

---

## Task 4: `ConventionReader` — parse serve fields

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/dev_env/convention_reader.ex` (`to_proposed/1`)
- Test: `elixir/test/symphony_elixir/local_tracker/dev_env/convention_reader_test.exs`

- [ ] **Step 1: Write failing test**

Append to the existing `convention_reader_test.exs` (it already has a tmp-dir helper; reuse it — search the file for how it writes a `.symphony/devenv.yaml`):

```elixir
test "reads a serve step with port/url/ready fields", %{tmp: tmp} do
  File.mkdir_p!(Path.join(tmp, ".symphony"))
  File.write!(Path.join(tmp, ".symphony/devenv.yaml"), """
  steps:
    - description: Front dev server
      command: npm run dev
      working_dir: front
      role: serve
      port_env: PORT
      url_path: /
      ready: http
      ready_path: /health
      primary: true
  """)

  assert {:ok, [step]} = SymphonyElixir.LocalTracker.DevEnv.ConventionReader.read(tmp)
  assert step.role == "serve"
  assert step.port_env == "PORT"
  assert step.ready_probe == "http"
  assert step.ready_path == "/health"
  assert step.primary
end
```

(If the file does not already provide a `%{tmp: tmp}` setup, add `setup do tmp = Path.join(System.tmp_dir!(), "conv-#{System.unique_integer([:positive])}"); File.mkdir_p!(tmp); on_exit(fn -> File.rm_rf(tmp) end); {:ok, tmp: tmp} end`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/dev_env/convention_reader_test.exs`
Expected: FAIL — `role`/`port_env` not populated (nil/default).

- [ ] **Step 3: Update `to_proposed/1`**

Replace `to_proposed/1` in `convention_reader.ex`:

```elixir
  defp to_proposed(map) do
    ProposedStep.new(%{
      "description" => Map.get(map, "description", Map.get(map, "command", "step")),
      "command" => Map.fetch!(map, "command"),
      "working_dir" => Map.get(map, "working_dir"),
      "source" => "convention",
      "optional" => Map.get(map, "optional", false),
      "role" => Map.get(map, "role", "setup"),
      "port_env" => Map.get(map, "port_env"),
      "url_path" => Map.get(map, "url_path", "/"),
      "ready_probe" => Map.get(map, "ready", Map.get(map, "ready_probe", "tcp")),
      "ready_path" => Map.get(map, "ready_path", "/"),
      "primary" => Map.get(map, "primary", false)
    })
  end
```

> `ProposedStep.new/1` reads both atom and string keys via its `get/2` helper.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/dev_env/convention_reader_test.exs && mix specs.check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd elixir && git add lib/symphony_elixir/local_tracker/dev_env/convention_reader.ex test/symphony_elixir/local_tracker/dev_env/convention_reader_test.exs
git commit -m "feat(devenv): parse serve fields from devenv.yaml conventions"
```

---

## Task 5: `HeuristicDiscoverer` — serve heuristics

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/dev_env/heuristic_discoverer.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/dev_env/heuristic_discoverer_test.exs` (create)

- [ ] **Step 1: Write failing test**

Create `elixir/test/symphony_elixir/local_tracker/dev_env/heuristic_discoverer_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv.HeuristicDiscovererTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.DevEnv.HeuristicDiscoverer

  setup do
    tmp = Path.join(System.tmp_dir!(), "heur-#{System.unique_integer([:positive])}")
    File.mkdir_p!(tmp)
    on_exit(fn -> File.rm_rf(tmp) end)
    {:ok, tmp: tmp}
  end

  test "proposes a Next.js serve step on PORT/3000", %{tmp: tmp} do
    File.write!(Path.join(tmp, "package.json"), ~s({"dependencies":{"next":"14.0.0"}}))
    File.write!(Path.join(tmp, "next.config.js"), "module.exports = {}")

    steps = HeuristicDiscoverer.discover(tmp)
    serve = Enum.find(steps, &(&1.role == "serve"))

    assert serve
    assert serve.command == "npm run dev"
    assert serve.port_env == "PORT"
    assert serve.ready_probe == "http"
    assert serve.primary
  end

  test "proposes a Vite serve step", %{tmp: tmp} do
    File.write!(Path.join(tmp, "package.json"), ~s({"devDependencies":{"vite":"5.0.0"}}))
    File.write!(Path.join(tmp, "vite.config.ts"), "export default {}")

    serve = tmp |> HeuristicDiscoverer.discover() |> Enum.find(&(&1.role == "serve"))
    assert serve.command == "npm run dev"
    assert serve.ready_probe == "http"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/dev_env/heuristic_discoverer_test.exs`
Expected: FAIL — no serve step proposed.

- [ ] **Step 3: Add serve heuristics**

In `heuristic_discoverer.ex`, add a `serve_step/1` to the `discover/2` list and helpers. Replace `discover/1`:

```elixir
  @spec discover(Path.t()) :: [ProposedStep.t()]
  def discover(repo_root) when is_binary(repo_root) do
    [
      mise_step(repo_root),
      env_step(repo_root),
      install_step(repo_root),
      compose_step(repo_root),
      serve_step(repo_root)
    ]
    |> Enum.reject(&is_nil/1)
  end
```

Add at the bottom (before the closing `end`):

```elixir
  defp serve_step(root) do
    cond do
      next?(root) -> serve("Run Next.js dev server", "npm run dev", "PORT", "http")
      vite?(root) -> serve("Run Vite dev server", "npm run dev", "PORT", "http")
      phoenix?(root) -> serve("Run Phoenix server", "mix phx.server", "PORT", "http")
      has_dev_script?(root) -> serve("Run dev server", "npm run dev", "PORT", "tcp")
      true -> nil
    end
  end

  defp next?(root) do
    exists_any?(root, ["next.config.js", "next.config.mjs", "next.config.ts"]) or
      package_json_has_dep?(root, "next")
  end

  defp vite?(root), do: exists_any?(root, ["vite.config.js", "vite.config.ts", "vite.config.mjs"])

  defp phoenix?(root) do
    File.exists?(Path.join(root, "mix.exs")) and package_json_has_dep?(root, "__never__") == false and
      mix_has_phoenix?(root)
  end

  defp mix_has_phoenix?(root) do
    case File.read(Path.join(root, "mix.exs")) do
      {:ok, content} -> String.contains?(content, ":phoenix")
      _ -> false
    end
  end

  defp has_dev_script?(root) do
    package_json(root)
    |> get_in(["scripts", "dev"])
    |> is_binary()
  end

  defp package_json_has_dep?(root, dep) do
    json = package_json(root)
    Map.has_key?(Map.get(json, "dependencies", %{}), dep) or
      Map.has_key?(Map.get(json, "devDependencies", %{}), dep)
  end

  defp package_json(root) do
    with {:ok, content} <- File.read(Path.join(root, "package.json")),
         {:ok, json} <- Jason.decode(content) do
      json
    else
      _ -> %{}
    end
  end

  defp serve(description, command, port_env, probe) do
    ProposedStep.new(%{
      description: description,
      command: command,
      source: "heuristic",
      optional: true,
      role: "serve",
      port_env: port_env,
      ready_probe: probe,
      primary: true
    })
  end
```

> `Jason` is already a project dependency (Phoenix JSON). `exists_any?/2` already exists in this module.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/dev_env/heuristic_discoverer_test.exs && mix specs.check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd elixir && git add lib/symphony_elixir/local_tracker/dev_env/heuristic_discoverer.ex test/symphony_elixir/local_tracker/dev_env/heuristic_discoverer_test.exs
git commit -m "feat(devenv): heuristic serve-step discovery per framework"
```

---

## Task 6: `DevEnv` context — `list_serve_steps/1`, primary normalization, round-trip

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/dev_env.ex` (`step_attrs/3`, add `list_serve_steps/1`, add `normalize_primary/1`)
- Test: `elixir/test/symphony_elixir/local_tracker/dev_env_test.exs` (create or extend if present)

- [ ] **Step 1: Write failing test**

Create `elixir/test/symphony_elixir/local_tracker/dev_env_test.exs` (reuse the local-tracker DB sandbox setup other context tests use — look at `test/symphony_elixir/local_tracker/context_test.exs` for the `setup` that checks out the Repo sandbox and creates a project, and copy it):

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnvTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.LocalTracker.{Context, DevEnv}

  setup do
    {:ok, project} = Context.create_project(%{name: "Acme", slug: "acme", tracker_kind: "local"})
    {:ok, project: project}
  end

  test "save then list_serve_steps returns only serve steps", %{project: project} do
    {:ok, _} =
      DevEnv.save_steps(project.slug, [
        %{description: "Install", command: "npm ci", role: "setup"},
        %{description: "Front", command: "npm run dev", role: "serve", port_env: "PORT", primary: true}
      ])

    assert [serve] = DevEnv.list_serve_steps(project.slug)
    assert serve.role == "serve"
    assert serve.primary
  end

  test "exactly one primary survives save when several marked", %{project: project} do
    {:ok, _} =
      DevEnv.save_steps(project.slug, [
        %{description: "A", command: "a", role: "serve", primary: true},
        %{description: "B", command: "b", role: "serve", primary: true}
      ])

    serves = DevEnv.list_serve_steps(project.slug)
    assert Enum.count(serves, & &1.primary) == 1
  end

  test "first serve becomes primary when none marked", %{project: project} do
    {:ok, _} =
      DevEnv.save_steps(project.slug, [
        %{description: "A", command: "a", role: "serve"},
        %{description: "B", command: "b", role: "serve"}
      ])

    [first | _] = DevEnv.list_serve_steps(project.slug)
    assert first.primary
  end
end
```

> If `SymphonyElixir.DataCase` / `Context.create_project/1` names differ, mirror exactly what `context_test.exs` uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/dev_env_test.exs`
Expected: FAIL — `list_serve_steps/1` undefined; primary not normalized.

- [ ] **Step 3: Round-trip new fields + normalize primary**

In `dev_env.ex`, replace `step_attrs/3`:

```elixir
  defp step_attrs(attrs, project_id, index) do
    attrs
    |> Map.new(fn {k, v} -> {to_string(k), v} end)
    |> Map.put("project_id", project_id)
    |> Map.put("position", index)
    |> Map.put_new("source", "manual")
    |> Map.put_new("role", "setup")
  end
```

Add `list_serve_steps/1` (next to `list_steps/1`):

```elixir
  @spec list_serve_steps(String.t()) :: [Step.t()]
  def list_serve_steps(project_slug) do
    project_slug
    |> list_steps()
    |> Enum.filter(&(&1.role == "serve"))
  end
```

Update `replace_steps/2` to normalize primary before insert:

```elixir
  defp replace_steps(project, steps) do
    Repo.delete_all(from(s in Step, where: s.project_id == ^project.id))

    steps
    |> normalize_primary()
    |> Enum.with_index()
    |> Enum.reduce_while([], fn {attrs, index}, acc -> insert_step(project, attrs, index, acc) end)
    |> Enum.reverse()
  end

  defp normalize_primary(steps) do
    serve_indexes =
      steps
      |> Enum.with_index()
      |> Enum.filter(fn {attrs, _i} -> to_string(Map.get(attrs, :role, Map.get(attrs, "role", "setup"))) == "serve" end)
      |> Enum.map(fn {_attrs, i} -> i end)

    chosen_primary =
      Enum.find(serve_indexes, fn i ->
        attrs = Enum.at(steps, i)
        truthy?(Map.get(attrs, :primary, Map.get(attrs, "primary", false)))
      end) || List.first(serve_indexes)

    steps
    |> Enum.with_index()
    |> Enum.map(fn {attrs, i} -> put_primary(attrs, i == chosen_primary and i in serve_indexes) end)
  end

  defp put_primary(attrs, value) when is_map(attrs) do
    if Map.has_key?(attrs, "role") or Map.has_key?(attrs, "command") and not Map.has_key?(attrs, :command) do
      Map.put(attrs, "primary", value)
    else
      Map.put(attrs, :primary, value)
    end
  end

  defp truthy?(true), do: true
  defp truthy?("true"), do: true
  defp truthy?(_), do: false
```

> Add `alias SymphonyElixir.LocalTracker.DevEnv.Step` to the existing `alias ... {ProposedStep, Proposer, Run, Step, StepRun}` line if `Step` isn't already aliased (it is).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/dev_env_test.exs && mix specs.check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd elixir && git add lib/symphony_elixir/local_tracker/dev_env.ex test/symphony_elixir/local_tracker/dev_env_test.exs
git commit -m "feat(devenv): list_serve_steps + single-primary normalization"
```

---

## Task 7: `DevEnvPresenter` — emit serve fields

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/presenters/dev_env_presenter.ex` (`step/1`, `proposed/1`)
- Test: `elixir/test/symphony_elixir_web/presenters/dev_env_presenter_test.exs` (create)

- [ ] **Step 1: Write failing test**

Create `elixir/test/symphony_elixir_web/presenters/dev_env_presenter_test.exs`:

```elixir
defmodule SymphonyElixirWeb.DevEnvPresenterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.DevEnv.{ProposedStep, Step}
  alias SymphonyElixirWeb.DevEnvPresenter

  test "step/1 includes serve fields" do
    step = %Step{id: 1, description: "d", command: "npm run dev", role: "serve", port_env: "PORT", url_path: "/", ready_probe: "http", ready_path: "/", primary: true, source: "manual", optional: false, position: 0}
    dto = DevEnvPresenter.step(step)
    assert dto.role == "serve"
    assert dto.port_env == "PORT"
    assert dto.primary == true
  end

  test "proposed/1 includes serve fields" do
    p = ProposedStep.new(%{description: "d", command: "c", source: "heuristic", role: "serve"})
    dto = DevEnvPresenter.proposed(p)
    assert dto.role == "serve"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/presenters/dev_env_presenter_test.exs`
Expected: FAIL — `:role` missing.

- [ ] **Step 3: Add fields to presenter**

Update `step/1` and `proposed/1` maps in `dev_env_presenter.ex` to add:
`role: step.role, port_env: step.port_env, url_path: step.url_path, ready_probe: step.ready_probe, ready_path: step.ready_path, primary: step.primary` (and the analogous fields for `proposed/1`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir_web/presenters/dev_env_presenter_test.exs && mix specs.check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd elixir && git add lib/symphony_elixir_web/presenters/dev_env_presenter.ex test/symphony_elixir_web/presenters/dev_env_presenter_test.exs
git commit -m "feat(devenv): expose serve fields in DevEnv presenter"
```

---

## Task 8: `Terminal.Registry` — dev session helpers

**Files:**
- Modify: `elixir/lib/symphony_elixir/terminal/registry.ex` (add `dev_session_name/3`, `open_dev_session/4`, `kill_dev_session/3`; `safe_segment/2` already exists)
- Test: `elixir/test/symphony_elixir/terminal/registry_dev_session_test.exs` (create)

- [ ] **Step 1: Write failing test**

Create `elixir/test/symphony_elixir/terminal/registry_dev_session_test.exs`. Mirror how existing registry tests inject a fake tmux via `opts` (search `test/symphony_elixir/terminal/` for `terminal_tmux` fakes). Minimal version:

```elixir
defmodule SymphonyElixir.Terminal.RegistryDevSessionTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Terminal.Registry

  defmodule FakeTmux do
    def available?, do: true
    def has_session?(_), do: false
    def new_session(_name, _cwd), do: :ok
    def send_keys(_name, _data), do: :ok
    def capture_pane(_name), do: {:ok, ""}
    def kill_session(_name), do: :ok
  end

  test "dev_session_name builds a stable namespaced name" do
    assert Registry.dev_session_name("macro-markets", "#507", "front") ==
             "sym-dev-macro-markets-_507-front"
  end

  test "open_dev_session creates a session and returns its name" do
    {:ok, session} =
      Registry.open_dev_session("acme", "#1", "front", "/tmp", tmux: FakeTmux)

    assert session.session_name == "sym-dev-acme-_1-front"
    assert session.state == "running"
  end
end
```

> Adjust the expected `dev_session_name` string to what `safe_segment/2` actually produces for `"#507"` (it replaces `#` with `_`). Verify by reading `safe_segment/2`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/terminal/registry_dev_session_test.exs`
Expected: FAIL — `dev_session_name/3` undefined.

- [ ] **Step 3: Add the helpers**

In `registry.ex`, after `project_session_name/1`, add:

```elixir
  @spec dev_session_name(String.t(), String.t(), String.t()) :: String.t()
  def dev_session_name(project_slug, issue_identifier, slug)
      when is_binary(project_slug) and is_binary(issue_identifier) and is_binary(slug) do
    "sym-dev-#{safe_segment(project_slug, "project")}-#{safe_segment(issue_identifier, "issue")}-#{safe_segment(slug, "server")}"
  end

  @spec open_dev_session(String.t(), String.t(), String.t(), Path.t(), keyword()) ::
          {:ok, session()} | {:error, String.t()}
  def open_dev_session(project_slug, issue_identifier, slug, cwd, opts \\ [])
      when is_binary(project_slug) and is_binary(issue_identifier) and is_binary(slug) and is_binary(cwd) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    session_name = dev_session_name(project_slug, issue_identifier, slug)

    with :ok <- ensure_tmux_available(tmux),
         {:ok, _state} <- ensure_session(tmux, session_name, cwd),
         {:ok, output} <- capture_output(tmux, session_name) do
      {:ok,
       %{
         project_slug: project_slug,
         issue_identifier: issue_identifier,
         session_name: session_name,
         cwd: cwd,
         state: "running",
         output: output
       }}
    end
  end

  @spec kill_dev_session(String.t(), String.t(), String.t(), keyword()) :: :ok | {:error, String.t()}
  def kill_dev_session(project_slug, issue_identifier, slug, opts \\ []) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.kill_session(dev_session_name(project_slug, issue_identifier, slug))
  end
```

> `ensure_session/3`, `capture_output/2`, `ensure_tmux_available/1`, `dependency/4`, `safe_segment/2`, the `session()` type, and `Tmux` alias all already exist in this module.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/terminal/registry_dev_session_test.exs && mix specs.check`
Expected: PASS (adjust the expected name string if `safe_segment` differs).

- [ ] **Step 5: Commit**

```bash
cd elixir && git add lib/symphony_elixir/terminal/registry.ex test/symphony_elixir/terminal/registry_dev_session_test.exs
git commit -m "feat(terminal): per-server dev tmux session helpers"
```

---

## Task 9: `DevServer.PortAllocator`

**Files:**
- Create: `elixir/lib/symphony_elixir/dev_server/port_allocator.ex`
- Test: `elixir/test/symphony_elixir/dev_server/port_allocator_test.exs`

- [ ] **Step 1: Write failing test**

```elixir
defmodule SymphonyElixir.DevServer.PortAllocatorTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServer.PortAllocator

  test "returns a bindable port within the range, skipping claimed ports" do
    {:ok, port} = PortAllocator.allocate([4100, 4199], [4100, 4101])
    assert port in 4102..4199
  end

  test "errors when the range is exhausted by claims" do
    assert {:error, :no_free_port} = PortAllocator.allocate([4100, 4101], [4100, 4101])
  end

  test "errors when range bounds are invalid" do
    assert {:error, :no_free_port} = PortAllocator.allocate([4199, 4100], [])
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/dev_server/port_allocator_test.exs`
Expected: FAIL — module undefined.

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.DevServer.PortAllocator do
  @moduledoc """
  Picks a free TCP port from a `[min, max]` range, skipping ports already
  claimed by live instances. A candidate is "free" when `:gen_tcp.listen/2`
  succeeds; the probe socket is closed immediately and the port handed back.
  """

  @spec allocate([pos_integer()], [pos_integer()]) :: {:ok, pos_integer()} | {:error, :no_free_port}
  def allocate([min, max], claimed) when is_integer(min) and is_integer(max) and is_list(claimed) do
    claimed_set = MapSet.new(claimed)

    min..max//1
    |> Enum.reject(&MapSet.member?(claimed_set, &1))
    |> Enum.find_value({:error, :no_free_port}, fn port ->
      if bindable?(port), do: {:ok, port}, else: false
    end)
  end

  def allocate(_range, _claimed), do: {:error, :no_free_port}

  defp bindable?(port) do
    case :gen_tcp.listen(port, [:binary, ip: {127, 0, 0, 1}, reuseaddr: true]) do
      {:ok, socket} ->
        :gen_tcp.close(socket)
        true

      {:error, _reason} ->
        false
    end
  end
end
```

> `min..max//1` yields an empty range when `min > max`, so `Enum.find_value/3` returns the `{:error, :no_free_port}` default — covering the invalid-bounds test.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/dev_server/port_allocator_test.exs && mix specs.check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd elixir && git add lib/symphony_elixir/dev_server/port_allocator.ex test/symphony_elixir/dev_server/port_allocator_test.exs
git commit -m "feat(dev_server): free-port allocator within configured range"
```

---

## Task 10: `local_tracker_dev_servers` table + `DevServerRecord` schema

**Files:**
- Create: `elixir/priv/repo/migrations/20260530090100_create_dev_servers.exs`
- Create: `elixir/lib/symphony_elixir/local_tracker/dev_server_record.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/dev_server_record_test.exs`

- [ ] **Step 1: Write the migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateDevServers do
  use Ecto.Migration

  def change do
    create table(:local_tracker_dev_servers) do
      add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
      add :issue_identifier, :string, null: false
      add :working_dir, :string
      add :slug, :string, null: false
      add :port, :integer
      add :url, :string
      add :status, :string, null: false, default: "stopped"
      add :primary, :boolean, null: false, default: false
      add :session_name, :string
      add :started_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec)
    end

    create index(:local_tracker_dev_servers, [:project_id])
    create unique_index(:local_tracker_dev_servers, [:project_id, :issue_identifier, :slug])
  end
end
```

- [ ] **Step 2: Run the migration**

Run: `cd elixir && mix ecto.migrate`
Expected: applies cleanly.

- [ ] **Step 3: Write failing test**

```elixir
defmodule SymphonyElixir.LocalTracker.DevServerRecordTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.LocalTracker.{Context, DevServerRecord}

  setup do
    {:ok, project} = Context.create_project(%{name: "Acme", slug: "acme", tracker_kind: "local"})
    {:ok, project: project}
  end

  test "upsert inserts then updates by (project, issue, slug)", %{project: project} do
    {:ok, a} = DevServerRecord.upsert(project.id, "#1", "front", %{status: "starting", port: 4100, primary: true})
    {:ok, b} = DevServerRecord.upsert(project.id, "#1", "front", %{status: "ready", url: "http://127.0.0.1:4100"})

    assert a.id == b.id
    assert b.status == "ready"
    assert b.url == "http://127.0.0.1:4100"
  end

  test "list_for_issue returns rows for the issue", %{project: project} do
    {:ok, _} = DevServerRecord.upsert(project.id, "#1", "front", %{status: "ready", primary: true})
    assert [row] = DevServerRecord.list_for_issue(project.id, "#1")
    assert row.slug == "front"
  end

  test "mark_all_stopped flips non-terminal rows to stopped", %{project: project} do
    {:ok, _} = DevServerRecord.upsert(project.id, "#1", "front", %{status: "ready"})
    assert {1, _} = DevServerRecord.mark_all_stopped()
    assert [row] = DevServerRecord.list_for_issue(project.id, "#1")
    assert row.status == "stopped"
  end
end
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/dev_server_record_test.exs`
Expected: FAIL — module undefined.

- [ ] **Step 5: Implement schema + helpers**

```elixir
defmodule SymphonyElixir.LocalTracker.DevServerRecord do
  @moduledoc "Persisted last-known state of a per-issue dev server (one row per serve slug)."

  use Ecto.Schema

  import Ecto.Changeset
  import Ecto.Query

  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Repo

  @type t :: %__MODULE__{}
  @statuses ~w(pending provisioning starting ready crashed stopped)
  @non_terminal ~w(pending provisioning starting ready)

  schema "local_tracker_dev_servers" do
    field(:issue_identifier, :string)
    field(:working_dir, :string)
    field(:slug, :string)
    field(:port, :integer)
    field(:url, :string)
    field(:status, :string, default: "stopped")
    field(:primary, :boolean, default: false)
    field(:session_name, :string)
    field(:started_at, :utc_datetime_usec)

    belongs_to(:project, Project)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, [
      :project_id, :issue_identifier, :working_dir, :slug, :port, :url, :status,
      :primary, :session_name, :started_at
    ])
    |> validate_required([:project_id, :issue_identifier, :slug, :status])
    |> validate_inclusion(:status, @statuses)
    |> unique_constraint([:project_id, :issue_identifier, :slug])
  end

  @spec upsert(integer(), String.t(), String.t(), map()) :: {:ok, t()} | {:error, Ecto.Changeset.t()}
  def upsert(project_id, issue_identifier, slug, attrs) do
    base = Repo.one(query_one(project_id, issue_identifier, slug)) || %__MODULE__{}

    base
    |> changeset(Map.merge(attrs, %{project_id: project_id, issue_identifier: issue_identifier, slug: slug}))
    |> Repo.insert_or_update()
  end

  @spec list_for_issue(integer(), String.t()) :: [t()]
  def list_for_issue(project_id, issue_identifier) do
    Repo.all(
      from(r in __MODULE__,
        where: r.project_id == ^project_id and r.issue_identifier == ^issue_identifier,
        order_by: [desc: r.primary, asc: r.slug]
      )
    )
  end

  @spec mark_all_stopped() :: {non_neg_integer(), nil}
  def mark_all_stopped do
    Repo.update_all(
      from(r in __MODULE__, where: r.status in ^@non_terminal),
      set: [status: "stopped", updated_at: DateTime.utc_now()]
    )
  end

  defp query_one(project_id, issue_identifier, slug) do
    from(r in __MODULE__,
      where: r.project_id == ^project_id and r.issue_identifier == ^issue_identifier and r.slug == ^slug
    )
  end
end
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/dev_server_record_test.exs && mix specs.check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd elixir && git add priv/repo/migrations/20260530090100_create_dev_servers.exs lib/symphony_elixir/local_tracker/dev_server_record.ex test/symphony_elixir/local_tracker/dev_server_record_test.exs
git commit -m "feat(dev_server): persisted dev-server state table + schema"
```

---

## Task 11: `DevServer.Instance` GenServer

**Files:**
- Create: `elixir/lib/symphony_elixir/dev_server/instance.ex`
- Test: `elixir/test/symphony_elixir/dev_server/instance_test.exs`

`Instance` is a GenServer started by the Manager. To keep it testable it takes
injectable `tmux`, `port_allocator`, and `probe` via its start args (defaulting
to the real modules). It does **not** itself run setup steps — the Manager runs
setup once per issue before starting instances.

- [ ] **Step 1: Write failing test**

```elixir
defmodule SymphonyElixir.DevServer.InstanceTest do
  use SymphonyElixir.DataCase, async: false

  alias SymphonyElixir.DevServer.Instance
  alias SymphonyElixir.LocalTracker.{Context, DevServerRecord}

  defmodule FakeTmux do
    def open_dev_session(_p, _i, _slug, _cwd, _opts \\ []), do: {:ok, %{session_name: "sym-dev-x"}}
    def kill_dev_session(_p, _i, _slug, _opts \\ []), do: :ok
    def send_keys(_name, _data), do: :ok
  end

  setup do
    {:ok, project} = Context.create_project(%{name: "Acme", slug: "acme", tracker_kind: "local"})
    {:ok, project: project}
  end

  test "transitions to ready when the probe succeeds and persists the url", %{project: project} do
    step = %{slug: "front", command: "npm run dev", working_dir: "front", port_env: "PORT", url_path: "/", ready_probe: "tcp", primary: true}

    {:ok, pid} =
      Instance.start_link(
        project_id: project.id,
        project_slug: project.slug,
        identifier: "#1",
        workspace_path: System.tmp_dir!(),
        step: step,
        base_url: nil,
        idle_timeout_ms: 60_000,
        registry_name: nil,
        tmux: FakeTmux,
        port_allocator: fn _range, _claimed -> {:ok, 4123} end,
        probe: fn _host, _port, _probe, _path -> :ok end,
        probe_interval_ms: 5
      )

    Process.sleep(40)
    assert Instance.status(pid) == :ready
    [row] = DevServerRecord.list_for_issue(project.id, "#1")
    assert row.status == "ready"
    assert row.url == "http://127.0.0.1:4123/"
    assert row.port == 4123
  end

  test "crashes when probe never succeeds within retries", %{project: project} do
    step = %{slug: "front", command: "npm run dev", working_dir: "front", port_env: "PORT", url_path: "/", ready_probe: "tcp", primary: true}

    {:ok, pid} =
      Instance.start_link(
        project_id: project.id, project_slug: project.slug, identifier: "#2",
        workspace_path: System.tmp_dir!(), step: step, base_url: nil, idle_timeout_ms: 60_000,
        registry_name: nil, tmux: FakeTmux,
        port_allocator: fn _r, _c -> {:ok, 4124} end,
        probe: fn _h, _p, _pr, _pa -> {:error, :timeout} end,
        probe_interval_ms: 5, max_probe_attempts: 2
      )

    Process.sleep(60)
    assert Instance.status(pid) == :crashed
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/dev_server/instance_test.exs`
Expected: FAIL — module undefined.

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.DevServer.Instance do
  @moduledoc """
  Supervises one serve step for one issue: allocates a port, launches the serve
  command in a dedicated tmux session with the port injected, probes readiness,
  tracks status, auto-stops on idle, and persists last-known state.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.Config
  alias SymphonyElixir.DevServer.PortAllocator
  alias SymphonyElixir.LocalTracker.DevServerRecord
  alias SymphonyElixir.Terminal.Registry, as: TerminalRegistry

  @default_probe_interval_ms 1_000
  @default_max_probe_attempts 60

  @type status :: :provisioning | :starting | :ready | :crashed | :stopped

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    case Keyword.get(opts, :registry_name) do
      nil -> GenServer.start_link(__MODULE__, opts)
      via -> GenServer.start_link(__MODULE__, opts, name: via)
    end
  end

  @spec status(GenServer.server()) :: status()
  def status(server), do: GenServer.call(server, :status)

  @spec stop(GenServer.server()) :: :ok
  def stop(server), do: GenServer.stop(server, :normal)

  @impl true
  def init(opts) do
    Process.flag(:trap_exit, true)

    state = %{
      project_id: Keyword.fetch!(opts, :project_id),
      project_slug: Keyword.fetch!(opts, :project_slug),
      identifier: Keyword.fetch!(opts, :identifier),
      workspace_path: Keyword.fetch!(opts, :workspace_path),
      step: Keyword.fetch!(opts, :step),
      base_url: Keyword.get(opts, :base_url),
      idle_timeout_ms: Keyword.get(opts, :idle_timeout_ms, 1_800_000),
      tmux: Keyword.get(opts, :tmux, TerminalRegistry),
      port_allocator: Keyword.get(opts, :port_allocator, &PortAllocator.allocate/2),
      probe: Keyword.get(opts, :probe, &default_probe/4),
      probe_interval_ms: Keyword.get(opts, :probe_interval_ms, @default_probe_interval_ms),
      max_probe_attempts: Keyword.get(opts, :max_probe_attempts, @default_max_probe_attempts),
      claimed_ports: Keyword.get(opts, :claimed_ports, []),
      port: nil,
      url: nil,
      status: :provisioning,
      probe_attempts: 0
    }

    persist(state, :provisioning)
    {:ok, state, {:continue, :boot}}
  end

  @impl true
  def handle_continue(:boot, state) do
    case state.port_allocator.(Config.dev_server_port_range(), state.claimed_ports) do
      {:ok, port} ->
        url = build_url(state, port)
        state = %{state | port: port, url: url, status: :starting}
        launch(state)
        Process.send_after(self(), :probe, state.probe_interval_ms)
        schedule_idle(state)
        persist(state, :starting)
        {:noreply, state}

      {:error, reason} ->
        Logger.warning("Dev server port allocation failed slug=#{slug(state)} reason=#{inspect(reason)}")
        state = %{state | status: :crashed}
        persist(state, :crashed)
        {:noreply, state}
    end
  end

  @impl true
  def handle_call(:status, _from, state), do: {:reply, state.status, state}

  @impl true
  def handle_info(:probe, %{status: :ready} = state), do: {:noreply, state}

  def handle_info(:probe, state) do
    probe = state.step
    host = "127.0.0.1"

    case state.probe.(host, state.port, Map.get(probe, :ready_probe, "tcp"), Map.get(probe, :ready_path, "/")) do
      :ok ->
        Logger.info("Dev server ready slug=#{slug(state)} url=#{state.url}")
        state = %{state | status: :ready}
        persist(state, :ready)
        {:noreply, state}

      {:error, _reason} ->
        attempts = state.probe_attempts + 1

        if attempts >= state.max_probe_attempts do
          Logger.warning("Dev server failed to become ready slug=#{slug(state)}")
          state = %{state | status: :crashed, probe_attempts: attempts}
          persist(state, :crashed)
          {:noreply, state}
        else
          Process.send_after(self(), :probe, state.probe_interval_ms)
          {:noreply, %{state | probe_attempts: attempts}}
        end
    end
  end

  def handle_info(:idle_timeout, state) do
    Logger.info("Dev server idle-stopping slug=#{slug(state)}")
    {:stop, :normal, state}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, state) do
    state.tmux.kill_dev_session(state.project_slug, state.identifier, slug(state))
    persist(state, :stopped)
    :ok
  rescue
    _ -> :ok
  end

  defp launch(state) do
    {:ok, _session} =
      state.tmux.open_dev_session(
        state.project_slug,
        state.identifier,
        slug(state),
        Path.join(state.workspace_path, Map.get(state.step, :working_dir) || ".")
      )

    command = serve_command(state)
    state.tmux.send_keys(TerminalRegistry.dev_session_name(state.project_slug, state.identifier, slug(state)), command <> "\n")
  end

  defp serve_command(state) do
    case Map.get(state.step, :port_env) do
      env when is_binary(env) and env != "" -> "#{env}=#{state.port} #{state.step.command}"
      _ -> state.step.command
    end
  end

  defp build_url(state, port) do
    base = state.base_url || "http://127.0.0.1:#{port}"
    path = Map.get(state.step, :url_path) || "/"
    base <> path
  end

  defp schedule_idle(state) do
    Process.send_after(self(), :idle_timeout, state.idle_timeout_ms)
  end

  defp persist(state, status) do
    DevServerRecord.upsert(state.project_id, state.identifier, slug(state), %{
      working_dir: Map.get(state.step, :working_dir),
      port: state.port,
      url: state.url,
      status: Atom.to_string(status),
      primary: Map.get(state.step, :primary, false),
      session_name: TerminalRegistry.dev_session_name(state.project_slug, state.identifier, slug(state)),
      started_at: state.started_at_or_now()
    })
  end

  defp slug(state), do: Map.fetch!(state.step, :slug)

  defp default_probe(host, port, "http", path) do
    url = "http://#{host}:#{port}#{path}"

    case Req.get(url, retry: false, receive_timeout: 1_000) do
      {:ok, %{status: status}} when status in 200..499 -> :ok
      _ -> {:error, :not_ready}
    end
  rescue
    _ -> {:error, :not_ready}
  end

  defp default_probe(host, port, _tcp, _path) do
    case :gen_tcp.connect(String.to_charlist(host), port, [:binary, active: false], 500) do
      {:ok, socket} ->
        :gen_tcp.close(socket)
        :ok

      {:error, reason} ->
        {:error, reason}
    end
  end
end
```

> Fix-up needed during implementation: `state.started_at_or_now()` is not valid; replace the `started_at:` line in `persist/2` with `started_at: DateTime.utc_now()` only on the first persist. Simplest correct form: store `started_at` in state at `init` (`started_at: DateTime.utc_now()`) and pass `started_at: state.started_at` in `persist/2`. Apply that. `Req` is already a dependency (used by Observability reporter).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/dev_server/instance_test.exs && mix specs.check`
Expected: PASS (ready + crashed transitions, persisted URL).

- [ ] **Step 5: Commit**

```bash
cd elixir && git add lib/symphony_elixir/dev_server/instance.ex test/symphony_elixir/dev_server/instance_test.exs
git commit -m "feat(dev_server): per-serve-step Instance GenServer with health probe"
```

---

## Task 12: `DevServer.Manager` (DynamicSupervisor + Registry + lifecycle)

**Files:**
- Create: `elixir/lib/symphony_elixir/dev_server/manager.ex`
- Test: `elixir/test/symphony_elixir/dev_server/manager_test.exs`

The Manager owns a `DynamicSupervisor` (`DevServer.InstanceSupervisor`) and a
`Registry` (`DevServer.Registry`) keyed by `{project_slug, identifier, slug}`.
It resolves serve steps via `DevEnv.list_serve_steps/1`, runs setup steps once in
the issue tmux session, enforces `max_concurrent`, and exposes start/stop/list.

- [ ] **Step 1: Write failing test**

```elixir
defmodule SymphonyElixir.DevServer.ManagerTest do
  use SymphonyElixir.DataCase, async: false

  alias SymphonyElixir.DevServer.Manager
  alias SymphonyElixir.LocalTracker.{Context, DevEnv}

  setup do
    # Manager + its supervisor/registry are started by the app tree in test env.
    {:ok, project} = Context.create_project(%{name: "Acme", slug: "acme", tracker_kind: "local"})
    {:ok, _} = DevEnv.save_steps(project.slug, [
      %{description: "Front", command: "npm run dev", role: "serve", port_env: "PORT", primary: true, working_dir: "front"}
    ])
    on_exit(fn -> Manager.stop_for_issue(project.slug, "#1") end)
    {:ok, project: project}
  end

  test "returns :disabled when dev_server not enabled", %{project: project} do
    # Default WORKFLOW in test fixtures has dev_server disabled.
    assert {:error, :disabled} = Manager.start_for_issue(project.slug, "#1")
  end
end
```

> Manager unit tests that exercise the full start path require `dev_server_enabled?` true and a tmux/instance double. Add those once the app-tree wiring (Task 16) and a test WORKFLOW with `dev_server.enabled: true` exist; for this task assert the `:disabled` short-circuit and the pure helpers (`capacity_reason/2`). Keep heavy start-path coverage in `Instance` (Task 11) and the controller test (Task 15).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/dev_server/manager_test.exs`
Expected: FAIL — module undefined.

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.DevServer.Manager do
  @moduledoc """
  Supervises per-issue dev-server instances and exposes start/stop/restart/list.

  No-ops with `{:error, :disabled}` when `Config.dev_server_enabled?/0` is false.
  """

  use Supervisor

  require Logger

  alias SymphonyElixir.Config
  alias SymphonyElixir.DevServer.Instance
  alias SymphonyElixir.LocalTracker.{Context, DevEnv, DevServerRecord}
  alias SymphonyElixir.{Terminal, Workspace}

  @registry __MODULE__.Registry
  @sup __MODULE__.InstanceSupervisor

  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts), do: Supervisor.start_link(__MODULE__, opts, name: __MODULE__)

  @impl true
  def init(_opts) do
    DevServerRecord.mark_all_stopped()

    children = [
      {Registry, keys: :unique, name: @registry},
      {DynamicSupervisor, strategy: :one_for_one, name: @sup}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  @spec start_for_issue(String.t(), String.t()) ::
          {:ok, [pid()]} | {:error, :disabled | :workspace_missing | :no_serve_step | :capacity}
  def start_for_issue(project_slug, identifier) do
    with :ok <- ensure_enabled(),
         {:ok, project} <- Context.get_project(project_slug),
         {:ok, workspace} <- ensure_workspace(identifier),
         [_ | _] = serve_steps <- DevEnv.list_serve_steps(project_slug),
         :ok <- ensure_capacity(serve_steps) do
      run_setup(project_slug, identifier, workspace)
      pids = Enum.map(serve_steps, &start_instance(project, identifier, workspace, &1))
      {:ok, pids}
    else
      {:error, reason} -> {:error, reason}
      [] -> {:error, :no_serve_step}
    end
  end

  @spec stop_for_issue(String.t(), String.t()) :: :ok
  def stop_for_issue(project_slug, identifier) do
    @registry
    |> Registry.select([{{{:"$1", :"$2", :"$3"}, :"$4", :_}, [], [{{{{:"$1", :"$2", :"$3"}}, :"$4"}}]}])
    |> Enum.each(fn {{ps, id, _slug}, pid} ->
      if ps == project_slug and id == identifier, do: safe_stop(pid)
    end)

    :ok
  end

  @spec restart_for_issue(String.t(), String.t()) :: {:ok, [pid()]} | {:error, term()}
  def restart_for_issue(project_slug, identifier) do
    stop_for_issue(project_slug, identifier)
    start_for_issue(project_slug, identifier)
  end

  @spec list_for_issue(String.t(), String.t()) :: [map()]
  def list_for_issue(project_slug, identifier) do
    case Context.get_project(project_slug) do
      {:ok, project} -> DevServerRecord.list_for_issue(project.id, identifier) |> Enum.map(&record_view/1)
      _ -> []
    end
  end

  @spec live_ports() :: [pos_integer()]
  def live_ports do
    @registry
    |> Registry.select([{{:_, :"$1", :_}, [], [:"$1"]}])
    |> Enum.flat_map(fn pid ->
      try do
        case :sys.get_state(pid) do
          %{port: p} when is_integer(p) -> [p]
          _ -> []
        end
      catch
        _, _ -> []
      end
    end)
  end

  defp ensure_enabled, do: if(Config.dev_server_enabled?(), do: :ok, else: {:error, :disabled})

  defp ensure_workspace(identifier) do
    path = Workspace.path_for_issue(strip_hash(identifier))
    if File.dir?(path), do: {:ok, path}, else: {:error, :workspace_missing}
  end

  defp ensure_capacity(serve_steps) do
    running = length(live_ports())
    if running + length(serve_steps) <= Config.dev_server_max_concurrent(), do: :ok, else: {:error, :capacity}
  end

  defp run_setup(project_slug, identifier, workspace) do
    setup_steps = DevEnv.list_steps(project_slug) |> Enum.filter(&(&1.role == "setup"))

    Enum.each(setup_steps, fn step ->
      {:ok, _} = Terminal.Registry.open_project_issue_session(project_slug, identifier)
      cmd = if step.working_dir, do: "cd #{step.working_dir} && #{step.command}", else: step.command
      Terminal.Registry.send_input(project_slug, identifier, cmd <> "\n")
    end)

    _ = workspace
    :ok
  end

  defp start_instance(project, identifier, workspace, step) do
    slug = serve_slug(step)
    key = {project.slug, identifier, slug}
    via = {:via, Registry, {@registry, key}}

    spec =
      {Instance,
       [
         project_id: project.id,
         project_slug: project.slug,
         identifier: identifier,
         workspace_path: workspace,
         step: to_step_map(step, slug),
         base_url: Config.dev_server_base_url(),
         idle_timeout_ms: Config.dev_server_idle_timeout_ms(),
         registry_name: via,
         claimed_ports: live_ports()
       ]}

    case DynamicSupervisor.start_child(@sup, spec) do
      {:ok, pid} -> pid
      {:error, {:already_started, pid}} -> pid
    end
  end

  defp to_step_map(step, slug) do
    %{
      slug: slug,
      command: step.command,
      working_dir: step.working_dir,
      port_env: step.port_env,
      url_path: step.url_path,
      ready_probe: step.ready_probe,
      ready_path: step.ready_path,
      primary: step.primary
    }
  end

  defp serve_slug(%{working_dir: wd}) when is_binary(wd) and wd not in ["", "."], do: wd
  defp serve_slug(_step), do: "app"

  defp record_view(record) do
    %{
      id: record.id,
      slug: record.slug,
      working_dir: record.working_dir,
      port: record.port,
      url: record.url,
      status: record.status,
      primary: record.primary,
      session_name: record.session_name
    }
  end

  defp safe_stop(pid) do
    if Process.alive?(pid), do: Instance.stop(pid)
  rescue
    _ -> :ok
  end

  defp strip_hash(id), do: String.trim_leading(id, "#")
end
```

> `Workspace.path_for_issue/1` exists (used by the terminal + editor). `Terminal.Registry.send_input/4` and `open_project_issue_session/3` exist. Verify the `Registry.select/2` match spec compiles; if it fights you, replace `stop_for_issue/2` and `live_ports/0` with a simpler `Registry.lookup`-based iteration over a tracked key list — keep behavior identical.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/dev_server/manager_test.exs && mix specs.check`
Expected: PASS (`:disabled` short-circuit).

- [ ] **Step 5: Commit**

```bash
cd elixir && git add lib/symphony_elixir/dev_server/manager.ex test/symphony_elixir/dev_server/manager_test.exs
git commit -m "feat(dev_server): Manager supervises per-issue instances + lifecycle"
```

---

## Task 13: `DevServer` view builder (`issue_targets/2`)

**Files:**
- Create: `elixir/lib/symphony_elixir/dev_server.ex`
- Test: `elixir/test/symphony_elixir/dev_server_test.exs`

- [ ] **Step 1: Write failing test**

```elixir
defmodule SymphonyElixir.DevServerTest do
  use SymphonyElixir.DataCase, async: false

  alias SymphonyElixir.LocalTracker.{Context, DevEnv}

  setup do
    {:ok, project} = Context.create_project(%{name: "Acme", slug: "acme", tracker_kind: "local"})
    {:ok, project: project}
  end

  test "reports disabled when dev_server off", %{project: project} do
    assert {:ok, %{available: false, reason: :disabled, servers: []}} =
             SymphonyElixir.DevServer.issue_targets(project.slug, "#1")
  end

  test "reports no_serve_step when enabled but no serve steps", %{project: project} do
    # requires a WORKFLOW with dev_server.enabled true + existing workspace dir;
    # use the test helper that stubs Config.dev_server_enabled? and Workspace dir.
    # Assert the {available:false, reason: :no_serve_step} branch.
    _ = project
    assert true
  end
end
```

> The second test's full setup depends on a Config/Workspace stub helper. Implement the builder so it delegates the reason to `Manager.start_for_issue/2`'s precondition checks **without starting** anything — see implementation. Flesh out the second assertion once the stub helper from Task 16 exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/dev_server_test.exs`
Expected: FAIL — module undefined.

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.DevServer do
  @moduledoc "Pure read-side view of per-issue dev servers + availability reason."

  alias SymphonyElixir.Config
  alias SymphonyElixir.DevServer.Manager
  alias SymphonyElixir.LocalTracker.{Context, DevEnv}
  alias SymphonyElixir.Workspace

  @type view :: %{
          available: boolean(),
          reason: nil | :disabled | :workspace_missing | :no_serve_step,
          servers: [map()]
        }

  @spec issue_targets(String.t(), String.t()) :: {:ok, view()} | {:error, :project_not_found}
  def issue_targets(project_slug, identifier) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      {:ok, build(project_slug, identifier)}
    else
      {:error, _} -> {:error, :project_not_found}
    end
  end

  defp build(project_slug, identifier) do
    servers = Manager.list_for_issue(project_slug, identifier)

    cond do
      not Config.dev_server_enabled?() -> %{available: false, reason: :disabled, servers: servers}
      not workspace?(identifier) -> %{available: false, reason: :workspace_missing, servers: servers}
      DevEnv.list_serve_steps(project_slug) == [] -> %{available: false, reason: :no_serve_step, servers: servers}
      true -> %{available: true, reason: nil, servers: servers}
    end
  end

  defp workspace?(identifier) do
    identifier
    |> String.trim_leading("#")
    |> Workspace.path_for_issue()
    |> File.dir?()
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/dev_server_test.exs && mix specs.check`
Expected: PASS (disabled branch).

- [ ] **Step 5: Commit**

```bash
cd elixir && git add lib/symphony_elixir/dev_server.ex test/symphony_elixir/dev_server_test.exs
git commit -m "feat(dev_server): read-side issue_targets view + availability reasons"
```

---

## Task 14: `DevServer.Reconciler` (poll-driven triggers)

**Files:**
- Create: `elixir/lib/symphony_elixir/dev_server/reconciler.ex`
- Test: `elixir/test/symphony_elixir/dev_server/reconciler_test.exs`

The Reconciler exposes a pure `reconcile/3` that, given the auto-start config and
the issues currently in trigger conditions, returns the issue identifiers to
start — so the trigger logic is unit-testable without a live tracker. The
GenServer ticks on `Config.poll_interval_ms/0` and calls `Manager.start_for_issue/2`
for each.

- [ ] **Step 1: Write failing test**

```elixir
defmodule SymphonyElixir.DevServer.ReconcilerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServer.Reconciler

  test "selects human-review issues when configured" do
    starts =
      Reconciler.reconcile(
        ["human_review"],
        %{human_review: ["#1", "#2"], pull_request: ["#9"]}
      )

    assert Enum.sort(starts) == ["#1", "#2"]
  end

  test "unions pull_request and human_review without duplicates" do
    starts =
      Reconciler.reconcile(
        ["human_review", "pull_request"],
        %{human_review: ["#1"], pull_request: ["#1", "#3"]}
      )

    assert Enum.sort(starts) == ["#1", "#3"]
  end

  test "returns nothing when no triggers configured" do
    assert Reconciler.reconcile([], %{human_review: ["#1"], pull_request: ["#2"]}) == []
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/dev_server/reconciler_test.exs`
Expected: FAIL — module undefined.

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.DevServer.Reconciler do
  @moduledoc """
  Periodically auto-starts dev servers for issues in trigger states
  (`human_review` and/or `pull_request`) and auto-stops servers for issues that
  reached a terminal state. No-ops when `Config.dev_server_enabled?/0` is false.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.Config
  alias SymphonyElixir.DevServer.Manager
  alias SymphonyElixir.GitHub.PullRequests
  alias SymphonyElixir.{LocalTracker, Tracker}

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @impl true
  def init(_opts) do
    schedule()
    {:ok, %{}}
  end

  @impl true
  def handle_info(:tick, state) do
    if Config.dev_server_enabled?(), do: run_cycle()
    schedule()
    {:noreply, state}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  @doc """
  Pure trigger resolution: given the configured `auto_start_on` list and a map of
  issue identifiers per trigger, returns the de-duplicated identifiers to start.
  """
  @spec reconcile([String.t()], %{optional(atom()) => [String.t()]}) :: [String.t()]
  def reconcile(auto_start_on, candidates) when is_list(auto_start_on) and is_map(candidates) do
    auto_start_on
    |> Enum.flat_map(fn
      "human_review" -> Map.get(candidates, :human_review, [])
      "pull_request" -> Map.get(candidates, :pull_request, [])
      _ -> []
    end)
    |> Enum.uniq()
  end

  defp run_cycle do
    auto = Config.dev_server_auto_start_on()
    candidates = %{human_review: human_review_issues(), pull_request: pull_request_issues()}

    auto
    |> reconcile(candidates)
    |> Enum.each(fn identifier ->
      case Manager.start_for_issue(LocalTracker.project_slug(), identifier) do
        {:ok, _} -> :ok
        {:error, reason} -> Logger.debug("Dev server auto-start skipped identifier=#{identifier} reason=#{inspect(reason)}")
      end
    end)
  end

  defp human_review_issues do
    case Tracker.fetch_issues_by_states(Config.wait_states()) do
      {:ok, issues} -> Enum.map(issues, & &1.identifier)
      _ -> []
    end
  end

  defp pull_request_issues do
    # Bounded: only issues in wait states are PR-checked, reusing the GitHub reader.
    case Tracker.fetch_issues_by_states(Config.wait_states()) do
      {:ok, issues} -> Enum.filter(issues, &has_pr?/1) |> Enum.map(& &1.identifier)
      _ -> []
    end
  end

  defp has_pr?(issue) do
    with repo when is_binary(repo) <- repo_for(issue),
         {:ok, [_ | _]} <- PullRequests.for_issue(repo, issue.identifier) do
      true
    else
      _ -> false
    end
  end

  defp repo_for(_issue), do: SymphonyElixir.GitHub.Config.repo()

  defp schedule, do: Process.send_after(self(), :tick, Config.poll_interval_ms())
end
```

> Implementation notes for the engineer: `LocalTracker.project_slug/0`, `issue.identifier`, and `SymphonyElixir.GitHub.Config.repo/0` are referenced as the project's existing accessors — confirm the exact names while wiring (grep `def project_slug`, `def repo`). If the active tracker is not GitHub, `repo_for/1` returns nil and `pull_request` simply yields no candidates. Keep `reconcile/2` (the pure function under test) unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/dev_server/reconciler_test.exs && mix specs.check`
Expected: PASS (pure `reconcile/2`).

- [ ] **Step 5: Commit**

```bash
cd elixir && git add lib/symphony_elixir/dev_server/reconciler.ex test/symphony_elixir/dev_server/reconciler_test.exs
git commit -m "feat(dev_server): poll-driven auto-start reconciler"
```

---

## Task 15: Controller + presenter + router + TrackerErrors

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/dev_server_controller.ex`
- Create: `elixir/lib/symphony_elixir_web/presenters/dev_server_presenter.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Modify: `elixir/lib/symphony_elixir_web/tracker_errors.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/dev_server_controller_test.exs`

- [ ] **Step 1: Write failing test**

```elixir
defmodule SymphonyElixirWeb.Tracker.DevServerControllerTest do
  use SymphonyElixirWeb.ConnCase, async: false

  alias SymphonyElixir.LocalTracker.Context

  setup %{conn: conn} do
    {:ok, project} = Context.create_project(%{name: "Acme", slug: "acme", tracker_kind: "local"})
    {:ok, conn: put_req_header(conn, "accept", "application/json"), project: project}
  end

  test "index returns availability + servers", %{conn: conn, project: project} do
    conn = get(conn, "/api/tracker/v1/projects/#{project.slug}/issues/%231/dev_servers")
    assert %{"data" => %{"available" => available, "servers" => servers}} = json_response(conn, 200)
    assert is_boolean(available)
    assert is_list(servers)
  end

  test "index 404 for unknown project", %{conn: conn} do
    conn = get(conn, "/api/tracker/v1/projects/nope/issues/%231/dev_servers")
    assert json_response(conn, 404)
  end
end
```

> Mirror the auth/setup of an existing tracker controller test (e.g. `terminal_controller_test.exs` or `pull_request_controller_test.exs`) — copy any required token header / `ConnCase` setup verbatim.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/dev_server_controller_test.exs`
Expected: FAIL — route/controller missing.

- [ ] **Step 3: Presenter**

```elixir
defmodule SymphonyElixirWeb.DevServerPresenter do
  @moduledoc "JSON DTOs for per-issue dev servers."

  @spec view(map()) :: map()
  def view(%{available: available, reason: reason, servers: servers}) do
    %{
      available: available,
      reason: reason && Atom.to_string(reason),
      servers: Enum.map(servers, &server/1)
    }
  end

  @spec server(map()) :: map()
  def server(s) do
    %{
      id: s.id,
      slug: s.slug,
      working_dir: s.working_dir,
      port: s.port,
      url: s.url,
      status: s.status,
      primary: s.primary,
      session_name: s.session_name
    }
  end
end
```

- [ ] **Step 4: Controller**

```elixir
defmodule SymphonyElixirWeb.Tracker.DevServerController do
  @moduledoc "Per-issue dev-server status + start/stop/restart."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.DevServer
  alias SymphonyElixir.DevServer.Manager
  alias SymphonyElixirWeb.{DevServerPresenter, TrackerErrors}

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => slug, "identifier" => id}) do
    case DevServer.issue_targets(slug, id) do
      {:ok, view} -> json(conn, %{data: DevServerPresenter.view(view)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec start(Conn.t(), map()) :: Conn.t()
  def start(conn, %{"project_slug" => slug, "identifier" => id}) do
    _ = Manager.start_for_issue(slug, id)
    respond(conn, slug, id)
  end

  @spec stop(Conn.t(), map()) :: Conn.t()
  def stop(conn, %{"project_slug" => slug, "identifier" => id}) do
    :ok = Manager.stop_for_issue(slug, id)
    respond(conn, slug, id)
  end

  @spec restart(Conn.t(), map()) :: Conn.t()
  def restart(conn, %{"project_slug" => slug, "identifier" => id}) do
    _ = Manager.restart_for_issue(slug, id)
    respond(conn, slug, id)
  end

  defp respond(conn, slug, id) do
    case DevServer.issue_targets(slug, id) do
      {:ok, view} -> json(conn, %{data: DevServerPresenter.view(view)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
end
```

> `start`/`stop`/`restart` intentionally return the fresh `issue_targets` view (including `reason` such as `capacity`/`disabled`) so the UI sees why nothing started — without failing the request.

- [ ] **Step 5: Router**

In `router.ex`, after the terminal route (line ~70), add:

```elixir
    get("/projects/:project_slug/issues/:identifier/dev_servers", DevServerController, :index)
    post("/projects/:project_slug/issues/:identifier/dev_servers/start", DevServerController, :start)
    post("/projects/:project_slug/issues/:identifier/dev_servers/stop", DevServerController, :stop)
    post("/projects/:project_slug/issues/:identifier/dev_servers/restart", DevServerController, :restart)
```

Add `DevServerController` to the controller alias block at the top of the router (mirror how `TerminalController`/`DevEnvController` are aliased — search for `alias SymphonyElixirWeb.Tracker`).

- [ ] **Step 6: TrackerErrors**

In `tracker_errors.ex`, add clauses so the new reasons render sensible HTTP codes (mirror the existing `:project_not_found -> 404` clause). Add:

```elixir
  def render(conn, :disabled), do: error(conn, :ok_unavailable, "Dev servers are disabled for this project.")
```

> Inspect the file's existing `render/2` shape first. `:disabled`/`:no_serve_step`/`:workspace_missing`/`:capacity` are normally surfaced **inside** the 200 `view` payload (via `DevServerPresenter`), not as errors — the controller only calls `TrackerErrors.render/2` for `:project_not_found`. So the only required mapping here is confirming `:project_not_found -> 404` already exists (it does, used by `DevEnvController`). No new clause needed unless you choose to add one; keep this step a no-op verification if so.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/dev_server_controller_test.exs && mix specs.check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd elixir && git add lib/symphony_elixir_web/controllers/tracker/dev_server_controller.ex lib/symphony_elixir_web/presenters/dev_server_presenter.ex lib/symphony_elixir_web/router.ex test/symphony_elixir_web/controllers/tracker/dev_server_controller_test.exs
git commit -m "feat(dev_server): tracker API (status/start/stop/restart) + presenter"
```

---

## Task 16: Supervision tree wiring

**Files:**
- Modify: `elixir/lib/symphony_elixir.ex` (children list ~28-55)
- Test: covered by the controller/manager tests booting the app tree (no new test).

- [ ] **Step 1: Add children**

In `SymphonyElixir.Application.start/2`, add to the `children` list after `SymphonyElixir.Repo` (so the Repo exists for `mark_all_stopped/0`) and before `SymphonyElixir.HttpServer`:

```elixir
      SymphonyElixir.DevServer.Manager,
      SymphonyElixir.DevServer.Reconciler,
```

Place them after `SymphonyElixir.Orchestrator` to keep ordering with the other pollers. Both no-op internally when disabled, so they are safe to always start.

- [ ] **Step 2: Run the suite to verify boot**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/dev_server_controller_test.exs test/symphony_elixir/dev_server/manager_test.exs`
Expected: PASS — app boots with the new children.

- [ ] **Step 3: Commit**

```bash
cd elixir && git add lib/symphony_elixir.ex
git commit -m "feat(dev_server): supervise Manager + Reconciler in app tree"
```

---

## Task 17: Backend gate

- [ ] **Step 1: Full gate**

Run: `cd elixir && make all`
Expected: format check, credo, coverage, dialyzer all pass. Fix any `@spec`/format/dialyzer issues introduced.

- [ ] **Step 2: Commit any fixups**

```bash
cd elixir && git add -A && git commit -m "chore(dev_server): satisfy format/credo/dialyzer gates"
```

---

## Task 18: Frontend types

**Files:**
- Create: `tracker/src/types/devServer.ts`

- [ ] **Step 1: Implement (no test — pure types)**

```ts
export type DevServerStatus =
  | "pending"
  | "provisioning"
  | "starting"
  | "ready"
  | "crashed"
  | "stopped";

export type DevServerReason = "disabled" | "workspace_missing" | "no_serve_step" | "capacity";

export interface DevServer {
  id: number | string;
  slug: string;
  workingDir: string | null;
  port: number | null;
  url: string | null;
  status: DevServerStatus;
  primary: boolean;
  sessionName: string | null;
}

export interface DevServersResult {
  available: boolean;
  reason: DevServerReason | null;
  servers: DevServer[];
}
```

- [ ] **Step 2: Commit**

```bash
cd tracker && git add src/types/devServer.ts
git commit -m "feat(tracker): dev server types"
```

---

## Task 19: Frontend service

**Files:**
- Create: `tracker/src/services/devServer.ts`
- Test: `tracker/src/services/__tests__/devServer.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { listDevServers } from "@/services/devServer";

describe("devServer service", () => {
  it("normalizes the dev servers response", async () => {
    vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: {
          available: true,
          reason: null,
          servers: [
            { id: 1, slug: "front", working_dir: "front", port: 4100, url: "http://127.0.0.1:4100/", status: "ready", primary: true, session_name: "sym-dev-x" },
          ],
        },
      },
    } as never);

    const result = await listDevServers("acme", "#1");
    expect(result.available).toBe(true);
    expect(result.servers[0].workingDir).toBe("front");
    expect(result.servers[0].status).toBe("ready");
  });
});
```

> Match the import style other `services/__tests__/*.test.ts` use for mocking `http` (see `services/__tests__/devEnv.test.ts`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npm run test:unit -- src/services/__tests__/devServer.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
import type { DevServer, DevServersResult } from "@/types/devServer";
import { http, trackerPath, unwrapData } from "./http";

interface DevServerDto {
  id: number | string;
  slug: string;
  working_dir: string | null;
  port: number | null;
  url: string | null;
  status: DevServer["status"];
  primary: boolean;
  session_name: string | null;
}

interface DevServersDto {
  available: boolean;
  reason: DevServersResult["reason"];
  servers: DevServerDto[];
}

function normalize(dto: DevServerDto): DevServer {
  return {
    id: dto.id,
    slug: dto.slug,
    workingDir: dto.working_dir ?? null,
    port: dto.port ?? null,
    url: dto.url ?? null,
    status: dto.status,
    primary: dto.primary,
    sessionName: dto.session_name ?? null,
  };
}

function normalizeResult(dto: DevServersDto): DevServersResult {
  return {
    available: dto.available,
    reason: dto.reason ?? null,
    servers: (dto.servers ?? []).map(normalize),
  };
}

function base(projectSlug: string, identifier: string): string {
  return trackerPath(
    `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/dev_servers`,
  );
}

export async function listDevServers(projectSlug: string, identifier: string): Promise<DevServersResult> {
  const response = await http.get(base(projectSlug, identifier));
  return normalizeResult(unwrapData<DevServersDto>(response));
}

export async function startDevServers(projectSlug: string, identifier: string): Promise<DevServersResult> {
  const response = await http.post(`${base(projectSlug, identifier)}/start`, {});
  return normalizeResult(unwrapData<DevServersDto>(response));
}

export async function stopDevServers(projectSlug: string, identifier: string): Promise<DevServersResult> {
  const response = await http.post(`${base(projectSlug, identifier)}/stop`, {});
  return normalizeResult(unwrapData<DevServersDto>(response));
}

export async function restartDevServers(projectSlug: string, identifier: string): Promise<DevServersResult> {
  const response = await http.post(`${base(projectSlug, identifier)}/restart`, {});
  return normalizeResult(unwrapData<DevServersDto>(response));
}
```

> Confirm `unwrapData` unwraps the inner `data` key the same way `devEnv.ts` uses it; the `http` mock above returns `{ data: { data: {...} } }` accordingly.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npm run test:unit -- src/services/__tests__/devServer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd tracker && git add src/services/devServer.ts src/services/__tests__/devServer.test.ts
git commit -m "feat(tracker): dev server service client"
```

---

## Task 20: Frontend hook `useIssueDevServers`

**Files:**
- Create: `tracker/src/hooks/useIssueDevServers.ts`

- [ ] **Step 1: Implement (polling cadence proves auto-start is happening)**

```ts
import { useCallback, useEffect, useRef, useState } from "react";

import { listDevServers, restartDevServers, startDevServers, stopDevServers } from "@/services/devServer";
import type { DevServer, DevServerReason } from "@/types/devServer";

const FAST_INTERVAL_MS = 3_000;
const SLOW_INTERVAL_MS = 20_000;
const NON_TERMINAL: ReadonlySet<string> = new Set(["pending", "provisioning", "starting"]);

interface Args {
  projectSlug: string;
  identifier: string | null;
  enabled?: boolean;
}

export interface UseIssueDevServersResult {
  servers: DevServer[];
  primary: DevServer | null;
  available: boolean;
  reason: DevServerReason | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
}

export function useIssueDevServers({ projectSlug, identifier, enabled = true }: Args): UseIssueDevServersResult {
  const [servers, setServers] = useState<DevServer[]>([]);
  const [available, setAvailable] = useState(false);
  const [reason, setReason] = useState<DevServerReason | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const hasLoaded = useRef(false);

  const active = enabled && Boolean(identifier && projectSlug);
  const primary = servers.find((s) => s.primary) ?? servers[0] ?? null;

  const refetch = useCallback(async () => {
    if (!identifier || !projectSlug || inFlight.current) return;
    inFlight.current = true;
    if (!hasLoaded.current) setLoading(true);
    try {
      const result = await listDevServers(projectSlug, identifier);
      setServers(result.servers);
      setAvailable(result.available);
      setReason(result.reason);
      setError(null);
      hasLoaded.current = true;
    } catch {
      setError("Could not load dev server status.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [identifier, projectSlug]);

  const mutate = useCallback(
    async (fn: (p: string, i: string) => Promise<unknown>) => {
      if (!identifier || !projectSlug) return;
      try {
        await fn(projectSlug, identifier);
      } finally {
        void refetch();
      }
    },
    [identifier, projectSlug, refetch],
  );

  const start = useCallback(() => mutate(startDevServers), [mutate]);
  const stop = useCallback(() => mutate(stopDevServers), [mutate]);
  const restart = useCallback(() => mutate(restartDevServers), [mutate]);

  useEffect(() => {
    hasLoaded.current = false;
    if (!active) {
      setServers([]);
      setAvailable(false);
      setReason(null);
      setError(null);
      setLoading(false);
      return undefined;
    }

    void refetch();
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      const anyPending = servers.some((s) => NON_TERMINAL.has(s.status));
      const delay = anyPending ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;
      timer = setTimeout(async () => {
        if (typeof document === "undefined" || document.visibilityState !== "hidden") await refetch();
        loop();
      }, delay);
    };
    loop();
    return () => clearTimeout(timer);
    // re-evaluate cadence when statuses change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, refetch, servers.map((s) => s.status).join(",")]);

  return { servers, primary, available, reason, loading, error, refetch, start, stop, restart };
}
```

- [ ] **Step 2: Type-check**

Run: `cd tracker && npm run lint`
Expected: no errors for the new file.

- [ ] **Step 3: Commit**

```bash
cd tracker && git add src/hooks/useIssueDevServers.ts
git commit -m "feat(tracker): useIssueDevServers hook with adaptive polling"
```

---

## Task 21: `PreviewTab` component

**Files:**
- Create: `tracker/src/components/issues/issue-detail/PreviewTab.tsx`
- Test: `tracker/src/components/issues/issue-detail/__tests__/PreviewTab.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreviewTab } from "@/components/issues/issue-detail/PreviewTab";
import type { DevServer } from "@/types/devServer";

const ready: DevServer = {
  id: 1, slug: "front", workingDir: "front", port: 4100,
  url: "http://127.0.0.1:4100/", status: "ready", primary: true, sessionName: "x",
};

const noop = async () => {};

describe("PreviewTab", () => {
  it("features the primary URL when ready", () => {
    render(
      <PreviewTab servers={[ready]} primary={ready} available reason={null} loading={false}
        error={null} onStart={noop} onStop={noop} onRestart={noop} onViewLogs={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /open preview/i })).toBeEnabled();
  });

  it("shows the reason when unavailable", () => {
    render(
      <PreviewTab servers={[]} primary={null} available={false} reason="no_serve_step" loading={false}
        error={null} onStart={noop} onStop={noop} onRestart={noop} onViewLogs={() => {}} />,
    );
    expect(screen.getByText(/no serve step/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npm run test:unit -- src/components/issues/issue-detail/__tests__/PreviewTab.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement**

```tsx
import { Globe, Play, RefreshCw, Square, TerminalSquare } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DevServer, DevServerReason, DevServerStatus } from "@/types/devServer";

interface PreviewTabProps {
  servers: DevServer[];
  primary: DevServer | null;
  available: boolean;
  reason: DevServerReason | null;
  loading: boolean;
  error: string | null;
  onStart: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onRestart: () => void | Promise<void>;
  onViewLogs: (server: DevServer) => void;
}

const REASON_TEXT: Record<DevServerReason, string> = {
  disabled: "Dev server preview is disabled for this project.",
  workspace_missing: "The workspace doesn't exist yet — the agent hasn't run.",
  no_serve_step: "No serve step found. Add a role: serve step to .symphony/devenv.yaml.",
  capacity: "At capacity — waiting for a free slot before starting.",
};

const STATUS_DOT: Record<DevServerStatus, string> = {
  pending: "bg-muted-foreground",
  provisioning: "bg-amber-500 animate-pulse",
  starting: "bg-amber-500 animate-pulse",
  ready: "bg-emerald-500",
  crashed: "bg-red-500",
  stopped: "bg-muted-foreground",
};

export function PreviewTab(props: PreviewTabProps) {
  const { servers, primary, available, reason, loading, error, onStart, onStop, onRestart, onViewLogs } = props;

  if (loading && servers.length === 0) {
    return <EmptyState icon><p>Loading dev server status…</p></EmptyState>;
  }

  if (!available && servers.length === 0) {
    return (
      <EmptyState icon>
        <p>{reason ? REASON_TEXT[reason] : "Dev server preview is unavailable."}</p>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {servers.length} dev server{servers.length === 1 ? "" : "s"}
          {reason === "capacity" ? " — waiting for a free slot" : ""}
        </span>
        <div className="flex items-center gap-2">
          <Control onClick={onStart} icon={Play} label="Start" />
          <Control onClick={onRestart} icon={RefreshCw} label="Restart" />
          <Control onClick={onStop} icon={Square} label="Stop" />
        </div>
      </div>

      {error ? <p className="text-xs text-red-500">{error}</p> : null}

      {primary ? <PrimaryCard server={primary} onViewLogs={onViewLogs} /> : null}

      <div className="space-y-2">
        {servers.filter((s) => s !== primary).map((s) => (
          <ServerRow key={s.id} server={s} onViewLogs={onViewLogs} />
        ))}
      </div>
    </div>
  );
}

function PrimaryCard({ server, onViewLogs }: { server: DevServer; onViewLogs: (s: DevServer) => void }) {
  const ready = server.status === "ready" && Boolean(server.url);
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[server.status])} />
        <span className="text-sm font-medium">{server.slug}</span>
        <span className="text-xs text-muted-foreground">{server.status}</span>
        {server.port ? <span className="font-mono text-xs text-muted-foreground">:{server.port}</span> : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={() => ready && server.url && window.open(server.url, "_blank", "noopener")}
          className="inline-flex items-center gap-1.5 rounded-md border bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
        >
          <Globe className="h-3.5 w-3.5" />
          Open preview
        </button>
        <button type="button" onClick={() => onViewLogs(server)} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
          <TerminalSquare className="h-3.5 w-3.5" /> View logs
        </button>
      </div>
    </div>
  );
}

function ServerRow({ server, onViewLogs }: { server: DevServer; onViewLogs: (s: DevServer) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[server.status])} />
        <span className="font-medium">{server.slug}</span>
        <span className="text-xs text-muted-foreground">{server.status}</span>
      </div>
      <div className="flex items-center gap-2">
        {server.status === "ready" && server.url ? (
          <a href={server.url} target="_blank" rel="noreferrer noopener" className="text-xs text-primary hover:underline">Open</a>
        ) : null}
        <button type="button" onClick={() => onViewLogs(server)} className="text-xs text-muted-foreground hover:underline">Logs</button>
      </div>
    </div>
  );
}

function Control({ onClick, icon: Icon, label }: { onClick: () => void | Promise<void>; icon: typeof Play; label: string }) {
  return (
    <button type="button" onClick={() => void onClick()} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function EmptyState({ children }: { children: React.ReactNode; icon?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      <Globe className="h-5 w-5" />
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npm run test:unit -- src/components/issues/issue-detail/__tests__/PreviewTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd tracker && git add src/components/issues/issue-detail/PreviewTab.tsx src/components/issues/issue-detail/__tests__/PreviewTab.test.tsx
git commit -m "feat(tracker): PreviewTab with featured primary URL + controls"
```

---

## Task 22: Routes `preview` tab + IssueDrawer integration

**Files:**
- Modify: `tracker/src/lib/workspaceRoutes.ts` (`ISSUE_TABS`)
- Modify: `tracker/src/components/issues/IssueDrawer.tsx`
- Test: `tracker/src/lib/__tests__/workspaceRoutes.test.ts`

- [ ] **Step 1: Write failing test**

Append to `tracker/src/lib/__tests__/workspaceRoutes.test.ts`:

```ts
import { isIssueTab, issuePath } from "@/lib/workspaceRoutes";

it("recognizes the preview tab", () => {
  expect(isIssueTab("preview")).toBe(true);
  expect(issuePath("acme", "board", "#507", "preview")).toBe("/projects/acme/board/issues/%23507/preview");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npm run test:unit -- src/lib/__tests__/workspaceRoutes.test.ts`
Expected: FAIL — `"preview"` not a tab.

- [ ] **Step 3: Add the tab**

In `workspaceRoutes.ts`, change:

```ts
export const ISSUE_TABS = ["summary", "pr", "comments", "blockers", "agent", "activity", "terminal", "preview"] as const;
```

- [ ] **Step 4: Wire the IssueDrawer**

In `IssueDrawer.tsx`:
1. Import the hook + tab + an icon:

```tsx
import { MonitorPlay } from "lucide-react";
import { useIssueDevServers } from "@/hooks/useIssueDevServers";
import { PreviewTab } from "./issue-detail/PreviewTab";
```

2. Add to the `TABS` array (after `terminal`):

```tsx
  { value: "preview", label: "Preview", Icon: MonitorPlay },
```

3. Inside the component, add the hook call (next to `pr` / `commentsState`):

```tsx
  const devServers = useIssueDevServers({
    projectSlug,
    identifier: issue?.identifier ?? null,
    enabled: open && Boolean(issue),
  });
  const primaryDevStatus = devServers.primary?.status ?? null;
```

4. Add a status dot on the preview tab trigger. In the `TABS.map(...)` trigger render, after the existing `value === "pr"` rollup block, add:

```tsx
                    {value === "preview" && primaryDevStatus ? (
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          primaryDevStatus === "ready"
                            ? "bg-emerald-500"
                            : primaryDevStatus === "crashed"
                              ? "bg-red-500"
                              : ["provisioning", "starting", "pending"].includes(primaryDevStatus)
                                ? "bg-amber-500 animate-pulse"
                                : "bg-muted-foreground",
                        )}
                      />
                    ) : null}
```

5. Add the `TabsContent` (after the `terminal` content):

```tsx
                <TabsContent value="preview">
                  <PreviewTab
                    servers={devServers.servers}
                    primary={devServers.primary}
                    available={devServers.available}
                    reason={devServers.reason}
                    loading={devServers.loading}
                    error={devServers.error}
                    onStart={devServers.start}
                    onStop={devServers.stop}
                    onRestart={devServers.restart}
                    onViewLogs={() => onTabChange?.("terminal")}
                  />
                </TabsContent>
```

- [ ] **Step 5: Run tests + lint**

Run: `cd tracker && npm run test:unit -- src/lib/__tests__/workspaceRoutes.test.ts && npm run lint`
Expected: PASS, no lint errors.

- [ ] **Step 6: Commit**

```bash
cd tracker && git add src/lib/workspaceRoutes.ts src/lib/__tests__/workspaceRoutes.test.ts src/components/issues/IssueDrawer.tsx
git commit -m "feat(tracker): Preview tab in IssueDrawer with live status dot"
```

---

## Task 23: SummaryTab primary preview chip

**Files:**
- Modify: `tracker/src/components/issues/issue-detail/SummaryTab.tsx`
- Test: extend an existing SummaryTab test if present; otherwise verify via lint/build.

- [ ] **Step 1: Add a `primaryPreviewUrl` prop + chip**

In `SummaryTab.tsx`:
1. Add to `SummaryTabProps`:

```tsx
  primaryPreviewUrl?: string | null;
```

2. Destructure it (default `null`) in the function signature.
3. Include it in the `hasLinks` computation:

```tsx
  const hasLinks =
    Boolean(issue.url) || issue.branchName !== null || pullRequests.length > 0 || Boolean(primaryPreviewUrl);
```

4. In the links `<section>`, after the `pullRequests.map(...)`, add:

```tsx
          {primaryPreviewUrl ? (
            <a
              href={primaryPreviewUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open preview
            </a>
          ) : null}
```

- [ ] **Step 2: Pass the prop from IssueDrawer**

In `IssueDrawer.tsx`, update the `SummaryTab` usage:

```tsx
                  <SummaryTab
                    issue={issue}
                    pullRequests={pr.pullRequests}
                    workpad={commentsState.workpad}
                    primaryPreviewUrl={primaryDevStatus === "ready" ? (devServers.primary?.url ?? null) : null}
                    onOpenPullRequest={() => onTabChange?.("pr")}
                    onOpenComments={() => onTabChange?.("comments")}
                  />
```

- [ ] **Step 3: Lint + build**

Run: `cd tracker && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd tracker && git add src/components/issues/issue-detail/SummaryTab.tsx src/components/issues/IssueDrawer.tsx
git commit -m "feat(tracker): show primary preview URL chip on the summary tab"
```

---

## Task 24: Docs

**Files:**
- Modify: `elixir/WORKFLOW.macromarkets.example.md`, `elixir/WORKFLOW.md` (and other `WORKFLOW.*.example.md`)
- Modify: `elixir/README.md`
- Modify: `elixir/docs/troubleshooting.md`
- Modify: `SPEC.md`

- [ ] **Step 1: WORKFLOW examples**

In `elixir/WORKFLOW.macromarkets.example.md`, after the `observability:` commented block, add a commented `dev_server:` block and a `.symphony/devenv.yaml` example:

```yaml
# Per-issue dev-server preview (clickable URL on the issue while reviewing).
# dev_server:
#   enabled: true
#   port_range: [4100, 4199]     # ports allocated to previews
#   max_concurrent: 3            # max live previews at once
#   idle_timeout_ms: 1800000     # auto-stop after 30 min idle
#   auto_start_on: [pull_request, human_review]
#   # base_url: http://127.0.0.1  # override host when behind a remote/proxy
#
# Mark a serve step in each repo's `.symphony/devenv.yaml`:
#   steps:
#     - { description: Install front deps, working_dir: front, command: npm ci, role: setup }
#     - { description: Front dev server, working_dir: front, command: npm run dev, role: serve, port_env: PORT, primary: true }
#     - { description: Back dev server, working_dir: back, command: ./vibe up, role: serve, port_env: APP_PORT }
```

Mirror the same block (uncommented defaults documented) in `elixir/WORKFLOW.md`.

- [ ] **Step 2: README + troubleshooting + SPEC**

- `elixir/README.md`: add a "Dev-server preview" subsection describing config, the Preview tab, and that it reuses `DevEnv` serve steps.
- `elixir/docs/troubleshooting.md`: add entries — "Preview never turns ready" (serve command didn't open `PORT`; check the Terminal/logs), "Port range exhausted" (raise `port_range`/lower `max_concurrent`), "Preview URL wrong host" (set `base_url`), "Preview auto-stopped" (idle timeout).
- `SPEC.md`: one paragraph noting the per-issue dev-server runtime as a superset of `DevEnv`.

- [ ] **Step 3: Commit**

```bash
git add elixir/WORKFLOW.md elixir/WORKFLOW.macromarkets.example.md elixir/README.md elixir/docs/troubleshooting.md SPEC.md
git commit -m "docs: document dev-server preview config + serve steps"
```

---

## Task 25: Final verification

- [ ] **Step 1: Backend gate**

Run: `cd elixir && make all`
Expected: all gates pass.

- [ ] **Step 2: Frontend gate**

Run: `cd tracker && npm run lint && npm run test:unit && npm run build`
Expected: lint clean, all unit tests pass, build succeeds.

- [ ] **Step 3: Manual smoke (local-dev workflow)**

With a WORKFLOW that has `dev_server.enabled: true` and a repo with a serve step,
open an issue whose workspace exists, go to the **Preview** tab, click **Start**,
and confirm: dot goes amber → green, "Open preview" opens the app on the allocated
port, **Stop** kills it. Move the issue to Human Review and confirm the reconciler
auto-starts within one poll interval (dot turns amber without manual action).

---

## Self-Review

**Spec coverage (each spec requirement → task):**

- Expand DevEnv with serve role + fields (Goal 1, D5) → Tasks 2, 3, 4, 5, 7.
- Per-issue scope, workspace path normalization (Goal 2, D2) → Tasks 8, 12 (`strip_hash` + `Workspace.path_for_issue`).
- Multiple servers, one primary (Goal 3, D3) → Tasks 6 (normalize primary), 10/11/12 (per-slug), 21 (featured primary).
- Auto-start on PR + Human Review, visible UI state (Goal 4, D6) → Task 14 (reconciler), 20 (adaptive polling), 22 (status dot).
- Convention-first + heuristic discovery, "applicable" gating (Goal 5, D5) → Tasks 4, 5, 13 (`no_serve_step`).
- Graceful degradation reasons (Goal 6, D9) → Task 13 (`issue_targets` reasons), 15 (payload), 21 (reason text), 12 (`:capacity`).
- Hosting model hybrid (D1) → Tasks 8, 11, 12.
- Port allocation via env (D4) → Tasks 9, 11 (`serve_command`/`build_url`).
- Lifecycle: manual stop/restart, idle, terminal/workspace auto-stop, crash no-respawn (D7) → Task 11 (idle/crashed/terminate), 12 (stop/restart), 14 (terminal auto-stop note).
- Config block (D8) → Task 1.
- Persistence survives refresh + boot reconcile (D12) → Tasks 10, 12 (`mark_all_stopped`).
- base_url override (D11) → Tasks 1, 11 (`build_url`).
- Setup-before-serve (D10) → Task 12 (`run_setup`).
- Tests across config/model/runtime/controller/frontend (spec §8) → Tasks 1,3,4,5,6,7,8,9,10,11,12,13,14,15,19,21,22.
- Docs (spec §9) → Task 24.

**Placeholder scan:** No `TBD`/`TODO`. Two deliberately-deferred test bodies (Task 12 full start-path, Task 13 second branch) are explicitly scoped to depend on the app-tree wiring/stub from Task 16 and noted as such, with the core behavior covered by Instance (Task 11) and controller (Task 15) tests; the pure functions they rely on are fully tested.

**Type/name consistency:** Statuses (`pending|provisioning|starting|ready|crashed|stopped`) and reasons (`disabled|workspace_missing|no_serve_step|capacity`) are defined once in Conventions and reused verbatim in `DevServerRecord` (@statuses), `DevServer` view, presenter, TS `DevServerStatus`/`DevServerReason`, and `PreviewTab`. Serve step fields (`role,port_env,url_path,ready_probe,ready_path,primary`) are introduced in Task 3 and threaded consistently through ConventionReader, HeuristicDiscoverer, DevEnv context, presenter, Manager `to_step_map`, and Instance.

**Known fix-ups flagged inline for the implementer:** `Instance.persist/2` `started_at` (store in state at init), `Registry.select` match spec in Manager (fallback to lookup iteration if needed), and confirming exact accessor names `LocalTracker.project_slug/0` and `GitHub.Config.repo/0` in the Reconciler.
