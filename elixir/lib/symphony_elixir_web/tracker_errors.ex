defmodule SymphonyElixirWeb.TrackerErrors do
  @moduledoc "Shared JSON error rendering for local tracker endpoints."

  import Phoenix.Controller
  import Plug.Conn

  alias Plug.Conn

  @spec render(Conn.t(), Ecto.Changeset.t() | atom() | String.t()) :: Conn.t()
  def render(conn, %Ecto.Changeset{} = changeset) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{
      error: %{
        code: "validation_failed",
        message: "Validation failed",
        details: Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
      }
    })
  end

  def render(conn, :project_not_found), do: not_found(conn, "project_not_found", "Project not found")
  def render(conn, :issue_not_found), do: not_found(conn, "issue_not_found", "Issue not found")
  def render(conn, :status_not_found), do: not_found(conn, "status_not_found", "Status not found")
  def render(conn, :blocker_not_found), do: not_found(conn, "blocker_not_found", "Blocker not found")
  def render(conn, message) when is_binary(message), do: server_error(conn, message)
  def render(conn, _reason), do: server_error(conn)

  @spec validation(Conn.t(), String.t()) :: Conn.t()
  def validation(conn, message) when is_binary(message) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: %{code: "validation_failed", message: message, details: %{}}})
  end

  defp not_found(conn, code, message) do
    conn
    |> put_status(:not_found)
    |> json(%{error: %{code: code, message: message}})
  end

  defp server_error(conn) do
    conn
    |> put_status(:internal_server_error)
    |> json(%{error: %{code: "request_failed", message: "Request failed"}})
  end

  defp server_error(conn, message) do
    conn
    |> put_status(:internal_server_error)
    |> json(%{error: %{code: "request_failed", message: message}})
  end
end
