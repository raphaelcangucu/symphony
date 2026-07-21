# Workspace Header Without Issue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the working-tree header (Diff, Preview, Terminal, Ambiente, Tasks, Code, KB) on `/workspaces/:threadId` even when the thread has no issue, with docks and APIs scoped to the thread workspace path.

**Architecture:** Introduce a `WorkspaceScope` discriminated union (`issue` | `thread`). Always mount the session split layout from `AssistantSessionTabContent`. Migrate dock contexts from `openIssueIdentifier` to `openScope`. Add Elixir thread/workspace-path mirrors for editor, diff summaries, terminal sessions, and dev servers — never invent a synthetic `issue_identifier`.

**Tech Stack:** Elixir/Phoenix (tracker API, Terminal Registry, DevServer), React 19 + vitest (tracker), existing `IssueWorkingTreeToolbar` / dock pattern.

**Spec:** [`docs/superpowers/specs/2026-07-20-workspace-header-without-issue-design.md`](../specs/2026-07-20-workspace-header-without-issue-design.md)

**WSL tests:** Run **one** targeted test file or single filter at a time; never full suite / parallel / directory-wide batches. Ask before expanding scope. Same rule for every subagent prompt.

---

## File Structure

**Create:**

- `tracker/src/lib/workspaceScope.ts` — `WorkspaceScope` type + equality / key helpers + builders
- `tracker/src/lib/__tests__/workspaceScope.test.ts`
- `elixir/lib/symphony_elixir/editor.ex` — add `workspace_path_target/2` (same file)
- Thread editor action on `EditorController` or `AssistantThreadController`
- Terminal: `Registry.open_workspace_session/3` + channel topic for thread/workspace
- DevServer: path-keyed start/list helpers + migration for `workspace_path` on records

**Modify (frontend):**

- `tracker/src/components/sessions/AssistantSessionTabContent.tsx`
- `tracker/src/components/sessions/IssueSessionSplitLayout.tsx` (accept scope; keep filename or re-export as `WorkspaceSessionSplitLayout`)
- `tracker/src/components/sessions/IssueWorkingTreeToolbar.tsx`
- `tracker/src/components/sessions/session*DockContext.ts` (all four)
- `tracker/src/components/sessions/ProjectSessionsWorkspace.tsx`
- `tracker/src/components/sessions/Issue*Dock.tsx` (Preview / Terminal / Environment / Tasks)
- `tracker/src/components/terminal/TerminalWorkspacePanel.tsx` + `useTerminalChannel.ts`
- `tracker/src/hooks/useIssueEditor.ts` + `tracker/src/services/editor.ts`
- `tracker/src/hooks/useWorkspaceRepoSummaries.ts` + `tracker/src/services/gitDiff.ts`
- `tracker/src/hooks/useIssueDevServers.ts` + dev-server services
- `tracker/locales/en/tracker.json` + `pt-BR/tracker.json`
- Tests under `tracker/src/components/sessions/__tests__/`

**Modify (backend):**

- `elixir/lib/symphony_elixir/editor.ex`
- `elixir/lib/symphony_elixir_web/controllers/tracker/editor_controller.ex` (or assistant thread)
- `elixir/lib/symphony_elixir_web/controllers/tracker/workspace_diff_controller.ex` — `summaries_thread`
- `elixir/lib/symphony_elixir_web/router.ex`
- `elixir/lib/symphony_elixir/terminal/registry.ex` + `terminal_channel.ex`
- `elixir/lib/symphony_elixir/dev_server/manager.ex` + `DevServerRecord` + migration
- `elixir/lib/symphony_elixir_web/controllers/tracker/dev_server_controller.ex`
- Matching `*_test.exs` files

---

### Task 1: `WorkspaceScope` helpers

**Files:**

