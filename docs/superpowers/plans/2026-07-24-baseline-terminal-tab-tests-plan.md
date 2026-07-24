# Terminal Tab Test Baseline Stabilization Implementation Plan

**Goal:** Make terminal-tab tests use valid ExUnit setup semantics and isolate the records they create.

**Architecture:** `TabStore` public functions address the application singleton, so the tests use that same process. Setup and teardown remove only the two deterministic test tab IDs and return `:ok`, as required by ExUnit.

**Tech Stack:** Elixir, ExUnit, GenServer

---

### Task 1: Replace the unused test process with scoped cleanup

**Files:**
- Modify: `elixir/test/symphony_elixir/terminal/tab_store_test.exs:6`

- [x] **Step 1: Verify both tests fail**

Run:

```bash
mix test test/symphony_elixir/terminal/tab_store_test.exs --trace
```

Expected: 2 failures reporting that setup returned `{:ok, pid}`.

- [x] **Step 2: Clean deterministic records around each test**

Replace setup with:

```elixir
setup do
  cleanup_tabs()
  on_exit(&cleanup_tabs/0)
  :ok
end
```

Add:

```elixir
defp cleanup_tabs do
  Enum.each(["tab-1", "tab-2"], fn id ->
    TabStore.delete("demo", "DEMO-1", id)
  end)
end
```

- [x] **Step 3: Verify**

Run:

```bash
mix test test/symphony_elixir/terminal/tab_store_test.exs
```

Expected: 2 tests, 0 failures.

- [x] **Step 4: Commit**

Commit as:

```text
test(terminal): isolate tab store fixtures
```
