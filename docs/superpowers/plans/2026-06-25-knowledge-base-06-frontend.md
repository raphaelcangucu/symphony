# Knowledge Base - Milestone 6: Frontend KB UI (Tiptap) Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent per task, or **(B)** inline execution with checkpoints. All frontend commands run from `tracker/`. Test runner: `npx vitest run`; typecheck: `npm run build` (or `tsc -b`); lint: `npm run lint`. Depends on M1-M5 backend merged (read/write/search/sync/general endpoints).

**Goal:** Add a Notion-like KB UI to the existing tracker SPA: a per-project KB (repository-grouped page tree, document editor, full-text search, sync status) and a general user KB. Editing uses Tiptap with Markdown import/export so the on-disk files stay clean Markdown. A KB entry point is added to project navigation and the global sidebar.

**Architecture:** Follows the existing service/hook/page conventions: a `knowledgeBaseService.ts` wraps the M1-M5 endpoints via `http`/`trackerPath`/`unwrapData`; custom `useState`/`useEffect` hooks fetch data (no React Query). New route helpers encode repo slugs (`/` <-> `~`) and KB paths. Pages (`KbProjectPage`, `KbGeneralPage`) render a sidebar tree + an editor pane. `KbEditor` wraps Tiptap (`StarterKit` + `tiptap-markdown`) and emits Markdown on save (debounced auto-save). Search and sync status reuse `sonner` toasts + small components. Asset paste/upload posts to the M2 asset endpoint and inserts the returned relative link.

