# Maestro Contextual Surfaces — Implementation Plan

**Goal:** Ship a docked Maestro host that auto-binds to existing singleton assistant threads on home, Observability, project board/list, issue drawer, and KB — without changing Workspaces.

**Architecture:** App-level `MaestroHost` + pure `resolveMaestroContext(pathname)` drive a reused `ProjectAssistantPanel`. Backend adds `History.ensure_active_freeform_thread/0`, expands freeform tools (KB via `project_slug`, observability, settings), and surface-aware freeform / location prompts. Workspaces and full-page assistant routes keep the host off.

**Tech Stack:** React + Vitest (`tracker/`), Elixir + ExUnit (`elixir/`), Phoenix channels (`AssistantChannel`), existing `ProjectAssistantPanel`.

**Spec:** [`docs/superpowers/specs/2026-07-16-maestro-contextual-surfaces-design.md`](../specs/2026-07-16-maestro-contextual-surfaces-design.md)

**WSL testing:** Run **one** narrowly targeted test file or filter at a time. Never batch files, never repository-wide suites, never parallel test loops. Ask before expanding scope. Same rule for any subagent.

---

## File map

| Path | Role |
|------|------|
| Create `tracker/src/lib/maestroContext.ts` | Types + `resolveMaestroContext(pathname)` |
| Create `tracker/src/lib/__tests__/maestroContext.test.ts` | Resolver matrix |
| Create `tracker/src/components/maestro/MaestroExtraContext.tsx` | Optional page-provided `getExtraContext` |
| Create `tracker/src/components/maestro/MaestroHost.tsx` | Launcher + docked panel + open state |
| Create `tracker/src/components/maestro/__tests__/MaestroHost.test.tsx` | Mount / context switch / workspace off |
| Modify `tracker/src/components/layout/Layout.tsx` | Mount `<MaestroHost />` |
| Modify `tracker/src/components/kb/KbWorkspace.tsx` | Remove private launcher/panel; publish KB extra context |
| Modify `tracker/src/pages/ObservabilityPage.tsx` | Publish observability extra context |
| Modify `tracker/src/services/assistantThreads.ts` | `ensureActiveFreeformThread()` client |
| Modify `tracker/src/lib/workspaceRoutes.ts` | Optional helpers if needed for full-page deep links |
| Create `elixir/lib/symphony_elixir/assistant/observability_tools.ex` | `list_observability_runtimes` |
| Create `elixir/lib/symphony_elixir/assistant/settings_tools.ex` | `get_instance_settings`, `update_instance_settings` |
| Modify `elixir/lib/symphony_elixir/assistant/history.ex` | `ensure_active_freeform_thread/0` |
| Modify `elixir/lib/symphony_elixir/assistant/tool_executor.ex` | Wire freeform KB + new tools |
| Modify `elixir/lib/symphony_elixir/assistant/agent_session.ex` | Surface + location prompt blocks |
| Modify `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex` | `POST/GET ensure active freeform` endpoint |
| Modify `elixir/lib/symphony_elixir_web/router.ex` | Route for ensure-active freeform |
| Create/Modify matching `elixir/test/...` files listed per task | Targeted ExUnit |

**Out of scope files:** Workspaces UI, Telegram gateway, `project_explore` route redesign, app-wide Assistant→Maestro renames.

---

## Resolved open details (from spec §10)

1. **Freeform binding:** `History.ensure_active_freeform_thread/0` returns newest `scope=freeform` by `updated_at` / `id`, or creates one. Tracker calls `POST /assistant/threads/freeform/active` (or `ensure` alias).
2. **Settings tools:** `get_instance_settings` (all groups) + `update_instance_settings` for whitelist `~w(agents agent_models agent_efforts ui orchestrator lab)` via `Settings.put/3`. Unknown/disallowed groups return remediation with deep-link `/settings`.
3. **Observability tools:** `list_observability_runtimes` → `Observability.Registry.list/0` (same payload shape the page uses). Navigation to a session/issue is done by returning identifiers + instructing the user / using existing board tools — no new navigate tool in v1.
4. **Host off routes:** workspaces, terminal, `/assistant`, `/assistant/:id`, `/projects/:slug/assistant/*` (avoid double panels).
5. **Panel open state:** `localStorage` key `symphony.maestro.panelOpen` (`"1"` / `"0"`). Default closed.

