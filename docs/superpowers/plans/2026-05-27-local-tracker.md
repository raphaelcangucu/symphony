# Local Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Linear-like tracker for Symphony using React + shadcn, Phoenix APIs/Channels, SQLite persistence, and a `LocalTracker` adapter that can feed the Symphony orchestrator.

**Architecture:** `tracker/` is a root-level React + TypeScript + Vite SPA. Phoenix remains the local backend, serving JSON APIs, Phoenix Channels, terminal sockets, and the production SPA build. Ecto + SQLite is the source of truth shared by the React UI and `SymphonyElixir.LocalTracker.Tracker`.

**Tech Stack:** Elixir, Phoenix, Ecto, SQLite, React, TypeScript, Vite, shadcn, Tailwind, `@dnd-kit`, Phoenix Channels, `xterm.js`, tmux.

---

## File Map

### Elixir Backend

- Modify `elixir/mix.exs`: add Ecto/SQLite deps and repo config support.
- Modify `elixir/config/config.exs`: configure `SymphonyElixir.Repo`.
- Modify `elixir/lib/symphony_elixir.ex`: start `Repo` and terminal/session services.
- Create `elixir/lib/symphony_elixir/repo.ex`: Ecto repo.
- Create `elixir/priv/repo/migrations/*.exs`: SQLite tables and indexes.
- Create `elixir/lib/symphony_elixir/local_tracker/*.ex`: schemas, context, mapper, seeds, config, tracker adapter, broadcaster.
- Modify `elixir/lib/symphony_elixir/config.ex`: detect top-level `local:` config and expose local settings through existing config patterns.
- Modify `elixir/lib/symphony_elixir/tracker.ex`: route `Config.tracker_kind() == "local"` to the local adapter.
- Modify `elixir/lib/symphony_elixir_web/endpoint.ex`: add Channels socket.
- Modify `elixir/lib/symphony_elixir_web/router.ex`: add `/api/tracker/v1/*` API routes and SPA fallback routes.
- Create `elixir/lib/symphony_elixir_web/plugs/tracker_auth.ex`: token auth for tracker API and socket params.
- Create `elixir/lib/symphony_elixir_web/controllers/tracker/*.ex`: project, issue, status, comments, labels, blockers, terminal endpoints.
- Create `elixir/lib/symphony_elixir_web/channels/*.ex`: tracker and terminal Channels.
- Create `elixir/lib/symphony_elixir/terminal/*.ex`: tmux wrapper and issue session registry.
- Modify `elixir/README.md` and `elixir/WORKFLOW.md`: document local tracker config and run flow.

### React Frontend

- Create `tracker/`: root-level React + TypeScript + Vite app.
- Create `tracker/components.json`: shadcn config with `tsx: true`.
- Create `tracker/src/types/*.ts`: DTOs for projects, workflow statuses, issues, comments, labels, blockers, activity, terminal, realtime events.
- Create `tracker/src/services/*.ts`: typed API clients.
- Create `tracker/src/services/phoenix/*.ts`: Phoenix socket and project channel wrappers.
- Create `tracker/src/components/layout/*.tsx`: Linear-like shell.
- Create `tracker/src/components/board/*.tsx`: kanban board using `@dnd-kit`.
- Create `tracker/src/components/list/*.tsx`: issue list/backlog view.
- Create `tracker/src/components/issues/*.tsx`: issue drawer, create/edit forms, tabs.
- Create `tracker/src/components/terminal/*.tsx`: xterm terminal.
- Create `tracker/src/pages/*.tsx`: token gate, board page, list page.
- Create `tracker/src/**/*.test.ts(x)`: board reducer, API, channel, and terminal tests.

---

## Task 1: Add Ecto + SQLite Foundation

**Files:**

- Modify: `elixir/mix.exs`
- Modify: `elixir/config/config.exs`
- Modify: `elixir/lib/symphony_elixir.ex`
- Create: `elixir/lib/symphony_elixir/repo.ex`
- Create: `elixir/test/symphony_elixir/local_tracker/repo_test.exs`

- [ ] **Step 1: Add a failing repo smoke test**

```elixir
defmodule SymphonyElixir.LocalTracker.RepoTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Repo

  test "repo can run a SQLite query" do
    assert %{rows: [[1]]} = Repo.query!("select 1")
  end
end
```

- [ ] **Step 2: Run the failing test**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/repo_test.exs`

Expected: failure because `SymphonyElixir.Repo` is not defined.

- [ ] **Step 3: Add dependencies**

Add to `deps/0` in `elixir/mix.exs`:

```elixir
{:ecto_sql, "~> 3.13"},
{:ecto_sqlite3, "~> 0.20"}
```

- [ ] **Step 4: Define the repo**

Create `elixir/lib/symphony_elixir/repo.ex`:

```elixir
defmodule SymphonyElixir.Repo do
  @moduledoc """
  SQLite repository used by Symphony's local tracker.
  """

  use Ecto.Repo,
    otp_app: :symphony_elixir,
    adapter: Ecto.Adapters.SQLite3
end
```

- [ ] **Step 5: Configure SQLite**

Add to `elixir/config/config.exs`:

```elixir
config :symphony_elixir, SymphonyElixir.Repo,
  database: Path.expand("../tmp/test-tracker.sqlite3", __DIR__),
  pool_size: 5,
  stacktrace: Mix.env() in [:dev, :test],
  show_sensitive_data_on_connection_error: Mix.env() in [:dev, :test]
