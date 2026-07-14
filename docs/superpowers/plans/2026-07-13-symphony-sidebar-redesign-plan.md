# Symphony Sidebar Redesign Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Replace example commands with this repo’s real tools (Elixir `mix`, tracker `vitest`).
>
> **WSL:** Never run full, batch, directory-wide, repeated, parallel, or repository-wide test suites. Run one narrowly targeted test file or test-name filter at a time, sequentially, and wait for completion. Ask the user before expanding scope. Include this restriction in every implementation or review subagent prompt.

**Goal:** Replace the disconnected Recents + Boards sidebar with an accessible, project-first tree that represents Project → Workspace → Session and exposes capability-driven actions at each level.

**Architecture:** Keep tree construction, ordering, capabilities, route resolution, and preferences in pure TypeScript modules. `useSidebarTree` lazily loads and caches one project branch at a time using existing projects/issues/recents/executions/inventory APIs. Small React components render the tree and delegate mutations to `useSidebarActions`; missing persistent capabilities are added through focused Phoenix contracts for thread metadata/deletion and workspace display aliases.

**Tech Stack:** React 19, TypeScript, React Router, Radix UI, Vitest/Testing Library, Elixir 1.19, Phoenix 1.8, Ecto/SQLite, ExUnit.

**Spec:** `docs/superpowers/specs/2026-07-13-symphony-sidebar-redesign-design.md`

---

## Scope decisions locked by this plan

1. Multiple projects may stay expanded.
2. A collapsed project keeps its cached snapshot but stops its in-flight inventory subscription.
3. Reopening a cached project renders immediately, marks it stale, and refreshes in the background.
4. Unread state, pins, filters, grouping, sorting, and expanded IDs remain local preferences.
5. Thread labels and review state use the existing `assistant_threads.metadata` map; no migration is needed.
6. Workspace display aliases use a dedicated table keyed by project slug + physical path; renaming never moves a directory or branch.
7. Issue-backed session titles/labels continue to use the issue as the source of truth.
8. Thread deletion is available only for archived/closed local thread records; active threads and execution-only rows are not deletable.
9. “Open in editor/terminal” is capability-gated. Existing project/issue targets work; arbitrary standalone paths remain disabled with a reason.
10. “Copy resume command” copies the canonical execution-session deep link because no stable CLI resume command exists.
11. Automations navigates to `/settings/templates` in this delivery; a distinct automations product area is outside scope.

---

## File structure

### Create — Elixir

- `elixir/priv/repo/migrations/20260713191800_create_workspace_display_names.exs` — workspace alias table.
- `elixir/lib/symphony_elixir/workspace/display_name.ex` — validated alias schema/context.
- `elixir/lib/symphony_elixir_web/controllers/tracker/workspace_display_name_controller.ex` — list/upsert alias API.
- `elixir/test/symphony_elixir/workspace/display_name_test.exs`
- `elixir/test/symphony_elixir_web/controllers/tracker/workspace_display_name_controller_test.exs`

### Modify — Elixir

- `elixir/lib/symphony_elixir/assistant/history.ex` — update metadata and delete eligible threads.
- `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex` — PATCH/DELETE and archived listing.
- `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex` — thread workspace path, labels, review state.
- `elixir/lib/symphony_elixir_web/router.ex` — thread and workspace-alias routes.
- `elixir/lib/symphony_elixir_web/controllers/tracker/worktree_inventory_controller.ex` — attach aliases to inventory responses/events.
- `elixir/lib/symphony_elixir_web/worktree_inventory_presenter.ex` — `display_name`.
- `elixir/test/symphony_elixir/assistant/history_test.exs`
- `elixir/test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs`
- `elixir/test/symphony_elixir_web/controllers/tracker/worktree_inventory_controller_test.exs`

### Create — tracker domain/data

- `tracker/src/types/sidebar.ts` — node/action/load-state contracts.
- `tracker/src/lib/sidebarTree.ts` — pure tree construction, aggregation, sorting, overflow.
- `tracker/src/lib/sidebarPreferences.ts` — versioned validated local preferences.
- `tracker/src/lib/sidebarRouteResolution.ts` — route selection and ancestor resolution.
- `tracker/src/lib/sidebarCapabilities.ts` — valid/disabled actions per node.
- `tracker/src/lib/sidebarTreeKeyboard.ts` — pure visible-row keyboard navigation.
- `tracker/src/hooks/useSidebarTree.ts` — projects, lazy branches, cache, subscriptions.
- `tracker/src/hooks/useSidebarActions.ts` — all mutations and refresh behavior.

### Create — tracker UI

- `tracker/src/components/layout/sidebar/SidebarUtilityNav.tsx`
- `tracker/src/components/layout/sidebar/SidebarNewSessionFlow.tsx`
- `tracker/src/components/layout/sidebar/SidebarSearchLauncher.tsx`
- `tracker/src/components/layout/sidebar/ProjectNavigationTree.tsx`
- `tracker/src/components/layout/sidebar/SidebarTreeRow.tsx`
- `tracker/src/components/layout/sidebar/ProjectTreeItem.tsx`
- `tracker/src/components/layout/sidebar/WorkspaceTreeItem.tsx`
- `tracker/src/components/layout/sidebar/SessionTreeItem.tsx`
- `tracker/src/components/layout/sidebar/SidebarContextMenu.tsx`
- `tracker/src/components/layout/sidebar/SidebarFiltersMenu.tsx`
- `tracker/src/components/layout/sidebar/SidebarRenameDialog.tsx`
- `tracker/src/components/layout/sidebar/SidebarSessionMetadataDialog.tsx`
- `tracker/src/components/layout/sidebar/SidebarConfirmDialog.tsx`
- `tracker/src/components/layout/sidebar/SidebarCollapsedRail.tsx`
- `tracker/src/components/layout/sidebar/SidebarMobileDrawer.tsx`
- `tracker/src/components/layout/sidebar/SidebarBranchState.tsx`

### Create — tracker tests

- `tracker/src/services/__tests__/assistantThreads.test.ts`
- `tracker/src/services/__tests__/workspaceDisplayNames.test.ts`
- `tracker/src/lib/__tests__/sidebarTree.test.ts`
- `tracker/src/lib/__tests__/sidebarPreferences.test.ts`
- `tracker/src/lib/__tests__/sidebarRouteResolution.test.ts`
- `tracker/src/lib/__tests__/sidebarCapabilities.test.ts`
- `tracker/src/lib/__tests__/sidebarTreeKeyboard.test.ts`
- `tracker/src/hooks/__tests__/useSidebarTree.test.tsx`
- `tracker/src/hooks/__tests__/useSidebarActions.test.tsx`
- `tracker/src/components/layout/sidebar/__tests__/ProjectNavigationTree.test.tsx`
- `tracker/src/components/layout/sidebar/__tests__/SidebarContextMenu.test.tsx`
- `tracker/src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx`
- `tracker/src/components/layout/sidebar/__tests__/SidebarFiltersMenu.test.tsx`
- `tracker/src/components/layout/sidebar/__tests__/SidebarMobileDrawer.test.tsx`

### Modify — tracker

