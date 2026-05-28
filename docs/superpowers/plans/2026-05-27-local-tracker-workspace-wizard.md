# Local Tracker Workspace Wizard Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer inline execution in this session with checkpoints after each task. Use TDD: write focused failing tests, run them, then implement the minimum production code.

**Goal:** Add a deterministic local tracker workspace wizard that discovers GitHub repositories, scans selected local repositories, suggests workflow/setup metadata, and creates a multi-repository local tracker project.

**Architecture:** Backend adds repository/setup persistence plus local tracker setup services and JSON endpoints. Frontend adds a wizard entry point on the projects page and typed services for discovery, scanning, suggestions, and workspace project creation. Board utilities move toward dynamic workflow statuses while keeping legacy defaults as fallback.

**Tech Stack:** Elixir, Phoenix, Ecto, SQLite, GitHub GraphQL, React, TypeScript, Vitest, Testing Library.

---

## File Map

### Backend

- Create `elixir/priv/repo/migrations/20260527000500_create_local_tracker_project_repositories_and_setups.exs`: repository/setup tables.
- Create `elixir/lib/symphony_elixir/local_tracker/repository.ex`: repository schema and validation.
- Create `elixir/lib/symphony_elixir/local_tracker/project_setup.ex`: setup schema and validation.
- Modify `elixir/lib/symphony_elixir/local_tracker/project.ex`: add associations.
- Modify `elixir/lib/symphony_elixir/local_tracker/context.ex`: add `create_workspace_project/1` transaction.
- Create `elixir/lib/symphony_elixir/local_tracker/github_discovery.ex`: GitHub owner repository discovery.
- Create `elixir/lib/symphony_elixir/local_tracker/repository_scanner.ex`: read-only metadata scan.
- Create `elixir/lib/symphony_elixir/local_tracker/workflow_suggester.ex`: deterministic suggestions.
- Create `elixir/lib/symphony_elixir_web/controllers/tracker/github_controller.ex`: repository discovery endpoint.
- Create `elixir/lib/symphony_elixir_web/controllers/tracker/project_setup_controller.ex`: scan/suggest endpoints.
- Modify `elixir/lib/symphony_elixir_web/controllers/tracker/project_controller.ex`: workspace project create endpoint.
- Modify `elixir/lib/symphony_elixir_web/router.ex`: add routes.
- Modify `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`: include repositories/setup in project payloads.
- Add focused backend tests under `elixir/test/symphony_elixir/local_tracker/` and `elixir/test/symphony_elixir_web/controllers/tracker/`.

### Frontend

- Create `tracker/src/types/repository.ts`: repository and scan types.
- Create `tracker/src/types/project-setup.ts`: suggestion/setup types.
- Create `tracker/src/services/projectSetup.ts`: typed setup API.
- Modify `tracker/src/services/projects.ts`: add `createWorkspaceProject`.
- Modify `tracker/src/types/project.ts`: include repositories/setup fields.
- Modify `tracker/src/services/mappers.ts`: normalize repository/setup payloads.
- Create `tracker/src/components/projects/ProjectWorkspaceWizard.tsx`: multi-step wizard.
- Modify `tracker/src/pages/ProjectListPage.tsx`: use wizard entry point.
- Modify `tracker/src/components/board/board-utils.ts`: allow dynamic workflow status lists.
- Add focused frontend tests under `tracker/src/services/__tests__/`, `tracker/src/components/projects/__tests__/`, and `tracker/src/components/board/__tests__/`.

---

## Task 1: Persist Workspace Project Metadata

- [ ] Write backend schema/context tests asserting `create_workspace_project/1` persists a project, repositories, custom statuses, and setup metadata in one transaction.
- [ ] Run the focused backend test and verify it fails because schemas/context are missing.
- [ ] Add repository/setup migrations and schemas.
- [ ] Add project associations and `Context.create_workspace_project/1`.
- [ ] Run the focused backend test and verify it passes.

## Task 2: Add Deterministic Setup Services

- [ ] Write tests for repository scanning fixture directories without executing commands.
- [ ] Write tests for workflow suggestions from frontend/backend repository facts.
- [ ] Write tests for GitHub discovery with mocked GraphQL pages.
- [ ] Run the focused tests and verify they fail because services are missing.
- [ ] Implement `RepositoryScanner`, `WorkflowSuggester`, and `GitHubDiscovery`.
- [ ] Run focused tests and verify they pass.

## Task 3: Expose Workspace Wizard API

- [ ] Write controller tests for authenticated GitHub repo listing, scan, suggest, and workspace project creation.
- [ ] Run controller tests and verify they fail because routes/controllers are missing.
- [ ] Add routes/controllers and presenter payload support.
- [ ] Run controller tests and verify they pass.

## Task 4: Add Frontend Services and DTO Mapping

- [ ] Write Vitest service/mapper tests for discovery, scan, suggest, and workspace project creation payloads.
- [ ] Run focused frontend tests and verify they fail because services/mappers are missing.
- [ ] Add frontend types, service functions, and mapper normalization.
- [ ] Run focused frontend tests and verify they pass.

## Task 5: Build Workspace Wizard UI

- [ ] Write a Testing Library test for opening the wizard, selecting mocked repositories, applying suggestions, and creating a project.
- [ ] Run the focused test and verify it fails because the wizard is missing.
- [ ] Implement `ProjectWorkspaceWizard` and replace the project list entry point.
- [ ] Run the focused test and verify it passes.

## Task 6: Render Dynamic Workflow Statuses

- [ ] Write board utility tests that build board state from custom project statuses.
- [ ] Run the focused test and verify it fails against hardcoded statuses.
- [ ] Refactor board utilities to accept dynamic workflow status lists with legacy fallback.
- [ ] Run focused board tests and existing board tests.

## Task 7: Final Verification

- [ ] Run backend focused tests for local tracker workspace wizard.
- [ ] Run frontend focused tests for services, wizard, and board utilities.
- [ ] Run `npm run build` in `tracker/`.
- [ ] Run linter diagnostics for touched files.
- [ ] Summarize remaining known limitations.

