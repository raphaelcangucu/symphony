# Sidebar Sessions Performance & Flat Tree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Tracker sidebar and sessions list fast and Cursor-like (Project → Session, server-paginated) by removing inventory/issues from the expand path, collapsing duplicated `agent_executions` / `recents` HTTP traffic into single layout providers, and replacing both polls with PubSub + Phoenix Channel push.

**Architecture:** New lightweight `GET /projects/:slug/sessions` (cursor pagination) feeds a flat sidebar tree. **One** `AgentExecutionsProvider` and **one** `RecentsProvider` own the only socket subscriptions; all hooks read context (no per-hook HTTP poll). Inventory SSE is fixed for cleanup-only use and removed from sidebar/sessions list paths. Shared sessions cache prevents double-fetch on workspaces URLs.

**Tech Stack:** Elixir/Phoenix (channels, PubSub, Ecto/SQLite), React Tracker SPA, vitest, ExUnit.

**Spec:** [`docs/superpowers/specs/2026-07-14-sidebar-sessions-perf-design.md`](../specs/2026-07-14-sidebar-sessions-perf-design.md)

**WSL tests:** Run **one** narrowly targeted test file or filter at a time; never full suite / parallel / directory-wide batches. Ask before expanding scope. Same rule for every subagent prompt.

---

## File Structure

**Create (Elixir):**

- `elixir/lib/symphony_elixir/tracker/project_sessions.ex` — union + sort + cursor page of lightweight session rows
- `elixir/lib/symphony_elixir/agent_execution/broadcaster.ex` — PubSub topic + coalesce/debounce
- `elixir/lib/symphony_elixir/recents/broadcaster.ex` — PubSub topic for recents snapshot/upsert (debounced)
- `elixir/lib/symphony_elixir_web/channels/agent_execution_channel.ex` — `agent_executions` join + push
- `elixir/lib/symphony_elixir_web/channels/recents_channel.ex` — `recents` join + push
- `elixir/lib/symphony_elixir_web/controllers/tracker/project_session_controller.ex` — HTTP index
- `elixir/test/symphony_elixir/tracker/project_sessions_test.exs`
- `elixir/test/symphony_elixir/agent_execution/broadcaster_test.exs`
- `elixir/test/symphony_elixir/recents/broadcaster_test.exs`
- `elixir/test/symphony_elixir_web/channels/agent_execution_channel_test.exs`
- `elixir/test/symphony_elixir_web/channels/recents_channel_test.exs`
- `elixir/test/symphony_elixir_web/controllers/tracker/project_session_controller_test.exs`

**Create (Tracker):**

- `tracker/src/types/project-session.ts`
- `tracker/src/services/projectSessions.ts`
- `tracker/src/services/phoenix/agentExecutionChannel.ts`
- `tracker/src/services/phoenix/recentsChannel.ts`
- `tracker/src/hooks/AgentExecutionsProvider.tsx`
- `tracker/src/hooks/RecentsProvider.tsx`
- `tracker/src/lib/flatSidebarTree.ts`
- `tracker/src/hooks/__tests__/AgentExecutionsProvider.test.tsx`
- `tracker/src/hooks/__tests__/RecentsProvider.test.tsx`
- `tracker/src/lib/__tests__/flatSidebarTree.test.ts`
- `tracker/src/services/__tests__/projectSessions.test.ts`
- `tracker/src/services/__tests__/worktrees.subscribe.test.ts`

**Modify:**

