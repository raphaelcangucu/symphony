# Hierarchical Workspace Explorer — Projects → Repositories → Worktrees

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. One focused subagent per task with review between tasks. Replace example commands with this repo's real tools.

**Goal:** Mirror Jean's project → repo → worktree tree in Symphony: a (mostly read-only) **Workspace Explorer** that shows each project's base repositories and the git worktrees created for runs, with live git status (branch / commits-ahead / dirty / pushed) and a single destructive lifecycle action — remove an **orphaned** worktree — so worktrees stop silently accumulating.

**Why (verified state):** Worktrees today are an internal child-run detail under `<repo>/.worktrees/<slug>` (`workspace/worktree.ex:1-26`), created by `Worktree.ensure/3` (`agent_runner.ex:99-109`) and only ever removed by `Worktree.remove/2` — which is never called from a UI, so orphans pile up. Projects already model repositories (`local_tracker/repository.ex`: `workspace_path`, `local_path`, `role`) and expose them to the tracker (`Project.repositories?: WorkspaceRepository[]`, `types/project.ts:29`). Git status for any checkout already has a primitive: `RunContract.repo_states/2` → `%RepoState{path, name, branch, default_branch, dirty?, upstream?, ahead_count}` (`run_contract.ex:16-41`). This plan composes those instead of inventing new git plumbing.

**Architecture:** A new read-model `WorkspaceExplorer` builds, for a project, a tree of base repos (from `LocalTracker.Repository` + their resolved checkout path) each with their worktrees (parsed from `git worktree list --porcelain`), attaching a `RepoState`-derived status to every node. A controller exposes `GET /projects/:slug/workspace` and `DELETE …/worktrees`. The tracker adds a `WorkspaceExplorerPanel` (collapsible tree + status badges) reachable from a new project nav entry, with an orphan-worktree remove guarded by an "in use by active run?" check.

**Tech Stack:** Elixir (git via `System.cmd`), Phoenix controller, React 19 + TanStack Query + shadcn/ui + lucide, vitest, ExUnit.

---

## File Structure

**Create (backend):**
- `elixir/lib/symphony_elixir/workspace/explorer.ex` — build the project workspace tree + status.
- `elixir/lib/symphony_elixir_web/controllers/tracker/workspace_controller.ex` — `index/2`, `delete_worktree/2`.
- tests: `explorer_test.exs`, `workspace_controller_test.exs`.

**Modify (backend):**
- `elixir/lib/symphony_elixir/workspace/worktree.ex` — add `list/1` (parse porcelain) + `in_use?/1` helper hook.
- `elixir/lib/symphony_elixir_web/router.ex` — routes under the project scope.

**Create (tracker):**
- `tracker/src/services/workspaceExplorer.ts` — `fetchWorkspaceTree`, `removeWorktree`.
- `tracker/src/types/workspace-explorer.ts` — tree DTOs.
- `tracker/src/components/workspace/WorkspaceExplorerPanel.tsx`
- `tracker/src/components/workspace/WorktreeStatusBadge.tsx`
- `tracker/src/pages/WorkspaceExplorerPage.tsx`
- tests for the panel + badge + service.

**Modify (tracker):**
- `tracker/src/components/layout/ProjectWorkspaceLayout.tsx` (+ router) — add a "Workspace" tab/route.
- locale files `en` + `pt-BR`.

---

## Task 1: Worktree.list — parse `git worktree list --porcelain`

**Files:** Modify `workspace/worktree.ex` + `test/symphony_elixir/workspace/worktree_test.exs`.

