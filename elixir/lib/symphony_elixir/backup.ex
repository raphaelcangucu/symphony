defmodule SymphonyElixir.Backup do
  @moduledoc """
  Local SQLite tracker backups (filesystem archives + JSON manifest).

  Mirrors the SEO Machine database backup flow: timestamped copies under
  `.symphony/backups/database/`, metadata in `manifest.json`, optional retention
  cleanup, and pre-restore safety snapshots.
  """

  alias SymphonyElixir.Backup.Manifest
  alias SymphonyElixir.Config

  @category "database"
  @min_restore_bytes 1024

  @type record :: Manifest.record()

  @spec local_dir() :: Path.t()
  def local_dir do
    Config.backup_local_dir()
  end

  @spec database_dir() :: Path.t()
  def database_dir, do: Path.join(local_dir(), @category)

  @spec manifest_path() :: Path.t()
  def manifest_path, do: Path.join(local_dir(), "manifest.json")

  @spec retention_days() :: pos_integer()
  def retention_days do
    Config.backup_retention_days()
  end

  @spec list(keyword()) :: [record()]
  def list(opts \\ []) do
    category = Keyword.get(opts, :category)
    status = Keyword.get(opts, :status)

    Manifest.load(manifest_path()).records
    |> Enum.filter(fn r ->
      match_category?(r, category) and match_status?(r, status)
    end)
    |> Enum.sort_by(& &1.created_at, {:desc, DateTime})
  end

  @spec get(pos_integer()) :: {:ok, record()} | {:error, :not_found}
  def get(id) do
    case Enum.find(list(), &(&1.id == id)) do
      nil -> {:error, :not_found}
      record -> {:ok, record}
    end
  end

  @spec stats() :: map()
  def stats do
    records = list(category: @category)
    source = Config.local_tracker_database_info()

    total_bytes =
      Enum.reduce(records, 0, fn r, acc ->
        acc + file_size(r.local_path)
      end)

    latest = List.first(records)

    %{
      source_database: %{
        path: source.path,
        size_bytes: source.size_bytes,
        size_human: human_bytes(source.size_bytes),
        exists: source.exists
      },
      database: %{
        count: length(records),
        total_bytes: total_bytes,
        synced_count: 0,
        latest: latest && present(latest)
      }
    }
  end

  @spec create(keyword()) :: {:ok, record()} | {:error, term()}
  def create(opts \\ []) do
    trigger = Keyword.get(opts, :trigger, "manual")
    ensure_dirs!()

    src = database_source_path()

    cond do
      not File.exists?(src) ->
        {:error, {:missing_database, src}}

      file_size(src) < @min_restore_bytes ->
        {:error, {:database_too_small, src, file_size(src)}}

      true ->
        create_from_source(src, trigger)
    end
  end

  defp create_from_source(src, trigger) do
    filename = "backup_database_#{timestamp()}.db"
    dest = Path.join(database_dir(), filename)

    with :ok <- copy_database(src, dest) do
      record = build_record(filename, dest, trigger, "completed")
      {record, _} = Manifest.append(manifest_path(), record)
      {:ok, record}
    end
  end

  @spec restore(pos_integer(), keyword()) :: {:ok, record()} | {:error, term()}
  def restore(id, opts \\ []) do
    target = Keyword.get(opts, :target, database_source_path())
    force? = Keyword.get(opts, :force, false)

    with {:ok, backup} <- get(id),
         :ok <- ensure_backup_file(backup),
         :ok <- validate_restore(backup.local_path, target, force?),
         {:ok, safety} <- maybe_safety_snapshot(target),
         :ok <- file_cp(backup.local_path, target) do
      {:ok, safety || backup}
    end
  end

  @spec delete(pos_integer()) :: :ok | {:error, :not_found}
  def delete(id) do
    with {:ok, backup} <- get(id),
         :ok <- Manifest.delete(manifest_path(), id) do
      delete_file(backup.local_path)
      :ok
    else
      :error -> {:error, :not_found}
      {:error, :not_found} -> {:error, :not_found}
    end
  end

  @spec cleanup_expired() :: non_neg_integer()
  def cleanup_expired do
    now = DateTime.utc_now()

    list()
    |> Enum.filter(fn r -> DateTime.compare(r.expires_at, now) == :lt end)
    |> Enum.reduce(0, fn r, n ->
      case delete(r.id) do
        :ok -> n + 1
        _ -> n
      end
    end)
  end

  @spec present(record()) :: map()
  def present(%{} = record) do
    %{
      id: record.id,
      category: record.category,
      filename: record.filename,
      size_bytes: record.size_bytes,
      size_human: human_bytes(record.size_bytes),
      local_path: record.local_path,
      s3_key: nil,
      s3_synced: false,
      trigger: record.trigger,
      status: record.status,
      agent: nil,
      metadata: nil,
      created_at: DateTime.to_iso8601(record.created_at),
      expires_at: DateTime.to_iso8601(record.expires_at)
    }
  end

  @spec human_bytes(non_neg_integer()) :: String.t()
  def human_bytes(bytes) when bytes < 1024, do: "#{bytes} B"

  def human_bytes(bytes) do
    kb = bytes / 1024

    cond do
      kb < 1024 -> :erlang.float_to_binary(kb, decimals: 1) <> " KB"
      kb / 1024 < 1024 -> :erlang.float_to_binary(kb / 1024, decimals: 1) <> " MB"
      true -> :erlang.float_to_binary(kb / 1024 / 1024, decimals: 1) <> " GB"
    end
  end

  defp build_record(filename, local_path, trigger, status) do
    size = file_size(local_path)
    now = DateTime.utc_now() |> DateTime.truncate(:second)
    expires = DateTime.add(now, retention_days() * 86_400, :second)

    %{
      id: Manifest.load(manifest_path()).next_id,
      category: @category,
      filename: filename,
      size_bytes: size,
      local_path: Path.expand(local_path),
      trigger: trigger,
      status: status,
      created_at: now,
      expires_at: expires
    }
  end

  defp maybe_safety_snapshot(target) do
    if File.exists?(target) do
      safety_name = "pre_restore_#{timestamp()}.db"
      safety_path = Path.join(database_dir(), safety_name)

      case copy_database(target, safety_path) do
        :ok ->
          record = build_record(safety_name, safety_path, "pre_restore", "completed")
          {record, _} = Manifest.append(manifest_path(), record)
          {:ok, record}

        {:error, reason} ->
          {:error, reason}
      end
    else
      {:ok, nil}
    end
  end

  defp copy_database(source, dest) do
    dest |> Path.dirname() |> File.mkdir_p!()

    case System.find_executable("sqlite3") do
      nil ->
        file_cp(source, dest)

      sqlite3 ->
        case System.cmd(sqlite3, [source, ".backup #{dest}"], stderr_to_stdout: true) do
          {_, 0} -> :ok
          _ -> file_cp(source, dest)
        end
    end
  end

  defp file_cp(source, dest) do
    case File.cp(source, dest) do
      :ok -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp ensure_dirs!, do: File.mkdir_p!(database_dir())

  defp ensure_backup_file(%{local_path: path}) do
    if File.exists?(path), do: :ok, else: {:error, {:missing_file, path}}
  end

  defp validate_restore(backup_path, target_path, force?) do
    backup_bytes = file_size(backup_path)

    cond do
      force? ->
        :ok

      backup_bytes < @min_restore_bytes ->
        {:error, {:backup_too_small, backup_path, backup_bytes}}

      true ->
        case {sqlite_project_count(target_path), sqlite_project_count(backup_path)} do
          {current, backup} when current > 0 and backup == 0 ->
            {:error, {:backup_has_no_projects, current: current, backup: backup}}

          _ ->
            :ok
        end
    end
  end

  defp sqlite_project_count(path) do
    case System.find_executable("sqlite3") do
      nil ->
        0

      sqlite3 ->
        case System.cmd(sqlite3, [path, "SELECT COUNT(*) FROM local_tracker_projects;"], stderr_to_stdout: true) do
          {output, 0} ->
            case Integer.parse(String.trim(output)) do
              {count, _} -> count
              :error -> 0
            end

          _ ->
            0
        end
    end
  end

  defp delete_file(path) do
    if File.exists?(path), do: File.rm!(path), else: :ok
  end

  defp file_size(path) do
    case File.stat(path) do
      {:ok, %{size: size}} -> size
      _ -> 0
    end
  end

  defp database_source_path, do: Config.local_tracker_database_path()

  defp timestamp do
    DateTime.utc_now()
    |> DateTime.to_naive()
    |> NaiveDateTime.to_string()
    |> String.replace(~r/[^0-9]/, "", global: true)
    |> String.slice(0, 14)
  end

  defp match_category?(_r, nil), do: true
  defp match_category?(r, cat), do: r.category == cat

  defp match_status?(_r, nil), do: true
  defp match_status?(r, status), do: r.status == status
end
