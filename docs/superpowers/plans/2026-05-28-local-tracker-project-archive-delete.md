# Local Tracker Project Archive And Delete Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **inline execution** in this conversation because the change spans a small backend/frontend surface. Do not create a git commit unless the user explicitly asks for one.

**Goal:** Add archive, restore, and permanent delete actions for local tracker projects on `/tracker/projects`.

**Architecture:** Store project archival state as `archived_at` on `local_tracker_projects`. Backend list endpoints hide archived projects by default and expose lifecycle routes. Frontend project cards call those routes, keep UI state in sync, and require confirmation before permanent deletion.

**Tech Stack:** Elixir, Ecto, Phoenix JSON API, SQLite, React, TypeScript, Vitest, shadcn-style UI components.

---

## File Map

- Create: `elixir/priv/repo/migrations/20260528004500_add_archived_at_to_local_tracker_projects.exs`
  - Adds nullable `archived_at` and an index for list filtering.
- Modify: `elixir/lib/symphony_elixir/local_tracker/project.ex`
  - Adds `archived_at` field and allows lifecycle changes.
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex`
  - Adds list filtering, archive, restore, and guarded delete functions.
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/project_controller.ex`
  - Adds `archive/2`, `restore/2`, and `delete/2` actions.
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
  - Adds lifecycle routes.
- Modify: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`
  - Adds `archived_at` to project DTO.
- Modify: `elixir/test/symphony_elixir/local_tracker/context_test.exs`
  - Adds archive/restore/delete persistence tests.
- Modify: `elixir/test/symphony_elixir_web/controllers/tracker/workspace_setup_controller_test.exs`
  - Adds project lifecycle API tests near existing project endpoint coverage.
- Modify: `tracker/src/types/project.ts`
  - Adds `archivedAt`.
- Modify: `tracker/src/services/mappers.ts`
  - Maps `archived_at` / `archivedAt`.
- Modify: `tracker/src/services/projects.ts`
  - Adds `listProjects({ includeArchived })`, `archiveProject`, `restoreProject`, and `deleteProject`.
- Modify: `tracker/src/pages/ProjectListPage.tsx`
  - Adds show archived toggle, lifecycle actions, confirmation, and local state updates.
- Modify: `tracker/src/pages/__tests__/ProjectListPage.test.tsx`
  - Adds archive, restore, and delete UI tests.

---

## Task 1: Backend Persistence And Context

**Files:**
- Create: `elixir/priv/repo/migrations/20260528004500_add_archived_at_to_local_tracker_projects.exs`
- Modify: `elixir/lib/symphony_elixir/local_tracker/project.ex`
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/context_test.exs`

- [ ] **Step 1: Write failing context tests**

Add tests to `context_test.exs`:

```elixir
test "archive_project hides project from default list and include_archived returns it" do
  {:ok, project} = Context.ensure_project(%{"name" => "Archive Me", "slug" => "archive-me"})

  assert {:ok, archived} = Context.archive_project("archive-me")
  assert archived.archived_at
  refute Enum.any?(Context.list_projects(), &(&1.slug == "archive-me"))
  assert Enum.any?(Context.list_projects(include_archived: true), &(&1.slug == "archive-me"))
end

test "restore_project returns archived project to default list" do
  {:ok, _project} = Context.ensure_project(%{"name" => "Restore Me", "slug" => "restore-me"})
  {:ok, _archived} = Context.archive_project("restore-me")

  assert {:ok, restored} = Context.restore_project("restore-me")
  refute restored.archived_at
  assert Enum.any?(Context.list_projects(), &(&1.slug == "restore-me"))
end

test "delete_project rejects active project and deletes archived project" do
  {:ok, _project} = Context.ensure_project(%{"name" => "Delete Me", "slug" => "delete-me"})

  assert {:error, :project_not_archived} = Context.delete_project("delete-me")
  {:ok, _archived} = Context.archive_project("delete-me")
  assert {:ok, deleted} = Context.delete_project("delete-me")
  assert deleted.slug == "delete-me"
  assert {:error, :project_not_found} = Context.get_project("delete-me")
end
```

