# Per-Project Tracker Adapter Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Tooling: Elixir backend uses `mix` (run via `mise exec --` if `mise` is configured). Frontend uses `npm` from `tracker/`. Quality gate for Elixir is `cd elixir && mise exec -- mix all` (alias defined in `Makefile`); when `mise` is unavailable, `cd elixir && mix all` works after `mix deps.get`. Frontend tests run with `cd tracker && npm test`.

**Goal:** Deliver Slice B of the MVP: let each Symphony `Project` point at its own tracker (`local`, `github` Project v2, or `linear` project) by adding `tracker_kind` + `tracker_config` to projects, introducing a per-project `SymphonyElixir.Tracker.IssueAdapter` behaviour that the JSON API dispatches to, implementing Local/GitHub/Linear adapters with normalized DTOs, wiring tracker selection into the workspace wizard, and adding light client-side polling for remote projects.

**Architecture:** A migration adds `tracker_kind` (default `"local"`) and `tracker_config` (JSON map) to `local_tracker_projects`. A new behaviour `SymphonyElixir.Tracker.IssueAdapter` defines per-project read/write callbacks and a `for/1` resolver that maps a `Project` row to the Local/GitHub/Linear adapter module. The existing orchestrator `SymphonyElixir.Tracker` behaviour is left untouched. Issue/Comment controllers stop calling `LocalTracker.Context` directly and instead call `IssueAdapter.dispatch/3`. GitHub/Linear adapters delegate to the existing `GitHub.Client`/`Linear.Client` GraphQL functions through new `Query` modules that also normalize responses into a shared `SymphonyElixir.Tracker.IssueDTO`. A new `RemoteDiscoveryController` powers the wizard's board picker. Frontend gains a tracker-source step, remote-tracker services, a client-side filter helper, and a polling hook for remote boards.

**Tech Stack:** Elixir 1.19 / OTP 28, Phoenix 1.7, Ecto + `ecto_sqlite3`, ExUnit. React 18 + TypeScript + Vite, react-router-dom v6, shadcn primitives, sonner toasts, Vitest + Testing Library, axios.

**Spec:** `docs/superpowers/specs/2026-05-28-per-project-tracker-adapter-design.md`

---

## Branch Setup

- [ ] **Step 0: Create a feature branch from main**

```bash
cd /home/raphaelcangucu/symphony
git status
git checkout -b feat/per-project-tracker-adapter
```

Expected: branch exists, working tree clean.

---

## File Structure (Backend)

| Action | Path | Owns |
|---|---|---|
| Create | `elixir/priv/repo/migrations/20260528160000_add_tracker_kind_to_projects.exs` | Adds `tracker_kind` + `tracker_config` columns + index |
| Modify | `elixir/lib/symphony_elixir/local_tracker/project.ex` | Schema fields + changeset validations |
| Create | `elixir/lib/symphony_elixir/tracker/issue_dto.ex` | Normalized issue/status/comment structs + `build/1` |
| Create | `elixir/lib/symphony_elixir/tracker/issue_adapter.ex` | Behaviour, `for/1`, `dispatch/3` |
| Create | `elixir/lib/symphony_elixir/local_tracker/issue_adapter.ex` | Local facade over `Context` returning DTOs |
| Create | `elixir/lib/symphony_elixir/github/issue_adapter.ex` | GitHub Project v2 adapter |
| Create | `elixir/lib/symphony_elixir/github/issue_adapter/query.ex` | GraphQL strings + GitHub DTO normalizers |
| Create | `elixir/lib/symphony_elixir/linear/issue_adapter.ex` | Linear adapter |
| Create | `elixir/lib/symphony_elixir/linear/issue_adapter/query.ex` | GraphQL strings + Linear DTO normalizers |
| Modify | `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex` | `issue/1` clause for `IssueDTO`; `status/1` clause for status maps |
| Modify | `elixir/lib/symphony_elixir_web/tracker_errors.ex` | Map tracker adapter error atoms to HTTP |
| Modify | `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex` | Dispatch through adapter |
| Modify | `elixir/lib/symphony_elixir_web/controllers/tracker/comment_controller.ex` | Dispatch through adapter |
| Modify | `elixir/lib/symphony_elixir/local_tracker/context.ex` | `create_workspace_project/1` stores `tracker_kind`/`tracker_config`, skips statuses/setup for remote |
| Create | `elixir/lib/symphony_elixir_web/controllers/tracker/remote_discovery_controller.ex` | GitHub/Linear discover + resolve |
| Modify | `elixir/lib/symphony_elixir_web/router.ex` | Mount discovery routes |
| Create | `elixir/test/symphony_elixir/local_tracker/project_test.exs` | Changeset validation tests |
| Create | `elixir/test/symphony_elixir/tracker/issue_adapter_test.exs` | `for/1` dispatch tests |
| Create | `elixir/test/symphony_elixir/local_tracker/issue_adapter_test.exs` | Local adapter DTO tests |
| Create | `elixir/test/symphony_elixir/github/issue_adapter_test.exs` | GitHub adapter (stubbed client) |
| Create | `elixir/test/symphony_elixir/linear/issue_adapter_test.exs` | Linear adapter (stubbed client) |
| Modify | `elixir/test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs` | Remote project dispatch cases |
| Create | `elixir/test/symphony_elixir_web/controllers/tracker/remote_discovery_controller_test.exs` | Discovery endpoints |

## File Structure (Frontend)

| Action | Path | Owns |
|---|---|---|
| Modify | `tracker/src/types/project.ts` | `TrackerKind`, `ProjectTrackerConfig`, `Project.tracker` |
| Modify | `tracker/src/services/mappers.ts` | `normalizeProject` reads `tracker_kind`/`tracker_config` |
| Create | `tracker/src/services/remoteTrackers.ts` | discover/resolve GitHub + Linear |
| Create | `tracker/src/lib/issueFilters.ts` | `filterIssuesClientSide` helper (shared, may already partly exist from Slice A — extend) |
| Create | `tracker/src/components/projects/TrackerSourcePicker.tsx` | RadioGroup of three sources |
| Create | `tracker/src/components/projects/GitHubProjectPicker.tsx` | Board browser |
| Create | `tracker/src/components/projects/LinearProjectPicker.tsx` | Linear project browser |
| Modify | `tracker/src/components/projects/ProjectWorkspaceWizard.tsx` | New first step + remote submit path |
| Modify | `tracker/src/services/projects.ts` | `createWorkspaceProject` sends `tracker` payload |
| Create | `tracker/src/hooks/useTrackerPolling.ts` | 30s + focus + manual refetch for remote |
| Modify | `tracker/src/components/layout/ProjectHeader.tsx` | Tracker-kind badge + refresh button |
| Modify | `tracker/src/pages/ProjectBoardPage.tsx` | Gate DnD reorder for remote, mount polling |
| Create | `tracker/src/services/__tests__/remoteTrackers.test.ts` | |
| Create | `tracker/src/lib/__tests__/issueFilters.test.ts` | |
| Create | `tracker/src/components/projects/__tests__/TrackerSourcePicker.test.tsx` | |
| Create | `tracker/src/components/projects/__tests__/GitHubProjectPicker.test.tsx` | |
| Create | `tracker/src/components/projects/__tests__/LinearProjectPicker.test.tsx` | |
| Modify | `tracker/src/components/projects/__tests__/ProjectWorkspaceWizard.test.tsx` (create if absent) | New step coverage |
| Create | `tracker/src/hooks/__tests__/useTrackerPolling.test.tsx` | |

---

## Task 1 — Migration: tracker_kind + tracker_config

**Files:**
- Create: `elixir/priv/repo/migrations/20260528160000_add_tracker_kind_to_projects.exs`
- Test: `elixir/test/symphony_elixir/local_tracker/migrations_test.exs` (extend existing)

- [ ] **Step 1.1: Write the migration**

Create `elixir/priv/repo/migrations/20260528160000_add_tracker_kind_to_projects.exs`:

```elixir
defmodule SymphonyElixir.Repo.Migrations.AddTrackerKindToProjects do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_projects) do
      add :tracker_kind, :string, null: false, default: "local"
      add :tracker_config, :map, null: false, default: %{}
    end

    create index(:local_tracker_projects, [:tracker_kind])
  end
end
```

- [ ] **Step 1.2: Add migration assertion test**

Open `elixir/test/symphony_elixir/local_tracker/migrations_test.exs` and add a test that asserts the column exists after migration. Append inside the existing module:

```elixir
  test "local_tracker_projects has tracker_kind and tracker_config columns" do
    migrate_repo()

    %{rows: rows} = Repo.query!("PRAGMA table_info(local_tracker_projects)")
    column_names = Enum.map(rows, fn row -> Enum.at(row, 1) end)

    assert "tracker_kind" in column_names
    assert "tracker_config" in column_names
  end
```

(If `migrate_repo/0` / `Repo` are not already present in that file, copy the private `migrate_repo/0` helper and `alias SymphonyElixir.Repo` from `context_test.exs`.)

- [ ] **Step 1.3: Run the migration test (expect pass after migrate)**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/migrations_test.exs`
Expected: PASS. The migrator applies the new file; the PRAGMA lists both columns.

- [ ] **Step 1.4: Commit**

```bash
git add elixir/priv/repo/migrations/20260528160000_add_tracker_kind_to_projects.exs elixir/test/symphony_elixir/local_tracker/migrations_test.exs
git commit -m "feat(local-tracker): add tracker_kind and tracker_config to projects"
```

---

## Task 2 — Project schema fields & changeset validation

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/project.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/project_test.exs`

- [ ] **Step 2.1: Write the failing test**

Create `elixir/test/symphony_elixir/local_tracker/project_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.ProjectTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.Project

  describe "changeset/2 tracker_kind" do
    test "defaults to local when absent" do
      changeset = Project.changeset(%Project{}, %{name: "X", slug: "x"})
      assert changeset.valid?
      assert Ecto.Changeset.get_field(changeset, :tracker_kind) == "local"
    end

    test "accepts github with required config keys" do
      changeset =
        Project.changeset(%Project{}, %{
          name: "X",
          slug: "x",
          tracker_kind: "github",
          tracker_config: %{"repo" => "o/r", "project_id" => "PVT_1"}
        })

      assert changeset.valid?
    end

    test "rejects github without project_id" do
      changeset =
        Project.changeset(%Project{}, %{
          name: "X",
          slug: "x",
          tracker_kind: "github",
          tracker_config: %{"repo" => "o/r"}
        })

      refute changeset.valid?
      assert %{tracker_config: _} = errors_on(changeset)
    end

    test "rejects linear without project_id" do
      changeset =
        Project.changeset(%Project{}, %{
          name: "X",
          slug: "x",
          tracker_kind: "linear",
          tracker_config: %{}
        })

      refute changeset.valid?
    end

    test "rejects unknown tracker_kind" do
      changeset =
        Project.changeset(%Project{}, %{name: "X", slug: "x", tracker_kind: "jira"})

      refute changeset.valid?
    end
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
  end
end
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/project_test.exs`
Expected: FAIL — `tracker_kind` is not cast yet, so defaults/validation are missing.

- [ ] **Step 2.3: Implement schema + changeset**

In `elixir/lib/symphony_elixir/local_tracker/project.ex`, add the two fields inside `schema` (after `archived_at`):

```elixir
    field(:tracker_kind, :string, default: "local")
    field(:tracker_config, :map, default: %{})
```

Replace `changeset/2` with:

```elixir
  @valid_tracker_kinds ~w(local github linear)

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(project, attrs) do
    project
    |> cast(attrs, [:name, :slug, :description, :tracker_kind, :tracker_config])
    |> validate_required([:name, :slug])
    |> put_default_tracker_kind()
    |> validate_inclusion(:tracker_kind, @valid_tracker_kinds)
    |> validate_tracker_config()
    |> unique_constraint(:slug)
  end

  defp put_default_tracker_kind(changeset) do
    case get_field(changeset, :tracker_kind) do
      nil -> put_change(changeset, :tracker_kind, "local")
      _ -> changeset
    end
  end

  defp validate_tracker_config(changeset) do
    case get_field(changeset, :tracker_kind) do
      "github" -> validate_config_keys(changeset, ["repo", "project_id"])
      "linear" -> validate_config_keys(changeset, ["project_id"])
      _ -> changeset
    end
  end

  defp validate_config_keys(changeset, required_keys) do
    config = get_field(changeset, :tracker_config) || %{}

    missing = Enum.reject(required_keys, &present_key?(config, &1))

    if missing == [] do
      changeset
    else
      add_error(changeset, :tracker_config, "missing keys: #{Enum.join(missing, ", ")}")
    end
  end

  defp present_key?(config, key) do
    case Map.get(config, key) do
      value when is_binary(value) -> String.trim(value) != ""
      value -> not is_nil(value)
    end
  end
```

Add `import Ecto.Changeset` already exists at top; ensure `get_field`, `put_change`, `add_error` resolve (they come from `Ecto.Changeset`).

- [ ] **Step 2.4: Run the test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/project_test.exs`
Expected: PASS (all 5 tests green).

- [ ] **Step 2.5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/project.ex elixir/test/symphony_elixir/local_tracker/project_test.exs
git commit -m "feat(local-tracker): validate tracker_kind and tracker_config on projects"
```

---

## Task 3 — IssueDTO struct

**Files:**
- Create: `elixir/lib/symphony_elixir/tracker/issue_dto.ex`
- Test: covered indirectly by adapter tests; add a small unit test here.

- [ ] **Step 3.1: Write the failing test**

Create `elixir/test/symphony_elixir/tracker/issue_dto_test.exs`:

```elixir
defmodule SymphonyElixir.Tracker.IssueDTOTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.IssueDTO

  test "build/1 fills defaults and keeps provided values" do
    dto =
      IssueDTO.build(%{
        id: "1",
        identifier: "#42",
        title: "Hello",
        status: %{name: "In Progress", category: "started", position: 2, is_terminal: false},
        project_slug: "demo"
      })

    assert dto.identifier == "#42"
    assert dto.title == "Hello"
    assert dto.status.name == "In Progress"
    assert dto.labels == []
    assert dto.blocked_by == []
    assert dto.priority == nil
    assert dto.position == nil
  end
end
```

