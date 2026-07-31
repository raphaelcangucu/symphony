defmodule SymphonyElixir.BackupTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Backup

  setup do
    tmp = Path.join(System.tmp_dir!(), "symphony-backup-test-#{:erlang.unique_integer([:positive])}")
    db = Path.join(tmp, "tracker.sqlite3")
    backup_root = Path.join(tmp, "backups")
    database_contents = String.duplicate("sqlite-test-db", 100)

    File.mkdir_p!(Path.dirname(db))
    File.write!(db, database_contents)

    prev_db = Application.get_env(:symphony_elixir, SymphonyElixir.Repo)[:database]
    prev_backup = Application.get_env(:symphony_elixir, :backup_local_dir)

    Application.put_env(:symphony_elixir, :root_dir, tmp)
    System.put_env("SYMPHONY_LOCAL_TRACKER_DATABASE", db)
    Application.put_env(:symphony_elixir, SymphonyElixir.Repo, database: db)
    Application.put_env(:symphony_elixir, :backup_local_dir, backup_root)
    Application.put_env(:symphony_elixir, :backup_retention_days, 7)

    on_exit(fn ->
      System.delete_env("SYMPHONY_LOCAL_TRACKER_DATABASE")
      Application.put_env(:symphony_elixir, SymphonyElixir.Repo, database: prev_db)
      Application.put_env(:symphony_elixir, :backup_local_dir, prev_backup)
      File.rm_rf(tmp)
    end)

    %{db: db, backup_root: backup_root, database_contents: database_contents}
  end

  test "create lists and restores database backup", %{db: db, database_contents: database_contents} do
    assert {:ok, backup} = Backup.create(trigger: "manual")
    assert backup.category == "database"
    assert File.exists?(backup.local_path)

    [listed] = Backup.list()
    assert listed.id == backup.id

    File.write!(db, "restored-content")

    assert {:ok, _} = Backup.restore(backup.id)
    assert File.read!(db) == database_contents
  end

  test "cleanup removes expired backups" do
    assert {:ok, backup} = Backup.create(trigger: "manual")

    past = DateTime.add(DateTime.utc_now(), -10, :day)

    {:ok, expired} =
      Backup.Manifest.update(Backup.manifest_path(), backup.id, fn r ->
        %{r | expires_at: past}
      end)

    assert expired.id == backup.id
    assert Backup.cleanup_expired() == 1
    assert Backup.list() == []
  end

  test "delete removes record and file" do
    assert {:ok, backup} = Backup.create(trigger: "manual")
    path = backup.local_path
    assert :ok = Backup.delete(backup.id)
    refute File.exists?(path)
    assert Backup.list() == []
  end
end
