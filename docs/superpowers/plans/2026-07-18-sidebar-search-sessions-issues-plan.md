# Sidebar Search — Sessions & Issues Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Replace example commands with this repo’s real tools (package manager, test runner, linter).
>
> **WSL constraint:** Never run full/batch/directory-wide test suites. Run one narrowly targeted test file or filter at a time, sequentially. Ask before expanding scope.

**Goal:** Make the global sidebar Buscar (⌘K / Ctrl+K) return **projects, sessions, and issues** — not only projects.

**Architecture:** Keep `SidebarSearchLauncher` as the surface. Fix result building so flat-nav `project.sessions` / `overflowSessions` are indexed (today only legacy workspaces/unassigned are walked). Tighten match fields so status/kind tokens like `ready` / `project` do not false-match short queries like `re`. When the dialog opens, preload session branches for idle projects via existing `reloadProjectBranch`. Fan-out debounced `listIssues(slug, { search })` across projects for issue hits; merge into one result list with a new `issue` kind.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, i18next, existing `CommandDialog` / `listIssues` / `useSidebarTree` / `issuePath`.

**Requirements covered (no separate design spec — user authorized plan-first):**

| Requirement | Task |
|-------------|------|
| Sessions appear in Buscar | Task 1 + Task 2 |
| Issues appear in Buscar | Task 3 + Task 4 |
| Works when projects are collapsed | Task 2 |
| i18n (en + pt-BR) | Task 5 |
| False-positive “re” → all ready projects | Task 1 (match fields) |

---

## File map

| File | Responsibility |
|------|----------------|
| `tracker/src/components/layout/sidebar/SidebarSearchLauncher.tsx` | Pure result builders + dialog UI; issue merge; match rules |
| `tracker/src/components/layout/ProjectSidebar.tsx` | On search open, preload idle project session branches |
| `tracker/src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx` | Unit + interaction tests for search builders/UI |
| `tracker/locales/en/tracker.json` | Copy for issue type + placeholder/description |
| `tracker/locales/pt-BR/tracker.json` | Same keys in Portuguese |

**Out of scope:** New backend global search endpoint; changing SessionQuickOpenLauncher (⌘J); KB search; board filter palette.

---

### Task 1: Index flat sessions + tighten match fields

