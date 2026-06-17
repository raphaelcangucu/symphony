defmodule SymphonyElixirWeb.Tracker.EvidenceController do
  @moduledoc """
  Endpoints exposing the persisted evidence runs of an issue: a JSON listing
  (manifest snapshots) and the durable artifact files (screenshots, videos,
  reports) referenced by them.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Evidence.Store
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    case Store.list(project_slug, identifier) do
      {:ok, records} -> json(conn, %{data: Enum.map(records, &present/1)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec clear(Conn.t(), map()) :: Conn.t()
  def clear(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    case Store.delete_all(project_slug, identifier) do
      {:ok, count} -> json(conn, %{data: %{deleted: count}})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec clear_failed(Conn.t(), map()) :: Conn.t()
  def clear_failed(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    case Store.delete_failed(project_slug, identifier) do
      {:ok, count} -> json(conn, %{data: %{deleted: count}})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{"project_slug" => project_slug, "identifier" => identifier, "run_id" => run_id}) do
    case Store.delete_run(project_slug, identifier, run_id) do
      {:ok, _record} -> send_resp(conn, 204, "")
      {:error, :run_not_found} -> TrackerErrors.render(conn, :evidence_run_not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec artifact(Conn.t(), map()) :: Conn.t()
  def artifact(conn, %{
        "project_slug" => project_slug,
        "identifier" => identifier,
        "run_id" => run_id,
        "path" => path_segments
      }) do
    relative = Enum.join(path_segments, "/")

    with {:ok, records} <- Store.list(project_slug, identifier),
         {:ok, record} <- find_run(records, run_id),
         {:ok, absolute} <- Store.resolve_artifact(record, relative) do
      conn
      |> Conn.put_resp_content_type(MIME.from_path(absolute))
      |> Conn.put_resp_header("cache-control", "private, max-age=31536000, immutable")
      |> Conn.send_file(200, absolute)
    else
      {:error, :invalid_path} -> TrackerErrors.render(conn, :invalid_artifact_path)
      {:error, :not_found} -> TrackerErrors.render(conn, :artifact_not_found)
      {:error, :run_not_found} -> TrackerErrors.render(conn, :evidence_run_not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp find_run(records, run_id) do
    case Enum.find(records, &(&1.run_id == run_id)) do
      nil -> {:error, :run_not_found}
      record -> {:ok, record}
    end
  end

  defp present(record) do
    %{
      id: record.id,
      run_id: record.run_id,
      session_id: record.session_id,
      status: record.status,
      ui_change: record.ui_change,
      manifest: record.manifest,
      inserted_at: record.inserted_at
    }
  end
end