---

### Task 1: `resolveMaestroContext` (frontend)

**Files:**
- Create: `tracker/src/lib/maestroContext.ts`
- Test: `tracker/src/lib/__tests__/maestroContext.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveMaestroContext } from "@/lib/maestroContext";

describe("resolveMaestroContext", () => {
  it("returns home on /projects", () => {
    expect(resolveMaestroContext("/projects")).toEqual({
      kind: "home",
      surface: "home",
    });
  });

  it("returns home observability on /observability", () => {
    expect(resolveMaestroContext("/observability")).toEqual({
      kind: "home",
      surface: "observability",
    });
  });

  it("returns project on board without issue", () => {
    expect(resolveMaestroContext("/projects/acme/board")).toEqual({
      kind: "project",
      projectSlug: "acme",
      view: "board",
    });
  });

  it("returns issue when drawer path is open", () => {
    expect(resolveMaestroContext("/projects/acme/list/issues/ACME-12/summary")).toEqual({
      kind: "issue",
      projectSlug: "acme",
      issueIdentifier: "ACME-12",
      view: "list",
    });
  });

  it("returns kb for project and general KB", () => {
    expect(resolveMaestroContext("/projects/acme/kb/@user~symphony-kb/guide.md")).toMatchObject({
      kind: "kb",
      projectSlug: "acme",
    });
    expect(resolveMaestroContext("/kb/home.md")).toMatchObject({
      kind: "kb",
      projectSlug: "@user",
    });
  });

  it("returns null on workspaces and full-page assistant", () => {
    expect(resolveMaestroContext("/projects/acme/workspaces")).toBeNull();
    expect(resolveMaestroContext("/projects/acme/workspaces/12")).toBeNull();
    expect(resolveMaestroContext("/assistant")).toBeNull();
    expect(resolveMaestroContext("/assistant/9")).toBeNull();
    expect(resolveMaestroContext("/projects/acme/assistant")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npm test -- src/lib/__tests__/maestroContext.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement resolver**

```ts
// tracker/src/lib/maestroContext.ts
import { GENERAL_KB_PROJECT_SLUG } from "@/lib/kbRoutes";
import type { WorkspaceView } from "@/lib/workspaceRoutes";

export type MaestroContext =
  | { kind: "home"; surface: "home" | "observability" }
  | { kind: "project"; projectSlug: string; view: WorkspaceView }
  | { kind: "issue"; projectSlug: string; issueIdentifier: string; view: WorkspaceView }
  | {
      kind: "kb";
      projectSlug: string;
      repoSlug: string;
      pagePath: string;
    };

const WORKSPACE_OFF =
  /^\/projects\/[^/]+\/(workspaces|terminal)(\/|$)/;
const FULL_ASSISTANT_OFF =
  /^\/assistant(\/|$)|^\/projects\/[^/]+\/assistant(\/|$)/;
const ISSUE_DRAWER =
  /^\/projects\/([^/]+)\/(board|list)\/issues\/([^/]+)(?:\/[^/]+)?\/?$/;
const PROJECT_BOARD_LIST =
  /^\/projects\/([^/]+)\/(board|list)\/?$/;
const PROJECT_KB =
  /^\/projects\/([^/]+)\/kb\/([^/]+)\/(.+)$/;
const GENERAL_KB = /^\/kb\/(.+)$/;

