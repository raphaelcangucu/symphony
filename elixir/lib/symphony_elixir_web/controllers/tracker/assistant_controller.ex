defmodule SymphonyElixirWeb.Tracker.AssistantController do
  @moduledoc "Project-scoped assistant chat endpoint for the tracker UI."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Assistant.{AttachmentStore, SessionManager}
  alias SymphonyElixir.Codex.ModelCatalog
  alias SymphonyElixir.Settings
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors

  @spec config(Conn.t(), map()) :: Conn.t()
  def config(conn, _params) do
    {:ok, codex} = ModelCatalog.list_models()
    {:ok, claude} = SymphonyElixir.Claude.ModelCatalog.list_models()
    {:ok, cursor} = SymphonyElixir.Cursor.ModelCatalog.list_models()

    json(conn, %{
      data: %{
        agents: [codex, claude, cursor],
        default_agent: Settings.Agents.default_agent_kind()
      }
    })
  end

  @spec upload_attachment(Conn.t(), map()) :: Conn.t()
  def upload_attachment(conn, %{"project_slug" => project_slug, "file" => %Plug.Upload{} = upload}) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, attachment} <- AttachmentStore.store_file(project_slug, upload) do
      conn
      |> put_status(:created)
      |> json(%{data: attachment})
    else
      {:error, :project_not_found} -> TrackerErrors.render(conn, :project_not_found)
      {:error, :unsupported_file_type} -> TrackerErrors.validation(conn, "This file type is not supported.")
      {:error, :unsupported_image_type} -> TrackerErrors.validation(conn, "Only PNG, JPEG, GIF, and WebP images are supported.")
      {:error, :file_too_large} -> TrackerErrors.validation(conn, "Files must be 5 MB or smaller.")
      {:error, :image_too_large} -> TrackerErrors.validation(conn, "Images must be 4 MB or smaller.")
      {:error, :invalid_upload} -> TrackerErrors.validation(conn, "Invalid upload.")
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def upload_attachment(conn, _params), do: TrackerErrors.validation(conn, "file is required")

  @spec show_attachment(Conn.t(), map()) :: Conn.t()
  def show_attachment(conn, %{"project_slug" => project_slug, "path" => path_segments}) do
    relative_path = path_segments |> List.wrap() |> Enum.join("/")

    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, absolute_path} <- AttachmentStore.resolve_path(project_slug, relative_path) do
      conn
      |> Conn.put_resp_content_type(AttachmentStore.content_type(absolute_path))
      |> Conn.put_resp_header("cache-control", "private, max-age=31536000, immutable")
      |> Conn.send_file(200, absolute_path)
    else
      {:error, :project_not_found} -> TrackerErrors.render(conn, :project_not_found)
      {:error, :invalid_path} -> TrackerErrors.validation(conn, "Invalid attachment path.")
      {:error, :attachment_not_found} -> attachment_not_found(conn)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def show_attachment(conn, _params), do: TrackerErrors.validation(conn, "attachment path is required")

  defp attachment_not_found(conn) do
    conn
    |> put_status(:not_found)
    |> json(%{error: %{code: "attachment_not_found", message: "Attachment not found"}})
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"project_slug" => project_slug, "message" => message} = params) when is_binary(message) do
    context = Map.get(params, "context", %{})

    with {:ok, result} <- SessionManager.handle_message(project_slug, message, normalize_context(context)) do
      conn
      |> put_status(:created)
      |> json(%{data: result})
    else
      {:error, :message_required} -> TrackerErrors.validation(conn, "message is required")
      {:error, {:missing_required_field, field}} -> TrackerErrors.validation(conn, "#{field} is required")
      {:error, {:unsupported_tool, tool}} -> TrackerErrors.validation(conn, "unsupported assistant tool: #{tool}")
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def create(conn, _params), do: TrackerErrors.validation(conn, "message is required")

  defp normalize_context(context) when is_map(context), do: context
  defp normalize_context(_context), do: %{}
end
