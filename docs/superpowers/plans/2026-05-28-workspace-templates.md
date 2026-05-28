# Workspace Templates Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Tooling: Elixir backend uses `mix` (run via `mise exec --` if configured). Quality gate is `cd elixir && mise exec -- mix all`. Frontend uses `npm` from `tracker/`; tests via `cd tracker && npm test`.

**Goal:** Deliver Slice C of the MVP: a first-class **Workspace Template** entity (DB + YAML import/export) capturing repos, hooks, validation commands, prompt template, and workflow statuses; a "Save as template" flow from an existing project; a "Start from a template" tab in the wizard; and asynchronous per-repo clone jobs that report progress over the existing project realtime channel.

**Architecture:** New Ecto schemas `WorkspaceTemplate`, `WorkspaceTemplateRepository`, and `CloneJob`, owned by a new `LocalTracker.Templates` context (kept separate from `LocalTracker.Context`). A `CloneSupervisor` (`DynamicSupervisor`) spawns one `CloneWorker` GenServer per repo that shells out to `git clone` and broadcasts `clone_*` events over the existing `project:<slug>` PubSub topic (reusing `TrackerChannel`, not a new channel). YAML import/export uses `YamlElixir`. The frontend gains a templates service, a wizard template tab, template list/edit pages, a save-as-template dialog, and a clone-progress hook subscribing to the existing socket.

**Tech Stack:** Elixir 1.19 / OTP 28, Phoenix 1.7, Ecto + `ecto_sqlite3`, `yaml_elixir`, ExUnit. React 18 + TypeScript + Vite, react-router-dom v6, shadcn primitives, sonner, Vitest + Testing Library, axios, Phoenix JS socket.

**Spec:** `docs/superpowers/specs/2026-05-28-workspace-templates-design.md`

**Depends on:** Slice B (per-project tracker adapter) for the `tracker` payload on project creation. If Slice B is not merged, Task 9 (tracker-aware instantiation) degrades to always `local` — note that in the PR.

**Refinement of spec:** The spec proposed a dedicated `templates:<slug>` channel. This plan instead **reuses the existing `project:<slug>` channel** (`TrackerChannel` + `Broadcaster`) with new event names (`clone_started`, `clone_succeeded`, `clone_failed`, `clone_skipped`). Rationale: `UserSocket` only registers `project:*` and `terminal:*`; reusing it avoids new socket plumbing and the frontend already subscribes to `project:<slug>` on the board.

---

## Branch Setup

- [ ] **Step 0: Create a feature branch from main**

```bash
cd /home/raphaelcangucu/symphony
git status
git checkout -b feat/workspace-templates
```

Expected: branch exists, tree clean.

- [ ] **Step 0.1: Confirm `yaml_elixir` is a dependency**

Read `elixir/mix.exs`. If `:yaml_elixir` is not in `deps/0`, add `{:yaml_elixir, "~> 2.9"}` and run `cd elixir && mise exec -- mix deps.get`. Commit `mix.exs`/`mix.lock` as a separate prep commit:

```bash
git add elixir/mix.exs elixir/mix.lock
git commit -m "build(elixir): add yaml_elixir for workspace template import/export" || echo "already present"
```

---

## File Structure (Backend)

| Action | Path | Owns |
|---|---|---|
| Create | `elixir/priv/repo/migrations/20260528170000_create_workspace_templates.exs` | 3 tables |
| Create | `elixir/lib/symphony_elixir/local_tracker/workspace_template.ex` | Template schema + changeset |
| Create | `elixir/lib/symphony_elixir/local_tracker/workspace_template_repository.ex` | Template repo schema |
| Create | `elixir/lib/symphony_elixir/local_tracker/clone_job.ex` | CloneJob schema |
| Create | `elixir/lib/symphony_elixir/local_tracker/templates.ex` | Context: CRUD, save-as, instantiate, YAML |
| Create | `elixir/lib/symphony_elixir/local_tracker/template_yaml.ex` | YAML <-> attrs |
| Create | `elixir/lib/symphony_elixir/local_tracker/template_substitution.ex` | `{{slug}}` etc. |
| Create | `elixir/lib/symphony_elixir/local_tracker/clone_supervisor.ex` | DynamicSupervisor |
| Create | `elixir/lib/symphony_elixir/local_tracker/clone_worker.ex` | GenServer per repo |
| Create | `elixir/lib/symphony_elixir/local_tracker/git.ex` | `clone/3` behaviour + System.cmd impl |
| Modify | `elixir/lib/symphony_elixir.ex` | Add `CloneSupervisor` to supervision tree |
| Modify | `elixir/lib/symphony_elixir/local_tracker/broadcaster.ex` | `clone_event/3` |
| Create | `elixir/lib/symphony_elixir_web/presenters/template_presenter.ex` | Template + clone_job DTOs |
| Create | `elixir/lib/symphony_elixir_web/controllers/tracker/template_controller.ex` | CRUD + import/export + instantiate + save-as |
| Create | `elixir/lib/symphony_elixir_web/controllers/tracker/clone_job_controller.ex` | list + retry |
| Modify | `elixir/lib/symphony_elixir_web/router.ex` | Mount routes |
| Create | `elixir/priv/templates/single-repo-elixir.yml` | Built-in template |
| Create | `elixir/priv/templates/multi-repo-fullstack.yml` | Built-in template |
| Modify | `elixir/lib/symphony_elixir.ex` | Import built-ins on boot (idempotent) |
| Create | `elixir/test/symphony_elixir/local_tracker/workspace_template_test.exs` | schema |
| Create | `elixir/test/symphony_elixir/local_tracker/templates_test.exs` | context |
| Create | `elixir/test/symphony_elixir/local_tracker/template_yaml_test.exs` | YAML round-trip |
| Create | `elixir/test/symphony_elixir/local_tracker/template_substitution_test.exs` | substitution |
| Create | `elixir/test/symphony_elixir/local_tracker/clone_worker_test.exs` | worker w/ stubbed git |
| Create | `elixir/test/symphony_elixir_web/controllers/tracker/template_controller_test.exs` | endpoints |

## File Structure (Frontend)

| Action | Path | Owns |
|---|---|---|
| Create | `tracker/src/types/template.ts` | `WorkspaceTemplate`, `CloneJob` types |
| Create | `tracker/src/services/templates.ts` | CRUD + import/export + instantiate + save-as + clone jobs |
| Create | `tracker/src/services/__tests__/templates.test.ts` | |
| Create | `tracker/src/hooks/useCloneProgress.ts` | subscribe to `project:<slug>` clone events |
| Create | `tracker/src/hooks/__tests__/useCloneProgress.test.tsx` | |
| Create | `tracker/src/components/templates/TemplateList.tsx` | |
| Create | `tracker/src/components/templates/TemplateForm.tsx` | |
| Create | `tracker/src/components/templates/SaveAsTemplateDialog.tsx` | |
| Create | `tracker/src/components/templates/CloneProgressBar.tsx` | |
| Create | `tracker/src/components/templates/__tests__/CloneProgressBar.test.tsx` | |
| Create | `tracker/src/components/templates/__tests__/SaveAsTemplateDialog.test.tsx` | |
| Create | `tracker/src/pages/TemplateListPage.tsx` | `/templates` |
| Create | `tracker/src/pages/TemplateEditPage.tsx` | `/templates/:slug` |
| Modify | `tracker/src/App.tsx` (or router file) | Mount template routes |
| Modify | `tracker/src/components/layout/ProjectSidebar.tsx` | "Templates" link |
| Modify | `tracker/src/components/projects/ProjectWorkspaceWizard.tsx` | "Start from a template" tab |

---

## Task 1 — Migration: template + clone tables

**Files:**
- Create: `elixir/priv/repo/migrations/20260528170000_create_workspace_templates.exs`
- Test: `elixir/test/symphony_elixir/local_tracker/migrations_test.exs` (extend)

- [ ] **Step 1.1: Write the migration**

Create `elixir/priv/repo/migrations/20260528170000_create_workspace_templates.exs`:

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateWorkspaceTemplates do
  use Ecto.Migration

  def change do
    create table(:local_tracker_workspace_templates) do
      add :name, :string, null: false
      add :slug, :string, null: false
      add :description, :string
      add :workflow_statuses, :map, null: false, default: %{}
      add :validation_commands, :map, null: false, default: %{}
      add :after_create_hook, :text
      add :before_run_hook, :text
      add :after_run_hook, :text
      add :before_remove_hook, :text
      add :prompt_template, :text
      add :dev_env_markdown, :text
      add :metadata, :map, null: false, default: %{}
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:local_tracker_workspace_templates, [:slug])

    create table(:local_tracker_workspace_template_repositories) do
      add :template_id,
          references(:local_tracker_workspace_templates, on_delete: :delete_all),
          null: false

      add :github_full_name, :string, null: false
      add :clone_url, :string, null: false
      add :default_branch, :string
      add :workspace_path, :string, null: false
      add :role, :string
      timestamps(type: :utc_datetime_usec)
    end

    create index(:local_tracker_workspace_template_repositories, [:template_id])

    create table(:local_tracker_clone_jobs) do
      add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
      add :repository_id, references(:local_tracker_repositories, on_delete: :delete_all), null: false
      add :status, :string, null: false, default: "pending"
      add :error, :text
      add :started_at, :utc_datetime_usec
      add :completed_at, :utc_datetime_usec
      add :commit_sha, :string
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:local_tracker_clone_jobs, [:project_id, :repository_id])
  end
end
```

> Note: `workflow_statuses` and `validation_commands` are stored as `:map`. We will wrap lists as `%{"items" => [...]}` to keep SQLite JSON-as-map happy (the schema casts to/from this shape). See Task 2.

- [ ] **Step 1.2: Add a migration assertion (append to migrations_test.exs)**

```elixir
  test "workspace template tables exist" do
    migrate_repo()

    for table <- [
          "local_tracker_workspace_templates",
          "local_tracker_workspace_template_repositories",
          "local_tracker_clone_jobs"
        ] do
      assert %{rows: _} = Repo.query!("SELECT 1 FROM #{table} LIMIT 1")
    end
  end
```

- [ ] **Step 1.3: Run the migration test**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/migrations_test.exs`
Expected: PASS.

- [ ] **Step 1.4: Commit**

```bash
git add elixir/priv/repo/migrations/20260528170000_create_workspace_templates.exs elixir/test/symphony_elixir/local_tracker/migrations_test.exs
git commit -m "feat(local-tracker): create workspace template and clone job tables"
```

---

## Task 2 — WorkspaceTemplate + repository schemas

**Files:**
- Create: `elixir/lib/symphony_elixir/local_tracker/workspace_template.ex`
- Create: `elixir/lib/symphony_elixir/local_tracker/workspace_template_repository.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/workspace_template_test.exs`

- [ ] **Step 2.1: Write the failing test**

Create `elixir/test/symphony_elixir/local_tracker/workspace_template_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.WorkspaceTemplateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.WorkspaceTemplate

  test "valid changeset requires name and slug" do
    changeset = WorkspaceTemplate.changeset(%WorkspaceTemplate{}, %{})
    refute changeset.valid?
    assert %{name: _, slug: _} = errors_on(changeset)
  end

  test "accepts list fields and wraps them for storage" do
    changeset =
      WorkspaceTemplate.changeset(%WorkspaceTemplate{}, %{
        name: "Gamba",
        slug: "gamba",
        workflow_statuses: [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        validation_commands: ["mix test"]
      })

    assert changeset.valid?
    assert Ecto.Changeset.get_field(changeset, :validation_commands) == %{"items" => ["mix test"]}
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, _} -> msg end)
  end
end
```

