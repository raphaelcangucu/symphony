# Workspace Test Baseline Stabilization Implementation Plan

**Goal:** Align legacy workspace tests with atomic, non-destructive provisioning guarantees.

**Architecture:** Existing workspace contents are preserved, blocked filesystem paths remain untouched, provisioning failures use `Workspace.Provision.Error`, and `after_create` completes without the lifecycle-hook timeout. Repository fixtures use real Git metadata.

**Tech Stack:** Elixir, ExUnit, Git, Symphony workspace provisioner

---

### Task 1: Assert non-destructive existing-path behavior

**Files:**
- Modify: `elixir/test/symphony_elixir/workspace_and_config_test.exs:106`
- Modify: `elixir/test/symphony_elixir/workspace_and_config_test.exs:142`

- [x] **Step 1: Verify both legacy assertions fail**

The existing `tmp/scratch.txt` is preserved, and a regular file at the target
path returns a structured non-retryable `:workspace_path_blocked` error.

- [x] **Step 2: Assert the safe behavior**

Assert the scratch file remains. For the blocked path, match:

```elixir
{:error,
 %SymphonyElixir.Workspace.Provision.Error{
   stage: :inspect_final,
   reason: {:workspace_path_blocked, ^stale_workspace, :regular},
   retryable: false
 }}
```

Also assert the stale path remains a regular file.

### Task 2: Assert structured hook behavior

**Files:**
- Modify: `elixir/test/symphony_elixir/workspace_and_config_test.exs:207`
- Modify: `elixir/test/symphony_elixir/workspace_and_config_test.exs:227`

- [x] **Step 1: Verify legacy hook assertions fail**

Failure is wrapped in `Workspace.Provision.Error`; `after_create` intentionally
ignores the lifecycle timeout and succeeds after the command exits.

- [x] **Step 2: Match the structured failure**

Match `stage: :after_create`, `retryable: true`, and the nested
`{:workspace_hook_failed, "after_create", 17, output}` reason.

- [x] **Step 3: Prove after_create is allowed to finish**

Use a command that sleeps longer than the configured 10 ms and writes
`ready.txt`; assert provisioning succeeds and the file contains `ready`.

### Task 3: Use a real Git repository fixture

**Files:**
- Modify: `elixir/test/symphony_elixir/workspace_test.exs:121`

- [x] **Step 1: Verify the fake `.git` directory is rejected**

Expected: `:git_repository_unusable` during the validation stage.

- [x] **Step 2: Initialize an actual repository**

Replace `mkdir -p front/.git/info` with:

```text
git init -b main front
```

### Task 4: Verify and commit

- [x] **Step 1: Run both workspace files**

Run:

```bash
mix test test/symphony_elixir/workspace_and_config_test.exs test/symphony_elixir/workspace_test.exs
```

Expected: 0 failures.

- [x] **Step 2: Commit**

Commit as:

```text
test(workspace): align fixtures with atomic provisioning
```