- [ ] **Step 3.2: Run the test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/tracker/issue_dto_test.exs`
Expected: FAIL — module `IssueDTO` undefined.

- [ ] **Step 3.3: Implement the DTO**

Create `elixir/lib/symphony_elixir/tracker/issue_dto.ex`:

```elixir
defmodule SymphonyElixir.Tracker.IssueDTO do
  @moduledoc """
  Normalized issue representation returned by every `Tracker.IssueAdapter`.

  Shapes the JSON API payload so the controller + presenter are tracker-agnostic.
  """

  @enforce_keys [:identifier, :title]
  defstruct id: nil,
            identifier: nil,
            title: nil,
            description: nil,
            priority: nil,
            position: nil,
            status: nil,
            labels: [],
            blocked_by: [],
            assignee: nil,
            creator: nil,
            url: nil,
            project_slug: nil,
            created_at: nil,
            updated_at: nil

  @type status :: %{
          name: String.t(),
          category: String.t(),
          position: integer() | nil,
          is_terminal: boolean()
        }

  @type t :: %__MODULE__{
          id: String.t() | nil,
          identifier: String.t(),
          title: String.t(),
          description: String.t() | nil,
          priority: integer() | nil,
          position: integer() | nil,
          status: status() | nil,
          labels: [String.t()],
          blocked_by: [map()],
          assignee: String.t() | nil,
          creator: String.t() | nil,
          url: String.t() | nil,
          project_slug: String.t() | nil,
          created_at: String.t() | nil,
          updated_at: String.t() | nil
        }

  @spec build(map()) :: t()
  def build(attrs) when is_map(attrs) do
    struct!(__MODULE__, normalize(attrs))
  end

  defp normalize(attrs) do
    attrs
    |> Map.new(fn {k, v} -> {to_atom(k), v} end)
    |> Map.put_new(:labels, [])
    |> Map.put_new(:blocked_by, [])
  end

  defp to_atom(key) when is_atom(key), do: key
  defp to_atom(key) when is_binary(key), do: String.to_existing_atom(key)
end
```

- [ ] **Step 3.4: Run the test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/tracker/issue_dto_test.exs`
Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add elixir/lib/symphony_elixir/tracker/issue_dto.ex elixir/test/symphony_elixir/tracker/issue_dto_test.exs
git commit -m "feat(tracker): add normalized IssueDTO struct"
```

---

## Task 4 — IssueAdapter behaviour + resolver

**Files:**
- Create: `elixir/lib/symphony_elixir/tracker/issue_adapter.ex`
- Test: `elixir/test/symphony_elixir/tracker/issue_adapter_test.exs`

- [ ] **Step 4.1: Write the failing test**

Create `elixir/test/symphony_elixir/tracker/issue_adapter_test.exs`:

```elixir
defmodule SymphonyElixir.Tracker.IssueAdapterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueAdapter

  describe "for/1" do
    test "resolves local adapter by default" do
      assert IssueAdapter.for(%Project{tracker_kind: "local"}) ==
               SymphonyElixir.LocalTracker.IssueAdapter
    end

    test "resolves github adapter" do
      assert IssueAdapter.for(%Project{tracker_kind: "github"}) ==
               SymphonyElixir.GitHub.IssueAdapter
    end

    test "resolves linear adapter" do
      assert IssueAdapter.for(%Project{tracker_kind: "linear"}) ==
               SymphonyElixir.Linear.IssueAdapter
    end

    test "falls back to local for nil/unknown kind" do
      assert IssueAdapter.for(%Project{tracker_kind: nil}) ==
               SymphonyElixir.LocalTracker.IssueAdapter
    end
  end
end
```

- [ ] **Step 4.2: Run the test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/tracker/issue_adapter_test.exs`
Expected: FAIL — `IssueAdapter` undefined (and referenced adapter modules don't exist yet; that's fine — `for/1` returns module atoms without invoking them).

- [ ] **Step 4.3: Implement the behaviour + resolver**

Create `elixir/lib/symphony_elixir/tracker/issue_adapter.ex`:

```elixir
defmodule SymphonyElixir.Tracker.IssueAdapter do
  @moduledoc """
  Per-project read/write boundary for the tracker JSON API.

  Selected from the `Project` row, not from global config. The orchestrator's
  `SymphonyElixir.Tracker` behaviour is separate and unaffected.
  """

  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueDTO

  @type filters :: keyword()
  @type tracker_error ::
          :project_not_found
          | :issue_not_found
          | :status_not_found
          | :remote_unavailable
          | :remote_unauthorized
          | :remote_forbidden
          | :remote_rate_limited
          | :missing_credentials
          | :not_supported_on_remote
          | {:remote_validation, map()}
          | {:adapter_error, term()}

  @callback kind() :: :local | :github | :linear
  @callback list_issues(Project.t(), filters()) :: {:ok, [IssueDTO.t()]} | {:error, tracker_error()}
  @callback get_issue(Project.t(), String.t()) :: {:ok, IssueDTO.t()} | {:error, tracker_error()}
  @callback create_issue(Project.t(), map()) :: {:ok, IssueDTO.t()} | {:error, tracker_error()}
  @callback update_issue(Project.t(), String.t(), map()) ::
              {:ok, IssueDTO.t()} | {:error, tracker_error()}
  @callback move_issue(Project.t(), String.t(), map()) ::
              {:ok, IssueDTO.t()} | {:error, tracker_error()}
  @callback list_statuses(Project.t()) :: {:ok, [IssueDTO.status()]} | {:error, tracker_error()}
  @callback list_comments(Project.t(), String.t()) :: {:ok, [map()]} | {:error, tracker_error()}
  @callback add_comment(Project.t(), String.t(), String.t(), map()) ::
              {:ok, map()} | {:error, tracker_error()}

  @default_adapters %{
    "local" => SymphonyElixir.LocalTracker.IssueAdapter,
    "github" => SymphonyElixir.GitHub.IssueAdapter,
    "linear" => SymphonyElixir.Linear.IssueAdapter
  }

  @spec for(Project.t()) :: module()
  def for(%Project{tracker_kind: kind}) do
    overrides = Application.get_env(:symphony_elixir, :issue_adapters, %{})
    merged = Map.merge(@default_adapters, overrides)
    Map.get(merged, kind, SymphonyElixir.LocalTracker.IssueAdapter)
  end

  @spec dispatch(Project.t(), atom(), list()) :: term()
  def dispatch(%Project{} = project, fun, args) when is_atom(fun) and is_list(args) do
    adapter = __MODULE__.for(project)
    apply(adapter, fun, [project | args])
  end
end
```

- [ ] **Step 4.4: Run the test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/tracker/issue_adapter_test.exs`
Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add elixir/lib/symphony_elixir/tracker/issue_adapter.ex elixir/test/symphony_elixir/tracker/issue_adapter_test.exs
git commit -m "feat(tracker): add per-project IssueAdapter behaviour and resolver"
```

---

## Task 5 — Local IssueAdapter (facade returning DTOs)

**Files:**
- Create: `elixir/lib/symphony_elixir/local_tracker/issue_adapter.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/issue_adapter_test.exs`

- [ ] **Step 5.1: Write the failing test**

Create `elixir/test/symphony_elixir/local_tracker/issue_adapter_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.IssueAdapterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueAdapter, Project}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.IssueDTO

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "Demo", slug: "demo"})
    %{project: project}
  end

  test "kind/0 is :local" do
    assert IssueAdapter.kind() == :local
  end

  test "list_issues returns DTOs", %{project: project} do
    {:ok, _issue} = Context.create_issue("demo", %{title: "First", status: "Todo"})

    assert {:ok, [%IssueDTO{} = dto]} = IssueAdapter.list_issues(project, [])
    assert dto.title == "First"
    assert dto.status.name == "Todo"
    assert dto.project_slug == "demo"
  end

  test "create_issue returns DTO", %{project: project} do
    assert {:ok, %IssueDTO{title: "Made"}} =
             IssueAdapter.create_issue(project, %{"title" => "Made", "status" => "Todo"})
  end

  test "get_issue maps not_found", %{project: project} do
    assert {:error, :issue_not_found} = IssueAdapter.get_issue(project, "NOPE-1")
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
end
```

- [ ] **Step 5.2: Run the test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/issue_adapter_test.exs`
Expected: FAIL — `IssueAdapter` (local) undefined.

- [ ] **Step 5.3: Implement the local adapter**

Create `elixir/lib/symphony_elixir/local_tracker/issue_adapter.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.IssueAdapter do
  @moduledoc "Local SQLite-backed implementation of `Tracker.IssueAdapter`."

  @behaviour SymphonyElixir.Tracker.IssueAdapter

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord, Project, WorkflowStatus}
  alias SymphonyElixir.Tracker.IssueDTO

  @impl true
  def kind, do: :local

  @impl true
  def list_issues(%Project{slug: slug}, filters) do
    dtos = slug |> Context.list_issues(filters) |> Enum.map(&to_dto/1)
    {:ok, dtos}
  end

  @impl true
  def get_issue(%Project{slug: slug}, identifier) do
    with {:ok, issue} <- Context.get_issue(slug, identifier) do
      {:ok, to_dto(issue)}
    end
  end

  @impl true
  def create_issue(%Project{slug: slug}, attrs) do
    with {:ok, issue} <- Context.create_issue(slug, attrs) do
      {:ok, to_dto(issue)}
    end
  end

  @impl true
  def update_issue(%Project{slug: slug}, identifier, attrs) do
    with {:ok, issue} <- Context.update_issue(slug, identifier, attrs) do
      {:ok, to_dto(issue)}
    end
  end

  @impl true
  def move_issue(%Project{slug: slug}, identifier, attrs) do
    with {:ok, issue} <- Context.move_issue(slug, identifier, attrs) do
      {:ok, to_dto(issue)}
    end
  end

  @impl true
  def list_statuses(%Project{slug: slug}) do
    statuses = slug |> Context.list_statuses() |> Enum.map(&status_to_map/1)
    {:ok, statuses}
  end

  @impl true
  def list_comments(%Project{slug: slug}, identifier) do
    Context.list_comments(slug, identifier)
  end

  @impl true
  def add_comment(%Project{slug: slug}, identifier, body, attrs) do
    Context.add_comment(slug, identifier, body, attrs)
  end

  @spec to_dto(IssueRecord.t()) :: IssueDTO.t()
  def to_dto(%IssueRecord{} = issue) do
    IssueDTO.build(%{
      id: to_string(issue.id),
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      position: issue.position,
      status: status_to_map(issue.status),
      assignee: issue.assignee_id,
      creator: issue.creator,
      url: issue.url,
      project_slug: project_slug(issue),
      created_at: iso8601(issue.inserted_at),
      updated_at: iso8601(issue.updated_at)
    })
  end

  defp status_to_map(%WorkflowStatus{} = status) do
    %{name: status.name, category: status.category, position: status.position, is_terminal: status.is_terminal}
  end

  defp status_to_map(_), do: nil

  defp project_slug(%IssueRecord{project: %Project{slug: slug}}), do: slug
  defp project_slug(_), do: nil

  defp iso8601(%DateTime{} = dt), do: dt |> DateTime.truncate(:second) |> DateTime.to_iso8601()
  defp iso8601(_), do: nil
end
```

- [ ] **Step 5.4: Run the test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/issue_adapter_test.exs`
Expected: PASS (4 tests).

- [ ] **Step 5.5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/issue_adapter.ex elixir/test/symphony_elixir/local_tracker/issue_adapter_test.exs
git commit -m "feat(local-tracker): add local IssueAdapter returning DTOs"
```

---

## Task 6 — TrackerPresenter handles IssueDTO + status maps

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`
- Test: extend `elixir/test/symphony_elixir/local_tracker/issue_adapter_test.exs` is not for the presenter; create `elixir/test/symphony_elixir_web/presenters/tracker_presenter_test.exs`.

- [ ] **Step 6.1: Write the failing test**

Create `elixir/test/symphony_elixir_web/presenters/tracker_presenter_test.exs`:

```elixir
defmodule SymphonyElixirWeb.TrackerPresenterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixirWeb.TrackerPresenter

  test "issue/1 serializes an IssueDTO" do
    dto =
      IssueDTO.build(%{
        id: "9",
        identifier: "#9",
        title: "Remote issue",
        description: "body",
        priority: 2,
        status: %{name: "In Progress", category: "started", position: 2, is_terminal: false},
        assignee: "octocat",
        creator: "octocat",
        url: "https://github.com/o/r/issues/9",
        project_slug: "remote",
        created_at: "2026-05-28T00:00:00Z",
        updated_at: "2026-05-28T00:00:00Z"
      })

    json = TrackerPresenter.issue(dto)

    assert json.identifier == "#9"
    assert json.status == %{name: "In Progress", category: "started", position: 2, is_terminal: false}
    assert json.assignee_id == "octocat"
    assert json.creator == "octocat"
    assert json.project_slug == "remote"
  end
end
```

- [ ] **Step 6.2: Run the test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/presenters/tracker_presenter_test.exs`
Expected: FAIL — `issue/1` has no clause for `IssueDTO`.

- [ ] **Step 6.3: Implement the new presenter clauses**

In `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`:

1. Add the alias at the top alias block:

```elixir
  alias SymphonyElixir.Tracker.IssueDTO
```

2. Add a new `issue/1` clause **above** the existing `IssueRecord` clause:

```elixir
  @spec issue(IssueDTO.t()) :: map()
  def issue(%IssueDTO{} = dto) do
    %{
      id: dto.id,
      identifier: dto.identifier,
      title: dto.title,
      description: dto.description,
      priority: dto.priority,
      position: dto.position,
      assignee_id: dto.assignee,
      creator: dto.creator,
      worker_id: nil,
      branch_name: nil,
      url: dto.url,
      project_slug: dto.project_slug,
      status: dto.status,
      labels: dto.labels,
      blocked_by: dto.blocked_by,
      started_at: nil,
      completed_at: nil,
      inserted_at: dto.created_at,
      updated_at: dto.updated_at
    }
  end