- `tracker/src/types/assistant-thread.ts` — workspace path, labels, needsReview.
- `tracker/src/types/worktrees.ts` — displayName.
- `tracker/src/services/assistantThreads.ts` — update/delete/include archived.
- `tracker/src/services/worktrees.ts` — normalize displayName and alias operations.
- `tracker/src/components/layout/ProjectSidebar.tsx` — compose new desktop shell.
- `tracker/src/components/layout/Layout.tsx` — mobile trigger/drawer.
- `tracker/src/components/layout/__tests__/ProjectSidebar.test.tsx` — migrate baseline tests.
- `tracker/src/lib/workspaceRoutes.ts` — canonical sidebar route helpers only.
- `tracker/locales/en/tracker.json`
- `tracker/locales/pt-BR/tracker.json`

### Delete after migration

- `tracker/src/components/layout/RecentsSection.tsx`
- `tracker/src/components/layout/__tests__/RecentsSection.test.tsx`

Keep `recentSessionPath.ts`, `RecentStatusDot.tsx`, `useRecents.ts`, and their tests because other session surfaces still use the contracts.

---

### Task 1: Add persistent assistant-thread actions

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/history.ex`
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Test: `elixir/test/symphony_elixir/assistant/history_test.exs`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs`

- [ ] **Step 1: Write failing History tests**

Add tests with these exact behaviors:

```elixir
test "update_thread_sidebar_metadata normalizes title labels and review state" do
  {:ok, thread} =
    History.create_freeform_thread(%{
      title: "Old",
      workspace_path: System.tmp_dir!()
    })

  assert {:ok, updated} =
           History.update_thread_sidebar_metadata(thread.id, %{
             title: "  New title  ",
             labels: [" idea ", "idea", "wip"],
             needs_review: true
           })

  assert updated.title == "New title"
  assert updated.metadata["sidebar_labels"] == ["idea", "wip"]
  assert updated.metadata["sidebar_needs_review"] == true
end

test "delete_thread refuses active threads and deletes archived threads" do
  {:ok, thread} =
    History.create_freeform_thread(%{
      title: "Disposable",
      workspace_path: System.tmp_dir!()
    })

  assert {:error, :thread_active} = History.delete_thread(thread.id)
  assert {:ok, _archived} = History.archive_thread(thread.id)
  assert {:ok, deleted} = History.delete_thread(thread.id)
  assert deleted.id == thread.id
  assert {:error, :not_found} = History.get_thread(thread.id)
end
```

- [ ] **Step 2: Run the History file and verify RED**

```bash
cd elixir && mix test test/symphony_elixir/assistant/history_test.exs
```

Expected: FAIL because `update_thread_sidebar_metadata/2` and `delete_thread/1` do not exist.

- [ ] **Step 3: Implement validated History functions**

Add public specs and guards:

```elixir
@sidebar_title_max 160
@sidebar_label_max 40
@sidebar_label_count_max 12

@spec update_thread_sidebar_metadata(integer(), map()) ::
        {:ok, Thread.t()} | {:error, :not_found | :invalid_title | :invalid_labels | Ecto.Changeset.t()}
def update_thread_sidebar_metadata(id, attrs) when is_integer(id) and id > 0 and is_map(attrs) do
  with {:ok, thread} <- get_thread(id),
       {:ok, normalized} <- normalize_sidebar_attrs(attrs) do
    metadata =
      thread.metadata
      |> Kernel.||(%{})
      |> maybe_put("sidebar_labels", normalized[:labels])
      |> maybe_put("sidebar_needs_review", normalized[:needs_review])

    update_attrs =
      %{}
      |> maybe_put(:title, normalized[:title])
      |> Map.put(:metadata, metadata)

    update_thread(thread, update_attrs)
  end
end

@spec delete_thread(integer()) ::
        {:ok, Thread.t()} | {:error, :not_found | :thread_active | Ecto.Changeset.t()}
def delete_thread(id) when is_integer(id) and id > 0 do
  with {:ok, thread} <- get_thread(id),
       :ok <- ensure_deletable_thread(thread) do
    Repo.delete(thread)
  end
end
```

Normalization rules:

- trim title; reject blank or more than 160 graphemes;
- accept only a list of strings for labels;
- trim, reject blanks, deduplicate while preserving order;
- reject more than 12 labels or a label over 40 graphemes;
- accept only booleans for `needs_review`;
- preserve metadata keys not owned by the sidebar;
- reject active threads in `delete_thread/1`;
- permit deletion only for `freeform`, `project_session`, and `issue_session`.

- [ ] **Step 4: Add failing controller tests**

Append:

```elixir
test "PATCH updates sidebar metadata and exposes workspace fields" do
  {:ok, thread} =
    History.create_freeform_thread(%{
      title: "Old",
      workspace_path: System.tmp_dir!()
    })

  conn =
    authorize()
    |> patch("/api/tracker/v1/assistant/threads/#{thread.id}", %{
      title: "New",
      labels: ["idea"],
      needs_review: true
    })

  assert %{
           "data" => %{
             "id" => id,
             "title" => "New",
             "labels" => ["idea"],
             "needs_review" => true,
             "workspace_path" => workspace_path
           }
         } = json_response(conn, 200)

  assert id == thread.id
  assert workspace_path == System.tmp_dir!()
end

test "GET include_archived returns archived threads" do
  {:ok, thread} =
    History.create_freeform_thread(%{
      title: "Archived",
      workspace_path: System.tmp_dir!()
    })

  {:ok, _} = History.archive_thread(thread.id)
  conn = get(authorize(), "/api/tracker/v1/assistant/threads?scope=freeform&include_archived=true")

  assert %{"data" => rows} = json_response(conn, 200)
  assert Enum.any?(rows, &(&1["id"] == thread.id and &1["status"] == "archived"))
end

test "DELETE removes an archived local thread" do
  {:ok, thread} =
    History.create_freeform_thread(%{
      title: "Archived",
      workspace_path: System.tmp_dir!()
    })

  {:ok, _} = History.archive_thread(thread.id)
  conn = delete(authorize(), "/api/tracker/v1/assistant/threads/#{thread.id}")

  assert response(conn, 204)
  assert {:error, :not_found} = History.get_thread(thread.id)
end
```

- [ ] **Step 5: Run the controller file and verify RED**

```bash
cd elixir && mix test test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs
```

Expected: FAIL because PATCH/DELETE routes and response fields are absent.

- [ ] **Step 6: Implement controller, presenter, and routes**

Add:

```elixir
patch("/assistant/threads/:thread_id", AssistantThreadController, :update)
delete("/assistant/threads/:thread_id", AssistantThreadController, :delete)
```

`update/2` passes only `title`, `labels`, and `needs_review` to History.
`delete/2` returns 204 on success and maps `:thread_active` to 409.
`index/2` parses `include_archived` strictly as `true` only and forwards it to
`History.list_threads/1`.

Presenter fields:

```elixir
workspace_path: value(thread, :workspace_path),
labels: get_in(value(thread, :metadata) || %{}, ["sidebar_labels"]) || [],
needs_review: get_in(value(thread, :metadata) || %{}, ["sidebar_needs_review"]) == true
```

- [ ] **Step 7: Run both targeted files sequentially**

```bash
cd elixir && mix test test/symphony_elixir/assistant/history_test.exs
cd elixir && mix test test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs
```

Expected: each command exits 0.

