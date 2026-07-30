defmodule SymphonyElixirWeb.Tracker.AssistantThreadFileController do
  @moduledoc "Read access to source, markdown, and image files in an assistant workspace."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Assistant.ThreadFiles
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"thread_id" => raw_id}) do
    with {:ok, thread_id} <- parse_thread_id(raw_id) do
      json(conn, %{data: ThreadFiles.list(thread_id)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"thread_id" => raw_id, "path" => path_segments}) do
    with {:ok, thread_id} <- parse_thread_id(raw_id),
         rel = Enum.join(List.wrap(path_segments), "/"),
         {:ok, content} <- ThreadFiles.read(thread_id, rel) do
      json(conn, %{data: content})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp parse_thread_id(raw) when is_binary(raw) do
    case Integer.parse(String.trim(raw)) do
      {id, ""} when id > 0 -> {:ok, id}
      _other -> {:error, :invalid_thread_id}
    end
  end

  defp parse_thread_id(_raw), do: {:error, :invalid_thread_id}
end