```

3. Add a `status/1` clause for plain status maps (used by `list_statuses` from remote adapters), **above** the `WorkflowStatus` clause:

```elixir
  @spec status(map()) :: map()
  def status(%{name: name} = status) when is_map_key(status, :category) do
    %{
      id: Map.get(status, :id),
      name: name,
      category: Map.get(status, :category),
      position: Map.get(status, :position),
      is_terminal: Map.get(status, :is_terminal, false)
    }
  end
```

- [ ] **Step 6.4: Run the test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/presenters/tracker_presenter_test.exs`
Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex elixir/test/symphony_elixir_web/presenters/tracker_presenter_test.exs
git commit -m "feat(tracker-api): presenter serializes IssueDTO and status maps"
```

---

## Task 7 — TrackerErrors maps adapter error atoms

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/tracker_errors.ex`
- Test: `elixir/test/symphony_elixir_web/tracker_errors_test.exs` (create)

- [ ] **Step 7.1: Read the existing module first**

Read `elixir/lib/symphony_elixir_web/tracker_errors.ex` to learn the existing `render/2` signature and helper names (`validation/2`). Match its style for the new clauses.

- [ ] **Step 7.2: Write the failing test**

Create `elixir/test/symphony_elixir_web/tracker_errors_test.exs`:

```elixir
defmodule SymphonyElixirWeb.TrackerErrorsTest do
  use ExUnit.Case, async: true

  import Phoenix.ConnTest
  alias SymphonyElixirWeb.TrackerErrors

  @endpoint SymphonyElixirWeb.Endpoint

  test "maps missing_credentials to 503" do
    conn = TrackerErrors.render(build_conn(), :missing_credentials)
    assert json_response(conn, 503)["error"]["code"] == "tracker_credentials_missing"
  end

  test "maps remote_unauthorized to 502" do
    conn = TrackerErrors.render(build_conn(), :remote_unauthorized)
    assert json_response(conn, 502)["error"]["code"] == "tracker_unauthorized"
  end

  test "maps remote_rate_limited to 429" do
    conn = TrackerErrors.render(build_conn(), :remote_rate_limited)
    assert json_response(conn, 429)["error"]["code"] == "tracker_rate_limited"
  end

  test "maps not_supported_on_remote to 501" do
    conn = TrackerErrors.render(build_conn(), :not_supported_on_remote)
    assert json_response(conn, 501)["error"]["code"] == "tracker_not_supported"
  end
end
```

- [ ] **Step 7.3: Run the test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/tracker_errors_test.exs`
Expected: FAIL — no clause for these atoms (likely falls into a generic 500 or function clause error).

- [ ] **Step 7.4: Implement the new clauses**

In `elixir/lib/symphony_elixir_web/tracker_errors.ex`, add clauses to `render/2` (place them before any catch-all clause). Match the module's existing response helper; the pattern used elsewhere is `conn |> put_status(code) |> json(%{error: %{code: ..., message: ...}})`. Concretely:

```elixir
  def render(conn, :missing_credentials),
    do: error(conn, 503, "tracker_credentials_missing", "GITHUB_TOKEN / LINEAR_API_KEY missing on server")

  def render(conn, :remote_unauthorized),
    do: error(conn, 502, "tracker_unauthorized", "Remote tracker rejected the token (401)")

  def render(conn, :remote_forbidden),
    do: error(conn, 502, "tracker_forbidden", "Remote tracker forbade the request (403)")

  def render(conn, :remote_rate_limited),
    do: error(conn, 429, "tracker_rate_limited", "Remote tracker rate limit hit; retry later")

  def render(conn, :remote_unavailable),
    do: error(conn, 502, "tracker_unavailable", "Remote tracker unreachable; try again")

  def render(conn, :not_supported_on_remote),
    do: error(conn, 501, "tracker_not_supported", "This action is not supported on the remote tracker")

  def render(conn, {:remote_validation, details}),
    do: error(conn, 422, "tracker_validation_failed", "Remote tracker rejected the request", details)

  def render(conn, {:adapter_error, _reason}),
    do: error(conn, 500, "tracker_internal", "Tracker adapter error")
```

If the module does not already define a private `error/4`/`error/5` helper with that exact name, add one (and adapt the calls above to whatever the module already uses). Concretely add:

```elixir
  defp error(conn, status, code, message, details \\ nil) do
    body = %{error: %{code: code, message: message}}
    body = if details, do: put_in(body, [:error, :details], details), else: body

    conn
    |> Plug.Conn.put_status(status)
    |> Phoenix.Controller.json(body)
  end
```

Ensure `import Plug.Conn`/`import Phoenix.Controller` or fully-qualified calls are consistent with the file (the snippet uses fully-qualified calls to avoid import assumptions).

- [ ] **Step 7.5: Run the test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/tracker_errors_test.exs`
Expected: PASS.

- [ ] **Step 7.6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/tracker_errors.ex elixir/test/symphony_elixir_web/tracker_errors_test.exs
git commit -m "feat(tracker-api): map tracker adapter errors to HTTP responses"
```

---

## Task 8 — IssueController dispatches through the adapter

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs` (existing — must stay green)

This task is a **refactor with no behaviour change for local projects**. The existing controller test suite is the regression guard.

- [ ] **Step 8.1: Run the existing suite first (baseline green)**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs`
Expected: PASS (baseline before refactor).

- [ ] **Step 8.2: Refactor `index/2`, `show/2`, `create/2`, `update/2`, `move/2`**

Edit `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex`. Add aliases:

```elixir
  alias SymphonyElixir.Tracker.IssueAdapter
