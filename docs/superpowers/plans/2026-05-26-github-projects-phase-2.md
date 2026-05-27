# GitHub Projects v2 — Phase 2 + 3 Implementation Plan

**Goal:** Linear parity for assignee routing, state reconciliation, branch_name, blockers, and `github_graphql`.

**Spec:** `docs/superpowers/specs/2026-05-26-github-projects-phase-2-design.md`

**Branch:** `feat/github-projects-phase-2`

---

### Task 1: Spec (done)

Commit: `docs/superpowers/specs/2026-05-26-github-projects-phase-2-design.md`

---

### Task 2: Plan (this file)

Commit: `docs/superpowers/plans/2026-05-26-github-projects-phase-2.md`

---

### Task 3: Macro Markets bootstrap

**Files:** `elixir/WORKFLOW.macromarkets.example.md`, `elixir/scripts/bootstrap_macro_markets.exs`

- GraphQL: resolve `clouapp/front` owner id → `createProjectV2` title "Macro Markets" → `createProjectV2Field` "Symphony State" with WORKFLOW states.
- Write captured IDs into example WORKFLOW + print JSON for `.symphony/github-project.json`.

---

### Task 4: Seed issues (user-driven)

Pause until user provides task list. Provide `elixir/scripts/seed_macro_markets_issues.exs` accepting title/state pairs.

---

### Task 5: Assignee filter

**Files:** `github/viewer.ex`, `github/config.ex`, `github/client.ex`, tests

---

### Task 6: State reconciliation

**Files:** `github/state_reconciliation.ex`, `github/bootstrap.ex`, tests

---

### Task 7: branch_name

**Files:** `github/client.ex` (query + normalize), tests

---

### Task 8: Blockers

**Files:** `github/blockers.ex`, `github/client.ex`, tests

---

### Task 9: github_graphql tool

**Files:** `codex/dynamic_tool.ex`, `dynamic_tool_test.exs`

---

### Task 10: Docs + CI

**Files:** `README.md`, `troubleshooting.md`, `make all`, push PR
