defmodule SymphonyElixirWeb.Tracker.JiraAttachmentController do
  @moduledoc """
  Proxies JIRA issue attachment downloads for the tracker UI.

  JIRA Cloud's attachment content endpoint requires the operator's Basic
  credentials, which the browser does not hold, so the daemon authenticates and
  streams the bytes back through this project-scoped, bearer-authenticated route.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Jira.Attachments
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"project_slug" => project_slug, "id" => id}) do
    with {:ok, project} <- Context.get_project(project_slug),
         :ok <- ensure_jira(project),
         {:ok, %{content_type: content_type, body: body}} <- Attachments.download(id) do
      conn
      |> Conn.put_resp_header("content-type", content_type)
      |> Conn.put_resp_header("cache-control", "private, max-age=31536000, immutable")
      |> Conn.send_resp(200, body)
    else
      {:error, :project_not_found} -> TrackerErrors.render(conn, :project_not_found)
      {:error, :not_jira} -> TrackerErrors.render(conn, :issue_not_found)
      {:error, :missing_jira_credentials} -> TrackerErrors.render(conn, :remote_unauthorized)
      {:error, {:jira_api_status, status}} when status in [401, 403] -> TrackerErrors.render(conn, :remote_unauthorized)
      {:error, {:jira_api_status, 404}} -> TrackerErrors.render(conn, :issue_not_found)
      {:error, _reason} -> TrackerErrors.render(conn, :remote_unavailable)
    end
  end

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{"project_slug" => project_slug, "id" => id}) do
    with {:ok, project} <- Context.get_project(project_slug),
         :ok <- ensure_jira(project),
         :ok <- Attachments.delete(id) do
      send_resp(conn, 204, "")
    else
      {:error, :project_not_found} -> TrackerErrors.render(conn, :project_not_found)
      {:error, :not_jira} -> TrackerErrors.render(conn, :issue_not_found)
      {:error, :missing_jira_credentials} -> TrackerErrors.render(conn, :remote_unauthorized)
      {:error, {:jira_api_status, status}} when status in [401, 403] -> TrackerErrors.render(conn, :remote_unauthorized)
      {:error, {:jira_api_status, 404}} -> TrackerErrors.render(conn, :attachment_not_found)
      {:error, _reason} -> TrackerErrors.render(conn, :remote_unavailable)
    end
  end

  defp ensure_jira(%{tracker_kind: "jira"}), do: :ok
  defp ensure_jira(_project), do: {:error, :not_jira}
end
