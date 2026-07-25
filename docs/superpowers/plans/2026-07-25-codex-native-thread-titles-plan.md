# Codex Native Thread Titles Implementation Plan

**Goal:** Keep Codex app thread names aligned with Symphony session titles and hide one-shot title-generation threads from active history.

**Architecture:** Extend the Codex app-server client with the native `thread/name/set` and `thread/archive` requests. Persistent assistant sessions pass their canonical Symphony title into every Codex start/resume, while manual and generated title changes reconcile the stored native thread immediately. Title-generation runs opt into best-effort archival during teardown.

**Tech Stack:** Elixir, ExUnit, Codex app-server JSON-RPC v2

---

### Task 1: Add native name and archive protocol support

**Files:**
- Modify: `elixir/lib/symphony_elixir/codex/coding_agent.ex`
- Test: `elixir/test/symphony_elixir/codex/coding_agent_test.exs`

- [x] **Step 1: Write failing protocol tests**

Add tests that assert:

```elixir
assert message_with_method(messages, "thread/name/set")["params"] ==
         %{"threadId" => "thread-goal", "name" => "Chat · SYM-13 · Native titles"}

assert message_order(messages) |> Enum.take(-1) == ["thread/archive"]
```

Cover a nonblank `:thread_name`, whitespace omission, and `:archive_on_stop`.

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
cd elixir
mix test test/symphony_elixir/codex/coding_agent_test.exs
```

Expected: failures because neither JSON-RPC request is emitted.

- [x] **Step 3: Implement minimal protocol operations**

Add request IDs and helpers that emit:

```elixir
%{
  "method" => "thread/name/set",
  "params" => %{"threadId" => thread_id, "name" => name}
}
```

and:

```elixir
%{
  "method" => "thread/archive",
  "params" => %{"threadId" => thread_id}
}
```

Apply a nonblank `:thread_name` after start/resume and perform best-effort
archival in `run/4` teardown when `:archive_on_stop` is true.

- [x] **Step 4: Run tests and verify GREEN**

Run:

```bash
cd elixir
mix test test/symphony_elixir/codex/coding_agent_test.exs
```

Expected: all tests pass.

### Task 2: Feed canonical titles into persistent Codex threads

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/agent_session.ex`
- Test: `elixir/test/symphony_elixir/assistant/agent_session_test.exs`

- [x] **Step 1: Write a failing option-propagation test**

For a titled Codex-backed assistant thread, assert the injected runner receives:

```elixir
assert Keyword.fetch!(opts, :thread_name) == thread.title
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd elixir
mix test test/symphony_elixir/assistant/agent_session_test.exs
```

Expected: failure because `:thread_name` is absent.

- [x] **Step 3: Add the canonical title to Codex runner options**

Introduce one helper that adds `:thread_name` only for Codex-backed threads and
call it from every persistent assistant scope before starting the runner.

- [x] **Step 4: Run tests and verify GREEN**

Run:

```bash
cd elixir
mix test test/symphony_elixir/assistant/agent_session_test.exs
```

Expected: all tests pass.

### Task 3: Reconcile manual and generated renames

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/native_thread_names.ex`
- Modify: `elixir/lib/symphony_elixir/assistant/title_generator.ex`
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex`
- Test: `elixir/test/symphony_elixir/assistant/native_thread_names_test.exs`
- Test: `elixir/test/symphony_elixir/assistant/title_generator_test.exs`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs`

- [x] **Step 1: Write failing reconciliation tests**

Verify that Codex threads with a native ID, workspace, and nonblank title invoke
an injected name setter, while non-Codex or incomplete threads are skipped.
Verify manual controller renames and generated titles call the reconciler.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
cd elixir
mix test test/symphony_elixir/assistant/native_thread_names_test.exs
mix test test/symphony_elixir/assistant/title_generator_test.exs
mix test test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs
```

Expected: failures because reconciliation does not exist.

- [x] **Step 3: Implement best-effort reconciliation**

Add a focused module that calls `CodingAgent.set_thread_name/4`, returns the
thread unchanged, and logs failures without rolling back Symphony's persisted
title. Call it after title persistence in both manual and generated paths.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the same three commands. Expected: all tests pass.

### Task 4: Archive title-generator helper threads

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/title_generator.ex`
- Test: `elixir/test/symphony_elixir/assistant/title_generator_test.exs`

- [x] **Step 1: Write a failing runner-options test**

Assert the title generator invokes its runner with:

```elixir
assert Keyword.fetch!(runner_opts, :archive_on_stop)
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd elixir
mix test test/symphony_elixir/assistant/title_generator_test.exs
```

Expected: failure because the option is absent.

- [x] **Step 3: Enable teardown archival**

Add `archive_on_stop: true` only to the title generator's one-shot runner
options.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the same command. Expected: all tests pass.

### Task 5: Validate and publish

**Files:**
- Modify: `docs/superpowers/plans/2026-07-25-codex-native-thread-titles-plan.md`

- [ ] **Step 1: Run format, specs, and full quality gates**

Run:

```bash
make -C elixir all
```

Expected: exit 0 with no failures.

Executed on 2026-07-25. Focused formatting and 96 affected tests pass. The
repository-wide gate remains blocked by pre-existing formatting drift and
three missing `@spec` declarations outside this diff.

- [x] **Step 2: Review the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only intended files changed.

- [x] **Step 3: Request code review and address findings**

Review the diff against the three requested behaviors, fix all Critical and
Important findings, then rerun the affected focused tests and full quality gate.

- [ ] **Step 4: Commit, push, and open the PR**

Use a conventional commit, push `fix/codex-native-thread-titles`, fill every
section of `.github/pull_request_template.md`, validate it with
`mix pr_body.check`, and return the PR URL.