- `elixir/lib/symphony_elixir_web/router.ex`
- `elixir/lib/symphony_elixir_web/channels/user_socket.ex`
- `elixir/lib/symphony_elixir_web/controllers/tracker/worktree_inventory_controller.ex`
- `elixir/lib/symphony_elixir_web/worktree_inventory_event_stream.ex`
- `elixir/lib/symphony_elixir/status_dashboard.ex` (hook execution broadcaster)
- `elixir/lib/symphony_elixir/assistant/history.ex` (and/or issue update paths) — notify recents broadcaster on thread/activity changes
- `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex` — `last_activity_at`
- `elixir/test/symphony_elixir_web/controllers/tracker/worktree_inventory_controller_test.exs`
- `tracker/src/hooks/useAgentExecutions.ts` — context only; zero independent polls
- `tracker/src/hooks/useRecents.ts` — context only; remove 8s interval
- `tracker/src/hooks/useSidebarTree.ts` — no `listRecents` / no local execution poll
- `tracker/src/hooks/useProjectSessions.ts` — no `listRecents`; read shared providers
- `tracker/src/components/layout/WorkspaceContext.tsx` — consume provider (no second poller)
- `tracker/src/pages/ObservabilityPage.tsx` — consume provider
- `tracker/src/components/launcher/useLauncherData.ts` — consume provider
- `tracker/src/services/worktrees.ts`
- `tracker/src/components/layout/Layout.tsx` — wrap both providers **once**
- `tracker/src/components/layout/sidebar/ProjectNavigationTree.tsx`
- `tracker/src/types/sidebar.ts` / `tracker/src/lib/sidebarTree.ts`
- Related `__tests__` for sidebar hooks/tree

### Current overload (must eliminate)

Observed on Advising workspaces URL — repeated curls like:

```text
GET /api/tracker/v1/agent_executions
Authorization: Bearer …
Referer: /tracker/projects/advising/workspaces/8006?assistant_agent=codex
```

**Why it multiplies today:**

| Consumer | Call pattern |
|----------|----------------|
| `useSidebarTree` → `useAgentExecutions()` | poll every **5s** |
| `WorkspaceContext` → `useAgentExecutions()` | **second** independent 5s poll |
| `useProjectSessions` → `useAgentExecutions()` | **third** independent 5s poll on same page |
| `ObservabilityPage` / launcher | more mounts when those UIs open |

Same class of waste for recents:

| Consumer | Call pattern |
|----------|----------------|
| `useRecents` | poll every **8s** while focused |
| `useSidebarTree` `sharedRecents()` / `listRecents(100)` | HTTP on every project expand |
| `useProjectSessions` | `listRecents(100)` again on page mount |

**Target:** at most **one** WebSocket subscription per feed (`agent_executions`, `recents`) for the whole SPA; HTTP snapshot only on join/reconnect/manual refetch — never N× pollers.

---

### Task 1: Fix inventory SSE Accept negotiation (406)

**Files:**

- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/worktree_inventory_controller.ex`
- Modify: `elixir/test/symphony_elixir_web/controllers/tracker/worktree_inventory_controller_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
test "GET /worktrees/events accepts text/event-stream Accept header", ctx do
  {:ok, issue} = Context.create_issue("wtapi", %{"title" => "SSE Accept"})
  ws = Path.join(ctx.segment_root, issue.identifier)
  File.mkdir_p!(ws)

  conn =
    authorize()
    |> put_req_header("accept", "text/event-stream")
    |> get("/api/tracker/v1/projects/wtapi/worktrees/events")

  assert conn.status == 200
  assert get_resp_header(conn, "content-type") == ["text/event-stream; charset=utf-8"]
  assert conn.resp_body =~ "event: done"
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir_web/controllers/tracker/worktree_inventory_controller_test.exs --only line:<LINE>`

Expected: FAIL with 406 / `Phoenix.NotAcceptableError`

- [ ] **Step 3: Minimal fix**

In `events/2`, force format before streaming (keep JSON actions unchanged):

```elixir
def events(conn, %{"project_slug" => project_slug}) do
  conn = Plug.Conn.put_private(conn, :phoenix_format, "json")

  case Context.get_project(project_slug) do
    {:ok, _project} ->
      WorktreeInventoryEventStream.stream(conn, project_slug, display_name_module())

    {:error, reason} ->
      TrackerErrors.render(conn, reason)
  end
end
```

If Phoenix still rejects before the action, skip `accepts` for `/worktrees/events` via a small plug, or drop controller-wide `formats: [:json]` and call `json/2` explicitly on JSON actions.

- [ ] **Step 4: Re-run the single test — PASS**

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/worktree_inventory_controller.ex \
  elixir/test/symphony_elixir_web/controllers/tracker/worktree_inventory_controller_test.exs
git commit -m "$(cat <<'EOF'
fix: accept text/event-stream for worktree inventory SSE

EventSource always sends Accept: text/event-stream; JSON-only formats caused 406 reconnect storms.
EOF
)"
```