- [ ] **Step 8: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/history.ex elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex elixir/lib/symphony_elixir_web/router.ex elixir/test/symphony_elixir/assistant/history_test.exs elixir/test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs
git commit -m "feat(sidebar): add persistent thread actions"
```

---

### Task 2: Persist workspace display aliases

**Files:**
- Create: `elixir/priv/repo/migrations/20260713191800_create_workspace_display_names.exs`
- Create: `elixir/lib/symphony_elixir/workspace/display_name.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/workspace_display_name_controller.ex`
- Create: `elixir/test/symphony_elixir/workspace/display_name_test.exs`
- Create: `elixir/test/symphony_elixir_web/controllers/tracker/workspace_display_name_controller_test.exs`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`

- [ ] **Step 1: Write the schema/context tests**

```elixir
defmodule SymphonyElixir.Workspace.DisplayNameTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Workspace.DisplayName

  setup do
    Ecto.Adapters.SQL.Sandbox.checkout(SymphonyElixir.Repo)
    :ok
  end

  test "put validates entry data and upserts by project and path" do
    assert {:ok, first} = DisplayName.put("demo", "/tmp/demo/ws", "  Feature A  ")
    assert first.display_name == "Feature A"

    assert {:ok, second} = DisplayName.put("demo", "/tmp/demo/ws", "Feature B")
    assert second.id == first.id
    assert DisplayName.list_for_project("demo") |> Enum.map(& &1.display_name) == ["Feature B"]
  end

  test "put rejects blank values and paths outside the project inventory contract" do
    assert {:error, :invalid_project_slug} = DisplayName.put(" ", "/tmp/demo/ws", "Feature")
    assert {:error, :invalid_workspace_path} = DisplayName.put("demo", "relative/ws", "Feature")
    assert {:error, :invalid_display_name} = DisplayName.put("demo", "/tmp/demo/ws", " ")
  end
end
```

- [ ] **Step 2: Run the test and verify RED**

```bash
cd elixir && mix test test/symphony_elixir/workspace/display_name_test.exs
```

Expected: FAIL because the module and migration do not exist.

- [ ] **Step 3: Create migration and context**

Migration:

```elixir
def change do
  create table(:workspace_display_names) do
    add(:project_slug, :string, null: false)
    add(:workspace_path, :text, null: false)
    add(:display_name, :string, null: false)
    timestamps(type: :utc_datetime_usec)
  end

  create(unique_index(:workspace_display_names, [:project_slug, :workspace_path]))
end
```

`DisplayName` owns its Ecto schema and exposes:

```elixir
@spec list_for_project(String.t()) :: [t()]
@spec get(String.t(), String.t()) :: {:ok, t()} | {:error, :not_found}
@spec put(String.t(), Path.t(), String.t()) ::
        {:ok, t()} |
        {:error, :invalid_project_slug | :invalid_workspace_path | :invalid_display_name | Ecto.Changeset.t()}
@spec delete(String.t(), Path.t()) :: :ok | {:error, :not_found}
```

Validate absolute paths with `Path.type(path) == :absolute`, trim all strings,
cap display name at 120 graphemes, and use an upsert on the unique index.

- [ ] **Step 4: Write controller tests**

Create tests for:

- `GET /projects/demo/workspaces/display_names` returning `data: []`;
- `PUT` body `{path, display_name}` returning normalized data;
- second PUT updating the same row;
- invalid path returning 422;
- unauthenticated request returning 401.

Use the same Endpoint/token setup as
`assistant_thread_controller_test.exs`; create project `demo` through
`Context.ensure_project/1` before PUT.

- [ ] **Step 5: Run the controller test and verify RED**

```bash
cd elixir && mix test test/symphony_elixir_web/controllers/tracker/workspace_display_name_controller_test.exs
```

Expected: FAIL because controller and routes do not exist.

- [ ] **Step 6: Implement controller and routes**

Routes:

```elixir
get("/projects/:project_slug/workspaces/display_names", WorkspaceDisplayNameController, :index)
put("/projects/:project_slug/workspaces/display_names", WorkspaceDisplayNameController, :upsert)
delete("/projects/:project_slug/workspaces/display_names", WorkspaceDisplayNameController, :delete)
```

Contracts:

```json
{"data":[{"project_slug":"demo","workspace_path":"/tmp/demo/ws","display_name":"Feature B"}]}
```

PUT and DELETE validate that `path` exists in the current project inventory
before mutating an alias. The project workspace may have an alias, but its
remove capability remains false.

- [ ] **Step 7: Run targeted tests sequentially**

```bash
cd elixir && mix test test/symphony_elixir/workspace/display_name_test.exs
cd elixir && mix test test/symphony_elixir_web/controllers/tracker/workspace_display_name_controller_test.exs
```

Expected: each command exits 0.

- [ ] **Step 8: Commit**

```bash
git add elixir/priv/repo/migrations/20260713191800_create_workspace_display_names.exs elixir/lib/symphony_elixir/workspace/display_name.ex elixir/lib/symphony_elixir_web/controllers/tracker/workspace_display_name_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/test/symphony_elixir/workspace/display_name_test.exs elixir/test/symphony_elixir_web/controllers/tracker/workspace_display_name_controller_test.exs
git commit -m "feat(sidebar): persist workspace display names"
```

---

### Task 3: Expose aliases in worktree inventory

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/worktree_inventory_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/worktree_inventory_presenter.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/worktree_inventory_controller_test.exs`

- [ ] **Step 1: Write a failing inventory test**

Add a test that creates a project, inserts an alias for a known inventory entry,
requests `GET /projects/:slug/worktrees`, and asserts:

```elixir
assert %{
         "data" => [
           %{
             "path" => ^workspace_path,
             "display_name" => "Sidebar label"
           }
           | _
         ]
       } = json_response(conn, 200)
```

Also add a no-alias case asserting `"display_name" => nil`.

- [ ] **Step 2: Run the file and verify RED**

```bash
cd elixir && mix test test/symphony_elixir_web/controllers/tracker/worktree_inventory_controller_test.exs
```

Expected: FAIL because inventory entries do not expose `display_name`.

- [ ] **Step 3: Merge aliases in controller/presenter**

Load `DisplayName.list_for_project(project_slug)` once per request or SSE scan,
build `%{workspace_path => display_name}`, and pass it to presenter:

```elixir
@spec entry_json(map(), %{optional(Path.t()) => String.t()}) :: map()
def entry_json(entry, aliases) do
  entry
  |> entry_json()
  |> Map.put(:display_name, Map.get(aliases, entry.path))