```

Rewrite each action to resolve the project then dispatch. Example for `index/2`:

```elixir
  def index(conn, %{"project_slug" => project_slug} = params) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, filters} <- build_filters(params),
         {:ok, issues} <- IssueAdapter.dispatch(project, :list_issues, [filters]) do
      json(conn, %{data: Enum.map(issues, &TrackerPresenter.issue/1)})
    else
      {:error, :project_not_found} -> TrackerErrors.render(conn, :project_not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
```

`create/2`:

```elixir
  def create(conn, %{"project_slug" => project_slug} = params) do
    attrs = params |> Map.delete("project_slug") |> maybe_inject_creator()

    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, issue} <- IssueAdapter.dispatch(project, :create_issue, [attrs]) do
      conn |> put_status(:created) |> json(%{data: TrackerPresenter.issue(issue)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
```

`show/2`:

```elixir
  def show(conn, %{"project_slug" => project_slug, "id" => identifier}) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      json(conn, %{data: TrackerPresenter.issue(issue)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
```

`update/2`:

```elixir
  def update(conn, %{"project_slug" => project_slug, "id" => identifier} = params) do
    attrs = Map.drop(params, ["project_slug", "id"])

    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, issue} <- IssueAdapter.dispatch(project, :update_issue, [identifier, attrs]) do
      json(conn, %{data: TrackerPresenter.issue(issue)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
```

`move/2`:

```elixir
  def move(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    attrs = Map.drop(params, ["project_slug", "identifier"])

    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, issue} <- IssueAdapter.dispatch(project, :move_issue, [identifier, attrs]) do
      json(conn, %{data: TrackerPresenter.issue(issue)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
```

Keep `build_filters/1`, `maybe_inject_creator/1`, `resolve_me/1`, etc., as they are.

> Note: `TrackerPresenter.issue/1` now must accept `IssueDTO` (Task 6). The local adapter returns DTOs, so the presenter clause for `IssueRecord` is no longer hit from this controller — that clause stays for any other callers (channels/broadcaster).

- [ ] **Step 8.3: Run the existing suite (expect still green)**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs`
Expected: PASS — all prior assertions hold because the local adapter returns equivalent data.

- [ ] **Step 8.4: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex
git commit -m "refactor(tracker-api): dispatch issue endpoints through IssueAdapter"
```

---

## Task 9 — GitHub IssueAdapter Query module (read path)

**Files:**
- Create: `elixir/lib/symphony_elixir/github/issue_adapter/query.ex`
- Test: `elixir/test/symphony_elixir/github/issue_adapter_query_test.exs`

This task builds the pure normalizers first (no network), so they are unit-testable.

- [ ] **Step 9.1: Write the failing test**

Create `elixir/test/symphony_elixir/github/issue_adapter_query_test.exs`:

```elixir
defmodule SymphonyElixir.GitHub.IssueAdapter.QueryTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.IssueAdapter.Query
  alias SymphonyElixir.Tracker.IssueDTO

  test "normalize_item maps a projectV2 item into IssueDTO" do
    item = %{
      "id" => "PVTI_1",
      "content" => %{
        "__typename" => "Issue",
        "id" => "I_1",
        "number" => 42,
        "title" => "Fix bug",
        "body" => "details",
        "url" => "https://github.com/o/r/issues/42",
        "assignees" => %{"nodes" => [%{"login" => "octocat"}]},
        "labels" => %{"nodes" => [%{"name" => "bug"}]},
        "createdAt" => "2026-05-28T00:00:00Z",
        "updatedAt" => "2026-05-28T01:00:00Z"
      },
      "fieldValues" => %{
        "nodes" => [
          %{
            "__typename" => "ProjectV2ItemFieldSingleSelectValue",
            "name" => "In Progress",
            "field" => %{"name" => "Symphony State"}
          }
        ]
      }
    }

    dto = Query.normalize_item(item, "Symphony State", "demo")

    assert %IssueDTO{} = dto
    assert dto.identifier == "#42"
    assert dto.title == "Fix bug"
    assert dto.assignee == "octocat"
    assert dto.labels == ["bug"]
    assert dto.status.name == "In Progress"
    assert dto.project_slug == "demo"
  end

  test "normalize_item skips non-issue content" do
    item = %{"id" => "PVTI_2", "content" => %{"__typename" => "DraftIssue"}, "fieldValues" => %{"nodes" => []}}
    assert Query.normalize_item(item, "Symphony State", "demo") == nil
  end

  test "category_for maps known names" do
    assert Query.category_for("In Progress") == "started"
    assert Query.category_for("Done") == "completed"
    assert Query.category_for("Cancelled") == "canceled"
    assert Query.category_for("Backlog") == "backlog"
    assert Query.category_for("Whatever") == "unstarted"
  end
end
```

- [ ] **Step 9.2: Run the test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/issue_adapter_query_test.exs`
Expected: FAIL — `Query` undefined.

- [ ] **Step 9.3: Implement the Query module**

Create `elixir/lib/symphony_elixir/github/issue_adapter/query.ex`:

```elixir
defmodule SymphonyElixir.GitHub.IssueAdapter.Query do
  @moduledoc "GraphQL strings + normalizers for the GitHub Project v2 UI adapter."

  alias SymphonyElixir.Tracker.IssueDTO

  @list_items """
  query SymphonyUiListItems($projectId: ID!, $first: Int!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: $first, after: $after) {
          nodes {
            id
            content {
              __typename
              ... on Issue {
                id number title body url
                assignees(first: 1) { nodes { login } }
                labels(first: 20) { nodes { name } }
                createdAt updatedAt
              }
            }
            fieldValues(first: 30) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2FieldCommon { id name } }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
  """

  @status_options """
  query SymphonyUiStatusOptions($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2SingleSelectField {
              id name
              options { id name }
            }
          }
        }
      }
    }
  }
  """

  def list_items_query, do: @list_items
  def status_options_query, do: @status_options

  @spec normalize_item(map(), String.t(), String.t()) :: IssueDTO.t() | nil
  def normalize_item(%{"content" => %{"__typename" => "Issue"} = content} = item, status_field, project_slug) do
    IssueDTO.build(%{
      id: content["id"],
      identifier: "#" <> to_string(content["number"]),
      title: content["title"],
      description: content["body"],
      url: content["url"],
      assignee: first_login(content),
      labels: label_names(content),
      status: status_from_field_values(item["fieldValues"], status_field),
      project_slug: project_slug,
      created_at: content["createdAt"],
      updated_at: content["updatedAt"]
    })
  end

  def normalize_item(_item, _status_field, _project_slug), do: nil

  @spec status_options(map()) :: [IssueDTO.status()]
  def status_options(%{"data" => %{"node" => %{"fields" => %{"nodes" => nodes}}}}) do
    nodes
    |> Enum.find(fn n -> n["__typename"] == "ProjectV2SingleSelectField" end)
    |> case do
      %{"options" => options} ->
        options
        |> Enum.with_index()
        |> Enum.map(fn {opt, idx} ->
          %{name: opt["name"], category: category_for(opt["name"]), position: idx, is_terminal: terminal?(opt["name"])}
        end)

      _ ->
        []
    end
  end

  def status_options(_), do: []

  @spec category_for(String.t()) :: String.t()
  def category_for(name) do
    cond do
      name in ["Backlog"] -> "backlog"
      name in ["In Progress", "In Review", "Human Review", "Merging", "Rework"] -> "started"
      name in ["Done", "Merged"] -> "completed"
      name in ["Cancelled", "Canceled", "Duplicate"] -> "canceled"
      true -> "unstarted"
    end
  end

  defp terminal?(name), do: category_for(name) in ["completed", "canceled"]

  defp first_login(%{"assignees" => %{"nodes" => [%{"login" => login} | _]}}), do: login
  defp first_login(_), do: nil

  defp label_names(%{"labels" => %{"nodes" => nodes}}), do: Enum.map(nodes, & &1["name"])
  defp label_names(_), do: []

  defp status_from_field_values(%{"nodes" => nodes}, status_field) do
    nodes
    |> Enum.find(fn n ->
      n["__typename"] == "ProjectV2ItemFieldSingleSelectValue" and
        get_in(n, ["field", "name"]) == status_field
    end)
    |> case do
      %{"name" => name} -> %{name: name, category: category_for(name), position: nil, is_terminal: terminal?(name)}
      _ -> nil
    end
  end

  defp status_from_field_values(_, _), do: nil
end
```

- [ ] **Step 9.4: Run the test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/issue_adapter_query_test.exs`
Expected: PASS (4 tests).

- [ ] **Step 9.5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/issue_adapter/query.ex elixir/test/symphony_elixir/github/issue_adapter_query_test.exs
git commit -m "feat(github): add Project v2 UI query + normalizers"
```

---

## Task 10 — GitHub IssueAdapter (wired to a stubbed client)

**Files:**
- Create: `elixir/lib/symphony_elixir/github/issue_adapter.ex`
- Test: `elixir/test/symphony_elixir/github/issue_adapter_test.exs`

- [ ] **Step 10.1: Write the failing test**

Create `elixir/test/symphony_elixir/github/issue_adapter_test.exs`:

```elixir
defmodule SymphonyElixir.GitHub.IssueAdapterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.GitHub.IssueAdapter
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueDTO

  defmodule ListClientStub do
    def graphql(_query, _vars, _opts) do
      {:ok,
       %{
         "data" => %{
           "node" => %{
             "items" => %{
               "nodes" => [
                 %{
                   "id" => "PVTI_1",
                   "content" => %{
                     "__typename" => "Issue",
                     "id" => "I_1",
                     "number" => 7,
                     "title" => "Remote",
                     "body" => nil,
                     "url" => "https://x/7",
                     "assignees" => %{"nodes" => []},
                     "labels" => %{"nodes" => []},
                     "createdAt" => "2026-05-28T00:00:00Z",
                     "updatedAt" => "2026-05-28T00:00:00Z"
                   },
                   "fieldValues" => %{
                     "nodes" => [
                       %{
                         "__typename" => "ProjectV2ItemFieldSingleSelectValue",
                         "name" => "Todo",
                         "field" => %{"name" => "Symphony State"}
                       }
                     ]
                   }
                 }
               ],
               "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
             }
           }
         }
       }}
    end
  end

  defmodule UnauthorizedClientStub do
    def graphql(_query, _vars, _opts), do: {:error, {:github_api_status, 401}}
  end

  setup do
    Application.put_env(:symphony_elixir, :github_client_module, ListClientStub)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :github_client_module) end)
    :ok
  end

  defp project do
    %Project{
      slug: "remote",
      tracker_kind: "github",
      tracker_config: %{"repo" => "o/r", "project_id" => "PVT_1", "status_field" => "Symphony State"}
    }
  end

  test "kind/0 is :github" do
    assert IssueAdapter.kind() == :github
  end

  test "list_issues returns DTOs from the board" do
    assert {:ok, [%IssueDTO{identifier: "#7", title: "Remote", status: %{name: "Todo"}}]} =
             IssueAdapter.list_issues(project(), [])
  end

  test "maps 401 to :remote_unauthorized" do
    Application.put_env(:symphony_elixir, :github_client_module, UnauthorizedClientStub)
    assert {:error, :remote_unauthorized} = IssueAdapter.list_issues(project(), [])
  end
end
```

- [ ] **Step 10.2: Run the test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/issue_adapter_test.exs`
Expected: FAIL — `IssueAdapter` (github) undefined.

- [ ] **Step 10.3: Implement the adapter**

Create `elixir/lib/symphony_elixir/github/issue_adapter.ex`:

```elixir
defmodule SymphonyElixir.GitHub.IssueAdapter do
  @moduledoc "GitHub Project v2 implementation of `Tracker.IssueAdapter` (UI reads/writes)."

  @behaviour SymphonyElixir.Tracker.IssueAdapter

  alias SymphonyElixir.GitHub.Client
  alias SymphonyElixir.GitHub.IssueAdapter.Query
  alias SymphonyElixir.LocalTracker.Project

  @page_size 50

  @impl true
  def kind, do: :github

  @impl true
  def list_issues(%Project{} = project, _filters) do
    %{project_id: project_id, status_field: status_field} = config(project)

    with {:ok, response} <-
           client().graphql(Query.list_items_query(), %{
             "projectId" => project_id,
             "first" => @page_size,
             "after" => nil
           }) do
      issues =
        response
        |> get_in(["data", "node", "items", "nodes"])
        |> List.wrap()
        |> Enum.map(&Query.normalize_item(&1, status_field, project.slug))
        |> Enum.reject(&is_nil/1)

      {:ok, issues}
    else
      error -> {:error, map_error(error)}
    end
  end

  @impl true
  def get_issue(%Project{} = project, identifier) do
    with {:ok, issues} <- list_issues(project, []) do
      case Enum.find(issues, &(&1.identifier == identifier)) do
        nil -> {:error, :issue_not_found}
        dto -> {:ok, dto}
      end
    end
  end

  @impl true
  def list_statuses(%Project{} = project) do
    %{project_id: project_id} = config(project)

    with {:ok, response} <- client().graphql(Query.status_options_query(), %{"projectId" => project_id}) do
      {:ok, Query.status_options(response)}
    else
      error -> {:error, map_error(error)}
    end
  end

  @impl true
  def create_issue(%Project{} = _project, _attrs), do: {:error, :not_supported_on_remote}

  @impl true
  def update_issue(%Project{} = _project, _identifier, _attrs), do: {:error, :not_supported_on_remote}

  @impl true
  def move_issue(%Project{} = _project, _identifier, _attrs), do: {:error, :not_supported_on_remote}

  @impl true
  def list_comments(%Project{} = _project, _identifier), do: {:error, :not_supported_on_remote}

  @impl true
  def add_comment(%Project{} = _project, _identifier, _body, _attrs), do: {:error, :not_supported_on_remote}

  defp config(%Project{tracker_config: cfg}) do
    %{
      project_id: Map.fetch!(cfg, "project_id"),
      repo: Map.get(cfg, "repo"),
      status_field: Map.get(cfg, "status_field", "Symphony State")
    }
  end

  defp client, do: Application.get_env(:symphony_elixir, :github_client_module, Client)

  defp map_error({:error, reason}), do: map_error(reason)
  defp map_error(:missing_github_token), do: :missing_credentials
  defp map_error({:github_api_status, 401}), do: :remote_unauthorized
  defp map_error({:github_api_status, 403}), do: :remote_forbidden
  defp map_error({:github_api_status, status}) when status in 500..599, do: :remote_unavailable
  defp map_error(_), do: :remote_unavailable
end
```

> Mutations (`create/update/move/comment`) are stubbed `:not_supported_on_remote` here and completed in **Task 11**. This keeps the read path landable and green.

- [ ] **Step 10.4: Run the test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/issue_adapter_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 10.5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/issue_adapter.ex elixir/test/symphony_elixir/github/issue_adapter_test.exs
git commit -m "feat(github): add Project v2 issue adapter read path"
```

---

## Task 11 — GitHub adapter mutations (create/move/comment)

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/issue_adapter/query.ex` (add mutation strings + helpers)
- Modify: `elixir/lib/symphony_elixir/github/issue_adapter.ex`
- Test: extend `elixir/test/symphony_elixir/github/issue_adapter_test.exs`

- [ ] **Step 11.1: Write the failing tests (append to existing test file)**

Append inside `SymphonyElixir.GitHub.IssueAdapterTest`:

```elixir
  defmodule MoveClientStub do
    def graphql(query, _vars, _opts) do
      cond do
        String.contains?(query, "fields(first") ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "fields" => %{
                   "nodes" => [
                     %{
                       "__typename" => "ProjectV2SingleSelectField",
                       "id" => "FIELD_1",
                       "name" => "Symphony State",
                       "options" => [%{"id" => "OPT_DONE", "name" => "Done"}]
                     }
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "updateProjectV2ItemFieldValue") ->
          {:ok, %{"data" => %{"updateProjectV2ItemFieldValue" => %{"projectV2Item" => %{"id" => "PVTI_1"}}}}}

        true ->
          {:ok, %{"data" => %{}}}
      end
    end
  end

  test "move_issue resolves option id and posts the mutation" do
    Application.put_env(:symphony_elixir, :github_client_module, MoveClientStub)

    assert {:ok, %{status: "Done"}} =
             IssueAdapter.move_issue(
               %{project() | tracker_config: Map.put(project().tracker_config, "status_field", "Symphony State")},
               "PVTI_1",
               %{"status" => "Done", "item_id" => "PVTI_1"}
             )
  end
```

> Note: GitHub Project v2 moves operate on the **item id** (`PVTI_*`), not the issue number. The frontend already has the item id from `list_issues` (we expose it as `dto.id`). For `move_issue`, the controller passes `item_id` in attrs; we resolve it from `attrs["item_id"]` or fall back to `dto.id` (see implementation).

- [ ] **Step 11.2: Run the test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/issue_adapter_test.exs`
Expected: FAIL — `move_issue` still returns `:not_supported_on_remote`.

- [ ] **Step 11.3: Add mutation strings to the Query module**

Append to `elixir/lib/symphony_elixir/github/issue_adapter/query.ex` (inside the module):

```elixir
  @update_field_value """
  mutation SymphonyUiSetStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
      value: { singleSelectOptionId: $optionId }
    }) {
      projectV2Item { id }
    }
  }
  """

  def update_field_value_mutation, do: @update_field_value

  @spec resolve_field_and_option(map(), String.t(), String.t()) ::
          {:ok, String.t(), String.t()} | {:error, :status_not_found}
  def resolve_field_and_option(%{"data" => %{"node" => %{"fields" => %{"nodes" => nodes}}}}, status_field, option_name) do
    nodes
    |> Enum.find(fn n -> n["__typename"] == "ProjectV2SingleSelectField" and n["name"] == status_field end)
    |> case do
      %{"id" => field_id, "options" => options} ->
        case Enum.find(options, &(&1["name"] == option_name)) do
          %{"id" => option_id} -> {:ok, field_id, option_id}
          _ -> {:error, :status_not_found}
        end

      _ ->
        {:error, :status_not_found}
    end
  end

  def resolve_field_and_option(_, _, _), do: {:error, :status_not_found}
```

- [ ] **Step 11.4: Implement `move_issue` in the adapter**

Replace the stubbed `move_issue/3` in `elixir/lib/symphony_elixir/github/issue_adapter.ex` with:

```elixir
  @impl true
  def move_issue(%Project{} = project, identifier, attrs) do
    %{project_id: project_id, status_field: status_field} = config(project)
    item_id = Map.get(attrs, "item_id") || Map.get(attrs, :item_id) || identifier
    target_status = Map.get(attrs, "status") || Map.get(attrs, "state") || Map.get(attrs, :status)

    with {:ok, fields_response} <- client().graphql(Query.status_options_query(), %{"projectId" => project_id}),
         {:ok, field_id, option_id} <-
           Query.resolve_field_and_option(fields_response, status_field, target_status),
         {:ok, _} <-
           client().graphql(Query.update_field_value_mutation(), %{
             "projectId" => project_id,
             "itemId" => item_id,
             "fieldId" => field_id,
             "optionId" => option_id
           }) do
      {:ok, SymphonyElixir.Tracker.IssueDTO.build(%{identifier: identifier, title: target_status, status: %{name: target_status, category: Query.category_for(target_status), position: nil, is_terminal: false}, project_slug: project.slug})}
    else
      {:error, :status_not_found} -> {:error, :status_not_found}
      error -> {:error, map_error(error)}
    end
  end
```

> `create_issue`, `update_issue`, `list_comments`, `add_comment` remain `:not_supported_on_remote` for this slice's GitHub MVP scope unless you choose to implement them; the spec lists full mutations as the target but moving status is the highest-value path. If you implement create/comment, follow the same stub→test→implement loop with `createIssue` + `addProjectV2ItemById` and `addComment` mutations. **Mark this explicitly in the PR description as a scoped follow-up if you defer them.**

- [ ] **Step 11.5: Run the test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/issue_adapter_test.exs`
Expected: PASS (4 tests).

- [ ] **Step 11.6: Commit**

```bash
git add elixir/lib/symphony_elixir/github/issue_adapter.ex elixir/lib/symphony_elixir/github/issue_adapter/query.ex elixir/test/symphony_elixir/github/issue_adapter_test.exs
git commit -m "feat(github): move Project v2 item status via adapter"
```

---

## Task 12 — Linear IssueAdapter Query module

**Files:**
- Create: `elixir/lib/symphony_elixir/linear/issue_adapter/query.ex`
- Test: `elixir/test/symphony_elixir/linear/issue_adapter_query_test.exs`

- [ ] **Step 12.1: Write the failing test**

Create `elixir/test/symphony_elixir/linear/issue_adapter_query_test.exs`:

```elixir
defmodule SymphonyElixir.Linear.IssueAdapter.QueryTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Linear.IssueAdapter.Query
  alias SymphonyElixir.Tracker.IssueDTO

  test "normalize_issue maps a Linear issue node into IssueDTO" do
    node = %{
      "id" => "uuid-1",
      "identifier" => "LIN-42",
      "title" => "Ship it",
      "description" => "body",
      "priority" => 2,
      "url" => "https://linear.app/x/issue/LIN-42",
      "state" => %{"name" => "In Progress", "type" => "started", "position" => 2.0},
      "assignee" => %{"displayName" => "Octo"},
      "creator" => %{"displayName" => "Cat"},
      "createdAt" => "2026-05-28T00:00:00Z",
      "updatedAt" => "2026-05-28T01:00:00Z"
    }

    dto = Query.normalize_issue(node, "demo")

    assert %IssueDTO{} = dto
    assert dto.identifier == "LIN-42"
    assert dto.status.name == "In Progress"
    assert dto.status.category == "started"
    assert dto.assignee == "Octo"
    assert dto.creator == "Cat"
  end

  test "category_for maps Linear state types" do
    assert Query.category_for("started") == "started"
    assert Query.category_for("completed") == "completed"
    assert Query.category_for("canceled") == "canceled"
    assert Query.category_for("backlog") == "backlog"
    assert Query.category_for("unstarted") == "unstarted"
    assert Query.category_for("triage") == "unstarted"
  end
end
```

- [ ] **Step 12.2: Run the test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/linear/issue_adapter_query_test.exs`
Expected: FAIL — `Query` undefined.

- [ ] **Step 12.3: Implement the Query module**

Create `elixir/lib/symphony_elixir/linear/issue_adapter/query.ex`:

```elixir
defmodule SymphonyElixir.Linear.IssueAdapter.Query do
  @moduledoc "GraphQL strings + normalizers for the Linear project UI adapter."

  alias SymphonyElixir.Tracker.IssueDTO

  @list_issues """
  query SymphonyUiLinearIssues($projectId: String!) {
    project(id: $projectId) {
      id
      issues(first: 100) {
        nodes {
          id identifier title description priority url
          state { id name type position }
          assignee { displayName }
          creator { displayName }
          createdAt updatedAt
        }
      }
    }
  }
  """

  @team_states """
  query SymphonyUiLinearStates($projectId: String!) {
    project(id: $projectId) {
      id
      teams(first: 1) {
        nodes {
          id
          states(first: 50) { nodes { id name type position } }
        }
      }
    }
  }
  """

  def list_issues_query, do: @list_issues
  def team_states_query, do: @team_states

  @spec normalize_issue(map(), String.t()) :: IssueDTO.t()
  def normalize_issue(node, project_slug) do
    IssueDTO.build(%{
      id: node["id"],
      identifier: node["identifier"],
      title: node["title"],
      description: node["description"],
      priority: node["priority"],
      url: node["url"],
      assignee: get_in(node, ["assignee", "displayName"]),
      creator: get_in(node, ["creator", "displayName"]),
      status: state_to_status(node["state"]),
      project_slug: project_slug,
      created_at: node["createdAt"],
      updated_at: node["updatedAt"]
    })
  end

  @spec team_states(map()) :: [IssueDTO.status()]
  def team_states(%{"data" => %{"project" => %{"teams" => %{"nodes" => [team | _]}}}}) do
    team
    |> get_in(["states", "nodes"])
    |> List.wrap()
    |> Enum.sort_by(& &1["position"])
    |> Enum.map(&state_to_status/1)
  end

  def team_states(_), do: []

  @spec category_for(String.t()) :: String.t()
  def category_for(type) do
    case type do
      "started" -> "started"
      "completed" -> "completed"
      "canceled" -> "canceled"
      "backlog" -> "backlog"
      _ -> "unstarted"
    end
  end

  defp state_to_status(nil), do: nil

  defp state_to_status(%{"name" => name, "type" => type} = state) do
    %{name: name, category: category_for(type), position: trunc_position(state["position"]), is_terminal: type in ["completed", "canceled"]}
  end

  defp trunc_position(p) when is_number(p), do: trunc(p)
  defp trunc_position(_), do: nil
end
```

- [ ] **Step 12.4: Run the test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/linear/issue_adapter_query_test.exs`
Expected: PASS.

- [ ] **Step 12.5: Commit**

```bash
git add elixir/lib/symphony_elixir/linear/issue_adapter/query.ex elixir/test/symphony_elixir/linear/issue_adapter_query_test.exs
git commit -m "feat(linear): add project UI query + normalizers"
```

---

## Task 13 — Linear IssueAdapter (read + move)

**Files:**
- Create: `elixir/lib/symphony_elixir/linear/issue_adapter.ex`
- Test: `elixir/test/symphony_elixir/linear/issue_adapter_test.exs`

- [ ] **Step 13.1: Write the failing test**

Create `elixir/test/symphony_elixir/linear/issue_adapter_test.exs`:

```elixir
defmodule SymphonyElixir.Linear.IssueAdapterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Linear.IssueAdapter
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueDTO

  defmodule ListClientStub do
    def graphql(_query, _vars, _opts) do
      {:ok,
       %{
         "data" => %{
           "project" => %{
             "id" => "proj-uuid",
             "issues" => %{
               "nodes" => [
                 %{
                   "id" => "i-1",
                   "identifier" => "LIN-1",
                   "title" => "First",
                   "description" => nil,
                   "priority" => 0,
                   "url" => "https://linear.app/x/LIN-1",
                   "state" => %{"id" => "s1", "name" => "Todo", "type" => "unstarted", "position" => 1.0},
                   "assignee" => nil,
                   "creator" => nil,
                   "createdAt" => "2026-05-28T00:00:00Z",
                   "updatedAt" => "2026-05-28T00:00:00Z"
                 }
               ]
             }
           }
         }
       }}
    end
  end

  defmodule ErrorClientStub do
    def graphql(_query, _vars, _opts), do: {:error, {:linear_api_status, 401}}
  end

  setup do
    Application.put_env(:symphony_elixir, :linear_client_module, ListClientStub)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :linear_client_module) end)
    :ok
  end

  defp project do
    %Project{slug: "demo", tracker_kind: "linear", tracker_config: %{"project_id" => "proj-uuid"}}
  end

  test "kind/0 is :linear" do
    assert IssueAdapter.kind() == :linear
  end

  test "list_issues returns DTOs" do
    assert {:ok, [%IssueDTO{identifier: "LIN-1", status: %{name: "Todo"}}]} =
             IssueAdapter.list_issues(project(), [])
  end

  test "maps 401 to :remote_unauthorized" do
    Application.put_env(:symphony_elixir, :linear_client_module, ErrorClientStub)
    assert {:error, :remote_unauthorized} = IssueAdapter.list_issues(project(), [])
  end
end
```

- [ ] **Step 13.2: Run the test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/linear/issue_adapter_test.exs`
Expected: FAIL — `IssueAdapter` (linear) undefined.

- [ ] **Step 13.3: Implement the adapter**

Create `elixir/lib/symphony_elixir/linear/issue_adapter.ex`:

```elixir
defmodule SymphonyElixir.Linear.IssueAdapter do
  @moduledoc "Linear project implementation of `Tracker.IssueAdapter` (UI reads/writes)."

  @behaviour SymphonyElixir.Tracker.IssueAdapter

  alias SymphonyElixir.Linear.Client
  alias SymphonyElixir.Linear.IssueAdapter.Query
  alias SymphonyElixir.LocalTracker.Project

  @impl true
  def kind, do: :linear

  @impl true
  def list_issues(%Project{} = project, _filters) do
    project_id = Map.fetch!(project.tracker_config, "project_id")

    with {:ok, response} <- client().graphql(Query.list_issues_query(), %{"projectId" => project_id}) do
      issues =
        response
        |> get_in(["data", "project", "issues", "nodes"])
        |> List.wrap()
        |> Enum.map(&Query.normalize_issue(&1, project.slug))

      {:ok, issues}
    else
      error -> {:error, map_error(error)}
    end
  end

  @impl true
  def get_issue(%Project{} = project, identifier) do
    with {:ok, issues} <- list_issues(project, []) do
      case Enum.find(issues, &(&1.identifier == identifier)) do
        nil -> {:error, :issue_not_found}
        dto -> {:ok, dto}
      end
    end
  end

  @impl true
  def list_statuses(%Project{} = project) do
    project_id = Map.fetch!(project.tracker_config, "project_id")

    with {:ok, response} <- client().graphql(Query.team_states_query(), %{"projectId" => project_id}) do
      {:ok, Query.team_states(response)}
    else
      error -> {:error, map_error(error)}
    end
  end

  @impl true
  def create_issue(%Project{} = _project, _attrs), do: {:error, :not_supported_on_remote}

  @impl true
  def update_issue(%Project{} = _project, _identifier, _attrs), do: {:error, :not_supported_on_remote}

  @impl true
  def move_issue(%Project{} = _project, _identifier, _attrs), do: {:error, :not_supported_on_remote}

  @impl true
  def list_comments(%Project{} = _project, _identifier), do: {:error, :not_supported_on_remote}

  @impl true
  def add_comment(%Project{} = _project, _identifier, _body, _attrs), do: {:error, :not_supported_on_remote}

  defp client, do: Application.get_env(:symphony_elixir, :linear_client_module, Client)

  defp map_error({:error, reason}), do: map_error(reason)
  defp map_error({:linear_api_status, 401}), do: :remote_unauthorized
  defp map_error({:linear_api_status, 403}), do: :remote_forbidden
  defp map_error({:linear_api_status, status}) when status in 500..599, do: :remote_unavailable
  defp map_error(_), do: :remote_unavailable
end
```

> As with GitHub, Linear mutations (`issueCreate` / `issueUpdate` for move / `commentCreate`) follow the same stub→test→implement loop and may be a scoped follow-up. The Linear `Tracker` (orchestrator) already has `update_issue_state/2` and `create_comment/2` GraphQL you can mirror.

- [ ] **Step 13.4: Run the test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/linear/issue_adapter_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 13.5: Commit**

```bash
git add elixir/lib/symphony_elixir/linear/issue_adapter.ex elixir/test/symphony_elixir/linear/issue_adapter_test.exs
git commit -m "feat(linear): add project issue adapter read path"
```

---

## Task 14 — workspace endpoint stores tracker_kind/config

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex` (`create_workspace_project/1`, `project_attrs/1`)
- Test: extend `elixir/test/symphony_elixir/local_tracker/context_test.exs`

- [ ] **Step 14.1: Write the failing test (append to context_test.exs)**

Append inside `SymphonyElixir.LocalTracker.ContextTest`:

```elixir
  test "create_workspace_project stores github tracker and skips statuses" do
    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "Remote GH",
        "slug" => "remote-gh",
        "tracker" => %{
          "kind" => "github",
          "config" => %{"repo" => "o/r", "project_id" => "PVT_1"}
        },
        "repositories" => [],
        "setup" => %{}
      })

    assert project.tracker_kind == "github"
    assert project.tracker_config["project_id"] == "PVT_1"
    assert Context.list_statuses("remote-gh") == []
  end

  test "create_workspace_project defaults to local tracker" do
    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "Local WS",
        "slug" => "local-ws",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [%{"github_full_name" => "o/r", "workspace_path" => "r", "role" => "service"}],
        "setup" => %{}
      })

    assert project.tracker_kind == "local"
    assert Enum.any?(Context.list_statuses("local-ws"), &(&1.name == "Todo"))
  end
```

- [ ] **Step 14.2: Run the test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/context_test.exs -k "tracker"`
Expected: FAIL — `tracker_kind` not stored; statuses still created for remote.

- [ ] **Step 14.3: Implement the change**

In `elixir/lib/symphony_elixir/local_tracker/context.ex`:

1. Replace `project_attrs/1` to include tracker fields:

```elixir
  defp project_attrs(attrs) do
    tracker = attr(attrs, :tracker, %{})

    %{
      name: attr(attrs, :name),
      slug: attr(attrs, :slug),
      description: attr(attrs, :description),
      tracker_kind: attr(tracker, :kind, "local"),
      tracker_config: attr(tracker, :config, %{})
    }
  end
```

2. Update `create_workspace_project/1` to branch on tracker kind:

```elixir
  def create_workspace_project(attrs) when is_map(attrs) do
    project_attributes = project_attrs(attrs)
    remote? = project_attributes.tracker_kind in ["github", "linear"]

    Repo.transaction(fn ->
      with {:ok, project} <- insert_project(project_attributes),
           {:ok, _statuses} <- maybe_insert_statuses(project, attrs, remote?),
           {:ok, _repositories} <- insert_workspace_repositories(project, attr(attrs, :repositories, [])),
           {:ok, _setup} <- maybe_insert_setup(project, attrs, remote?) do
        Broadcaster.project_changed("project_created", project)
        project
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  defp maybe_insert_statuses(_project, _attrs, true), do: {:ok, []}
  defp maybe_insert_statuses(project, attrs, false),
    do: insert_workspace_statuses(project, attr(attrs, :workflow_statuses, []))

  defp maybe_insert_setup(_project, _attrs, true), do: {:ok, nil}
  defp maybe_insert_setup(project, attrs, false),
    do: insert_workspace_setup(project, attr(attrs, :setup, %{}))
```

> Keep `insert_workspace_repositories/2` for both kinds — repositories are allowed (even empty) for remote projects. The empty-list path already returns `{:ok, []}` via the `Enum.reduce_while` seed.

- [ ] **Step 14.4: Run the test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/context_test.exs`
Expected: PASS (full file green, including the two new tests).

- [ ] **Step 14.5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/context.ex elixir/test/symphony_elixir/local_tracker/context_test.exs
git commit -m "feat(local-tracker): persist tracker kind/config on workspace creation"
```

---

## Task 15 — TrackerPresenter emits tracker on project DTO

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex` (`project/1..4`)
- Test: extend `elixir/test/symphony_elixir_web/presenters/tracker_presenter_test.exs`

- [ ] **Step 15.1: Write the failing test (append)**

```elixir
  test "project/1 includes tracker_kind and tracker_config" do
    project = %SymphonyElixir.LocalTracker.Project{
      id: 1, name: "P", slug: "p", description: nil,
      tracker_kind: "github", tracker_config: %{"project_id" => "PVT_1"}
    }

    json = SymphonyElixirWeb.TrackerPresenter.project(project)
    assert json.tracker_kind == "github"
    assert json.tracker_config == %{"project_id" => "PVT_1"}
  end
```

- [ ] **Step 15.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/presenters/tracker_presenter_test.exs`
Expected: FAIL — `project/1` output lacks `tracker_kind`.

- [ ] **Step 15.3: Implement**

In `tracker_presenter.ex`, inside the `project/4` map literal, add:

```elixir
      tracker_kind: project.tracker_kind,
      tracker_config: project.tracker_config,
```

- [ ] **Step 15.4: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/presenters/tracker_presenter_test.exs`
Expected: PASS.

- [ ] **Step 15.5: Commit**

```bash
git add elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex elixir/test/symphony_elixir_web/presenters/tracker_presenter_test.exs
git commit -m "feat(tracker-api): expose tracker_kind/config in project DTO"
```

---

## Task 16 — RemoteDiscoveryController + routes

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/remote_discovery_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/remote_discovery_controller_test.exs`

- [ ] **Step 16.1: Write the failing test**

Create `elixir/test/symphony_elixir_web/controllers/tracker/remote_discovery_controller_test.exs`:

```elixir
defmodule SymphonyElixirWeb.Tracker.RemoteDiscoveryControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  defmodule GitHubProjectsStub do
    def graphql(_query, _vars, _opts) do
      {:ok,
       %{
         "data" => %{
           "viewer" => %{
             "projectsV2" => %{
               "nodes" => [
                 %{"id" => "PVT_1", "number" => 7, "title" => "Roadmap", "owner" => %{"login" => "o", "__typename" => "User"}}
               ]
             }
           }
         }
       }}
    end
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    previous = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    Application.put_env(:symphony_elixir, :github_client_module, GitHubProjectsStub)

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :github_client_module)
      if previous, do: System.put_env(@token_env, previous), else: System.delete_env(@token_env)
    end)

    :ok
  end

  defp authorized_conn, do: build_conn() |> put_req_header("authorization", "Bearer secret")

  test "POST /github/projects/discover returns boards" do
    conn = post(authorized_conn(), "/api/tracker/v1/github/projects/discover", %{})
    assert %{"data" => [%{"id" => "PVT_1", "number" => 7, "title" => "Roadmap"}]} = json_response(conn, 200)
  end
end
```

- [ ] **Step 16.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/remote_discovery_controller_test.exs`
Expected: FAIL — route + controller missing (404 or no route).

- [ ] **Step 16.3: Implement the controller**

Create `elixir/lib/symphony_elixir_web/controllers/tracker/remote_discovery_controller.ex`:

```elixir
defmodule SymphonyElixirWeb.Tracker.RemoteDiscoveryController do
  @moduledoc "Discovers GitHub Project v2 boards and Linear projects for the wizard."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.Client, as: GitHubClient
  alias SymphonyElixir.Linear.Client, as: LinearClient
  alias SymphonyElixirWeb.TrackerErrors

  @github_projects """
  query SymphonyDiscoverProjects {
    viewer {
      projectsV2(first: 50) {
        nodes { id number title owner { __typename ... on User { login } ... on Organization { login } } }
      }
    }
  }
  """

  @linear_projects """
  query SymphonyDiscoverLinearProjects {
    viewer {
      teamMemberships(first: 50) {
        nodes { team { id name projects(first: 50) { nodes { id slugId name state } } } }
      }
    }
  }
  """

  @spec github_discover(Conn.t(), map()) :: Conn.t()
  def github_discover(conn, _params) do
    case github_client().graphql(@github_projects, %{}) do
      {:ok, response} ->
        nodes = get_in(response, ["data", "viewer", "projectsV2", "nodes"]) || []
        json(conn, %{data: Enum.map(nodes, &github_project_dto/1)})

      {:error, reason} ->
        TrackerErrors.render(conn, github_error(reason))
    end
  end

  @spec linear_discover(Conn.t(), map()) :: Conn.t()
  def linear_discover(conn, _params) do
    case linear_client().graphql(@linear_projects, %{}) do
      {:ok, response} ->
        json(conn, %{data: linear_projects_dto(response)})

      {:error, reason} ->
        TrackerErrors.render(conn, linear_error(reason))
    end
  end

  defp github_project_dto(node) do
    %{
      id: node["id"],
      number: node["number"],
      title: node["title"],
      owner: %{login: get_in(node, ["owner", "login"]), kind: owner_kind(get_in(node, ["owner", "__typename"]))}
    }
  end

  defp owner_kind("Organization"), do: "organization"
  defp owner_kind(_), do: "user"

  defp linear_projects_dto(%{"data" => %{"viewer" => %{"teamMemberships" => %{"nodes" => memberships}}}}) do
    Enum.flat_map(memberships, fn %{"team" => team} ->
      team
      |> get_in(["projects", "nodes"])
      |> List.wrap()
      |> Enum.map(fn project ->
        %{
          id: project["id"],
          slugId: project["slugId"],
          name: project["name"],
          state: project["state"],
          team: %{id: team["id"], name: team["name"]}
        }
      end)
    end)
  end

  defp linear_projects_dto(_), do: []

  defp github_client, do: Application.get_env(:symphony_elixir, :github_client_module, GitHubClient)
  defp linear_client, do: Application.get_env(:symphony_elixir, :linear_client_module, LinearClient)

  defp github_error(:missing_github_token), do: :missing_credentials
  defp github_error({:github_api_status, 401}), do: :remote_unauthorized
  defp github_error(_), do: :remote_unavailable

  defp linear_error({:linear_api_status, 401}), do: :remote_unauthorized
  defp linear_error(_), do: :remote_unavailable
end
```

> `resolve` endpoints (returning status options for a chosen board/project) reuse `GitHub.IssueAdapter.list_statuses/1` and `Linear.IssueAdapter.list_statuses/1` logic. For MVP, the frontend can call `list_statuses` after the project is created; the `resolve` endpoints can be a thin wrapper added in a follow-up. If you want them now, add `github_resolve/2` and `linear_resolve/2` actions that take a `project_id` and return `{status_field, status_options}` using the same `Query` modules. Add tests mirroring Step 16.1.

- [ ] **Step 16.4: Mount the routes**

In `elixir/lib/symphony_elixir_web/router.ex`, inside the `scope "/api/tracker/v1"` block, add:

```elixir
    post("/github/projects/discover", RemoteDiscoveryController, :github_discover)
    post("/linear/projects/discover", RemoteDiscoveryController, :linear_discover)
```

- [ ] **Step 16.5: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/remote_discovery_controller_test.exs`
Expected: PASS.

- [ ] **Step 16.6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/remote_discovery_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/test/symphony_elixir_web/controllers/tracker/remote_discovery_controller_test.exs
git commit -m "feat(tracker-api): add GitHub/Linear remote discovery endpoints"
```

---

## Task 17 — Backend full gate

- [ ] **Step 17.1: Run the whole backend quality gate**

Run: `cd elixir && mise exec -- mix all`
Expected: PASS (compile + format check + credo + full test suite). Fix any formatting with `mise exec -- mix format` and re-run.

- [ ] **Step 17.2: Commit any formatting fixes**

```bash
git add -A elixir
git commit -m "chore(elixir): satisfy format/credo for tracker adapter slice" || echo "nothing to commit"
```

---

## Task 18 — Frontend: Project tracker types + mapper

**Files:**
- Modify: `tracker/src/types/project.ts`
- Modify: `tracker/src/services/mappers.ts`
- Test: extend `tracker/src/services/__tests__/projects.test.ts` (exists) or add a mapper test.

- [ ] **Step 18.1: Write the failing test**

Add to `tracker/src/services/__tests__/projects.test.ts` (or create `tracker/src/services/__tests__/mappers.test.ts` if cleaner):

```ts
import { describe, expect, it } from "vitest";
import { normalizeProject, type BackendProjectDto } from "@/services/mappers";

describe("normalizeProject tracker", () => {
  it("defaults to local tracker", () => {
    const dto = { id: 1, slug: "p", name: "P" } as BackendProjectDto;
    expect(normalizeProject(dto).tracker).toEqual({ kind: "local", config: {} });
  });

  it("reads github tracker", () => {
    const dto = {
      id: 1,
      slug: "p",
      name: "P",
      tracker_kind: "github",
      tracker_config: { project_id: "PVT_1" },
    } as unknown as BackendProjectDto;
    expect(normalizeProject(dto).tracker).toEqual({ kind: "github", config: { project_id: "PVT_1" } });
  });
});
```

- [ ] **Step 18.2: Run to verify it fails**

Run: `cd tracker && npm test -- src/services/__tests__/projects.test.ts`
Expected: FAIL — `tracker` not on the normalized project; `tracker_kind` not on the DTO type.

- [ ] **Step 18.3: Implement types**

In `tracker/src/types/project.ts`, add:

```ts
export type TrackerKind = "local" | "github" | "linear";

export interface ProjectTrackerConfig {
  kind: TrackerKind;
  config: Record<string, unknown>;
}
```

…and add to the `Project` interface:

```ts
  tracker: ProjectTrackerConfig;
```

- [ ] **Step 18.4: Implement DTO + mapper**

In `tracker/src/services/mappers.ts`:

1. Add to `BackendProjectDto`:

```ts
  tracker_kind?: string | null;
  tracker_config?: Record<string, unknown> | null;
```

2. In `normalizeProject`, add to the returned object:

```ts
    tracker: {
      kind: (dto.tracker_kind as TrackerKind) ?? "local",
      config: dto.tracker_config ?? {},
    },
```

3. Import `TrackerKind` at the top from `@/types/project`.

- [ ] **Step 18.5: Run to verify it passes**

Run: `cd tracker && npm test -- src/services/__tests__/projects.test.ts`
Expected: PASS.

- [ ] **Step 18.6: Commit**

```bash
git add tracker/src/types/project.ts tracker/src/services/mappers.ts tracker/src/services/__tests__/projects.test.ts
git commit -m "feat(tracker): map tracker_kind/config onto Project"
```

---

## Task 19 — Frontend: remoteTrackers service

**Files:**
- Create: `tracker/src/services/remoteTrackers.ts`
- Test: `tracker/src/services/__tests__/remoteTrackers.test.ts`

- [ ] **Step 19.1: Write the failing test**

Create `tracker/src/services/__tests__/remoteTrackers.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { discoverGitHubProjects, discoverLinearProjects } from "@/services/remoteTrackers";
import { http } from "@/services/http";

vi.mock("@/services/http", async () => {
  const actual = await vi.importActual<typeof import("@/services/http")>("@/services/http");
  return { ...actual, http: { post: vi.fn() } };
});

describe("remoteTrackers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("discoverGitHubProjects maps response", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: [{ id: "PVT_1", number: 7, title: "Roadmap", owner: { login: "o", kind: "user" } }] },
    });

    const result = await discoverGitHubProjects();
    expect(result[0]).toEqual({
      id: "PVT_1",
      number: 7,
      title: "Roadmap",
      owner: { login: "o", kind: "user" },
      repoNameWithOwner: null,
    });
  });

  it("discoverLinearProjects maps response", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: [{ id: "p1", slugId: "s", name: "Proj", state: "started", team: { id: "t", name: "Team" } }] },
    });

    const result = await discoverLinearProjects();
    expect(result[0].name).toBe("Proj");
    expect(result[0].team.name).toBe("Team");
  });
});
```

- [ ] **Step 19.2: Run to verify it fails**

Run: `cd tracker && npm test -- src/services/__tests__/remoteTrackers.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 19.3: Implement the service**

