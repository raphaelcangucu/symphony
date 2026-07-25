defmodule Mix.Tasks.Symphony.BackupTest do
  use ExUnit.Case, async: false

  import ExUnit.CaptureIO

  alias Mix.Tasks.Symphony.Backup, as: Task

  setup do
    tmp = Path.join(System.tmp_dir!(), "symphony-backup-mix-#{:erlang.unique_integer([:positive])}")
    db = Path.join(tmp, "tracker.sqlite3")
    backup_root = Path.join(tmp, "backups")

    SymphonyElixir.SqliteFixtures.create_database!(db)

    previous_app_env =
      Map.new(
        [SymphonyElixir.Repo, :backup_local_dir],
        &{&1, Application.fetch_env(:symphony_elixir, &1)}
      )

    previous_database_env = System.get_env("SYMPHONY_LOCAL_TRACKER_DATABASE")
    System.put_env("SYMPHONY_LOCAL_TRACKER_DATABASE", db)
    Application.put_env(:symphony_elixir, SymphonyElixir.Repo, database: db)
    Application.put_env(:symphony_elixir, :backup_local_dir, backup_root)

    on_exit(fn ->
      Enum.each(previous_app_env, fn {key, previous} -> restore_app_env(key, previous) end)
      restore_system_env("SYMPHONY_LOCAL_TRACKER_DATABASE", previous_database_env)
      File.rm_rf(tmp)
    end)

    {:ok, tmp: tmp}
  end

  test "create and list via mix task", %{tmp: tmp} do
    Mix.Task.reenable("app.config")
    Mix.Task.reenable("symphony.backup")

    output =
      File.cd!(tmp, fn ->
        capture_io(fn ->
          Task.run(["create", "--trigger", "manual"])
          Mix.Task.reenable("symphony.backup")
          Task.run(["list"])
        end)
      end)

    assert output =~ "✓  Backup id="
    assert output =~ "Backups (1)"
  end

  defp restore_app_env(key, {:ok, value}),
    do: Application.put_env(:symphony_elixir, key, value)

  defp restore_app_env(key, :error),
    do: Application.delete_env(:symphony_elixir, key)

  defp restore_system_env(key, nil), do: System.delete_env(key)
  defp restore_system_env(key, value), do: System.put_env(key, value)
end
