# Dev-Environment Discovery Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent/focused session per task with review between tasks, or **(B)** inline execution with checkpoints. Backend uses `mix` (via `mise exec --` if configured); quality gate is `cd elixir && mise exec -- mix all`. Frontend uses `npm` from `tracker/`; tests via `cd tracker && npm test`.

**Goal:** Deliver Slice D of the MVP: after a project/repository is saved, Symphony **proposes** dev-environment setup steps (convention files first, then heuristics), lets the user review/edit/persist them, and **executes** each step inside a project-scoped tmux session surfaced through the embedded terminal — with run history persisted.

**Architecture:** New Ecto schemas `DevEnvStep`, `DevEnvRun`, `DevEnvStepRun` under a new `LocalTracker.DevEnv` context. A `DevEnv.Proposer` orchestrates discovery: `DevEnv.ConventionReader` (parses `.symphony/devenv.yaml` / `.symphony/devenv.md` in each repo root) takes precedence; `DevEnv.HeuristicDiscoverer` (reuses `RepositoryScanner` + scans mise/Docker Compose/`.env.example`/`README`) fills gaps. Execution reuses the tmux abstraction: a new `Terminal.Registry.open_project_session/2` creates a `sym-devenv-<slug>` session; `DevEnv.Runner` sends a step's command into it and records a `DevEnvStepRun`. A new `TerminalChannel` join clause (`terminal:devenv:<slug>`) lets the frontend attach to the session. New REST endpoints expose propose/list/save/run/runs. Frontend gains a Dev Env panel on the project view with a "Propose steps" action, editable step list, per-step Run buttons, and terminal attach.

**Tech Stack:** Elixir 1.19 / OTP 28, Phoenix 1.7, Ecto + `ecto_sqlite3`, `yaml_elixir`, tmux. React 18 + TypeScript + Vite, react-router-dom v6, shadcn primitives, sonner, Vitest + Testing Library, Phoenix JS socket.

**Spec:** `docs/superpowers/specs/2026-05-28-dev-environment-discovery-design.md`

**Depends on:** None hard. Reuses `RepositoryScanner`, `Terminal.Registry`/`Tmux`, `TerminalChannel`. Slice C's repos (workspace paths) make discovery more useful but are not required.

**Refinement of spec:** Execution runs in a **project-scoped** tmux session (`terminal:devenv:<slug>`) rather than per-issue, matching the user's choice "execute in terminal". Convention files are required-first per the user's "B + README" + "convention_first" decisions: if a repo has `.symphony/devenv.{yaml,md}`, those steps win; README/heuristics only fill in when no convention file exists.

---

## Branch Setup

- [ ] **Step 0: Create a feature branch**

```bash
cd /home/raphaelcangucu/symphony
git status
git checkout -b feat/dev-environment-discovery
```

Expected: branch exists, tree clean. (Confirm `:yaml_elixir` is a dependency in `elixir/mix.exs`; if not, add `{:yaml_elixir, "~> 2.9"}` and `mise exec -- mix deps.get`, commit `mix.exs`/`mix.lock`.)

---

## File Structure (Backend)

| Action | Path | Owns |
|---|---|---|
| Create | `elixir/priv/repo/migrations/20260528180000_create_dev_env.exs` | 3 tables |
| Create | `elixir/lib/symphony_elixir/local_tracker/dev_env/step.ex` | DevEnvStep schema |
| Create | `elixir/lib/symphony_elixir/local_tracker/dev_env/run.ex` | DevEnvRun schema |
| Create | `elixir/lib/symphony_elixir/local_tracker/dev_env/step_run.ex` | DevEnvStepRun schema |
| Create | `elixir/lib/symphony_elixir/local_tracker/dev_env/proposed_step.ex` | Plain struct for proposals |
| Create | `elixir/lib/symphony_elixir/local_tracker/dev_env/convention_reader.ex` | parse `.symphony/devenv.*` |
| Create | `elixir/lib/symphony_elixir/local_tracker/dev_env/heuristic_discoverer.ex` | mise/compose/env/README |
| Create | `elixir/lib/symphony_elixir/local_tracker/dev_env/proposer.ex` | convention-first orchestration |
| Create | `elixir/lib/symphony_elixir/local_tracker/dev_env.ex` | context: persist + runs |
| Create | `elixir/lib/symphony_elixir/local_tracker/dev_env/runner.ex` | execute step in tmux + record |
| Modify | `elixir/lib/symphony_elixir/terminal/registry.ex` | `open_project_session/2`, `send_input_project/3`, `capture_project/2` |
| Modify | `elixir/lib/symphony_elixir_web/channels/terminal_channel.ex` | `terminal:devenv:<slug>` join clause |
| Create | `elixir/lib/symphony_elixir_web/presenters/dev_env_presenter.ex` | step/run/proposal DTOs |
| Create | `elixir/lib/symphony_elixir_web/controllers/tracker/dev_env_controller.ex` | endpoints |
| Modify | `elixir/lib/symphony_elixir_web/router.ex` | routes |
| Tests | (one per module below) | |

## File Structure (Frontend)

| Action | Path | Owns |
|---|---|---|
| Create | `tracker/src/types/devEnv.ts` | types |
| Create | `tracker/src/services/devEnv.ts` | propose/list/save/run/runs |
| Create | `tracker/src/services/__tests__/devEnv.test.ts` | |
| Create | `tracker/src/components/devenv/DevEnvPanel.tsx` | proposal + editable list + run |
| Create | `tracker/src/components/devenv/DevEnvStepRow.tsx` | one step |
| Create | `tracker/src/components/devenv/__tests__/DevEnvPanel.test.tsx` | |
| Modify | `tracker/src/pages/ProjectBoardPage.tsx` (or a project settings/overview page) | mount panel |
| Modify | `tracker/src/components/projects/ProjectWorkspaceWizard.tsx` | post-create "propose steps" prompt |

---

## Task 1 — Migration: dev-env tables

**Files:**
- Create: `elixir/priv/repo/migrations/20260528180000_create_dev_env.exs`
- Test: extend `elixir/test/symphony_elixir/local_tracker/migrations_test.exs`

- [ ] **Step 1.1: Write the migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateDevEnv do
  use Ecto.Migration

  def change do
    create table(:local_tracker_dev_env_steps) do
      add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
      add :description, :string, null: false
      add :command, :text, null: false
      add :working_dir, :string
      add :position, :integer, null: false, default: 0
      add :source, :string, null: false, default: "manual"
      add :optional, :boolean, null: false, default: false
      timestamps(type: :utc_datetime_usec)
    end

    create index(:local_tracker_dev_env_steps, [:project_id])

    create table(:local_tracker_dev_env_runs) do
      add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
      add :status, :string, null: false, default: "pending"
      add :started_at, :utc_datetime_usec
      add :completed_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec)
    end

    create index(:local_tracker_dev_env_runs, [:project_id])

    create table(:local_tracker_dev_env_step_runs) do
      add :run_id, references(:local_tracker_dev_env_runs, on_delete: :delete_all), null: false
      add :step_id, references(:local_tracker_dev_env_steps, on_delete: :nilify_all)
      add :description, :string, null: false
      add :command, :text, null: false
      add :status, :string, null: false, default: "pending"
      add :exit_code, :integer
      add :output, :text
      add :started_at, :utc_datetime_usec
      add :completed_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec)
    end

    create index(:local_tracker_dev_env_step_runs, [:run_id])
  end
end
```

- [ ] **Step 1.2: Append migration assertion**

```elixir
  test "dev env tables exist" do
    migrate_repo()
    for t <- ["local_tracker_dev_env_steps", "local_tracker_dev_env_runs", "local_tracker_dev_env_step_runs"] do
      assert %{rows: _} = Repo.query!("SELECT 1 FROM #{t} LIMIT 1")
    end
  end
```

- [ ] **Step 1.3: Run**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/migrations_test.exs`
Expected: PASS.

- [ ] **Step 1.4: Commit**

```bash
git add elixir/priv/repo/migrations/20260528180000_create_dev_env.exs elixir/test/symphony_elixir/local_tracker/migrations_test.exs
git commit -m "feat(local-tracker): create dev-env step/run tables"
```

---

## Task 2 — DevEnv schemas

**Files:**
- Create: `step.ex`, `run.ex`, `step_run.ex` under `elixir/lib/symphony_elixir/local_tracker/dev_env/`
- Test: `elixir/test/symphony_elixir/local_tracker/dev_env/step_test.exs`

- [ ] **Step 2.1: Write the failing test**

Create `elixir/test/symphony_elixir/local_tracker/dev_env/step_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv.StepTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.DevEnv.Step

  test "requires description and command" do
    refute Step.changeset(%Step{}, %{project_id: 1}).valid?
  end

  test "validates source inclusion" do
    refute Step.changeset(%Step{}, %{project_id: 1, description: "d", command: "c", source: "bogus"}).valid?
    assert Step.changeset(%Step{}, %{project_id: 1, description: "d", command: "c", source: "convention"}).valid?
  end
end
```