end
```

Use the same alias snapshot for all `entry` SSE events in one inventory scan.

- [ ] **Step 4: Run the targeted file**

```bash
cd elixir && mix test test/symphony_elixir_web/controllers/tracker/worktree_inventory_controller_test.exs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/worktree_inventory_controller.ex elixir/lib/symphony_elixir_web/worktree_inventory_presenter.ex elixir/test/symphony_elixir_web/controllers/tracker/worktree_inventory_controller_test.exs
git commit -m "feat(sidebar): expose workspace aliases in inventory"
```

---

### Task 4: Add tracker service contracts

**Files:**
- Modify: `tracker/src/types/assistant-thread.ts`
- Modify: `tracker/src/types/worktrees.ts`
- Modify: `tracker/src/services/assistantThreads.ts`
- Modify: `tracker/src/services/worktrees.ts`
- Create: `tracker/src/services/__tests__/assistantThreads.test.ts`
- Create: `tracker/src/services/__tests__/workspaceDisplayNames.test.ts`

- [ ] **Step 1: Write failing normalizer/service tests**

Assistant thread expectations:

```ts
it("normalizes sidebar thread metadata", () => {
  expect(normalizeAssistantThread({
    id: 7,
    scope: "freeform",
    status: "active",
    workspace_path: "/tmp/thread-7",
    labels: ["idea"],
    needs_review: true,
  })).toMatchObject({
    id: 7,
    workspacePath: "/tmp/thread-7",
    labels: ["idea"],
    needsReview: true,
  });
});
```

Workspace expectations:

```ts
it("normalizes display_name and sends validated alias updates", async () => {
  mockedHttp.put.mockResolvedValue({
    data: { data: { workspace_path: "/tmp/ws", display_name: "Feature A" } },
  });

  await updateWorkspaceDisplayName("demo", "/tmp/ws", " Feature A ");

  expect(mockedHttp.put).toHaveBeenCalledWith(
    trackerPath("/projects/demo/workspaces/display_names"),
    { path: "/tmp/ws", display_name: "Feature A" },
  );
});
```

Add request tests for:

- `updateAssistantThread(7, {title, labels, needsReview})`;
- `deleteAssistantThread(7)`;
- `listAssistantThreads({includeArchived: true})`;
- blank alias, project slug, or path failing before HTTP.

- [ ] **Step 2: Run tests sequentially and verify RED**

```bash
cd tracker && npm test -- src/services/__tests__/assistantThreads.test.ts
cd tracker && npm test -- src/services/__tests__/workspaceDisplayNames.test.ts
```

Expected: each fails because the new fields/functions are absent.

- [ ] **Step 3: Implement exact frontend contracts**

Types:

```ts
export interface AssistantThread {
  id: number;
  scope: string;
  agentKind: "codex" | "claude" | "cursor" | null;
  projectSlug: string | null;
  projectName: string | null;
  issueIdentifier: string | null;
  title: string | null;
  status: string;
  preview: string | null;
  workspacePath: string | null;
  labels: string[];
  needsReview: boolean;
  updatedAt: string;
}
```

Add `displayName: string | null` to `WorkspaceInventoryEntry`.

Services:

```ts
export interface UpdateAssistantThreadInput {
  title?: string;
  labels?: string[];
  needsReview?: boolean;
}

export async function updateAssistantThread(
  threadId: number,
  input: UpdateAssistantThreadInput,
): Promise<AssistantThread>;

export async function deleteAssistantThread(threadId: number): Promise<void>;

export async function updateWorkspaceDisplayName(
  projectSlug: string,
  workspacePath: string,
  displayName: string,
): Promise<{ workspacePath: string; displayName: string }>;
```

Normalize missing labels to `[]`, missing review to `false`, missing paths and
display names to `null`. Validate positive thread IDs and nonblank trimmed
values at service entry points.

- [ ] **Step 4: Run tests sequentially**

```bash
cd tracker && npm test -- src/services/__tests__/assistantThreads.test.ts
cd tracker && npm test -- src/services/__tests__/workspaceDisplayNames.test.ts
```

Expected: each command exits 0.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/types/assistant-thread.ts tracker/src/types/worktrees.ts tracker/src/services/assistantThreads.ts tracker/src/services/worktrees.ts tracker/src/services/__tests__/assistantThreads.test.ts tracker/src/services/__tests__/workspaceDisplayNames.test.ts
git commit -m "feat(sidebar): add sidebar mutation services"
```

---

### Task 5: Build the pure sidebar tree

**Files:**
- Create: `tracker/src/types/sidebar.ts`
- Create: `tracker/src/lib/sidebarTree.ts`
- Create: `tracker/src/lib/__tests__/sidebarTree.test.ts`
- Read/reuse: `tracker/src/lib/workspaceCards.ts`
- Read/reuse: `tracker/src/components/layout/recentSessionPath.ts`

- [ ] **Step 1: Define node contracts in the failing test**

Use fixtures with one project inventory, one issue inventory, one standalone
inventory, an execution, an issue session, and a freeform session. Assert:

```ts
it("builds project workspace session hierarchy and keeps unassigned sessions", () => {
  const project = buildSidebarProjectTree(fixtureInput());

  expect(project.id).toBe("demo");
  expect(project.workspaces.map((workspace) => workspace.workspaceKind)).toEqual([
    "project",
    "issue",
    "standalone",
  ]);
  expect(project.workspaces[1].sessions.map((session) => session.sessionKind)).toEqual([
    "execution",
    "chat",
  ]);
  expect(project.unassignedSessions.map((session) => session.title)).toEqual(["Free chat"]);
});

it("sorts pinned attention active recent and name in that order", () => {
  const project = buildSidebarProjectTree(fixtureInputWithOrderingCases());
  expect(project.workspaces.map((workspace) => workspace.id)).toEqual([
    "pinned",
    "error",
    "active",
    "recent",
    "alpha",
  ]);
});

it("partitions overflow without hiding pinned nodes", () => {
  const result = partitionVisibleNodes(fixtureWorkspaceNodes(10), 3);
  expect(result.visible.filter((node) => node.pinned)).toHaveLength(2);
  expect(result.visible).toHaveLength(3);
  expect(result.overflow).toHaveLength(7);
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
cd tracker && npm test -- src/lib/__tests__/sidebarTree.test.ts
```

Expected: FAIL because sidebar types and builder do not exist.

- [ ] **Step 3: Implement immutable contracts and builder**

Create:

```ts
export type SidebarLoadState = "idle" | "loading" | "ready" | "error" | "stale";
export type SidebarAggregateStatus = "idle" | "active" | "attention" | "error" | "stale";
export type SidebarWorkspaceKind = "project" | "issue" | "standalone" | "parallel" | "orphan";
export type SidebarSessionKind = "chat" | "authoring" | "execution";

export interface SidebarSessionNode {
  kind: "session";
  id: string;
  projectSlug: string;
  workspaceId: string | null;
  sessionKind: SidebarSessionKind;
  title: string;
  subtitle: string;
  href: string;
  statusKind: RecentStatusKind;
  agentKind: RecentSession["agentKind"];
  updatedAt: string;
  threadId: number | null;
  issueIdentifier: string | null;
  archived: boolean;
  unread: boolean;
  needsReview: boolean;
  pinned: boolean;
}

export interface SidebarWorkspaceNode {
  kind: "workspace";
  id: string;
  projectSlug: string;
  workspaceKind: SidebarWorkspaceKind;
  title: string;
  branchSummary: string | null;
  aggregateStatus: SidebarAggregateStatus;
  inventory: WorkspaceInventoryEntry | null;
  issueIdentifier: string | null;
  sessions: SidebarSessionNode[];
  overflowSessions: SidebarSessionNode[];
  pinned: boolean;
}

export interface SidebarProjectNode {
  kind: "project";
  id: string;
  title: string;
  archived: boolean;
  aggregateStatus: SidebarAggregateStatus;
  loadState: SidebarLoadState;
  error: string | null;
  workspaces: SidebarWorkspaceNode[];
  overflowWorkspaces: SidebarWorkspaceNode[];
  unassignedSessions: SidebarSessionNode[];
  pinned: boolean;
}
```

`buildSidebarProjectTree(input)` must call `buildWorkspaceCards()` rather than
reimplement its association rules. Convert cards to fresh objects, derive stable
IDs from project slug + inventory path, aggregate status with precedence
`error > attention > active > stale > idle`, and never mutate inputs.

Constants:

```ts
export const SIDEBAR_DEFAULT_WORKSPACE_LIMIT = 8;
export const SIDEBAR_DEFAULT_SESSION_LIMIT = 6;
```

- [ ] **Step 4: Run the test**

```bash
cd tracker && npm test -- src/lib/__tests__/sidebarTree.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/types/sidebar.ts tracker/src/lib/sidebarTree.ts tracker/src/lib/__tests__/sidebarTree.test.ts
git commit -m "feat(sidebar): build project workspace session tree"
```

---

### Task 6: Add preferences, route selection, capabilities, and keyboard rules

**Files:**
- Create: `tracker/src/lib/sidebarPreferences.ts`
- Create: `tracker/src/lib/sidebarRouteResolution.ts`
- Create: `tracker/src/lib/sidebarCapabilities.ts`
- Create: `tracker/src/lib/sidebarTreeKeyboard.ts`
- Create: `tracker/src/lib/__tests__/sidebarPreferences.test.ts`
- Create: `tracker/src/lib/__tests__/sidebarRouteResolution.test.ts`
- Create: `tracker/src/lib/__tests__/sidebarCapabilities.test.ts`
- Create: `tracker/src/lib/__tests__/sidebarTreeKeyboard.test.ts`

- [ ] **Step 1: Write failing preference tests**

Cover:

```ts
it("migrates the legacy collapse key and drops invalid persisted values", () => {
  localStorage.setItem("tracker-sidebar-collapsed", "true");
  localStorage.setItem("symphony:sidebar:v1", JSON.stringify({
    version: 1,
    expandedProjectIds: [null, "demo"],
    sort: "invalid",
  }));

  expect(readSidebarPreferences()).toMatchObject({
    version: 1,
    collapsed: true,
    expandedProjectIds: ["demo"],
    sort: "activity",
  });
});
```

Define `SidebarPreferences` with:

- `collapsed`;
- expanded project/workspace IDs;
- pinned project/workspace/session IDs;
- sort (`activity | name`);
- grouping (`none | workspaceKind | status`);
- status/agent/activity/archive filters;
- `lastReadAtBySession`.

- [ ] **Step 2: Write failing route/capability/keyboard tests**

Required assertions:

- `/projects/demo/workspaces/session/42` selects project `demo` and session
  `thread:42`;
- execution route selects `exec:DEMO-1`;
- non-project route selects no project;
- route selection expands ancestors found in the built tree;
- project main workspace omits remove/rename;
- archived project offers remove and restore, not new-session;
- active thread omits delete;
- standalone workspace without editor target returns disabled `open-editor` with
  a reason;
- ArrowRight expands or enters first child;
- ArrowLeft collapses or returns parent;
- Shift+F10 returns an `open-menu` command for the focused row.

- [ ] **Step 3: Run four files sequentially and verify RED**

```bash
cd tracker && npm test -- src/lib/__tests__/sidebarPreferences.test.ts
cd tracker && npm test -- src/lib/__tests__/sidebarRouteResolution.test.ts
cd tracker && npm test -- src/lib/__tests__/sidebarCapabilities.test.ts
cd tracker && npm test -- src/lib/__tests__/sidebarTreeKeyboard.test.ts
```

Expected: each fails because its module is absent.

- [ ] **Step 4: Implement pure modules**

Export:

```ts
export const SIDEBAR_PREFERENCES_STORAGE_KEY = "symphony:sidebar:v1";
export const LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY = "tracker-sidebar-collapsed";

export function defaultSidebarPreferences(): SidebarPreferences;
export function readSidebarPreferences(storage: Storage = window.localStorage): SidebarPreferences;
export function writeSidebarPreferences(
  preferences: SidebarPreferences,
  storage: Storage = window.localStorage,
): void;
export function resolveSidebarRouteSelection(pathname: string): SidebarRouteSelection;
export function ancestorIdsForSelection(
  selection: SidebarRouteSelection,
  tree: readonly SidebarProjectNode[],
): { projectIds: string[]; workspaceIds: string[] };
export function resolveSidebarCapabilities(
  node: SidebarNode,
  context: SidebarCapabilityContext,
): SidebarMenuAction[];
export function resolveTreeKeyboardCommand(input: TreeKeyboardInput): TreeKeyboardCommand;
```

All entry points validate missing/invalid input and return defaults or explicit
disabled actions rather than throwing during rendering.

- [ ] **Step 5: Run four files sequentially**

```bash
cd tracker && npm test -- src/lib/__tests__/sidebarPreferences.test.ts
cd tracker && npm test -- src/lib/__tests__/sidebarRouteResolution.test.ts
cd tracker && npm test -- src/lib/__tests__/sidebarCapabilities.test.ts
cd tracker && npm test -- src/lib/__tests__/sidebarTreeKeyboard.test.ts
```

Expected: each command exits 0.

- [ ] **Step 6: Commit**

```bash
git add tracker/src/lib/sidebarPreferences.ts tracker/src/lib/sidebarRouteResolution.ts tracker/src/lib/sidebarCapabilities.ts tracker/src/lib/sidebarTreeKeyboard.ts tracker/src/lib/__tests__/sidebarPreferences.test.ts tracker/src/lib/__tests__/sidebarRouteResolution.test.ts tracker/src/lib/__tests__/sidebarCapabilities.test.ts tracker/src/lib/__tests__/sidebarTreeKeyboard.test.ts
git commit -m "feat(sidebar): add preferences routes and capabilities"
```

---

### Task 7: Implement lazy project branches

**Files:**
- Create: `tracker/src/hooks/useSidebarTree.ts`
- Create: `tracker/src/hooks/__tests__/useSidebarTree.test.tsx`
- Read/reuse: `tracker/src/hooks/useProjectSessions.ts`
- Read/reuse: `tracker/src/services/issues.ts`
- Read/reuse: `tracker/src/services/recents.ts`
- Read/reuse: `tracker/src/services/worktrees.ts`

- [ ] **Step 1: Write failing hook tests**

Mock `listProjects`, `listIssues`, `listRecents`,
`subscribeWorkspaceInventory`, `fetchWorkspaceInventory`, and
`useAgentExecutions`.

Required tests:

```ts
it("does not fan out branch requests on mount", async () => {
  renderHook(() => useSidebarTree(), { wrapper: routerWrapper("/projects") });
  await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(1));
  expect(listIssues).not.toHaveBeenCalled();
  expect(listRecents).not.toHaveBeenCalled();
  expect(subscribeWorkspaceInventory).not.toHaveBeenCalled();
});

it("loads once on first expansion and reuses cache while refreshing stale data", async () => {
  const { result } = renderHook(() => useSidebarTree(), { wrapper: routerWrapper("/projects") });
  await waitFor(() => expect(result.current.projectsLoading).toBe(false));

  act(() => result.current.toggleProjectExpanded("demo"));
  await waitFor(() => expect(result.current.tree[0].loadState).toBe("ready"));
  expect(listIssues).toHaveBeenCalledTimes(1);

  act(() => result.current.toggleProjectExpanded("demo"));
  act(() => result.current.toggleProjectExpanded("demo"));
  expect(result.current.tree[0].loadState).toBe("stale");
  await waitFor(() => expect(listIssues).toHaveBeenCalledTimes(2));
});

it("unsubscribes inventory when a project collapses", async () => {
  const unsubscribe = vi.fn();
  vi.mocked(subscribeWorkspaceInventory).mockReturnValue(unsubscribe);

  const { result } = renderHook(() => useSidebarTree(), { wrapper: routerWrapper("/projects") });
  act(() => result.current.toggleProjectExpanded("demo"));
  act(() => result.current.toggleProjectExpanded("demo"));

  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
```