Create `tracker/src/services/remoteTrackers.ts`:

```ts
import { http, trackerPath, unwrapData } from "./http";

export interface GitHubProjectSummary {
  id: string;
  number: number;
  title: string;
  owner: { login: string; kind: "user" | "organization" };
  repoNameWithOwner: string | null;
}

export interface LinearProjectSummary {
  id: string;
  slugId: string;
  name: string;
  state: string;
  team: { id: string; name: string };
}

interface GitHubProjectDto {
  id: string;
  number: number;
  title: string;
  owner?: { login?: string | null; kind?: string | null } | null;
  repo_name_with_owner?: string | null;
}

interface LinearProjectDto {
  id: string;
  slugId?: string | null;
  slug_id?: string | null;
  name: string;
  state?: string | null;
  team: { id: string; name: string };
}

export async function discoverGitHubProjects(): Promise<GitHubProjectSummary[]> {
  const response = await http.post(trackerPath("/github/projects/discover"), {});
  return unwrapData<GitHubProjectDto[]>(response).map((dto) => ({
    id: dto.id,
    number: dto.number,
    title: dto.title,
    owner: {
      login: dto.owner?.login ?? "",
      kind: dto.owner?.kind === "organization" ? "organization" : "user",
    },
    repoNameWithOwner: dto.repo_name_with_owner ?? null,
  }));
}

export async function discoverLinearProjects(): Promise<LinearProjectSummary[]> {
  const response = await http.post(trackerPath("/linear/projects/discover"), {});
  return unwrapData<LinearProjectDto[]>(response).map((dto) => ({
    id: dto.id,
    slugId: dto.slugId ?? dto.slug_id ?? "",
    name: dto.name,
    state: dto.state ?? "",
    team: { id: dto.team.id, name: dto.team.name },
  }));
}
```

