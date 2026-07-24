defmodule SymphonyElixir.Daemon.MigrationTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Migration

  test "migrates a consistent database while preserving the source" do
    root = tmp_root()
    source = Path.join(root, "source.sqlite3")
    destination = Path.join(root, "data/tracker.sqlite3")
    backups = Path.join(root, "data/backups")
    create_fixture(source, "alpha")
    source_hash = sha256(source)

    assert {:ok, result} =
             Migration.migrate(source, destination,
               backup_dir: backups,
               dev_daemon_running?: fn -> false end,
               migrate: fn path ->
                 assert path == destination
                 :ok
               end
             )

    assert result.source_sha256 == source_hash
    assert sha256(source) == source_hash
    assert query_value(destination, "SELECT value FROM migration_fixture") == "alpha"
    assert Migration.integrity(destination) == :ok
  end

  test "refuses a live development owner before reading the database" do
    assert {:error, :development_daemon_running} =
             Migration.migrate("/missing/source", "/missing/dest",
               backup_dir: "/missing/backups",
               dev_daemon_running?: fn -> true end
             )
  end

  test "force backs up an existing destination before replacement" do
    root = tmp_root()
    source = Path.join(root, "source.sqlite3")
    destination = Path.join(root, "tracker.sqlite3")
    backups = Path.join(root, "backups")
    create_fixture(source, "new")
    create_fixture(destination, "old")

    assert {:ok, result} =
             Migration.migrate(source, destination,
               backup_dir: backups,
               force: true,
               dev_daemon_running?: fn -> false end,
               migrate: fn _ -> :ok end
             )

    assert File.exists?(result.previous_backup)
    assert query_value(result.previous_backup, "SELECT value FROM migration_fixture") == "old"
    assert query_value(destination, "SELECT value FROM migration_fixture") == "new"
  end

  defp tmp_root do
    root =
      Path.join(
        System.tmp_dir!(),
        "daemon-migration-#{System.unique_integer([:positive, :monotonic])}"
      )

    File.mkdir_p!(root)
    on_exit(fn -> File.rm_rf!(root) end)
    root
  end

  defp create_fixture(path, value) do
    File.mkdir_p!(Path.dirname(path))
    {:ok, db} = Exqlite.Sqlite3.open(path)
    :ok = Exqlite.Sqlite3.execute(db, "PRAGMA journal_mode=WAL")
    :ok = Exqlite.Sqlite3.execute(db, "CREATE TABLE migration_fixture (value TEXT NOT NULL)")
    {:ok, statement} = Exqlite.Sqlite3.prepare(db, "INSERT INTO migration_fixture(value) VALUES (?)")
    :ok = Exqlite.Sqlite3.bind(statement, [value])
    :done = Exqlite.Sqlite3.step(db, statement)
    :ok = Exqlite.Sqlite3.release(db, statement)
    :ok = Exqlite.Sqlite3.close(db)
  end

  defp query_value(path, sql) do
    {:ok, db} = Exqlite.Sqlite3.open(path, mode: :readonly)
    {:ok, statement} = Exqlite.Sqlite3.prepare(db, sql)
    {:row, [value]} = Exqlite.Sqlite3.step(db, statement)
    :ok = Exqlite.Sqlite3.release(db, statement)
    :ok = Exqlite.Sqlite3.close(db)
    value
  end

  defp sha256(path) do
    path
    |> File.read!()
    |> then(&:crypto.hash(:sha256, &1))
    |> Base.encode16(case: :lower)
  end
end