export function resolveMaestroContext(pathname: string): MaestroContext | null {
  const path = pathname.split("?")[0] || "/";
  if (WORKSPACE_OFF.test(path) || FULL_ASSISTANT_OFF.test(path)) return null;

  if (path === "/observability") {
    return { kind: "home", surface: "observability" };
  }
  if (path === "/" || path === "/projects") {
    return { kind: "home", surface: "home" };
  }

  const issue = path.match(ISSUE_DRAWER);
  if (issue) {
    return {
      kind: "issue",
      projectSlug: decodeURIComponent(issue[1]),
      view: issue[2] as WorkspaceView,
      issueIdentifier: decodeURIComponent(issue[3]),
    };
  }

  const board = path.match(PROJECT_BOARD_LIST);
  if (board) {
    return {
      kind: "project",
      projectSlug: decodeURIComponent(board[1]),
      view: board[2] as WorkspaceView,
    };
  }

  const projectKb = path.match(PROJECT_KB);
  if (projectKb) {
    return {
      kind: "kb",
      projectSlug: decodeURIComponent(projectKb[1]),
      repoSlug: decodeURIComponent(projectKb[2]),
      pagePath: decodeURIComponent(projectKb[3]),
    };
  }

  const generalKb = path.match(GENERAL_KB);
  if (generalKb) {
    return {
      kind: "kb",
      projectSlug: GENERAL_KB_PROJECT_SLUG,
      repoSlug: "@user~symphony-kb",
      pagePath: decodeURIComponent(generalKb[1]),
    };
  }

  // /kb index without page — still home-like KB entry; host can show once a page is selected
  if (path === "/kb" || path.startsWith("/kb/")) {
    return null;
  }

  return null;
}

export function maestroContextKey(ctx: MaestroContext): string {
  switch (ctx.kind) {
    case "home":
      return `home:${ctx.surface}`;
    case "project":
      return `project:${ctx.projectSlug}:${ctx.view}`;
    case "issue":
      return `issue:${ctx.projectSlug}:${ctx.issueIdentifier}`;
    case "kb":
      return `kb:${ctx.projectSlug}:${ctx.repoSlug}:${ctx.pagePath}`;
  }
}
```

Adjust GENERAL_KB / `/kb` edge cases to match real `kbRoutes` URL shapes used by `KbGeneralPage` / `KbProjectPage` (read those pages while implementing; keep tests green).

- [ ] **Step 4: Re-run test**

Run: `cd tracker && npm test -- src/lib/__tests__/maestroContext.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tracker/src/lib/maestroContext.ts tracker/src/lib/__tests__/maestroContext.test.ts
git commit -m "$(cat <<'EOF'
feat(tracker): add MaestroContext route resolver

EOF
)"
```

---

### Task 2: `ensure_active_freeform_thread` (Elixir)

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/history.ex`
- Create: `elixir/test/symphony_elixir/assistant/history_ensure_active_freeform_test.exs`
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Modify: `tracker/src/services/assistantThreads.ts`

- [ ] **Step 1: Write the failing ExUnit test**

```elixir
defmodule SymphonyElixir.Assistant.HistoryEnsureActiveFreeformTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Assistant.History

  test "creates a freeform thread when none exist" do
    assert {:ok, thread} = History.ensure_active_freeform_thread()
    assert thread.scope == "freeform"
    assert is_integer(thread.id)
  end

  test "returns the most recently updated freeform thread" do
    {:ok, older} = History.create_freeform_thread(%{title: "older"})
    {:ok, newer} = History.create_freeform_thread(%{title: "newer"})
    _ = History.touch_thread_updated_at(newer) # use existing touch helper if present; else update_thread

    assert {:ok, active} = History.ensure_active_freeform_thread()
    assert active.id == newer.id
    refute active.id == older.id
  end
end
```

If `touch_thread_updated_at` does not exist, update via `History.update_thread(newer, %{title: "newer-2"})` or whatever already bumps `updated_at`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/assistant/history_ensure_active_freeform_test.exs`

Expected: FAIL — `ensure_active_freeform_thread/0` undefined.

- [ ] **Step 3: Implement History + HTTP + TS client**

```elixir
@spec ensure_active_freeform_thread() :: {:ok, Thread.t()} | {:error, term()}
def ensure_active_freeform_thread do
  case list_threads(scope: "freeform", limit: 1) do
    [thread | _] -> {:ok, thread}
    [] -> create_freeform_thread(%{title: "Maestro"})
  end