- Create: `tracker/src/lib/workspaceScope.ts`
- Create: `tracker/src/lib/__tests__/workspaceScope.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  issueWorkspaceScope,
  threadWorkspaceScope,
  workspaceScopeKey,
  workspaceScopesEqual,
} from "@/lib/workspaceScope";

describe("workspaceScope", () => {
  it("builds issue and thread scopes", () => {
    expect(issueWorkspaceScope("macro-markets", "510", 99)).toEqual({
      kind: "issue",
      projectSlug: "macro-markets",
      issueIdentifier: "510",
      threadId: 99,
    });
    expect(threadWorkspaceScope("macro-markets", 8076, "/ws/flaky-pipe")).toEqual({
      kind: "thread",
      projectSlug: "macro-markets",
      threadId: 8076,
      workspacePath: "/ws/flaky-pipe",
    });
  });

  it("compares scopes by identity fields", () => {
    const a = threadWorkspaceScope("p", 1, "/a");
    const b = threadWorkspaceScope("p", 1, "/b");
    expect(workspaceScopesEqual(a, b)).toBe(true);
    expect(workspaceScopesEqual(a, issueWorkspaceScope("p", "1"))).toBe(false);
  });

  it("stable keys for dock state", () => {
    expect(workspaceScopeKey(issueWorkspaceScope("p", "510"))).toBe("issue:p:510");
    expect(workspaceScopeKey(threadWorkspaceScope("p", 8076, null))).toBe("thread:p:8076");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/lib/__tests__/workspaceScope.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
export type WorkspaceScope =
  | {
      kind: "issue";
      projectSlug: string;
      issueIdentifier: string;
      threadId?: number;
    }
  | {
      kind: "thread";
      projectSlug: string;
      threadId: number;
      workspacePath: string | null;
    };

export function issueWorkspaceScope(
  projectSlug: string,
  issueIdentifier: string,
  threadId?: number,
): WorkspaceScope {
  const scope: WorkspaceScope = {
    kind: "issue",
    projectSlug: projectSlug.trim(),
    issueIdentifier: issueIdentifier.trim(),
  };
  if (threadId != null && Number.isInteger(threadId) && threadId > 0) {
    return { ...scope, threadId };
  }
  return scope;
}

export function threadWorkspaceScope(
  projectSlug: string,
  threadId: number,
  workspacePath: string | null,
): WorkspaceScope {
  if (!Number.isInteger(threadId) || threadId <= 0) {
    throw new Error("threadId must be a positive integer");
  }
  return {
    kind: "thread",
    projectSlug: projectSlug.trim(),
    threadId,
    workspacePath: workspacePath?.trim() || null,
  };
}

export function workspaceScopeKey(scope: WorkspaceScope): string {
  if (scope.kind === "issue") {
    return `issue:${scope.projectSlug}:${scope.issueIdentifier}`;
  }
  return `thread:${scope.projectSlug}:${scope.threadId}`;
}

export function workspaceScopesEqual(
  a: WorkspaceScope | null | undefined,
  b: WorkspaceScope | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  return workspaceScopeKey(a) === workspaceScopeKey(b);
}

export function workspaceScopeProvisioned(scope: WorkspaceScope): boolean {
  if (scope.kind === "issue") return scope.issueIdentifier.length > 0;
  return Boolean(scope.workspacePath);
}
```

- [ ] **Step 4: Re-run test — expect PASS**

- [ ] **Step 5: Commit** (only if user asked for commits; otherwise skip)

```bash
git add tracker/src/lib/workspaceScope.ts tracker/src/lib/__tests__/workspaceScope.test.ts
git commit -m "$(cat <<'EOF'
feat(tracker): add WorkspaceScope helpers for issue/thread docks

EOF
)"
```

---

### Task 2: Thread editor API

**Files:**

- Modify: `elixir/lib/symphony_elixir/editor.ex`
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex` (or editor controller)
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Test: `elixir/test/symphony_elixir/editor_test.exs` (or new `editor_workspace_path_test.exs`)
- Test: controller test for `GET /api/tracker/v1/assistant/threads/:thread_id/editor`

- [ ] **Step 1: Failing unit test for `Editor.workspace_path_target/2`**

```elixir
test "workspace_path_target builds browser url when directory exists" do
  dir = Path.join(System.tmp_dir!(), "symphony-editor-ws-#{System.unique_integer([:positive])}")
  File.mkdir_p!(dir)
  on_exit(fn -> File.rm_rf(dir) end)

  # Stub Config.editor_enabled? / status as existing editor tests do
  assert {:ok, url} = Editor.workspace_path_target("macro-markets", dir)
  assert is_binary(url)
end

test "workspace_path_target returns workspace_missing when path absent" do
  assert {:error, :workspace_missing} =
           Editor.workspace_path_target("macro-markets", "/no/such/symphony-ws")
end
```

Mirror existing editor test stubs for enabled/ready.

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/editor_test.exs --only line:<line>
```