```

- [ ] **Step 6: Start the repo**

Add `SymphonyElixir.Repo` to the application children in `elixir/lib/symphony_elixir.ex`, before processes that may use tracker data.

```elixir
children = [
  {Phoenix.PubSub, name: SymphonyElixir.PubSub},
  SymphonyElixir.Repo,
  # existing children...
]
```

- [ ] **Step 7: Verify**

Run: `cd elixir && mix deps.get && mix test test/symphony_elixir/local_tracker/repo_test.exs`

Expected: test passes.

---

## Task 2: Create Local Tracker Schema Migrations

**Files:**

- Create: `elixir/priv/repo/migrations/20260527000100_create_local_tracker_projects.exs`
- Create: `elixir/priv/repo/migrations/20260527000200_create_local_tracker_statuses.exs`
- Create: `elixir/priv/repo/migrations/20260527000300_create_local_tracker_issues.exs`
- Create: `elixir/priv/repo/migrations/20260527000400_create_local_tracker_comments_labels_relations_events.exs`
- Create: `elixir/test/symphony_elixir/local_tracker/migrations_test.exs`

- [ ] **Step 1: Write migration structure tests**

```elixir
defmodule SymphonyElixir.LocalTracker.MigrationsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Repo

  test "local tracker tables and indexes exist" do
    table_names =
      Repo.query!("select name from sqlite_master where type = 'table'")
      |> Map.fetch!(:rows)
      |> List.flatten()

    assert "local_tracker_projects" in table_names
    assert "local_tracker_workflow_statuses" in table_names
    assert "local_tracker_issues" in table_names
    assert "local_tracker_comments" in table_names
    assert "local_tracker_labels" in table_names
    assert "local_tracker_issue_labels" in table_names
    assert "local_tracker_issue_relations" in table_names
    assert "local_tracker_activity_events" in table_names
  end
end
```

- [ ] **Step 2: Run the failing test**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/migrations_test.exs`

Expected: failure because tables do not exist.

- [ ] **Step 3: Create project migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateLocalTrackerProjects do
  use Ecto.Migration

  def change do
    create table(:local_tracker_projects) do
      add :name, :string, null: false
      add :slug, :string, null: false
      add :description, :text

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:local_tracker_projects, [:slug])
  end
end
```

- [ ] **Step 4: Create workflow status migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateLocalTrackerStatuses do
  use Ecto.Migration

  def change do
    create table(:local_tracker_workflow_statuses) do
      add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
      add :name, :string, null: false
      add :category, :string, null: false, default: "active"
      add :position, :integer, null: false
      add :is_terminal, :boolean, null: false, default: false

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:local_tracker_workflow_statuses, [:project_id, :name])
    create index(:local_tracker_workflow_statuses, [:project_id, :position])
  end
end
```

- [ ] **Step 5: Create issue migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateLocalTrackerIssues do
  use Ecto.Migration

  def change do
    create table(:local_tracker_issues) do
      add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
      add :status_id, references(:local_tracker_workflow_statuses, on_delete: :restrict), null: false
      add :identifier, :string, null: false
      add :title, :string, null: false
      add :description, :text
      add :priority, :integer
      add :position, :integer, null: false, default: 0
      add :assignee_id, :string
      add :worker_id, :string
      add :branch_name, :string
      add :url, :string
      add :started_at, :utc_datetime_usec
      add :completed_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:local_tracker_issues, [:project_id, :identifier])
    create index(:local_tracker_issues, [:project_id, :status_id, :position])
    create index(:local_tracker_issues, [:updated_at])
  end
end
```

- [ ] **Step 6: Create comments, labels, blockers, and events migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateLocalTrackerCommentsLabelsRelationsEvents do
  use Ecto.Migration

  def change do
    create table(:local_tracker_comments) do
      add :issue_id, references(:local_tracker_issues, on_delete: :delete_all), null: false
      add :kind, :string, null: false, default: "comment"
      add :body, :text, null: false
      add :author, :string, null: false, default: "local"

      timestamps(type: :utc_datetime_usec)
    end

    create table(:local_tracker_labels) do
      add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
      add :name, :string, null: false
      add :color, :string

      timestamps(type: :utc_datetime_usec)
    end

    create table(:local_tracker_issue_labels, primary_key: false) do
      add :issue_id, references(:local_tracker_issues, on_delete: :delete_all), null: false
      add :label_id, references(:local_tracker_labels, on_delete: :delete_all), null: false
    end

    create table(:local_tracker_issue_relations) do
      add :source_issue_id, references(:local_tracker_issues, on_delete: :delete_all), null: false
      add :target_issue_id, references(:local_tracker_issues, on_delete: :delete_all), null: false
      add :type, :string, null: false

      timestamps(updated_at: false, type: :utc_datetime_usec)
    end

    create table(:local_tracker_activity_events) do
      add :issue_id, references(:local_tracker_issues, on_delete: :delete_all), null: false
      add :event_type, :string, null: false
      add :metadata, :map, null: false, default: %{}

      timestamps(updated_at: false, type: :utc_datetime_usec)
    end

    create index(:local_tracker_comments, [:issue_id, :inserted_at])
    create unique_index(:local_tracker_labels, [:project_id, :name])
    create unique_index(:local_tracker_issue_labels, [:issue_id, :label_id])
    create unique_index(:local_tracker_issue_relations, [:source_issue_id, :target_issue_id, :type])
    create index(:local_tracker_activity_events, [:issue_id, :inserted_at])
  end
end
```

- [ ] **Step 7: Verify migrations**

Run: `cd elixir && mix ecto.create && mix ecto.migrate && mix test test/symphony_elixir/local_tracker/migrations_test.exs`

Expected: tests pass.

---

## Task 3: Add Schemas, Changesets, and Seeds

**Files:**

- Create: `elixir/lib/symphony_elixir/local_tracker/project.ex`
- Create: `elixir/lib/symphony_elixir/local_tracker/workflow_status.ex`
- Create: `elixir/lib/symphony_elixir/local_tracker/issue_record.ex`
- Create: `elixir/lib/symphony_elixir/local_tracker/comment.ex`
- Create: `elixir/lib/symphony_elixir/local_tracker/label.ex`
- Create: `elixir/lib/symphony_elixir/local_tracker/issue_label.ex`
- Create: `elixir/lib/symphony_elixir/local_tracker/issue_relation.ex`
- Create: `elixir/lib/symphony_elixir/local_tracker/activity_event.ex`
- Create: `elixir/lib/symphony_elixir/local_tracker/seeds.ex`
- Create: `elixir/test/symphony_elixir/local_tracker/schemas_test.exs`