end
```

Confirm `list_threads/1` already accepts `scope:` + `limit:` (it does). Add controller action:

```elixir
def ensure_active_freeform(conn, _params) do
  with {:ok, thread} <- History.ensure_active_freeform_thread() do
    json(conn, %{data: thread_json(thread)})
  end
end
```

Router (inside tracker API scope, next to assistant threads):

```elixir
post "/assistant/threads/freeform/active", AssistantThreadController, :ensure_active_freeform
```

TS:

```ts
export async function ensureActiveFreeformThread(): Promise<AssistantThread> {
  const response = await http.post(trackerPath("/assistant/threads/freeform/active"), {});
  return unwrapData<AssistantThread>(response); // normalize like createFreeformThread
}
```

- [ ] **Step 4: Re-run ExUnit**

Run: `cd elixir && mix test test/symphony_elixir/assistant/history_ensure_active_freeform_test.exs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/history.ex \
  elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex \
  elixir/lib/symphony_elixir_web/router.ex \
  elixir/test/symphony_elixir/assistant/history_ensure_active_freeform_test.exs \
  tracker/src/services/assistantThreads.ts
git commit -m "$(cat <<'EOF'
feat(assistant): ensure active freeform thread for Maestro host

EOF
)"
```

---

### Task 3: `MaestroExtraContext` + `MaestroHost` shell

**Files:**
- Create: `tracker/src/components/maestro/MaestroExtraContext.tsx`
- Create: `tracker/src/components/maestro/MaestroHost.tsx`
- Create: `tracker/src/components/maestro/__tests__/MaestroHost.test.tsx`
- Modify: `tracker/src/components/layout/Layout.tsx`
- Reuse: `tracker/src/components/kb/KbAssistantLauncher.tsx` (import or rename to shared `MaestroLauncher` — prefer move to `components/maestro/MaestroLauncher.tsx` and re-export from KB path for one release if needed)

- [ ] **Step 1: Write failing host test**

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { MaestroHost } from "@/components/maestro/MaestroHost";

vi.mock("@/services/assistantThreads", () => ({
  ensureActiveFreeformThread: vi.fn(async () => ({ id: 42, scope: "freeform" })),
}));

vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: (props: { "data-testid"?: string }) => (
    <div data-testid="assistant-panel" data-thread={String((props as { threadId?: number }).threadId)} />
  ),
}));

describe("MaestroHost", () => {
  it("shows launcher on /projects", async () => {
    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <MaestroHost />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("button", { name: /maestro|open/i })).toBeInTheDocument();
  });

  it("does not render on workspaces", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/projects/acme/workspaces"]}>
        <MaestroHost />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

Adapt i18n keys to whatever the launcher uses (`kb.assistant.launcher.open` or new `maestro.launcher.open`).

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd tracker && npm test -- src/components/maestro/__tests__/MaestroHost.test.tsx`

- [ ] **Step 3: Implement ExtraContext + Host**

`MaestroExtraContext.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";

type Getter = () => Record<string, unknown> | undefined;

const MaestroExtraContext = createContext<{
  register: (getter: Getter) => () => void;
  getExtra: () => Record<string, unknown>;
} | null>(null);

export function MaestroExtraContextProvider({ children }: { children: ReactNode }) {
  const getters = useRef(new Set<Getter>());
  const register = useCallback((getter: Getter) => {
    getters.current.add(getter);
    return () => {
      getters.current.delete(getter);
    };
  }, []);
  const getExtra = useCallback(() => {
    let merged: Record<string, unknown> = {};
    for (const getter of getters.current) {
      merged = { ...merged, ...(getter() ?? {}) };
    }
    return merged;
  }, []);
  const value = useMemo(() => ({ register, getExtra }), [register, getExtra]);
  return <MaestroExtraContext.Provider value={value}>{children}</MaestroExtraContext.Provider>;
}

export function useRegisterMaestroExtra(getter: Getter, deps: unknown[]) {
  const ctx = useContext(MaestroExtraContext);
  useEffect(() => {
    if (!ctx) return;
    return ctx.register(getter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, ...deps]);
}

export function useMaestroExtraGetter(): () => Record<string, unknown> {
  const ctx = useContext(MaestroExtraContext);
  return ctx?.getExtra ?? (() => ({}));
}
```

