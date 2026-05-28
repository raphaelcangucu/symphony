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
  def render(conn, :template_not_found), do: not_found(conn, "template_not_found", "Template not found")

  def render(conn, :missing_github_token) do
    error(conn, 503, "github_token_missing", "GITHUB_TOKEN is not configured on the Symphony server.")
  end

  def render(conn, :unauthorized) do
    error(conn, 401, "github_unauthorized", "GitHub rejected the configured GITHUB_TOKEN.")
  end

  def render(conn, {:network_error, _reason}) do
    error(conn, 503, "github_network_error", "Failed to reach GitHub. Try again in a moment.")
  end

  def render(conn, {:malformed_response, _body}) do
    error(conn, 502, "github_malformed_response", "GitHub returned an unexpected response.")
  end

  def render(conn, :missing_credentials),
    do: error(conn, 503, "tracker_credentials_missing", "GITHUB_TOKEN / LINEAR_API_KEY missing on server")

  def render(conn, :remote_unauthorized),
    do: error(conn, 502, "tracker_unauthorized", "Remote tracker rejected the token (401)")

  def render(conn, :remote_forbidden),
    do: error(conn, 502, "tracker_forbidden", "Remote tracker forbade the request (403)")

  def render(conn, :remote_rate_limited),
    do: error(conn, 429, "tracker_rate_limited", "Remote tracker rate limit hit; retry later")

  def render(conn, :remote_unavailable),
    do: error(conn, 502, "tracker_unavailable", "Remote tracker unreachable; try again")

  def render(conn, :not_supported_on_remote),
    do: error(conn, 501, "tracker_not_supported", "This action is not supported on the remote tracker")

  def render(conn, {:remote_validation, details}),
    do: error(conn, 422, "tracker_validation_failed", "Remote tracker rejected the request", details)

  def render(conn, {:adapter_error, _reason}),
    do: error(conn, 500, "tracker_internal", "Tracker adapter error")

  def render(conn, message) when is_binary(message), do: server_error(conn, message)
  def render(conn, _reason), do: server_error(conn)

  @spec validation(Conn.t(), String.t()) :: Conn.t()
  def validation(conn, message) when is_binary(message) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: %{code: "validation_failed", message: message, details: %{}}})
  end

  defp error(conn, status, code, message, details \\ nil) do
    body = %{error: %{code: code, message: message}}
    body = if details, do: put_in(body, [:error, :details], details), else: body

    conn
    |> put_status(status)
    |> json(body)
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