**Files:**
- Modify: `tracker/src/components/layout/sidebar/SidebarSearchLauncher.tsx`
- Test: `tracker/src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `SidebarUtilityNav.test.tsx` (same helpers as existing suite):

```tsx
  it("indexes flat-nav project.sessions and overflowSessions", () => {
    const tree = [
      project({
        workspaces: [],
        sessions: [
          session({
            id: "thread:11",
            title: "GAM-20 · Floating surfaces",
            href: "/projects/gamba/workspaces/11",
            issueIdentifier: "GAM-20",
          }),
        ],
        overflowSessions: [
          session({
            id: "thread:12",
            title: "Hidden overflow chat",
            href: "/projects/gamba/workspaces/12",
            workspaceId: null,
          }),
        ],
      }),
    ];

    expect(buildSidebarSearchResults(tree, "floating").map((r) => r.id)).toEqual([
      "thread:11",
    ]);
    expect(buildSidebarSearchResults(tree, "overflow").map((r) => r.id)).toEqual([
      "thread:12",
    ]);
    expect(buildSidebarSearchResults(tree, "gam-20").map((r) => r.id)).toContain(
      "thread:11",
    );
  });

  it("does not match project loadState or kind tokens alone", () => {
    const tree = [
      project({
        title: "Gamba",
        loadState: "ready",
        sessions: [session({ id: "thread:1", title: "Alpha" })],
        workspaces: [],
      }),
    ];

    expect(buildSidebarSearchResults(tree, "re").map((r) => r.kind)).toEqual([]);
    expect(buildSidebarSearchResults(tree, "project").map((r) => r.kind)).toEqual([]);
    expect(buildSidebarSearchResults(tree, "gamba").map((r) => r.kind)).toEqual([
      "project",
    ]);
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx -t "indexes flat-nav"
```

Expected: FAIL — flat sessions not returned (empty or missing ids).

Then:

```bash
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx -t "does not match project loadState"
```

Expected: FAIL — `re` currently matches `ready` via `searchableText` including `status`.

- [ ] **Step 3: Minimal implementation in `SidebarSearchLauncher.tsx`**

1. Extend `SidebarSearchResult` with optional `issueIdentifier` (nullable string) used only for matching/display context — keep `kind` as `"project" | "workspace" | "session"` in this task (issue kind comes in Task 3).

2. In `buildSidebarSearchResults`, after the project result, also walk flat sessions:

```ts
    for (const flatSession of [...project.sessions, ...project.overflowSessions]) {
      addSessionResult(results, seenIds, project, null, flatSession, normalizedQuery);
    }
```

Keep the existing workspace / unassigned loops for legacy fixtures.

3. In `addSessionResult`, pass identifier into the result and context when present:

```ts
      title: session.title,
      context: workspace
        ? `${project.title} · ${workspace.title}`
        : session.issueIdentifier
          ? `${project.title} · ${session.issueIdentifier}`
          : project.title,
      // ...
      // store on result for matching — add field:
      // issueIdentifier: session.issueIdentifier,
```

4. Replace `searchableText` so status/kind are **not** match tokens:

```ts
function searchableText(result: SidebarSearchResult): string {
  return normalizeSearchText(
    [result.title, result.context, result.issueIdentifier ?? ""]
      .filter(Boolean)
      .join(" "),
  );
}
```

Add `readonly issueIdentifier?: string | null` to `SidebarSearchResult`. Project/workspace results omit it (or set `null`).

- [ ] **Step 4: Run the same targeted tests — expect PASS**

```bash
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx -t "indexes flat-nav"
```

```bash
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx -t "does not match project loadState"
```

Also re-run the existing search cases in that file one filter at a time if anything looks broken:

```bash
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx -t "normalizes search"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/layout/sidebar/SidebarSearchLauncher.tsx \
  tracker/src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx
git commit -m "$(cat <<'EOF'
fix(tracker): index flat sidebar sessions in Buscar

Flat-nav sessions lived on project.sessions but search only walked
legacy workspaces. Also stop matching status/kind tokens so short
queries like "re" no longer hit every ready project.
EOF
)"
```

---

### Task 2: Preload session branches when Buscar opens

**Files:**
- Modify: `tracker/src/components/layout/ProjectSidebar.tsx`
- Test: prefer extending an existing ProjectSidebar test if one already covers search; otherwise keep coverage via Task 1 + a small unit-level assertion is enough. If adding a ProjectSidebar test, use **only** `tracker/src/components/layout/__tests__/ProjectSidebar.test.tsx` with a narrow `-t` filter.

- [ ] **Step 1: Confirm current wiring**

`ProjectSidebar` already passes:

```tsx
      <SidebarSearchLauncher
        open={searchOpen}
        tree={tree}
        loading={projectsLoading}
        onOpenChange={setSearchOpen}
        onOpenNode={(href) => {
          setSearchOpen(false);
          openNode(href);
        }}
        onRequestProjectExpand={ensureProjectExpanded}
      />
```

`useSidebarTree` exposes `reloadProjectBranch(projectSlug)`. Calling it loads sessions into `branchStates` **without** requiring the project to be expanded in the UI (sessions stay on the project node for search).

- [ ] **Step 2: Write a failing test (ProjectSidebar)**

In `ProjectSidebar.test.tsx`, add a focused case (adapt mocks to the file’s existing `useSidebarTree` mock style):

```tsx
  it("reloads idle project branches when search opens", async () => {
    const user = userEvent.setup();
    const reloadProjectBranch = vi.fn().mockResolvedValue(undefined);
    // wire mock so tree has one project with loadState "idle"
    // and reloadProjectBranch is the spy from the hook mock

    render(<ProjectSidebar ... />); // same harness as existing tests

    await user.click(screen.getByRole("button", { name: /search|buscar/i }));
    expect(reloadProjectBranch).toHaveBeenCalledWith("gamba");
  });
```

If the existing mock structure makes this expensive, skip the component test and instead document manual verification in Step 5 — but prefer the automated case when the mock already exposes `reloadProjectBranch`.

- [ ] **Step 3: Implement preload effect in `ProjectSidebar.tsx`**

Near other search state:

```tsx
  useEffect(() => {
    if (!searchOpen) return;
    for (const project of tree) {
      if (project.loadState === "idle" || project.loadState === "error") {
        void reloadProjectBranch(project.projectSlug);
      }
    }
  }, [reloadProjectBranch, searchOpen, tree]);
```

Ensure `reloadProjectBranch` is already destructured from `useSidebarTree()` (add it if missing).

Do **not** expand every project in preferences — that would thrash the tree UI. Preload only.

Pass `loading={projectsLoading || tree.some((p) => p.loadState === "loading")}` into `SidebarSearchLauncher` so the empty state shows “Loading…” while branches fetch.

- [ ] **Step 4: Run the targeted test**

```bash
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/layout/__tests__/ProjectSidebar.test.tsx -t "reloads idle project branches"
```

Expected: PASS (or skip if you chose manual-only — then run a smoke open of Buscar in the app and confirm collapsed projects eventually contribute sessions).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/layout/ProjectSidebar.tsx \
  tracker/src/components/layout/__tests__/ProjectSidebar.test.tsx
git commit -m "$(cat <<'EOF'
fix(tracker): preload sidebar session branches for Buscar

Opening search loads idle/error project session pages so collapsed
projects still contribute session hits without expanding the tree UI.
EOF
)"
```

---

### Task 3: Issue result kind + pure merge helper

**Files:**
- Modify: `tracker/src/components/layout/sidebar/SidebarSearchLauncher.tsx`
- Test: `tracker/src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx`

- [ ] **Step 1: Write failing tests for issue builders**

```tsx
import type { Issue } from "@/types/issue";
import {
  buildSidebarIssueSearchResults,
  mergeSidebarSearchResults,
} from "@/components/layout/sidebar/SidebarSearchLauncher";

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "1",
    identifier: "GAM-20",
    projectSlug: "gamba",
    status: "In Progress",
    title: "Floating preview surfaces",
    description: null,
    priority: null,
    position: 0,
    labels: [],
    blockedBy: [],
    assignee: null,
    creator: null,
    url: null,
    branchName: null,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    attachments: [],
    ...overrides,
  };
}

  it("builds issue search results with board hrefs", () => {
    const results = buildSidebarIssueSearchResults(
      [issue(), issue({ identifier: "GAM-21", title: "Other", projectSlug: "gamba" })],
      "floating",
      new Map([["gamba", "Gamba"]]),
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: "issue",
      id: "issue:gamba:GAM-20",
      title: "GAM-20 · Floating preview surfaces",
      context: "Gamba",
      href: "/projects/gamba/board/issues/GAM-20",
      status: "In Progress",
      projectId: "gamba",
    });
  });

  it("merges projects, issues, then sessions and dedupes by id", () => {
    const merged = mergeSidebarSearchResults(
      [
        {
          id: "gamba",
          kind: "project",
          title: "Gamba",
          context: "2 sessions",
          status: "ready",
          href: "/projects/gamba/board",
          projectId: "gamba",
        },
        {
          id: "thread:1",
          kind: "session",
          title: "Chat",
          context: "Gamba",
          status: "active",
          href: "/projects/gamba/workspaces/1",
          projectId: "gamba",
        },
      ],
      [
        {
          id: "issue:gamba:GAM-20",
          kind: "issue",
          title: "GAM-20 · Floating preview surfaces",
          context: "Gamba",
          status: "In Progress",
          href: "/projects/gamba/board/issues/GAM-20",
          projectId: "gamba",
          issueIdentifier: "GAM-20",
        },
      ],
    );
    expect(merged.map((r) => r.kind)).toEqual(["project", "issue", "session"]);
  });
```

- [ ] **Step 2: Run to verify FAIL**

```bash
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx -t "builds issue search results"
```

Expected: FAIL — exports missing.

- [ ] **Step 3: Implement helpers in `SidebarSearchLauncher.tsx`**

```ts
import { issuePath } from "@/lib/workspaceRoutes";
import type { Issue } from "@/types/issue";

export type SidebarSearchResultKind = "project" | "workspace" | "session" | "issue";

export function buildSidebarIssueSearchResults(
  issues: readonly Issue[],
  query: unknown,
  projectTitles: ReadonlyMap<string, string>,
): readonly SidebarSearchResult[] {
  const normalizedQuery = normalizeSearchText(typeof query === "string" ? query.trim() : "");
  if (!normalizedQuery) return [];

  const results: SidebarSearchResult[] = [];
  const seenIds = new Set<string>();

  for (const issue of issues) {
    if (!issue || typeof issue.identifier !== "string" || !issue.identifier.trim()) continue;
    if (typeof issue.projectSlug !== "string" || !issue.projectSlug.trim()) continue;
    const title = `${issue.identifier} · ${issue.title}`.trim();
    const projectTitle = projectTitles.get(issue.projectSlug) ?? issue.projectSlug;
    addResult(
      results,
      seenIds,
      {
        id: `issue:${issue.projectSlug}:${issue.identifier}`,
        kind: "issue",
        title,
        context: projectTitle,
        status: String(issue.status ?? ""),
        href: issuePath(issue.projectSlug, "board", issue.identifier),
        projectId: issue.projectSlug,
        issueIdentifier: issue.identifier,
      },
      normalizedQuery,
    );
  }
  return results;
}

export function mergeSidebarSearchResults(
  treeResults: readonly SidebarSearchResult[],
  issueResults: readonly SidebarSearchResult[],
): readonly SidebarSearchResult[] {
  const order: Record<SidebarSearchResultKind, number> = {
    project: 0,
    issue: 1,
    workspace: 2,
    session: 3,
  };
  const seen = new Set<string>();
  const merged: SidebarSearchResult[] = [];
  for (const result of [...treeResults, ...issueResults].sort(
    (a, b) => order[a.kind] - order[b.kind] || a.title.localeCompare(b.title),
  )) {
    if (seen.has(result.id)) continue;
    seen.add(result.id);
    merged.push(result);
  }
  return merged;
}
```

Update `localizeSidebarSearchStatus` for `kind === "issue"`: return `status` as-is when non-empty (workflow status names are already display strings), else unknown.

Update `typeLabel` — it already uses `layout.sidebar.search.types.${kind}`; Task 5 adds the `issue` key.

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx -t "builds issue search results"
```

```bash
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx -t "merges projects, issues"
```

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/layout/sidebar/SidebarSearchLauncher.tsx \
  tracker/src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx
git commit -m "$(cat <<'EOF'
feat(tracker): add issue result builders for sidebar Buscar

Pure helpers map listIssues hits to command-palette rows and merge
them with project/session results in a stable kind order.
EOF
)"
```

---

### Task 4: Wire debounced issue fan-out into the dialog

**Files:**
- Modify: `tracker/src/components/layout/sidebar/SidebarSearchLauncher.tsx`
- Test: `tracker/src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx`

- [ ] **Step 1: Write a failing UI test with mocked `listIssues`**

```tsx
vi.mock("@/services/issues", () => ({
  listIssues: vi.fn(),
}));

import { listIssues } from "@/services/issues";

  it("loads issue results across projects for the search query", async () => {
    const user = userEvent.setup();
    vi.mocked(listIssues).mockImplementation(async (slug) => {
      if (slug === "gamba") {
        return [
          {
            id: "1",
            identifier: "GAM-20",
            projectSlug: "gamba",
            status: "In Progress",
            title: "Floating preview surfaces",
            description: null,
            priority: null,
            position: 0,
            labels: [],
            blockedBy: [],
            assignee: null,
            creator: null,
            url: null,
            branchName: null,
            createdAt: "2026-07-18T00:00:00.000Z",
            updatedAt: "2026-07-18T00:00:00.000Z",
            attachments: [],
          },
        ];
      }
      return [];
    });

    render(
      <SidebarSearchLauncher
        open
        tree={[project({ id: "gamba", projectSlug: "gamba", title: "Gamba", workspaces: [] })]}
        onOpenChange={() => {}}
        onOpenNode={() => {}}
      />,
    );

    await user.type(
      screen.getByPlaceholderText(/Search projects|Buscar projetos/i),
      "floating",
    );

    expect(
      await screen.findByRole("option", { name: /GAM-20 · Floating preview surfaces/i }),
    ).toBeInTheDocument();
    expect(listIssues).toHaveBeenCalledWith("gamba", { search: "floating" });
  });
```

Use `await initTestI18n("en")` in `beforeEach` (already present). If debounce makes the test flaky, either:

- export `SEARCH_ISSUE_DEBOUNCE_MS = 0` in test via mocking `useDebouncedValue`, or
- use fake timers: `vi.useFakeTimers()` → type → `await vi.advanceTimersByTimeAsync(250)` → assert.

Prefer fake timers to avoid changing production debounce.

- [ ] **Step 2: Run — expect FAIL** (no issue option)

```bash
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx -t "loads issue results across projects"
```

- [ ] **Step 3: Implement dialog wiring**

In `SidebarSearchLauncher`:

```tsx
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { listIssues } from "@/services/issues";
import type { Issue } from "@/types/issue";

const ISSUE_SEARCH_DEBOUNCE_MS = 200;
const ISSUE_SEARCH_LIMIT_PER_PROJECT = 20;

// inside component:
  const debouncedQuery = useDebouncedValue(query, ISSUE_SEARCH_DEBOUNCE_MS);
  const [issueHits, setIssueHits] = useState<readonly Issue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);

  const projectTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of normalizeSidebarTree(tree)) {
      map.set(project.projectSlug, project.title);
    }
    return map;
  }, [tree]);

  useEffect(() => {
    if (!open) {
      setIssueHits([]);
      setIssuesLoading(false);
      return;
    }
    const q = debouncedQuery.trim();
    if (!q) {
      setIssueHits([]);
      setIssuesLoading(false);
      return;
    }

    const projects = normalizeSidebarTree(tree);
    let cancelled = false;
    setIssuesLoading(true);

    void Promise.all(
      projects.map((project) =>
        listIssues(project.projectSlug, { search: q })
          .then((rows) => rows.slice(0, ISSUE_SEARCH_LIMIT_PER_PROJECT))
          .catch(() => [] as Issue[]),
      ),
    ).then((pages) => {
      if (cancelled) return;
      setIssueHits(pages.flat());
      setIssuesLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, open, tree]);

  const treeResults = useMemo(
    () => buildSidebarSearchResults(tree, query),
    [query, tree],
  );
  const issueResults = useMemo(
    () => buildSidebarIssueSearchResults(issueHits, debouncedQuery, projectTitles),
    [debouncedQuery, issueHits, projectTitles],
  );
  const results = useMemo(
    () => mergeSidebarSearchResults(treeResults, issueResults),
    [issueResults, treeResults],
  );
```

Empty state loading flag:

```tsx
        <CommandEmpty>
          {loading || issuesLoading
            ? t("layout.sidebar.search.loading")
            : t("layout.sidebar.search.empty")}
        </CommandEmpty>
```

Selecting an issue uses the same `openResult` path (`onOpenNode(result.href)`). Do **not** call `onRequestProjectExpand` for issues (only for `kind === "project"`).

- [ ] **Step 4: Run UI test — expect PASS**

```bash
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx -t "loads issue results across projects"
```

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/layout/sidebar/SidebarSearchLauncher.tsx \
  tracker/src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx
git commit -m "$(cat <<'EOF'
feat(tracker): fan-out issue search in sidebar Buscar

Debounced listIssues across loaded projects feeds issue rows into the
command palette alongside projects and sessions.
EOF
)"
```

---

### Task 5: i18n copy for issues

**Files:**
- Modify: `tracker/locales/en/tracker.json` (`layout.sidebar.search`)
- Modify: `tracker/locales/pt-BR/tracker.json` (`layout.sidebar.search`)

- [ ] **Step 1: Update English keys**

```json
      "search": {
        "title": "Search",
        "description": "Search projects, sessions, and issues.",
        "placeholder": "Search projects, sessions, and issues…",
        "loading": "Loading…",
        "empty": "No results found.",
        "unknownStatus": "Unknown status",
        "types": {
          "project": "Project",
          "workspace": "Workspace",
          "session": "Session",
          "issue": "Issue"
        },
        "loadState": {
          "idle": "Idle",
          "loading": "Loading",
          "ready": "Ready",
          "error": "Error",
          "stale": "Stale"
        }
      },
