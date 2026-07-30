defmodule Mix.Tasks.Symphony.BackupTest do
  use ExUnit.Case, async: false

  import ExUnit.CaptureIO

  alias Mix.Tasks.Symphony.Backup, as: Task

  setup do
    tmp = Path.join(System.tmp_dir!(), "symphony-backup-mix-#{:erlang.unique_integer([:positive])}")
    db = Path.join(tmp, "tracker.sqlite3")
    backup_root = Path.join(tmp, "backups")

    File.mkdir_p!(Path.dirname(db))
    File.write!(db, String.duplicate("mix-task-db", 100))

    Application.put_env(:symphony_elixir, SymphonyElixir.Repo, database: db)
    Application.put_env(:symphony_elixir, :backup_local_dir, backup_root)

    on_exit(fn -> File.rm_rf(tmp) end)
    :ok
  end

  test "create and list via mix task" do
    Mix.Task.reenable("app.config")
    Mix.Task.reenable("symphony.backup")

    output =
      capture_io(fn ->
        Task.run(["create", "--trigger", "manual"])
        Mix.Task.reenable("symphony.backup")
        Task.run(["list"])
      end)

    assert output =~ "✓  Backup id="
    assert output =~ "Backups (1)"
  end
end
