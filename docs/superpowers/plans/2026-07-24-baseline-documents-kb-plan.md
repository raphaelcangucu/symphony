# Documents and Knowledge Base Baseline Stabilization Implementation Plan

**Goal:** Correct issue-document fixtures for nested workspaces and prevent asset names from corrupting Git commit identity.

**Architecture:** Issue-document tests write through the canonical `Workspace.path_for_issue/1` layout. Knowledge-base writes reserve `name` for asset naming and use distinct `author_name` / `author_email` options when constructing Git commit options.

**Tech Stack:** Elixir, ExUnit, Git, Phoenix controller tests

---

### Task 1: Write issue documents to the canonical workspace

**Files:**
- Modify: `elixir/test/symphony_elixir_web/controllers/tracker/issue_document_controller_test.exs`

- [x] **Step 1: Verify all four controller tests fail**

Expected: `workspace_missing`, because the fixture writes to
`<root>/<identifier>` instead of `<root>/<project>/<identifier>`.

- [x] **Step 2: Resolve the workspace through production code**

Alias `SymphonyElixir.Workspace`, compute:

```elixir
workspace = Workspace.path_for_issue(issue)
```

Change the document helper to accept that workspace directly and write under:

```elixir
Path.join([workspace, "docs", "superpowers", "specs"])
```

### Task 2: Separate asset naming from Git authorship

**Files:**
- Modify: `elixir/lib/symphony_elixir/knowledge_base/writer.ex:243`
- Modify: `elixir/test/symphony_elixir/knowledge_base/writer_test.exs:76`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/knowledge_base_write_controller_test.exs:75`

- [x] **Step 1: Capture the Git failure**

Controller diagnostics show an empty `user.name` because upload passes
`name: nil`. A new writer assertion also fails because friendly asset name
`Queue Config!` becomes the Git author.

- [x] **Step 2: Build Git options from dedicated keys**

Keep `:runner`, map non-nil `:author_name` to Git `:name`, and map non-nil
`:author_email` to Git `:email`. Do not pass the asset `:name` option.

- [x] **Step 3: Verify the regression tests**

Run:

```bash
mix test \
  test/symphony_elixir/knowledge_base/writer_test.exs \
  test/symphony_elixir_web/controllers/tracker/knowledge_base_write_controller_test.exs
```

Expected: 24 tests, 0 failures.

### Task 3: Verify and commit

- [x] **Step 1: Run all three focused files**

Run:

```bash
mix test \
  test/symphony_elixir_web/controllers/tracker/issue_document_controller_test.exs \
  test/symphony_elixir/knowledge_base/writer_test.exs \
  test/symphony_elixir_web/controllers/tracker/knowledge_base_write_controller_test.exs
```

Expected: 28 tests, 0 failures.

- [x] **Step 2: Commit**

Commit as:

```text
fix(kb): separate asset names from commit authors
```