---

### Task 2: Fix inventory SSE Bandit process ownership

**Files:**

- Modify: `elixir/lib/symphony_elixir_web/worktree_inventory_event_stream.ex`
- Modify: `elixir/test/symphony_elixir_web/controllers/tracker/worktree_inventory_controller_test.exs`

- [ ] **Step 1: Strengthen SSE test assertions**

```elixir
assert conn.resp_body =~ "event: entry"
assert conn.resp_body =~ "event: totals"
assert conn.resp_body =~ "event: done"
```

- [ ] **Step 2: Run Accept/SSE test — may crash with Agent chunking**

- [ ] **Step 3: Chunk only on the request process**

Delete the Agent wrapper. Prefer a correct-first approach using `Inventory.scan/2` then emit all events on the owner process:

```elixir
def stream(conn, project_slug, display_name_module) do
  conn = prepare_sse_headers(conn)
  aliases = aliases_or_empty(display_name_module, project_slug)

  case Inventory.scan(project_slug) do
    {:ok, %{workspaces: workspaces, totals: totals}} ->
      conn =
        Enum.reduce_while(workspaces, conn, fn entry, acc ->
          case chunk(acc, encode_event("entry", %{data: WorktreeInventoryPresenter.entry_json(entry, aliases)})) do
            {:ok, next} -> {:cont, next}
            _ -> {:halt, acc}
          end
        end)

      with {:ok, conn} <- chunk(conn, encode_event("totals", %{totals: WorktreeInventoryPresenter.totals_json(totals)})),
           {:ok, conn} <- chunk(conn, encode_event("done", %{})) do
        conn
      else
        _ -> conn
      end

    {:error, reason} ->
      chunk_failure(conn, reason)
  end
end
```

Optional follow-up: restore mid-scan streaming only if `emit` stays on the request process (no Agent/Task chunk).

- [ ] **Step 4: Re-run SSE test — PASS; no Bandit owner error in logs**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: chunk worktree inventory SSE on the request process

Bandit rejects Conn.chunk/2 from Agent workers; emit on the connection owner.
EOF
)"
```

---

### Task 3: Harden EventSource client (no reconnect storm)

**Files:**

- Modify: `tracker/src/services/worktrees.ts`
- Modify: `tracker/src/hooks/useProjectSessions.ts` (fallbackStarted guard)
- Create: `tracker/src/services/__tests__/worktrees.subscribe.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeWorkspaceInventory } from "@/services/worktrees";