- [ ] **Step 2.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/dev_env/step_test.exs`
Expected: FAIL — schema missing.

- [ ] **Step 2.3: Implement the schemas**

Create `elixir/lib/symphony_elixir/local_tracker/dev_env/step.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv.Step do
  @moduledoc "A persisted dev-environment setup step for a project."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}
  @sources ~w(convention readme heuristic manual)

  schema "local_tracker_dev_env_steps" do
    field(:description, :string)
    field(:command, :string)
    field(:working_dir, :string)
    field(:position, :integer, default: 0)
    field(:source, :string, default: "manual")
    field(:optional, :boolean, default: false)

    belongs_to(:project, Project)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(step, attrs) do
    step
    |> cast(attrs, [:project_id, :description, :command, :working_dir, :position, :source, :optional])
    |> validate_required([:project_id, :description, :command])
    |> validate_inclusion(:source, @sources)
  end

  @spec sources() :: [String.t()]
  def sources, do: @sources
end
```

Create `elixir/lib/symphony_elixir/local_tracker/dev_env/run.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv.Run do
  @moduledoc "A grouped execution of dev-env steps."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.DevEnv.StepRun
  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}
  @statuses ~w(pending running succeeded failed)

  schema "local_tracker_dev_env_runs" do
    field(:status, :string, default: "pending")
    field(:started_at, :utc_datetime_usec)
    field(:completed_at, :utc_datetime_usec)

    belongs_to(:project, Project)
    has_many(:step_runs, StepRun, foreign_key: :run_id, on_delete: :delete_all)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(run, attrs) do
    run
    |> cast(attrs, [:project_id, :status, :started_at, :completed_at])
    |> validate_required([:project_id, :status])
    |> validate_inclusion(:status, @statuses)
  end
end
```

Create `elixir/lib/symphony_elixir/local_tracker/dev_env/step_run.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv.StepRun do
  @moduledoc "Execution record of a single dev-env step within a run."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.DevEnv.{Run, Step}

  @type t :: %__MODULE__{}
  @statuses ~w(pending running succeeded failed skipped)

  schema "local_tracker_dev_env_step_runs" do
    field(:description, :string)
    field(:command, :string)
    field(:status, :string, default: "pending")
    field(:exit_code, :integer)
    field(:output, :string)
    field(:started_at, :utc_datetime_usec)
    field(:completed_at, :utc_datetime_usec)

    belongs_to(:run, Run)
    belongs_to(:step, Step)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(step_run, attrs) do
    step_run
    |> cast(attrs, [:run_id, :step_id, :description, :command, :status, :exit_code, :output, :started_at, :completed_at])
    |> validate_required([:run_id, :description, :command, :status])
    |> validate_inclusion(:status, @statuses)
  end
