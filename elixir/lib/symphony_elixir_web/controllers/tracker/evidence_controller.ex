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
      {:error, :invalid_path} -> artifact_error(conn, 422, "invalid_artifact_path", "Invalid artifact path.")
      {:error, :not_found} -> artifact_error(conn, 404, "artifact_not_found", "Evidence artifact not found.")
      {:error, :run_not_found} -> artifact_error(conn, 404, "evidence_run_not_found", "Evidence run not found.")
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

  defp artifact_error(conn, status, code, message) do
    conn
    |> Conn.put_status(status)
    |> json(%{error: %{code: code, message: message}})
  end
end