- [ ] **Step 2: Run the focused context test and confirm failure**

Run: `mise exec -- mix test test/symphony_elixir/local_tracker/context_test.exs`

Expected: fails because `archive_project/1`, `restore_project/1`, `delete_project/1`, `archived_at`, and `list_projects/1` do not exist yet.

- [ ] **Step 3: Add migration and schema field**

Create migration:

```elixir
defmodule SymphonyElixir.Repo.Migrations.AddArchivedAtToLocalTrackerProjects do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_projects) do
      add(:archived_at, :utc_datetime_usec)
    end

    create(index(:local_tracker_projects, [:archived_at]))
  end
end
```

Update project schema:

```elixir
field(:archived_at, :utc_datetime_usec)
```

- [ ] **Step 4: Implement context lifecycle functions**

In `Context`, replace `list_projects/0` with arity-1 default:

```elixir
@spec list_projects(keyword()) :: [Project.t()]
def list_projects(opts \\ []) do
  include_archived? = Keyword.get(opts, :include_archived, false)

  Project
  |> maybe_active_projects(include_archived?)
  |> order_by([project], asc: project.name)
  |> Repo.all()
end
```

Add helpers:

```elixir
defp maybe_active_projects(query, true), do: query
defp maybe_active_projects(query, false), do: where(query, [project], is_nil(project.archived_at))
```

Add lifecycle functions:

```elixir
@spec archive_project(String.t()) :: {:ok, Project.t()} | {:error, missing_error()}
def archive_project(project_slug) when is_binary(project_slug) do
  with {:ok, project} <- fetch_project(project_slug) do
    project
    |> Ecto.Changeset.change(archived_at: DateTime.utc_now())
    |> Repo.update()
    |> tap_project_event("project_archived")
  end
end

@spec restore_project(String.t()) :: {:ok, Project.t()} | {:error, missing_error()}
def restore_project(project_slug) when is_binary(project_slug) do
  with {:ok, project} <- fetch_project(project_slug) do
    project
    |> Ecto.Changeset.change(archived_at: nil)
    |> Repo.update()
    |> tap_project_event("project_restored")
  end
end

@spec delete_project(String.t()) :: {:ok, Project.t()} | {:error, missing_error() | :project_not_archived}
def delete_project(project_slug) when is_binary(project_slug) do
  with {:ok, project} <- fetch_project(project_slug),
       :ok <- ensure_project_archived(project) do
    Repo.delete(project)
  end
end

defp ensure_project_archived(%Project{archived_at: nil}), do: {:error, :project_not_archived}
defp ensure_project_archived(%Project{}), do: :ok
```

- [ ] **Step 5: Run context tests and fix dependency deletion if needed**

Run: `mise exec -- mix test test/symphony_elixir/local_tracker/context_test.exs`

Expected: passes or exposes a foreign-key dependency that must be deleted in `delete_project/1` transaction before deleting the project.

---

## Task 2: Backend API Routes

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/project_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Modify: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/workspace_setup_controller_test.exs`

- [ ] **Step 1: Write failing API tests**

Add tests:

```elixir
test "archives restores and deletes a project through the API" do
  Context.ensure_project(%{"name" => "Lifecycle", "slug" => "lifecycle"})

  archive_conn = post(authorized_conn(), "/api/tracker/v1/projects/lifecycle/archive")
  assert %{"data" => %{"slug" => "lifecycle", "archived_at" => archived_at}} = json_response(archive_conn, 200)
  assert is_binary(archived_at)

  default_list_conn = get(authorized_conn(), "/api/tracker/v1/projects")
  refute Enum.any?(json_response(default_list_conn, 200)["data"], &(&1["slug"] == "lifecycle"))

  archived_list_conn = get(authorized_conn(), "/api/tracker/v1/projects?include_archived=true")
  assert Enum.any?(json_response(archived_list_conn, 200)["data"], &(&1["slug"] == "lifecycle"))

  restore_conn = post(authorized_conn(), "/api/tracker/v1/projects/lifecycle/restore")
  assert %{"data" => %{"archived_at" => nil}} = json_response(restore_conn, 200)

  delete_active_conn = delete(authorized_conn(), "/api/tracker/v1/projects/lifecycle")
  assert json_response(delete_active_conn, 422)["error"]["message"] =~ "archive"

  post(authorized_conn(), "/api/tracker/v1/projects/lifecycle/archive")
  delete_conn = delete(authorized_conn(), "/api/tracker/v1/projects/lifecycle")
  assert response(delete_conn, 204) == ""