end
```

- [ ] **Step 2.4: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/dev_env/step_test.exs`
Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/dev_env/step.ex elixir/lib/symphony_elixir/local_tracker/dev_env/run.ex elixir/lib/symphony_elixir/local_tracker/dev_env/step_run.ex elixir/test/symphony_elixir/local_tracker/dev_env/step_test.exs
git commit -m "feat(local-tracker): add dev-env step/run schemas"
```

---

## Task 3 — ProposedStep struct + ConventionReader

**Files:**
- Create: `elixir/lib/symphony_elixir/local_tracker/dev_env/proposed_step.ex`
- Create: `elixir/lib/symphony_elixir/local_tracker/dev_env/convention_reader.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/dev_env/convention_reader_test.exs`

- [ ] **Step 3.1: Write the failing test**

Create `elixir/test/symphony_elixir/local_tracker/dev_env/convention_reader_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv.ConventionReaderTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.DevEnv.{ConventionReader, ProposedStep}

  setup do
    root = Path.join(System.tmp_dir!(), "devenv-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(root, ".symphony"))
    on_exit(fn -> File.rm_rf!(root) end)
    %{root: root}
  end

  test "reads yaml convention", %{root: root} do
    File.write!(Path.join(root, ".symphony/devenv.yaml"), """
    steps:
      - description: Install deps
        command: mix deps.get
        working_dir: api
      - description: Migrate
        command: mix ecto.migrate
    """)

    assert {:ok, steps} = ConventionReader.read(root)
    assert [%ProposedStep{description: "Install deps", command: "mix deps.get", working_dir: "api", source: "convention"} | _] = steps
    assert length(steps) == 2
  end

  test "reads markdown convention fenced bash", %{root: root} do
    File.write!(Path.join(root, ".symphony/devenv.md"), """
    # Setup

    Install dependencies:

    ```bash
    mix deps.get
    ```

    Run migrations:

    ```bash
    mix ecto.migrate
    ```
    """)

    assert {:ok, steps} = ConventionReader.read(root)
    assert Enum.map(steps, & &1.command) == ["mix deps.get", "mix ecto.migrate"]
    assert Enum.all?(steps, &(&1.source == "convention"))
  end

  test "returns :none when no convention file", %{root: root} do
    assert ConventionReader.read(root) == :none
  end
end
```

- [ ] **Step 3.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/dev_env/convention_reader_test.exs`
Expected: FAIL — modules missing.

- [ ] **Step 3.3: Implement ProposedStep**

Create `elixir/lib/symphony_elixir/local_tracker/dev_env/proposed_step.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv.ProposedStep do
  @moduledoc "An ephemeral, un-persisted dev-env step proposal."

  @enforce_keys [:description, :command, :source]
  defstruct [:description, :command, :working_dir, :source, optional: false]

  @type t :: %__MODULE__{
          description: String.t(),
          command: String.t(),
          working_dir: String.t() | nil,
          source: String.t(),
          optional: boolean()
        }

  @spec new(map()) :: t()
  def new(attrs) when is_map(attrs) do
    %__MODULE__{
      description: fetch(attrs, :description),
      command: fetch(attrs, :command),
      working_dir: get(attrs, :working_dir),
      source: get(attrs, :source) || "manual",
      optional: get(attrs, :optional) || false
    }
  end

  defp fetch(attrs, key), do: Map.get(attrs, key) || Map.get(attrs, Atom.to_string(key)) || raise(ArgumentError, "missing #{key}")
  defp get(attrs, key), do: Map.get(attrs, key, Map.get(attrs, Atom.to_string(key)))
end
```

- [ ] **Step 3.4: Implement ConventionReader**

Create `elixir/lib/symphony_elixir/local_tracker/dev_env/convention_reader.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv.ConventionReader do
  @moduledoc "Reads `.symphony/devenv.yaml` or `.symphony/devenv.md` from a repo root."

  alias SymphonyElixir.LocalTracker.DevEnv.ProposedStep

  @yaml_names [".symphony/devenv.yaml", ".symphony/devenv.yml"]
  @md_name ".symphony/devenv.md"

  @spec read(Path.t()) :: {:ok, [ProposedStep.t()]} | :none | {:error, term()}
  def read(repo_root) when is_binary(repo_root) do
    cond do
      path = first_existing(repo_root, @yaml_names) -> read_yaml(path)
      File.exists?(Path.join(repo_root, @md_name)) -> read_markdown(Path.join(repo_root, @md_name))
      true -> :none
    end
  end

  defp first_existing(root, names) do
    Enum.find_value(names, fn name ->
      path = Path.join(root, name)
      if File.exists?(path), do: path
    end)
  end

  defp read_yaml(path) do
    with {:ok, content} <- File.read(path),
         {:ok, %{"steps" => steps}} when is_list(steps) <- YamlElixir.read_from_string(content) do
      {:ok, Enum.map(steps, &to_proposed/1)}
    else
      {:ok, _} -> {:error, :invalid_convention}
      {:error, reason} -> {:error, reason}
    end
  rescue
    _ -> {:error, :invalid_convention}
  end

  defp to_proposed(map) do
    ProposedStep.new(%{
      "description" => Map.get(map, "description", Map.get(map, "command", "step")),
      "command" => Map.fetch!(map, "command"),
      "working_dir" => Map.get(map, "working_dir"),
      "source" => "convention",
      "optional" => Map.get(map, "optional", false)
    })
  end

  defp read_markdown(path) do
    with {:ok, content} <- File.read(path) do
      steps =
        content
        |> extract_bash_blocks()
        |> Enum.flat_map(&split_commands/1)
        |> Enum.map(fn command ->
          ProposedStep.new(%{description: command, command: command, source: "convention"})
        end)

      {:ok, steps}
    end
  end

  defp extract_bash_blocks(content) do
    ~r/```(?:bash|sh|shell)?\n(.*?)```/s
    |> Regex.scan(content, capture: :all_but_first)
    |> Enum.map(fn [block] -> String.trim(block) end)
  end

  defp split_commands(block) do
    block
    |> String.split("\n")
    |> Enum.map(&String.trim/1)
    |> Enum.reject(fn line -> line == "" or String.starts_with?(line, "#") end)
  end
end
```

- [ ] **Step 3.5: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/dev_env/convention_reader_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 3.6: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/dev_env/proposed_step.ex elixir/lib/symphony_elixir/local_tracker/dev_env/convention_reader.ex elixir/test/symphony_elixir/local_tracker/dev_env/convention_reader_test.exs
git commit -m "feat(dev-env): convention file reader for devenv.yaml/md"
```

---

## Task 4 — HeuristicDiscoverer

**Files:**
- Create: `elixir/lib/symphony_elixir/local_tracker/dev_env/heuristic_discoverer.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/dev_env/heuristic_discoverer_test.exs`

- [ ] **Step 4.1: Read the existing scanner first**

Read `elixir/lib/symphony_elixir/local_tracker/repository_scanner.ex` to learn its public function (e.g. `scan/1` returning stack/package_manager/scripts) so the discoverer reuses it rather than re-detecting.

- [ ] **Step 4.2: Write the failing test**

Create `elixir/test/symphony_elixir/local_tracker/dev_env/heuristic_discoverer_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv.HeuristicDiscovererTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.DevEnv.{HeuristicDiscoverer, ProposedStep}

  setup do
    root = Path.join(System.tmp_dir!(), "heur-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    on_exit(fn -> File.rm_rf!(root) end)
    %{root: root}
  end

  test "proposes mise install when .mise.toml present", %{root: root} do
    File.write!(Path.join(root, ".mise.toml"), "[tools]\nerlang = \"28\"\n")
    steps = HeuristicDiscoverer.discover(root)
    assert Enum.any?(steps, &(&1.command == "mise install"))
    assert Enum.all?(steps, &match?(%ProposedStep{source: "heuristic"}, &1))
  end

  test "proposes docker compose up when compose file present", %{root: root} do
    File.write!(Path.join(root, "docker-compose.yml"), "services: {}\n")
    steps = HeuristicDiscoverer.discover(root)
    assert Enum.any?(steps, &(&1.command =~ "docker compose"))
  end

  test "proposes env copy when .env.example present", %{root: root} do
    File.write!(Path.join(root, ".env.example"), "KEY=1\n")
    steps = HeuristicDiscoverer.discover(root)
    assert Enum.any?(steps, &(&1.command == "cp .env.example .env"))
  end

  test "returns empty list for an empty repo", %{root: root} do
    assert HeuristicDiscoverer.discover(root) == []
  end
end
```

- [ ] **Step 4.3: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/dev_env/heuristic_discoverer_test.exs`
Expected: FAIL — module missing.

- [ ] **Step 4.4: Implement the discoverer**

Create `elixir/lib/symphony_elixir/local_tracker/dev_env/heuristic_discoverer.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv.HeuristicDiscoverer do
  @moduledoc """
  Proposes dev-env steps from repo conventions when no `.symphony/devenv.*` exists:
  mise, Docker Compose, `.env.example`, and package-manager install/test scripts.
  """

  alias SymphonyElixir.LocalTracker.DevEnv.ProposedStep

  @compose_files ~w(docker-compose.yml docker-compose.yaml compose.yml compose.yaml)

  @spec discover(Path.t()) :: [ProposedStep.t()]
  def discover(repo_root) when is_binary(repo_root) do
    [
      mise_step(repo_root),
      env_step(repo_root),
      install_step(repo_root),
      compose_step(repo_root)
    ]
    |> Enum.reject(&is_nil/1)
  end

  defp mise_step(root) do
    if exists_any?(root, [".mise.toml", "mise.toml", ".tool-versions"]) do
      step("Install tool versions", "mise install")
    end
  end

  defp env_step(root) do
    if File.exists?(Path.join(root, ".env.example")) do
      step("Create .env from example", "cp .env.example .env", optional: true)
    end
  end

  defp compose_step(root) do
    if exists_any?(root, @compose_files) do
      step("Start Docker services", "docker compose up -d", optional: true)
    end
  end

  defp install_step(root) do
    cond do
      File.exists?(Path.join(root, "mix.exs")) -> step("Fetch Elixir deps", "mix deps.get")
      File.exists?(Path.join(root, "pnpm-lock.yaml")) -> step("Install JS deps", "pnpm install")
      File.exists?(Path.join(root, "yarn.lock")) -> step("Install JS deps", "yarn install")
      File.exists?(Path.join(root, "package-lock.json")) -> step("Install JS deps", "npm ci")
      File.exists?(Path.join(root, "package.json")) -> step("Install JS deps", "npm install")
      File.exists?(Path.join(root, "requirements.txt")) -> step("Install Python deps", "pip install -r requirements.txt")
      File.exists?(Path.join(root, "Gemfile")) -> step("Install Ruby deps", "bundle install")
      File.exists?(Path.join(root, "go.mod")) -> step("Download Go modules", "go mod download")
      File.exists?(Path.join(root, "Cargo.toml")) -> step("Fetch Rust crates", "cargo fetch")
      true -> nil
    end
  end

  defp exists_any?(root, names), do: Enum.any?(names, &File.exists?(Path.join(root, &1)))

  defp step(description, command, opts \\ []) do
    ProposedStep.new(%{
      description: description,
      command: command,
      source: "heuristic",
      optional: Keyword.get(opts, :optional, false)
    })
  end
end
```

- [ ] **Step 4.5: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/dev_env/heuristic_discoverer_test.exs`
Expected: PASS (4 tests).

- [ ] **Step 4.6: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/dev_env/heuristic_discoverer.ex elixir/test/symphony_elixir/local_tracker/dev_env/heuristic_discoverer_test.exs
git commit -m "feat(dev-env): heuristic step discovery (mise/compose/env/install)"
```

---

## Task 5 — Proposer (convention-first across repos)

**Files:**
- Create: `elixir/lib/symphony_elixir/local_tracker/dev_env/proposer.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/dev_env/proposer_test.exs`

- [ ] **Step 5.1: Write the failing test**

Create `elixir/test/symphony_elixir/local_tracker/dev_env/proposer_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv.ProposerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.DevEnv.Proposer

  setup do
    root = Path.join(System.tmp_dir!(), "prop-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(root, "api"))
    File.mkdir_p!(Path.join(root, "web"))
    on_exit(fn -> File.rm_rf!(root) end)
    %{root: root}
  end

  test "convention file wins over heuristics for that repo", %{root: root} do
    File.mkdir_p!(Path.join(root, "api/.symphony"))
    File.write!(Path.join(root, "api/.symphony/devenv.yaml"), "steps:\n  - command: make setup\n")
    File.write!(Path.join(root, "api/mix.exs"), "defmodule X do\nend\n")

    steps = Proposer.propose(root, [%{workspace_path: "api", github_full_name: "g/api"}])
    api_commands = Enum.map(steps, & &1.command)
    assert "make setup" in api_commands
    refute "mix deps.get" in api_commands
    assert Enum.all?(steps, &(&1.working_dir == "api"))
  end

  test "falls back to heuristics when no convention", %{root: root} do
    File.write!(Path.join(root, "web/package.json"), "{}")
    steps = Proposer.propose(root, [%{workspace_path: "web", github_full_name: "g/web"}])
    assert Enum.any?(steps, &(&1.command == "npm install"))
    assert Enum.all?(steps, &(&1.working_dir == "web"))
  end

  test "merges multiple repos preserving order", %{root: root} do
    File.write!(Path.join(root, "api/mix.exs"), "x")
    File.write!(Path.join(root, "web/package.json"), "{}")

    steps =
      Proposer.propose(root, [
        %{workspace_path: "api", github_full_name: "g/api"},
        %{workspace_path: "web", github_full_name: "g/web"}
      ])

    dirs = steps |> Enum.map(& &1.working_dir) |> Enum.uniq()
    assert dirs == ["api", "web"]
  end
end
```

- [ ] **Step 5.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/dev_env/proposer_test.exs`
Expected: FAIL — module missing.

- [ ] **Step 5.3: Implement the Proposer**

Create `elixir/lib/symphony_elixir/local_tracker/dev_env/proposer.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv.Proposer do
  @moduledoc """
  Proposes dev-env steps for a project workspace, convention-first.

  For each repository: if a `.symphony/devenv.*` convention file exists, its steps
  are used verbatim; otherwise heuristics fill in. Every proposed step is tagged
  with the repo's `working_dir`.
  """

  alias SymphonyElixir.LocalTracker.DevEnv.{ConventionReader, HeuristicDiscoverer, ProposedStep}

  @type repo :: %{required(:workspace_path) => String.t(), optional(:github_full_name) => String.t()}

  @spec propose(Path.t(), [repo()]) :: [ProposedStep.t()]
  def propose(workspace_root, repositories) when is_binary(workspace_root) and is_list(repositories) do
    Enum.flat_map(repositories, fn repo ->
      workspace_path = Map.get(repo, :workspace_path) || Map.get(repo, "workspace_path")
      repo_root = Path.join(workspace_root, workspace_path)

      repo_root
      |> steps_for_repo()
      |> Enum.map(&with_working_dir(&1, workspace_path))
    end)
  end

  defp steps_for_repo(repo_root) do
    case ConventionReader.read(repo_root) do
      {:ok, steps} when steps != [] -> steps
      _ -> HeuristicDiscoverer.discover(repo_root)
    end
  end

  defp with_working_dir(%ProposedStep{working_dir: nil} = step, workspace_path) do
    %{step | working_dir: workspace_path}
  end

  defp with_working_dir(%ProposedStep{} = step, _workspace_path), do: step
end
```

> Note: convention steps that specified their own `working_dir` (relative to the repo) keep it; this plan keeps the repo's `workspace_path` for steps that did not set one. If a convention `working_dir` should be joined under the repo path, adjust `with_working_dir` accordingly — the test uses convention steps without a `working_dir`, so they inherit `api`.

- [ ] **Step 5.4: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/dev_env/proposer_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5.5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/dev_env/proposer.ex elixir/test/symphony_elixir/local_tracker/dev_env/proposer_test.exs
git commit -m "feat(dev-env): convention-first multi-repo step proposer"
```

---

## Task 6 — DevEnv context: propose + persist + runs

**Files:**
- Create: `elixir/lib/symphony_elixir/local_tracker/dev_env.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/dev_env_test.exs`

- [ ] **Step 6.1: Write the failing test**

Create `elixir/test/symphony_elixir/local_tracker/dev_env_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnvTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, DevEnv}
  alias SymphonyElixir.Repo

  setup do
    {:ok, _repo, _apps} = Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)

    for t <- ["local_tracker_dev_env_step_runs", "local_tracker_dev_env_runs", "local_tracker_dev_env_steps", "local_tracker_repositories", "local_tracker_projects"] do
      Repo.query!("delete from #{t}")
    end

    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "P", "slug" => "p",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [], "setup" => %{}
      })

    %{project: project}
  end

  test "save_steps persists ordered steps", %{project: _project} do
    assert {:ok, steps} =
             DevEnv.save_steps("p", [
               %{"description" => "Install", "command" => "mix deps.get", "source" => "manual"},
               %{"description" => "Migrate", "command" => "mix ecto.migrate", "source" => "manual"}
             ])

    assert Enum.map(steps, & &1.position) == [0, 1]
    assert DevEnv.list_steps("p") |> Enum.map(& &1.command) == ["mix deps.get", "mix ecto.migrate"]
  end

  test "save_steps replaces previous steps", %{project: _project} do
    {:ok, _} = DevEnv.save_steps("p", [%{"description" => "A", "command" => "a", "source" => "manual"}])
    {:ok, _} = DevEnv.save_steps("p", [%{"description" => "B", "command" => "b", "source" => "manual"}])
    assert DevEnv.list_steps("p") |> Enum.map(& &1.command) == ["b"]
  end

  test "start_run + record_step_result tracks status", %{project: _project} do
    {:ok, [step]} = DevEnv.save_steps("p", [%{"description" => "A", "command" => "a", "source" => "manual"}])
    {:ok, run} = DevEnv.start_run("p")
    {:ok, step_run} = DevEnv.record_step_result(run, step, %{status: "succeeded", exit_code: 0, output: "ok"})
    assert step_run.status == "succeeded"

    {:ok, finished} = DevEnv.finish_run(run)
    assert finished.status in ["succeeded", "failed"]
  end
end
```

- [ ] **Step 6.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/dev_env_test.exs`
Expected: FAIL — context missing.

- [ ] **Step 6.3: Implement the context**

Create `elixir/lib/symphony_elixir/local_tracker/dev_env.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv do
  @moduledoc "Persistence + run tracking for project dev-environment steps."

  import Ecto.Query

  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.DevEnv.{Proposer, ProposedStep, Run, Step, StepRun}
  alias SymphonyElixir.Repo

  @type error :: :project_not_found | Ecto.Changeset.t()

  @spec propose_steps(String.t()) :: {:ok, [ProposedStep.t()]} | {:error, :project_not_found}
  def propose_steps(project_slug) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      repositories =
        project_slug
        |> Context.list_repositories()
        |> Enum.map(fn repo -> %{workspace_path: repo.workspace_path, github_full_name: repo.github_full_name} end)
        |> default_repo(project_slug)

      {:ok, Proposer.propose(workspace_root(project_slug), repositories)}
    end
  end

  @spec list_steps(String.t()) :: [Step.t()]
  def list_steps(project_slug) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        Repo.all(from(s in Step, where: s.project_id == ^project.id, order_by: [asc: s.position, asc: s.id]))

      _ ->
        []
    end
  end

  @spec save_steps(String.t(), [map()]) :: {:ok, [Step.t()]} | {:error, error()}
  def save_steps(project_slug, steps) when is_list(steps) do
    with {:ok, project} <- Context.get_project(project_slug) do
      Repo.transaction(fn ->
        Repo.delete_all(from(s in Step, where: s.project_id == ^project.id))

        steps
        |> Enum.with_index()
        |> Enum.reduce_while([], fn {attrs, index}, acc ->
          changeset = Step.changeset(%Step{}, step_attrs(attrs, project.id, index))

          case Repo.insert(changeset) do
            {:ok, step} -> {:cont, [step | acc]}
            {:error, reason} -> Repo.rollback(reason)
          end
        end)
        |> Enum.reverse()
      end)
    end
  end

  @spec start_run(String.t()) :: {:ok, Run.t()} | {:error, error()}
  def start_run(project_slug) do
    with {:ok, project} <- Context.get_project(project_slug) do
      %Run{}
      |> Run.changeset(%{project_id: project.id, status: "running", started_at: now()})
      |> Repo.insert()
    end
  end

  @spec record_step_result(Run.t(), Step.t(), map()) :: {:ok, StepRun.t()} | {:error, Ecto.Changeset.t()}
  def record_step_result(%Run{} = run, %Step{} = step, result) when is_map(result) do
    %StepRun{}
    |> StepRun.changeset(%{
      run_id: run.id,
      step_id: step.id,
      description: step.description,
      command: step.command,
      status: Map.get(result, :status, "succeeded"),
      exit_code: Map.get(result, :exit_code),
      output: Map.get(result, :output),
      started_at: Map.get(result, :started_at, now()),
      completed_at: Map.get(result, :completed_at, now())
    })
    |> Repo.insert()
  end

  @spec finish_run(Run.t()) :: {:ok, Run.t()} | {:error, Ecto.Changeset.t()}
  def finish_run(%Run{} = run) do
    failed? = Repo.exists?(from(sr in StepRun, where: sr.run_id == ^run.id and sr.status == "failed"))
    status = if failed?, do: "failed", else: "succeeded"

    run |> Run.changeset(%{status: status, completed_at: now()}) |> Repo.update()
  end

  @spec list_runs(String.t()) :: [Run.t()]
  def list_runs(project_slug) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        Repo.all(
          from(r in Run, where: r.project_id == ^project.id, order_by: [desc: r.id], preload: [:step_runs])
        )

      _ ->
        []
    end
  end

  defp step_attrs(attrs, project_id, index) do
    attrs
    |> Map.new(fn {k, v} -> {to_string(k), v} end)
    |> Map.put("project_id", project_id)
    |> Map.put("position", index)
    |> Map.put_new("source", "manual")
  end

  defp default_repo([], project_slug), do: [%{workspace_path: ".", github_full_name: project_slug}]
  defp default_repo(repositories, _project_slug), do: repositories

  defp workspace_root(project_slug), do: Path.join(Config.workspace_root(), project_slug)

  defp now, do: DateTime.utc_now()
end
```

- [ ] **Step 6.4: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/dev_env_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 6.5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/dev_env.ex elixir/test/symphony_elixir/local_tracker/dev_env_test.exs
git commit -m "feat(dev-env): context for propose/persist steps and run tracking"
```

---

## Task 7 — Project-scoped tmux session in Registry

**Files:**
- Modify: `elixir/lib/symphony_elixir/terminal/registry.ex`
- Test: `elixir/test/symphony_elixir/terminal/registry_project_test.exs`

- [ ] **Step 7.1: Write the failing test (stubbed tmux)**

Create `elixir/test/symphony_elixir/terminal/registry_project_test.exs`:

```elixir
defmodule SymphonyElixir.Terminal.RegistryProjectTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Terminal.Registry

  defmodule TmuxStub do
    def available?, do: true
    def has_session?(_name), do: false
    def new_session(_name, _cwd), do: :ok
    def send_keys(_name, _data), do: :ok
    def capture_pane(_name), do: {:ok, "captured"}
    def resize(_name, _c, _r), do: :ok
  end

  test "open_project_session builds a sym-devenv session" do
    assert {:ok, session} =
             Registry.open_project_session("my-proj", cwd: "/tmp/my-proj", tmux: TmuxStub)

    assert session.session_name == "sym-devenv-my-proj"
    assert session.project_slug == "my-proj"
    assert session.output == "captured"
  end

  test "send_input_project + capture_project delegate to tmux" do
    assert :ok = Registry.send_input_project("my-proj", "echo hi\n", tmux: TmuxStub)
    assert {:ok, "captured"} = Registry.capture_project("my-proj", tmux: TmuxStub)
  end
end
```

- [ ] **Step 7.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/terminal/registry_project_test.exs`
Expected: FAIL — functions missing.

- [ ] **Step 7.3: Implement project-scoped session functions**

In `elixir/lib/symphony_elixir/terminal/registry.ex`, add:

```elixir
  @spec project_session_name(String.t()) :: String.t()
  def project_session_name(project_slug) when is_binary(project_slug) do
    "sym-devenv-#{safe_segment(project_slug, "project")}"
  end

  @spec open_project_session(String.t(), keyword()) :: {:ok, session()} | {:error, String.t()}
  def open_project_session(project_slug, opts \\ []) when is_binary(project_slug) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    cwd = Keyword.get(opts, :cwd) || default_project_cwd(project_slug)
    session_name = project_session_name(project_slug)

    with :ok <- ensure_tmux_available(tmux),
         :ok <- File.mkdir_p(cwd),
         :ok <- ensure_session(tmux, session_name, cwd),
         {:ok, output} <- capture_output(tmux, session_name) do
      {:ok,
       %{
         project_slug: project_slug,
         issue_identifier: "__devenv__",
         session_name: session_name,
         cwd: cwd,
         state: "running",
         output: output
       }}
    end
  end

  @spec send_input_project(String.t(), String.t(), keyword()) :: :ok | {:error, String.t()}
  def send_input_project(project_slug, data, opts \\ []) when is_binary(project_slug) and is_binary(data) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.send_keys(project_session_name(project_slug), data)
  end

  @spec capture_project(String.t(), keyword()) :: {:ok, String.t()} | {:error, String.t()}
  def capture_project(project_slug, opts \\ []) when is_binary(project_slug) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.capture_pane(project_session_name(project_slug))
  end

  defp default_project_cwd(project_slug) do
    Path.join(SymphonyElixir.Config.workspace_root(), project_slug)
  end
```

> `ensure_session/3`, `capture_output/2`, `dependency/4`, `ensure_tmux_available/1`, `safe_segment/2` already exist privately in the module. Add `alias SymphonyElixir.Config` if not present (it's not currently aliased — use fully-qualified `SymphonyElixir.Config.workspace_root()` as above to avoid touching the alias block, or add the alias).

- [ ] **Step 7.4: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/terminal/registry_project_test.exs`
Expected: PASS.

- [ ] **Step 7.5: Commit**

```bash
git add elixir/lib/symphony_elixir/terminal/registry.ex elixir/test/symphony_elixir/terminal/registry_project_test.exs
git commit -m "feat(terminal): project-scoped dev-env tmux session helpers"
```

---

## Task 8 — DevEnv.Runner (execute step in tmux, record result)

**Files:**
- Create: `elixir/lib/symphony_elixir/local_tracker/dev_env/runner.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/dev_env/runner_test.exs`

- [ ] **Step 8.1: Write the failing test**

Create `elixir/test/symphony_elixir/local_tracker/dev_env/runner_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv.RunnerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, DevEnv}
  alias SymphonyElixir.LocalTracker.DevEnv.Runner
  alias SymphonyElixir.Repo

  defmodule TmuxStub do
    def available?, do: true
    def has_session?(_), do: true
    def new_session(_, _), do: :ok
    def send_keys(_, _), do: :ok
    def capture_pane(_), do: {:ok, "$ mix deps.get\nResolving...\n"}
    def resize(_, _, _), do: :ok
  end

  setup do
    {:ok, _r, _a} = Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
    for t <- ["local_tracker_dev_env_step_runs", "local_tracker_dev_env_runs", "local_tracker_dev_env_steps", "local_tracker_projects"], do: Repo.query!("delete from #{t}")

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "P", "slug" => "p",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [], "setup" => %{}
      })

    {:ok, [step]} = DevEnv.save_steps("p", [%{"description" => "Install", "command" => "mix deps.get", "working_dir" => "api", "source" => "manual"}])
    %{step: step}
  end

  test "run_step sends the command and records a step run", %{step: step} do
    {:ok, run} = DevEnv.start_run("p")

    assert {:ok, step_run} = Runner.run_step("p", run, step, tmux: TmuxStub)
    assert step_run.status == "running" or step_run.status == "succeeded"
    assert step_run.command == "mix deps.get"
    assert is_binary(step_run.output)
  end
end
```

> Because tmux execution is asynchronous (we send keys and capture later), `run_step/4` records the step run as `running` with the initial capture and returns. A `complete_step/3` (or polling capture) finalizes status. For MVP this plan records `running` then immediately captures and marks `succeeded` if the capture is non-empty — exit-code detection is a documented follow-up (tmux does not expose exit codes without a wrapper). The test accepts either status.

- [ ] **Step 8.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/dev_env/runner_test.exs`
Expected: FAIL — module missing.

- [ ] **Step 8.3: Implement the Runner**

Create `elixir/lib/symphony_elixir/local_tracker/dev_env/runner.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv.Runner do
  @moduledoc """
  Executes a dev-env step inside the project tmux session and records a StepRun.

  tmux does not surface exit codes directly; this records the captured output and
  marks the step `running`/`succeeded`. Exit-code wrapping is a documented follow-up.
  """

  alias SymphonyElixir.LocalTracker.DevEnv
  alias SymphonyElixir.LocalTracker.DevEnv.{Run, Step}
  alias SymphonyElixir.Terminal.Registry

  @spec run_step(String.t(), Run.t(), Step.t(), keyword()) :: {:ok, DevEnv.StepRun.t()} | {:error, term()}
  def run_step(project_slug, %Run{} = run, %Step{} = step, opts \\ []) do
    started_at = DateTime.utc_now()

    with {:ok, _session} <- Registry.open_project_session(project_slug, opts),
         :ok <- Registry.send_input_project(project_slug, command_line(step), opts),
         {:ok, output} <- Registry.capture_project(project_slug, opts) do
      DevEnv.record_step_result(run, step, %{
        status: "succeeded",
        output: output,
        started_at: started_at,
        completed_at: DateTime.utc_now()
      })
    else
      {:error, reason} ->
        DevEnv.record_step_result(run, step, %{
          status: "failed",
          output: error_text(reason),
          started_at: started_at,
          completed_at: DateTime.utc_now()
        })
    end
  end

  defp command_line(%Step{command: command, working_dir: nil}), do: command <> "\n"

  defp command_line(%Step{command: command, working_dir: working_dir}) do
    "cd #{working_dir} && #{command}\n"
  end

  defp error_text(reason) when is_binary(reason), do: reason
  defp error_text(reason), do: inspect(reason)
end
```

- [ ] **Step 8.4: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/dev_env/runner_test.exs`
Expected: PASS.

- [ ] **Step 8.5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/dev_env/runner.ex elixir/test/symphony_elixir/local_tracker/dev_env/runner_test.exs
git commit -m "feat(dev-env): runner executes steps in project tmux session"
```

---

## Task 9 — TerminalChannel devenv topic

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/channels/terminal_channel.ex`
- Test: a channel join test (or rely on manual + Registry test). Add a focused unit test if a ChannelCase exists.

- [ ] **Step 9.1: Add the join clause**

In `terminal_channel.ex`, add a clause **above** the existing `"terminal:" <> topic_rest` issue clause:

```elixir
  @impl true
  def join("terminal:devenv:" <> project_slug, _payload, socket)
      when is_binary(project_slug) and project_slug != "" do
    with :ok <- authorize(socket),
         {:ok, session} <- Registry.open_project_session(project_slug) do
      socket =
        socket
        |> assign(:project_slug, project_slug)
        |> assign(:devenv, true)

      {:ok, %{session: session_payload(session)}, socket}
    else
      {:error, reason} -> {:error, %{reason: error_reason(reason)}}
    end
  end
```

Then make `handle_in("input", ...)`, `handle_in("resize", ...)`, and `push_capture/3` branch on `socket.assigns[:devenv]`:

```elixir
  def handle_in("input", %{"data" => data}, %{assigns: %{devenv: true, project_slug: project_slug}} = socket)
      when is_binary(data) do
    case Registry.send_input_project(project_slug, data) do
      :ok ->
        push_devenv_capture(socket, project_slug)
        Enum.each(@capture_delays_ms, fn d -> Process.send_after(self(), {:capture_devenv, project_slug}, d) end)
        {:noreply, socket}

      {:error, message} ->
        push(socket, "error", %{message: message})
        {:noreply, socket}
    end
  end

  def handle_info({:capture_devenv, project_slug}, socket) do
    push_devenv_capture(socket, project_slug)
    {:noreply, socket}
  end

  defp push_devenv_capture(socket, project_slug) do
    case Registry.capture_project(project_slug) do
      {:ok, output} -> push(socket, "output", %{data: output})
      {:error, message} -> push(socket, "error", %{message: message})
    end
  end
```

> Keep the existing issue clauses intact; the new clauses pattern-match on `devenv: true` so they don't collide. Resize for devenv can be added similarly or omitted for MVP (terminal still works without resize).

- [ ] **Step 9.2: Verify compilation + existing channel tests still pass**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/channels`
Expected: PASS (existing terminal channel tests unaffected; new clause compiles).

- [ ] **Step 9.3: Commit**

```bash
git add elixir/lib/symphony_elixir_web/channels/terminal_channel.ex
git commit -m "feat(terminal): devenv project terminal channel topic"
```

---

## Task 10 — DevEnv presenter + controller + routes

**Files:**
- Create: `elixir/lib/symphony_elixir_web/presenters/dev_env_presenter.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/dev_env_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/dev_env_controller_test.exs`

- [ ] **Step 10.1: Write the failing test**

Create `elixir/test/symphony_elixir_web/controllers/tracker/dev_env_controller_test.exs`:

```elixir
defmodule SymphonyElixirWeb.Tracker.DevEnvControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    {:ok, _r, _a} = Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
    for t <- ["local_tracker_dev_env_step_runs", "local_tracker_dev_env_runs", "local_tracker_dev_env_steps", "local_tracker_projects"], do: Repo.query!("delete from #{t}")

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "P", "slug" => "p",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [], "setup" => %{}
      })

    previous = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    on_exit(fn -> if previous, do: System.put_env(@token_env, previous), else: System.delete_env(@token_env) end)
    :ok
  end

  defp authorized_conn, do: build_conn() |> put_req_header("authorization", "Bearer secret")

  test "save and list steps" do
    save =
      put(authorized_conn(), "/api/tracker/v1/projects/p/dev_env/steps", %{
        "steps" => [%{"description" => "Install", "command" => "mix deps.get", "source" => "manual"}]
      })

    assert %{"data" => [%{"command" => "mix deps.get", "position" => 0}]} = json_response(save, 200)

    list = get(authorized_conn(), "/api/tracker/v1/projects/p/dev_env/steps")
    assert %{"data" => [%{"description" => "Install"}]} = json_response(list, 200)
  end

  test "propose returns proposals (empty project)" do
    conn = post(authorized_conn(), "/api/tracker/v1/projects/p/dev_env/propose", %{})
    assert %{"data" => proposals} = json_response(conn, 200)
    assert is_list(proposals)
  end
