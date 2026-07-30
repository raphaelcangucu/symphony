# PR 13 CI Stabilization Implementation Plan

**Goal:** Make `make all` pass on PR 13 without weakening CI coverage or hiding existing failures.

**Architecture:** Triage the failing suite by deterministic failure family. For each family, reproduce a focused failing test, correct either the production contract or its outdated fixture, run the focused module, then rerun the complete coverage suite.

**Tech Stack:** Elixir 1.19, ExUnit, Ecto/SQLite, Phoenix, GitHub Actions.

---

### Task 1: Preserve KB automated commit identity

**Files:**
- Modify: `elixir/lib/symphony_elixir/knowledge_base/git.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base/git_test.exs`

- [x] **Step 1: Add a regression test for explicit nil identity values.**

```elixir
assert {:ok, sha} = Git.commit(wt, "docs(kb): use defaults", name: nil, email: nil)
assert is_binary(sha) and byte_size(sha) >= 7
```

- [x] **Step 2: Confirm the test fails because Git receives an empty author.**

Run: `make test ARGS='test/symphony_elixir/knowledge_base/git_test.exs:90 --seed 0'`

- [x] **Step 3: Normalize nil and empty identity options to the deterministic defaults.**

- [x] **Step 4: Run the focused Git and KB write-controller suites.**

Run: `make test ARGS='test/symphony_elixir/knowledge_base/git_test.exs --seed 0' && make test ARGS='test/symphony_elixir_web/controllers/tracker/knowledge_base_write_controller_test.exs --seed 0'`

### Task 2: Correct backup test fixtures for the restore safety threshold

**Files:**
- Modify: `elixir/test/symphony_elixir/backup_test.exs`
- Test: `elixir/test/mix/tasks/symphony_backup_test.exs`

- [x] **Step 1: Reproduce the test failure caused by the 14-byte fake database.**

Run: `make test ARGS='test/symphony_elixir/backup_test.exs --seed 0'`

- [x] **Step 2: Replace each fake database fixture with a byte payload at or above `Backup`'s restore minimum, while preserving the assertion that restore returns the original bytes.**

- [x] **Step 3: Run both backup suites.**

Run: `make test ARGS='test/symphony_elixir/backup_test.exs test/mix/tasks/symphony_backup_test.exs --seed 0'`

### Task 3: Reconcile evidence screenshot labels with artifact paths

**Files:**
- Modify: `elixir/lib/symphony_elixir/orchestrator_run_contract.ex`
- Test: `elixir/test/symphony_elixir/orchestrator_run_contract_test.exs`

- [x] **Step 1: Reproduce the two screenshot-label assertions.**

Run: `make test ARGS='test/symphony_elixir/orchestrator_run_contract_test.exs --seed 0'`

- [x] **Step 2: Confirm `artifact_label/1` intentionally removes extensions from display labels and update the stale comment assertions while preserving artifact URLs.**

- [x] **Step 3: Run the contract test module.**

Run: `make test ARGS='test/symphony_elixir/orchestrator_run_contract_test.exs --seed 0'`

### Task 4: Stabilize remaining failure families from Actions run 30549315822

**Files:**
- Inspect and modify only the production/test file named by each focused ExUnit failure.
- Test: the corresponding focused ExUnit module before every production change.

- [ ] **Step 1: Work through workspace/Codex cwd contract failures.**

Run: `make test ARGS='test/symphony_elixir/assistant/agent_session_goal_relay_test.exs test/symphony_elixir/assistant/agent_session_file_change_capture_test.exs --seed 0'`

- [ ] **Step 2: Work through tracker/controller state-contract failures.**

Run: `make test ARGS='test/symphony_elixir_web/controllers/tracker/assistant_controller_test.exs test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs --seed 0'`

- [ ] **Step 3: Work through process lifecycle and timeout failures.**

Run: `make test ARGS='test/symphony_elixir/cursor/acp_client_test.exs test/symphony_elixir/app_server_test.exs --seed 0'`

- [ ] **Step 4: Rerun complete coverage after every resolved failure family.**

Run: `make coverage ARGS='--seed 0'`

### Task 5: Validate and publish

**Files:**
- Modify: this plan's checkboxes with the final commands and results.

- [ ] **Step 1: Run formatting, lint, coverage, and Dialyzer through the CI entrypoint.**

Run: `make all`

- [ ] **Step 2: Push the commits to `codex/remote-mcp` and verify all PR 13 checks succeed.**

Run: `git push && gh pr checks 13 --watch --fail-fast`