Also test:

- active route auto-expands the project;
- one branch error leaves another branch usable;
- a later request cannot overwrite a newer generation;
- malformed project slug fails fast and never requests;
- project changed event reloads project roots only.

- [ ] **Step 2: Run the file and verify RED**

```bash
cd tracker && npm test -- src/hooks/__tests__/useSidebarTree.test.tsx
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the hook**

Public result:

```ts
export interface UseSidebarTreeResult {
  tree: SidebarProjectNode[];
  projectsLoading: boolean;
  projectsError: string | null;
  preferences: SidebarPreferences;
  toggleProjectExpanded(projectSlug: string): void;
  toggleWorkspaceExpanded(workspaceId: string): void;
  showAllWorkspaces(projectSlug: string): void;
  showAllSessions(workspaceId: string): void;
  updatePreferences(updater: (current: SidebarPreferences) => SidebarPreferences): void;
  reloadProjects(): Promise<void>;
  reloadProjectBranch(projectSlug: string): Promise<void>;
}
```

Implementation rules:

- one global `useAgentExecutions()` call;
- project roots loaded with the existing race-safe request generation pattern;
- `Map<string, SidebarProjectBranchInput>` cache stored immutably in state;
- branch load uses `Promise.all([listIssues(slug), listRecents(100)])`;
- filter recents by `projectSlug` before building;
- inventory streams incrementally; fallback to `fetchWorkspaceInventory`;
- subscriptions stored in a ref by slug and always closed on collapse/unmount;
- route ancestors union into expanded IDs without erasing user expansions;
- cached reopen renders stale immediately and performs one refresh;
- no catch block clears a successful previous snapshot.

- [ ] **Step 4: Run the hook file**

```bash
cd tracker && npm test -- src/hooks/__tests__/useSidebarTree.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/hooks/useSidebarTree.ts tracker/src/hooks/__tests__/useSidebarTree.test.tsx
git commit -m "feat(sidebar): load project branches lazily"
```

---

### Task 8: Render an accessible project tree

**Files:**
- Create: `tracker/src/components/layout/sidebar/ProjectNavigationTree.tsx`
- Create: `tracker/src/components/layout/sidebar/SidebarTreeRow.tsx`
- Create: `tracker/src/components/layout/sidebar/ProjectTreeItem.tsx`
- Create: `tracker/src/components/layout/sidebar/WorkspaceTreeItem.tsx`
- Create: `tracker/src/components/layout/sidebar/SessionTreeItem.tsx`
- Create: `tracker/src/components/layout/sidebar/SidebarBranchState.tsx`
- Create: `tracker/src/components/layout/sidebar/__tests__/ProjectNavigationTree.test.tsx`

- [ ] **Step 1: Write failing component tests**

Render a small tree and assert:

- one `tree` with nested `group` and `treeitem` roles;
- `aria-level`, `aria-selected`, and conditional `aria-expanded`;
- click content calls `onOpen`, chevron calls only `onToggle`;
- ArrowRight/ArrowLeft behavior follows Task 6;
- Enter opens the row;
- Shift+F10 opens its menu;
- focus uses roving `tabIndex` with exactly one visible row at `0`;
- status has text, not color alone;
- loading/error/stale/empty branch states render targeted controls;
- **Mais…** calls the relevant reveal callback.

Example:

```tsx
expect(screen.getByRole("tree", { name: "Projects" })).toBeVisible();
expect(screen.getByRole("treeitem", { name: /Macro Markets/ })).toHaveAttribute("aria-expanded", "true");
await user.keyboard("{ArrowRight}");
expect(screen.getByRole("treeitem", { name: /main/ })).toHaveFocus();
```

- [ ] **Step 2: Run the test and verify RED**

```bash
cd tracker && npm test -- src/components/layout/sidebar/__tests__/ProjectNavigationTree.test.tsx
```

Expected: FAIL because the components are absent.

- [ ] **Step 3: Implement shared row and typed item components**

`SidebarTreeRow` contract:

```ts
export interface SidebarTreeRowProps {
  id: string;
  level: 1 | 2 | 3;
  label: string;
  description: string | null;
  selected: boolean;
  expandable: boolean;
  expanded: boolean;
  statusLabel: string | null;
  trailingLabel: string | null;
  tabIndex: 0 | -1;
  onFocus(): void;
  onOpen(): void;
  onToggle(): void;
  onOpenMenu(): void;
  onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void;
}
```

The row never requests data and never owns mutation state. Item components map
their typed node to the shared row. Use `RecentStatusDot` plus a visible or
screen-reader status label. Keep a single scroll container in
`ProjectNavigationTree`.

- [ ] **Step 4: Run the component test**

```bash
cd tracker && npm test -- src/components/layout/sidebar/__tests__/ProjectNavigationTree.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/layout/sidebar/ProjectNavigationTree.tsx tracker/src/components/layout/sidebar/SidebarTreeRow.tsx tracker/src/components/layout/sidebar/ProjectTreeItem.tsx tracker/src/components/layout/sidebar/WorkspaceTreeItem.tsx tracker/src/components/layout/sidebar/SessionTreeItem.tsx tracker/src/components/layout/sidebar/SidebarBranchState.tsx tracker/src/components/layout/sidebar/__tests__/ProjectNavigationTree.test.tsx
git commit -m "feat(sidebar): render accessible project tree"
```

---

### Task 9: Implement menus and mutations

**Files:**
- Create: `tracker/src/hooks/useSidebarActions.ts`
- Create: `tracker/src/hooks/__tests__/useSidebarActions.test.tsx`
- Create: `tracker/src/components/layout/sidebar/SidebarContextMenu.tsx`
- Create: `tracker/src/components/layout/sidebar/SidebarRenameDialog.tsx`
- Create: `tracker/src/components/layout/sidebar/SidebarSessionMetadataDialog.tsx`
- Create: `tracker/src/components/layout/sidebar/SidebarConfirmDialog.tsx`
- Create: `tracker/src/components/layout/sidebar/__tests__/SidebarContextMenu.test.tsx`

- [ ] **Step 1: Write failing action-hook tests**

Mock services and assert:

- project rename calls `updateProject`;
- project remove archives first when required, then `deleteProject`;
- workspace rename calls `updateWorkspaceDisplayName`;
- workspace remove calls `removeWorkspaces`;
- thread rename/review/labels call `updateAssistantThread`;
- issue-backed rename calls `updateIssue`;
- thread archive calls `archiveAssistantThread`;
- archived thread delete calls `deleteAssistantThread`;
- successful mutation refreshes only the affected branch;
- failure returns `{ok:false,error}` and does not remove the node;
- concurrent duplicate action is ignored.

Public contract:

```ts
export interface UseSidebarActionsResult {
  pendingKey: string | null;
  runAction(request: SidebarActionRequest): Promise<SidebarActionResult>;
}
```

- [ ] **Step 2: Run the hook test and verify RED**

```bash
cd tracker && npm test -- src/hooks/__tests__/useSidebarActions.test.tsx
```

Expected: FAIL because the hook is absent.

- [ ] **Step 3: Implement mutation dispatch**

Use a discriminated request:

```ts
export type SidebarActionRequest =
  | { action: "rename-project"; projectSlug: string; name: string }
  | { action: "archive-project"; projectSlug: string }
  | { action: "remove-project"; projectSlug: string; archived: boolean }
  | { action: "rename-workspace"; projectSlug: string; path: string; name: string }
  | { action: "remove-workspace"; projectSlug: string; path: string }
  | { action: "update-thread"; threadId: number; input: UpdateAssistantThreadInput }
  | { action: "archive-thread"; threadId: number }
  | { action: "delete-thread"; threadId: number }
  | { action: "rename-issue"; projectSlug: string; identifier: string; title: string }
  | { action: "copy"; value: string };
