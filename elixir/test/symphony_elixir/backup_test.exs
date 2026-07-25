defmodule SymphonyElixir.BackupTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Backup

  setup do
    tmp = Path.join(System.tmp_dir!(), "symphony-backup-test-#{:erlang.unique_integer([:positive])}")
    db = Path.join(tmp, "tracker.sqlite3")
    backup_root = Path.join(tmp, "backups")

    SymphonyElixir.SqliteFixtures.create_database!(db)

    previous_app_env =
      Map.new(
        [:root_dir, SymphonyElixir.Repo, :backup_local_dir, :backup_retention_days],
        &{&1, Application.fetch_env(:symphony_elixir, &1)}
      )

    prev_database_env = System.get_env("SYMPHONY_LOCAL_TRACKER_DATABASE")

    Application.put_env(:symphony_elixir, :root_dir, tmp)
    System.put_env("SYMPHONY_LOCAL_TRACKER_DATABASE", db)
    Application.put_env(:symphony_elixir, SymphonyElixir.Repo, database: db)
    Application.put_env(:symphony_elixir, :backup_local_dir, backup_root)
    Application.put_env(:symphony_elixir, :backup_retention_days, 7)

    on_exit(fn ->
      if prev_database_env do
        System.put_env("SYMPHONY_LOCAL_TRACKER_DATABASE", prev_database_env)
      else
        System.delete_env("SYMPHONY_LOCAL_TRACKER_DATABASE")
      end

      Enum.each(previous_app_env, fn {key, previous} -> restore_app_env(key, previous) end)
      File.rm_rf(tmp)
    end)

    %{db: db, backup_root: backup_root}
  end

  test "create lists and restores database backup", %{db: db} do
    assert {:ok, backup} = Backup.create(trigger: "manual")
    assert backup.category == "database"
    assert File.exists?(backup.local_path)

    [listed] = Backup.list()
    assert listed.id == backup.id

    SymphonyElixir.SqliteFixtures.execute!(db, "UPDATE fixture SET value = 'changed' WHERE id = 1")

    assert {:ok, _} = Backup.restore(backup.id)
    assert SymphonyElixir.SqliteFixtures.scalar!(db, "SELECT value FROM fixture WHERE id = 1") == "original"
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

  defp restore_app_env(key, {:ok, value}),
    do: Application.put_env(:symphony_elixir, key, value)

  defp restore_app_env(key, :error),
    do: Application.delete_env(:symphony_elixir, key)
end
