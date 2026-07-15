# API latency hotpath — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tracker page loads feel instant by removing repeated slow HTTP work on `assistant/config`, `threads?limit=100`, `…/editor`, and issue `kb/repos`.

**Architecture:** Stale-while-revalidate on the frontend for catalogs; backend TTL caches + parallel CLI/git work; stop sync skill prep on editor GET; fetch one thread by id instead of listing 100.

**Tech Stack:** Elixir/Phoenix (ETS/file TTL caches, `Task`), React hooks + `localStorage` catalog cache already in `assistantSettings.ts`.

---

## File map

| File | Role |
|------|------|
| `elixir/lib/symphony_elixir/assistant/catalog_bundle.ex` | Parallel agent catalogs + ETS TTL for `/assistant/config` |
| `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_controller.ex` | Use `CatalogBundle` |
| `elixir/lib/symphony_elixir/cursor/model_catalog.ex` | CLI result TTL cache (Codex-style) |
| `elixir/lib/symphony_elixir/opencode/model_catalog.ex` | CLI result TTL cache |
| `elixir/lib/symphony_elixir/editor.ex` | Async `WorkspaceSkills.prepare` off GET path |
| `elixir/lib/symphony_elixir/knowledge_base/issue_workspace.ex` | Parallel git diffs + short ETS tree cache |
| `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex` | `GET /assistant/threads/:id` |
| `elixir/lib/symphony_elixir_web/router.ex` | Route for thread show |
| `tracker/src/services/assistant.ts` | SWR: return cache immediately, refresh background |
| `tracker/src/services/assistantThreads.ts` | `getAssistantThread` |
| `tracker/src/hooks/useAssistantThreadMetadata.ts` | Use get-by-id; stable deps |
| `tracker/src/hooks/useIssueEditor.ts` | Module cache for targets |

---

### Task 1: CatalogBundle + parallel config

- [ ] **Step 1: Failing test** — `assistant_controller` config returns agents; add test that stubbed slow catalogs still complete and second call hits cache (ETS).
- [ ] **Step 2: Implement** `SymphonyElixir.Assistant.CatalogBundle.fetch/0` with `Task.async_stream` over codex/claude/cursor/opencode and ETS TTL ~10m.
- [ ] **Step 3: Wire** `AssistantController.config/2` to `CatalogBundle`.
- [ ] **Step 4: Run** `mise exec -- mix test test/symphony_elixir_web/controllers/tracker/assistant_controller_test.exs` (targeted).

### Task 2: Cursor + OpenCode catalog TTL

- [ ] **Step 1: Tests** — second `list_models` does not re-invoke CLI stub within TTL.
- [ ] **Step 2: Implement** process ETS or module Agent cache with async refresh (mirror Codex).
- [ ] **Step 3: Targeted tests** for each catalog module.

### Task 3: Frontend SWR for catalog

- [ ] **Step 1: Test** — `fetchAssistantCatalogBundle` resolves cached bundle before HTTP when cache present.
- [ ] **Step 2: Implement** return `loadCachedCatalogBundle()` immediately when valid; kick background refresh; update cache.
- [ ] **Step 3: Targeted** `assistant.test.ts`.

### Task 4: Thread metadata by id

- [ ] **Step 1: Backend** GET show + presenter test.
- [ ] **Step 2: Frontend** `getAssistantThread` + rewrite `useAssistantThreadMetadata` deps to `[projectSlug, threadId]` only; use relatedSessions for optimistic seed only.
- [ ] **Step 3: Targeted** hook/controller tests.

### Task 5: Editor GET without sync prepare

- [ ] **Step 1: Test** — `editor_target` returns URL when workspace exists even if prepare would be slow; prepare still scheduled.
- [ ] **Step 2: Implement** `Task.start` prepare after path resolve; GET only needs `File.dir?`.
- [ ] **Step 3: Targeted** editor tests + curl timing.

### Task 6: Issue KB repo_tree

- [ ] **Step 1: Parallelize** the four git name-only calls; short ETS cache (~5–15s) keyed by slug/id/repo + workspace mtime if cheap.
- [ ] **Step 2: Targeted** issue_workspace / kb controller tests.
- [ ] **Step 3: Curl timing**.

### Task 7: Ship tracker assets

- [ ] **Step 1:** `make tracker-build` from `elixir/`.
- [ ] **Step 2:** `make update` so web picks up Elixir changes.
- [ ] **Step 3:** Re-measure the four curls; hard-refresh browser.

---

## Success criteria

- `assistant/config` cold &lt; ~300ms when catalogs cached / fallback; warm ≪ 50ms.
- No `threads?limit=100` on session tab open (single GET by id or none).
- `…/editor` ≪ 100ms typical (no sync skill mirror).
- Issue `kb/repos/:repo` faster under load; no serial git wall.