- [ ] **Step 1: Write failing test** — given a temp git repo with one added worktree, `Worktree.list(repo)` returns `[%{path: ..., branch: "feat/x", head: <sha>, detached: false}]` and excludes the main checkout; a non-repo path returns `[]` (never raises).

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/workspace/worktree_test.exs -o`

- [ ] **Step 3: Implement** `list/1` — `System.cmd("git", ["worktree", "list", "--porcelain"], cd: repo, stderr_to_stdout: true)`, parse blocks (`worktree <path>`, `HEAD <sha>`, `branch refs/heads/<name>`, `detached`), drop the entry whose path == repo root, return maps. Wrap in try/rescue → `[]` on non-zero/raise. Also add `in_use?/1` taking a worktree path returning a boolean stub (default `false`; wired in Task 4).

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(workspace): list git worktrees per repo`.

---

## Task 2: WorkspaceExplorer read-model

**Files:** Create `workspace/explorer.ex` + `test/symphony_elixir/workspace/explorer_test.exs`.

- [ ] **Step 1: Write failing test** — for a project with two repositories (one with a worktree), `Explorer.tree(project)` returns `%{project_slug, repositories: [%{name, role, path, status: %{branch, ahead_count, dirty?, upstream?}, worktrees: [%{slug, path, branch, status: %{...}, orphaned?: bool}]}]}`. A repo whose checkout doesn't exist yet yields `status: nil` (not an error).

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — resolve each repository's checkout path (`Repository.local_path` or composed workspace path), call `RunContract.repo_states/2` (or a single-repo status helper) for the base + each worktree path, list worktrees via `Worktree.list/1`, and mark `orphaned?` = worktree not referenced by any active run (Task 4 supplies the predicate; default to a passed-in `active_slugs` set, empty in this task). Pure-ish: take an injectable `status_fun`/`worktree_fun` for testability.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(workspace): WorkspaceExplorer project tree read-model`.

---

## Task 3: Controller + routes (GET tree, DELETE worktree)

**Files:** Create `workspace_controller.ex`, add routes, + `workspace_controller_test.exs`.

- [ ] **Step 1: Write failing test** — `GET /projects/:slug/workspace` → `%{data: %{repositories: [...]}}`; unknown project → project_not_found; `DELETE /projects/:slug/workspace/worktrees` with `%{"repo" => r, "path" => p}` for an orphan → 200 + removed; for an in-use worktree → 409/validation error.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement**
- `index/2`: `Context.get_project` → `Explorer.tree(project)` → present.
- `delete_worktree/2`: validate the `path` is inside `<repo>/.worktrees/` (reject traversal), check `Worktree.in_use?/1` (reject with `:worktree_in_use` if active), else `Worktree.remove/2`.
- Routes in `router.ex` under the existing authenticated project scope.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(workspace): workspace tree + worktree-remove endpoints`.

---

## Task 4: "in use" guard wired to the orchestrator

**Files:** Modify `workspace/worktree.ex` (`in_use?/1`) + `workspace/explorer.ex` (orphan detection) + tests.

- [ ] **Step 1: Write failing test** — when the orchestrator reports an active run whose worktree slug matches, `Explorer.tree` marks that worktree `orphaned?: false` and `Worktree.in_use?(path)` is `true`; with no active run, `orphaned?: true`.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — derive active worktree slugs from `Orchestrator` active runs (the same `unit_id`/slug used in `agent_runner.ex:118-122 worktree_slug/2`). `in_use?/1` compares the path's `.worktrees/<slug>` against active slugs. Inject the active-slug source for tests.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(workspace): guard worktree removal against active runs`.

---

## Task 5: Tracker types + service

**Files:** Create `types/workspace-explorer.ts`, `services/workspaceExplorer.ts` + test.

- [ ] **Step 1: Write failing test** — `fetchWorkspaceTree(slug)` maps the backend DTO (snake→camel) into `{ repositories: WorkspaceRepoNode[] }` with nested `worktrees`; `removeWorktree(slug, { repo, path })` posts to the delete route.

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/services/__tests__/workspaceExplorer.test.ts`

- [ ] **Step 3: Implement** types (`WorkspaceRepoNode`, `WorktreeNode`, `RepoStatus`) + service (mirror `services/issues.ts` http/unwrap conventions).

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(workspace): tracker workspace-explorer service + types`.