describe("subscribeWorkspaceInventory", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("closes EventSource and calls onError only once", () => {
    const close = vi.fn();
    let onerror: (() => void) | null = null;
    class FakeEventSource {
      addEventListener = vi.fn();
      close = close;
      set onerror(handler: (() => void) | null) {
        onerror = handler;
      }
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    const onError = vi.fn();
    subscribeWorkspaceInventory("advising", {
      onEntry: vi.fn(),
      onTotals: vi.fn(),
      onError,
    });
    onerror?.();
    onerror?.();
    expect(close).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run**

`cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/services/__tests__/worktrees.subscribe.test.ts`

Expected: FAIL

- [ ] **Step 3: Fix**

```ts
source.onerror = () => {
  if (closed) return;
  closed = true;
  handlers.onError?.();
  source.close();
};
```

In `useProjectSessions`, guard inventory fallback with `fallbackStarted` ref (mirror sidebar).

- [ ] **Step 4: Re-run — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: close inventory EventSource after first error

Stops reconnect loops that stacked inventory fallback scans.
EOF
)"
```

---

### Task 4: Backend `ProjectSessions` domain module

**Files:**

- Create: `elixir/lib/symphony_elixir/tracker/project_sessions.ex`
- Create: `elixir/test/symphony_elixir/tracker/project_sessions_test.exs`

- [ ] **Step 1: Failing tests**

```elixir
defmodule SymphonyElixir.Tracker.ProjectSessionsTest do
  use SymphonyElixir.DataCase, async: false

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.ProjectSessions

  setup do
    {:ok, project} = Context.create_project(%{"name" => "Sessions Proj", "slug" => "sess-proj"})
    %{project: project}
  end

  test "returns limited lightweight rows ordered by updated_at desc", %{project: project} do
    {:ok, _} = History.create_project_session_thread(project.slug, %{title: "Older", agent_kind: "codex"})
    Process.sleep(5)
    {:ok, _} = History.create_project_session_thread(project.slug, %{title: "Newer", agent_kind: "codex"})

    assert {:ok, %{data: rows, meta: meta}} = ProjectSessions.list(project.slug, limit: 1)
    assert length(rows) == 1
    assert hd(rows).title == "Newer"
    assert is_binary(meta.next_cursor)
    refute Map.has_key?(hd(rows), :description)
  end

  test "cursor returns the next older row", %{project: project} do
    for title <- ["A", "B", "C"] do
      {:ok, _} = History.create_project_session_thread(project.slug, %{title: title})
      Process.sleep(5)
    end

    assert {:ok, %{data: [first], meta: %{next_cursor: cursor}}} =
             ProjectSessions.list(project.slug, limit: 1)

    assert {:ok, %{data: [second]}} =
             ProjectSessions.list(project.slug, limit: 1, cursor: cursor)

    assert first.id != second.id
  end

  test "payload never includes huge issue descriptions", %{project: project} do
    {:ok, _} =
      Context.create_issue(project.slug, %{
        "title" => "Heavy",
        "description" => String.duplicate("x", 50_000)
      })

    assert {:ok, %{data: rows}} = ProjectSessions.list(project.slug, limit: 50)
    refute String.contains?(Jason.encode!(rows), String.duplicate("x", 1000))
  end
end
```

Adapt helpers to match existing tracker DataCase patterns.

- [ ] **Step 2: Run — FAIL (module missing)**

`cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/tracker/project_sessions_test.exs`

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Tracker.ProjectSessions do
  @moduledoc false

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.LocalTracker.{Context, IssueRecord}
  alias SymphonyElixir.Repo
  import Ecto.Query

  @default_limit 20
  @max_limit 50

  @spec list(String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def list(project_slug, opts \\ []) when is_binary(project_slug) and is_list(opts) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      limit = opts |> Keyword.get(:limit, @default_limit) |> clamp_limit()
      include_archived = Keyword.get(opts, :include_archived, false)
      cursor = Keyword.get(opts, :cursor)

      rows =
        thread_rows(project_slug, include_archived, limit * 3)
        |> Kernel.++(issue_activity_rows(project_slug, include_archived, limit * 3))
        |> dedupe_by_id()
        |> Enum.sort_by(& &1.updated_at, {:desc, DateTime})
        |> apply_cursor(cursor)
        |> Enum.take(limit + 1)

      {page, rest} = Enum.split(rows, limit)
      next = List.first(rest)

      {:ok,
       %{
         data: page,
         meta: %{
           next_cursor: if(next, do: encode_cursor(next), else: nil),
           project_activity_at: page |> List.first() |> then(&(&1 && &1.updated_at))
         }
       }}
    end
  end

  defp clamp_limit(n) when is_integer(n), do: n |> max(1) |> min(@max_limit)
  defp clamp_limit(_), do: @default_limit

  defp thread_rows(slug, include_archived, limit) do
    History.list_threads(
      project_slug: slug,
      include_archived: include_archived,
      limit: limit,
      scopes: ["project_session", "project_explore", "issue", "issue_session", "workspace_session"]
    )
    |> Enum.map(&thread_row/1)
  end

  defp issue_activity_rows(slug, include_archived, limit) do
    {:ok, project} = Context.get_project(slug)

    IssueRecord
    |> where([i], i.project_id == ^project.id)
    |> then(fn q -> if include_archived, do: q, else: where(q, [i], is_nil(i.archived_at)) end)
    |> order_by([i], desc: i.updated_at, desc: i.id)
    |> limit(^limit)
    |> select([i], %{
      identifier: i.identifier,
      title: i.title,
      updated_at: i.updated_at,
      archived_at: i.archived_at
    })
    |> Repo.all()
    |> Enum.map(&issue_row(&1, slug))
  end

  # Also implement: thread_row/1, issue_row/2, dedupe_by_id/1,
  # apply_cursor/2, encode_cursor/1, decode_cursor/1, href helpers.
  # NEVER select or return issue.description.
end
```

Wire `href` to existing Tracker routes (`/tracker/projects/:slug/issues/...`, workspaces, assistant sessions) using current sidebar href builders as reference.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add ProjectSessions lightweight paginated listing

Server-side cursor pages for sidebar without issue descriptions or inventory.
EOF
)"
```

---

### Task 5: HTTP controller + router

**Files:**

- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/project_session_controller.ex`
- Create: `elixir/test/symphony_elixir_web/controllers/tracker/project_session_controller_test.exs`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`

- [ ] **Step 1: Failing controller tests** for `200` paginated JSON and `400` invalid cursor

- [ ] **Step 2: Run — FAIL (no route)**

- [ ] **Step 3: Implement**

Router (near worktrees):

```elixir
get("/projects/:project_slug/sessions", ProjectSessionController, :index)
```

Controller maps `ProjectSessions.list/2` → JSON with snake_case fields matching the spec (`updated_at`, `issue_identifier`, `workspace_path`, `workspace_id`, `aggregate_status`, `agent_kind`, `next_cursor`, `project_activity_at`).

- [ ] **Step 4: Run controller test — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: expose GET /projects/:slug/sessions API

Paginated lightweight sessions for sidebar and sessions page.
EOF
)"
```

---

### Task 6: `last_activity_at` on projects list

**Files:**

- Modify presenter / project index serialization
- Extend existing project controller test

- [ ] **Step 1: Failing test** — `GET /projects` includes `last_activity_at`

- [ ] **Step 2: Implement** cheap SQL `max(updated_at)` over threads/issues per project (batch). No inventory.

- [ ] **Step 3: Run single project test — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: include last_activity_at on tracker projects

Lets the sidebar sort projects by recency without expanding each branch.
EOF
)"
```

---

### Task 7: Agent execution PubSub broadcaster

**Files:**

- Create: `elixir/lib/symphony_elixir/agent_execution/broadcaster.ex`
- Create: `elixir/test/symphony_elixir/agent_execution/broadcaster_test.exs`
- Modify: `elixir/lib/symphony_elixir/status_dashboard.ex`
- Start GenServer from shared supervisor if required

- [ ] **Step 1: Failing test**

```elixir
test "publish broadcasts on topic agent_executions" do
  Phoenix.PubSub.subscribe(SymphonyElixir.PubSub, "agent_executions")
  :ok = SymphonyElixir.AgentExecution.Broadcaster.notify()
  # trigger flush if debounced
  assert_receive {:agent_execution_event, "snapshot", %{"data" => _}}, 1_000
end
```

- [ ] **Step 2: Implement GenServer**

- Topic: `"agent_executions"`
- `notify/0` cast `:dirty` from `StatusDashboard.notify_update/1`
- Debounce flush ~200ms (cap ~5 Hz)
- MVP: broadcast full snapshot `%{data: Enum.map(AgentExecution.list(), &TrackerPresenter.agent_execution/1)}`

- [ ] **Step 3: Run broadcaster test — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: broadcast agent execution snapshots over PubSub

Debounced pushes replace chatty HTTP polling as the live source of truth.
EOF
)"
```

---

### Task 8: `AgentExecutionChannel`

**Files:**

- Create: `elixir/lib/symphony_elixir_web/channels/agent_execution_channel.ex`
- Create: `elixir/test/symphony_elixir_web/channels/agent_execution_channel_test.exs`
- Modify: `elixir/lib/symphony_elixir_web/channels/user_socket.ex`

- [ ] **Step 1: Failing channel test** — join pushes `snapshot`; PubSub relay pushes again

- [ ] **Step 2: Implement**

```elixir
channel("agent_executions", SymphonyElixirWeb.AgentExecutionChannel)
```

Join: authorize like `ObservabilityChannel`; subscribe to PubSub; `send(self(), :after_join)` → `push(socket, "snapshot", %{data: ...})`.

`handle_info({:agent_execution_event, event, payload}, socket)` → `push(socket, event, payload)`.

- [ ] **Step 3: Run channel test — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add agent_executions Phoenix channel

Clients receive join snapshot plus PubSub-driven updates.
EOF
)"
```

---

### Task 9: Frontend sessions client + types

**Files:**

- Create: `tracker/src/types/project-session.ts`
- Create: `tracker/src/services/projectSessions.ts`
- Create: `tracker/src/services/__tests__/projectSessions.test.ts`

- [ ] **Step 1: Failing mapper test** (snake_case → camelCase page)

- [ ] **Step 2: Implement `listProjectSessions({ projectSlug, limit, cursor, includeArchived })`**

Default `limit: 20`. Path: `trackerPath(/projects/${slug}/sessions)`.

- [ ] **Step 3: Run vitest file — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add tracker client for paginated project sessions
EOF
)"
```

