defmodule SymphonyElixirWeb.Tracker.AssistantController do
  @moduledoc "Project-scoped assistant chat endpoint for the tracker UI."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Assistant.{AttachmentStore, SessionManager}
  alias SymphonyElixir.Codex.ModelCatalog
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors

  @spec config(Conn.t(), map()) :: Conn.t()
  def config(conn, _params) do
    {:ok, catalog} = ModelCatalog.list_models()
    json(conn, %{data: catalog})
  end

  @spec upload_attachment(Conn.t(), map()) :: Conn.t()
  def upload_attachment(conn, %{"project_slug" => project_slug, "file" => %Plug.Upload{} = upload}) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, attachment} <- AttachmentStore.store_image(project_slug, upload) do
      conn
      |> put_status(:created)
      |> json(%{data: attachment})
    else
      {:error, :project_not_found} -> TrackerErrors.render(conn, :project_not_found)
      {:error, :unsupported_image_type} -> TrackerErrors.validation(conn, "Only PNG, JPEG, GIF, and WebP images are supported.")
      {:error, :image_too_large} -> TrackerErrors.validation(conn, "Images must be 4 MB or smaller.")
      {:error, :invalid_upload} -> TrackerErrors.validation(conn, "Invalid image upload.")
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def upload_attachment(conn, _params), do: TrackerErrors.validation(conn, "file is required")

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