end
```

- [ ] **Step 2: Run API tests and confirm failure**

Run: `mise exec -- mix test test/symphony_elixir_web/controllers/tracker/workspace_setup_controller_test.exs`

Expected: fails because routes/actions and DTO field do not exist.

- [ ] **Step 3: Add API implementation**

Update `ProjectController.index/2`:

```elixir
def index(conn, params) do
  include_archived? = Map.get(params, "include_archived") == "true"
  projects = Context.list_projects(include_archived: include_archived?)
  json(conn, %{data: Enum.map(projects, &TrackerPresenter.project/1)})
end
```

Add actions:

```elixir
def archive(conn, %{"id" => project_slug}) do
  case Context.archive_project(project_slug) do
    {:ok, project} -> json(conn, %{data: TrackerPresenter.project(project)})
    {:error, reason} -> TrackerErrors.render(conn, reason)
  end
end

def restore(conn, %{"id" => project_slug}) do
  case Context.restore_project(project_slug) do
    {:ok, project} -> json(conn, %{data: TrackerPresenter.project(project)})
    {:error, reason} -> TrackerErrors.render(conn, reason)
  end
end

def delete(conn, %{"id" => project_slug}) do
  case Context.delete_project(project_slug) do
    {:ok, _project} -> send_resp(conn, :no_content, "")
    {:error, :project_not_archived} -> TrackerErrors.validation(conn, "Project must be archived before permanent deletion")
    {:error, reason} -> TrackerErrors.render(conn, reason)
  end
end
```

Add routes before `resources("/projects", ...)`:

```elixir
post("/projects/:id/archive", ProjectController, :archive)
post("/projects/:id/restore", ProjectController, :restore)
resources("/projects", ProjectController, only: [:index, :create, :show, :delete])
```

Add presenter field:

```elixir
archived_at: iso8601(project.archived_at)
```

- [ ] **Step 4: Run backend focused tests**

Run: `mise exec -- mix test test/symphony_elixir/local_tracker/context_test.exs test/symphony_elixir_web/controllers/tracker/workspace_setup_controller_test.exs`

Expected: all focused backend tests pass.

---

## Task 3: Frontend Services And Types

**Files:**
- Modify: `tracker/src/types/project.ts`
- Modify: `tracker/src/services/mappers.ts`
- Modify: `tracker/src/services/projects.ts`
- Test: `tracker/src/services/__tests__/projects.test.ts`

- [ ] **Step 1: Write failing service tests**

Add tests for:

```typescript
await listProjects({ includeArchived: true });
await archiveProject("macro-markets");
await restoreProject("macro-markets");
await deleteProject("macro-markets");
```

Expected calls:

```typescript
expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects", { params: { include_archived: "true" } });
expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/archive");
expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/restore");
expect(del).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets");
```

- [ ] **Step 2: Run service tests and confirm failure**

Run: `npm test -- projects.test.ts`

Expected: fails because service functions and `archivedAt` mapping do not exist.

- [ ] **Step 3: Implement services and mapping**

Update `Project`:

```typescript
archivedAt?: string | null;
```

Update backend DTO:

```typescript
archived_at?: string | null;
archivedAt?: string | null;
```

Update `normalizeProject`:

```typescript
archivedAt: dto.archivedAt ?? dto.archived_at ?? null,
```

Update services:

```typescript
export async function listProjects(options: { includeArchived?: boolean } = {}): Promise<Project[]> {
  const response = await http.get(trackerPath("/projects"), {
    params: options.includeArchived ? { include_archived: "true" } : undefined,
  });
  return unwrapData<BackendProjectDto[]>(response).map(normalizeProject);
}