```

Validate every request before calling a service. Catch unknown errors and return
the localized fallback; do not swallow exceptions silently.

- [ ] **Step 4: Write failing menu/dialog tests**

Assert:

- each node level shows the capability list in spec order;
- disabled action exposes its reason;
- destructive actions are after a separator;
- rename rejects blank/overlong values before dispatch;
- destructive confirmation requires exact target name;
- closing returns focus to the `···` trigger;
- pending action disables repeat submission;
- issue labels use issue form options; thread labels use metadata API.

- [ ] **Step 5: Run the menu test and verify RED**

```bash
cd tracker && npm test -- src/components/layout/sidebar/__tests__/SidebarContextMenu.test.tsx
```

Expected: FAIL because menu/dialog components are absent.

- [ ] **Step 6: Implement menu and dialogs**

Use Radix `DropdownMenu` and existing `Dialog` primitives. Keep dialog state in
`SidebarContextMenu`; item rows only supply node/action data. Confirmation input
must compare the trimmed value with the exact target label. On success, close
and call `onMutated(projectSlug)`; on failure, keep the dialog open and render
the returned message.

- [ ] **Step 7: Run targeted files sequentially**

```bash
cd tracker && npm test -- src/hooks/__tests__/useSidebarActions.test.tsx
cd tracker && npm test -- src/components/layout/sidebar/__tests__/SidebarContextMenu.test.tsx
```

Expected: each command exits 0.

- [ ] **Step 8: Commit**

```bash
git add tracker/src/hooks/useSidebarActions.ts tracker/src/hooks/__tests__/useSidebarActions.test.tsx tracker/src/components/layout/sidebar/SidebarContextMenu.tsx tracker/src/components/layout/sidebar/SidebarRenameDialog.tsx tracker/src/components/layout/sidebar/SidebarSessionMetadataDialog.tsx tracker/src/components/layout/sidebar/SidebarConfirmDialog.tsx tracker/src/components/layout/sidebar/__tests__/SidebarContextMenu.test.tsx
git commit -m "feat(sidebar): add contextual sidebar actions"
```

---

### Task 10: Add utility navigation, creation, search, and filters

**Files:**
- Create: `tracker/src/components/layout/sidebar/SidebarUtilityNav.tsx`
- Create: `tracker/src/components/layout/sidebar/SidebarNewSessionFlow.tsx`
- Create: `tracker/src/components/layout/sidebar/SidebarSearchLauncher.tsx`
- Create: `tracker/src/components/layout/sidebar/SidebarFiltersMenu.tsx`
- Create: `tracker/src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx`
- Create: `tracker/src/components/layout/sidebar/__tests__/SidebarFiltersMenu.test.tsx`
- Read/reuse: `tracker/src/components/sessions/NewStandaloneWorkspaceDialog.tsx`
- Read/reuse: `tracker/src/components/sessions/StartIssueSessionDialog.tsx`
- Read/reuse: `tracker/src/components/sessions/SessionQuickOpenLauncher.tsx`

- [ ] **Step 1: Write failing utility/new-session tests**

Required cases:

- active route resolving to a workspace skips project/workspace selection;
- a project route requires workspace selection;
- a global route requires project then workspace;
- create-new-workspace delegates to `NewStandaloneWorkspaceDialog`;
- successful creation navigates to the returned session;
- Search opens a command dialog over loaded projects/workspaces/sessions;
- Automations links to `/settings/templates`;
- Settings links to `/settings`;
- null/removed selection blocks submit with an explicit message.

- [ ] **Step 2: Run utility test and verify RED**

```bash
cd tracker && npm test -- src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx
```

Expected: FAIL because utility components are absent.

- [ ] **Step 3: Implement utility flow**

`SidebarNewSessionFlow` accepts:

```ts
export interface SidebarNewSessionFlowProps {
  open: boolean;
  selection: SidebarRouteSelection;
  tree: readonly SidebarProjectNode[];
  onOpenChange(open: boolean): void;
  onCreated(projectSlug: string, threadId: number): void;
}
```

Use explicit guards:

- no project → require project;
- project without a ready branch → load and disable workspace submit;
- no workspace → require workspace;
- issue workspace → `createIssueSessionThread`;
- project/standalone workspace → `createProjectSessionThread` with the selected
  workspace context supported by its current contract;
- service failure remains in the dialog.

- [ ] **Step 4: Write failing filter tests**

Assert sort/group/filter persistence, show archived, clear filters, collapse all,
mark all read, and malformed preference values falling back safely.

- [ ] **Step 5: Run filter test and verify RED**

```bash
cd tracker && npm test -- src/components/layout/sidebar/__tests__/SidebarFiltersMenu.test.tsx
```

Expected: FAIL because filter menu is absent.

- [ ] **Step 6: Implement filters**

The menu only changes `SidebarPreferences`; tree filtering stays pure in
`sidebarTree.ts`. “Mark all read” sets one ISO timestamp per currently visible
session ID. “Collapse all” empties expanded project/workspace IDs and closes all
subscriptions through the hook.

- [ ] **Step 7: Run targeted files sequentially**

```bash
cd tracker && npm test -- src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx
cd tracker && npm test -- src/components/layout/sidebar/__tests__/SidebarFiltersMenu.test.tsx
```

Expected: each command exits 0.

- [ ] **Step 8: Commit**

```bash
git add tracker/src/components/layout/sidebar/SidebarUtilityNav.tsx tracker/src/components/layout/sidebar/SidebarNewSessionFlow.tsx tracker/src/components/layout/sidebar/SidebarSearchLauncher.tsx tracker/src/components/layout/sidebar/SidebarFiltersMenu.tsx tracker/src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx tracker/src/components/layout/sidebar/__tests__/SidebarFiltersMenu.test.tsx
git commit -m "feat(sidebar): add utility navigation and filters"
```

---

### Task 11: Replace Recents + Boards in the desktop shell

**Files:**
- Modify: `tracker/src/components/layout/ProjectSidebar.tsx`
- Modify: `tracker/src/components/layout/__tests__/ProjectSidebar.test.tsx`
- Create: `tracker/src/components/layout/sidebar/SidebarCollapsedRail.tsx`
- Delete: `tracker/src/components/layout/RecentsSection.tsx`
- Delete: `tracker/src/components/layout/__tests__/RecentsSection.test.tsx`

- [ ] **Step 1: Rewrite sidebar integration tests**

Preserve existing tests for:

- project changed event;
- stale request generation;
- listener cleanup;
- brand asset path.

Replace old Recents/Boards assertions with:

- utility nav followed by one Projects tree;
- no headings named Recents or Boards;
- route-selected project expanded;
- collapse migrates `tracker-sidebar-collapsed` into versioned preferences;
- collapsed rail keeps current project/activity accessible through tooltips;
- one scroll region for the tree;
- project reload does not clear loaded branch snapshots.

- [ ] **Step 2: Run the integration file and verify RED**

```bash
cd tracker && npm test -- src/components/layout/__tests__/ProjectSidebar.test.tsx
```

Expected: FAIL against the old flat sidebar.

- [ ] **Step 3: Refactor `ProjectSidebar` into a shell**

The component should only:

1. read `useSidebarTree`;
2. render brand/collapse;
3. render `SidebarUtilityNav`;
4. render Projects header + `SidebarFiltersMenu`;
5. render `ProjectNavigationTree`;
6. render theme/profile footer;
7. switch to `SidebarCollapsedRail` when collapsed.

Keep `resolveTrackerAssetPath`. Move all storage functions to
`sidebarPreferences.ts`. Remove the direct `listProjects` and `RecentsSection`
logic from the component.

- [ ] **Step 4: Delete obsolete Recents component/tests**

Confirm with workspace search that no imports remain before deletion. Keep the
recents service/hook/type/path helpers.

- [ ] **Step 5: Run the integration file**

```bash
cd tracker && npm test -- src/components/layout/__tests__/ProjectSidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tracker/src/components/layout/ProjectSidebar.tsx tracker/src/components/layout/__tests__/ProjectSidebar.test.tsx tracker/src/components/layout/sidebar/SidebarCollapsedRail.tsx tracker/src/components/layout/RecentsSection.tsx tracker/src/components/layout/__tests__/RecentsSection.test.tsx
git commit -m "feat(sidebar): replace recents and boards with project tree"
```

---

### Task 12: Add the mobile drawer

**Files:**
- Modify: `tracker/src/components/layout/Layout.tsx`
- Create: `tracker/src/components/layout/sidebar/SidebarMobileDrawer.tsx`
- Create: `tracker/src/components/layout/sidebar/__tests__/SidebarMobileDrawer.test.tsx`

- [ ] **Step 1: Write failing mobile tests**

Assert:

- trigger is visible in the mobile shell and has an accessible name;
- opening renders the same sidebar content in a left Sheet;
- focus moves inside and remains trapped by Radix;
- Escape and backdrop close;
- navigation closes;
- expanded tree preferences survive close/reopen;
- desktop sidebar remains mounted only at `md` and above;
- drawer does not create a second project fetch/cache instance.

- [ ] **Step 2: Run the mobile file and verify RED**

```bash
cd tracker && npm test -- src/components/layout/sidebar/__tests__/SidebarMobileDrawer.test.tsx
```

Expected: FAIL because the drawer is absent.

- [ ] **Step 3: Implement shared state and drawer**

Lift one `useSidebarTree()` result into a layout-level provider or a
`SidebarTreeContext`; desktop and mobile presentations consume the same value.
Do not mount two hooks. Use existing `Sheet` with `side="left"` and override
padding/width for the 288px sidebar. Subscribe to location changes and close the
drawer after successful navigation.

- [ ] **Step 4: Run the mobile file**

```bash
cd tracker && npm test -- src/components/layout/sidebar/__tests__/SidebarMobileDrawer.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/layout/Layout.tsx tracker/src/components/layout/sidebar/SidebarMobileDrawer.tsx tracker/src/components/layout/sidebar/__tests__/SidebarMobileDrawer.test.tsx
git commit -m "feat(sidebar): add mobile project drawer"
```

---

### Task 13: Add localization and run focused acceptance checks

**Files:**
- Modify: `tracker/locales/en/tracker.json`
- Modify: `tracker/locales/pt-BR/tracker.json`
- Modify: `docs/superpowers/specs/2026-07-13-symphony-sidebar-redesign-design.md` only if implementation decisions changed.

- [ ] **Step 1: Add complete `layout.sidebar` translations**

Include both locales for:

- utility items;
- Projects heading;
- node type/status descriptions;
- loading/error/stale/empty states;
- retry and **Mais…**;
- every action and disabled reason;
- rename/session metadata/confirmation dialogs;
- sort/group/filter controls;
- mobile open/close labels;
- validation and mutation failure messages.

Remove `layout.recents` keys only if workspace search confirms no consumers.

- [ ] **Step 2: Run one frontend acceptance file at a time**

```bash
cd tracker && npm test -- src/lib/__tests__/sidebarTree.test.ts
cd tracker && npm test -- src/hooks/__tests__/useSidebarTree.test.tsx
cd tracker && npm test -- src/components/layout/sidebar/__tests__/ProjectNavigationTree.test.tsx
cd tracker && npm test -- src/components/layout/sidebar/__tests__/SidebarContextMenu.test.tsx
cd tracker && npm test -- src/components/layout/__tests__/ProjectSidebar.test.tsx
cd tracker && npm test -- src/components/layout/sidebar/__tests__/SidebarMobileDrawer.test.tsx
```

Expected: each command exits 0. Run sequentially; do not combine files in one
Vitest invocation.

- [ ] **Step 3: Run one backend acceptance file at a time**

```bash
cd elixir && mix test test/symphony_elixir/assistant/history_test.exs
cd elixir && mix test test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs
cd elixir && mix test test/symphony_elixir/workspace/display_name_test.exs
cd elixir && mix test test/symphony_elixir_web/controllers/tracker/workspace_display_name_controller_test.exs
cd elixir && mix test test/symphony_elixir_web/controllers/tracker/worktree_inventory_controller_test.exs
```

Expected: each command exits 0. Do not run `make all`, `npm test` without a
file, or repository-wide gates under WSL without asking the user first.

- [ ] **Step 4: Perform a focused browser check**

At desktop width verify:

- Project → Workspace → Session hierarchy;
- menus for all three levels;
- loading/stale/error branches;
- collapsed rail;
- route ancestor expansion.

At mobile width verify:

- trigger;
- drawer focus;
- navigation close;
- state retained after reopening.

Capture screenshots for desktop expanded, desktop collapsed, and mobile drawer.
Remove temporary debug logging before completion.

- [ ] **Step 5: Check changed-file diagnostics**

Read IDE diagnostics for only the files changed by this plan. Fix introduced
TypeScript, ESLint, Elixir compiler, and specs-check issues before handoff.

- [ ] **Step 6: Commit**

```bash
git add tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json docs/superpowers/specs/2026-07-13-symphony-sidebar-redesign-design.md
git commit -m "docs(sidebar): finalize navigation redesign"
```

If the spec did not change, omit it from `git add`. If translation changes were
already committed with their components, skip an empty commit.

---

## Acceptance criteria traceability

- Spec 15.1–15.2: Tasks 5, 8, 11.
- Spec 15.3: Tasks 6–8.
- Spec 15.4: Task 7.
- Spec 15.5: Tasks 5, 10.
- Spec 15.6–15.7: Tasks 1–4, 6, 9.
- Spec 15.8: Tasks 11–12.
- Spec 15.9: Tasks 6, 8, 12.
- Spec 15.10–15.11: Tasks 6–8.
- Spec 15.12: every task uses one targeted file/filter at a time; Task 13 records final evidence.

## Explicitly deferred

- editor/terminal endpoints for arbitrary standalone paths;
- cross-device preference sync;
- drag-and-drop pin ordering;
- tree virtualization;
- removing `ProjectSwitcher`;
- a standalone Automations product route;
- physical workspace, directory, or branch renaming.