- [ ] **Step 1: Write schema validation tests**

```elixir
defmodule SymphonyElixir.LocalTracker.SchemasTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.{IssueRecord, Project, WorkflowStatus}

  test "project requires name and slug" do
    changeset = Project.changeset(%Project{}, %{})
    refute changeset.valid?
    assert {"can't be blank", _} = changeset.errors[:name]
    assert {"can't be blank", _} = changeset.errors[:slug]
  end

  test "workflow status requires project, name, category, and position" do
    changeset = WorkflowStatus.changeset(%WorkflowStatus{}, %{})
    refute changeset.valid?
    assert {"can't be blank", _} = changeset.errors[:project_id]
    assert {"can't be blank", _} = changeset.errors[:name]
    assert {"can't be blank", _} = changeset.errors[:category]
    assert {"can't be blank", _} = changeset.errors[:position]
  end

  test "issue requires project, status, identifier, title, and position" do
    changeset = IssueRecord.changeset(%IssueRecord{}, %{})
    refute changeset.valid?
    assert {"can't be blank", _} = changeset.errors[:project_id]
    assert {"can't be blank", _} = changeset.errors[:status_id]
    assert {"can't be blank", _} = changeset.errors[:identifier]
    assert {"can't be blank", _} = changeset.errors[:title]
    assert {"can't be blank", _} = changeset.errors[:position]
  end
end
```

- [ ] **Step 2: Implement focused schemas**

Use `IssueRecord` to avoid colliding with `%SymphonyElixir.Issue{}`.

```elixir
defmodule SymphonyElixir.LocalTracker.IssueRecord do
  @moduledoc "Persistent issue record for the local tracker."

  use Ecto.Schema
  import Ecto.Changeset

  @type t :: %__MODULE__{}

  schema "local_tracker_issues" do
    field :identifier, :string
    field :title, :string
    field :description, :string
    field :priority, :integer
    field :position, :integer, default: 0
    field :assignee_id, :string
    field :worker_id, :string
    field :branch_name, :string
    field :url, :string
    field :started_at, :utc_datetime_usec
    field :completed_at, :utc_datetime_usec

    belongs_to :project, SymphonyElixir.LocalTracker.Project
    belongs_to :status, SymphonyElixir.LocalTracker.WorkflowStatus

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(issue, attrs) do
    issue
    |> cast(attrs, [
      :project_id,
      :status_id,
      :identifier,
      :title,
      :description,
      :priority,
      :position,
      :assignee_id,
      :worker_id,
      :branch_name,
      :url,
      :started_at,
      :completed_at
    ])
    |> validate_required([:project_id, :status_id, :identifier, :title, :position])
    |> validate_number(:priority, greater_than_or_equal_to: 0, less_than_or_equal_to: 4)
  end
end
```

- [ ] **Step 3: Add default workflow seed list**

Create `elixir/lib/symphony_elixir/local_tracker/seeds.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.Seeds do
  @moduledoc "Default local tracker seed data."

  @default_statuses [
    {"Backlog", "backlog", false},
    {"Todo", "active", false},
    {"In Progress", "active", false},
    {"Human Review", "wait", false},
    {"Merging", "active", false},
    {"Rework", "active", false},
    {"Done", "terminal", true}
  ]

  @spec default_statuses() :: [{String.t(), String.t(), boolean()}]
  def default_statuses, do: @default_statuses
end
```