- [ ] **Step 3: Implement `Editor.workspace_path_target/2` and `workspace_path_cursor_desktop_target/2`**

Reuse `resolve_project_editor_folder/2` + `build_browser_url/1` / `build_cursor_url/1` with the given absolute path (after `File.dir?/1`). Do **not** call `path_for_issue`.

- [ ] **Step 4: Controller + route**

```elixir
# router (inside tracker API scope)
get "/assistant/threads/:thread_id/editor", AssistantThreadController, :editor
```

```elixir
def editor(conn, %{"thread_id" => raw_id}) do
  with {:ok, thread} <- fetch_thread(raw_id),
       path when is_binary(path) and path != "" <- Map.get(thread, :workspace_path) do
    browser = editor_payload(Editor.workspace_path_target(thread.project_slug || "", path))
    cursor = editor_payload(Editor.workspace_path_cursor_desktop_target(thread.project_slug || "", path))
    json(conn, %{data: %{available: browser.available, url: browser.url, reason: browser.reason,
      cursor_desktop: %{available: cursor.available, url: cursor.url, reason: cursor.reason}}})
  else
    _ ->
      json(conn, %{data: %{available: false, url: nil, reason: "workspace_missing",
        cursor_desktop: %{available: false, url: nil, reason: "workspace_missing"}}})
  end
end
```

Reuse the same `editor_payload/1` helper as `EditorController` (extract to shared presenter if needed).

- [ ] **Step 5: Controller test PASS; commit if requested**

---

### Task 3: Thread diff summaries API

**Files:**

- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/workspace_diff_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Modify: `elixir/test/symphony_elixir_web/controllers/tracker/workspace_diff_controller_test.exs`
- Modify: `tracker/src/services/gitDiff.ts`
- Modify: `tracker/src/hooks/useWorkspaceRepoSummaries.ts`

- [ ] **Step 1: Failing controller test**

```elixir
test "summaries_thread returns repo summaries for thread workspace", %{conn: conn} do
  # arrange thread with workspace_path pointing at temp git repo (same helpers as stats_thread)
  conn = get(conn, "/api/tracker/v1/assistant/threads/#{thread.id}/diff/summaries")
  assert %{"data" => [_ | _]} = json_response(conn, 200)
end
```

- [ ] **Step 2: Implement**

```elixir
def summaries_thread(conn, %{"thread_id" => raw_id}) do
  with {:ok, workspace} <- thread_workspace(raw_id),
       {:ok, summaries} <- WorkspaceDiff.repo_summaries(workspace) do
    json(conn, %{data: summaries, workspace: workspace_brief(workspace)})
  else
    {:error, reason} -> TrackerErrors.render(conn, reason)
    :no_workspace -> json(conn, %{data: [], workspace: workspace_brief(nil)})
  end
end
```

Router:

```elixir
get "/assistant/threads/:thread_id/diff/summaries", WorkspaceDiffController, :summaries_thread
```

- [ ] **Step 3: Frontend service + hook**

```ts
export async function getThreadGitDiffSummaries(
  threadId: number,
  opts?: { signal?: AbortSignal },
): Promise<{ summaries: GitDiffRepoSummary[] }> {
  const response = await http.get(
    trackerPath(`/assistant/threads/${encodeURIComponent(String(threadId))}/diff/summaries`),
    { signal: opts?.signal },
  );
  return { summaries: (response.data?.data ?? []).map(normalizeRepoSummary) };
}
```

Extend `useWorkspaceRepoSummaries` with optional `threadId` (prefer thread when set, same pattern as `useWorkspaceDiffStats`).

- [ ] **Step 4: Targeted tests PASS**

---

### Task 4: Always mount session header (Diff + chip + KB/Tasks wiring)

**Files:**

- Modify: `tracker/src/components/sessions/AssistantSessionTabContent.tsx`
- Modify: `tracker/src/components/sessions/IssueSessionSplitLayout.tsx`
- Modify: `tracker/src/components/sessions/IssueWorkingTreeToolbar.tsx`
- Modify: `tracker/src/components/sessions/__tests__/AssistantSessionTabContent.test.tsx`
- Locales: workspace-not-provisioned tooltip strings

- [ ] **Step 1: Failing test — freeform thread shows toolbar**

