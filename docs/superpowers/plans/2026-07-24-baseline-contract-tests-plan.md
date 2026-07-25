# Contract Test Baseline Stabilization Implementation Plan

**Goal:** Align isolated regression tests with intentional API and catalog changes while removing one environment-dependent assertion.

**Architecture:** Tests derive dynamic contracts from their canonical modules where practical and otherwise assert the current structured response. No production behavior changes.

**Tech Stack:** Elixir, ExUnit, Phoenix test helpers

---

### Task 1: Align tool and tracker contracts

**Files:**
- Modify: `elixir/test/symphony_elixir/dynamic_tool_test.exs:201`
- Modify: `elixir/test/symphony_elixir/jira/sync_driver_test.exs:102`
- Modify: `elixir/test/symphony_elixir/github_client_test.exs:594`

- [x] **Step 1: Verify each assertion fails against the current contract**

Run the three tests at their listed lines. Expected failures are the plural
`require` message, the structured JIRA identity, and the added OpenCode label.

- [x] **Step 2: Assert the current contracts**

Use:

```elixir
assert Jason.decode!(text)["error"]["message"] =~ "require a `comment_id`"
assert {:ok, %{remote_id: "10010", identifier: "ABC-99", url: nil}} =
         SyncDriver.push(project, entry)
assert payload["variables"]["label"] in SymphonyElixir.AgentRouting.admission_labels()
```

### Task 2: Align goal and observability projections

**Files:**
- Modify: `elixir/test/symphony_elixir/agent_execution_test.exs:197`
- Modify: `elixir/test/symphony_elixir/extensions_test.exs:264`

- [x] **Step 1: Verify the tests expose the added fields**

Expected failures show projected goal capability `"stop"` and the running
entry fields `bundle_role`, `child_identifiers`, `parent_identifier`, `repo`,
`status`, and `unit_id`.

- [x] **Step 2: Add the new projection contract**

Expect:

```elixir
["get", "edit", "clear", "stop"]
```

Add the six observed bundle/status keys to the exact observability payload.

### Task 3: Use a valid model fixture and isolate editor port

**Files:**
- Modify: `elixir/test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs:599`
- Modify: `elixir/test/symphony_elixir/boot_instance_config_test.exs:8`

- [x] **Step 1: Verify both tests fail**

The issue test uses retired `claude-sonnet-4-5`; the boot test inherits
`SYMPHONY_EDITOR_PORT=4002`.

- [x] **Step 2: Update and isolate fixtures**

Use `claude-sonnet-4-6` for the model-clearing test. Save, clear, and restore
`SYMPHONY_EDITOR_PORT` alongside the existing environment variables.

### Task 4: Verify and commit

- [x] **Step 1: Run all focused files**

Run:

```bash
mix test \
  test/symphony_elixir/dynamic_tool_test.exs \
  test/symphony_elixir/jira/sync_driver_test.exs \
  test/symphony_elixir/github_client_test.exs \
  test/symphony_elixir/agent_execution_test.exs \
  test/symphony_elixir/extensions_test.exs \
  test/symphony_elixir/boot_instance_config_test.exs \
  test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs
```

Expected: 0 failures.

- [x] **Step 2: Commit**

Commit as:

```text
test: align regression contracts with current behavior
```