- [ ] **Step 2.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/workspace_template_test.exs`
Expected: FAIL — schema missing.

- [ ] **Step 2.3: Implement the repository schema**

Create `elixir/lib/symphony_elixir/local_tracker/workspace_template_repository.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.WorkspaceTemplateRepository do
  @moduledoc "A repository entry inside a workspace template."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.WorkspaceTemplate

  @type t :: %__MODULE__{}

  schema "local_tracker_workspace_template_repositories" do
    field(:github_full_name, :string)
    field(:clone_url, :string)
    field(:default_branch, :string)
    field(:workspace_path, :string)
    field(:role, :string)

    belongs_to(:template, WorkspaceTemplate)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(repository, attrs) do
    repository
    |> cast(attrs, [:github_full_name, :clone_url, :default_branch, :workspace_path, :role, :template_id])
    |> validate_required([:github_full_name, :clone_url, :workspace_path])
  end
end
```

- [ ] **Step 2.4: Implement the template schema**

Create `elixir/lib/symphony_elixir/local_tracker/workspace_template.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.WorkspaceTemplate do
  @moduledoc "Reusable multi-repo workspace blueprint."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.WorkspaceTemplateRepository

  @type t :: %__MODULE__{}

  schema "local_tracker_workspace_templates" do
    field(:name, :string)
    field(:slug, :string)
    field(:description, :string)
    field(:workflow_statuses, :map, default: %{})
    field(:validation_commands, :map, default: %{})
    field(:after_create_hook, :string)
    field(:before_run_hook, :string)
    field(:after_run_hook, :string)
    field(:before_remove_hook, :string)
    field(:prompt_template, :string)
    field(:dev_env_markdown, :string)
    field(:metadata, :map, default: %{})

    has_many(:repositories, WorkspaceTemplateRepository,
      foreign_key: :template_id,
      on_delete: :delete_all
    )

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(template, attrs) do
    template
    |> cast(attrs, [
      :name,
      :slug,
      :description,
      :after_create_hook,
      :before_run_hook,
      :after_run_hook,
      :before_remove_hook,
      :prompt_template,
      :dev_env_markdown,
      :metadata
    ])
    |> cast_list(attrs, :workflow_statuses)
    |> cast_list(attrs, :validation_commands)
    |> validate_required([:name, :slug])
    |> unique_constraint(:slug)
  end

  @spec workflow_statuses_list(t()) :: [map()]
  def workflow_statuses_list(%__MODULE__{workflow_statuses: %{"items" => items}}) when is_list(items), do: items
  def workflow_statuses_list(_), do: []

  @spec validation_commands_list(t()) :: [String.t()]
  def validation_commands_list(%__MODULE__{validation_commands: %{"items" => items}}) when is_list(items), do: items
  def validation_commands_list(_), do: []

  defp cast_list(changeset, attrs, field) do
    raw = Map.get(attrs, field) || Map.get(attrs, Atom.to_string(field))

    case raw do
      list when is_list(list) -> put_change(changeset, field, %{"items" => list})
      %{"items" => _} = wrapped -> put_change(changeset, field, wrapped)
      _ -> changeset
    end
  end
end
```

- [ ] **Step 2.5: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/workspace_template_test.exs`
Expected: PASS.

- [ ] **Step 2.6: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/workspace_template.ex elixir/lib/symphony_elixir/local_tracker/workspace_template_repository.ex elixir/test/symphony_elixir/local_tracker/workspace_template_test.exs
git commit -m "feat(local-tracker): add workspace template schemas"
```

---

## Task 3 — CloneJob schema

**Files:**
- Create: `elixir/lib/symphony_elixir/local_tracker/clone_job.ex`
- Test: covered in `templates_test.exs` (Task 5) + `clone_worker_test.exs` (Task 8). Add a tiny changeset test here.

- [ ] **Step 3.1: Write the failing test**

Create `elixir/test/symphony_elixir/local_tracker/clone_job_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.CloneJobTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.CloneJob

  test "changeset validates status inclusion" do
    valid = CloneJob.changeset(%CloneJob{}, %{project_id: 1, repository_id: 1, status: "pending"})
    assert valid.valid?

    invalid = CloneJob.changeset(%CloneJob{}, %{project_id: 1, repository_id: 1, status: "bogus"})
    refute invalid.valid?
  end
end
```

- [ ] **Step 3.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/clone_job_test.exs`
Expected: FAIL — schema missing.

- [ ] **Step 3.3: Implement the schema**

Create `elixir/lib/symphony_elixir/local_tracker/clone_job.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.CloneJob do
  @moduledoc "Per-repository clone job tracked for a project instantiated from a template."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.{Project, Repository}

  @type t :: %__MODULE__{}
  @statuses ~w(pending running succeeded failed skipped)

  schema "local_tracker_clone_jobs" do
    field(:status, :string, default: "pending")
    field(:error, :string)
    field(:started_at, :utc_datetime_usec)
    field(:completed_at, :utc_datetime_usec)
    field(:commit_sha, :string)

    belongs_to(:project, Project)
    belongs_to(:repository, Repository)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(job, attrs) do
    job
    |> cast(attrs, [:project_id, :repository_id, :status, :error, :started_at, :completed_at, :commit_sha])
    |> validate_required([:project_id, :repository_id, :status])
    |> validate_inclusion(:status, @statuses)
    |> unique_constraint([:project_id, :repository_id])
  end

  @spec statuses() :: [String.t()]
  def statuses, do: @statuses
end
```

- [ ] **Step 3.4: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/clone_job_test.exs`
Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/clone_job.ex elixir/test/symphony_elixir/local_tracker/clone_job_test.exs
git commit -m "feat(local-tracker): add clone job schema"
```

---

## Task 4 — Template substitution helper

**Files:**
- Create: `elixir/lib/symphony_elixir/local_tracker/template_substitution.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/template_substitution_test.exs`

- [ ] **Step 4.1: Write the failing test**

Create `elixir/test/symphony_elixir/local_tracker/template_substitution_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.TemplateSubstitutionTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.TemplateSubstitution

  @vars %{slug: "gamba", name: "Gamba", workspace_root: "/root"}

  test "substitutes known tokens" do
    assert TemplateSubstitution.apply("{{workspace_root}}/{{slug}}/api", @vars) == "/root/gamba/api"
  end

  test "tolerates whitespace inside braces" do
    assert TemplateSubstitution.apply("{{ slug }}-x", @vars) == "gamba-x"
  end

  test "leaves unknown tokens literal" do
    assert TemplateSubstitution.apply("{{date}}", @vars) == "{{date}}"
  end

  test "nil input returns nil" do
    assert TemplateSubstitution.apply(nil, @vars) == nil
  end
end
```

- [ ] **Step 4.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/template_substitution_test.exs`
Expected: FAIL — module missing.

- [ ] **Step 4.3: Implement**

Create `elixir/lib/symphony_elixir/local_tracker/template_substitution.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.TemplateSubstitution do
  @moduledoc "Replaces {{slug}} / {{name}} / {{workspace_root}} tokens in template strings."

  @token ~r/\{\{\s*(slug|name|workspace_root)\s*\}\}/

  @spec apply(String.t() | nil, map()) :: String.t() | nil
  def apply(nil, _vars), do: nil

  def apply(value, vars) when is_binary(value) and is_map(vars) do
    Regex.replace(@token, value, fn _full, token ->
      vars |> Map.get(String.to_existing_atom(token)) |> to_string()
    end)
  end
end
```

- [ ] **Step 4.4: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/template_substitution_test.exs`
Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/template_substitution.ex elixir/test/symphony_elixir/local_tracker/template_substitution_test.exs
git commit -m "feat(local-tracker): add template token substitution"
```

---

## Task 5 — Templates context: CRUD + save-as

**Files:**
- Create: `elixir/lib/symphony_elixir/local_tracker/templates.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/templates_test.exs`

- [ ] **Step 5.1: Write the failing test (CRUD + save-as)**

Create `elixir/test/symphony_elixir/local_tracker/templates_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.TemplatesTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, Templates, WorkspaceTemplate}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    :ok
  end

  test "create_template + get_template" do
    assert {:ok, template} =
             Templates.create_template(%{
               "name" => "Gamba",
               "slug" => "gamba",
               "validation_commands" => ["mix test"],
               "repositories" => [
                 %{"github_full_name" => "g/api", "clone_url" => "https://github.com/g/api.git", "workspace_path" => "api", "role" => "backend"}
               ]
             })

    assert {:ok, fetched} = Templates.get_template("gamba")
    assert fetched.id == template.id
    assert WorkspaceTemplate.validation_commands_list(fetched) == ["mix test"]
    assert [%{github_full_name: "g/api"}] = fetched.repositories
  end

  test "list_templates orders newest first" do
    {:ok, _a} = Templates.create_template(%{"name" => "A", "slug" => "a"})
    {:ok, _b} = Templates.create_template(%{"name" => "B", "slug" => "b"})
    assert ["b", "a"] = Templates.list_templates() |> Enum.map(& &1.slug)
  end

  test "save_project_as_template captures repos and parameterizes slug" do
    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Src",
        "slug" => "src",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [%{"github_full_name" => "g/api", "workspace_path" => "src/api", "role" => "backend", "clone_url" => "https://github.com/g/api.git"}],
        "setup" => %{"after_create_hook" => "cd /root/src/api && echo hi"}
      })

    assert {:ok, template} = Templates.save_project_as_template("src", %{slug: "src-tpl"})
    assert template.slug == "src-tpl"
    assert template.metadata["source"] == "saved_from_project"
    assert [%{workspace_path: "src/api"}] = template.repositories
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_clone_jobs",
          "local_tracker_workspace_template_repositories",
          "local_tracker_workspace_templates",
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_issue_labels",
          "local_tracker_labels",
          "local_tracker_comments",
          "local_tracker_issues",
          "local_tracker_workflow_statuses",
          "local_tracker_repositories",
          "local_tracker_project_setups",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end
end
```

> Confirm the exact table names for `repositories` / `project_setups` by reading the existing migrations if the deletes error (`local_tracker_repositories`, `local_tracker_project_setups` are expected based on the schemas; adjust if a migration named them differently).

- [ ] **Step 5.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/templates_test.exs`
Expected: FAIL — `Templates` undefined.

- [ ] **Step 5.3: Implement the context (CRUD + save-as)**

