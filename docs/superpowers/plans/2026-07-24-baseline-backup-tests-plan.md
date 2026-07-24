# Backup Test Baseline Stabilization Implementation Plan

**Goal:** Make backup tests exercise valid SQLite databases without leaking global application configuration into unrelated tests.

**Architecture:** Test fixtures create a minimal real SQLite database through Exqlite. Backup tests run synchronously because they mutate `Application` and process-wide environment settings, and every mutated value is restored after each test.

**Tech Stack:** Elixir, ExUnit, Exqlite

---

### Task 1: Add a reusable valid SQLite fixture

**Files:**
- Create: `elixir/test/support/sqlite_fixtures.exs`
- Modify: `elixir/test/test_helper.exs:1`

- [x] **Step 1: Define a minimal database creator**

Create:

```elixir
defmodule SymphonyElixir.SqliteFixtures do
  def create_database!(path) do
    File.mkdir_p!(Path.dirname(path))
    {:ok, conn} = Exqlite.Sqlite3.open(path)
    :ok = Exqlite.Sqlite3.execute(conn, "CREATE TABLE fixture (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
    :ok = Exqlite.Sqlite3.execute(conn, "INSERT INTO fixture (id, value) VALUES (1, 'original')")
    :ok = Exqlite.Sqlite3.close(conn)
    path
  end
end
```

Load it from `test/test_helper.exs` with:

```elixir
Code.require_file("support/sqlite_fixtures.exs", __DIR__)
```

### Task 2: Isolate backup module tests

**Files:**
- Modify: `elixir/test/symphony_elixir/backup_test.exs`

- [x] **Step 1: Serialize the module and create a real database**

Change the case declaration to:

```elixir
use ExUnit.Case, async: false
```

Replace the text fixture with:

```elixir
SymphonyElixir.SqliteFixtures.create_database!(db)
```

- [x] **Step 2: Restore every global value**

Capture `:root_dir`, repository configuration, backup directory, retention days, and the prior `SYMPHONY_LOCAL_TRACKER_DATABASE` value. Restore them in `on_exit/1`, using `System.delete_env/1` only when the environment variable was originally absent.

- [x] **Step 3: Assert restored SQLite content semantically**

Update the fixture row, restore the backup, and query it:

```elixir
SymphonyElixir.SqliteFixtures.execute!(db, "UPDATE fixture SET value = 'changed' WHERE id = 1")
assert {:ok, _} = Backup.restore(backup.id)
assert SymphonyElixir.SqliteFixtures.scalar!(db, "SELECT value FROM fixture WHERE id = 1") == "original"
```

This avoids comparing SQLite header bytes that `.backup` may legitimately rewrite.

### Task 3: Isolate the backup Mix task test

**Files:**
- Modify: `elixir/test/mix/tasks/symphony_backup_test.exs`

- [x] **Step 1: Use the SQLite fixture**

Replace the text database with:

```elixir
SymphonyElixir.SqliteFixtures.create_database!(db)
```

- [x] **Step 2: Restore mutated application configuration**

Capture the prior repository and backup-directory values before mutation, then restore both in `on_exit/1`.

### Task 4: Verify and commit

- [x] **Step 1: Run the focused tests**

Run:

```bash
mix test test/symphony_elixir/backup_test.exs test/mix/tasks/symphony_backup_test.exs
```

Expected: 4 tests, 0 failures.

- [x] **Step 2: Confirm there are no additional backup test files**

Run:

```bash
rg --files test | rg 'backup.*test\.exs$' | sort
```

Expected: only the two focused test files already run in Step 1.

- [x] **Step 3: Commit**

Commit the plan, fixture, and isolated test corrections as:

```text
test(backup): use isolated SQLite fixtures
```
