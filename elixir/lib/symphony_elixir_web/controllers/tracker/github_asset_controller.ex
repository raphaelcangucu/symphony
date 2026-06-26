defmodule SymphonyElixirWeb.Tracker.GitHubAssetController do
  @moduledoc """
  Proxies Symphony-managed GitHub asset downloads for the tracker UI.

  Issue bodies synced to GitHub reference attachments as `raw` URLs on the
  `symphony-assets` branch. For private repos those URLs require GitHub auth the
  browser does not hold, so the daemon authenticates with the configured token and
  streams the bytes back through this bearer-authenticated route. Only the
  content-addressed `assets/<sha>.<ext>` form is served (enforced in
  `AttachmentRewriter.download_asset/4`), so the proxy cannot fetch arbitrary repo
  paths.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.AttachmentRewriter
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{
        "project_slug" => project_slug,
        "owner" => owner,
        "repo" => repo,
        "basename" => basename
      }) do
    with {:ok, project} <- Context.get_project(project_slug),
         :ok <- ensure_github(project),
         {:ok, %{content_type: content_type, body: body}} <-
           AttachmentRewriter.download_asset(owner, repo, basename) do
      conn
      |> Conn.put_resp_header("content-type", content_type)
      |> Conn.put_resp_header("cache-control", "private, max-age=31536000, immutable")
      |> Conn.send_resp(200, body)
    else
      {:error, :project_not_found} ->
        TrackerErrors.render(conn, :project_not_found)

      {:error, :not_github} ->
        TrackerErrors.render(conn, :issue_not_found)

      {:error, :invalid_asset} ->
        TrackerErrors.render(conn, :attachment_not_found)

      {:error, :missing_github_token} ->
        TrackerErrors.render(conn, :missing_github_token)

      {:error, {:github_api_status, status}} when status in [401, 403] ->
        TrackerErrors.render(conn, :remote_unauthorized)

      {:error, {:github_api_status, 404}} ->
        TrackerErrors.render(conn, :attachment_not_found)

      {:error, _reason} ->
        TrackerErrors.render(conn, :remote_unavailable)
    end
  end

  defp ensure_github(%{tracker_kind: "github"}), do: :ok
  defp ensure_github(_project), do: {:error, :not_github}
end