```

- [ ] **Step 2: Update Portuguese keys**

```json
      "search": {
        "title": "Buscar",
        "description": "Busque projetos, sessões e issues.",
        "placeholder": "Buscar projetos, sessões e issues…",
        "loading": "Carregando…",
        "empty": "Nenhum resultado encontrado.",
        "unknownStatus": "Status desconhecido",
        "types": {
          "project": "Projeto",
          "workspace": "Workspace",
          "session": "Sessão",
          "issue": "Issue"
        },
        "loadState": {
          "idle": "Ocioso",
          "loading": "Carregando",
          "ready": "Pronto",
          "error": "Erro",
          "stale": "Desatualizado"
        }
      },
```

- [ ] **Step 3: Fix placeholder assertions in tests**

Update any `getByPlaceholderText("Search projects and sessions…")` to the new English string (or a regex that matches both during transition).

Run:

```bash
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx -t "opens a search result"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json \
  tracker/src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx
git commit -m "$(cat <<'EOF'
i18n(tracker): mention issues in sidebar Buscar copy

Add the issue type label and update placeholder/description so the
palette reflects projects, sessions, and issues.
EOF
)"
```

---

### Task 6: Manual smoke + verification gate

- [ ] **Step 1: Manual checks in the running tracker**

1. Open Buscar (sidebar button or Ctrl+K where it owns the shortcut).
2. Type a session title fragment from a **collapsed** project → session row appears after preload (tag `SESSÃO` / `Session`).
3. Type an issue identifier (e.g. `GAM-20`) → issue row with tag `ISSUE` / `Issue`, navigates to `/projects/<slug>/board/issues/GAM-20`.
4. Type `re` → must **not** list every project merely because `loadState` is `ready`.
5. Empty query still lists loaded nodes (existing behavior) without firing issue fan-out.

- [ ] **Step 2: Final targeted regression (one file)**

```bash
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/layout/sidebar/__tests__/SidebarUtilityNav.test.tsx
```

Expected: all tests in that single file PASS. Do **not** run the full tracker suite on WSL unless the user asks.

---

## Self-review

1. **Spec coverage:** Sessions (Task 1–2), issues (Task 3–4), i18n (Task 5), false-positive match (Task 1), collapsed projects (Task 2).
2. **Placeholders:** None — concrete code, commands, and expected outcomes.
3. **Type consistency:** `SidebarSearchResultKind` includes `issue`; helpers `buildSidebarIssueSearchResults` / `mergeSidebarSearchResults`; href via `issuePath(..., "board", identifier)`.
4. **YAGNI:** No new search API; reuses `listIssues` + existing session branch loading.