- [ ] **Step 4: Verify**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/schemas_test.exs`

Expected: tests pass.

---

## Task 4: Implement Local Tracker Context

**Files:**

- Create: `elixir/lib/symphony_elixir/local_tracker/context.ex`
- Create: `elixir/test/symphony_elixir/local_tracker/context_test.exs`

- [ ] **Step 1: Write context tests for project bootstrap and issue creation**

```elixir
defmodule SymphonyElixir.LocalTracker.ContextTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context

  test "ensure_project creates project with default statuses" do
    assert {:ok, project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    assert project.slug == "macro-markets"

    statuses = Context.list_statuses(project.slug)
    assert Enum.map(statuses, & &1.name) == ["Backlog", "Todo", "In Progress", "Human Review", "Merging", "Rework", "Done"]
  end

  test "create_issue creates the next identifier and stores the issue in the requested status" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    assert {:ok, issue} =
             Context.create_issue("macro-markets", %{
               "title" => "Build local tracker",
               "description" => "Create local project manager",
               "status" => "Todo",
               "priority" => 1
             })

    assert issue.identifier == "MAC-1"
    assert issue.title == "Build local tracker"
  end
end
```

- [ ] **Step 2: Implement context boundary**

Create public functions with `@spec`:

```elixir
@spec ensure_project(map()) :: {:ok, Project.t()} | {:error, Ecto.Changeset.t()}
@spec list_projects() :: [Project.t()]
@spec list_statuses(String.t()) :: [WorkflowStatus.t()]
@spec create_issue(String.t(), map()) :: {:ok, IssueRecord.t()} | {:error, Ecto.Changeset.t() | :project_not_found | :status_not_found}
@spec move_issue(String.t(), String.t(), map()) :: {:ok, IssueRecord.t()} | {:error, term()}
@spec add_comment(String.t(), String.t(), map()) :: {:ok, Comment.t()} | {:error, term()}
@spec add_blocker(String.t(), String.t(), String.t()) :: {:ok, IssueRelation.t()} | {:error, term()}
```

- [ ] **Step 3: Enforce explicit errors**

Return atoms for missing entities:

```elixir
{:error, :project_not_found}
{:error, :issue_not_found}
{:error, :status_not_found}
{:error, :blocker_not_found}
```

- [ ] **Step 4: Verify**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_test.exs`

Expected: tests pass.

---

## Task 5: Map DB Issues to `%SymphonyElixir.Issue{}`

**Files:**

- Create: `elixir/lib/symphony_elixir/local_tracker/issue_mapper.ex`
- Create: `elixir/test/symphony_elixir/local_tracker/issue_mapper_test.exs`

- [ ] **Step 1: Write mapper tests**

```elixir
defmodule SymphonyElixir.LocalTracker.IssueMapperTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.IssueMapper

  test "maps persistent issue into orchestrator issue shape" do
    record = %{
      id: 123,
      identifier: "MAC-1",
      title: "Build local tracker",
      description: "Local tracker work",
      priority: 1,
      branch_name: "mac-1-local-tracker",
      url: "http://localhost:4000/tracker/projects/macro-markets/issues/MAC-1",
      assignee_id: nil,
      inserted_at: ~U[2026-05-27 00:00:00Z],
      updated_at: ~U[2026-05-27 00:01:00Z],
      status: %{name: "Todo"},
      labels: [%{name: "codex"}],
      blockers: [%{id: 456, identifier: "MAC-0", status: %{name: "Done"}}],
      comments: [%{kind: "workpad", body: "## Workpad", author: "local"}]
    }

    assert %Issue{} = issue = IssueMapper.to_issue(record)
    assert issue.id == "123"
    assert issue.identifier == "MAC-1"
    assert issue.state == "Todo"
    assert issue.labels == ["codex"]
    assert issue.blocked_by == [%{id: "456", identifier: "MAC-0", state: "Done"}]
  end
end
```

- [ ] **Step 2: Implement the mapper**

```elixir
defmodule SymphonyElixir.LocalTracker.IssueMapper do
  @moduledoc "Maps local tracker records into the tracker-agnostic issue struct."

  alias SymphonyElixir.Issue

  @spec to_issue(map()) :: Issue.t()
  def to_issue(record) when is_map(record) do
    %Issue{
      id: to_string(record.id),
      identifier: record.identifier,
      title: record.title,
      description: record.description,
      priority: record.priority,
      state: record.status.name,
      branch_name: record.branch_name,
      url: record.url,
      assignee_id: record.assignee_id,
      labels: Enum.map(record.labels || [], & &1.name),
      comments: Enum.map(record.comments || [], &comment_to_map/1),
      blocked_by: Enum.map(record.blockers || [], &blocker_to_map/1),
      assigned_to_worker: true,
      created_at: record.inserted_at,
      updated_at: record.updated_at
    }
  end

  defp comment_to_map(comment), do: %{kind: comment.kind, body: comment.body, author: comment.author}
  defp blocker_to_map(blocker), do: %{id: to_string(blocker.id), identifier: blocker.identifier, state: blocker.status.name}
end
```

- [ ] **Step 3: Verify**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/issue_mapper_test.exs`

Expected: tests pass.

---

## Task 6: Implement `LocalTracker.Tracker` and Config Routing

**Files:**

- Create: `elixir/lib/symphony_elixir/local_tracker/config.ex`
- Create: `elixir/lib/symphony_elixir/local_tracker/tracker.ex`
- Modify: `elixir/lib/symphony_elixir/config.ex`
- Modify: `elixir/lib/symphony_elixir/tracker.ex`
- Create: `elixir/test/symphony_elixir/local_tracker/tracker_test.exs`
- Modify: `elixir/test/support/test_support.exs`

- [ ] **Step 1: Write tracker adapter tests**

```elixir
defmodule SymphonyElixir.LocalTracker.TrackerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, Tracker}

  test "fetch_candidate_issues returns active local issues" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Ready work", "status" => "Todo"})

    assert {:ok, [issue]} = Tracker.fetch_candidate_issues()
    assert issue.identifier == "MAC-1"
    assert issue.state == "Todo"
  end
end
```

- [ ] **Step 2: Add `local:` to config detection**

In `Config`, change tracker sections to include local:

```elixir
@tracker_sections ["local", "linear", "github", "memory"]
```

Add config accessors:

```elixir
@spec local_database_path() :: String.t()
def local_database_path do
  section("local") |> Map.get("database_path", ".symphony/tracker.sqlite3")
end

@spec local_project_slug() :: String.t() | nil
def local_project_slug do
  section("local") |> Map.get("project_slug")
end

@spec local_api_token_env() :: String.t()
def local_api_token_env do
  section("local") |> Map.get("api_token_env", "SYMPHONY_TRACKER_TOKEN")
end
```

- [ ] **Step 3: Route tracker facade**

Update `SymphonyElixir.Tracker.adapter/0`:

```elixir
case Config.tracker_kind() do
  "local" -> SymphonyElixir.LocalTracker.Tracker
  "memory" -> SymphonyElixir.Memory.Tracker
  "linear" -> SymphonyElixir.Linear.Tracker
  _ -> SymphonyElixir.GitHub.Tracker
end
```

- [ ] **Step 4: Implement adapter callbacks**

`LocalTracker.Tracker` must implement every callback from `SymphonyElixir.Tracker`:

```elixir
@behaviour SymphonyElixir.Tracker

@impl true
def fetch_candidate_issues do
  Context.fetch_issues_by_states(Config.local_project_slug(), Config.active_states())
end

@impl true
def update_issue_state(issue_id, state_name) do
  Context.update_issue_state(issue_id, state_name)
end
```

- [ ] **Step 5: Verify**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/tracker_test.exs`

Expected: tests pass.

---

## Task 7: Add Orchestrator Integration Tests

**Files:**

- Create: `elixir/test/symphony_elixir/local_tracker/orchestrator_integration_test.exs`

- [ ] **Step 1: Test blockers prevent local dispatch**