export async function archiveProject(projectSlug: string): Promise<Project> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/archive`));
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export async function restoreProject(projectSlug: string): Promise<Project> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/restore`));
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export async function deleteProject(projectSlug: string): Promise<void> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  await http.delete(trackerPath(`/projects/${encodeURIComponent(projectSlug)}`));
}
```

- [ ] **Step 4: Run service tests**

Run: `npm test -- projects.test.ts`

Expected: service tests pass.

---

## Task 4: Project List UI

**Files:**
- Modify: `tracker/src/pages/ProjectListPage.tsx`
- Test: `tracker/src/pages/__tests__/ProjectListPage.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add coverage:

1. default list renders active projects only from `listProjects()`;
2. clicking `Show archived` calls `listProjects({ includeArchived: true })`;
3. active card `Archive` calls `archiveProject(slug)` and removes it while archived are hidden;
4. archived card shows `Archived`, `Restore`, and `Delete permanently`;
5. delete requires `window.confirm` and calls `deleteProject(slug)` only after confirm.

- [ ] **Step 2: Run UI tests and confirm failure**

Run: `npm test -- ProjectListPage.test.tsx`

Expected: fails because lifecycle controls do not exist.

- [ ] **Step 3: Implement UI controls**

Import lifecycle services and toast:

```typescript
import { toast } from "sonner";
import { archiveProject, deleteProject, listProjects, restoreProject } from "@/services/projects";
```

Add state:

```typescript
const [showArchived, setShowArchived] = useState(false);
```

Load projects whenever `showArchived` changes:

```typescript
void listProjects({ includeArchived: showArchived }).then(...)
```

For each card:

```tsx
{project.archivedAt ? <Badge variant="muted">Archived</Badge> : null}
{project.archivedAt ? (
  <>
    <Button type="button" variant="secondary" onClick={() => void handleRestore(project)}>Restore</Button>
    <Button type="button" variant="destructive" onClick={() => void handleDelete(project)}>Delete permanently</Button>
  </>
) : (
  <Button type="button" variant="secondary" onClick={() => void handleArchive(project)}>Archive</Button>
)}
```

Prevent action buttons from navigating by keeping action buttons outside the `Link` or calling `event.preventDefault()` and `event.stopPropagation()`.

Delete confirmation:

```typescript
if (!window.confirm(`Delete project "${project.name}" permanently? This cannot be undone.`)) return;
```

- [ ] **Step 4: Run UI tests**

Run: `npm test -- ProjectListPage.test.tsx`

Expected: UI tests pass.

---

## Task 5: Verification

**Files:**
- All touched backend and frontend files.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
cd elixir
mise exec -- mix test test/symphony_elixir/local_tracker/context_test.exs test/symphony_elixir_web/controllers/tracker/workspace_setup_controller_test.exs
```

Expected: exit 0 with all tests passing.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
cd tracker
npm test -- projects.test.ts ProjectListPage.test.tsx
```

Expected: exit 0 with all tests passing.

- [ ] **Step 3: Build frontend**

Run:

```bash
cd tracker
npm run build
```

Expected: TypeScript and Vite build exit 0.

- [ ] **Step 4: Run lints for touched files**

Use Cursor `ReadLints` for changed Elixir and TypeScript files.

Expected: no new diagnostics in touched files.

- [ ] **Step 5: Browser smoke test**

Open `http://127.0.0.1:4000/tracker/projects` and verify:

1. active project cards show `Archive`;
2. archiving hides the card when `Show archived` is off;
3. `Show archived` reveals the card with `Archived`;
4. restore returns it to active;
5. delete confirmation appears for archived projects.

---

## Self-Review

- Spec coverage: archive, restore, delete, default hiding, `include_archived`, confirmation, and non-goals are covered.
- Placeholder scan: no `TBD`, vague tasks, or unspecified commands remain.
- Type consistency: backend field is `archived_at`; frontend field is `archivedAt`; API query param is `include_archived=true`.
- Safety: permanent delete is only available for archived projects and does not touch GitHub or local repo folders.