end
```

- [ ] **Step 10.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/dev_env_controller_test.exs`
Expected: FAIL — routes + controller missing.

- [ ] **Step 10.3: Implement the presenter**

Create `elixir/lib/symphony_elixir_web/presenters/dev_env_presenter.ex`:

```elixir
defmodule SymphonyElixirWeb.DevEnvPresenter do
  @moduledoc "JSON DTOs for dev-env steps, proposals, and runs."

  alias SymphonyElixir.LocalTracker.DevEnv.{ProposedStep, Run, Step, StepRun}

  @spec step(Step.t()) :: map()
  def step(%Step{} = step) do
    %{
      id: step.id,
      description: step.description,
      command: step.command,
      working_dir: step.working_dir,
      position: step.position,
      source: step.source,
      optional: step.optional
    }
  end

  @spec proposed(ProposedStep.t()) :: map()
  def proposed(%ProposedStep{} = step) do
    %{description: step.description, command: step.command, working_dir: step.working_dir, source: step.source, optional: step.optional}
  end

  @spec run(Run.t()) :: map()
  def run(%Run{} = run) do
    %{
      id: run.id,
      status: run.status,
      started_at: iso8601(run.started_at),
      completed_at: iso8601(run.completed_at),
      step_runs: step_runs(run)
    }
  end

  @spec step_run(StepRun.t()) :: map()
  def step_run(%StepRun{} = sr) do
    %{
      id: sr.id,
      step_id: sr.step_id,
      description: sr.description,
      command: sr.command,
      status: sr.status,
      exit_code: sr.exit_code,
      output: sr.output,
      started_at: iso8601(sr.started_at),
      completed_at: iso8601(sr.completed_at)
    }
  end

  defp step_runs(%Run{step_runs: runs}) when is_list(runs), do: Enum.map(runs, &step_run/1)
  defp step_runs(_), do: []

  defp iso8601(%DateTime{} = dt), do: dt |> DateTime.truncate(:second) |> DateTime.to_iso8601()
  defp iso8601(_), do: nil
end
```

