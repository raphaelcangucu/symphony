# Session Title Nomenclature Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. **WSL:** run one targeted test file or filter at a time; never the full suite. Do not commit unless the user explicitly asks.

**Goal:** Persist canonical per-scope session titles, lock auto-title after user rename, fix session rename to update `Thread.title`, and show session titles + sidebar `ChatStatusIcon` on workspace tabs.

**Architecture:** Add `SymphonyElixir.Assistant.SessionTitles` for default title strings. Wire create paths (`History`, `ExecutionSession`) and title PATCH (`title_user_set`) through that helper + an updated `TitleGenerator.auto_eligible?/1`. On the tracker, route sidebar session rename to `rename-thread`, change `resolveWorkspaceTabPresentation` to prefer `tab.title`, and render `ChatStatusIcon` in `WorkspaceTabBar` from presentation status props.

**Tech Stack:** Elixir/Ecto, React/TypeScript, Vitest, ExUnit

**Spec:** `docs/superpowers/specs/2026-07-17-session-title-nomenclature-design.md`

---

## File map

| File | Role |
|------|------|
| Create: `elixir/lib/symphony_elixir/assistant/session_titles.ex` | Pure default-title helpers |
| Create: `elixir/test/symphony_elixir/assistant/session_titles_test.exs` | Unit tests for defaults |
| Modify: `elixir/lib/symphony_elixir/assistant/title_generator.ex` | Eligibility: drop `generic_title?` gate; honor `title_user_set` |
| Modify: `elixir/test/symphony_elixir/assistant/title_generator_test.exs` | Eligibility tests |
| Modify: `elixir/lib/symphony_elixir/assistant/history.ex` | Defaults on create; stamp `title_user_set` on title PATCH |
| Modify: `elixir/lib/symphony_elixir/agent/execution_session.ex` | `Run · {ID} · {issue title}` on create |
| Modify: `elixir/test/symphony_elixir/assistant/history_test.exs` | Title lock + defaults (targeted cases) |
| Modify: `tracker/src/lib/sidebarMenuPolicy.ts` | Session rename → `rename-thread` |
| Modify: `tracker/src/components/layout/sidebar/SidebarContextMenu.tsx` | `targetType: "thread"` for sessions with `threadId` |
| Create: `tracker/src/lib/__tests__/sidebarMenuPolicy.test.ts` | Rename request tests |
| Modify: `tracker/src/lib/workspaceTabs/presentation.ts` | Label prefers session title; optional status icon props |
| Modify: `tracker/src/lib/workspaceTabs/__tests__/presentation.test.ts` | Label + icon presentation |
| Modify: `tracker/src/components/workspace/WorkspaceTabBar.tsx` | Render `ChatStatusIcon` when provided |
| Modify: `tracker/src/components/sessions/ProjectSessionsWorkspace.tsx` | Resolve tab presentation with status from sessions/recents; keep tab titles in sync |
| Modify: `tracker/src/components/sessions/StartIssueSessionDialog.tsx` | Prefill canonical `Chat · …` default (or omit title for server default) |

---

### Task 1: Fix session rename → `rename-thread`

**Files:**
- Create: `tracker/src/lib/__tests__/sidebarMenuPolicy.test.ts`
- Modify: `tracker/src/lib/sidebarMenuPolicy.ts`
- Modify: `tracker/src/components/layout/sidebar/SidebarContextMenu.tsx`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { sidebarRenameRequest } from "@/lib/sidebarMenuPolicy";
import type { SidebarCapabilityContext, SidebarSessionNode } from "@/types/sidebar";

function session(overrides: Partial<SidebarSessionNode> = {}): SidebarSessionNode {
  return {
    kind: "session",
    id: "thread:7",
    projectSlug: "demo",
    workspaceId: null,
    sessionKind: "chat",
    title: "Chat · GAM-20 · Fix login",
    subtitle: "GAM-20",
    href: "/projects/demo/workspaces?session=7",
    statusKind: "idle",
    aggregateStatus: "idle",
    agentKind: "codex",
    updatedAt: "2026-07-17T00:00:00Z",
    threadId: 7,
    issueIdentifier: "GAM-20",
    archived: false,
    unread: false,
    needsReview: false,
    labels: null,
    issueLabelNames: null,
    pinned: false,
    ...overrides,
  };
}