```ts
it("shows working-tree toolbar for threads without issueIdentifier", async () => {
  getAssistantThreadMock.mockResolvedValue({
    id: 8076,
    scope: "freeform",
    agentKind: "codex",
    projectSlug: "macro-markets",
    projectName: "Macro Markets",
    issueIdentifier: null,
    workspacePath: "/workspaces/macro-markets/flaky-pipe",
    title: "Workspace: flaky-pipe",
    status: "active",
    preview: null,
    updatedAt: "2026-07-20T00:00:00Z",
  });

  render(/* MemoryRouter + dock providers */);

  expect(await screen.findByRole("button", { name: /diff/i })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /open issue/i })).toBeNull();
  expect(screen.getByText(/flaky-pipe/i)).toBeInTheDocument();
});
```

Provide all four dock contexts in the test (null openScope + vi.fn toggles).

- [ ] **Step 2: Implement layout always-on**

In `AssistantSessionTabContent`:

```ts
const issueIdentifier = thread?.issueIdentifier?.trim() || null;
const scope: WorkspaceScope | null = issueIdentifier
  ? issueWorkspaceScope(projectSlug, issueIdentifier, threadId)
  : thread
    ? threadWorkspaceScope(projectSlug, threadId, thread.workspacePath ?? null)
    : null;

// Always wrap when scope is non-null (thread loaded or optimistic)
```

Header start without issue:

```tsx
<span className={cn(sessionToolbarChipClassName, "font-mono")}>
  <GitBranch className="h-3 w-3 shrink-0" />
  <span className="truncate">
    {basename(thread?.workspacePath) || thread?.title || `thread-${threadId}`}
  </span>
</span>
```

Toolbar: hide Open Issue link when `scope.kind === "thread"`. Pass `pathActionsEnabled={workspaceScopeProvisioned(scope)}` to disable Terminal/Preview/Ambiente/Code when unprovisioned.

Wire `onKnowledgeBaseControlChange` / Diff for both branches (today only issue branch sets `kbControl`).

- [ ] **Step 3: Keep dock toggles calling scope** — for this task, IssueSessionSplitLayout may still use `issueIdentifier` string when `kind === "issue"`, and for `kind === "thread"` pass toggles that call `toggleX(scope)` once Task 5 lands. Until Task 5, temporary: only enable Diff/KB/Tasks for thread scope; Preview/Terminal/Ambiente buttons render disabled if contexts still require issue strings.

Prefer completing Task 5 before enabling those three buttons.

- [ ] **Step 4: Test PASS**

---

### Task 5: Dock contexts use `WorkspaceScope`

**Files:**

- Modify: `tracker/src/components/sessions/sessionTerminalDockContext.ts`
- Modify: `tracker/src/components/sessions/sessionPreviewDockContext.ts`
- Modify: `tracker/src/components/sessions/sessionEnvironmentDockContext.ts`
- Modify: `tracker/src/components/sessions/sessionTasksDockContext.ts`
- Modify: `tracker/src/components/sessions/ProjectSessionsWorkspace.tsx`
- Modify: `tracker/src/components/sessions/IssueSessionSplitLayout.tsx`
- Update all tests that construct `{ openIssueIdentifier, toggleTerminal }`

- [ ] **Step 1: Update context shape**

```ts
import type { WorkspaceScope } from "@/lib/workspaceScope";

export interface SessionTerminalDockControls {
  openScope: WorkspaceScope | null;
  toggleTerminal: (scope: WorkspaceScope) => void;
}
```

Same for Preview / Environment / Tasks.

- [ ] **Step 2: ProjectSessionsWorkspace state**

```ts
const [terminalDockScope, setTerminalDockScope] = useState<WorkspaceScope | null>(null);
// ...
const toggleTerminalDock = useCallback((scope: WorkspaceScope) => {
  setTerminalDockScope((current) =>
    workspaceScopesEqual(current, scope) ? null : scope,
  );
  setPreviewDockScope(null);
  // clear other docks + fullscreen flags (same as today)
}, []);
```

Render docks when scope non-null; pass `scope` prop into each dock.

- [ ] **Step 3: Fix call sites** (`IssueSessionSplitLayout`, `AssistantSessionTabContent` tests, `Issue*Dock` tests) to pass `WorkspaceScope`.

- [ ] **Step 4: One targeted test file PASS, then next file — never batch**

---

### Task 6: Code menu for thread scope

**Files:**