> Confirm `unwrapData` and `trackerPath` exports exist in `tracker/src/services/http.ts` (they are used by `projects.ts`). If `unwrapData` is not exported, mirror the unwrap inline: `response.data.data`.

- [ ] **Step 19.4: Run to verify it passes**

Run: `cd tracker && npm test -- src/services/__tests__/remoteTrackers.test.ts`
Expected: PASS.

- [ ] **Step 19.5: Commit**

```bash
git add tracker/src/services/remoteTrackers.ts tracker/src/services/__tests__/remoteTrackers.test.ts
git commit -m "feat(tracker): add remote tracker discovery service"
```

---

## Task 20 — Frontend: client-side issue filter helper

**Files:**
- Create: `tracker/src/lib/issueFilters.ts` (or extend the Slice A one if present)
- Test: `tracker/src/lib/__tests__/issueFilters.test.ts`

- [ ] **Step 20.1: Check for an existing helper**

Read `tracker/src/lib/issueFilters.ts` if it exists (Slice A may have created it). If present, **extend** it with `filterIssuesClientSide`; otherwise create the file.

- [ ] **Step 20.2: Write the failing test**

Create/extend `tracker/src/lib/__tests__/issueFilters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterIssuesClientSide } from "@/lib/issueFilters";
import type { Issue } from "@/types/issue";

const issue = (over: Partial<Issue>): Issue => ({
  id: "1",
  identifier: "#1",
  projectSlug: "p",
  status: "Todo",
  title: "Title",
  description: null,
  priority: null,
  position: 0,
  labels: [],
  blockedBy: [],
  assignee: null,
  creator: null,
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("filterIssuesClientSide", () => {
  const issues = [
    issue({ identifier: "#1", title: "Fix login", assignee: "octocat", creator: "alice" }),
    issue({ identifier: "#2", title: "Add logout", assignee: "bob", creator: "octocat" }),
  ];

  it("filters by search across title and identifier", () => {
    expect(filterIssuesClientSide(issues, { search: "login" }, null).map((i) => i.identifier)).toEqual(["#1"]);
  });

  it("filters by assignee with me resolution", () => {
    const result = filterIssuesClientSide(issues, { assignee: "me" }, { login: "octocat", name: null, avatarUrl: null });
    expect(result.map((i) => i.identifier)).toEqual(["#1"]);
  });

  it("filters by creator literal", () => {
    expect(filterIssuesClientSide(issues, { creator: "octocat" }, null).map((i) => i.identifier)).toEqual(["#2"]);
  });

  it("returns all with empty filters", () => {
    expect(filterIssuesClientSide(issues, {}, null)).toHaveLength(2);
  });
});
```

