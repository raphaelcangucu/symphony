defmodule SymphonyElixirWeb.Tracker.AssistantCommandController do
  @moduledoc "Lists assistant slash commands (built-ins + discovered skills)."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.AssistantCommands
  alias SymphonyElixirWeb.{TrackerErrors, TrackerPresenter}

  @execution_context "execution"
  @authoring_context "authoring"
  @invalid_context_message "context must be execution or authoring"

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, params), do: render_commands(conn, params["context"])

  @spec project_index(Conn.t(), map()) :: Conn.t()
  def project_index(conn, %{"project_slug" => _project_slug} = params),
    do: render_commands(conn, params["context"])

  def project_index(conn, _params), do: TrackerErrors.validation_msg(conn, "project_slug is required")

  defp render_commands(conn, raw_context) do
    with {:ok, context} <- normalize_context(raw_context) do
      data =
        context
        |> AssistantCommands.list()
        |> Enum.map(&TrackerPresenter.assistant_command/1)

      json(conn, %{data: data})
    else
      {:error, message} ->
        TrackerErrors.validation_msg(conn, message)
    end
  end

  defp normalize_context(nil), do: {:ok, @execution_context}

  defp normalize_context(context) when is_binary(context) do
    case String.trim(context) do
      @execution_context -> {:ok, @execution_context}
      @authoring_context -> {:ok, @authoring_context}
      _other -> {:error, @invalid_context_message}
    end
  end

  defp normalize_context(_context), do: {:error, @invalid_context_message}
end
