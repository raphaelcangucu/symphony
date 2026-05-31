defmodule SymphonyElixirWeb.Tracker.AssistantController do
  @moduledoc "Project-scoped assistant chat endpoint for the tracker UI."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Assistant.SessionManager
  alias SymphonyElixirWeb.TrackerErrors

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