Create `elixir/lib/symphony_elixir/local_tracker/templates.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.Templates do
  @moduledoc "Persistence + operations for workspace templates."

  import Ecto.Query

  alias SymphonyElixir.LocalTracker.{
    Context,
    Repository,
    WorkspaceTemplate,
    WorkspaceTemplateRepository
  }

  alias SymphonyElixir.Repo

  @type error :: :template_not_found | :project_not_found | Ecto.Changeset.t()

  @spec list_templates() :: [WorkspaceTemplate.t()]
  def list_templates do
    WorkspaceTemplate
    |> order_by([t], desc: t.inserted_at, desc: t.id)
    |> preload(:repositories)
    |> Repo.all()
  end

  @spec get_template(String.t()) :: {:ok, WorkspaceTemplate.t()} | {:error, :template_not_found}
  def get_template(slug) when is_binary(slug) do
    case Repo.get_by(WorkspaceTemplate, slug: slug) do
      nil -> {:error, :template_not_found}
      template -> {:ok, Repo.preload(template, :repositories)}
    end
  end

  @spec create_template(map()) :: {:ok, WorkspaceTemplate.t()} | {:error, Ecto.Changeset.t()}
  def create_template(attrs) when is_map(attrs) do
    repositories = attr(attrs, :repositories, [])

    Repo.transaction(fn ->
      with {:ok, template} <- insert_template(attrs),
           {:ok, _repos} <- insert_template_repositories(template, repositories) do
        Repo.preload(template, :repositories, force: true)
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  @spec update_template(String.t(), map()) :: {:ok, WorkspaceTemplate.t()} | {:error, error()}
  def update_template(slug, attrs) do
    with {:ok, template} <- get_template(slug) do
      Repo.transaction(fn ->
        with {:ok, updated} <- template |> WorkspaceTemplate.changeset(attrs) |> Repo.update(),
             :ok <- replace_repositories(updated, attr(attrs, :repositories, nil)) do
          Repo.preload(updated, :repositories, force: true)
        else
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    end
  end

  @spec delete_template(String.t()) :: {:ok, WorkspaceTemplate.t()} | {:error, :template_not_found}
  def delete_template(slug) do
    with {:ok, template} <- get_template(slug) do
      Repo.delete(template)
    end
  end

  @spec save_project_as_template(String.t(), map()) ::
          {:ok, WorkspaceTemplate.t()} | {:error, error()}
  def save_project_as_template(project_slug, overrides) when is_map(overrides) do
    with {:ok, project} <- Context.get_project(project_slug) do
      repositories = Context.list_repositories(project_slug)
      setup = Context.get_project_setup(project_slug)
      statuses = Context.list_statuses(project_slug)

      attrs = %{
        "name" => attr(overrides, :name, "#{project.name} (template)"),
        "slug" => attr(overrides, :slug, "#{project.slug}-template"),
        "description" => attr(overrides, :description, project.description),
        "workflow_statuses" => Enum.map(statuses, &status_to_attrs/1),
        "validation_commands" => validation_commands(setup),
        "after_create_hook" => parameterize(setup && setup.after_create_hook, project),
        "prompt_template" => setup && setup.prompt_template,
        "dev_env_markdown" => attr(overrides, :dev_env_markdown, nil),
        "metadata" => %{"source" => "saved_from_project", "source_project_slug" => project_slug},
        "repositories" => Enum.map(repositories, &repo_to_template_attrs(&1, project))
      }

      create_template(attrs)
    end
  end

  defp insert_template(attrs) do
    %WorkspaceTemplate{}
    |> WorkspaceTemplate.changeset(attrs)
    |> Repo.insert()
  end

  defp insert_template_repositories(_template, []), do: {:ok, []}

  defp insert_template_repositories(template, repositories) do
    repositories
    |> Enum.reduce_while({:ok, []}, fn repo_attrs, {:ok, acc} ->
      attrs = repo_attrs |> stringify() |> Map.put("template_id", template.id)

      %WorkspaceTemplateRepository{}
      |> WorkspaceTemplateRepository.changeset(attrs)
      |> Repo.insert()
      |> case do
        {:ok, repo} -> {:cont, {:ok, [repo | acc]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp replace_repositories(_template, nil), do: :ok

  defp replace_repositories(template, repositories) do
    Repo.delete_all(from(r in WorkspaceTemplateRepository, where: r.template_id == ^template.id))

    case insert_template_repositories(template, repositories) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp status_to_attrs(status) do
    %{"name" => status.name, "category" => status.category, "position" => status.position, "is_terminal" => status.is_terminal}
  end

  defp validation_commands(nil), do: []

  defp validation_commands(setup) do
    Map.get(setup.validation_commands || %{}, "commands", [])
  end

  defp repo_to_template_attrs(%Repository{} = repo, project) do
    %{
      "github_full_name" => repo.github_full_name,
      "clone_url" => repo.clone_url || "https://github.com/#{repo.github_full_name}.git",
      "default_branch" => repo.default_branch,
      "workspace_path" => parameterize(repo.workspace_path, project),
      "role" => repo.role
    }
  end

  defp parameterize(nil, _project), do: nil

  defp parameterize(value, project) when is_binary(value) do
    String.replace(value, project.slug, "{{slug}}")
  end

  defp stringify(map) do
    Map.new(map, fn {k, v} -> {to_string(k), v} end)
  end

  defp attr(attrs, key, default \\ nil) do
    Map.get(attrs, key, Map.get(attrs, to_string(key), default))
  end
end
```

- [ ] **Step 5.4: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/templates_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5.5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/templates.ex elixir/test/symphony_elixir/local_tracker/templates_test.exs
git commit -m "feat(local-tracker): templates context with CRUD and save-as"
```

---

## Task 6 — Template YAML import/export

**Files:**
- Create: `elixir/lib/symphony_elixir/local_tracker/template_yaml.ex`
- Modify: `elixir/lib/symphony_elixir/local_tracker/templates.ex` (`import_yaml/1`, `export_yaml/1`)
- Test: `elixir/test/symphony_elixir/local_tracker/template_yaml_test.exs`

- [ ] **Step 6.1: Write the failing test (round-trip)**

Create `elixir/test/symphony_elixir/local_tracker/template_yaml_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.TemplateYamlTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Templates
  alias SymphonyElixir.Repo

  setup do
    {:ok, _repo, _apps} = Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
    Repo.query!("delete from local_tracker_workspace_template_repositories")
    Repo.query!("delete from local_tracker_workspace_templates")
    :ok
  end

  @yaml """
  slug: gamba
  name: Gamba
  description: Multi-repo
  validation_commands:
    - mix test
  after_create_hook: |
    echo hi
  repositories:
    - github_full_name: g/api
      clone_url: https://github.com/g/api.git
      default_branch: main
      workspace_path: api
      role: backend
  metadata:
    source: imported
  """

  test "import_yaml creates a template" do
    assert {:ok, template} = Templates.import_yaml(@yaml)
    assert template.slug == "gamba"
    assert [%{github_full_name: "g/api"}] = template.repositories
  end

  test "export_yaml round-trips" do
    {:ok, _} = Templates.import_yaml(@yaml)
    assert {:ok, exported} = Templates.export_yaml("gamba")

    Repo.query!("delete from local_tracker_workspace_template_repositories")
    Repo.query!("delete from local_tracker_workspace_templates")

    assert {:ok, reimported} = Templates.import_yaml(exported)
    assert reimported.slug == "gamba"
    assert [%{workspace_path: "api"}] = reimported.repositories
  end

  test "invalid yaml returns error" do
    assert {:error, :invalid_yaml} = Templates.import_yaml(":\n  - broken: [")
  end
end
```

- [ ] **Step 6.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/template_yaml_test.exs`
Expected: FAIL — `import_yaml/1` undefined.

- [ ] **Step 6.3: Implement TemplateYaml**

Create `elixir/lib/symphony_elixir/local_tracker/template_yaml.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.TemplateYaml do
  @moduledoc "Converts workspace templates to/from YAML."

  alias SymphonyElixir.LocalTracker.WorkspaceTemplate

  @spec decode(binary()) :: {:ok, map()} | {:error, :invalid_yaml}
  def decode(yaml) when is_binary(yaml) do
    case YamlElixir.read_from_string(yaml) do
      {:ok, %{} = map} -> {:ok, normalize(map)}
      _ -> {:error, :invalid_yaml}
    end
  rescue
    _ -> {:error, :invalid_yaml}
  end

  @spec encode(WorkspaceTemplate.t()) :: binary()
  def encode(%WorkspaceTemplate{} = template) do
    %{
      "slug" => template.slug,
      "name" => template.name,
      "description" => template.description,
      "validation_commands" => WorkspaceTemplate.validation_commands_list(template),
      "workflow_statuses" => WorkspaceTemplate.workflow_statuses_list(template),
      "after_create_hook" => template.after_create_hook,
      "prompt_template" => template.prompt_template,
      "dev_env_markdown" => template.dev_env_markdown,
      "metadata" => template.metadata || %{},
      "repositories" =>
        Enum.map(template.repositories, fn repo ->
          %{
            "github_full_name" => repo.github_full_name,
            "clone_url" => repo.clone_url,
            "default_branch" => repo.default_branch,
            "workspace_path" => repo.workspace_path,
            "role" => repo.role
          }
        end)
    }
    |> reject_nil()
    |> to_yaml()
  end

  defp normalize(map) do
    map
    |> Map.take([
      "slug",
      "name",
      "description",
      "validation_commands",
      "workflow_statuses",
      "after_create_hook",
      "before_run_hook",
      "after_run_hook",
      "before_remove_hook",
      "prompt_template",
      "dev_env_markdown",
      "metadata",
      "repositories"
    ])
  end

  defp reject_nil(map), do: Map.reject(map, fn {_k, v} -> is_nil(v) end)

  # Minimal YAML emitter: we only need a stable, re-parseable document.
  defp to_yaml(map), do: encode_value(map, 0)

  defp encode_value(map, indent) when is_map(map) do
    map
    |> Enum.map_join("\n", fn {k, v} -> "#{pad(indent)}#{k}:#{encode_inline_or_block(v, indent)}" end)
  end

  defp encode_value(list, indent) when is_list(list) do
    Enum.map_join(list, "\n", fn item ->
      "#{pad(indent)}- #{String.trim_leading(encode_value(item, indent + 1))}"
    end)
  end

  defp encode_value(value, _indent), do: scalar(value)

  defp encode_inline_or_block(value, indent) when is_map(value) or is_list(value) do
    "\n" <> encode_value(value, indent + 1)
  end

  defp encode_inline_or_block(value, _indent), do: " " <> scalar(value)

  defp scalar(value) when is_binary(value) do
    if String.contains?(value, "\n") do
      "|\n" <> (value |> String.split("\n") |> Enum.map_join("\n", &("  " <> &1)))
    else
      ~s("#{String.replace(value, "\"", "\\\"")}")
    end
  end

  defp scalar(value) when is_boolean(value), do: to_string(value)
  defp scalar(value) when is_number(value), do: to_string(value)
  defp scalar(nil), do: "null"
  defp scalar(value), do: ~s("#{to_string(value)}")

  defp pad(indent), do: String.duplicate("  ", indent)
end
```

> **Simplicity note:** `YamlElixir` reads YAML but does not emit it. The minimal emitter above produces a re-parseable document for the round-trip test. If a richer emitter is preferred, add `{:ymlr, "~> 5.0"}` to deps and replace `to_yaml/1` with `Ymlr.document!/1`. Pick one approach; the test in Step 6.1 is the contract.

- [ ] **Step 6.4: Implement import/export in Templates**

Append to `elixir/lib/symphony_elixir/local_tracker/templates.ex`:

```elixir
  alias SymphonyElixir.LocalTracker.TemplateYaml

  @spec import_yaml(binary()) :: {:ok, WorkspaceTemplate.t()} | {:error, :invalid_yaml | Ecto.Changeset.t()}
  def import_yaml(yaml) when is_binary(yaml) do
    with {:ok, attrs} <- TemplateYaml.decode(yaml) do
      create_template(attrs)
    end
  end

  @spec export_yaml(String.t()) :: {:ok, binary()} | {:error, :template_not_found}
  def export_yaml(slug) do
    with {:ok, template} <- get_template(slug) do
      {:ok, TemplateYaml.encode(template)}
    end
  end
```

- [ ] **Step 6.5: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/template_yaml_test.exs`
Expected: PASS (3 tests). If the round-trip fails on formatting, prefer the `Ymlr` dependency path from the note.

- [ ] **Step 6.6: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/template_yaml.ex elixir/lib/symphony_elixir/local_tracker/templates.ex elixir/test/symphony_elixir/local_tracker/template_yaml_test.exs
git commit -m "feat(local-tracker): template YAML import/export"
```

---

## Task 7 — Git wrapper + CloneWorker + CloneSupervisor

**Files:**
- Create: `elixir/lib/symphony_elixir/local_tracker/git.ex`
- Create: `elixir/lib/symphony_elixir/local_tracker/clone_worker.ex`
- Create: `elixir/lib/symphony_elixir/local_tracker/clone_supervisor.ex`
- Modify: `elixir/lib/symphony_elixir.ex` (supervision tree)
- Modify: `elixir/lib/symphony_elixir/local_tracker/broadcaster.ex` (`clone_event/3`)
- Test: `elixir/test/symphony_elixir/local_tracker/clone_worker_test.exs`

- [ ] **Step 7.1: Write the failing test (worker with stubbed git)**