```elixir
defmodule SymphonyElixir.LocalTracker.OrchestratorIntegrationTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Orchestrator

  test "local issue blocked by non-terminal issue is not dispatchable" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, blocker} = Context.create_issue("macro-markets", %{"title" => "Blocking work", "status" => "Todo"})
    {:ok, blocked} = Context.create_issue("macro-markets", %{"title" => "Blocked work", "status" => "Todo"})
    {:ok, _relation} = Context.add_blocker(blocked.identifier, blocker.identifier, "blocked_by")

    {:ok, [issue]} = SymphonyElixir.LocalTracker.Tracker.fetch_candidate_issues()

    refute Orchestrator.should_dispatch_issue_for_test(issue)
  end
end
```

- [ ] **Step 2: Test terminal blocker allows dispatch**

Add a second test moving `blocker` to `Done` and asserting the blocked issue becomes dispatchable.

- [ ] **Step 3: Verify**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/orchestrator_integration_test.exs`

Expected: tests pass.

---

## Task 8: Add Tracker JSON API and Token Auth

**Files:**

- Create: `elixir/lib/symphony_elixir_web/plugs/tracker_auth.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/project_controller.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/comment_controller.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/blocker_controller.ex`
- Create: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Create: `elixir/test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs`

- [ ] **Step 1: Write an API test**

```elixir
defmodule SymphonyElixirWeb.Tracker.IssueControllerTest do
  use ExUnit.Case, async: false
  import Phoenix.ConnTest

  @endpoint SymphonyElixirWeb.Endpoint

  test "creates issue with bearer token" do
    System.put_env("SYMPHONY_TRACKER_TOKEN", "secret")

    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> post("/api/tracker/v1/projects/macro-markets/issues", %{"title" => "API issue", "status" => "Todo"})

    assert %{"data" => %{"identifier" => "MAC-1", "title" => "API issue"}} = json_response(conn, 201)
  end
end
```

- [ ] **Step 2: Implement token plug**

```elixir
defmodule SymphonyElixirWeb.TrackerAuth do
  @moduledoc "Bearer-token authentication for the local tracker UI and API."

  import Plug.Conn
  alias Phoenix.Controller
  alias SymphonyElixir.Config

  @spec init(keyword()) :: keyword()
  def init(opts), do: opts

  @spec call(Plug.Conn.t(), keyword()) :: Plug.Conn.t()
  def call(conn, _opts) do
    expected = System.get_env(Config.local_api_token_env())
    provided = get_req_header(conn, "authorization") |> List.first()

    if expected && provided == "Bearer #{expected}" do
      conn
    else
      conn
      |> Controller.json(%{error: %{code: "unauthorized", message: "invalid tracker token"}})
      |> halt()
    end
  end
end
```

- [ ] **Step 3: Add API routes before catch-all routes**

```elixir
pipeline :tracker_api do
  plug :accepts, ["json"]
  plug SymphonyElixirWeb.TrackerAuth
end

scope "/api/tracker/v1", SymphonyElixirWeb.Tracker do
  pipe_through :tracker_api

  resources "/projects", ProjectController, only: [:index, :create, :show]
  resources "/projects/:project_slug/issues", IssueController, only: [:index, :create, :show, :update]
  post "/projects/:project_slug/issues/:identifier/move", IssueController, :move
  post "/issues/:identifier/comments", CommentController, :create
  post "/issues/:identifier/blockers", BlockerController, :create
  delete "/issues/:identifier/blockers/:blocker_identifier", BlockerController, :delete
end
```

- [ ] **Step 4: Verify**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs`

Expected: tests pass.

---

## Task 9: Add Realtime Broadcasts and Phoenix Channels

**Files:**

- Create: `elixir/lib/symphony_elixir/local_tracker/broadcaster.ex`
- Create: `elixir/lib/symphony_elixir_web/channels/user_socket.ex`
- Create: `elixir/lib/symphony_elixir_web/channels/tracker_channel.ex`
- Modify: `elixir/lib/symphony_elixir_web/endpoint.ex`
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex`
- Create: `elixir/test/symphony_elixir_web/channels/tracker_channel_test.exs`

- [ ] **Step 1: Write a channel join test**

```elixir
defmodule SymphonyElixirWeb.TrackerChannelTest do
  use ExUnit.Case, async: false
  use Phoenix.ChannelTest

  @endpoint SymphonyElixirWeb.Endpoint

  test "joins project topic with valid token" do
    System.put_env("SYMPHONY_TRACKER_TOKEN", "secret")

    assert {:ok, _, _socket} =
             socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
             |> subscribe_and_join(SymphonyElixirWeb.TrackerChannel, "project:macro-markets")
  end
end
```

- [ ] **Step 2: Mount socket**

In `endpoint.ex`:

```elixir
socket("/socket", SymphonyElixirWeb.UserSocket,
  websocket: true,
  longpoll: false
)
```

- [ ] **Step 3: Implement event broadcasting**

```elixir
defmodule SymphonyElixir.LocalTracker.Broadcaster do
  @moduledoc "Broadcasts local tracker changes to React clients."

  @pubsub SymphonyElixir.PubSub

  @spec issue_moved(String.t(), map()) :: :ok
  def issue_moved(project_slug, payload) do
    Phoenix.PubSub.broadcast(@pubsub, topic(project_slug), {:tracker_event, "issue_moved", payload})
  end

  @spec topic(String.t()) :: String.t()
  def topic(project_slug), do: "project:#{project_slug}"
end
```

- [ ] **Step 4: Broadcast from context writes**

Call broadcaster functions after successful project, issue, comment, blocker, and terminal mutations.

- [ ] **Step 5: Verify**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/tracker_channel_test.exs`

Expected: tests pass.

---

## Task 10: Scaffold `tracker/` React + TypeScript App

**Files:**

- Create: `tracker/package.json`
- Create: `tracker/vite.config.ts`
- Create: `tracker/tsconfig.json`
- Create: `tracker/components.json`
- Create: `tracker/index.html`
- Create: `tracker/src/main.tsx`
- Create: `tracker/src/App.tsx`
- Create: `tracker/src/index.css`
- Create: `tracker/src/lib/utils.ts`
- Create: `tracker/src/pages/TokenGatePage.tsx`
- Create: `tracker/src/components/layout/Layout.tsx`