- [ ] **Step 10.4: Implement the controller**

Create `elixir/lib/symphony_elixir_web/controllers/tracker/dev_env_controller.ex`:

```elixir
defmodule SymphonyElixirWeb.Tracker.DevEnvController do
  @moduledoc "Propose/list/save/run dev-environment steps for a project."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.DevEnv
  alias SymphonyElixir.LocalTracker.DevEnv.Runner
  alias SymphonyElixirWeb.{DevEnvPresenter, TrackerErrors}

  @spec propose(Conn.t(), map()) :: Conn.t()
  def propose(conn, %{"project_slug" => project_slug}) do
    case DevEnv.propose_steps(project_slug) do
      {:ok, proposals} -> json(conn, %{data: Enum.map(proposals, &DevEnvPresenter.proposed/1)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug}) do
    json(conn, %{data: Enum.map(DevEnv.list_steps(project_slug), &DevEnvPresenter.step/1)})
  end

  @spec save(Conn.t(), map()) :: Conn.t()
  def save(conn, %{"project_slug" => project_slug, "steps" => steps}) when is_list(steps) do
    case DevEnv.save_steps(project_slug, steps) do
      {:ok, saved} -> json(conn, %{data: Enum.map(saved, &DevEnvPresenter.step/1)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec run(Conn.t(), map()) :: Conn.t()
  def run(conn, %{"project_slug" => project_slug}) do
    with {:ok, run} <- DevEnv.start_run(project_slug) do
      steps = DevEnv.list_steps(project_slug)
      Enum.each(steps, fn step -> Runner.run_step(project_slug, run, step) end)
      {:ok, finished} = DevEnv.finish_run(run)
      reloaded = DevEnv.list_runs(project_slug) |> Enum.find(&(&1.id == finished.id)) || finished
      conn |> put_status(:created) |> json(%{data: DevEnvPresenter.run(reloaded)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec run_step(Conn.t(), map()) :: Conn.t()
  def run_step(conn, %{"project_slug" => project_slug, "step_id" => step_id}) do
    with {:ok, run} <- DevEnv.start_run(project_slug),
         step when not is_nil(step) <- Enum.find(DevEnv.list_steps(project_slug), &(to_string(&1.id) == step_id)),
         {:ok, step_run} <- Runner.run_step(project_slug, run, step) do
      DevEnv.finish_run(run)
      conn |> put_status(:created) |> json(%{data: DevEnvPresenter.step_run(step_run)})
    else
      nil -> TrackerErrors.render(conn, :issue_not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec runs(Conn.t(), map()) :: Conn.t()
  def runs(conn, %{"project_slug" => project_slug}) do
    json(conn, %{data: Enum.map(DevEnv.list_runs(project_slug), &DevEnvPresenter.run/1)})
  end
end
```