Create `elixir/test/symphony_elixir/local_tracker/clone_worker_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.CloneWorkerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{CloneJob, CloneWorker, Context}
  alias SymphonyElixir.Repo

  defmodule OkGit do
    def clone(_url, _dest, _opts), do: {:ok, "abc123"}
  end

  defmodule FailGit do
    def clone(_url, _dest, _opts), do: {:error, "authentication required"}
  end

  defmodule SkipGit do
    def clone(_url, _dest, _opts), do: {:ok, :already_cloned}
  end

  setup do
    {:ok, _repo, _apps} = Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)

    for table <- ["local_tracker_clone_jobs", "local_tracker_repositories", "local_tracker_projects"] do
      Repo.query!("delete from #{table}")
    end

    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "P",
        "slug" => "p",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [%{"github_full_name" => "g/api", "workspace_path" => "api", "role" => "backend", "clone_url" => "https://github.com/g/api.git"}],
        "setup" => %{}
      })

    [repo] = Context.list_repositories("p")
    {:ok, job} = Repo.insert(CloneJob.changeset(%CloneJob{}, %{project_id: project.id, repository_id: repo.id, status: "pending"}))

    %{job: job}
  end

  test "marks job succeeded with commit sha", %{job: job} do
    assert {:ok, %CloneJob{status: "succeeded", commit_sha: "abc123"}} =
             CloneWorker.run_sync(job.id, git: OkGit)
  end

  test "marks job failed with error", %{job: job} do
    assert {:ok, %CloneJob{status: "failed", error: "authentication required"}} =
             CloneWorker.run_sync(job.id, git: FailGit)
  end

  test "marks job skipped when already cloned", %{job: job} do
    assert {:ok, %CloneJob{status: "skipped"}} = CloneWorker.run_sync(job.id, git: SkipGit)
  end
end
```

> The worker exposes `run_sync/2` (the GenServer's body, callable synchronously) for deterministic testing. The async `start_link/1` calls `run_sync` then stops.

- [ ] **Step 7.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/clone_worker_test.exs`
Expected: FAIL — `CloneWorker` / `Git` undefined.

- [ ] **Step 7.3: Implement the Git wrapper**

Create `elixir/lib/symphony_elixir/local_tracker/git.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.Git do
  @moduledoc "Thin git clone wrapper (overridable for tests)."

  @callback clone(String.t(), Path.t(), keyword()) ::
              {:ok, String.t()} | {:ok, :already_cloned} | {:error, String.t()}

  @behaviour __MODULE__

  @impl true
  def clone(url, dest, opts \\ []) do
    branch = Keyword.get(opts, :branch)
    cond do
      already_cloned?(dest, url) ->
        {:ok, :already_cloned}

      File.exists?(dest) and File.dir?(dest) and not empty_dir?(dest) ->
        {:error, "destination already exists and is not a clone of #{url}"}

      true ->
        do_clone(url, dest, branch)
    end
  end

  defp do_clone(url, dest, branch) do
    File.mkdir_p!(Path.dirname(dest))
    args = ["clone", "--depth", "1"] ++ branch_args(branch) ++ [authed_url(url), dest]

    case System.cmd("git", args, stderr_to_stdout: true) do
      {_out, 0} -> {:ok, head_sha(dest)}
      {out, _status} -> {:error, String.trim(out)}
    end
  rescue
    error in [ErlangError] -> {:error, "git not available: #{Exception.message(error)}"}
  end

  defp branch_args(nil), do: []
  defp branch_args(branch), do: ["--branch", branch]

  defp authed_url(url) do
    token = System.get_env("GITHUB_TOKEN")

    if is_binary(token) and String.starts_with?(url, "https://github.com/") do
      String.replace(url, "https://github.com/", "https://x-access-token:#{token}@github.com/")
    else
      url
    end
  end

  defp head_sha(dest) do
    case System.cmd("git", ["-C", dest, "rev-parse", "HEAD"], stderr_to_stdout: true) do
      {sha, 0} -> String.trim(sha)
      _ -> nil
    end
  end

  defp already_cloned?(dest, url) do
    File.dir?(Path.join(dest, ".git")) and remote_matches?(dest, url)
  end

  defp remote_matches?(dest, url) do
    case System.cmd("git", ["-C", dest, "remote", "get-url", "origin"], stderr_to_stdout: true) do
      {origin, 0} -> String.trim(origin) == url
      _ -> false
    end
  end

  defp empty_dir?(dest) do
    case File.ls(dest) do
      {:ok, entries} -> entries == []
      _ -> false
    end
  end
end
```

- [ ] **Step 7.4: Implement the CloneWorker**

Create `elixir/lib/symphony_elixir/local_tracker/clone_worker.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.CloneWorker do
  @moduledoc "Runs a single clone job and broadcasts progress."

  use GenServer, restart: :temporary

  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.{Broadcaster, CloneJob, Git, Repository}
  alias SymphonyElixir.Repo

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  @impl true
  def init(opts) do
    job_id = Keyword.fetch!(opts, :job_id)
    {:ok, opts, {:continue, {:run, job_id}}}
  end

  @impl true
  def handle_continue({:run, job_id}, opts) do
    run_sync(job_id, opts)
    {:stop, :normal, opts}
  end

  @spec run_sync(integer(), keyword()) :: {:ok, CloneJob.t()} | {:error, term()}
  def run_sync(job_id, opts \\ []) do
    git = Keyword.get(opts, :git, Git)

    with %CloneJob{} = job <- Repo.get(CloneJob, job_id),
         %Repository{} = repo <- Repo.get(Repository, job.repository_id) do
      project = Repo.preload(job, :project).project
      mark!(job, %{status: "running", started_at: now()})
      Broadcaster.clone_event(project.slug, "clone_started", clone_payload(repo))

      dest = Path.join([Config.workspace_root(), project.slug, repo.workspace_path])

      case git.clone(repo.clone_url || "https://github.com/#{repo.github_full_name}.git", dest, branch: repo.selected_branch || repo.default_branch) do
        {:ok, :already_cloned} ->
          updated = mark!(job, %{status: "skipped", completed_at: now()})
          Broadcaster.clone_event(project.slug, "clone_skipped", clone_payload(repo))
          {:ok, updated}

        {:ok, sha} ->
          updated = mark!(job, %{status: "succeeded", commit_sha: sha, completed_at: now()})
          Broadcaster.clone_event(project.slug, "clone_succeeded", Map.put(clone_payload(repo), :commit_sha, sha))
          {:ok, updated}

        {:error, message} ->
          updated = mark!(job, %{status: "failed", error: message, completed_at: now()})
          Broadcaster.clone_event(project.slug, "clone_failed", Map.put(clone_payload(repo), :error, message))
          {:ok, updated}
      end
    else
      nil -> {:error, :job_not_found}
    end
  end

  defp mark!(job, attrs) do
    job |> CloneJob.changeset(attrs) |> Repo.update!()
  end

  defp clone_payload(repo) do
    %{repository_id: to_string(repo.id), github_full_name: repo.github_full_name}
  end

  defp now, do: DateTime.utc_now()
end
```

- [ ] **Step 7.5: Add `clone_event/3` to the Broadcaster**

In `elixir/lib/symphony_elixir/local_tracker/broadcaster.ex`, add:

```elixir
  @spec clone_event(String.t(), String.t(), map()) :: :ok
  def clone_event(project_slug, event_name, payload)
      when is_binary(project_slug) and event_name in ["clone_started", "clone_succeeded", "clone_failed", "clone_skipped"] do
    broadcast(project_slug, event_name, payload)
  end
```

(The private `broadcast/3` already exists in the module.)

- [ ] **Step 7.6: Implement the CloneSupervisor + supervision wiring**

Create `elixir/lib/symphony_elixir/local_tracker/clone_supervisor.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.CloneSupervisor do
  @moduledoc "Spawns one CloneWorker per clone job."

  use DynamicSupervisor

  alias SymphonyElixir.LocalTracker.CloneWorker

  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts) do
    DynamicSupervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts), do: DynamicSupervisor.init(strategy: :one_for_one)

  @spec start_job(integer()) :: DynamicSupervisor.on_start_child()
  def start_job(job_id) do
    DynamicSupervisor.start_child(__MODULE__, {CloneWorker, [job_id: job_id]})
  end
end
```

In `elixir/lib/symphony_elixir.ex`, add `SymphonyElixir.LocalTracker.CloneSupervisor` to the `children` list (after `Repo`, before `HttpServer`):

```elixir
      SymphonyElixir.LocalTracker.CloneSupervisor,
```

- [ ] **Step 7.7: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/clone_worker_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 7.8: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/git.ex elixir/lib/symphony_elixir/local_tracker/clone_worker.ex elixir/lib/symphony_elixir/local_tracker/clone_supervisor.ex elixir/lib/symphony_elixir.ex elixir/lib/symphony_elixir/local_tracker/broadcaster.ex elixir/test/symphony_elixir/local_tracker/clone_worker_test.exs
git commit -m "feat(local-tracker): async clone worker + supervisor + broadcasts"
```

---

## Task 8 — Templates.instantiate_template/2 (tracker-aware) + clone jobs

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/templates.ex`
- Test: extend `elixir/test/symphony_elixir/local_tracker/templates_test.exs`

- [ ] **Step 8.1: Write the failing tests (append)**

```elixir
  test "instantiate_template creates project, repos, and clone jobs" do
    {:ok, _template} =
      Templates.create_template(%{
        "name" => "Gamba",
        "slug" => "gamba",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [
          %{"github_full_name" => "g/api", "clone_url" => "https://github.com/g/api.git", "workspace_path" => "{{slug}}/api", "role" => "backend"}
        ]
      })

    assert {:ok, project} = Templates.instantiate_template("gamba", %{"name" => "Gamba One", "slug" => "gamba-one"})
    assert project.slug == "gamba-one"

    [repo] = Context.list_repositories("gamba-one")
    assert repo.workspace_path == "gamba-one/api"

    jobs = Templates.list_clone_jobs("gamba-one")
    assert length(jobs) == 1
    assert hd(jobs).status == "pending"
  end

  test "instantiate_template skips statuses for github tracker" do
    {:ok, _template} =
      Templates.create_template(%{
        "name" => "Remote",
        "slug" => "remote-tpl",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => []
      })

    assert {:ok, _project} =
             Templates.instantiate_template("remote-tpl", %{
               "name" => "R",
               "slug" => "r-remote",
               "tracker" => %{"kind" => "github", "config" => %{"repo" => "o/r", "project_id" => "PVT_1"}}
             })

    assert Context.list_statuses("r-remote") == []
  end
```

> `instantiate_template/2` must **not** auto-start clone workers in tests (that would shell out to git). Pass `start_clones: false` by default in the test environment, or have `instantiate_template/2` only **enqueue** `CloneJob` rows (status `pending`) and expose a separate `start_clone_jobs/1` that the controller calls. This plan uses the latter: instantiate enqueues; the controller triggers `CloneSupervisor.start_job/1` per job.

- [ ] **Step 8.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/templates_test.exs`
Expected: FAIL — `instantiate_template/2` / `list_clone_jobs/1` undefined.

- [ ] **Step 8.3: Implement instantiate + clone-job enqueue**

Append to `elixir/lib/symphony_elixir/local_tracker/templates.ex`:

```elixir
  import Ecto.Query, only: [from: 2]

  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.{CloneJob, CloneSupervisor, TemplateSubstitution, WorkspaceTemplate}

  @spec instantiate_template(String.t(), map()) :: {:ok, map()} | {:error, error()}
  def instantiate_template(template_slug, attrs) when is_map(attrs) do
    with {:ok, template} <- get_template(template_slug) do
      vars = substitution_vars(attrs)
      tracker = attr(attrs, :tracker, %{"kind" => "local", "config" => %{}})
      remote? = attr(tracker, :kind, "local") in ["github", "linear"]

      project_attrs = %{
        "name" => attr(attrs, :name),
        "slug" => attr(attrs, :slug),
        "description" => template.description,
        "tracker" => tracker,
        "workflow_statuses" => maybe_statuses(template, remote?),
        "repositories" => template_repositories(template, vars),
        "setup" => maybe_setup(template, vars, remote?)
      }

      with {:ok, project} <- Context.create_workspace_project(project_attrs),
           {:ok, _jobs} <- enqueue_clone_jobs(project) do
        {:ok, project}
      end
    end
  end

  @spec start_clone_jobs(String.t()) :: :ok | {:error, :project_not_found}
  def start_clone_jobs(project_slug) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      project_slug
      |> list_clone_jobs()
      |> Enum.each(fn job -> CloneSupervisor.start_job(job.id) end)

      :ok
    end
  end

  @spec list_clone_jobs(String.t()) :: [CloneJob.t()]
  def list_clone_jobs(project_slug) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        Repo.all(from(j in CloneJob, where: j.project_id == ^project.id, order_by: [asc: j.id], preload: [:repository]))

      _ ->
        []
    end
  end

  defp substitution_vars(attrs) do
    %{slug: attr(attrs, :slug), name: attr(attrs, :name), workspace_root: Config.workspace_root()}
  end

  defp maybe_statuses(_template, true), do: []
  defp maybe_statuses(template, false), do: WorkspaceTemplate.workflow_statuses_list(template)

  defp maybe_setup(_template, _vars, true), do: %{}

  defp maybe_setup(template, vars, false) do
    %{
      "after_create_hook" => TemplateSubstitution.apply(template.after_create_hook, vars),
      "prompt_template" => TemplateSubstitution.apply(template.prompt_template, vars),
      "validation_commands" => WorkspaceTemplate.validation_commands_list(template),
      "workflow_config" => %{},
      "scan_summary" => %{}
    }
  end

  defp template_repositories(template, vars) do
    Enum.map(template.repositories, fn repo ->
      %{
        "github_full_name" => repo.github_full_name,
        "clone_url" => TemplateSubstitution.apply(repo.clone_url, vars),
        "default_branch" => repo.default_branch,
        "selected_branch" => repo.default_branch,
        "workspace_path" => TemplateSubstitution.apply(repo.workspace_path, vars),
        "role" => repo.role,
        "scan_summary" => %{}
      }
    end)
  end

  defp enqueue_clone_jobs(project) do
    repositories = Context.list_repositories(project.slug)

    repositories
    |> Enum.reduce_while({:ok, []}, fn repo, {:ok, acc} ->
      %CloneJob{}
      |> CloneJob.changeset(%{project_id: project.id, repository_id: repo.id, status: "pending"})
      |> Repo.insert()
      |> case do
        {:ok, job} -> {:cont, {:ok, [job | acc]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end
```

> Note: `Context.create_workspace_project/1` must accept the `tracker` key. This requires **Slice B Task 14**. If Slice B is not merged, drop the `"tracker"` key and `remote?` branch (always local) and mark it as a follow-up in the PR.

- [ ] **Step 8.4: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/templates_test.exs`
Expected: PASS (5 tests). Clone workers are NOT started by `instantiate_template/2` (only enqueued), so no git shell-out happens in tests.

- [ ] **Step 8.5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/templates.ex elixir/test/symphony_elixir/local_tracker/templates_test.exs
git commit -m "feat(local-tracker): instantiate template into project + enqueue clone jobs"
```

---

## Task 9 — Template presenter

**Files:**
- Create: `elixir/lib/symphony_elixir_web/presenters/template_presenter.ex`
- Test: `elixir/test/symphony_elixir_web/presenters/template_presenter_test.exs`

- [ ] **Step 9.1: Write the failing test**

Create `elixir/test/symphony_elixir_web/presenters/template_presenter_test.exs`:

```elixir
defmodule SymphonyElixirWeb.TemplatePresenterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.{WorkspaceTemplate, WorkspaceTemplateRepository}
  alias SymphonyElixirWeb.TemplatePresenter

  test "template/1 serializes lists and repositories" do
    template = %WorkspaceTemplate{
      id: 1, name: "Gamba", slug: "gamba", description: nil,
      validation_commands: %{"items" => ["mix test"]},
      workflow_statuses: %{"items" => [%{"name" => "Todo"}]},
      after_create_hook: "echo hi", prompt_template: nil, dev_env_markdown: nil, metadata: %{},
      repositories: [%WorkspaceTemplateRepository{id: 2, github_full_name: "g/api", clone_url: "u", workspace_path: "api", role: "backend", default_branch: "main"}]
    }

    json = TemplatePresenter.template(template)
    assert json.slug == "gamba"
    assert json.validation_commands == ["mix test"]
    assert [%{github_full_name: "g/api"}] = json.repositories
  end
end
```

- [ ] **Step 9.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/presenters/template_presenter_test.exs`
Expected: FAIL — module missing.

- [ ] **Step 9.3: Implement the presenter**

Create `elixir/lib/symphony_elixir_web/presenters/template_presenter.ex`:

```elixir
defmodule SymphonyElixirWeb.TemplatePresenter do
  @moduledoc "JSON DTOs for workspace templates and clone jobs."

  alias SymphonyElixir.LocalTracker.{CloneJob, WorkspaceTemplate, WorkspaceTemplateRepository}

  @spec template(WorkspaceTemplate.t()) :: map()
  def template(%WorkspaceTemplate{} = template) do
    %{
      id: template.id,
      name: template.name,
      slug: template.slug,
      description: template.description,
      validation_commands: WorkspaceTemplate.validation_commands_list(template),
      workflow_statuses: WorkspaceTemplate.workflow_statuses_list(template),
      after_create_hook: template.after_create_hook,
      prompt_template: template.prompt_template,
      dev_env_markdown: template.dev_env_markdown,
      metadata: template.metadata,
      repositories: Enum.map(repositories(template), &repository/1),
      inserted_at: iso8601(template.inserted_at),
      updated_at: iso8601(template.updated_at)
    }
  end

  @spec repository(WorkspaceTemplateRepository.t()) :: map()
  def repository(%WorkspaceTemplateRepository{} = repo) do
    %{
      id: repo.id,
      github_full_name: repo.github_full_name,
      clone_url: repo.clone_url,
      default_branch: repo.default_branch,
      workspace_path: repo.workspace_path,
      role: repo.role
    }
  end

  @spec clone_job(CloneJob.t()) :: map()
  def clone_job(%CloneJob{} = job) do
    %{
      id: job.id,
      repository_id: job.repository_id,
      status: job.status,
      error: job.error,
      commit_sha: job.commit_sha,
      started_at: iso8601(job.started_at),
      completed_at: iso8601(job.completed_at)
    }
  end

  defp repositories(%WorkspaceTemplate{repositories: repos}) when is_list(repos), do: repos
  defp repositories(_), do: []

  defp iso8601(%DateTime{} = dt), do: dt |> DateTime.truncate(:second) |> DateTime.to_iso8601()
  defp iso8601(_), do: nil
end
```

- [ ] **Step 9.4: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/presenters/template_presenter_test.exs`
Expected: PASS.

- [ ] **Step 9.5: Commit**

```bash
git add elixir/lib/symphony_elixir_web/presenters/template_presenter.ex elixir/test/symphony_elixir_web/presenters/template_presenter_test.exs
git commit -m "feat(tracker-api): add template presenter"
```

---

## Task 10 — TemplateController + CloneJobController + routes

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/template_controller.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/clone_job_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/template_controller_test.exs`

- [ ] **Step 10.1: Write the failing test**

Create `elixir/test/symphony_elixir_web/controllers/tracker/template_controller_test.exs`:

```elixir
defmodule SymphonyElixirWeb.Tracker.TemplateControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    {:ok, _repo, _apps} = Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
    for t <- ["local_tracker_workspace_template_repositories", "local_tracker_workspace_templates"], do: Repo.query!("delete from #{t}")

    previous = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    on_exit(fn -> if previous, do: System.put_env(@token_env, previous), else: System.delete_env(@token_env) end)
    :ok
  end

  defp authorized_conn, do: build_conn() |> put_req_header("authorization", "Bearer secret")

  test "create, list, show, delete templates" do
    create =
      post(authorized_conn(), "/api/tracker/v1/templates", %{
        "name" => "Gamba",
        "slug" => "gamba",
        "validation_commands" => ["mix test"],
        "repositories" => [%{"github_full_name" => "g/api", "clone_url" => "u", "workspace_path" => "api", "role" => "backend"}]
      })

    assert %{"data" => %{"slug" => "gamba"}} = json_response(create, 201)

    list = get(authorized_conn(), "/api/tracker/v1/templates")
    assert %{"data" => [%{"slug" => "gamba"}]} = json_response(list, 200)

    show = get(authorized_conn(), "/api/tracker/v1/templates/gamba")
    assert %{"data" => %{"validation_commands" => ["mix test"]}} = json_response(show, 200)

    del = delete(authorized_conn(), "/api/tracker/v1/templates/gamba")
    assert response(del, 204)
  end

  test "show returns 404 for unknown slug" do
    conn = get(authorized_conn(), "/api/tracker/v1/templates/nope")
    assert json_response(conn, 404)["error"]["code"] == "template_not_found"
  end
end
```

- [ ] **Step 10.2: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/template_controller_test.exs`
Expected: FAIL — routes + controller missing.

- [ ] **Step 10.3: Add `:template_not_found` to TrackerErrors**

In `elixir/lib/symphony_elixir_web/tracker_errors.ex`, add a clause (before any catch-all):

```elixir
  def render(conn, :template_not_found),
    do: conn |> Plug.Conn.put_status(404) |> Phoenix.Controller.json(%{error: %{code: "template_not_found", message: "Template not found"}})
```

(If Slice B already added an `error/4` helper, reuse it: `error(conn, 404, "template_not_found", "Template not found")`.)

- [ ] **Step 10.4: Implement the controllers**

Create `elixir/lib/symphony_elixir_web/controllers/tracker/template_controller.ex`:

```elixir
defmodule SymphonyElixirWeb.Tracker.TemplateController do
  @moduledoc "CRUD + import/export + instantiate for workspace templates."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Templates
  alias SymphonyElixirWeb.{TemplatePresenter, TrackerErrors, TrackerPresenter}

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, _params) do
    json(conn, %{data: Enum.map(Templates.list_templates(), &TemplatePresenter.template/1)})
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, params) do
    case Templates.create_template(params) do
      {:ok, template} -> conn |> put_status(:created) |> json(%{data: TemplatePresenter.template(template)})
      {:error, %Ecto.Changeset{} = cs} -> TrackerErrors.render(conn, cs)
    end
  end

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"slug" => slug}) do
    case Templates.get_template(slug) do
      {:ok, template} -> json(conn, %{data: TemplatePresenter.template(template)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec update(Conn.t(), map()) :: Conn.t()
  def update(conn, %{"slug" => slug} = params) do
    case Templates.update_template(slug, Map.delete(params, "slug")) do
      {:ok, template} -> json(conn, %{data: TemplatePresenter.template(template)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{"slug" => slug}) do
    case Templates.delete_template(slug) do
      {:ok, _} -> send_resp(conn, :no_content, "")
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec import(Conn.t(), map()) :: Conn.t()
  def import(conn, %{"yaml" => yaml}) when is_binary(yaml) do
    case Templates.import_yaml(yaml) do
      {:ok, template} -> conn |> put_status(:created) |> json(%{data: TemplatePresenter.template(template)})
      {:error, :invalid_yaml} -> TrackerErrors.validation(conn, "Invalid YAML")
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec export(Conn.t(), map()) :: Conn.t()
  def export(conn, %{"slug" => slug}) do
    case Templates.export_yaml(slug) do
      {:ok, yaml} -> conn |> put_resp_content_type("text/yaml") |> send_resp(200, yaml)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec instantiate(Conn.t(), map()) :: Conn.t()
  def instantiate(conn, %{"slug" => slug} = params) do
    attrs = Map.delete(params, "slug")

    case Templates.instantiate_template(slug, attrs) do
      {:ok, project} ->
        Templates.start_clone_jobs(project.slug)
        conn |> put_status(:created) |> json(%{data: TrackerPresenter.project(project)})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  @spec save_as_template(Conn.t(), map()) :: Conn.t()
  def save_as_template(conn, %{"project_slug" => project_slug} = params) do
    overrides = params |> Map.delete("project_slug") |> atomize()

    case Templates.save_project_as_template(project_slug, overrides) do
      {:ok, template} -> conn |> put_status(:created) |> json(%{data: TemplatePresenter.template(template)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp atomize(map), do: Map.new(map, fn {k, v} -> {String.to_existing_atom(k), v} end)
end
```