- [ ] **Step 1: Create package manifest**

```json
{
  "name": "symphony-tracker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "lint": "eslint ."
  },
  "dependencies": {
    "@dnd-kit/core": "latest",
    "@dnd-kit/sortable": "latest",
    "@dnd-kit/utilities": "latest",
    "@hookform/resolvers": "latest",
    "@radix-ui/react-dialog": "latest",
    "@radix-ui/react-slot": "latest",
    "@radix-ui/react-tabs": "latest",
    "@radix-ui/react-tooltip": "latest",
    "@tailwindcss/vite": "latest",
    "@xterm/addon-fit": "latest",
    "@xterm/addon-web-links": "latest",
    "@xterm/xterm": "latest",
    "axios": "latest",
    "class-variance-authority": "latest",
    "clsx": "latest",
    "lucide-react": "latest",
    "phoenix": "latest",
    "react": "latest",
    "react-dom": "latest",
    "react-hook-form": "latest",
    "react-router-dom": "latest",
    "sonner": "latest",
    "tailwind-merge": "latest",
    "tailwindcss": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "latest",
    "@testing-library/react": "latest",
    "@types/node": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "@vitejs/plugin-react": "latest",
    "eslint": "latest",
    "jsdom": "latest",
    "typescript": "latest",
    "vite": "latest",
    "vitest": "latest"
  }
}
```