**Tech Stack:** React 18 + Vite + TypeScript, `react-router-dom` v6, `axios`, Tailwind v4 + shadcn-style primitives, `lucide-react`, `sonner`, `react-i18next`, Tiptap (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`, `tiptap-markdown`), Vitest + Testing Library.

---

## Plan sequence

M1 read -> M2 editing -> M3 search -> M4 git flows -> M5 general KB -> **M6 frontend (this plan)** -> M7 assistant tools. Spec: `docs/superpowers/specs/2026-06-25-knowledge-base-design.md` (Section 6 UX, Section 9 frontend).

---

## File structure (M6)

Create:
- `tracker/src/types/knowledgeBase.ts` - DTO/domain types.
- `tracker/src/services/knowledgeBase.ts` - API client.
- `tracker/src/services/__tests__/knowledgeBase.test.ts`
- `tracker/src/lib/kbRoutes.ts` - KB route + repo-slug encode/decode helpers.
- `tracker/src/lib/__tests__/kbRoutes.test.ts`
- `tracker/src/hooks/useKbProjectOverview.ts`, `useKbRepoTree.ts`, `useKbPage.ts`, `useKbSearch.ts`, `useKbSync.ts`
- `tracker/src/components/kb/KbSidebar.tsx` - repo-grouped tree.
- `tracker/src/components/kb/KbTreeNode.tsx` - recursive node row.
- `tracker/src/components/kb/KbEditor.tsx` - Tiptap markdown editor + auto-save.
- `tracker/src/components/kb/KbSearchBar.tsx`
- `tracker/src/components/kb/KbSyncBadge.tsx`
- `tracker/src/components/kb/__tests__/KbSidebar.test.tsx`, `KbEditor.test.tsx`, `KbSearchBar.test.tsx`
- `tracker/src/pages/KbProjectPage.tsx`, `KbProjectHome.tsx`, `KbGeneralPage.tsx`
- `tracker/src/pages/__tests__/KbProjectPage.test.tsx`

Modify:
- `tracker/package.json` - add Tiptap deps.
- `tracker/src/App.tsx` - add KB routes (project + general).
- `tracker/src/components/layout/ProjectSidebar.tsx` (or `ProjectWorkspaceLayout.tsx`/`ProjectHeader.tsx`) - add a KB nav link per project.
- `tracker/src/lib/workspaceRoutes.ts` - re-export `kbProjectPath` for the nav link (or import from `kbRoutes.ts`).
- i18n locale files - add `kb.*` strings.

Locked decisions:
- Repo slug in the URL encodes `/` as `~` (matches backend `Paths.repo_slug/1`). Page path is the remaining splat after the repo segment.
- Editor saves Markdown via `tiptap-markdown` `editor.storage.markdown.getMarkdown()`; loads via `content` set from fetched markdown. Auto-save debounced (1.5s) + explicit Save button.
- Search is debounced (250ms), min 2 chars, scoped to current project (with optional repo filter from the active repo).
- Sync status polled every 10s while the KB page is focused (reuse `useTrackerPolling`/window-focus pattern); a manual "Sync now" triggers `POST .../sync`.

---

## Task 1: Tiptap dependencies + KB types

**Files:**
- Modify: `tracker/package.json`
- Create: `tracker/src/types/knowledgeBase.ts`

- [ ] **Step 1: Install Tiptap**

```bash
cd tracker && npm install @tiptap/react @tiptap/starter-kit @tiptap/pm tiptap-markdown
```

Confirm versions resolve and `npm run build` still compiles (no usage yet).

- [ ] **Step 2: Add KB types**

```ts
export interface KbRepositorySummary {
  repoSlug: string;
  name: string;
  githubFullName: string;
  docsPresent: boolean;
}

export interface KbTreeNode {
  type: "page" | "folder";
  name: string;
  path: string;
  title: string;
  children: KbTreeNode[];
}

export interface KbRepoTree {
  repository: KbRepositorySummary;
  docsPresent: boolean;
  tree: KbTreeNode[];
}

export interface KbProjectOverview {
  repositories: KbRepositorySummary[];
}

export interface KbPage {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  markdown: string;
}

export interface KbSavePageInput {
  frontmatter?: Record<string, unknown>;
  body: string;
}

export interface KbSaveResult {
  path: string;
  commit: string;
  pushed: boolean;
}

export interface KbSearchResult {
  projectSlug: string;
  repoSlug: string;
  path: string;
  title: string;
  snippet: string;
  rank: number;
}

export type KbSyncStatus = "idle" | "syncing" | "open_pr" | "merged" | "conflict" | "checks_failed" | "error";

export interface KbSyncState {
  status: KbSyncStatus;
  prNumber: number | null;
  prUrl: string | null;
  lastError: string | null;
  lastSyncedAt: string | null;
}

export interface KbAssetResult {
  assetPath: string;
  markdownLink: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add tracker/package.json tracker/package-lock.json tracker/src/types/knowledgeBase.ts
git commit -m "feat(kb-ui): add tiptap deps and knowledge base types"
```

---

## Task 2: `kbRoutes.ts` (repo slug + path helpers)

**Files:**
- Create: `tracker/src/lib/kbRoutes.ts`
- Test: `tracker/src/lib/__tests__/kbRoutes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { decodeRepoSlug, encodeRepoSlug, kbGeneralPath, kbPagePath, kbProjectPath } from "@/lib/kbRoutes";

describe("kbRoutes", () => {
  it("encodes and decodes repo slugs round-trip", () => {
    expect(encodeRepoSlug("acme/web")).toBe("acme~web");
    expect(decodeRepoSlug("acme~web")).toBe("acme/web");
  });

  it("builds the project KB base path", () => {
    expect(kbProjectPath("acme")).toBe("/projects/acme/kb");
  });

  it("builds a page path with encoded repo and splat path", () => {
    expect(kbPagePath("acme", "acme/web", "architecture/backend.md")).toBe(
      "/projects/acme/kb/acme~web/architecture/backend.md",
    );
  });

  it("builds the general KB path", () => {
    expect(kbGeneralPath()).toBe("/kb");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/lib/__tests__/kbRoutes.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
import { requireProjectSlug } from "@/lib/serviceValidation";

const REPO_SLUG_SEPARATOR = "~";

export function encodeRepoSlug(githubFullName: string): string {
  return githubFullName.replaceAll("/", REPO_SLUG_SEPARATOR);
}

export function decodeRepoSlug(repoSlug: string): string {
  return repoSlug.replaceAll(REPO_SLUG_SEPARATOR, "/");
}

export function kbProjectPath(projectSlug: string): string {
  return `/projects/${encodeURIComponent(requireProjectSlug(projectSlug))}/kb`;
}

export function kbRepoPath(projectSlug: string, repoFullName: string): string {
  return `${kbProjectPath(projectSlug)}/${encodeRepoSlug(repoFullName)}`;
}

export function kbPagePath(projectSlug: string, repoFullName: string, pagePath: string): string {
  const segments = pagePath.split("/").map(encodeURIComponent).join("/");
  return `${kbRepoPath(projectSlug, repoFullName)}/${segments}`;
}

export function kbGeneralPath(): string {
  return "/kb";
}

export function kbGeneralPagePath(pagePath: string): string {
  const segments = pagePath.split("/").map(encodeURIComponent).join("/");
  return `/kb/${segments}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/lib/__tests__/kbRoutes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/lib/kbRoutes.ts tracker/src/lib/__tests__/kbRoutes.test.ts
git commit -m "feat(kb-ui): kb route and repo-slug helpers"
```

---

## Task 3: `knowledgeBaseService.ts`

**Files:**
- Create: `tracker/src/services/knowledgeBase.ts`
- Test: `tracker/src/services/__tests__/knowledgeBase.test.ts`

- [ ] **Step 1: Write the failing test** (mock `http`, assert URL/method, assert mapping)

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { http } from "@/services/http";
import {
  getProjectOverview,
  getRepoTree,
  getPage,
  savePage,
  searchProject,
  getSyncStatus,
  requestSync,
} from "@/services/knowledgeBase";

vi.mock("@/services/http", async (orig) => {
  const actual = await orig<typeof import("@/services/http")>();
  return { ...actual, http: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

afterEach(() => vi.clearAllMocks());

describe("knowledgeBaseService", () => {
  it("getProjectOverview maps repositories", async () => {
    (http.get as any).mockResolvedValue({ data: { data: { repositories: [{ repo_slug: "acme~web", name: "web", github_full_name: "acme/web", docs_present: true }] } } });
    const overview = await getProjectOverview("acme");
    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/acme/kb");
    expect(overview.repositories[0].repoSlug).toBe("acme~web");
    expect(overview.repositories[0].docsPresent).toBe(true);
  });

  it("getRepoTree requests the encoded repo path", async () => {
    (http.get as any).mockResolvedValue({ data: { data: { repository: { repo_slug: "acme~web", name: "web", github_full_name: "acme/web", docs_present: true }, docs_present: true, tree: [] } } });
    await getRepoTree("acme", "acme/web");
    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/acme/kb/repos/acme~web/tree");
  });

  it("savePage PUTs frontmatter + body and maps the result", async () => {
    (http.put as any).mockResolvedValue({ data: { data: { path: "a.md", commit: "abc", pushed: false } } });
    const result = await savePage("acme", "acme/web", "a.md", { frontmatter: { title: "A" }, body: "# A" });
    expect(http.put).toHaveBeenCalledWith("/api/tracker/v1/projects/acme/kb/repos/acme~web/pages/a.md", { frontmatter: { title: "A" }, body: "# A" });
    expect(result.commit).toBe("abc");
  });

  it("searchProject passes q and repo params", async () => {
    (http.get as any).mockResolvedValue({ data: { data: [] } });
    await searchProject("acme", "query", { repo: "web" });
    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/acme/kb/search", { params: { q: "query", repo: "web" } });
  });

  it("getSyncStatus and requestSync hit the sync endpoints", async () => {
    (http.get as any).mockResolvedValue({ data: { data: { status: "idle", pr_number: null, pr_url: null, last_error: null, last_synced_at: null } } });
    (http.post as any).mockResolvedValue({ data: { data: { accepted: true } } });
    await getSyncStatus("acme", "acme/web");
    await requestSync("acme", "acme/web");
    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/acme/kb/repos/acme~web/sync");
    expect(http.post).toHaveBeenCalledWith("/api/tracker/v1/projects/acme/kb/repos/acme~web/sync");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/services/__tests__/knowledgeBase.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
import type {
  KbPage,
  KbProjectOverview,
  KbRepoTree,
  KbSavePageInput,
  KbSaveResult,
  KbSearchResult,
  KbSyncState,
  KbAssetResult,
} from "@/types/knowledgeBase";

import { requireProjectSlug } from "@/lib/serviceValidation";
import { encodeRepoSlug } from "@/lib/kbRoutes";

import { http, trackerPath, unwrapData } from "./http";

type RepoDto = { repo_slug: string; name: string; github_full_name: string; docs_present: boolean };
type TreeDto = { type: "page" | "folder"; name: string; path: string; title: string; children: TreeDto[] };

function mapRepo(dto: RepoDto) {
  return { repoSlug: dto.repo_slug, name: dto.name, githubFullName: dto.github_full_name, docsPresent: dto.docs_present };
}

function mapTree(dto: TreeDto): KbRepoTree["tree"][number] {
  return { type: dto.type, name: dto.name, path: dto.path, title: dto.title, children: (dto.children ?? []).map(mapTree) };
}

function base(projectSlug: string): string {
  return `/projects/${encodeURIComponent(requireProjectSlug(projectSlug))}/kb`;
}

function repoBase(projectSlug: string, repoFullName: string): string {
  return `${base(projectSlug)}/repos/${encodeRepoSlug(repoFullName)}`;
}

export async function getProjectOverview(projectSlug: string): Promise<KbProjectOverview> {
  const response = await http.get(trackerPath(base(projectSlug)));
  const data = unwrapData<{ repositories: RepoDto[] }>(response);
  return { repositories: data.repositories.map(mapRepo) };
}

export async function getRepoTree(projectSlug: string, repoFullName: string): Promise<KbRepoTree> {
  const response = await http.get(trackerPath(`${repoBase(projectSlug, repoFullName)}/tree`));
  const data = unwrapData<{ repository: RepoDto; docs_present: boolean; tree: TreeDto[] }>(response);
  return { repository: mapRepo(data.repository), docsPresent: data.docs_present, tree: data.tree.map(mapTree) };
}

export async function getPage(projectSlug: string, repoFullName: string, path: string): Promise<KbPage> {
  const response = await http.get(trackerPath(`${repoBase(projectSlug, repoFullName)}/pages/${path}`));
  return unwrapData<KbPage>(response);
}

export async function savePage(
  projectSlug: string,
  repoFullName: string,
  path: string,
  input: KbSavePageInput,
): Promise<KbSaveResult> {
  const response = await http.put(trackerPath(`${repoBase(projectSlug, repoFullName)}/pages/${path}`), {
    frontmatter: input.frontmatter ?? {},
    body: input.body,
  });
  return unwrapData<KbSaveResult>(response);
}

export async function movePage(projectSlug: string, repoFullName: string, from: string, to: string): Promise<KbSaveResult> {
  const response = await http.post(trackerPath(`${repoBase(projectSlug, repoFullName)}/move`), { from, to });
  return unwrapData<KbSaveResult>(response);
}

export async function deletePage(projectSlug: string, repoFullName: string, path: string): Promise<KbSaveResult> {
  const response = await http.delete(trackerPath(`${repoBase(projectSlug, repoFullName)}/pages/${path}`));
  return unwrapData<KbSaveResult>(response);
}

export async function uploadAsset(
  projectSlug: string,
  repoFullName: string,
  file: File,
  pagePath: string,
): Promise<KbAssetResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("page_path", pagePath);
  const response = await http.post(trackerPath(`${repoBase(projectSlug, repoFullName)}/assets`), form);
  const data = unwrapData<{ asset_path: string; markdown_link: string }>(response);
  return { assetPath: data.asset_path, markdownLink: data.markdown_link };
}

export async function searchProject(
  projectSlug: string,
  q: string,
  options: { repo?: string } = {},
): Promise<KbSearchResult[]> {
  const params: Record<string, string> = { q };
  if (options.repo) params.repo = options.repo;
  const response = await http.get(trackerPath(`${base(projectSlug)}/search`), { params });
  const rows = unwrapData<Array<{ project_slug: string; repo_slug: string; path: string; title: string; snippet: string; rank: number }>>(response);
  return rows.map((r) => ({ projectSlug: r.project_slug, repoSlug: r.repo_slug, path: r.path, title: r.title, snippet: r.snippet, rank: r.rank }));
}

export async function getSyncStatus(projectSlug: string, repoFullName: string): Promise<KbSyncState> {
  const response = await http.get(trackerPath(`${repoBase(projectSlug, repoFullName)}/sync`));
  const d = unwrapData<{ status: KbSyncState["status"]; pr_number: number | null; pr_url: string | null; last_error: string | null; last_synced_at: string | null }>(response);
  return { status: d.status, prNumber: d.pr_number, prUrl: d.pr_url, lastError: d.last_error, lastSyncedAt: d.last_synced_at };
}

export async function requestSync(projectSlug: string, repoFullName: string): Promise<void> {
  await http.post(trackerPath(`${repoBase(projectSlug, repoFullName)}/sync`));
}

// General KB
export async function getGeneralOverview(): Promise<{ connected: boolean; tree: KbRepoTree["tree"] }> {
  const response = await http.get(trackerPath("/kb"));
  const data = unwrapData<{ connected: boolean; tree: TreeDto[] }>(response);
  return { connected: data.connected, tree: (data.tree ?? []).map(mapTree) };
}

export async function connectGeneral(): Promise<void> {
  await http.post(trackerPath("/kb/connect"));
}

export async function getGeneralPage(path: string): Promise<KbPage> {
  const response = await http.get(trackerPath(`/kb/pages/${path}`));
  return unwrapData<KbPage>(response);
}

export async function saveGeneralPage(path: string, input: KbSavePageInput): Promise<KbSaveResult> {
  const response = await http.put(trackerPath(`/kb/pages/${path}`), { frontmatter: input.frontmatter ?? {}, body: input.body });
  return unwrapData<KbSaveResult>(response);
}

export async function regenerateGeneralHome(): Promise<KbSaveResult> {
  const response = await http.post(trackerPath("/kb/home"));
  return unwrapData<KbSaveResult>(response);
}
```

Note: `getPage`/`getRepoTree` interpolate `path` raw; the backend route splat handles slashes. If a segment can contain reserved characters, encode each segment with `encodeURIComponent` joined by `/` (mirror `kbPagePath`). Tests use plain paths so both forms pass.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/services/__tests__/knowledgeBase.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/services/knowledgeBase.ts tracker/src/services/__tests__/knowledgeBase.test.ts
git commit -m "feat(kb-ui): knowledge base API service"
```

---

## Task 4: Data hooks

**Files:**
- Create: `tracker/src/hooks/useKbProjectOverview.ts`, `useKbRepoTree.ts`, `useKbPage.ts`, `useKbSearch.ts`, `useKbSync.ts`
- Test: `tracker/src/hooks/__tests__/useKbSearch.test.tsx` (representative; mirror existing hook test style)

Follow the existing custom-hook pattern (`useState`/`useEffect`, `useRef` race guard) seen in `useIssuePullRequests.ts`/`useAgentExecutions.ts`.

- [ ] **Step 1: Write `useKbRepoTree`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { KbRepoTree } from "@/types/knowledgeBase";
import { getRepoTree } from "@/services/knowledgeBase";

export function useKbRepoTree(projectSlug: string, repoFullName: string | null) {
  const [tree, setTree] = useState<KbRepoTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    if (!repoFullName) return;
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await getRepoTree(projectSlug, repoFullName);
      if (id === requestId.current) setTree(result);
    } catch (err) {
      if (id === requestId.current) setError(err as Error);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [projectSlug, repoFullName]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { tree, loading, error, reload };
}
```

- [ ] **Step 2: Write `useKbProjectOverview`, `useKbPage`, `useKbSync`** (same shape; `useKbPage(projectSlug, repoFullName, path)` fetches a `KbPage`; `useKbSync` fetches `getSyncStatus` and polls every 10s using `setInterval` cleared on unmount, plus a `triggerSync` calling `requestSync`).

- [ ] **Step 3: Write `useKbSearch` (debounced)**

```ts
import { useEffect, useRef, useState } from "react";
import type { KbSearchResult } from "@/types/knowledgeBase";
import { searchProject } from "@/services/knowledgeBase";

export function useKbSearch(projectSlug: string, query: string, repo?: string) {
  const [results, setResults] = useState<KbSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const rows = await searchProject(projectSlug, trimmed, repo ? { repo } : {});
        if (id === requestId.current) setResults(rows);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [projectSlug, query, repo]);

  return { results, loading };
}
```

- [ ] **Step 4: Write the failing hook test (representative)**

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as service from "@/services/knowledgeBase";
import { useKbSearch } from "@/hooks/useKbSearch";

afterEach(() => vi.restoreAllMocks());

describe("useKbSearch", () => {
  it("debounces and returns results for queries >= 2 chars", async () => {
    const spy = vi.spyOn(service, "searchProject").mockResolvedValue([
      { projectSlug: "acme", repoSlug: "acme~web", path: "a.md", title: "A", snippet: "x", rank: 1 },
    ]);

    const { result, rerender } = renderHook(({ q }) => useKbSearch("acme", q), { initialProps: { q: "a" } });
    expect(result.current.results).toEqual([]);

    rerender({ q: "auth" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("acme", "auth", {}));
    await waitFor(() => expect(result.current.results).toHaveLength(1));
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd tracker && npx vitest run src/hooks/__tests__/useKbSearch.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tracker/src/hooks/useKb*.ts tracker/src/hooks/__tests__/useKbSearch.test.tsx
git commit -m "feat(kb-ui): data hooks for tree, page, search, and sync"
```

---

## Task 5: `KbSidebar` + `KbTreeNode`

**Files:**
- Create: `tracker/src/components/kb/KbTreeNode.tsx`, `KbSidebar.tsx`
- Test: `tracker/src/components/kb/__tests__/KbSidebar.test.tsx`

Repository-grouped tree: each repository is a collapsible section; its pages render as a nested tree (`KbTreeNode` recursion, chevron expand/collapse like `SubtaskParentCard`).

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { KbSidebar } from "@/components/kb/KbSidebar";

const overview = {
  repositories: [
    { repoSlug: "acme~web", name: "web", githubFullName: "acme/web", docsPresent: true },
    { repoSlug: "acme~api", name: "api", githubFullName: "acme/api", docsPresent: false },
  ],
};

const tree = {
  "acme/web": [{ type: "page" as const, name: "index.md", path: "index.md", title: "Home", children: [] }],
};

describe("KbSidebar", () => {
  it("renders a section per repository and pages under it", () => {
    render(
      <MemoryRouter>
        <KbSidebar projectSlug="acme" overview={overview} treesByRepo={tree} activeRepo="acme/web" activePath="index.md" onSelectRepo={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/projects/acme/kb/acme~web/index.md");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/kb/__tests__/KbSidebar.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`KbTreeNode.tsx`:

```tsx
import { ChevronRight, FileText } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import type { KbTreeNode as KbTreeNodeType } from "@/types/knowledgeBase";
import { kbPagePath } from "@/lib/kbRoutes";

interface Props {
  projectSlug: string;
  repoFullName: string;
  node: KbTreeNodeType;
  depth: number;
}

export function KbTreeNode({ projectSlug, repoFullName, node, depth }: Props) {
  const [open, setOpen] = useState(true);

  if (node.type === "folder") {
    return (
      <div>
        <button
          type="button"
          className="flex w-full items-center gap-1 px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
          style={{ paddingLeft: depth * 12 + 8 }}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
          {node.name}
        </button>
        {open &&
          node.children.map((child) => (
            <KbTreeNode key={child.path} projectSlug={projectSlug} repoFullName={repoFullName} node={child} depth={depth + 1} />
          ))}
      </div>
    );
  }

  return (
    <NavLink
      to={kbPagePath(projectSlug, repoFullName, node.path)}
      className={({ isActive }) =>
        `flex items-center gap-2 px-2 py-1 text-sm hover:bg-accent ${isActive ? "bg-accent font-medium" : ""}`
      }
      style={{ paddingLeft: depth * 12 + 8 }}
    >
      <FileText className="h-3.5 w-3.5" />
      {node.title || node.name}
    </NavLink>
  );
}
```

`KbSidebar.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import type { KbProjectOverview, KbTreeNode as KbTreeNodeType } from "@/types/knowledgeBase";
import { KbTreeNode } from "./KbTreeNode";

interface Props {
  projectSlug: string;
  overview: KbProjectOverview;
  treesByRepo: Record<string, KbTreeNodeType[]>;
  activeRepo: string | null;
  activePath: string | null;
  onSelectRepo: (repoFullName: string) => void;
}

export function KbSidebar({ projectSlug, overview, treesByRepo, activeRepo, onSelectRepo }: Props) {
  const { t } = useTranslation();

  return (
    <nav className="flex flex-col gap-3 overflow-y-auto p-2">
      {overview.repositories.map((repo) => (
        <section key={repo.repoSlug}>
          <button
            type="button"
            className={`w-full px-2 py-1 text-left text-xs font-semibold uppercase tracking-wide ${
              activeRepo === repo.githubFullName ? "text-foreground" : "text-muted-foreground"
            }`}
            onClick={() => onSelectRepo(repo.githubFullName)}
          >
            {repo.name}
          </button>
          {!repo.docsPresent && <p className="px-2 text-xs text-muted-foreground">{t("kb.sidebar.noDocs")}</p>}
          {(treesByRepo[repo.githubFullName] ?? []).map((node) => (
            <KbTreeNode key={node.path} projectSlug={projectSlug} repoFullName={repo.githubFullName} node={node} depth={0} />
          ))}
        </section>
      ))}
    </nav>
  );
}
```

Add `kb.sidebar.noDocs` (e.g. "No docs yet") to locale files.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/kb/__tests__/KbSidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/kb/KbTreeNode.tsx tracker/src/components/kb/KbSidebar.tsx tracker/src/components/kb/__tests__/KbSidebar.test.tsx tracker/src/i18n
git commit -m "feat(kb-ui): repository-grouped sidebar tree"
```

---

## Task 6: `KbEditor` (Tiptap + Markdown auto-save)

**Files:**
- Create: `tracker/src/components/kb/KbEditor.tsx`
- Test: `tracker/src/components/kb/__tests__/KbEditor.test.tsx`

- [ ] **Step 1: Write the failing test** (Tiptap renders in jsdom; assert it shows the title and calls `onSave` on the Save button)

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KbEditor } from "@/components/kb/KbEditor";

describe("KbEditor", () => {
  it("renders the page title and saves markdown", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<KbEditor title="Backend" markdown={"# Backend\n\nbody"} onSave={onSave} saving={false} />);
    expect(screen.getByText("Backend")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(typeof onSave.mock.calls[0][0]).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/kb/__tests__/KbEditor.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```tsx
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

interface Props {
  title: string;
  markdown: string;
  saving: boolean;
  onSave: (markdown: string) => Promise<void> | void;
}

export function KbEditor({ title, markdown, saving, onSave }: Props) {
  const { t } = useTranslation();
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [StarterKit, Markdown.configure({ html: false, linkify: true })],
    content: markdown,
  });

  useEffect(() => {
    if (editor && markdown !== editor.storage.markdown.getMarkdown()) {
      editor.commands.setContent(markdown, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown, editor]);

  const handleSave = useCallback(async () => {
    if (!editor) return;
    await onSave(editor.storage.markdown.getMarkdown());
  }, [editor, onSave]);

  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => void handleSave(), 1500);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [editor, handleSave]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-lg font-semibold">{title}</h1>
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? t("kb.editor.saving") : t("kb.editor.save")}
        </Button>
      </header>
      <div className="prose max-w-none flex-1 overflow-y-auto p-4">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
```

Add `kb.editor.save`/`kb.editor.saving` locale strings. (Asset paste handling - intercept paste of image files, call `uploadAsset`, insert `editor.chain().focus().setImage({ src })` or insert the returned markdown link - can be added as a follow-up enhancement within this component; keep MVP to typed Markdown + Save.)

If `tiptap-markdown` types are missing, add a minimal module declaration in `tracker/src/types/tiptap-markdown.d.ts` or use the package's bundled types. Verify with `npm run build`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/kb/__tests__/KbEditor.test.tsx`
Expected: PASS. (If jsdom lacks `range`/`getClientRects` APIs Tiptap needs, add the same jsdom polyfills already used by other editor tests in `tracker/src/test/setup` - check existing setup before adding.)

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/kb/KbEditor.tsx tracker/src/components/kb/__tests__/KbEditor.test.tsx tracker/src/i18n
git commit -m "feat(kb-ui): tiptap markdown editor with auto-save"
```

---

## Task 7: `KbSearchBar` + `KbSyncBadge`

**Files:**
- Create: `tracker/src/components/kb/KbSearchBar.tsx`, `KbSyncBadge.tsx`
- Test: `tracker/src/components/kb/__tests__/KbSearchBar.test.tsx`

- [ ] **Step 1: Write `KbSearchBar`** (input + dropdown of results; on select navigates to the page). Uses `useKbSearch`. Renders `result.title`, `result.snippet`, repo label (`result.repoSlug`).

- [ ] **Step 2: Write `KbSyncBadge`** (shows status pill with color per `KbSyncStatus`; a "Sync now" button calls `triggerSync`; if `status === "conflict" | "checks_failed"`, show the `lastError` and a link to `prUrl`).

- [ ] **Step 3: Write the failing test** (type a query, assert results render and clicking a result calls the navigate handler)

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as service from "@/services/knowledgeBase";
import { KbSearchBar } from "@/components/kb/KbSearchBar";

describe("KbSearchBar", () => {
  it("shows results and invokes onSelect", async () => {
    vi.spyOn(service, "searchProject").mockResolvedValue([
      { projectSlug: "acme", repoSlug: "acme~web", path: "auth.md", title: "Auth", snippet: "...", rank: 1 },
    ]);
    const onSelect = vi.fn();
    render(<KbSearchBar projectSlug="acme" onSelect={onSelect} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "auth" } });
    await waitFor(() => expect(screen.getByText("Auth")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Auth"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ path: "auth.md", repoSlug: "acme~web" }));
  });
});
```

- [ ] **Step 4: Run test, implement, verify pass**

Run: `cd tracker && npx vitest run src/components/kb/__tests__/KbSearchBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/kb/KbSearchBar.tsx tracker/src/components/kb/KbSyncBadge.tsx tracker/src/components/kb/__tests__/KbSearchBar.test.tsx
git commit -m "feat(kb-ui): search bar and sync status badge"
```

---

## Task 8: Pages + routes + nav link

**Files:**
- Create: `tracker/src/pages/KbProjectPage.tsx`, `KbProjectHome.tsx`, `KbGeneralPage.tsx`
- Test: `tracker/src/pages/__tests__/KbProjectPage.test.tsx`
- Modify: `tracker/src/App.tsx`, `tracker/src/components/layout/ProjectSidebar.tsx`

- [ ] **Step 1: Write `KbProjectPage`** - layout: left `KbSidebar`, top `KbSearchBar` + `KbSyncBadge`, right editor pane. Reads route params `projectSlug`, `repo` (encoded), splat `*` page path. Resolves active repo via `decodeRepoSlug`. When no repo/page selected, renders `KbProjectHome` (links to each repo's docs). Uses `useKbProjectOverview`, `useKbRepoTree` (per active repo), `useKbPage`, `useKbSync`. Save calls `savePage` and `toast.success`.

- [ ] **Step 2: Write `KbProjectHome`** - lists repositories with a link to each repo's default page (`index.md` if present, else first page in tree). Matches spec "default project page linking to each repo's docs".

- [ ] **Step 3: Write `KbGeneralPage`** - same shape using general-KB service functions; shows a "Connect symphony-kb" button when `connected === false` (calls `connectGeneral`), and a "Regenerate home" action.

- [ ] **Step 4: Add routes to `App.tsx`** (inside the `projects/:projectSlug` route group and a top-level `/kb`):

```tsx
                <Route path="kb" element={<KbProjectPage />}>
                  <Route path=":repo/*" element={<KbProjectPage />} />
                </Route>
```

and at the top level (sibling of `/assistant`):

```tsx
              <Route path="kb" element={<KbGeneralPage />} />
              <Route path="kb/*" element={<KbGeneralPage />} />
```

(If nesting the splat under the same element is awkward, make `KbProjectPage` read `useParams`/`useLocation` for `repo` + splat instead of nested routes; pick whichever renders the editor in-place without remounting the sidebar.)

- [ ] **Step 5: Add the KB nav link** in `ProjectSidebar.tsx` (per-project nav) using `kbProjectPath(project.slug)` and a `BookOpen` lucide icon + `t("kb.nav.label")`. Add a global KB link (to `/kb`) near the other top-level links.

- [ ] **Step 6: Write the failing page test** (mock the service module; render within `MemoryRouter` at `/projects/acme/kb/acme~web/index.md`; assert the sidebar repo and the editor title appear)

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as service from "@/services/knowledgeBase";
import { KbProjectPage } from "@/pages/KbProjectPage";

describe("KbProjectPage", () => {
  it("renders the tree and the selected page", async () => {
    vi.spyOn(service, "getProjectOverview").mockResolvedValue({ repositories: [{ repoSlug: "acme~web", name: "web", githubFullName: "acme/web", docsPresent: true }] });
    vi.spyOn(service, "getRepoTree").mockResolvedValue({ repository: { repoSlug: "acme~web", name: "web", githubFullName: "acme/web", docsPresent: true }, docsPresent: true, tree: [{ type: "page", name: "index.md", path: "index.md", title: "Home", children: [] }] });
    vi.spyOn(service, "getPage").mockResolvedValue({ path: "index.md", title: "Home", frontmatter: {}, body: "# Home", markdown: "# Home" });
    vi.spyOn(service, "getSyncStatus").mockResolvedValue({ status: "idle", prNumber: null, prUrl: null, lastError: null, lastSyncedAt: null });

    render(
      <MemoryRouter initialEntries={["/projects/acme/kb/acme~web/index.md"]}>
        <Routes>
          <Route path="/projects/:projectSlug/kb/:repo/*" element={<KbProjectPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("web")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Home")).toBeInTheDocument());
  });
});
```

(Wrap with `I18nProvider` or a test i18n if components call `useTranslation` - check how existing page tests provide i18n, e.g. a `renderWithProviders` helper, and reuse it.)

- [ ] **Step 7: Run test, implement pages, verify pass**

Run: `cd tracker && npx vitest run src/pages/__tests__/KbProjectPage.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tracker/src/pages/Kb*.tsx tracker/src/pages/__tests__/KbProjectPage.test.tsx tracker/src/App.tsx tracker/src/components/layout/ProjectSidebar.tsx tracker/src/i18n
git commit -m "feat(kb-ui): project and general KB pages with navigation"
```

---

## Task 9: Milestone verification

- [ ] **Step 1:** `cd tracker && npm run lint`
- [ ] **Step 2:** `cd tracker && npm run build` (typecheck + bundle)
- [ ] **Step 3:** `cd tracker && npx vitest run src/services/__tests__/knowledgeBase.test.ts src/lib/__tests__/kbRoutes.test.ts src/hooks/__tests__/useKbSearch.test.tsx src/components/kb src/pages/__tests__/KbProjectPage.test.tsx` -> all pass
- [ ] **Step 4:** manual smoke (optional, if a dev backend is running): start `npm run dev`, open a project KB, edit + save a page, search, trigger sync.
- [ ] **Step 5:** commit any lint/format fixes (`chore(kb-ui): lint milestone 6`).

---

## Self-Review

**Spec coverage (M6):**

| Spec requirement | Task |
|---|---|
| Section 6 repository-grouped sidebar tree | Task 5 (`KbSidebar`/`KbTreeNode`) |
| Section 6 clean document editor (Notion-like, Markdown fidelity) | Task 6 (`KbEditor` Tiptap + markdown) |
| Section 6 full-text search UI with snippet + repo label | Task 7 (`KbSearchBar`) |
| Section 6 sync status / PR visibility | Task 7 (`KbSyncBadge`) |
| Section 6 default project page linking each repo's docs | Task 8 (`KbProjectHome`) |
| Section 6 general KB + connect + regenerate home | Task 8 (`KbGeneralPage`) |
| Section 9 routes `/projects/:slug/kb/:repo/*path`, `/kb` | Task 8 (`App.tsx`) |
| Project list/nav link to each KB | Task 8 (`ProjectSidebar`) |

**Risks/decisions:**
- Tiptap + `tiptap-markdown` chosen per spec; markdown round-trips via `editor.storage.markdown.getMarkdown()`.
- All services mocked in tests via `vi.mock`/`vi.spyOn` (existing convention); no network in tests.
- jsdom polyfills for Tiptap and i18n provider wrapping are flagged to reuse existing test setup rather than reinvent.
- Asset paste-upload is scoped as an in-component follow-up; MVP covers typed Markdown + Save + the asset endpoint already exists (M2) and `uploadAsset` is wired in the service.

**Placeholder scan:** No TBD/TODO. Confirmation notes (tiptap types, jsdom setup, i18n test wrapper, nested-route vs params) carry concrete fallbacks.

---

## Execution handoff (Cursor)

```markdown
Documents:
- Spec: `docs/superpowers/specs/2026-06-25-knowledge-base-design.md`
- Plan: `docs/superpowers/plans/2026-06-25-knowledge-base-06-frontend.md`
```

1. **Task-per-session (recommended)** - one task per subagent, review between tasks.
2. **Inline** - run tasks here with checkpoints after each task.