- Modify: `tracker/src/services/editor.ts` — `fetchThreadEditorTargets(threadId)`
- Modify: `tracker/src/hooks/useIssueEditor.ts` — accept `threadId?: number | null` (prefer thread)
- Modify: `tracker/src/components/issues/IssueEditorMenu.tsx` — optional `threadId`; when set, ignore identifier requirement
- Modify: `IssueWorkingTreeToolbar` to pass `threadId` for `kind: "thread"`

- [ ] **Step 1: Service + hook tests** (mock http)

- [ ] **Step 2: Implement `GET` client against Task 2 route**

- [ ] **Step 3: Toolbar shows Code for freeform thread with provisioned path; disabled + tooltip when `workspace_missing`**

---

### Task 7: Ambiente dock for thread scope

**Files:**

- Modify: `tracker/src/components/sessions/IssueEnvironmentDock.tsx`
- Modify: `tracker/src/components/sessions/__tests__/IssueEnvironmentDock.test.tsx`

- [ ] **Step 1: Accept `scope: WorkspaceScope`**

When `kind === "thread"`:

- `useWorkspaceDiffStats({ threadId: scope.threadId })`
- `useWorkspaceRepoSummaries({ threadId: scope.threadId })`
- Skip `getIssue` / `useIssuePullRequests` / `useIssueCommitEvidence` (omit PR + issue commits sections)

When `kind === "issue"`: keep current behavior; prefer `threadId` on scope for diff when present.

- [ ] **Step 2: Test** — thread scope renders branch/diff without PR links

---

### Task 8: Terminal for thread workspace path

**Files:**

- Modify: `elixir/lib/symphony_elixir/terminal/registry.ex`
- Modify: `elixir/lib/symphony_elixir_web/channels/terminal_channel.ex`
- Modify: `tracker/src/hooks/useTerminalChannel.ts`
- Modify: `tracker/src/components/terminal/TerminalWorkspacePanel.tsx`
- Modify: `tracker/src/lib/workspaceTabs/types.ts` — `thread-terminal` tab kind
- Modify: `tracker/src/components/sessions/IssueTerminalDock.tsx`
- Tests: registry + channel + panel

- [ ] **Step 1: Registry API**

```elixir
@spec open_workspace_session(String.t(), String.t(), keyword()) ::
        {:ok, session()} | {:error, String.t() | atom()}
def open_workspace_session(project_slug, workspace_path, opts \\ [])
    when is_binary(project_slug) and is_binary(workspace_path) do
  # require File.dir?(workspace_path)
  # session_name: "symphony-ws-" <> short_hash(project_slug, Path.expand(workspace_path))
  # cwd: Path.expand(workspace_path)
  # do NOT call IssueAdapter / path_for_issue
end
```

Session map may keep `issue_identifier: nil` and add `workspace_path`.

- [ ] **Step 2: Channel join**

New topic, e.g. `terminal:workspace:<project_slug>:<url_encoded_path_or_token>`, **or** join payload:

```elixir
def join("terminal:thread:" <> thread_id, %{"project_slug" => project_slug}, socket) do
  with {:ok, thread} <- History.get_thread(thread_id),
       path when is_binary(path) <- thread.workspace_path,
       {:ok, session} <- Registry.open_workspace_session(project_slug, path) do
    {:ok, %{session: ...}, assign(socket, workspace_path: path, ...)}
  end
end
```

Prefer **thread id topic** (`terminal:thread:<id>`) so the client never puts absolute paths in the topic string.

- [ ] **Step 3: Frontend**

`TerminalWorkspacePanel` props become:

```ts
interface TerminalWorkspacePanelProps {
  projectSlug: string;
  issueIdentifier?: string;
  threadId?: number;
  ...
}
```

Require exactly one of `issueIdentifier` | `threadId`. Canonical tab: `createThreadTerminalTab(threadId, title)`.

`useTerminalChannel` joins `terminal:thread:${threadId}` when `threadId` set.

- [ ] **Step 4: IssueTerminalDock** → rename prop to `scope`; branch panel props.

- [ ] **Step 5: Targeted tests PASS**

---

### Task 9: Dev servers + Preview for workspace path

**Files:**