---

### Task 10: Flat sidebar tree builder

**Files:**

- Create: `tracker/src/lib/flatSidebarTree.ts`
- Create: `tracker/src/lib/__tests__/flatSidebarTree.test.ts`
- Modify: `tracker/src/types/sidebar.ts` as needed (`sessions`, `nextCursor`; workspaces empty/deprecated for nav)

- [ ] **Step 1: Failing test** — Project → Session order by `updatedAt` desc; `nextCursor` preserved; no workspace children required

- [ ] **Step 2: Implement** mapping `ProjectSessionRow` → `SidebarSessionNode` (keep `workspaceId` / path as metadata)

- [ ] **Step 3: Run — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: build flat project→session sidebar nodes
EOF
)"
```

---

### Task 11: Rewrite `useSidebarTree` branch load + tree UI

**Files:**

- Modify: `tracker/src/hooks/useSidebarTree.ts`
- Modify: `tracker/src/hooks/__tests__/useSidebarTree.test.tsx`
- Modify: `tracker/src/components/layout/sidebar/ProjectNavigationTree.tsx`
- Modify: `tracker/src/components/layout/sidebar/__tests__/ProjectNavigationTree.test.tsx`

- [ ] **Step 1: Update tests first**

Assert expand calls `listProjectSessions` once with `limit: 20`; does **not** call `listIssues` or `subscribeWorkspaceInventory`; renders sessions under project; “Mais…” uses `nextCursor` and appends.

- [ ] **Step 2: Run**

`cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/hooks/__tests__/useSidebarTree.test.tsx`

Expected: FAIL

- [ ] **Step 3: Implement**

`startBranchLoad` only fetches sessions page; set `inventorySettled: true` without SSE; sort projects by `lastActivityAt`; `ProjectNavigationTree` renders flat sessions (no workspace chevron level). Keep workspace actions on session menus via metadata.

- [ ] **Step 4: Run useSidebarTree test, then ProjectNavigationTree test (sequentially) — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: load sidebar branches from paginated sessions API

Drops inventory SSE and full issue lists from project expand.
EOF
)"
```