`MaestroHost.tsx` (core behavior):

- `useLocation()` → `resolveMaestroContext`
- If null → render nothing
- Persist open: `localStorage.getItem("symphony.maestro.panelOpen")`
- For `kind === "home"`: `ensureActiveFreeformThread()` once, then `<ProjectAssistantPanel threadId={id} mode="embedded" view="board" getExtraContext={() => ({ surface, location: "maestro_host", ...extra() })} />`
- For `kind === "project"`: panel with `projectSlug`, `view`, `mode="embedded"`, `assistantMode` default project
- For `kind === "issue"`: `projectSlug` + `issueIdentifier` + `view`
- For `kind === "kb"`: `assistantMode="kb"`, `kbRepoSlug`, `kbPagePath`, `projectSlug`, merge KB live body from registered extra
- Launcher: reuse `KbAssistantLauncher` or moved `MaestroLauncher`
- Panel chrome: show context label; Close toggles open; optional Link to full-page (`/assistant/${id}`, `assistantPath(slug)`, issue authoring path)
- `key={maestroContextKey(ctx)}` on panel to force remount on context change
- Keep panel mounted while `running` even if closed (KB pattern)

Wrap `Layout` providers:

```tsx
<MaestroExtraContextProvider>
  ...
  <main>...</main>
  <MaestroHost />
</MaestroExtraContextProvider>
```

- [ ] **Step 4: Re-run host test**

Run: `cd tracker && npm test -- src/components/maestro/__tests__/MaestroHost.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/maestro tracker/src/components/layout/Layout.tsx
git commit -m "$(cat <<'EOF'
feat(tracker): mount MaestroHost on contextual surfaces

EOF
)"
```

---

### Task 4: Migrate KB workspace onto MaestroHost

**Files:**
- Modify: `tracker/src/components/kb/KbWorkspace.tsx`
- Modify: `tracker/src/components/kb/KbAssistantPanel.tsx` (delete usage or delete file if unused)
- Test: extend `MaestroHost` test or add `KbWorkspace` test that launcher is not duplicated

- [ ] **Step 1: Write failing assertion**

In a focused KB workspace test (create or extend existing), assert `KbAssistantLauncher` is **not** rendered by `KbWorkspace` when a page is open; MaestroHost owns it.

- [ ] **Step 2: Run — expect FAIL** (launcher still present)

- [ ] **Step 3: Implement**

In `KbWorkspace`:

1. Remove `assistantOpen` / launcher / `KbAssistantPanel` mount block.
2. Register extra context:

```tsx
useRegisterMaestroExtra(() => {
  if (!repoSlug || !pagePath || !page) return undefined;
  const { body, selection } = getKbContext();
  return {
    surface: "kb",
    kb: { repoSlug, pagePath, title: page.title, body, selection },
  };
}, [repoSlug, pagePath, page, getKbContext]);
```

Keep document-changed callbacks working: either pass through MaestroHost props later, or keep a thin `KbAssistantPanel` only if MaestroHost cannot wire `onDocumentChanged` yet — prefer extending MaestroHost with optional callbacks registered via another small context `MaestroKbCallbacks`.

Minimal v1: MaestroHost for KB uses same `getExtraContext` merge; `onDocumentChanged` can no-op until a follow-up if wiring is heavy — **but** current KB relies on refresh after writes. Wire `onDocumentChanged` via:

```tsx
// MaestroKbEvents.tsx — registerDocumentChangedListener
```

Or lift the existing `handleAssistantDocChanged` into a context setter that MaestroHost's panel calls.

- [ ] **Step 4: Run targeted KB/Maestro tests**

Run: `cd tracker && npm test -- src/components/maestro/__tests__/MaestroHost.test.tsx`

(and the one KB test file you touched)

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/kb tracker/src/components/maestro
git commit -m "$(cat <<'EOF'
refactor(kb): drive Maestro from global host instead of local launcher