> `run_step/2`'s `nil ->` arm reuses `:issue_not_found` for a missing step. If you prefer a dedicated `:step_not_found`, add a `TrackerErrors.render(conn, :step_not_found)` clause (404, code `step_not_found`) — minor, optional.

- [ ] **Step 10.5: Mount routes**

In `router.ex`, inside the tracker scope:

```elixir
    get("/projects/:project_slug/dev_env/steps", DevEnvController, :index)
    put("/projects/:project_slug/dev_env/steps", DevEnvController, :save)
    post("/projects/:project_slug/dev_env/propose", DevEnvController, :propose)
    post("/projects/:project_slug/dev_env/run", DevEnvController, :run)
    post("/projects/:project_slug/dev_env/steps/:step_id/run", DevEnvController, :run_step)
    get("/projects/:project_slug/dev_env/runs", DevEnvController, :runs)
```

- [ ] **Step 10.6: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/dev_env_controller_test.exs`
Expected: PASS.

- [ ] **Step 10.7: Commit**

```bash
git add elixir/lib/symphony_elixir_web/presenters/dev_env_presenter.ex elixir/lib/symphony_elixir_web/controllers/tracker/dev_env_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/test/symphony_elixir_web/controllers/tracker/dev_env_controller_test.exs
git commit -m "feat(tracker-api): dev-env propose/list/save/run endpoints"
```

---

## Task 11 — Backend full gate

- [ ] **Step 11.1: Run**

Run: `cd elixir && mise exec -- mix all`
Expected: PASS. `mise exec -- mix format` for any formatting, re-run.

- [ ] **Step 11.2: Commit fixups**

```bash
git add -A elixir && git commit -m "chore(elixir): satisfy format/credo for dev-env slice" || echo "nothing to commit"
```

---

## Task 12 — Frontend: dev-env types + service

**Files:**
- Create: `tracker/src/types/devEnv.ts`
- Create: `tracker/src/services/devEnv.ts`
- Test: `tracker/src/services/__tests__/devEnv.test.ts`

- [ ] **Step 12.1: Write the types**

Create `tracker/src/types/devEnv.ts`:

```ts
export type DevEnvStepSource = "convention" | "readme" | "heuristic" | "manual";