---

### Task 12: Shared sessions cache for page + sidebar

**Files:**

- Modify: `tracker/src/hooks/useProjectSessions.ts`
- Optionally: `tracker/src/hooks/projectSessionsCache.ts`

- [ ] **Step 1: Failing test** — two consumers → one HTTP get (mock counter)

- [ ] **Step 2: Implement** in-flight dedupe by slug; default sessions list **does not** open inventory EventSource (cleanup keeps inventory behind explicit entry)

- [ ] **Step 3: Run targeted test — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: dedupe project sessions fetches across sidebar and page
EOF
)"
```

---

### Task 13: Single `AgentExecutionsProvider` (kill duplicate HTTP polls)

**Files:**

- Create: `tracker/src/services/phoenix/agentExecutionChannel.ts`
- Create: `tracker/src/hooks/AgentExecutionsProvider.tsx`
- Create: `tracker/src/hooks/__tests__/AgentExecutionsProvider.test.tsx`
- Modify: `tracker/src/hooks/useAgentExecutions.ts`
- Modify: `tracker/src/components/layout/Layout.tsx`
- Modify: `tracker/src/components/layout/WorkspaceContext.tsx`
- Modify: `tracker/src/hooks/useProjectSessions.ts` (consume context; do not spawn poller)
- Modify: `tracker/src/pages/ObservabilityPage.tsx`
- Modify: `tracker/src/components/launcher/useLauncherData.ts`

- [ ] **Step 1: Failing tests**

```ts
it("does not call listAgentExecutions on an interval when channel is connected", async () => {
  vi.useFakeTimers();
  // mount Provider; mock usePhoenixChannel to succeed without HTTP
  await vi.advanceTimersByTimeAsync(20_000);
  expect(listAgentExecutions).toHaveBeenCalledTimes(0);
});

