defmodule SymphonyElixir.Daemon.Migration do
  @moduledoc "Consistent, source-preserving SQLite migration for daemon install."

  alias SymphonyElixir.Daemon.Files

  @spec snapshot(Path.t(), Path.t()) :: :ok | {:error, term()}
  def snapshot(source, destination) do
    temp = destination <> ".tmp.#{System.unique_integer([:positive, :monotonic])}"
    :ok = Files.ensure_private_dir(Path.dirname(destination))

    with {:ok, db} <- Exqlite.Sqlite3.open(source, mode: :readonly),
         {:ok, binary} <- Exqlite.Sqlite3.serialize(db),
         :ok <- Exqlite.Sqlite3.close(db),
         :ok <- write_synced(temp, binary),
         :ok <- integrity(temp),
         :ok <- File.rename(temp, destination) do
      :ok
    else
      {:error, _reason} = error ->
        File.rm(temp)
        error
    end
  end

  @spec integrity(Path.t()) :: :ok | {:error, term()}
  def integrity(path) do
    with {:ok, db} <- Exqlite.Sqlite3.open(path, mode: :readonly),
         {:ok, statement} <- Exqlite.Sqlite3.prepare(db, "PRAGMA integrity_check"),
         {:row, ["ok"]} <- Exqlite.Sqlite3.step(db, statement),
         :ok <- Exqlite.Sqlite3.release(db, statement),
         :ok <- Exqlite.Sqlite3.close(db) do
      :ok
    else
      other -> {:error, {:integrity_check_failed, other}}
    end
  end

  @spec valid?(Path.t()) :: boolean()
  def valid?(path) do
    with :ok <- integrity(path),
         {:ok, db} <- Exqlite.Sqlite3.open(path, mode: :readonly) do
      try do
        with {:ok, statement} <-
               Exqlite.Sqlite3.prepare(db, "SELECT COUNT(*) FROM schema_migrations"),
             {:row, [count]} when is_integer(count) and count > 0 <-
               Exqlite.Sqlite3.step(db, statement),
             :ok <- Exqlite.Sqlite3.release(db, statement) do
          true
        else
          _ -> false
        end
      after
        Exqlite.Sqlite3.close(db)
      end
    else
      _ -> false
    end
  end

  @spec migrate(Path.t(), Path.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def migrate(source, destination, opts \\ []) do
    running? = Keyword.get(opts, :dev_daemon_running?, &development_daemon_running?/0)
    force? = Keyword.get(opts, :force, false)
    backup_dir = Keyword.fetch!(opts, :backup_dir)
    migrate_fun = Keyword.get(opts, :migrate, &migrate_release/1)

    cond do
      running?.() ->
        {:error, :development_daemon_running}

      not File.regular?(source) ->
        {:error, :source_missing}

      File.exists?(destination) and not force? ->
        {:error, :destination_exists}

      true ->
        perform_migration(source, destination, backup_dir, migrate_fun)
    end
  end

  @spec migrate_release(Path.t()) :: :ok | {:error, term()}
  def migrate_release(database) do
    previous_repo =
      Application.get_env(:symphony_elixir, SymphonyElixir.Repo, [])

    Application.put_env(
      :symphony_elixir,
      SymphonyElixir.Repo,
      Keyword.put(previous_repo, :database, database)
    )

    Application.put_env(:symphony_elixir, :local_tracker_database_pinned?, true)

    case Ecto.Migrator.with_repo(SymphonyElixir.Repo, fn repo ->
           Ecto.Migrator.run(repo, :up, all: true)
         end) do
      {:ok, _versions, _apps} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  @spec prepare_upgrade(Path.t(), Path.t()) :: {:ok, map()} | {:error, term()}
  def prepare_upgrade(database, backup_dir) do
    database_existed? = File.exists?(database)

    with {:ok, previous_backup} <- backup_existing(database, backup_dir) do
      {:ok,
       %{
         database_existed?: database_existed?,
         previous_backup: previous_backup
       }}
    end
  end

  @spec migrate_in_place(Path.t(), Path.t()) :: {:ok, map()} | {:error, term()}
  def migrate_in_place(database, backup_dir) do
    with {:ok, rollback} <- prepare_upgrade(database, backup_dir) do
      result =
        with :ok <- migrate_release(database),
             :ok <- integrity(database) do
          {:ok,
           Map.merge(rollback, %{
             source_sha256: nil,
             destination_sha256: sha256(database)
           })}
        end

      restore_on_error(result, database, rollback)
    end
  end

  @spec restore(Path.t(), map()) :: :ok | {:error, term()}
  def restore(database, %{previous_backup: backup}) when is_binary(backup) do
    snapshot(backup, database)
  end

  def restore(database, %{database_existed?: false}) do
    case File.rm(database) do
      :ok -> :ok
      {:error, :enoent} -> :ok
      {:error, _reason} = error -> error
    end
  end

  def restore(_database, _migration), do: :ok

  defp perform_migration(source, destination, backup_dir, migrate_fun) do
    source_hash = sha256(source)
    database_existed? = File.exists?(destination)

    with {:ok, previous_backup} <- backup_existing(destination, backup_dir) do
      rollback = %{
        database_existed?: database_existed?,
        previous_backup: previous_backup
      }

      result =
        with :ok <- activate_snapshot(source, destination),
             :ok <- migrate_fun.(destination),
             :ok <- integrity(destination),
             ^source_hash <- sha256(source) do
          {:ok,
           %{
             source_sha256: source_hash,
             destination_sha256: sha256(destination),
             previous_backup: previous_backup,
             database_existed?: database_existed?
           }}
        else
          changed when is_binary(changed) -> {:error, :source_changed_during_migration}
          {:error, _reason} = error -> error
        end

      restore_on_error(result, destination, rollback)
    end
  end

  defp restore_on_error({:ok, _migration} = success, _destination, _rollback), do: success

  defp restore_on_error({:error, _reason} = error, destination, rollback) do
    case restore(destination, rollback) do
      :ok -> error
      {:error, restore_reason} -> {:error, {:migration_rollback_failed, error, restore_reason}}
    end
  end

  defp backup_existing(destination, backup_dir) do
    if File.exists?(destination) do
      :ok = Files.ensure_private_dir(backup_dir)

      timestamp =
        DateTime.utc_now()
        |> DateTime.truncate(:second)
        |> DateTime.to_iso8601()
        |> String.replace(~r/[^0-9A-Za-z]/, "")

      backup = Path.join(backup_dir, "pre_install_#{timestamp}.sqlite3")

      case snapshot(destination, backup) do
        :ok -> {:ok, backup}
        {:error, _reason} = error -> error
      end
    else
      {:ok, nil}
    end
  end

  defp activate_snapshot(source, destination) do
    incoming = destination <> ".incoming.#{System.unique_integer([:positive, :monotonic])}"

    with :ok <- snapshot(source, incoming),
         :ok <- File.rename(incoming, destination) do
      :ok
    else
      {:error, _reason} = error ->
        File.rm(incoming)
        error
    end
  end

  defp write_synced(path, binary) do
    with {:ok, file} <- File.open(path, [:write, :binary, :exclusive]),
         :ok <- IO.binwrite(file, binary),
         :ok <- :file.sync(file),
         :ok <- File.close(file) do
      :ok
    end
  end

  defp sha256(path) do
    path
    |> File.read!()
    |> then(&:crypto.hash(:sha256, &1))
    |> Base.encode16(case: :lower)
  end

  defp development_daemon_running? do
    case SymphonyElixir.DevServeGuard.read() do
      {:ok, %{"pid" => pid}} when is_binary(pid) and pid != "" ->
        match?({_output, 0}, System.cmd("kill", ["-0", pid], stderr_to_stdout: true))

      _ ->
        false
    end
  rescue
    _ -> false
  end
end