EOF
)"
```

---

### Task 5: Observability page extra context

**Files:**
- Modify: `tracker/src/pages/ObservabilityPage.tsx`

- [ ] **Step 1: Register extra context** (no new test file required if host test covers surface; optional unit on getter)

```tsx
useRegisterMaestroExtra(
  () => ({
    surface: "observability",
    observability: {
      projectFilter: selectedProject, // existing state var name
      runtimeCount: runtimes.length,
    },
  }),
  [selectedProject, runtimes.length],
);
```

- [ ] **Step 2: Manual smoke** — open `/observability`, open Maestro, confirm header shows Observability and freeform thread loads.

- [ ] **Step 3: Commit**

```bash
git add tracker/src/pages/ObservabilityPage.tsx
git commit -m "$(cat <<'EOF'
feat(observability): publish Maestro extra context for freeform surface

EOF
)"
```

---

### Task 6: Freeform surface-aware prompt

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/agent_session.ex`
- Create: `elixir/test/symphony_elixir/assistant/freeform_prompt_surface_test.exs` (or add one focused test in an existing prompt test module if present)

- [ ] **Step 1: Failing test** extracting/`@` test the private via a small public test helper **or** assert through `build_freeform_prompt` by testing a thin exported function. Prefer adding:

```elixir
@spec freeform_location_block(map()) :: String.t()
def freeform_location_block(context) when is_map(context) do
  surface = context["surface"] || context[:surface] || "home"
  case to_string(surface) do
    "observability" ->
      "User location: Observability page (global operator). Prefer list_observability_runtimes and issue/session tools."

    _ ->
      "User location: Home / global Maestro (projects, personal KB with project_slug=@user, issues, settings)."
  end
end
```

Test both branches.

- [ ] **Step 2: Run fail → implement → pass**

Run: `cd elixir && mix test test/symphony_elixir/assistant/freeform_prompt_surface_test.exs`

- [ ] **Step 3: Inject block into `build_freeform_prompt/3`** near the Context section.

- [ ] **Step 4: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/agent_session.ex \
  elixir/test/symphony_elixir/assistant/freeform_prompt_surface_test.exs
git commit -m "$(cat <<'EOF'
feat(assistant): surface-aware freeform Maestro prompt

EOF
)"
```

---

### Task 7: Wire Knowledge Base tools into freeform

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/tool_executor.ex`
- Modify: `elixir/test/symphony_elixir/assistant/tool_executor_test.exs` (one new test only)

- [ ] **Step 1: Failing test**

```elixir
test "freeform_tool_specs includes kb tools with project_slug" do
  names = ToolExecutor.freeform_tool_specs() |> Enum.map(& &1["name"])
  assert "kb_search_pages" in names
  assert "kb_read_page" in names
end
```

- [ ] **Step 2: Run — FAIL**

Run: `cd elixir && mix test test/symphony_elixir/assistant/tool_executor_test.exs --only line:<line>`

(or a dedicated small test file if `--only line` is awkward)

- [ ] **Step 3: Implement**

In `freeform_tool_specs/0`:

```elixir
kb_specs =
  KnowledgeBaseTools.tool_specs()
  |> Enum.map(&SymphonyElixir.Assistant.ToolSchema.with_project_slug/1)

(DiscoveryTools.tool_specs() ++
   ProjectBoardTools.tool_specs() ++
   kb_specs ++
   GitHubTools.tool_specs() ++
   read_specs ++
   [GoalTools.assistant_tool_spec()] ++
   DynamicTool.tool_specs())
|> ToolText.localize_specs()
```

In `freeform_codex_tool_executor/1`:

```elixir
name in KnowledgeBaseTools.tools() ->
  with {:ok, project_slug} <- fetch_project_slug(arguments) do
    args = Map.drop(arguments, ["project_slug"])
    wrap_for_codex(execute(project_slug, name, args, opts))
  else
    _ -> codex_failure_response({:error, :invalid_arguments})
  end
```

Reuse the same `project_slug` extraction helper ProjectBoardTools uses (extract shared `required_string` or call into `ToolExecutor.execute/4` the same way `ProjectBoardTools.execute` does).

Update `build_freeform_prompt` to say personal KB uses `project_slug="@user"` and `repository="@user~symphony-kb"`.