Create `elixir/lib/symphony_elixir_web/controllers/tracker/clone_job_controller.ex`:

```elixir
defmodule SymphonyElixirWeb.Tracker.CloneJobController do
  @moduledoc "Lists and retries clone jobs for a project."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.{CloneSupervisor, Templates}
  alias SymphonyElixirWeb.TemplatePresenter

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug}) do
    jobs = Templates.list_clone_jobs(project_slug)
    json(conn, %{data: Enum.map(jobs, &TemplatePresenter.clone_job/1)})
  end

  @spec retry(Conn.t(), map()) :: Conn.t()
  def retry(conn, %{"project_slug" => _project_slug, "id" => job_id}) do
    {:ok, _pid} = CloneSupervisor.start_job(String.to_integer(job_id))
    send_resp(conn, :accepted, "")
  end
end
```

> `atomize/1` in `save_as_template` uses `String.to_existing_atom/1`; ensure `:name`, `:slug`, `:description`, `:dev_env_markdown` atoms exist (they do — referenced in `Templates`). If a key is unexpected, it raises; restrict accepted keys with `Map.take(params, ["name", "slug", "description", "dev_env_markdown"])` before atomizing for safety.

- [ ] **Step 10.5: Mount the routes**

In `elixir/lib/symphony_elixir_web/router.ex`, inside the tracker scope add:

```elixir
    resources("/templates", TemplateController, only: [:index, :create, :show, :update, :delete], param: "slug")
    post("/templates/import", TemplateController, :import)
    get("/templates/:slug/export", TemplateController, :export)
    post("/templates/:slug/instantiate", TemplateController, :instantiate)
    post("/projects/:project_slug/save_as_template", TemplateController, :save_as_template)
    get("/projects/:project_slug/clone_jobs", CloneJobController, :index)
    post("/projects/:project_slug/clone_jobs/:id/retry", CloneJobController, :retry)
```

> Order matters: declare `post("/templates/import", ...)` **before** the `resources` block if Phoenix would otherwise match `import` as a `:slug`. Phoenix matches in declaration order, so put the static `import` route first, or rely on `resources` only defining `/templates/:slug` for `show` (which it does); to be safe, place `post("/templates/import", ...)` above the `resources` line.

- [ ] **Step 10.6: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/template_controller_test.exs`
Expected: PASS.

- [ ] **Step 10.7: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/template_controller.ex elixir/lib/symphony_elixir_web/controllers/tracker/clone_job_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/lib/symphony_elixir_web/tracker_errors.ex elixir/test/symphony_elixir_web/controllers/tracker/template_controller_test.exs
git commit -m "feat(tracker-api): template CRUD, import/export, instantiate, clone jobs"
```

---

## Task 11 — Built-in templates seeded on boot

**Files:**
- Create: `elixir/priv/templates/single-repo-elixir.yml`
- Create: `elixir/priv/templates/multi-repo-fullstack.yml`
- Modify: `elixir/lib/symphony_elixir/local_tracker/templates.ex` (`import_builtins/0`)
- Modify: `elixir/lib/symphony_elixir.ex` (call after Repo starts) — OR a Repo-after-connect hook. Simplest: call in `Orchestrator` boot or a dedicated `Task`. This plan adds a one-shot Task in the supervision tree.
- Test: `elixir/test/symphony_elixir/local_tracker/templates_test.exs` (append)

- [ ] **Step 11.1: Write the YAML fixtures**

Create `elixir/priv/templates/single-repo-elixir.yml`:

```yaml
slug: single-repo-elixir
name: Single Elixir repo
description: A single Elixir/Phoenix repository with mix test validation.
validation_commands:
  - mix test
after_create_hook: |
  cd {{workspace_root}}/{{slug}}/app && mix deps.get
repositories:
  - github_full_name: your-org/your-app
    clone_url: https://github.com/your-org/your-app.git
    default_branch: main
    workspace_path: app
    role: backend
metadata:
  source: builtin
```

Create `elixir/priv/templates/multi-repo-fullstack.yml`:

```yaml
slug: multi-repo-fullstack
name: Full-stack workspace
description: Backend + frontend workspace with install + test steps.
validation_commands:
  - mix test
  - pnpm test
after_create_hook: |
  cd {{workspace_root}}/{{slug}}/api && mix deps.get
  cd {{workspace_root}}/{{slug}}/web && pnpm install
repositories:
  - github_full_name: your-org/api
    clone_url: https://github.com/your-org/api.git
    default_branch: main
    workspace_path: api
    role: backend
  - github_full_name: your-org/web
    clone_url: https://github.com/your-org/web.git
    default_branch: main
    workspace_path: web
    role: frontend
metadata:
  source: builtin
```

- [ ] **Step 11.2: Write the failing test (append to templates_test.exs)**

```elixir
  test "import_builtins seeds templates idempotently" do
    assert :ok = Templates.import_builtins()
    slugs = Templates.list_templates() |> Enum.map(& &1.slug)
    assert "single-repo-elixir" in slugs
    assert "multi-repo-fullstack" in slugs

    # Idempotent: second run does not duplicate
    assert :ok = Templates.import_builtins()
    count = Templates.list_templates() |> Enum.count(&(&1.slug == "single-repo-elixir"))
    assert count == 1
  end
```

- [ ] **Step 11.3: Run to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/templates_test.exs -k builtins`
Expected: FAIL — `import_builtins/0` undefined.

- [ ] **Step 11.4: Implement import_builtins**

Append to `elixir/lib/symphony_elixir/local_tracker/templates.ex`:

```elixir
  @spec import_builtins() :: :ok
  def import_builtins do
    :symphony_elixir
    |> :code.priv_dir()
    |> Path.join("templates/*.yml")
    |> Path.wildcard()
    |> Enum.each(fn path ->
      with {:ok, yaml} <- File.read(path),
           {:ok, attrs} <- TemplateYaml.decode(yaml),
           slug when is_binary(slug) <- Map.get(attrs, "slug"),
           {:error, :template_not_found} <- get_template(slug) do
        create_template(attrs)
      end
    end)

    :ok
  end
```

- [ ] **Step 11.5: Wire it into boot**

In `elixir/lib/symphony_elixir.ex`, add a one-shot task child **after** `Repo` (and after `CloneSupervisor`). Use a `Task` child spec:

```elixir
      %{
        id: :seed_builtin_templates,
        start: {Task, :start_link, [fn -> SymphonyElixir.LocalTracker.Templates.import_builtins() end]},
        restart: :temporary
      },
```

Place it after `SymphonyElixir.Repo` so the DB is available. Wrap `import_builtins/0` body so a missing table during early migration does not crash boot — it already uses `with`/`File.read`, and `get_template/1` will raise only if the table is missing; guard by rescuing in the task:

```elixir
        start: {Task, :start_link, [fn ->
          try do
            SymphonyElixir.LocalTracker.Templates.import_builtins()
          rescue
            _ -> :ok
          end
        end]},
```

- [ ] **Step 11.6: Run to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/templates_test.exs`
Expected: PASS.

- [ ] **Step 11.7: Commit**

```bash
git add elixir/priv/templates/single-repo-elixir.yml elixir/priv/templates/multi-repo-fullstack.yml elixir/lib/symphony_elixir/local_tracker/templates.ex elixir/lib/symphony_elixir.ex elixir/test/symphony_elixir/local_tracker/templates_test.exs
git commit -m "feat(local-tracker): seed built-in workspace templates on boot"
```

---

## Task 12 — Backend full gate

- [ ] **Step 12.1: Run the backend quality gate**

Run: `cd elixir && mise exec -- mix all`
Expected: PASS. Run `mise exec -- mix format` for any formatting issues and re-run.

- [ ] **Step 12.2: Commit fixups**

```bash
git add -A elixir && git commit -m "chore(elixir): satisfy format/credo for workspace templates" || echo "nothing to commit"
```

---

## Task 13 — Frontend: template types + service

**Files:**
- Create: `tracker/src/types/template.ts`
- Create: `tracker/src/services/templates.ts`
- Test: `tracker/src/services/__tests__/templates.test.ts`

- [ ] **Step 13.1: Write the types**

Create `tracker/src/types/template.ts`:

```ts
export interface WorkspaceTemplateRepository {
  id?: string;
  githubFullName: string;
  cloneUrl: string;
  defaultBranch: string | null;
  workspacePath: string;
  role: string | null;
}

export interface WorkspaceTemplate {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  validationCommands: string[];
  workflowStatuses: Array<Record<string, unknown>>;
  afterCreateHook: string | null;
  promptTemplate: string | null;
  devEnvMarkdown: string | null;
  metadata: Record<string, unknown>;
  repositories: WorkspaceTemplateRepository[];
}

export type CloneJobStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface CloneJob {
  id: string;
  repositoryId: string;
  status: CloneJobStatus;
  error: string | null;
  commitSha: string | null;
  startedAt: string | null;
  completedAt: string | null;
}
```

- [ ] **Step 13.2: Write the failing test**

Create `tracker/src/services/__tests__/templates.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { listTemplates, instantiateTemplate, importTemplate } from "@/services/templates";
import { http } from "@/services/http";

vi.mock("@/services/http", async () => {
  const actual = await vi.importActual<typeof import("@/services/http")>("@/services/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn() } };
});

describe("templates service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listTemplates normalizes response", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: [{ id: 1, name: "G", slug: "g", validation_commands: ["mix test"], repositories: [] }] },
    });

    const result = await listTemplates();
    expect(result[0].slug).toBe("g");
    expect(result[0].validationCommands).toEqual(["mix test"]);
  });

  it("instantiateTemplate posts name+slug+tracker", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { id: 1, slug: "g1", name: "G1" } } });
    await instantiateTemplate("g", { name: "G1", slug: "g1", tracker: { kind: "local", config: {} } });
    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining("/templates/g/instantiate"),
      expect.objectContaining({ name: "G1", slug: "g1" }),
    );
  });

  it("importTemplate posts yaml", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { id: 1, slug: "g", name: "G", repositories: [] } } });
    await importTemplate("slug: g\nname: G\n");
    expect(http.post).toHaveBeenCalledWith(expect.stringContaining("/templates/import"), { yaml: "slug: g\nname: G\n" });
  });
});
```

- [ ] **Step 13.3: Run to verify it fails**

Run: `cd tracker && npm test -- src/services/__tests__/templates.test.ts`
Expected: FAIL — service missing.

- [ ] **Step 13.4: Implement the service**

Create `tracker/src/services/templates.ts`:

```ts
import type { Project } from "@/types/project";
import type { CloneJob, WorkspaceTemplate } from "@/types/template";
import { http, trackerPath, unwrapData } from "./http";
import { normalizeProject, type BackendProjectDto } from "./mappers";

interface TemplateRepoDto {
  id?: number | string;
  github_full_name?: string;
  clone_url?: string;
  default_branch?: string | null;
  workspace_path?: string;
  role?: string | null;
}

interface TemplateDto {
  id: number | string;
  name: string;
  slug: string;
  description?: string | null;
  validation_commands?: string[] | null;
  workflow_statuses?: Array<Record<string, unknown>> | null;
  after_create_hook?: string | null;
  prompt_template?: string | null;
  dev_env_markdown?: string | null;
  metadata?: Record<string, unknown> | null;
  repositories?: TemplateRepoDto[] | null;
}

interface CloneJobDto {
  id: number | string;
  repository_id: number | string;
  status: CloneJob["status"];
  error?: string | null;
  commit_sha?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

function normalizeTemplate(dto: TemplateDto): WorkspaceTemplate {
  return {
    id: String(dto.id),
    name: dto.name,
    slug: dto.slug,
    description: dto.description ?? null,
    validationCommands: dto.validation_commands ?? [],
    workflowStatuses: dto.workflow_statuses ?? [],
    afterCreateHook: dto.after_create_hook ?? null,
    promptTemplate: dto.prompt_template ?? null,
    devEnvMarkdown: dto.dev_env_markdown ?? null,
    metadata: dto.metadata ?? {},
    repositories: (dto.repositories ?? []).map((repo) => ({
      id: repo.id !== undefined ? String(repo.id) : undefined,
      githubFullName: repo.github_full_name ?? "",
      cloneUrl: repo.clone_url ?? "",
      defaultBranch: repo.default_branch ?? null,
      workspacePath: repo.workspace_path ?? "",
      role: repo.role ?? null,
    })),
  };
}

function normalizeCloneJob(dto: CloneJobDto): CloneJob {
  return {
    id: String(dto.id),
    repositoryId: String(dto.repository_id),
    status: dto.status,
    error: dto.error ?? null,
    commitSha: dto.commit_sha ?? null,
    startedAt: dto.started_at ?? null,
    completedAt: dto.completed_at ?? null,
  };
}

export async function listTemplates(): Promise<WorkspaceTemplate[]> {
  const response = await http.get(trackerPath("/templates"));
  return unwrapData<TemplateDto[]>(response).map(normalizeTemplate);
}

export async function getTemplate(slug: string): Promise<WorkspaceTemplate> {
  const response = await http.get(trackerPath(`/templates/${encodeURIComponent(slug)}`));
  return normalizeTemplate(unwrapData<TemplateDto>(response));
}

export async function deleteTemplate(slug: string): Promise<void> {
  await http.delete(trackerPath(`/templates/${encodeURIComponent(slug)}`));
}

export async function importTemplate(yaml: string): Promise<WorkspaceTemplate> {
  const response = await http.post(trackerPath("/templates/import"), { yaml });
  return normalizeTemplate(unwrapData<TemplateDto>(response));
}

export interface InstantiateTemplateInput {
  name: string;
  slug: string;
  tracker?: { kind: string; config: Record<string, unknown> };
}

export async function instantiateTemplate(slug: string, input: InstantiateTemplateInput): Promise<Project> {
  const response = await http.post(trackerPath(`/templates/${encodeURIComponent(slug)}/instantiate`), input);
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export interface SaveAsTemplateInput {
  name?: string;
  slug?: string;
  description?: string | null;
}

export async function saveProjectAsTemplate(projectSlug: string, input: SaveAsTemplateInput): Promise<WorkspaceTemplate> {
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/save_as_template`), input);
  return normalizeTemplate(unwrapData<TemplateDto>(response));
}