---

## Task 6: WorktreeStatusBadge + WorkspaceExplorerPanel

**Files:** Create badge + panel + tests.

- [ ] **Step 1: Write failing badge test** — `WorktreeStatusBadge({status})` renders branch, a "+N" when `aheadCount>0`, a dirty dot when `dirty`, and a "pushed" marker when `upstream`. Null status → "no checkout".

- [ ] **Step 2: Write failing panel test** — given a tree with 2 repos (one with 1 orphan worktree), renders repo rows (lucide `GitBranch`/`FolderGit2`), expand to show worktrees, each with a status badge; an orphan worktree shows a "Remove" affordance that calls `removeWorktree` (mocked) behind a confirm; a non-orphan worktree's remove is disabled with a tooltip.

- [ ] **Step 3: Run (expect fail).**

- [ ] **Step 4: Implement**
- `WorktreeStatusBadge` — small inline badges (reuse existing `ui/badge`).
- `WorkspaceExplorerPanel` — `useQuery(["workspace", slug], () => fetchWorkspaceTree(slug))`; collapsible repo rows (reuse the disclosure pattern; lucide `ChevronRight`/`ChevronDown`); worktree rows with badge + remove button (orphan only) using a `Dialog` confirm (mirror the hard-reset dialog in `ExecutionControlComposer.tsx:523-550`); invalidate the query on successful remove. Empty/loading/error states.

- [ ] **Step 5: Run (expect pass).**

- [ ] **Step 6: Commit** — `feat(workspace): explorer panel + worktree status badge`.

---

## Task 7: Mount as a project "Workspace" route/tab

**Files:** Create `WorkspaceExplorerPage.tsx`; modify `ProjectWorkspaceLayout.tsx` + router; locales.

- [ ] **Step 1: Write failing test** — navigating to `/projects/:slug/workspace` renders the explorer panel; the project nav shows a "Workspace" entry (lucide `FolderGit2`).

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — add the route + a tab/nav entry in the project workspace layout (follow how Board/KB tabs are registered), render `WorkspaceExplorerPage` → `WorkspaceExplorerPanel`. Add i18n keys (`workspace.explorer.*`) to both locales.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(workspace): project Workspace tab`.

---

## Task 8: Full gates + docs

- [ ] **Step 1: Backend gate** — `cd elixir && mix specs.check && make all` → pass.
- [ ] **Step 2: Tracker gate** — `cd tracker && npm run lint && npx vitest run && npm run build` → pass.
- [ ] **Step 3: Docs** — note the Workspace Explorer + worktree lifecycle in `elixir/README.md` (or `../SPEC.md`), including the orphan-removal guard.
- [ ] **Step 4: Commit** — `docs(workspace): document workspace explorer + worktree lifecycle`.

---

## Self-Review (spec coverage)

| Requirement (from user) | Task(s) |
| --- | --- |
| "organização hierárquica dos projetos de pastas para o projeto base e os working trees" | 1–7 (Project → base repos → worktrees tree) |
| Surface worktrees that are invisible today | 1, 2, 6 |
| Lifecycle / stop orphans accumulating | 3, 4, 6 (guarded orphan removal) |

**Notes / decisions:**
- Scope is **mostly read-only**: the only mutation is removing an orphaned worktree, guarded against active runs. Creating worktrees stays owned by the orchestrator (child-run dispatch); a "create worktree from here" action is a deliberate follow-up, not this plan.
- Git status reuses `RunContract.repo_states` rather than a new git layer, keeping a single source of truth for branch/ahead/dirty/pushed.
- Jean also nests **folders → projects**; Symphony already groups by project in the sidebar (`ProjectSidebar.tsx`). A folder grouping layer over projects is out of scope here and can be a small follow-up (a `project_group` label) if desired.