it("shares one map across sidebar + WorkspaceContext + useProjectSessions", async () => {
  // render tree with all three consumers under one Provider
  // spy listAgentExecutions — at most one join-fallback call total
});
```

- [ ] **Step 2: Implement**

1. Layout wraps **exactly one** `AgentExecutionsProvider`.
2. Provider: `usePhoenixChannel({ topic: "agent_executions" })`; handle `snapshot` / `upsert` / `remove`.
3. Join error → **one-shot** `listAgentExecutions()` fallback (not an interval).
4. `useAgentExecutions` **only** reads context (throw/dev-warn if used outside provider).
5. Delete `useFocusedInterval` / any 5s timer from this hook.
6. Grep guarantee: no second `createTrackerSocket`+`agent_executions` join elsewhere.

- [ ] **Step 3: Run provider test — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: single AgentExecutionsProvider over Phoenix channel

Eliminates duplicate GET /agent_executions polls from sidebar, workspace, and sessions mounts.
EOF
)"
```

---

### Task 14: Recents PubSub broadcaster + channel

**Files:**

- Create: `elixir/lib/symphony_elixir/recents/broadcaster.ex`
- Create: `elixir/lib/symphony_elixir_web/channels/recents_channel.ex`
- Create: `elixir/test/symphony_elixir/recents/broadcaster_test.exs`
- Create: `elixir/test/symphony_elixir_web/channels/recents_channel_test.exs`
- Modify: `elixir/lib/symphony_elixir_web/channels/user_socket.ex`
- Modify: thread create/update / issue activity paths to call `Recents.Broadcaster.notify/0`
- Optionally also notify from `AgentExecution.Broadcaster` flush (codex items in recents depend on executions)

- [ ] **Step 1: Failing tests**

```elixir
test "recents channel join pushes snapshot" do
  # subscribe_and_join "recents"
  assert_push "snapshot", %{"data" => data}
  assert is_list(data)
end

test "notify broadcasts debounced snapshot on topic recents" do
  Phoenix.PubSub.subscribe(SymphonyElixir.PubSub, "recents")
  :ok = SymphonyElixir.Recents.Broadcaster.notify()
  assert_receive {:recents_event, "snapshot", %{"data" => _}}, 1_000
end
```

- [ ] **Step 2: Implement**

- Topic: `"recents"`
- Debounced GenServer (~300–500ms): `Recents.list(limit: 100)` → present via existing RecentsController JSON shape / TrackerPresenter
- `notify/0` from: assistant thread insert/update/archive, relevant issue updates that affect codex recents, and optionally after execution snapshot flush
- Channel join: authorize like observability; push initial snapshot; relay PubSub

**Do not** rebuild the heavy `Recents.list` all-projects issue walk forever — while notifying, keep payload capped (`limit: 100`). A follow-up may slim `Recents.list` itself; out of scope unless tests show Advising still melts on each notify.

- [ ] **Step 3: Run broadcaster + channel tests (one file each) — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: push recents snapshots over PubSub channel

