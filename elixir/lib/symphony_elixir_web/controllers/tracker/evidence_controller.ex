defmodule SymphonyElixirWeb.Tracker.EvidenceController do
  @moduledoc """
  Endpoints exposing the persisted evidence runs of an issue: a JSON listing
  (manifest snapshots) and the durable artifact files (screenshots, videos,
  reports) referenced by them.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Evidence.{Manifest, Store}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors

  @spec create_for_thread(Conn.t(), map()) :: Conn.t()
  def create_for_thread(conn, %{"thread_id" => raw_id}) do
    with {:ok, thread_id} <- parse_thread_id(raw_id),
         {:ok, thread} <- History.get_thread(thread_id),
         {:ok, project_slug, issue_identifier, workspace_path} <- evidence_context(thread),
         {:ok, _issue} <- Context.get_issue(project_slug, issue_identifier),
         {:ok, snapshot} <- Manifest.read_snapshot(workspace_path),
         :ok <- validate_manifest_issue(snapshot.manifest, issue_identifier),
         {:ok, record} <-
           Store.persist(project_slug, issue_identifier, workspace_path, snapshot.map,
             session_id: to_string(thread.id),
             evidence_dir: snapshot.evidence_dir,
             idempotent: true
           ) do
      conn
      |> put_status(:created)
      |> json(%{data: present(record)})
    else
      {:error, :invalid_thread_id} ->
        TrackerErrors.render(conn, :invalid_thread_id)

      {:error, :not_found} ->
        TrackerErrors.render(conn, :thread_not_found)

      {:error, :invalid_evidence_context} ->
        TrackerErrors.validation_msg(
          conn,
          "thread must have project_slug, issue_identifier, and workspace_path"
        )

      {:error, :evidence_issue_mismatch} ->
        TrackerErrors.validation_msg(conn, "evidence manifest issue does not match the thread issue")

      {:error, reason}
      when reason == :manifest_missing or
             (is_tuple(reason) and elem(reason, 0) in [:manifest_invalid, :artifacts_missing]) ->
        TrackerErrors.validation_msg(conn, "thread workspace evidence manifest is invalid or incomplete")

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

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

  defp parse_thread_id(raw_id) do
    case Integer.parse(to_string(raw_id)) do
      {id, ""} when id > 0 -> {:ok, id}
      _ -> {:error, :invalid_thread_id}
    end
  end

  defp evidence_context(%{scope: scope} = thread)
       when scope in ["issue_session", "issue_execution"] do
    with project_slug when is_binary(project_slug) <- Map.get(thread, :project_slug),
         issue_identifier when is_binary(issue_identifier) <- Map.get(thread, :issue_identifier),
         workspace_path when is_binary(workspace_path) <- Map.get(thread, :workspace_path),
         true <- String.trim(project_slug) != "",
         true <- String.trim(issue_identifier) != "",
         true <- String.trim(workspace_path) != "" do
      {:ok, project_slug, issue_identifier, workspace_path}
    else
      _ -> {:error, :invalid_evidence_context}
    end
  end

  defp evidence_context(_thread), do: {:error, :invalid_evidence_context}

  defp validate_manifest_issue(%Manifest{issue: issue}, issue_identifier)
       when issue == issue_identifier,
       do: :ok

  defp validate_manifest_issue(_manifest, _issue_identifier),
    do: {:error, :evidence_issue_mismatch}

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