const context = {} as SidebarCapabilityContext;

describe("sidebarRenameRequest", () => {
  it("renames issue-backed sessions via rename-thread when threadId exists", () => {
    expect(sidebarRenameRequest(session(), context, "My name")).toEqual({
      action: "rename-thread",
      projectSlug: "demo",
      threadId: 7,
      title: "My name",
    });
  });

  it("returns null for issue-backed session rows without threadId", () => {
    expect(sidebarRenameRequest(session({ threadId: null }), context, "My name")).toBeNull();
  });
});
```

Adjust the `SidebarSessionNode` fixture fields to match the real type if the compiler complains (copy a fixture from `flatSidebarTree.test.ts`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/lib/__tests__/sidebarMenuPolicy.test.ts`

Expected: FAIL — current code returns `rename-issue`.

- [ ] **Step 3: Implement rename routing**

In `sidebarMenuPolicy.ts`, replace the session branch:

```ts
  if (node.kind !== "session") return null;
  if (node.threadId === null) return null;
  return {
    action: "rename-thread",
    projectSlug: node.projectSlug,
    threadId: node.threadId,
    title: name,
  };
```

In `SidebarContextMenu.tsx` `case "rename"`, prefer thread when the session has a `threadId`:

```ts
      case "rename": {
        const targetType =
          node.kind === "project"
            ? "project"
            : node.kind === "workspace"
              ? "workspace"
              : node.kind === "session" && node.threadId !== null
                ? "thread"
                : node.issueIdentifier
                  ? "issue"
                  : "thread";
        openDialog({ type: "rename", targetType });
        return;
      }
```

- [ ] **Step 4: Re-run test**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/lib/__tests__/sidebarMenuPolicy.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** (only if user asked)

```bash
git add tracker/src/lib/sidebarMenuPolicy.ts tracker/src/lib/__tests__/sidebarMenuPolicy.test.ts tracker/src/components/layout/sidebar/SidebarContextMenu.tsx
git commit -m "$(cat <<'EOF'
fix: rename sidebar sessions via thread title

EOF
)"
```

---

### Task 2: `SessionTitles` defaults + auto-title eligibility + `title_user_set`

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/session_titles.ex`
- Create: `elixir/test/symphony_elixir/assistant/session_titles_test.exs`
- Modify: `elixir/lib/symphony_elixir/assistant/title_generator.ex`
- Modify: `elixir/test/symphony_elixir/assistant/title_generator_test.exs`
- Modify: `elixir/lib/symphony_elixir/assistant/history.ex` (`normalize_sidebar_metadata_patch` / title persist path)
- Modify: `elixir/test/symphony_elixir/assistant/history_test.exs` (add focused cases)

- [ ] **Step 1: Failing tests for defaults**

```elixir
defmodule SymphonyElixir.Assistant.SessionTitlesTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.SessionTitles

  test "issue_session and issue_execution prefixes" do
    assert SessionTitles.default_title("issue_session",
             identifier: "GAM-20",
             issue_title: "Fix login race"
           ) == "Chat · GAM-20 · Fix login race"

    assert SessionTitles.default_title("issue_execution",
             identifier: "GAM-20",
             issue_title: "Fix login race"
           ) == "Run · GAM-20 · Fix login race"

    assert SessionTitles.default_title("issue_session", identifier: "GAM-20", issue_title: nil) ==
             "Chat · GAM-20"
  end

  test "workspace / explore / freeform / kb" do
    assert SessionTitles.default_title("project_session", workspace_name: "spike") ==
             "Workspace · spike"

    assert SessionTitles.default_title("project_explore", project_name: "Demo") ==
             "Explore · Demo"

    assert SessionTitles.default_title("freeform", []) == "Chat"

    assert SessionTitles.default_title("kb", page_title: "Runbook") == "KB · Runbook"
  end