Replaces focus-interval HTTP polling with debounced realtime updates.
EOF
)"
```

---

### Task 15: Single `RecentsProvider` + stop expand-time `listRecents`

**Files:**

- Create: `tracker/src/services/phoenix/recentsChannel.ts`
- Create: `tracker/src/hooks/RecentsProvider.tsx`
- Create: `tracker/src/hooks/__tests__/RecentsProvider.test.tsx`
- Modify: `tracker/src/hooks/useRecents.ts`
- Modify: `tracker/src/hooks/useSidebarTree.ts` — remove `sharedRecents` / `listRecents` from `startBranchLoad`
- Modify: `tracker/src/hooks/useProjectSessions.ts` — do not call `listRecents`; filter provider sessions by project slug
- Modify: `tracker/src/components/layout/Layout.tsx` — wrap `RecentsProvider` once (beside executions)
- Modify: `tracker/src/hooks/__tests__/useRecents.test.tsx`
- Modify: `tracker/src/hooks/__tests__/useSidebarTree.test.tsx` — assert `listRecents` not called on expand

- [ ] **Step 1: Failing tests**

```ts
it("does not interval-poll listRecents when channel is connected", async () => {
  vi.useFakeTimers();
  // mount RecentsProvider
  await vi.advanceTimersByTimeAsync(30_000);
  expect(listRecents).toHaveBeenCalledTimes(0);
});

it("sidebar expand does not call listRecents", async () => {
  // expand project under providers; expect listProjectSessions only
  expect(listRecents).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Implement**

1. `RecentsProvider` joins `recents` channel; applies `snapshot` (replace list).
2. `useRecents` reads context; delete `setInterval` / focus refetch loop (optional: refetch once on window focus via channel reconnect or single HTTP — prefer channel only).
3. Sidebar branch load uses sessions API only (Task 11); project-filtered recents for cards come from provider if still needed, else drop.
4. `useProjectSessions` related sessions = `useRecents().sessions.filter(s => s.projectSlug === slug)`.

- [ ] **Step 3: Run RecentsProvider test, then useRecents test, then useSidebarTree test (sequentially) — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: single RecentsProvider over Phoenix channel

Stops 8s recents polling and duplicate listRecents on sidebar/page expand.
EOF
)"
```

---

### Task 16: Manual verification (Advising) — duplicate calls gone

- [ ] **Step 1: Restart tracker serve**

- [ ] **Step 2: Open** `http://localhost:4000/tracker/projects/advising/workspaces/8006?assistant_agent=codex`

- [ ] **Step 3: Network (DevTools, 30–60s idle)**

- No repeating `worktrees/events` 406
- No ~1MB `.../advising/issues` from sidebar expand
- `GET .../advising/sessions?limit=20` present and small
- **`GET /api/tracker/v1/agent_executions`:** zero on a steady page (or ≤1 only if channel join failed and fell back once) — **never** every 5s, never 2–3 parallel pollers
- **`GET /api/tracker/v1/recents`:** zero on a steady page (or ≤1 join fallback) — **never** every 8s; not fired again on each project expand
- WebSocket `/socket` shows channels `agent_executions` and `recents` (one join each)

- [ ] **Step 4: UI**

- Expand without stuck spinner
- Sessions newest-first under project (no workspace folder level)
- “Mais…” loads next page
- Live execution indicators still update when an agent runs
- Recents / related sessions update shortly after starting a new chat without waiting for an 8s tick

---

## Spec coverage

| Spec requirement | Task(s) |
|------------------|---------|
| Flat Project → Session | 10, 11 |
| Sort by recency | 4, 6, 10, 11 |
| Server pagination | 4, 5, 11 |
| No inventory on sidebar/list | 11, 12 |
| Fix inventory SSE | 1, 2, 3 |
| PubSub/channel executions | 7, 8, 13 |
| Dedup agent_executions HTTP | 13, 16 |
| Recents realtime (no 8s poll / no expand refetch) | 14, 15, 16 |
| No full issues in sidebar | 4, 11 |
| Shared sessions cache | 12 |
| Manual Advising check | 16 |

## Self-review notes

- No TBD placeholders.
- Topic consistently `agent_executions` and `recents`.
- Sessions path consistently `/api/tracker/v1/projects/:slug/sessions`.
- Default limit `20`, max `50`.
- Duplicate `GET /agent_executions` (sidebar + WorkspaceContext + sessions page) explicitly eliminated in Task 13 + verified in Task 16.
- Recents 8s poll + expand `listRecents` eliminated in Tasks 14–15.