- [ ] **Step 2: Configure Vite proxy**

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4000",
      "/socket": {
        target: "ws://127.0.0.1:4000",
        ws: true,
      },
    },
  },
});
```

- [ ] **Step 3: Add minimal app shell**

```tsx
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { Layout } from "@/components/layout/Layout";
import { TokenGatePage } from "@/pages/TokenGatePage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/token" element={<TokenGatePage />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/projects" replace />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
```

- [ ] **Step 4: Verify**

Run: `cd tracker && npm install && npm run build`

Expected: build succeeds.

---

## Task 11: Add Typed Frontend API Layer

**Files:**

- Create: `tracker/src/config.ts`
- Create: `tracker/src/types/*.ts`
- Create: `tracker/src/services/http.ts`
- Create: `tracker/src/services/projects.ts`
- Create: `tracker/src/services/issues.ts`
- Create: `tracker/src/services/comments.ts`
- Create: `tracker/src/services/blockers.ts`
- Create: `tracker/src/services/index.ts`
- Create: `tracker/src/services/__tests__/issues.test.ts`

- [ ] **Step 1: Define issue types**

```ts
export type WorkflowStatusName =
  | "Backlog"
  | "Todo"
  | "In Progress"
  | "Human Review"
  | "Merging"
  | "Rework"
  | "Done";

export interface Issue {
  id: string;
  identifier: string;
  projectSlug: string;
  status: WorkflowStatusName;
  title: string;
  description: string | null;
  priority: number | null;
  position: number;
  labels: string[];
  blockedBy: Array<{ id: string; identifier: string; state: string | null }>;
  updatedAt: string;
}
```

- [ ] **Step 2: Implement HTTP client**

```ts
import axios from "axios";

export const TRACKER_TOKEN_KEY = "symphony.tracker.token";

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "",
});

http.interceptors.request.use((config) => {
  const token = window.localStorage.getItem(TRACKER_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

- [ ] **Step 3: Implement issue service**

```ts
import { http } from "./http";
import type { Issue } from "@/types/issue";

export interface MoveIssueInput {
  status: string;
  position: number;
}

export async function listIssues(projectSlug: string): Promise<Issue[]> {
  const response = await http.get(`/api/tracker/v1/projects/${projectSlug}/issues`);
  return response.data.data;
}

export async function moveIssue(projectSlug: string, identifier: string, input: MoveIssueInput): Promise<Issue> {
  const response = await http.post(`/api/tracker/v1/projects/${projectSlug}/issues/${identifier}/move`, input);
  return response.data.data;
}
```

- [ ] **Step 4: Verify**

Run: `cd tracker && npm run test -- src/services/__tests__/issues.test.ts`

Expected: tests pass.

---

## Task 12: Build List View and Issue Drawer

**Files:**

- Create: `tracker/src/pages/ProjectListPage.tsx`
- Create: `tracker/src/components/list/ListView.tsx`
- Create: `tracker/src/components/list/IssueRow.tsx`
- Create: `tracker/src/components/issues/IssueDrawer.tsx`
- Create: `tracker/src/components/issues/issue-detail/SummaryTab.tsx`
- Modify: `tracker/src/App.tsx`

- [ ] **Step 1: Add route**

```tsx
<Route path="/projects/:projectSlug/list" element={<ProjectListPage />} />
```

- [ ] **Step 2: Implement list page**

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { listIssues } from "@/services/issues";
import type { Issue } from "@/types/issue";
import { ListView } from "@/components/list/ListView";

export function ProjectListPage() {
  const { projectSlug = "" } = useParams();
  const [issues, setIssues] = useState<Issue[]>([]);

  useEffect(() => {
    void listIssues(projectSlug).then(setIssues);
  }, [projectSlug]);

  return <ListView issues={issues} />;
}
```

- [ ] **Step 3: Verify**

Run: `cd tracker && npm run build`

Expected: build succeeds.

---

## Task 13: Build Kanban Board with Optimistic Moves

**Files:**

- Create: `tracker/src/pages/ProjectBoardPage.tsx`
- Create: `tracker/src/components/board/BoardView.tsx`
- Create: `tracker/src/components/board/BoardColumn.tsx`
- Create: `tracker/src/components/board/IssueCard.tsx`
- Create: `tracker/src/components/board/board-utils.ts`
- Create: `tracker/src/components/board/__tests__/board-utils.test.ts`
- Modify: `tracker/src/App.tsx`

- [ ] **Step 1: Test board movement helper**

```ts
import { moveIssueLocally } from "../board-utils";

test("moves an issue between columns", () => {
  const board = {
    Todo: [{ identifier: "MAC-1", title: "A", status: "Todo", position: 0 }],
    "In Progress": [],
  };

  const next = moveIssueLocally(board, "MAC-1", "In Progress", 0);

  expect(next.Todo).toHaveLength(0);
  expect(next["In Progress"][0].identifier).toBe("MAC-1");
  expect(next["In Progress"][0].status).toBe("In Progress");
});
```

- [ ] **Step 2: Implement utility**

```ts
import type { Issue } from "@/types/issue";

export type BoardState = Record<string, Issue[]>;

export function moveIssueLocally(board: BoardState, identifier: string, targetStatus: string, targetIndex: number): BoardState {
  const sourceStatus = Object.keys(board).find((status) => board[status].some((issue) => issue.identifier === identifier));
  if (!sourceStatus) return board;

  const moving = board[sourceStatus].find((issue) => issue.identifier === identifier);
  if (!moving) return board;

  const withoutMoving = {
    ...board,
    [sourceStatus]: board[sourceStatus].filter((issue) => issue.identifier !== identifier),
  };

  const targetIssues = [...(withoutMoving[targetStatus] ?? [])];
  targetIssues.splice(targetIndex, 0, { ...moving, status: targetStatus as Issue["status"], position: targetIndex });

  return {
    ...withoutMoving,
    [targetStatus]: targetIssues.map((issue, position) => ({ ...issue, position })),
  };
}
```

- [ ] **Step 3: Wire `@dnd-kit`**

Use `DndContext`, `useDroppable`, `useSortable`, `SortableContext`, and `DragOverlay` following `../seomachine/admin/src/pages/TasksBoard.jsx`.

- [ ] **Step 4: Verify**

Run: `cd tracker && npm run test -- src/components/board/__tests__/board-utils.test.ts && npm run build`

Expected: tests and build pass.

---

## Task 14: Add Issue CRUD, Comments, Blockers, and Activity Tabs

**Files:**

- Create: `tracker/src/components/issues/IssueCreateDialog.tsx`
- Create: `tracker/src/components/issues/issue-detail/CommentsTab.tsx`
- Create: `tracker/src/components/issues/issue-detail/BlockersTab.tsx`
- Create: `tracker/src/components/issues/issue-detail/ActivityTab.tsx`
- Create: `tracker/src/components/issues/issue-detail/AgentTab.tsx`
- Modify: `tracker/src/components/issues/IssueDrawer.tsx`
- Modify: `tracker/src/services/comments.ts`
- Modify: `tracker/src/services/blockers.ts`

- [ ] **Step 1: Implement issue form schema**

```ts
import { z } from "zod";

export const issueFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().optional(),
  status: z.string().trim().min(1, "Status is required"),
  priority: z.coerce.number().int().min(0).max(4).optional(),
});

export type IssueFormValues = z.infer<typeof issueFormSchema>;
```

- [ ] **Step 2: Add tabs to drawer**

Tabs:

- `summary`
- `comments`
- `blockers`
- `agent`
- `activity`
- `terminal`

- [ ] **Step 3: Verify**

Run: `cd tracker && npm run build`

Expected: build succeeds.

---

## Task 15: Connect React to Phoenix Channels

**Files:**

- Create: `tracker/src/services/phoenix/socket.ts`
- Create: `tracker/src/services/phoenix/channels.ts`
- Create: `tracker/src/hooks/useProjectChannel.ts`
- Create: `tracker/src/hooks/__tests__/project-channel-events.test.ts`
- Modify: `tracker/src/pages/ProjectBoardPage.tsx`
- Modify: `tracker/src/pages/ProjectListPage.tsx`
- Modify: `tracker/src/components/issues/IssueDrawer.tsx`

- [ ] **Step 1: Implement socket factory**

```ts
import { Socket } from "phoenix";
import { TRACKER_TOKEN_KEY } from "@/services/http";

export function createTrackerSocket() {
  const token = window.localStorage.getItem(TRACKER_TOKEN_KEY);
  return new Socket("/socket", { params: { token } });
}
```

- [ ] **Step 2: Implement channel hook**

```ts
import { useEffect } from "react";
import { createTrackerSocket } from "@/services/phoenix/socket";

export function useProjectChannel(projectSlug: string, onEvent: (event: string, payload: unknown) => void) {
  useEffect(() => {
    if (!projectSlug) return;

    const socket = createTrackerSocket();
    socket.connect();
    const channel = socket.channel(`project:${projectSlug}`);

    channel.on("issue_moved", (payload) => onEvent("issue_moved", payload));
    channel.on("issue_updated", (payload) => onEvent("issue_updated", payload));
    channel.on("comment_created", (payload) => onEvent("comment_created", payload));
    channel.join();

    return () => {
      channel.leave();
      socket.disconnect();
    };
  }, [projectSlug, onEvent]);
}
```

- [ ] **Step 3: Verify**

Run: `cd tracker && npm run test -- src/hooks/__tests__/project-channel-events.test.ts && npm run build`

Expected: tests and build pass.

---

## Task 16: Add Tmux Terminal Backend

**Files:**

- Create: `elixir/lib/symphony_elixir/terminal/tmux.ex`
- Create: `elixir/lib/symphony_elixir/terminal/registry.ex`
- Create: `elixir/lib/symphony_elixir_web/channels/terminal_channel.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/terminal_controller.ex`
- Create: `elixir/test/symphony_elixir/terminal/registry_test.exs`

- [ ] **Step 1: Test registry creates stable issue sessions**

```elixir
defmodule SymphonyElixir.Terminal.RegistryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Terminal.Registry

  test "session name is stable for issue identifier" do
    assert Registry.session_name("MAC-1") == "sym-issue-MAC-1"
  end
end
```

- [ ] **Step 2: Implement tmux wrapper**

```elixir
defmodule SymphonyElixir.Terminal.Tmux do
  @moduledoc "Small tmux command wrapper for issue terminal sessions."

  @spec available?() :: boolean()
  def available? do
    match?({_output, 0}, System.cmd("tmux", ["-V"], stderr_to_stdout: true))
  rescue
    ErlangError -> false
  end

  @spec new_session(String.t(), String.t()) :: :ok | {:error, String.t()}
  def new_session(session_name, cwd) do
    case System.cmd("tmux", ["new-session", "-d", "-s", session_name, "-c", cwd], stderr_to_stdout: true) do
      {_output, 0} -> :ok
      {output, _status} -> {:error, output}
    end
  end
end
```

- [ ] **Step 3: Implement Channel protocol**

Browser sends:

```json
{"type":"input","data":"ls\n"}
{"type":"resize","cols":120,"rows":40}
```

Server sends terminal bytes as binary frames or JSON data events, matching the chosen xterm client implementation.

- [ ] **Step 4: Verify**

Run: `cd elixir && mix test test/symphony_elixir/terminal/registry_test.exs`

Expected: tests pass.

---

## Task 17: Add xterm Terminal Frontend

**Files:**

- Create: `tracker/src/services/terminal.ts`
- Create: `tracker/src/components/terminal/IssueTerminal.tsx`
- Create: `tracker/src/components/terminal/TerminalPanel.tsx`
- Modify: `tracker/src/components/issues/issue-detail/TerminalTab.tsx`
- Create: `tracker/src/components/terminal/__tests__/IssueTerminal.test.tsx`

- [ ] **Step 1: Add terminal URL helper**

```ts
export function terminalSocketPath(issueIdentifier: string): string {
  return `/socket/terminal?issue=${encodeURIComponent(issueIdentifier)}`;
}
```

- [ ] **Step 2: Implement terminal component**

Use `@xterm/xterm`, `@xterm/addon-fit`, and the protocol from Task 16.

```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export function IssueTerminal({ issueIdentifier }: { issueIdentifier: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({ cursorBlink: true });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();

    return () => {
      terminal.dispose();
    };
  }, [issueIdentifier]);

  return <div className="h-full min-h-[420px] rounded-md border bg-black" ref={containerRef} />;
}
```

- [ ] **Step 3: Verify**

Run: `cd tracker && npm run build`

Expected: build succeeds.

---

## Task 18: Serve the React Build from Phoenix

**Files:**

- Modify: `elixir/lib/symphony_elixir_web/static_assets.ex`
- Modify: `elixir/lib/symphony_elixir_web/controllers/static_asset_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Modify: `tracker/vite.config.ts`
- Create: `elixir/test/symphony_elixir_web/tracker_static_test.exs`

- [ ] **Step 1: Configure Vite output**

Set build output to `../elixir/priv/static/tracker`:

```ts
build: {
  outDir: "../elixir/priv/static/tracker",
  emptyOutDir: true,
}
```

- [ ] **Step 2: Add Phoenix route**

Add routes before catch-all API 404:

```elixir
get("/tracker", StaticAssetController, :tracker_index)
get("/tracker/*path", StaticAssetController, :tracker_asset_or_index)
```

- [ ] **Step 3: Verify**

Run: `cd tracker && npm run build`

Run: `cd elixir && mix test test/symphony_elixir_web/tracker_static_test.exs`

Expected: build succeeds and Phoenix serves tracker index.

---

## Task 19: Update Documentation and Example Workflow

**Files:**

- Modify: `elixir/README.md`
- Modify: `elixir/WORKFLOW.md`
- Modify: `elixir/WORKFLOW.macromarkets.example.md`

- [ ] **Step 1: Add local tracker config example**

```yaml
local:
  database_path: .symphony/tracker.sqlite3
  project_slug: macro-markets
  api_token_env: SYMPHONY_TRACKER_TOKEN

tracker:
  active_states:
    - Todo
    - Rework
  terminal_states:
    - Done
    - Closed
```

- [ ] **Step 2: Document dev workflow**

Add commands:

```bash
cd elixir && mix ecto.create && mix ecto.migrate
cd tracker && npm install && npm run dev
cd elixir && mix run --no-halt -- --port 4000
```

- [ ] **Step 3: Verify docs mention token**

Document:

```bash
export SYMPHONY_TRACKER_TOKEN="$(openssl rand -hex 24)"
```

---

## Task 20: Full Verification

**Files:**

- No new files.

- [ ] **Step 1: Backend targeted tests**

Run:

```bash
cd elixir && mix test test/symphony_elixir/local_tracker test/symphony_elixir_web/controllers/tracker test/symphony_elixir_web/channels
```

Expected: all targeted local tracker backend tests pass.

- [ ] **Step 2: Frontend checks**

Run:

```bash
cd tracker && npm run test && npm run build
```

Expected: tests and production build pass.

- [ ] **Step 3: Repo quality gate**

Run:

```bash
cd elixir && make all
```

Expected: format, lint, coverage, and dialyzer pass.

- [ ] **Step 4: Manual smoke test**

Run Phoenix and Vite dev servers, then verify:

1. Open `/tracker`.
2. Enter local token.
3. Create project.
4. Create issue.
5. Move issue from `Todo` to `In Progress`.
6. Add blocker and verify dispatch is blocked.
7. Move blocker to `Done` and verify dispatch is allowed.
8. Open issue terminal.

---

## Self-Review

- Spec coverage: persistence, React UI, Phoenix API, Channels, local tracker adapter, blockers, comments/workpad, tmux terminal, local token, and docs are covered.
- Out of scope preserved: remote sync, cycles, automations, analytics, full auth, shared package extraction.
- Type consistency: backend uses `IssueRecord` for persisted issues and `%SymphonyElixir.Issue{}` only for orchestrator DTOs; frontend uses `Issue` DTO.
- Config correction: implementation uses top-level `local:` to match existing tracker detection, while preserving the spec's intent.