- Migration: `elixir/priv/repo/migrations/*_dev_servers_workspace_path.exs`
- Modify: `elixir/lib/symphony_elixir/local_tracker/dev_server_record.ex`
- Modify: `elixir/lib/symphony_elixir/dev_server/manager.ex`
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/dev_server_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Modify: `elixir/lib/symphony_elixir_web/dev_server_event_stream.ex` (+ output stream)
- Frontend: `useIssueDevServers` / services → thread variants
- `IssuePreviewDock` accepts `WorkspaceScope`

- [ ] **Step 1: Migration**

```elixir
alter table(:local_tracker_dev_servers) do
  add :workspace_path, :text
end

# Drop or relax NOT NULL on issue_identifier if present
# unique_index [:project_id, :workspace_path, :slug] where workspace_path is not null
# check: (issue_identifier is not null and workspace_path is null)
#      or (issue_identifier is null and workspace_path is not null)
```

- [ ] **Step 2: `Manager.start_for_workspace(project_slug, workspace_path, opts)`**

Copy `start_for_issue` path resolution but use the provided path instead of `issue_workspace_path/1`. Persist records with `workspace_path` set and `issue_identifier` nil.

- [ ] **Step 3: HTTP**

```elixir
get "/assistant/threads/:thread_id/dev_servers", DevServerController, :index_thread
post "/assistant/threads/:thread_id/dev_servers/start", DevServerController, :start_thread
# stop/restart/events mirrors — resolve thread → workspace_path → Manager
```

- [ ] **Step 4: Frontend Preview dock** uses thread APIs when `scope.kind === "thread"`.

- [ ] **Step 5: Tests** — index/start for thread with temp workspace; no synthetic issue id in DB.

---

### Task 10: Tasks dock + KB for thread scope

**Files:**

- Modify: `IssueTasksDock` — title/aria use scope key / thread title instead of issue id
- Modify: `AssistantSessionTabContent` — always `onKnowledgeBaseControlChange` + `onTasksDockControlChange`
- Modify: `IssueWorkingTreeToolbar` / documents trigger — for thread, open project KB modal (composer control) without `IssueDocumentsDrawer` requiring identifier

- [ ] **Step 1:** Tasks dock already reads `useSessionTasksDockFeed()` — only needs openScope identity match; ensure `ProjectAssistantPanel` publishes feed for freeform threads (verify; fix if gated on `issueIdentifier`).

- [ ] **Step 2:** KB button without issue calls `kbControl.open` from panel; hide issue-only changed-doc badge or show project-level count if already available.

- [ ] **Step 3: Test** — freeform thread toolbar toggles tasks dock; KB button present.

---

### Task 11: End-to-end wiring + regression

**Files:**

- `AssistantSessionTabContent.test.tsx` — full freeform + issue regression
- `IssueSessionSplitLayout.test.tsx`
- `ProjectSessionsWorkspace` dock mutual exclusivity test (if exists; else extend)

- [ ] **Step 1: Freeform checklist assertions**

Toolbar has: Diff, Terminal, Preview, Ambiente, Tasks, Code, KB; no Open Issue.

- [ ] **Step 2: Issue-bound checklist**

Still has Open Issue; toggles still work with `kind: "issue"` scope.

- [ ] **Step 3: Manual smoke** on `http://localhost:4000/tracker/projects/macro-markets/workspaces/8076`

- [ ] **Step 4: Commit** (if user requested)

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Header always on without issue | 4, 11 |
| Diff by threadId | 4 (existing API) |
| Preview works via workspace path | 5, 9 |
| Terminal cwd = workspace_path | 5, 8 |
| Ambiente without PR/commits | 3, 7 |
| Tasks | 5, 10 |
| Code via thread editor | 2, 6 |
| KB without ensureIssueKbPage | 10 |
| Open issue hidden | 4 |
| Workspace chip basename | 4 |
| Unprovisioned disabled + tooltip | 4, 6 |
| No synthetic issue_identifier | 2, 8, 9 |
| Dock mutual exclusivity | 5 |
| WorkspaceScope type | 1 |

## Placeholder / ambiguity resolutions

- Dock React state keys use `workspaceScopeKey` (`thread:slug:id`) — **UI-only**, never written to `issue_identifier` columns.
- Terminal topic uses `terminal:thread:<id>`, not raw filesystem paths.
- Dev servers persist `workspace_path` + null `issue_identifier` with a check constraint.
- Incremental renames (`Issue*` filenames) are optional; behavior and context contracts are mandatory.