- [ ] **Step 4: Pass + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(assistant): enable KB tools in freeform Maestro

EOF
)"
```

---

### Task 8: Observability tools

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/observability_tools.ex`
- Create: `elixir/test/symphony_elixir/assistant/observability_tools_test.exs`
- Modify: `elixir/lib/symphony_elixir/assistant/tool_executor.ex`
- Modify: `elixir/lib/symphony_elixir/assistant/agent_session.ex` (list tool in freeform prompt)

- [ ] **Step 1: Failing test**

```elixir
test "list_observability_runtimes returns registry entries" do
  # start/sandbox Registry or stub list/0
  assert {:ok, result} = ObservabilityTools.execute("list_observability_runtimes", %{}, [])
  assert result["ok"] == true or match?({:ok, _}, {:ok, result})
end
```

Follow existing tool module success shape (`ok/3` map) from `DiscoveryTools` / `KnowledgeBaseTools`.

- [ ] **Step 2: Implement module**

```elixir
defmodule SymphonyElixir.Assistant.ObservabilityTools do
  alias SymphonyElixir.Observability.Registry

  @tools ~w(list_observability_runtimes)

  def tools, do: @tools

  def tool_specs do
    [
      %{
        "name" => "list_observability_runtimes",
        "description" => "List active agent runtimes/sessions from Observability (project, issue, state, tokens).",
        "parameters" => %{"type" => "object", "additionalProperties" => false, "properties" => %{}}
      }
    ]
  end

  def execute("list_observability_runtimes", _args, _opts) do
    entries = Registry.list()
    {:ok, %{ok: true, tool: "list_observability_runtimes", message: "Found #{length(entries)} runtimes.", data: %{runtimes: entries}}}
  end

  def execute(other, _args, _opts), do: {:error, {:unsupported_tool, other}}
end
```

Normalize entries to JSON-safe maps if Registry returns atoms/structs (mirror `ObservabilityController`).

Wire into `freeform_tool_specs` + executor + prompt.

- [ ] **Step 3: Run one test file**

Run: `cd elixir && mix test test/symphony_elixir/assistant/observability_tools_test.exs`

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(assistant): list observability runtimes from freeform Maestro

EOF
)"
```

---

### Task 9: Settings tools

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/settings_tools.ex`
- Create: `elixir/test/symphony_elixir/assistant/settings_tools_test.exs`
- Modify: `tool_executor.ex`, `agent_session.ex` freeform prompt

- [ ] **Step 1: Failing tests**

```elixir
test "get_instance_settings returns Settings.all groups" do
  assert {:ok, payload} = SettingsTools.execute("get_instance_settings", %{}, [])
  assert get_in(payload, ["data", "agents"]) != nil or match?(%{data: %{agents: _}}, payload)
end

test "update_instance_settings rejects unknown group with remediation" do
  assert {:ok, payload} =
           SettingsTools.execute("update_instance_settings", %{"group" => "nope", "value" => %{}}, [])
  assert payload[:remediation] == "open_settings" or payload["remediation"] == "open_settings"
end
```

Match the repo’s exact tool success/error conventions when implementing.

- [ ] **Step 2: Implement**

```elixir
@writable_groups ~w(agents agent_models agent_efforts ui orchestrator lab)

def execute("get_instance_settings", _args, _opts) do
  {:ok, ok("get_instance_settings", "Loaded instance settings.", Settings.all())}
end

def execute("update_instance_settings", args, _opts) do
  with {:ok, group} <- required_string(args, "group"),
       true <- group in @writable_groups,
       {:ok, value} <- required_map(args, "value"),
       :ok <- Settings.put(group, value) do # confirm Settings.put/2 vs put/3 arity
    {:ok, ok("update_instance_settings", "Updated #{group}.", Settings.all())}
  else
    false ->
      {:ok,
       %{
         ok: false,
         remediation: "open_settings",
         message: "Group not writable via Maestro. Open /settings in the UI.",
         data: %{path: "/settings", writable_groups: @writable_groups}
       }}
    error -> error
  end
end
```