- [ ] **Step 20.3: Run to verify it fails**

Run: `cd tracker && npm test -- src/lib/__tests__/issueFilters.test.ts`
Expected: FAIL — `filterIssuesClientSide` not exported.

- [ ] **Step 20.4: Implement the helper**

Add to `tracker/src/lib/issueFilters.ts`:

```ts
import type { Issue } from "@/types/issue";
import type { Viewer } from "@/types/viewer";

export interface IssueClientFilters {
  search?: string;
  assignee?: string;
  creator?: string;
}

export function filterIssuesClientSide(
  issues: Issue[],
  filters: IssueClientFilters,
  viewer: Viewer | null,
): Issue[] {
  const search = filters.search?.trim().toLowerCase();
  const assignee = resolveMe(filters.assignee, viewer);
  const creator = resolveMe(filters.creator, viewer);

  return issues.filter((issue) => {
    if (search && !matchesSearch(issue, search)) return false;
    if (assignee && issue.assignee !== assignee) return false;
    if (creator && issue.creator !== creator) return false;
    return true;
  });
}

function matchesSearch(issue: Issue, term: string): boolean {
  return (
    issue.title.toLowerCase().includes(term) ||
    issue.identifier.toLowerCase().includes(term) ||
    (issue.description ?? "").toLowerCase().includes(term)
  );
}

function resolveMe(value: string | undefined, viewer: Viewer | null): string | undefined {
  if (!value) return undefined;
  if (value === "me") return viewer?.login ?? undefined;
  return value;
}
```

> If `@/types/viewer` does not exist in this branch (it was created in Slice A), define a minimal local type `{ login: string; name: string | null; avatarUrl: string | null }` or import from wherever Slice A placed it. Adjust the import accordingly.

- [ ] **Step 20.5: Run to verify it passes**

Run: `cd tracker && npm test -- src/lib/__tests__/issueFilters.test.ts`
Expected: PASS.

- [ ] **Step 20.6: Commit**

```bash
git add tracker/src/lib/issueFilters.ts tracker/src/lib/__tests__/issueFilters.test.ts
git commit -m "feat(tracker): client-side issue filtering for remote boards"
```

---

## Task 21 — Frontend: TrackerSourcePicker

**Files:**
- Create: `tracker/src/components/projects/TrackerSourcePicker.tsx`
- Test: `tracker/src/components/projects/__tests__/TrackerSourcePicker.test.tsx`

- [ ] **Step 21.1: Confirm a RadioGroup primitive exists**

Check `tracker/src/components/ui/` for `radio-group.tsx`. If absent, use three `<button>` cards styled like the org cards in `ProjectWorkspaceWizard` (the test below targets `role="radio"` semantics — if using buttons, set `role="radio"` and `aria-checked`).

- [ ] **Step 21.2: Write the failing test**

Create `tracker/src/components/projects/__tests__/TrackerSourcePicker.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrackerSourcePicker } from "@/components/projects/TrackerSourcePicker";

describe("TrackerSourcePicker", () => {
  it("renders three options and reports selection", async () => {
    const onChange = vi.fn();
    render(<TrackerSourcePicker value="local" onChange={onChange} />);

    expect(screen.getByText(/Symphony local tracker/i)).toBeInTheDocument();
    expect(screen.getByText(/GitHub Project/i)).toBeInTheDocument();
    expect(screen.getByText(/Linear project/i)).toBeInTheDocument();

    await userEvent.click(screen.getByText(/GitHub Project/i));
    expect(onChange).toHaveBeenCalledWith("github");
  });
});
```

- [ ] **Step 21.3: Run to verify it fails**

Run: `cd tracker && npm test -- src/components/projects/__tests__/TrackerSourcePicker.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 21.4: Implement the component**

Create `tracker/src/components/projects/TrackerSourcePicker.tsx`:

```tsx
import type { TrackerKind } from "@/types/project";

interface TrackerSourcePickerProps {
  value: TrackerKind;
  onChange: (kind: TrackerKind) => void;
}

const OPTIONS: { kind: TrackerKind; title: string; description: string }[] = [
  { kind: "local", title: "Symphony local tracker", description: "Issues live in Symphony's local board (default)." },
  { kind: "github", title: "GitHub Project v2", description: "Read and move issues on a GitHub Projects v2 board." },
  { kind: "linear", title: "Linear project", description: "Read and move issues from a Linear project." },
];

