defmodule SymphonyElixirWeb.Tracker.BackupController do
  @moduledoc "JSON API for local SQLite tracker backups."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Backup

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, params) do
    rows =
      Backup.list(
        category: blank_to_nil(params["category"]),
        status: blank_to_nil(params["status"])
      )
      |> Enum.map(&Backup.present/1)

    json(conn, %{data: rows, total: length(rows)})
  end

  @spec stats(Conn.t(), map()) :: Conn.t()
  def stats(conn, _params) do
    raw = Backup.stats()
    source = Map.get(raw, :source_database, %{})

    categories =
      raw
      |> Map.drop([:source_database])
      |> Enum.map(fn {cat, entry} ->
        latest = entry[:latest] || entry["latest"]

        {cat,
         %{
           count: entry[:count] || entry["count"] || 0,
           total_bytes: entry[:total_bytes] || entry["total_bytes"] || 0,
           synced_count: entry[:synced_count] || entry["synced_count"] || 0,
           latest: latest
         }}
      end)
      |> Map.new()

    json(conn, %{
      categories: categories,
      source_database: %{
        path: Map.get(source, :path),
        size_bytes: Map.get(source, :size_bytes, 0),
        size_human: Map.get(source, :size_human, "0 B"),
        exists: Map.get(source, :exists, false)
      }
    })
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"category" => "all"}) do
    trigger = params_trigger(conn.params)

    case Backup.create(trigger: trigger) do
      {:ok, backup} ->
        json(conn, %{
          success: true,
          message: "Backup id=#{backup.id} completed",
          backup: Backup.present(backup)
        })

      {:error, reason} ->
        conn
        |> put_status(:bad_request)
        |> json(%{success: false, message: format_error(reason), backup: nil})
    end
  end

  def create(conn, %{"category" => category}) when category in ["database"] do
    trigger = params_trigger(conn.params)

    case Backup.create(trigger: trigger) do
      {:ok, backup} ->
        json(conn, %{
          success: true,
          message: "Backup id=#{backup.id} completed",
          backup: Backup.present(backup)
        })

      {:error, reason} ->
        conn
        |> put_status(:bad_request)
        |> json(%{success: false, message: format_error(reason), backup: nil})
    end
  end

  def create(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{success: false, message: "category must be database or all", backup: nil})
  end

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"id" => id}) do
    case parse_id(id) do
      {:ok, backup_id} ->
        case Backup.get(backup_id) do
          {:ok, backup} -> json(conn, Backup.present(backup))
          {:error, :not_found} -> not_found(conn, backup_id)
        end

      :error ->
        conn |> put_status(:bad_request) |> json(%{error: %{message: "invalid backup id"}})
    end
  end

  @spec restore(Conn.t(), map()) :: Conn.t()
  def restore(conn, %{"id" => id} = params) do
    target = blank_to_nil(params["target"] || Map.get(params, "target"))
    restore_opts = if target, do: [target: target], else: []

    with {:ok, backup_id} <- parse_id_result(id),
         {:ok, _backup} <- Backup.restore(backup_id, restore_opts) do
      json(conn, %{success: true, message: "Restored backup id=#{backup_id}"})
    else
      {:error, :not_found} ->
        not_found(conn, id)

      {:error, reason} ->
        conn
        |> put_status(:bad_request)
        |> json(%{success: false, message: format_error(reason)})
    end
  end

  @spec cleanup(Conn.t(), map()) :: Conn.t()
  def cleanup(conn, _params) do
    count = Backup.cleanup_expired()

    json(conn, %{
      success: true,
      message: "Removed #{count} expired backup(s)",
      count: count
    })
  end

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{"id" => id}) do
    with {:ok, backup_id} <- parse_id_result(id) do
      case Backup.delete(backup_id) do
        :ok ->
          json(conn, %{success: true, message: "Deleted backup id=#{backup_id}"})

        {:error, :not_found} ->
          not_found(conn, backup_id)
      end
    else
      :error ->
        conn |> put_status(:bad_request) |> json(%{error: %{message: "invalid backup id"}})
    end
  end

  @spec download(Conn.t(), map()) :: Conn.t()
  def download(conn, %{"id" => id}) do
    with {:ok, backup_id} <- parse_id_result(id),
         {:ok, backup} <- Backup.get(backup_id),
         true <- File.exists?(backup.local_path) do
      conn
      |> put_resp_content_type("application/octet-stream")
      |> put_resp_header(
        "content-disposition",
        ~s(attachment; filename="#{backup.filename}")
      )
      |> send_file(200, backup.local_path)
    else
      {:error, :not_found} ->
        not_found(conn, id)

      false ->
        conn
        |> put_status(:not_found)
        |> json(%{error: %{message: "backup file missing on disk"}})

      :error ->
        conn |> put_status(:bad_request) |> json(%{error: %{message: "invalid backup id"}})
    end
  end

  defp params_trigger(params) do
    case blank_to_nil(Map.get(params, "trigger")) do
      nil -> "manual"
      value -> value
    end
  end

  defp blank_to_nil(nil), do: nil
  defp blank_to_nil(""), do: nil
  defp blank_to_nil(value), do: value

  defp parse_id(id) when is_integer(id), do: {:ok, id}

  defp parse_id(id) when is_binary(id) do
    case Integer.parse(id) do
      {int, ""} -> {:ok, int}
      _ -> :error
    end
  end

  defp parse_id_result(id), do: parse_id(id) |> then(fn
    {:ok, n} -> {:ok, n}
    :error -> :error
  end)

  defp not_found(conn, id) do
    conn
    |> put_status(:not_found)
    |> json(%{error: %{message: "Backup #{id} not found"}})
  end

  defp format_error({:missing_database, path}), do: "Database file not found: #{path}"

  defp format_error({:database_too_small, path, bytes}),
    do: "Database file is too small to backup (#{bytes} bytes): #{path}"

  defp format_error({:backup_too_small, path, bytes}),
    do: "Backup file is too small to restore (#{bytes} bytes): #{path}"

  defp format_error({:backup_has_no_projects, current: current, backup: backup}),
    do:
      "Refusing restore: current database has #{current} project(s) but backup has #{backup}. Pass force=true to override."

  defp format_error({:missing_file, path}), do: "Backup file not found: #{path}"
  defp format_error(reason), do: inspect(reason)
end