Read `SymphonyElixir.Settings.put` arity before coding — adapt exactly.

- [ ] **Step 3: Run**

Run: `cd elixir && mix test test/symphony_elixir/assistant/settings_tools_test.exs`

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(assistant): instance settings tools for freeform Maestro

EOF
)"
```

---

### Task 10: Location blocks for project + issue prompts

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/agent_session.ex`
- Create: `elixir/test/symphony_elixir/assistant/location_prompt_test.exs`

- [ ] **Step 1: Failing tests** for a small public helper:

```elixir
assert AgentSession.location_block(%{"maestro" => %{"kind" => "project", "view" => "board"}})
       =~ "project board"

assert AgentSession.location_block(%{"maestro" => %{"kind" => "issue", "issueIdentifier" => "X-1"}})
       =~ "issue drawer"
```

- [ ] **Step 2: Implement helper; call from `build_prompt` and `build_issue_prompt`**

Frontend `getExtraContext` for project/issue must include:

```ts
maestro: { kind: "project" | "issue", view, issueIdentifier? }
```

- [ ] **Step 3: Run one ExUnit file + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(assistant): inject Maestro location into project and issue prompts

EOF
)"
```

---

### Task 11: Full-page deep link + polish

**Files:**
- Modify: `tracker/src/components/maestro/MaestroHost.tsx`
- i18n JSON files where `kb.assistant.launcher.*` live (find via ripgrep `launcher.working`)

- [ ] **Step 1:** Add header control “Open full page”:
  - home → `/assistant/${threadId}`
  - project → `assistantPath(projectSlug)` from `workspaceRoutes`
  - issue → existing issue authoring / workspaces link used elsewhere (prefer authoring route that uses `issue` singleton — **not** a new `issue_session`)
  - kb → stay on page (no-op or focus editor)

- [ ] **Step 2:** Ensure context label strings exist (`maestro.context.home`, `.observability`, `.project`, `.issue`, `.kb`).

- [ ] **Step 3:** Targeted host test for link `href`.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tracker): Maestro full-page deep links and context labels

EOF
)"
```

---

### Task 12: Spec status + manual acceptance checklist

**Files:**
- Modify: `docs/superpowers/specs/2026-07-16-maestro-contextual-surfaces-design.md` — Status → Approved / Implemented-in-progress

- [ ] **Step 1: Manual checklist**

| Check | Pass? |
|-------|-------|
| Home: Maestro opens freeform; can list projects | |
| Observability: same freeform thread; `list_observability_runtimes` works | |
| Board: project thread; tools scoped to project | |
| Open issue drawer: switches to issue singleton; close drawer returns to project | |
| KB: single launcher; live page context still injected | |
| Workspaces: no docked Maestro | |
| `/assistant/:id`: no duplicate docked host | |

- [ ] **Step 2: Commit docs**

```bash
git add docs/superpowers/specs/2026-07-16-maestro-contextual-surfaces-design.md \
  docs/superpowers/plans/2026-07-16-maestro-contextual-surfaces-plan.md
git commit -m "$(cat <<'EOF'
docs: Maestro contextual surfaces plan and spec status

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Docked Maestro on home / observability / board / drawer / KB | 3, 4, 5 |
| Auto context switch | 1, 3 |
| Reuse freeform / project / issue / kb singletons | 2, 3 |
| Workspaces host off | 1, 3 |
| Full global operator tools (KB, observability, settings) | 7, 8, 9 |
| Surface-aware freeform prompt | 6 |
| Location prompts project/issue | 10 |
| KB launcher migration | 4 |
| Full-page deep link same thread | 11 |
| Tests (resolver, host, freeform tools) | 1–10 |
| Freeform ensure helper | 2 |

## Placeholder / consistency self-review

- No TBD left for product behavior; Settings arity and exact KB URL regex must be verified against live modules during Task 1/9 (called out inline).
- Types: `MaestroContext` / `maestroContextKey` reused in Host tests.
- Tool names fixed: `list_observability_runtimes`, `get_instance_settings`, `update_instance_settings`.
- WSL: every run step uses a single file/filter.