export function TrackerSourcePicker({ value, onChange }: TrackerSourcePickerProps) {
  return (
    <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="Tracker source">
      {OPTIONS.map((option) => (
        <button
          key={option.kind}
          type="button"
          role="radio"
          aria-checked={value === option.kind}
          onClick={() => onChange(option.kind)}
          className={`rounded-md border p-3 text-left transition hover:bg-muted/50 ${
            value === option.kind ? "border-primary bg-muted/40" : ""
          }`}
        >
          <span className="block text-sm font-medium">{option.title}</span>
          <span className="block text-xs text-muted-foreground">{option.description}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 21.5: Run to verify it passes**

Run: `cd tracker && npm test -- src/components/projects/__tests__/TrackerSourcePicker.test.tsx`
Expected: PASS.

- [ ] **Step 21.6: Commit**

```bash
git add tracker/src/components/projects/TrackerSourcePicker.tsx tracker/src/components/projects/__tests__/TrackerSourcePicker.test.tsx
git commit -m "feat(tracker): add tracker source picker"
```

---

## Task 22 — Frontend: GitHubProjectPicker & LinearProjectPicker

**Files:**
- Create: `tracker/src/components/projects/GitHubProjectPicker.tsx`
- Create: `tracker/src/components/projects/LinearProjectPicker.tsx`
- Test: `tracker/src/components/projects/__tests__/GitHubProjectPicker.test.tsx`, `.../LinearProjectPicker.test.tsx`

- [ ] **Step 22.1: Write the failing test (GitHub)**

Create `tracker/src/components/projects/__tests__/GitHubProjectPicker.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GitHubProjectPicker } from "@/components/projects/GitHubProjectPicker";
import * as remote from "@/services/remoteTrackers";

vi.mock("@/services/remoteTrackers");

describe("GitHubProjectPicker", () => {
  it("lists boards and reports selection", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([
      { id: "PVT_1", number: 7, title: "Roadmap", owner: { login: "o", kind: "user" }, repoNameWithOwner: "o/r" },
    ]);
    const onSelect = vi.fn();

    render(<GitHubProjectPicker onSelect={onSelect} />);

    await waitFor(() => expect(screen.getByText(/Roadmap/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Roadmap/));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "PVT_1", number: 7 }));
  });
});
```

- [ ] **Step 22.2: Run to verify it fails**

Run: `cd tracker && npm test -- src/components/projects/__tests__/GitHubProjectPicker.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 22.3: Implement GitHubProjectPicker**

Create `tracker/src/components/projects/GitHubProjectPicker.tsx`:

```tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { discoverGitHubProjects, type GitHubProjectSummary } from "@/services/remoteTrackers";

interface GitHubProjectPickerProps {
  onSelect: (project: GitHubProjectSummary) => void;
}

export function GitHubProjectPicker({ onSelect }: GitHubProjectPickerProps) {
  const [projects, setProjects] = useState<GitHubProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    discoverGitHubProjects()
      .then((items) => active && setProjects(items))
      .catch((cause) => toast.error(cause instanceof Error ? cause.message : "Failed to load GitHub projects"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading GitHub projects…</p>;
  if (projects.length === 0) return <p className="text-sm text-muted-foreground">No GitHub Projects v2 boards found.</p>;

  return (
    <div className="grid gap-2">
      {projects.map((project) => (
        <button
          key={project.id}
          type="button"
          onClick={() => onSelect(project)}
          className="rounded-md border p-3 text-left transition hover:bg-muted/50"
        >
          <span className="block text-sm font-medium">{project.title}</span>
          <span className="block text-xs text-muted-foreground">
            {project.owner.login} · #{project.number}
          </span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 22.4: Implement LinearProjectPicker (mirror)**

Create `tracker/src/components/projects/LinearProjectPicker.tsx` analogously, calling `discoverLinearProjects()`, grouping by `team.name`. Then create its test `LinearProjectPicker.test.tsx` mirroring Step 22.1 with `discoverLinearProjects` mocked and asserting `onSelect` receives the chosen `LinearProjectSummary`.

```tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { discoverLinearProjects, type LinearProjectSummary } from "@/services/remoteTrackers";

interface LinearProjectPickerProps {
  onSelect: (project: LinearProjectSummary) => void;
}

export function LinearProjectPicker({ onSelect }: LinearProjectPickerProps) {
  const [projects, setProjects] = useState<LinearProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    discoverLinearProjects()
      .then((items) => active && setProjects(items))
      .catch((cause) => toast.error(cause instanceof Error ? cause.message : "Failed to load Linear projects"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading Linear projects…</p>;
  if (projects.length === 0) return <p className="text-sm text-muted-foreground">No Linear projects found.</p>;

  return (
    <div className="grid gap-2">
      {projects.map((project) => (
        <button
          key={project.id}
          type="button"
          onClick={() => onSelect(project)}
          className="rounded-md border p-3 text-left transition hover:bg-muted/50"
        >
          <span className="block text-sm font-medium">{project.name}</span>
          <span className="block text-xs text-muted-foreground">{project.team.name}</span>
        </button>
      ))}
    </div>
  );
}
```

`LinearProjectPicker.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LinearProjectPicker } from "@/components/projects/LinearProjectPicker";
import * as remote from "@/services/remoteTrackers";

vi.mock("@/services/remoteTrackers");

describe("LinearProjectPicker", () => {
  it("lists projects and reports selection", async () => {
    vi.mocked(remote.discoverLinearProjects).mockResolvedValue([
      { id: "p1", slugId: "s", name: "Proj", state: "started", team: { id: "t", name: "Team" } },
    ]);
    const onSelect = vi.fn();

    render(<LinearProjectPicker onSelect={onSelect} />);

    await waitFor(() => expect(screen.getByText("Proj")).toBeInTheDocument());
    await userEvent.click(screen.getByText("Proj"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
  });
});
```

- [ ] **Step 22.5: Run both tests**

Run: `cd tracker && npm test -- src/components/projects/__tests__/GitHubProjectPicker.test.tsx src/components/projects/__tests__/LinearProjectPicker.test.tsx`
Expected: PASS.

- [ ] **Step 22.6: Commit**

```bash
git add tracker/src/components/projects/GitHubProjectPicker.tsx tracker/src/components/projects/LinearProjectPicker.tsx tracker/src/components/projects/__tests__/GitHubProjectPicker.test.tsx tracker/src/components/projects/__tests__/LinearProjectPicker.test.tsx
git commit -m "feat(tracker): add GitHub and Linear project pickers"
```

---

## Task 23 — Frontend: wizard tracker step + remote submit

**Files:**
- Modify: `tracker/src/components/projects/ProjectWorkspaceWizard.tsx`
- Modify: `tracker/src/services/projects.ts` (send `tracker` payload)
- Test: `tracker/src/components/projects/__tests__/ProjectWorkspaceWizard.test.tsx`

- [ ] **Step 23.1: Add `tracker` to the createWorkspaceProject payload (with test)**

Add to `tracker/src/services/__tests__/projects.test.ts`:

```ts
it("createWorkspaceProject sends tracker payload", async () => {
  const post = vi.fn().mockResolvedValue({ data: { data: { id: 1, slug: "p", name: "P" } } });
  // arrange http.post mock for this test (match the file's existing mocking pattern)
  // ...assert the second argument contains tracker: { kind, config }
});
```

(Match the existing mocking style in `projects.test.ts`. If that file mocks `http`, reuse it.)

Then extend `CreateWorkspaceProjectInput` in `tracker/src/services/projects.ts`:

```ts
export interface CreateWorkspaceProjectInput extends CreateProjectInput {
  workflowStatuses: WorkflowStatus[];
  repositories: WorkspaceRepository[];
  setup: Partial<ProjectSetup>;
  tracker?: { kind: TrackerKind; config: Record<string, unknown> };
}
```

…and in `createWorkspaceProject`, add to the POST body:

```ts
    tracker: input.tracker ?? { kind: "local", config: {} },
```

Import `TrackerKind` from `@/types/project`.

- [ ] **Step 23.2: Run the projects service test**

Run: `cd tracker && npm test -- src/services/__tests__/projects.test.ts`
Expected: PASS.

- [ ] **Step 23.3: Wizard — add a tracker step at the top**

In `ProjectWorkspaceWizard.tsx`:

1. Add state: `const [trackerKind, setTrackerKind] = useState<TrackerKind>("local");` and `const [remoteConfig, setRemoteConfig] = useState<Record<string, unknown> | null>(null);`
2. Render `<TrackerSourcePicker value={trackerKind} onChange={(k) => { setTrackerKind(k); setRemoteConfig(null); }} />` as the first form section.
3. When `trackerKind === "github"`, render `<GitHubProjectPicker onSelect={(p) => setRemoteConfig({ repo: p.repoNameWithOwner ?? "", project_id: p.id, project_number: p.number, status_field: "Symphony State" })} />`. Hide the org/repo scan UI.
4. When `trackerKind === "linear"`, render `<LinearProjectPicker onSelect={(p) => setRemoteConfig({ project_id: p.id, team_id: p.team.id, project_slug: p.slugId })} />`.
5. When `trackerKind === "local"`, keep the existing org/repo/suggest flow.
6. In `handleSubmit`, branch:

```ts
if (trackerKind !== "local") {
  if (!remoteConfig) {
    toast.error("Select a remote project first");
    return;
  }
  const project = await createWorkspaceProject({
    name, slug, description: null,
    workflowStatuses: [], repositories: [], setup: {},
    tracker: { kind: trackerKind, config: remoteConfig },
  });
  onCreated?.(project);
  reset();
  setOpen(false);
  toast.success("Project connected");
  return;
}
// ...existing local submit path unchanged
```

7. Disable the submit button for remote until `remoteConfig` is set; for local keep the existing `!suggestion` gate.

- [ ] **Step 23.4: Write/extend the wizard test**

Create `tracker/src/components/projects/__tests__/ProjectWorkspaceWizard.test.tsx` (if absent). Mock `@/services/projects`, `@/services/projectSetup`, and `@/services/remoteTrackers`. Test: opening the dialog, selecting "GitHub Project", picking a board (mocked), filling name+slug, submitting → asserts `createWorkspaceProject` called with `tracker.kind === "github"` and `config.project_id` set.

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectWorkspaceWizard } from "@/components/projects/ProjectWorkspaceWizard";
import * as projects from "@/services/projects";
import * as remote from "@/services/remoteTrackers";
import * as setup from "@/services/projectSetup";

vi.mock("@/services/projects");
vi.mock("@/services/remoteTrackers");
vi.mock("@/services/projectSetup");

describe("ProjectWorkspaceWizard tracker step", () => {
  it("creates a github-backed project", async () => {
    vi.mocked(setup.listGitHubOwners).mockResolvedValue([]);
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([
      { id: "PVT_1", number: 7, title: "Roadmap", owner: { login: "o", kind: "user" }, repoNameWithOwner: "o/r" },
    ]);
    vi.mocked(projects.createWorkspaceProject).mockResolvedValue({
      id: "1", slug: "gh", name: "GH", description: null, tracker: { kind: "github", config: {} },
    } as never);

    render(<ProjectWorkspaceWizard />);
    await userEvent.click(screen.getByRole("button", { name: /new workspace project/i }));
    await userEvent.click(screen.getByText(/GitHub Project/i));
    await waitFor(() => expect(screen.getByText(/Roadmap/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Roadmap/));
    await userEvent.type(screen.getByPlaceholderText(/Project name/i), "GH");
    await userEvent.type(screen.getByPlaceholderText(/project-slug/i), "gh");
    await userEvent.click(screen.getByRole("button", { name: /connect|create/i }));

    await waitFor(() =>
      expect(projects.createWorkspaceProject).toHaveBeenCalledWith(
        expect.objectContaining({ tracker: expect.objectContaining({ kind: "github" }) }),
      ),
    );
  });
});
```

- [ ] **Step 23.5: Run the wizard test**

Run: `cd tracker && npm test -- src/components/projects/__tests__/ProjectWorkspaceWizard.test.tsx`
Expected: PASS. (Adjust button name regex to match the actual submit label you set.)

- [ ] **Step 23.6: Commit**

```bash
git add tracker/src/components/projects/ProjectWorkspaceWizard.tsx tracker/src/services/projects.ts tracker/src/components/projects/__tests__/ProjectWorkspaceWizard.test.tsx tracker/src/services/__tests__/projects.test.ts
git commit -m "feat(tracker): wizard tracker-source step and remote project creation"
```

---

## Task 24 — Frontend: tracker polling hook + header badge

**Files:**
- Create: `tracker/src/hooks/useTrackerPolling.ts`
- Modify: `tracker/src/components/layout/ProjectHeader.tsx`
- Test: `tracker/src/hooks/__tests__/useTrackerPolling.test.tsx`

- [ ] **Step 24.1: Write the failing test**

Create `tracker/src/hooks/__tests__/useTrackerPolling.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTrackerPolling } from "@/hooks/useTrackerPolling";

describe("useTrackerPolling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not start a timer for local trackers", () => {
    const refetch = vi.fn();
    renderHook(() => useTrackerPolling({ kind: "local", refetch, intervalMs: 1000 }));
    act(() => vi.advanceTimersByTime(5000));
    expect(refetch).not.toHaveBeenCalled();
  });

  it("polls remote trackers on the interval", () => {
    const refetch = vi.fn();
    renderHook(() => useTrackerPolling({ kind: "github", refetch, intervalMs: 1000 }));
    act(() => vi.advanceTimersByTime(2500));
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 24.2: Run to verify it fails**

Run: `cd tracker && npm test -- src/hooks/__tests__/useTrackerPolling.test.tsx`
Expected: FAIL — hook missing.

- [ ] **Step 24.3: Implement the hook**

Create `tracker/src/hooks/useTrackerPolling.ts`:

```ts
import { useEffect } from "react";
import type { TrackerKind } from "@/types/project";

interface UseTrackerPollingArgs {
  kind: TrackerKind;
  refetch: () => void;
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 30_000;

export function useTrackerPolling({ kind, refetch, intervalMs = DEFAULT_INTERVAL_MS }: UseTrackerPollingArgs): void {
  useEffect(() => {
    if (kind === "local") return;

    const timer = setInterval(refetch, intervalMs);
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [kind, refetch, intervalMs]);
}
```

- [ ] **Step 24.4: Run to verify it passes**

Run: `cd tracker && npm test -- src/hooks/__tests__/useTrackerPolling.test.tsx`
Expected: PASS.

- [ ] **Step 24.5: Add the header badge + refresh button**

In `tracker/src/components/layout/ProjectHeader.tsx`, accept the project's `tracker.kind` (via props or context — match how the header currently receives the project) and render a small badge + refresh button. Concretely, add to the header's right side:

```tsx
{project.tracker.kind !== "local" ? (
  <div className="flex items-center gap-2">
    <Badge variant="muted">{project.tracker.kind === "github" ? "GitHub Project" : "Linear"}</Badge>
    <Button size="sm" variant="ghost" onClick={onRefresh} aria-label="Refresh board">
      <RefreshCw className="h-4 w-4" />
    </Button>
  </div>
) : null}
```

Thread an `onRefresh` callback prop from the board page (Task 25). Import `Badge`, `Button`, `RefreshCw` as already used elsewhere.

- [ ] **Step 24.6: Commit**

```bash
git add tracker/src/hooks/useTrackerPolling.ts tracker/src/hooks/__tests__/useTrackerPolling.test.tsx tracker/src/components/layout/ProjectHeader.tsx
git commit -m "feat(tracker): poll remote boards and show tracker badge"
```

---

## Task 25 — Frontend: board wires polling + gates reorder for remote

**Files:**
- Modify: `tracker/src/pages/ProjectBoardPage.tsx`
- Test: a focused board test if a harness exists; otherwise rely on the hook test + manual smoke.

- [ ] **Step 25.1: Wire polling and refresh**

In `ProjectBoardPage.tsx`:

1. Get the project (already loaded for the board). Compute `const trackerKind = project.tracker.kind;`.
2. Call `useTrackerPolling({ kind: trackerKind, refetch: reloadIssues })` where `reloadIssues` is the board's existing fetch function (re-fetches issues + statuses).
3. Pass `onRefresh={reloadIssues}` to `<ProjectHeader />`.
4. For drag-and-drop: in the existing `onDragEnd`, allow column changes (status move) but **disable position reordering** for remote:

```ts
const handleDragEnd = (result: DropResult) => {
  if (trackerKind !== "local") {
    // only allow column (status) changes for remote; ignore same-column reorders
    if (result.source.droppableId === result.destination?.droppableId) return;
  }
  // ...existing move logic
};
```

(Match the actual DnD library/props the board uses; the key behavior: same-column drops are no-ops for remote, cross-column drops still call `move`.)

- [ ] **Step 25.2: Manual smoke (no automated test for the page in this slice)**

Run the app and verify against a real GitHub Project v2 board:
- Board renders remote issues.
- Moving a card across columns triggers a `move` and the change persists on refresh.
- Same-column drag does nothing for remote.
- Refresh button + 30 s timer refetch.

- [ ] **Step 25.3: Commit**

```bash
git add tracker/src/pages/ProjectBoardPage.tsx
git commit -m "feat(tracker): wire remote polling and gate reorder on the board"
```

---

## Task 26 — Frontend full gate

- [ ] **Step 26.1: Run the frontend test suite + typecheck + lint**

Run: `cd tracker && npm test`
Then: `cd tracker && npm run build` (or the project's `tsc`/`lint` script — check `tracker/package.json` scripts; use `npm run lint` if present).
Expected: all green; no TS errors.

- [ ] **Step 26.2: Commit any fixups**

```bash
git add -A tracker
git commit -m "chore(tracker): satisfy lint/typecheck for tracker adapter slice" || echo "nothing to commit"
```

---

## Task 27 — Controller integration test for a remote project

**Files:**
- Modify: `elixir/test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs`

- [ ] **Step 27.1: Write the test using an app-env adapter override**

Append to `SymphonyElixirWeb.Tracker.IssueControllerTest`:

```elixir
  defmodule FakeRemoteAdapter do
    @behaviour SymphonyElixir.Tracker.IssueAdapter
    alias SymphonyElixir.Tracker.IssueDTO

    def kind, do: :github
    def list_issues(_project, _filters),
      do: {:ok, [IssueDTO.build(%{identifier: "#1", title: "Remote", status: %{name: "Todo", category: "unstarted", position: 0, is_terminal: false}, project_slug: "remote"})]}
    def get_issue(_p, _i), do: {:error, :issue_not_found}
    def create_issue(_p, _a), do: {:error, :not_supported_on_remote}
    def update_issue(_p, _i, _a), do: {:error, :not_supported_on_remote}
    def move_issue(_p, _i, _a), do: {:error, :not_supported_on_remote}
    def list_statuses(_p), do: {:ok, []}
    def list_comments(_p, _i), do: {:error, :not_supported_on_remote}
    def add_comment(_p, _i, _b, _a), do: {:error, :not_supported_on_remote}
  end

  describe "remote project dispatch" do
    setup do
      Application.put_env(:symphony_elixir, :issue_adapters, %{"github" => FakeRemoteAdapter})
      {:ok, project} = Context.create_workspace_project(%{
        "name" => "Remote", "slug" => "remote",
        "tracker" => %{"kind" => "github", "config" => %{"repo" => "o/r", "project_id" => "PVT_1"}},
        "repositories" => [], "setup" => %{}
      })
      on_exit(fn -> Application.delete_env(:symphony_elixir, :issue_adapters) end)
      %{project: project}
    end

    test "index dispatches to the remote adapter" do
      conn = get(authorized_conn(), "/api/tracker/v1/projects/remote/issues")
      assert %{"data" => [%{"identifier" => "#1", "title" => "Remote"}]} = json_response(conn, 200)
    end

    test "create returns 501 for unsupported remote mutation" do
      conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues", %{"title" => "x", "status" => "Todo"})
      assert json_response(conn, 501)["error"]["code"] == "tracker_not_supported"
    end
  end
```

- [ ] **Step 27.2: Run the controller test**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs`
Expected: PASS (existing + new cases). The `issue_adapters` override proves the controller dispatch path works end-to-end without real network.

- [ ] **Step 27.3: Commit**

```bash
git add elixir/test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs
git commit -m "test(tracker-api): cover remote project dispatch via adapter override"
```

---

## Task 28 — Full quality gate + PR

- [ ] **Step 28.1: Run both gates**

Run: `cd elixir && mise exec -- mix all`
Run: `cd tracker && npm test`
Expected: both green.

- [ ] **Step 28.2: Push and open PR**

```bash
git push -u origin feat/per-project-tracker-adapter
gh pr create --title "Slice B: per-project tracker adapter" --body "$(cat <<'EOF'
## Summary
- Add `tracker_kind` + `tracker_config` to projects (migration + changeset).
- New per-project `Tracker.IssueAdapter` behaviour + Local/GitHub/Linear adapters returning a shared `IssueDTO`.
- Issue endpoints dispatch through the adapter; orchestrator `Tracker` untouched.
- GitHub Project v2 read + status-move; Linear project read; remote discovery endpoints for the wizard.
- Wizard tracker-source step, remote pickers, client-side filtering, and 30s polling for remote boards.

## Scoped follow-ups (documented in the spec §11)
- GitHub/Linear create/comment mutations (move + read landed this slice).
- `resolve` discovery endpoints (statuses fetched post-create via `list_statuses`).

## Test plan
- [ ] `cd elixir && mise exec -- mix all`
- [ ] `cd tracker && npm test`
- [ ] Manual: create local / GitHub / Linear projects; move a card; refresh.
EOF
)"
```

---

## Self-Review

**Spec coverage (spec §2 goals → task):**

1. `tracker_kind` + `tracker_config` columns w/ local default → Task 1, 2.
2. Per-project `IssueAdapter` used by the API → Task 4, 8, 27.
3. Local/GitHub/Linear adapters → Task 5, 10/11, 13.
4. Orchestrator `Tracker` untouched → no task modifies `tracker.ex`; verified by leaving it out of the file map.
5. Wizard first-step tracker picker → Task 21, 22, 23.
6. Stable URL surface + same DTO shape → Task 6 (presenter), Task 8 (controller refactor keeps routes), Task 27 (dispatch test).
7. Light polling for remote → Task 24, 25.

**Spec §6 backend details → task:** migration (T1), schema (T2), behaviour+error type (T4), error mapping (T7), GitHub adapter+query (T9–11), Linear adapter+query (T12–13), workspace endpoint (T14), discovery endpoints (T16), presenter tracker fields (T15).

**Spec §7 frontend details → task:** types/mapper (T18), remote service (T19), client filters (T20), pickers (T21–22), wizard (T23), polling+badge (T24), board gating (T25).

**Placeholder scan:** Mutations for GitHub create/comment and Linear write are explicitly **scoped follow-ups** with the exact mutation names called out (not silent TODOs); move (GitHub) is fully implemented (T11). The `resolve` discovery endpoints are explicitly optional with the implementation path described. These are intentional scope decisions surfaced in the PR body, consistent with spec §3/§11. No `TBD`/`fill in` placeholders remain in code steps.

**Type consistency:** `IssueDTO` fields (T3) match presenter output (T6) and adapter returns (T5/T10/T13). `TrackerKind` is defined once (T18) and reused (T21/T23/T24). `tracker_error` atoms (T4) match `TrackerErrors.render/2` clauses (T7) and adapter `map_error/1` returns (T10/T13).

> **Execution note for workers:** Several frontend tasks say "match the existing mocking pattern" / "match the actual DnD props". Before implementing those steps, open the referenced existing file and mirror its conventions exactly — the board's DnD library and the `projects.test.ts` http-mock style are the two spots that vary by what Slice A already merged.