end
```

- [ ] **Step 2: Run to verify fail**

Run: `cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/assistant/session_titles_test.exs`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `SessionTitles`**

```elixir
defmodule SymphonyElixir.Assistant.SessionTitles do
  @moduledoc false

  @separator " · "
  @max_graphemes 160

  @spec default_title(String.t(), keyword()) :: String.t()
  def default_title(scope, opts \\ []) when is_binary(scope) and is_list(opts) do
    title =
      case scope do
        "issue_session" -> issue_prefixed("Chat", opts)
        "issue_execution" -> issue_prefixed("Run", opts)
        "project_session" -> join(["Workspace", workspace_name(opts)])
        "workspace_session" -> join(["Workspace", workspace_name(opts)])
        "project_explore" -> join(["Explore", project_name(opts)])
        "freeform" -> "Chat"
        "kb" -> join(["KB", page_title(opts)])
        _ -> "Chat"
      end

    truncate(title)
  end

  defp issue_prefixed(type, opts) do
    id = blank_to_nil(Keyword.get(opts, :identifier))
    issue_title = blank_to_nil(Keyword.get(opts, :issue_title))

    cond do
      id && issue_title && issue_title != id -> join([type, id, issue_title])
      id -> join([type, id])
      true -> type
    end
  end

  defp workspace_name(opts),
    do: blank_to_nil(Keyword.get(opts, :workspace_name)) || blank_to_nil(Keyword.get(opts, :workspace_basename)) || "workspace"

  defp project_name(opts),
    do: blank_to_nil(Keyword.get(opts, :project_name)) || blank_to_nil(Keyword.get(opts, :project_slug)) || "project"

  defp page_title(opts),
    do: blank_to_nil(Keyword.get(opts, :page_title)) || "page"

  defp join(parts), do: parts |> Enum.reject(&is_nil/1) |> Enum.join(@separator)

  defp blank_to_nil(nil), do: nil
  defp blank_to_nil(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end
  defp blank_to_nil(_), do: nil

  defp truncate(title) do
    if String.length(title) <= @max_graphemes, do: title, else: String.slice(title, 0, @max_graphemes)
  end
end
```

Prefer grapheme-aware truncation if `TitleGenerator` already has a helper — reuse it instead of `String.slice` if available (`normalize_title` / private truncate). Prefer calling into a shared truncate rather than duplicating incorrectly; if only byte/codepoint slice exists elsewhere, match `History`/`TitleGenerator` (graphemes).

- [ ] **Step 4: Change `auto_eligible?`**

In `title_generator.ex`:

```elixir
  def auto_eligible?(%{metadata: metadata} = _thread) when is_map(metadata) do
    Map.get(metadata, "title_auto_eligible") == true and
      is_nil(Map.get(metadata, "title_auto_generated_at")) and
      Map.get(metadata, "title_user_set") != true
  end
```

Update `title_generator_test.exs`:

```elixir
  test "auto_eligible? requires flag, no user lock, and no prior auto stamp" do
    eligible = %{
      title: "Chat · GAM-20 · Fix login race",
      metadata: %{"title_auto_eligible" => true}
    }

    assert TitleGenerator.auto_eligible?(eligible)

    refute TitleGenerator.auto_eligible?(%{
             title: "Chat · GAM-20 · Fix login race",
             metadata: %{"title_auto_eligible" => true, "title_user_set" => true}
           })

    refute TitleGenerator.auto_eligible?(%{
             title: "Chat · GAM-20 · Fix login race",
             metadata: %{}
           })

    refute TitleGenerator.auto_eligible?(%{
             title: "Chat · GAM-20 · Fix login race",
             metadata: %{
               "title_auto_eligible" => true,
               "title_auto_generated_at" => "2026-07-16T00:00:00Z"
             }
           })
  end
```

- [ ] **Step 5: Stamp `title_user_set` on title PATCH**

In `history.ex`, extend `normalize_sidebar_metadata_patch/1` (or the title branch of `update_thread_sidebar_metadata`) so when a title is present in attrs, the JSON patch includes `"title_user_set" => true`.

Minimal approach inside `update_thread_sidebar_metadata`:

```elixir
  def update_thread_sidebar_metadata(id, attrs) when is_integer(id) and id > 0 and is_map(attrs) do
    with {:ok, title_attrs} <- normalize_sidebar_title(attrs),
         {:ok, metadata_patch} <- normalize_sidebar_metadata_patch(attrs),
         metadata_patch <- maybe_put_title_user_set(metadata_patch, title_attrs),
         {:ok, metadata_patch_json} <- encode_metadata_patch(metadata_patch) do
      persist_sidebar_update(id, title_attrs, metadata_patch_json)
    end
  end

  defp maybe_put_title_user_set(patch, %{title: _}), do: Map.put(patch, "title_user_set", true)
  defp maybe_put_title_user_set(patch, _), do: patch
```

Wire `encode_metadata_patch` to whatever the function already uses today for `metadata_patch_json` (keep existing encode path; only inject the key into the patch map before encode).

Add history test:

```elixir
  test "update_thread_sidebar_metadata sets title_user_set when title changes" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Chat", workspace_path: "/tmp/title-user-set"})
    assert {:ok, updated} = History.update_thread_sidebar_metadata(thread.id, %{title: "Renamed"})
    assert updated.title == "Renamed"
    assert updated.metadata["title_user_set"] == true
  end
```

- [ ] **Step 6: Run targeted Elixir tests sequentially**

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/assistant/session_titles_test.exs
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/assistant/title_generator_test.exs
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/assistant/history_test.exs --only line:<line-of-new-test>
```

Or filter by test name if supported: `mix test test/symphony_elixir/assistant/history_test.exs -e "title_user_set"` — prefer a dedicated small describe / unique name and:

`mix test test/symphony_elixir/assistant/history_test.exs --failed` only after a first full-file run if needed; **prefer** adding the new test in a new file `history_title_user_set_test.exs` to stay WSL-narrow:

Create: `elixir/test/symphony_elixir/assistant/history_title_user_set_test.exs` with only the lock test (uses DataCase like sibling tests).

Expected: all PASS.

---

### Task 3: Apply defaults on create paths

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/history.ex`
- Modify: `elixir/lib/symphony_elixir/agent/execution_session.ex`
- Modify: `tracker/src/components/sessions/StartIssueSessionDialog.tsx` (prefill)
- Test: add cases in `session_titles` integration via history create in a narrow test file

- [ ] **Step 1: Failing create-default test**

Create `elixir/test/symphony_elixir/assistant/history_session_titles_test.exs` that creates an issue session (reuse existing project/issue fixtures from `history_test.exs`) **without** passing `:title`, and asserts title starts with `"Chat · "`.

Mirror for `ExecutionSession.ensure/create` asserting `"Run · "`.

- [ ] **Step 2: Run — expect FAIL** (still `"Issue session"` / bare identifier)

- [ ] **Step 3: Wire defaults**

`create_issue_session_thread` / `create_issue_workspace_session_thread`:

```elixir
issue_title =
  case Context.get_issue(slug, identifier) do
    {:ok, issue} -> issue.title
    _ -> nil
  end

default = SessionTitles.default_title("issue_session", identifier: identifier, issue_title: issue_title)
# ...
|> Map.put_new(:title, default)
```

`create_workspace_session_thread` / `create_project_session_thread`:

```elixir
basename = path |> Path.basename() |> String.trim()
|> Map.put_new(:title, SessionTitles.default_title("project_session", workspace_name: basename))
```

`create_freeform_thread`:

```elixir
|> Map.put_new(:title, SessionTitles.default_title("freeform"))
```

`ensure_project_explore_thread` / gateway explore: `put_new` with `SessionTitles.default_title("project_explore", project_slug: slug, project_name: project.name)` when project loaded.

KB path already uses `kb_thread_title/1` — change to `SessionTitles.default_title("kb", page_title: ...)`.

`ExecutionSession` `create/3`:

```elixir
issue_title =
  case Context.get_issue(project_slug, issue_identifier) do
    {:ok, issue} -> issue.title
    _ -> nil
  end

title =
  Keyword.get(opts, :title) ||
    SessionTitles.default_title("issue_execution",
      identifier: issue_identifier,
      issue_title: issue_title
    )
```

Also set `TitleGenerator.put_auto_eligible()` on execution metadata when missing so auto-title can run for runs that get chat-like context later (only if execution threads already support auto-title scheduling; if not, skip eligible flag — do not invent auto-title for executions if turn_manager never calls it).

- [ ] **Step 4: Frontend dialog prefill**

In `StartIssueSessionDialog.tsx`, when opening for an issue:

```ts
setTitle(`Chat · ${issue.identifier} · ${issue.title.trim()}`.trim());
```

If the user clears the field, allow backend `put_new` by omitting empty title in the create payload (`title` only when `title.trim()` non-empty).

- [ ] **Step 5: Run narrow tests**

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/assistant/history_session_titles_test.exs
```

Expected: PASS

---

### Task 4: Tab labels prefer session title

**Files:**
- Modify: `tracker/src/lib/workspaceTabs/presentation.ts`
- Modify: `tracker/src/lib/workspaceTabs/__tests__/presentation.test.ts`

- [ ] **Step 1: Update failing expectations**

Replace the test that expects `label: "GAM-20"` for `createAssistantSessionTab(42, "Autonomous run")` with:

```ts
  it("labels issue-linked tabs with the session title", () => {
    const context = {
      threadIssueIdentifiers: new Map([[42, "GAM-20"]]),
      issueTitles: new Map([["GAM-20", "Fix login race"]]),
    };

    const presentation = resolveWorkspaceTabPresentation(
      createAssistantSessionTab(42, "Chat · GAM-20 · Fix login race"),
      context,
    );

    expect(presentation.label).toBe("Chat · GAM-20 · Fix login race");
    expect(presentation.tooltip).toBeUndefined(); // or only extra context if title lacks issue title
  });
```

Update `resolveIssueLinkedTabTitle` usages: either deprecate in favor of session title, or change it to return `fallbackTitle` when present:

```ts
export function resolveIssueLinkedTabTitle(
  issueIdentifier: string | null | undefined,
  fallbackTitle: string,
): string {
  const title = fallbackTitle.trim();
  if (title) return title;
  const identifier = issueIdentifier?.trim();
  if (identifier) return identifier;
  return "Session";
}
```

- [ ] **Step 2: Implement `resolveWorkspaceTabPresentation`**

```ts
export function resolveWorkspaceTabPresentation(
  tab: WorkspaceTab,
  context: WorkspaceTabPresentationContext,
): WorkspaceTabPresentation {
  const issueIdentifier = getIssueIdentifierForTab(tab, context);
  const sessionTitle = tab.title.trim();

  if (!issueIdentifier) {
    return { label: sessionTitle || tab.title };
  }

  const issueTitle = context.issueTitles.get(issueIdentifier)?.trim() || null;
  const label = sessionTitle || issueIdentifier || "Session";

  const tooltipParts: string[] = [];
  if (issueIdentifier && !label.includes(issueIdentifier)) tooltipParts.push(issueIdentifier);
  if (issueTitle && issueTitle !== issueIdentifier && !label.includes(issueTitle)) {
    tooltipParts.push(issueTitle);
  }

  return {
    label,
    tooltip: tooltipParts.length > 0 ? tooltipParts.join(" · ") : undefined,
  };
}
```

- [ ] **Step 3: Run**

```bash
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/lib/workspaceTabs/__tests__/presentation.test.ts
```

Expected: PASS

- [ ] **Step 4: Ensure open tabs refresh title**

In `ProjectSessionsWorkspace.tsx`, the existing effect that calls `openTab(createAssistantSessionTab(activeThreadId, resolvedTitle))` already merges title via reducer. Confirm `resolvedTitle` uses `thread.title` from recents/assistant lookup (not bare identifier). Fix any path that still prefers identifier for `tab.title` when opening.

---

### Task 5: Tab `ChatStatusIcon` like sidebar

**Files:**
- Modify: `tracker/src/lib/workspaceTabs/presentation.ts` (extend presentation type)
- Modify: `tracker/src/components/workspace/WorkspaceTabBar.tsx`
- Modify: `tracker/src/components/sessions/ProjectSessionsWorkspace.tsx`
- Optional test: extend `presentation.test.ts` for statusIcon payload; component smoke in `ProjectSessionsWorkspace.test.tsx` only if an existing pattern already mounts the tab bar

- [ ] **Step 1: Extend presentation type**

```ts
import type { ExecutionMode } from "@/types/..."; // use existing import path from ChatStatusIcon / sidebar
import type { SessionStatusIconKind } from "@/components/shared/ChatStatusIcon";
import type { RecentStatusKind } from "...";
import type { SidebarAggregateStatus } from "...";

export interface WorkspaceTabStatusIcon {
  sessionKind: SessionStatusIconKind;
  executionMode?: ExecutionMode | null;
  statusKind?: RecentStatusKind | null;
  aggregateStatus?: SidebarAggregateStatus | null;
  needsAttention?: boolean;
}

export interface WorkspaceTabPresentation {
  label: string;
  tooltip?: string;
  statusIcon?: WorkspaceTabStatusIcon | null;
}
```

- [ ] **Step 2: WorkspaceTabBar renders icon**

Replace the emerald/muted span when `presentation.statusIcon` is set:

```tsx
import { ChatStatusIcon } from "@/components/shared/ChatStatusIcon";

// inside button:
{presentation.statusIcon ? (
  <ChatStatusIcon
    sessionKind={presentation.statusIcon.sessionKind}
    executionMode={presentation.statusIcon.executionMode ?? null}
    statusKind={presentation.statusIcon.statusKind ?? null}
    aggregateStatus={presentation.statusIcon.aggregateStatus ?? null}
    needsAttention={presentation.statusIcon.needsAttention ?? false}
    className="size-3.5 shrink-0"
  />
) : (
  <span
    aria-hidden
    className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-muted-foreground/40")}
  />
)}
```

Sessions-list / new-issue tabs keep the simple dot (no `statusIcon`).

- [ ] **Step 3: Resolve status in ProjectSessionsWorkspace**

When building presentation for `assistant-session` tabs, look up the matching project session / sidebar row by `threadId` and pass:

```ts
statusIcon: {
  sessionKind: sessionStatusIconKindFromScope(row.scope),
  executionMode: row.executionMode,
  statusKind: row.statusKind,
  aggregateStatus: row.aggregateStatus,
  needsAttention: row.needsReview,
}
```

Use the same mapping helpers as `SessionTreeItem` / `WorkspaceListRow`. If row missing, omit `statusIcon` (fallback dot).

- [ ] **Step 4: Targeted test**

Prefer a pure unit test that `resolveWorkspaceTabPresentation` returns `statusIcon` when context includes a status map — extend context:

```ts
export interface WorkspaceTabPresentationContext {
  threadIssueIdentifiers: ReadonlyMap<number, string>;
  issueTitles: ReadonlyMap<string, string>;
  threadStatusIcons?: ReadonlyMap<number, WorkspaceTabStatusIcon>;
}
```

And in resolver, for `assistant-session`:

```ts
statusIcon: context.threadStatusIcons?.get(tab.threadId) ?? null,
```

Wire the map in `ProjectSessionsWorkspace` from sessions data.

Run:

```bash
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/lib/workspaceTabs/__tests__/presentation.test.ts
```

Expected: PASS

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Per-scope initial titles | 2–3 |
| Auto-title until rename; `title_user_set` lock | 2 |
| Eligibility without `generic_title?` | 2 |
| Session rename → thread | 1 |
| Display title on lists | 3 (create) + existing list reads `thread.title` |
| Tab label = session title | 4 |
| Tab `ChatStatusIcon` | 5 |
| No i18n / no backfill | out of scope |

## Self-review notes

- No TBD placeholders left in tasks.
- WSL: every run command is a single file/filter.
- Commits listed but gated on user request.
- `resolveIssueLinkedTabTitle` behavior change may affect callers — grep and update call sites in the same Task 4 PR slice.
- Gateway freeform title becomes `Chat` via `put_new` only when title omitted; existing `"Telegram freeform chat"` explicit put_new should be changed to `SessionTitles.default_title("freeform")` for consistency with the spec.