export interface DevEnvStep {
  id?: string;
  description: string;
  command: string;
  workingDir: string | null;
  position?: number;
  source: DevEnvStepSource;
  optional: boolean;
}

export type DevEnvRunStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface DevEnvStepRun {
  id: string;
  stepId: string | null;
  description: string;
  command: string;
  status: DevEnvRunStatus;
  exitCode: number | null;
  output: string | null;
}

export interface DevEnvRun {
  id: string;
  status: DevEnvRunStatus;
  stepRuns: DevEnvStepRun[];
}
```

- [ ] **Step 12.2: Write the failing test**

Create `tracker/src/services/__tests__/devEnv.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { proposeDevEnvSteps, saveDevEnvSteps, listDevEnvSteps } from "@/services/devEnv";
import { http } from "@/services/http";

vi.mock("@/services/http", async () => {
  const actual = await vi.importActual<typeof import("@/services/http")>("@/services/http");
  return { ...actual, http: { get: vi.fn(), put: vi.fn(), post: vi.fn() } };
});

describe("devEnv service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("proposeDevEnvSteps maps proposals", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: [{ description: "Install", command: "mix deps.get", working_dir: "api", source: "heuristic", optional: false }] },
    });
    const result = await proposeDevEnvSteps("p");
    expect(result[0]).toEqual({ description: "Install", command: "mix deps.get", workingDir: "api", source: "heuristic", optional: false });
  });

  it("saveDevEnvSteps posts snake_case steps", async () => {
    (http.put as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: [] } });
    await saveDevEnvSteps("p", [{ description: "Install", command: "mix deps.get", workingDir: "api", source: "manual", optional: false }]);
    expect(http.put).toHaveBeenCalledWith(
      expect.stringContaining("/projects/p/dev_env/steps"),
      { steps: [expect.objectContaining({ command: "mix deps.get", working_dir: "api" })] },
    );
  });

  it("listDevEnvSteps maps response", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: [{ id: 1, description: "Install", command: "mix deps.get", working_dir: null, position: 0, source: "manual", optional: false }] },
    });
    const result = await listDevEnvSteps("p");
    expect(result[0].id).toBe("1");
  });
});
```

- [ ] **Step 12.3: Run to verify it fails**

Run: `cd tracker && npm test -- src/services/__tests__/devEnv.test.ts`
Expected: FAIL — service missing.

- [ ] **Step 12.4: Implement the service**

Create `tracker/src/services/devEnv.ts`:

```ts
import type { DevEnvRun, DevEnvStep, DevEnvStepRun } from "@/types/devEnv";
import { http, trackerPath, unwrapData } from "./http";

interface StepDto {
  id?: number | string;
  description: string;
  command: string;
  working_dir?: string | null;
  position?: number;
  source: DevEnvStep["source"];
  optional?: boolean;
}

interface StepRunDto {
  id: number | string;
  step_id?: number | string | null;
  description: string;
  command: string;
  status: DevEnvStepRun["status"];
  exit_code?: number | null;
  output?: string | null;
}

interface RunDto {
  id: number | string;
  status: DevEnvRun["status"];
  step_runs?: StepRunDto[];
}

function normalizeStep(dto: StepDto): DevEnvStep {
  return {
    id: dto.id !== undefined ? String(dto.id) : undefined,
    description: dto.description,
    command: dto.command,
    workingDir: dto.working_dir ?? null,
    position: dto.position,
    source: dto.source,
    optional: dto.optional ?? false,
  };
}

function denormalizeStep(step: DevEnvStep): Record<string, unknown> {
  return {
    description: step.description,
    command: step.command,
    working_dir: step.workingDir,
    source: step.source,
    optional: step.optional,
  };
}

function normalizeStepRun(dto: StepRunDto): DevEnvStepRun {
  return {
    id: String(dto.id),
    stepId: dto.step_id !== undefined && dto.step_id !== null ? String(dto.step_id) : null,
    description: dto.description,
    command: dto.command,
    status: dto.status,
    exitCode: dto.exit_code ?? null,
    output: dto.output ?? null,
  };
}

function normalizeRun(dto: RunDto): DevEnvRun {
  return {
    id: String(dto.id),
    status: dto.status,
    stepRuns: (dto.step_runs ?? []).map(normalizeStepRun),
  };
}

export async function proposeDevEnvSteps(projectSlug: string): Promise<DevEnvStep[]> {
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/dev_env/propose`), {});
  return unwrapData<StepDto[]>(response).map(normalizeStep);
}

export async function listDevEnvSteps(projectSlug: string): Promise<DevEnvStep[]> {
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/dev_env/steps`));
  return unwrapData<StepDto[]>(response).map(normalizeStep);
}

export async function saveDevEnvSteps(projectSlug: string, steps: DevEnvStep[]): Promise<DevEnvStep[]> {
  const response = await http.put(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/dev_env/steps`), {
    steps: steps.map(denormalizeStep),
  });
  return unwrapData<StepDto[]>(response).map(normalizeStep);
}

export async function runDevEnv(projectSlug: string): Promise<DevEnvRun> {
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/dev_env/run`), {});
  return normalizeRun(unwrapData<RunDto>(response));
}

export async function runDevEnvStep(projectSlug: string, stepId: string): Promise<DevEnvStepRun> {
  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/dev_env/steps/${encodeURIComponent(stepId)}/run`),
    {},
  );
  return normalizeStepRun(unwrapData<StepRunDto>(response));
}

export async function listDevEnvRuns(projectSlug: string): Promise<DevEnvRun[]> {
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/dev_env/runs`));
  return unwrapData<RunDto[]>(response).map(normalizeRun);
}
```

- [ ] **Step 12.5: Run to verify it passes**

Run: `cd tracker && npm test -- src/services/__tests__/devEnv.test.ts`
Expected: PASS.

- [ ] **Step 12.6: Commit**

```bash
git add tracker/src/types/devEnv.ts tracker/src/services/devEnv.ts tracker/src/services/__tests__/devEnv.test.ts
git commit -m "feat(tracker): dev-env service + types"
```

---

## Task 13 — Frontend: DevEnvPanel

**Files:**
- Create: `tracker/src/components/devenv/DevEnvStepRow.tsx`
- Create: `tracker/src/components/devenv/DevEnvPanel.tsx`
- Test: `tracker/src/components/devenv/__tests__/DevEnvPanel.test.tsx`

- [ ] **Step 13.1: Write the failing test**

Create `tracker/src/components/devenv/__tests__/DevEnvPanel.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DevEnvPanel } from "@/components/devenv/DevEnvPanel";
import * as devEnv from "@/services/devEnv";

vi.mock("@/services/devEnv");

describe("DevEnvPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads saved steps then proposes and saves", async () => {
    vi.mocked(devEnv.listDevEnvSteps).mockResolvedValue([]);
    vi.mocked(devEnv.proposeDevEnvSteps).mockResolvedValue([
      { description: "Install", command: "mix deps.get", workingDir: "api", source: "heuristic", optional: false },
    ]);
    vi.mocked(devEnv.saveDevEnvSteps).mockResolvedValue([
      { id: "1", description: "Install", command: "mix deps.get", workingDir: "api", source: "manual", optional: false, position: 0 },
    ]);

    render(<DevEnvPanel projectSlug="p" />);

    await waitFor(() => expect(devEnv.listDevEnvSteps).toHaveBeenCalledWith("p"));
    await userEvent.click(screen.getByRole("button", { name: /propose steps/i }));
    await waitFor(() => expect(screen.getByDisplayValue("mix deps.get")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /save steps/i }));
    await waitFor(() => expect(devEnv.saveDevEnvSteps).toHaveBeenCalled());
  });
});
```

- [ ] **Step 13.2: Run to verify it fails**

Run: `cd tracker && npm test -- src/components/devenv/__tests__/DevEnvPanel.test.tsx`
Expected: FAIL — components missing.

- [ ] **Step 13.3: Implement DevEnvStepRow**

Create `tracker/src/components/devenv/DevEnvStepRow.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DevEnvStep } from "@/types/devEnv";

interface DevEnvStepRowProps {
  step: DevEnvStep;
  index: number;
  onChange: (index: number, step: DevEnvStep) => void;
  onRemove: (index: number) => void;
  onRun?: (step: DevEnvStep) => void;
}

