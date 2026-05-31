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

  def render(conn, {:rate_limited, info}) when is_map(info) do
    reset_at = Map.get(info, :reset_at)
    body = %{error: %{code: "github_rate_limited", message: rate_limited_message(reset_at)}}
    body = if reset_at, do: put_in(body, [:error, :reset_at], DateTime.to_iso8601(reset_at)), else: body

    conn
    |> put_status(429)
    |> json(body)
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

  def render(conn, :no_failing_checks),
    do: error(conn, 422, "no_failing_checks", "No failing checks found on the linked pull request(s).")

  def render(conn, :update_branch_conflict),
    do:
      error(
        conn,
        422,
        "update_branch_conflict",
        "Could not update the branch automatically — resolve conflicts on GitHub, then retry."
      )

  def render(conn, :invalid_pr_number),
    do: error(conn, 422, "invalid_pr_number", "Invalid pull request number.")

  def render(conn, :invalid_merge_method),
    do: error(conn, 422, "invalid_merge_method", "Merge method must be merge, squash, or rebase.")

  def render(conn, :pull_request_not_mergeable),
    do:
      error(
        conn,
        422,
        "pull_request_not_mergeable",
        "GitHub does not consider this pull request mergeable yet."
      )

  def render(conn, :pull_request_merge_conflict),
    do: error(conn, 409, "pull_request_merge_conflict", "The pull request cannot be merged because it has conflicts.")

  def render(conn, :pull_request_merge_blocked),
    do:
      error(
        conn,
        422,
        "pull_request_merge_blocked",
        "GitHub blocked the merge. Required checks, reviews, or branch rules may still be pending."
      )

  def render(conn, :pull_request_merge_forbidden),
    do:
      error(
        conn,
        403,
        "pull_request_merge_forbidden",
        "The configured GitHub token is not allowed to merge this pull request."
      )

  def render(conn, {:adapter_error, _reason}),
    do: error(conn, 500, "tracker_internal", "Tracker adapter error")

  def render(conn, {:assistant_config_unavailable, _reason}) do
    error(
      conn,
      503,
      "assistant_config_unavailable",
      "Could not load Codex CLI models. Check that Codex is installed and configured."
    )
  end

  def render(conn, :invalid_path),
    do:
      error(
        conn,
        422,
        "invalid_issue_document_path",
        "Issue document path must be a markdown file under docs/superpowers."
      )

  def render(conn, :not_markdown),
    do:
      error(
        conn,
        422,
        "invalid_issue_document_path",
        "Issue document path must be a markdown file under docs/superpowers."
      )

  def render(conn, :not_found),
    do: not_found(conn, "issue_document_not_found", "Issue document not found")

  def render(conn, :too_large),
    do: error(conn, 413, "issue_document_too_large", "Issue document is too large.")

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

  defp rate_limited_message(%DateTime{} = reset_at) do
    "GitHub API rate limit exceeded. Access resets at #{Calendar.strftime(reset_at, "%H:%M UTC")}."
  end

  defp rate_limited_message(_reset_at) do
    "GitHub API rate limit exceeded. Try again shortly."
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
