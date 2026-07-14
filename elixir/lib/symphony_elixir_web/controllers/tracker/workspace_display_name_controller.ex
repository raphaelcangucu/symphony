defmodule SymphonyElixirWeb.Tracker.WorkspaceDisplayNameController do
  @moduledoc """
  Manages display-only aliases for workspace paths owned by a project.

  These actions only update alias records. They never rename or remove paths on
  disk.
  """

  use Phoenix.Controller, formats: [:json]

  import Plug.Conn, only: [put_status: 2, send_resp: 3]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Workspace.{DisplayName, PathOwnership}
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug}) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, entries} <- DisplayName.list_for_project(project_slug) do
      json(conn, %{data: Enum.map(entries, &entry_json/1)})
    else
      {:error, reason} -> render_error(conn, reason)
    end
  end

  @spec update(Conn.t(), map()) :: Conn.t()
  def update(
        conn,
        %{"project_slug" => project_slug, "path" => workspace_path, "display_name" => display_name}
      ) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, normalized_name} <- DisplayName.validate_display_name(display_name),
         {:ok, %{path: normalized_path}} <- PathOwnership.validate(project_slug, workspace_path),
         {:ok, entry} <- DisplayName.put(project_slug, normalized_path, normalized_name) do
      json(conn, %{data: entry_json(entry)})
    else
      {:error, reason} -> render_error(conn, reason)
    end
  end

  def update(conn, _params) do
    TrackerErrors.validation_msg(conn, "path and display_name are required")
  end

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{"project_slug" => project_slug, "path" => workspace_path}) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, %{path: normalized_path}} <- PathOwnership.validate(project_slug, workspace_path),
         :ok <- DisplayName.delete(project_slug, normalized_path) do
      send_resp(conn, :no_content, "")
    else
      {:error, reason} -> render_error(conn, reason)
    end
  end

  def delete(conn, _params) do
    TrackerErrors.validation_msg(conn, "path is required")
  end

  defp entry_json(entry) do
    %{
      project_slug: entry.project_slug,
      workspace_path: entry.workspace_path,
      display_name: entry.display_name
    }
  end

  defp render_error(conn, :not_found) do
    conn
    |> put_status(:not_found)
    |> json(%{
      error: %{
        code: "workspace_display_name_not_found",
        message: "Workspace display name not found"
      }
    })
  end

  defp render_error(conn, {:validation, reason}) do
    TrackerErrors.validation_msg(conn, validation_message(reason))
  end

  defp render_error(conn, {:inventory, _reason}), do: TrackerErrors.render(conn, :request_failed)

  defp render_error(conn, reason)
       when reason in [:invalid_project_slug, :invalid_display_name] do
    TrackerErrors.validation_msg(conn, validation_message(reason))
  end

  defp render_error(conn, reason), do: TrackerErrors.render(conn, reason)

  defp validation_message(:invalid_project_slug), do: "project_slug is invalid"
  defp validation_message(:invalid_workspace_path), do: "path must be an absolute workspace path"
  defp validation_message(:invalid_display_name), do: "display_name must be between 1 and 120 characters"
  defp validation_message(:workspace_path_not_owned), do: "path does not belong to this project"
end