export function DevEnvStepRow({ step, index, onChange, onRemove, onRun }: DevEnvStepRowProps) {
  return (
    <div className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_1fr_auto]">
      <Input
        aria-label="Step description"
        value={step.description}
        onChange={(e) => onChange(index, { ...step, description: e.target.value })}
        placeholder="Description"
      />
      <Input
        aria-label="Step command"
        value={step.command}
        onChange={(e) => onChange(index, { ...step, command: e.target.value })}
        placeholder="command"
      />
      <div className="flex items-center gap-2">
        {onRun ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => onRun(step)} disabled={!step.id}>
            Run
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={() => onRemove(index)}>
          Remove
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 13.4: Implement DevEnvPanel**

Create `tracker/src/components/devenv/DevEnvPanel.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DevEnvStepRow } from "@/components/devenv/DevEnvStepRow";
import { listDevEnvSteps, proposeDevEnvSteps, runDevEnvStep, saveDevEnvSteps } from "@/services/devEnv";
import type { DevEnvStep } from "@/types/devEnv";

interface DevEnvPanelProps {
  projectSlug: string;
}

const EMPTY_STEP: DevEnvStep = { description: "", command: "", workingDir: null, source: "manual", optional: false };

export function DevEnvPanel({ projectSlug }: DevEnvPanelProps) {
  const [steps, setSteps] = useState<DevEnvStep[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    listDevEnvSteps(projectSlug)
      .then((loaded) => active && setSteps(loaded))
      .catch((cause) => toast.error(cause instanceof Error ? cause.message : "Failed to load steps"));
    return () => {
      active = false;
    };
  }, [projectSlug]);

  const handleChange = useCallback((index: number, step: DevEnvStep) => {
    setSteps((current) => current.map((existing, i) => (i === index ? step : existing)));
  }, []);

  const handleRemove = useCallback((index: number) => {
    setSteps((current) => current.filter((_, i) => i !== index));
  }, []);

  async function handlePropose() {
    setBusy(true);
    try {
      const proposed = await proposeDevEnvSteps(projectSlug);
      if (proposed.length === 0) {
        toast.info("No steps proposed; add steps manually or a .symphony/devenv.yaml");
      }
      setSteps((current) => [...current, ...proposed]);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to propose steps");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    try {
      const saved = await saveDevEnvSteps(projectSlug, steps);
      setSteps(saved);
      toast.success("Dev-env steps saved");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to save steps");
    } finally {
      setBusy(false);
    }
  }

  async function handleRunStep(step: DevEnvStep) {
    if (!step.id) return;
    try {
      await runDevEnvStep(projectSlug, step.id);
      toast.success(`Running: ${step.command}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to run step");
    }
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Dev environment</h2>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={handlePropose} disabled={busy}>
            Propose steps
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={busy}>
            Save steps
          </Button>
        </div>
      </header>

      <div className="space-y-2">
        {steps.map((step, index) => (
          <DevEnvStepRow
            key={step.id ?? `new-${index}`}
            step={step}
            index={index}
            onChange={handleChange}
            onRemove={handleRemove}
            onRun={handleRunStep}
          />
        ))}
      </div>

      <Button type="button" size="sm" variant="ghost" onClick={() => setSteps((c) => [...c, { ...EMPTY_STEP }])}>
        Add step
      </Button>
    </section>
  );
}
```

- [ ] **Step 13.5: Run to verify it passes**

Run: `cd tracker && npm test -- src/components/devenv/__tests__/DevEnvPanel.test.tsx`
Expected: PASS.

- [ ] **Step 13.6: Commit**

```bash
git add tracker/src/components/devenv/ tracker/src/components/devenv/__tests__/
git commit -m "feat(tracker): dev-env panel with propose/edit/save/run"
```

---

## Task 14 — Frontend: mount panel + post-create prompt

**Files:**
- Modify: a project view page (e.g. `tracker/src/pages/ProjectBoardPage.tsx` or a settings/overview page) to render `<DevEnvPanel projectSlug={slug} />`.
- Modify: `tracker/src/components/projects/ProjectWorkspaceWizard.tsx` to, after a local project is created, toast a CTA / navigate to the panel ("Propose dev-env steps") per the user's "consult and propose after saving" decision.

- [ ] **Step 14.1: Mount the panel**

Add `<DevEnvPanel projectSlug={project.slug} />` to the chosen project view (prefer a "Project settings" / "Overview" surface if one exists; otherwise add a collapsible section on `ProjectBoardPage`). Keep it lazy: only render when the project is loaded.

- [ ] **Step 14.2: Post-create prompt**

In the wizard's `onCreated` / success path for **local** projects, show a toast with an action that routes to the project view with the dev-env panel focused (e.g. `toast.success("Project created", { action: { label: "Set up dev env", onClick: () => navigate('/projects/'+slug+'#devenv') } })`). Match the toast/navigation libraries already used.

- [ ] **Step 14.3: Typecheck + targeted tests**

Run: `cd tracker && npm run build`
Run: `cd tracker && npm test`
Expected: green.

- [ ] **Step 14.4: Manual smoke**

With tmux available: create a local project with a repo containing `.mise.toml` + `mix.exs`, open the panel, click "Propose steps" (see mise install + mix deps.get), save, run a step, and verify output streams in the embedded terminal attached to `terminal:devenv:<slug>`.

- [ ] **Step 14.5: Commit**

```bash
git add tracker/src/pages tracker/src/components/projects/ProjectWorkspaceWizard.tsx
git commit -m "feat(tracker): mount dev-env panel and post-create prompt"
```

---

## Task 15 — Full gate + PR

- [ ] **Step 15.1: Run gates**

Run: `cd elixir && mise exec -- mix all`
Run: `cd tracker && npm test && npm run build`
Expected: green.

- [ ] **Step 15.2: Push + PR**

```bash
git push -u origin feat/dev-environment-discovery
gh pr create --title "Slice D: dev-environment discovery" --body "$(cat <<'EOF'
## Summary
- DevEnvStep/Run/StepRun schemas + DevEnv context (propose/persist/run history).
- Convention-first proposer: `.symphony/devenv.{yaml,md}` wins; heuristics (mise/compose/.env.example/install) fill in.
- Project-scoped tmux session + `terminal:devenv:<slug>` channel for execution.
- REST endpoints: propose/list/save/run/run-step/runs.
- Frontend: dev-env service, editable panel with propose/save/run, post-create prompt.

## Documented follow-ups
- Exit-code detection for steps (tmux does not expose exit codes; currently records captured output).
- README-derived steps beyond convention `.md` (heuristic README parsing is a follow-up; `.symphony/devenv.md` is supported now).

## Test plan
- [ ] `cd elixir && mise exec -- mix all`
- [ ] `cd tracker && npm test && npm run build`
- [ ] Manual: propose → edit → save → run step → watch terminal output.
EOF
)"
```

---

## Self-Review

**Spec coverage (spec §2 goals → task):**

1. Propose after project/repo saved → Task 6 (`propose_steps`) + Task 14 (post-create prompt).
2. Convention-first (`.symphony/devenv.*`) → Task 3 + Task 5.
3. Heuristics (mise/compose/env/README-ish) → Task 4. (README free-text parsing beyond `.md` convention is a documented follow-up.)
4. Review/edit/persist → Task 6 (`save_steps`) + Task 13 (panel).
5. Execute in terminal → Task 7 (project session) + Task 8 (runner) + Task 9 (channel) + Task 13 (run buttons).
6. Run history persisted → Task 2 (schemas) + Task 6 (`start_run`/`record_step_result`/`finish_run`/`list_runs`) + Task 10 (`runs` endpoint).

**Spec §6 backend → task:** migration (T1), schemas (T2), proposal pipeline (T3/T4/T5), context (T6), execution (T7/T8/T9), API (T10).

**Spec §7 frontend → task:** types/service (T12), panel (T13), mounting + prompt (T14).

**Placeholder scan:** Task 14 describes mounting compositionally (depends on which project surface exists in the merged frontend) rather than full code — it's wiring of the already-tested `DevEnvPanel`. Two explicit, surfaced follow-ups: exit-code detection and README free-text parsing. No silent TODOs in backend steps.

**Type consistency:** `DevEnvStep`/`DevEnvRun`/`DevEnvStepRun` TS types (T12) match presenter output (T10). `source` enum (T12) matches `Step.@sources` (T2) and proposer/discoverer tags (`convention`/`heuristic`). Channel topic `terminal:devenv:<slug>` (T9) matches `Registry.project_session_name/1` (T7).

**Risk note for workers:** tmux must be available for execution tests/manual runs; all backend unit tests stub tmux (`TmuxStub`) so CI without tmux still passes. The runner's success/failure mapping is coarse (no exit code) by design for this slice — do not block the slice on exit-code wrapping.
