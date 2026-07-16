# Project explore default workspace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exploratory project sessions open on the project’s default workspace (layout segment root) and can complete turns under PathOwnership.

**Architecture:** Align `ProjectExploreWorkspace` with `Workspace.project_layout/1`, always publish inventory `:project` for that path, and ensure clones when a `project_session` targets it.

**Tech Stack:** Elixir / Phoenix, ExUnit, LocalTracker workflow `workspace.root`

---

### Task 1: ProjectExploreWorkspace uses project_layout

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/project_explore_workspace.ex`
- Modify: `elixir/test/symphony_elixir/assistant/project_explore_workspace_test.exs`

- [ ] Add failing test: project with DB `workspace.root` → `path/1` and `ensure/2` land under that root’s segment
- [ ] Implement `path/1` via `Workspace.project_layout/1`
- [ ] Run targeted test file

### Task 2: Inventory always emits `:project` entry

**Files:**
- Modify: `elixir/lib/symphony_elixir/workspace/inventory.ex`
- Modify: `elixir/test/symphony_elixir/workspace/inventory_test.exs`

- [ ] Add failing test: segment root with no repos still yields `kind: :project`
- [ ] Change `project_workspace_entry/3` to emit when `File.dir?(segment_root)`
- [ ] Run targeted inventory test

### Task 3: Ensure + revalidate on explore default path

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/agent_session.ex`
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex`
- Modify: `elixir/test/symphony_elixir/assistant/agent_session_test.exs` (or new focused test)

- [ ] When `project_session` workspace equals explore path, call `ProjectExploreWorkspace.ensure/2` before turn
- [ ] On create with that path, ensure clones as well
- [ ] Integration test: custom root → create legacy project_session → stubbed turn succeeds

### Task 4: Live verify

- [x] Restart serve if needed
- [x] Create new advising explore session; confirm `workspace_path` under `advising-workspaces` (thread `8014`)
- [x] Confirm inventory includes `kind: project`
- [x] Repeat original advisor-filter prompt on that session (Codex turn succeeded)