export async function listCloneJobs(projectSlug: string): Promise<CloneJob[]> {
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/clone_jobs`));
  return unwrapData<CloneJobDto[]>(response).map(normalizeCloneJob);
}
```

- [ ] **Step 13.5: Run to verify it passes**

Run: `cd tracker && npm test -- src/services/__tests__/templates.test.ts`
Expected: PASS.

- [ ] **Step 13.6: Commit**

```bash
git add tracker/src/types/template.ts tracker/src/services/templates.ts tracker/src/services/__tests__/templates.test.ts
git commit -m "feat(tracker): add workspace template service + types"
```

---

## Task 14 — Frontend: clone progress hook

**Files:**
- Create: `tracker/src/hooks/useCloneProgress.ts`
- Test: `tracker/src/hooks/__tests__/useCloneProgress.test.tsx`

- [ ] **Step 14.1: Inspect the existing socket hook**

Read how the board subscribes to the `project:<slug>` channel (search for `TrackerChannel` usage in `tracker/src` — likely a `useProjectChannel` or similar in `hooks/`). Reuse that primitive. The new hook listens for `clone_started`/`clone_succeeded`/`clone_failed`/`clone_skipped` events on the same channel.

- [ ] **Step 14.2: Write the failing test**

Create `tracker/src/hooks/__tests__/useCloneProgress.test.tsx`. Mock the channel primitive your codebase uses; the test asserts the reducer transitions:

```tsx
import { describe, expect, it } from "vitest";
import { cloneProgressReducer, initialCloneState } from "@/hooks/useCloneProgress";

describe("cloneProgressReducer", () => {
  it("tracks started -> succeeded", () => {
    let state = initialCloneState;
    state = cloneProgressReducer(state, { event: "clone_started", repository_id: "1", github_full_name: "g/api" });
    expect(state.jobs["1"].status).toBe("running");

    state = cloneProgressReducer(state, { event: "clone_succeeded", repository_id: "1", commit_sha: "abc" });
    expect(state.jobs["1"].status).toBe("succeeded");
    expect(state.allSucceeded).toBe(true);
    expect(state.anyFailed).toBe(false);
  });

  it("flags failures", () => {
    let state = initialCloneState;
    state = cloneProgressReducer(state, { event: "clone_started", repository_id: "1", github_full_name: "g/api" });
    state = cloneProgressReducer(state, { event: "clone_failed", repository_id: "1", error: "boom" });
    expect(state.anyFailed).toBe(true);
    expect(state.jobs["1"].error).toBe("boom");
  });
});
```

- [ ] **Step 14.3: Run to verify it fails**

Run: `cd tracker && npm test -- src/hooks/__tests__/useCloneProgress.test.tsx`
Expected: FAIL — reducer missing.

- [ ] **Step 14.4: Implement the reducer + hook**

Create `tracker/src/hooks/useCloneProgress.ts`:

```ts
import { useEffect, useReducer } from "react";

export interface CloneEvent {
  event: "clone_started" | "clone_succeeded" | "clone_failed" | "clone_skipped";
  repository_id: string;
  github_full_name?: string;
  commit_sha?: string;
  error?: string;
}

export interface CloneJobView {
  repositoryId: string;
  githubFullName?: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  commitSha?: string;
  error?: string;
}

export interface CloneProgressState {
  jobs: Record<string, CloneJobView>;
  allSucceeded: boolean;
  anyFailed: boolean;
  inProgressCount: number;
}

export const initialCloneState: CloneProgressState = {
  jobs: {},
  allSucceeded: false,
  anyFailed: false,
  inProgressCount: 0,
};

export function cloneProgressReducer(state: CloneProgressState, event: CloneEvent): CloneProgressState {
  const status = statusFor(event.event);
  const job: CloneJobView = {
    repositoryId: event.repository_id,
    githubFullName: event.github_full_name ?? state.jobs[event.repository_id]?.githubFullName,
    status,
    commitSha: event.commit_sha,
    error: event.error,
  };

  const jobs = { ...state.jobs, [event.repository_id]: job };
  const values = Object.values(jobs);

  return {
    jobs,
    allSucceeded: values.length > 0 && values.every((j) => j.status === "succeeded" || j.status === "skipped"),
    anyFailed: values.some((j) => j.status === "failed"),
    inProgressCount: values.filter((j) => j.status === "running").length,
  };
}

function statusFor(event: CloneEvent["event"]): CloneJobView["status"] {
  switch (event) {
    case "clone_started":
      return "running";
    case "clone_succeeded":
      return "succeeded";
    case "clone_skipped":
      return "skipped";
    case "clone_failed":
      return "failed";
  }
}

export function useCloneProgress(
  subscribe: (handler: (event: CloneEvent) => void) => () => void,
): CloneProgressState {
  const [state, dispatch] = useReducer(cloneProgressReducer, initialCloneState);

  useEffect(() => subscribe((event) => dispatch(event)), [subscribe]);

  return state;
}
```

> The hook takes a `subscribe` function so it stays decoupled from the concrete socket. In `CloneProgressBar` (Task 15) you pass a `subscribe` that wires the existing project channel's `on("clone_started", ...)` etc. into the handler.

- [ ] **Step 14.5: Run to verify it passes**

Run: `cd tracker && npm test -- src/hooks/__tests__/useCloneProgress.test.tsx`
Expected: PASS.

- [ ] **Step 14.6: Commit**

```bash
git add tracker/src/hooks/useCloneProgress.ts tracker/src/hooks/__tests__/useCloneProgress.test.tsx
git commit -m "feat(tracker): clone progress reducer + hook"
```

---

## Task 15 — Frontend: CloneProgressBar + SaveAsTemplateDialog

**Files:**
- Create: `tracker/src/components/templates/CloneProgressBar.tsx`
- Create: `tracker/src/components/templates/SaveAsTemplateDialog.tsx`
- Tests: `.../__tests__/CloneProgressBar.test.tsx`, `.../__tests__/SaveAsTemplateDialog.test.tsx`

- [ ] **Step 15.1: Write the failing test (CloneProgressBar)**

Create `tracker/src/components/templates/__tests__/CloneProgressBar.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CloneProgressBar } from "@/components/templates/CloneProgressBar";

describe("CloneProgressBar", () => {
  it("renders running state", () => {
    render(
      <CloneProgressBar
        state={{ jobs: { "1": { repositoryId: "1", status: "running", githubFullName: "g/api" } }, allSucceeded: false, anyFailed: false, inProgressCount: 1 }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/Cloning/i)).toBeInTheDocument();
  });

  it("hides when all succeeded", () => {
    const { container } = render(
      <CloneProgressBar
        state={{ jobs: { "1": { repositoryId: "1", status: "succeeded" } }, allSucceeded: true, anyFailed: false, inProgressCount: 0 }}
        onRetry={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 15.2: Run to verify it fails**

Run: `cd tracker && npm test -- src/components/templates/__tests__/CloneProgressBar.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 15.3: Implement CloneProgressBar**

Create `tracker/src/components/templates/CloneProgressBar.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import type { CloneProgressState } from "@/hooks/useCloneProgress";

interface CloneProgressBarProps {
  state: CloneProgressState;
  onRetry: (repositoryId: string) => void;
}

export function CloneProgressBar({ state, onRetry }: CloneProgressBarProps) {
  const jobs = Object.values(state.jobs);
  if (jobs.length === 0 || (state.allSucceeded && !state.anyFailed)) return null;

  return (
    <div className="rounded-md border bg-muted/40 p-3 text-sm">
      <p className="font-medium">
        {state.anyFailed ? "Some repositories failed to clone" : `Cloning repositories (${state.inProgressCount} in progress)`}
      </p>
      <ul className="mt-2 space-y-1">
        {jobs.map((job) => (
          <li key={job.repositoryId} className="flex items-center justify-between gap-2">
            <span className="truncate">{job.githubFullName ?? job.repositoryId}</span>
            <span className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{job.status}</span>
              {job.status === "failed" ? (
                <Button size="sm" variant="ghost" onClick={() => onRetry(job.repositoryId)}>
                  Retry
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 15.4: Implement SaveAsTemplateDialog + test**

Create `tracker/src/components/templates/SaveAsTemplateDialog.tsx`:

```tsx
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { saveProjectAsTemplate } from "@/services/templates";
import type { WorkspaceTemplate } from "@/types/template";

interface SaveAsTemplateDialogProps {
  projectSlug: string;
  onSaved?: (template: WorkspaceTemplate) => void;
}

export function SaveAsTemplateDialog({ projectSlug, onSaved }: SaveAsTemplateDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const template = await saveProjectAsTemplate(projectSlug, { name: name || undefined, slug: slug || undefined });
      onSaved?.(template);
      setOpen(false);
      toast.success("Template saved");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to save template");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">Save as template</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save project as template</DialogTitle>
        </DialogHeader>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" />
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="template-slug" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : "Save template"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

Create `tracker/src/components/templates/__tests__/SaveAsTemplateDialog.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SaveAsTemplateDialog } from "@/components/templates/SaveAsTemplateDialog";
import * as templates from "@/services/templates";

vi.mock("@/services/templates");

describe("SaveAsTemplateDialog", () => {
  it("submits and reports saved template", async () => {
    vi.mocked(templates.saveProjectAsTemplate).mockResolvedValue({ slug: "p-tpl" } as never);
    const onSaved = vi.fn();
    render(<SaveAsTemplateDialog projectSlug="p" onSaved={onSaved} />);

    await userEvent.click(screen.getByRole("button", { name: /save as template/i }));
    await userEvent.type(screen.getByPlaceholderText(/template-slug/i), "p-tpl");
    await userEvent.click(screen.getByRole("button", { name: /^save template$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(templates.saveProjectAsTemplate).toHaveBeenCalledWith("p", expect.objectContaining({ slug: "p-tpl" }));
  });
});
```

- [ ] **Step 15.5: Run both tests**

Run: `cd tracker && npm test -- src/components/templates/__tests__/CloneProgressBar.test.tsx src/components/templates/__tests__/SaveAsTemplateDialog.test.tsx`
Expected: PASS.

- [ ] **Step 15.6: Commit**

```bash
git add tracker/src/components/templates/CloneProgressBar.tsx tracker/src/components/templates/SaveAsTemplateDialog.tsx tracker/src/components/templates/__tests__/CloneProgressBar.test.tsx tracker/src/components/templates/__tests__/SaveAsTemplateDialog.test.tsx
git commit -m "feat(tracker): clone progress bar + save-as-template dialog"
```

---

## Task 16 — Frontend: template list/edit pages + sidebar link + routes

**Files:**
- Create: `tracker/src/components/templates/TemplateList.tsx`
- Create: `tracker/src/components/templates/TemplateForm.tsx`
- Create: `tracker/src/pages/TemplateListPage.tsx`
- Create: `tracker/src/pages/TemplateEditPage.tsx`
- Modify: router file + `ProjectSidebar.tsx`
- Test: a `TemplateList` render test.

- [ ] **Step 16.1: Write the failing test (TemplateList)**

Create `tracker/src/components/templates/__tests__/TemplateList.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TemplateList } from "@/components/templates/TemplateList";

describe("TemplateList", () => {
  it("renders templates with repo counts", () => {
    render(
      <MemoryRouter>
        <TemplateList
          templates={[
            { id: "1", name: "Gamba", slug: "gamba", description: null, validationCommands: [], workflowStatuses: [], afterCreateHook: null, promptTemplate: null, devEnvMarkdown: null, metadata: {}, repositories: [{ githubFullName: "g/api", cloneUrl: "u", defaultBranch: "main", workspacePath: "api", role: "backend" }] },
          ]}
          onDelete={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Gamba")).toBeInTheDocument();
    expect(screen.getByText(/1 repo/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 16.2: Run to verify it fails**

Run: `cd tracker && npm test -- src/components/templates/__tests__/TemplateList.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 16.3: Implement TemplateList**

Create `tracker/src/components/templates/TemplateList.tsx`:

```tsx
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { WorkspaceTemplate } from "@/types/template";

interface TemplateListProps {
  templates: WorkspaceTemplate[];
  onDelete: (slug: string) => void;
}

export function TemplateList({ templates, onDelete }: TemplateListProps) {
  if (templates.length === 0) {
    return <p className="text-sm text-muted-foreground">No templates yet.</p>;
  }

  return (
    <div className="grid gap-2">
      {templates.map((template) => (
        <div key={template.id} className="flex items-center justify-between rounded-md border p-3">
          <Link to={`/templates/${encodeURIComponent(template.slug)}`} className="min-w-0">
            <span className="block text-sm font-medium">{template.name}</span>
            <span className="block text-xs text-muted-foreground">
              {template.repositories.length} repo{template.repositories.length === 1 ? "" : "s"}
              {template.description ? ` · ${template.description}` : ""}
            </span>
          </Link>
          <Button size="sm" variant="ghost" onClick={() => onDelete(template.slug)}>Delete</Button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 16.4: Implement pages, TemplateForm, sidebar link, routes**

- `TemplateListPage.tsx`: loads `listTemplates()` on mount, renders `<TemplateList>`, plus an `<input type="file">`-driven import button (reads file text → `importTemplate(text)`).
- `TemplateForm.tsx`: edit form for a single template (name, description, repos editor, hooks textarea, validation commands, prompt template, dev-env markdown). Save calls `updateTemplate` (add `updateTemplate` to the service mirroring `createTemplate`). Export button hits `/templates/:slug/export` (use `window.location` or fetch + download blob).
- `TemplateEditPage.tsx`: loads `getTemplate(slug)`, renders `<TemplateForm>`.
- Router: add `<Route path="/templates" element={<TemplateListPage />} />` and `<Route path="/templates/:slug" element={<TemplateEditPage />} />` next to the existing project routes.
- `ProjectSidebar.tsx`: add a `<Link to="/templates">Templates</Link>` entry above the projects list.

> These are mostly composition of already-tested primitives; a render smoke test for `TemplateListPage` is optional. Keep `TemplateForm` thin and lean on the service tests for behavior.

- [ ] **Step 16.5: Run the list test + typecheck**

Run: `cd tracker && npm test -- src/components/templates/__tests__/TemplateList.test.tsx`
Then: `cd tracker && npm run build`
Expected: PASS / no TS errors.

- [ ] **Step 16.6: Commit**

```bash
git add tracker/src/components/templates/ tracker/src/pages/TemplateListPage.tsx tracker/src/pages/TemplateEditPage.tsx tracker/src/components/layout/ProjectSidebar.tsx
# plus the router file you modified
git commit -m "feat(tracker): template list/edit pages, sidebar link, routes"
```

---

## Task 17 — Frontend: wizard "Start from a template" tab

**Files:**
- Modify: `tracker/src/components/projects/ProjectWorkspaceWizard.tsx`
- Test: extend `tracker/src/components/projects/__tests__/ProjectWorkspaceWizard.test.tsx`

- [ ] **Step 17.1: Write the failing test (append)**

```tsx
it("instantiates a project from a template", async () => {
  vi.mocked(templates.listTemplates).mockResolvedValue([
    { id: "1", name: "Gamba", slug: "gamba", description: null, validationCommands: [], workflowStatuses: [], afterCreateHook: null, promptTemplate: null, devEnvMarkdown: null, metadata: {}, repositories: [] },
  ]);
  vi.mocked(templates.instantiateTemplate).mockResolvedValue({ id: "1", slug: "g1", name: "G1", description: null, tracker: { kind: "local", config: {} } } as never);

  render(<ProjectWorkspaceWizard />);
  await userEvent.click(screen.getByRole("button", { name: /new workspace project/i }));
  await userEvent.click(screen.getByRole("tab", { name: /start from a template/i }));
  await waitFor(() => expect(screen.getByText("Gamba")).toBeInTheDocument());
  await userEvent.click(screen.getByText("Gamba"));
  await userEvent.type(screen.getByPlaceholderText(/Project name/i), "G1");
  await userEvent.type(screen.getByPlaceholderText(/project-slug/i), "g1");
  await userEvent.click(screen.getByRole("button", { name: /create from template/i }));

  await waitFor(() => expect(templates.instantiateTemplate).toHaveBeenCalledWith("gamba", expect.objectContaining({ slug: "g1" })));
});
```

Add `vi.mock("@/services/templates");` at the top of the test file.

- [ ] **Step 17.2: Run to verify it fails**

Run: `cd tracker && npm test -- src/components/projects/__tests__/ProjectWorkspaceWizard.test.tsx`
Expected: FAIL — no template tab.

- [ ] **Step 17.3: Implement the tab**

In `ProjectWorkspaceWizard.tsx`:

1. Add a tab toggle at the top: `[ Start from a template ] [ Build from scratch ]` (use shadcn `Tabs` if present, else two buttons with `role="tab"`).
2. On the template tab: load `listTemplates()`; render selectable cards; on selection store `selectedTemplate`; require `name` + `slug`; submit calls `instantiateTemplate(selectedTemplate.slug, { name, slug, tracker: { kind: trackerKind, config: remoteConfig ?? {} } })`. If Slice B is present, the tracker step from Slice B can also apply; otherwise default `{ kind: "local", config: {} }`.
3. Default the active tab to "Start from a template" when `templates.length > 0`, else "Build from scratch".
4. Submit button label: "Create from template".

- [ ] **Step 17.4: Run to verify it passes**

Run: `cd tracker && npm test -- src/components/projects/__tests__/ProjectWorkspaceWizard.test.tsx`
Expected: PASS (adjust tab/button name regexes to your labels).

- [ ] **Step 17.5: Commit**

```bash
git add tracker/src/components/projects/ProjectWorkspaceWizard.tsx tracker/src/components/projects/__tests__/ProjectWorkspaceWizard.test.tsx
git commit -m "feat(tracker): wizard start-from-template tab"
```

---

## Task 18 — Frontend full gate + PR

- [ ] **Step 18.1: Run gates**

Run: `cd tracker && npm test`
Run: `cd tracker && npm run build`
Expected: green.

- [ ] **Step 18.2: Backend gate (sanity, after any shared edits)**

Run: `cd elixir && mise exec -- mix all`
Expected: green.

- [ ] **Step 18.3: Push + PR**

```bash
git push -u origin feat/workspace-templates
gh pr create --title "Slice C: workspace templates" --body "$(cat <<'EOF'
## Summary
- Add WorkspaceTemplate (+ repos) and CloneJob schemas + Templates context.
- Save-as-template, CRUD, YAML import/export, and template instantiation.
- Async per-repo clone workers under a DynamicSupervisor, broadcasting clone_* events over the existing project channel.
- Built-in templates seeded on boot.
- Frontend: templates service, list/edit pages, save-as dialog, clone progress bar, wizard "Start from a template" tab.

## Notes
- Reuses the existing `project:<slug>` channel for clone progress (no new socket).
- Tracker-aware instantiation depends on Slice B's `tracker` payload; degrades to local if Slice B is absent.

## Test plan
- [ ] `cd elixir && mise exec -- mix all`
- [ ] `cd tracker && npm test`
- [ ] Manual: save a project as template, instantiate it, watch clones progress, export/import YAML.
EOF
)"
```

---

## Self-Review

**Spec coverage (spec §2 goals → task):**

1. Template entity → Task 1, 2, 3.
2. Save as template → Task 5 + controller Task 10 + dialog Task 15.
3. Manual edit → Task 16 (`TemplateForm`/`TemplateEditPage`) + `updateTemplate` service.
4. Import/export YAML → Task 6 + endpoints Task 10 + service/import button Task 13/16.
5. Wizard "Start from a template" → Task 17.
6. Async clone jobs + progress via channel → Task 7 (workers/supervisor/broadcast) + Task 8 (enqueue) + Task 14/15 (UI).
7. Slice B-aware (skip statuses for remote) → Task 8 (`maybe_statuses`).

**Spec §6 backend → task:** migration (T1), schemas (T2/T3), substitution (T4), context CRUD/save-as (T5), YAML (T6), clone lifecycle (T7), instantiate (T8), presenter (T9), routes/controllers (T10), built-ins (T11).

**Spec §7 frontend → task:** service (T13), clone hook (T14), progress bar + save-as (T15), list/edit pages + sidebar (T16), wizard tab (T17).

**Placeholder scan:** Task 16's `TemplateForm`/pages are described compositionally rather than with full code because they are straightforward shadcn forms over already-tested service methods; the one behavioral piece (`TemplateList`) has a test + full code. `updateTemplate` is called out as "add to the service mirroring `createTemplate`" — add it when implementing T16 (signature: `updateTemplate(slug, input): Promise<WorkspaceTemplate>` → `http.patch(trackerPath('/templates/'+slug), input)`). No silent TODOs in backend steps.

**Type consistency:** `WorkspaceTemplate`/`CloneJob` TS types (T13) match presenter output (T9). `CloneEvent` event names (T14) match `Broadcaster.clone_event/3` allowed names (T7). `instantiate_template/2` tracker payload (T8) matches Slice B's `create_workspace_project/1` contract.

**YAML emitter caveat:** Task 6 ships a minimal emitter because `YamlElixir` is read-only. If the round-trip test is brittle, the documented fallback is adding `:ymlr` and using `Ymlr.document!/1`. Either satisfies the Step 6.1 contract — pick one and delete the other path.
