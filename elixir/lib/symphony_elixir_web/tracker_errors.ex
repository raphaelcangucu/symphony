defmodule SymphonyElixirWeb.TrackerErrors do
  @moduledoc "Shared JSON error rendering for local tracker endpoints."

  use Gettext, backend: SymphonyElixirWeb.Gettext

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
        message: dgettext("errors", "Validation failed"),
        details: Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
      }
    })
  end

  def render(conn, :project_not_found),
    do: not_found(conn, "project_not_found", dgettext("errors", "Project not found"))

  def render(conn, :issue_not_found),
    do: not_found(conn, "issue_not_found", dgettext("errors", "Issue not found"))

  def render(conn, :status_not_found),
    do: not_found(conn, "status_not_found", dgettext("errors", "Status not found"))

  def render(conn, :blocker_not_found),
    do: not_found(conn, "blocker_not_found", dgettext("errors", "Blocker not found"))

  def render(conn, :comment_not_found),
    do: not_found(conn, "comment_not_found", dgettext("errors", "Comment not found"))

  def render(conn, :evidence_run_not_found),
    do: not_found(conn, "evidence_run_not_found", dgettext("errors", "Evidence run not found."))

  def render(conn, :artifact_not_found),
    do: not_found(conn, "artifact_not_found", dgettext("errors", "Evidence artifact not found."))

  def render(conn, :invalid_artifact_path),
    do: error(conn, 422, "invalid_artifact_path", dgettext("errors", "Invalid artifact path."))

  def render(conn, :commit_not_found),
    do: not_found(conn, "commit_not_found", dgettext("errors", "Commit not found in workspace repo."))

  def render(conn, :repo_not_found),
    do: not_found(conn, "repo_not_found", dgettext("errors", "Repository not found in workspace."))

  def render(conn, :dev_server_not_found),
    do: not_found(conn, "dev_server_not_found", dgettext("errors", "Dev server not found"))

  def render(conn, :template_not_found),
    do: not_found(conn, "template_not_found", dgettext("errors", "Template not found"))

  def render(conn, {:template_not_found, _slug}),
    do: not_found(conn, "template_not_found", dgettext("errors", "Template not found"))

  def render(conn, :thread_not_found),
    do: not_found(conn, "thread_not_found", dgettext("errors", "Assistant thread not found"))

  def render(conn, :missing_github_token) do
    error(
      conn,
      503,
      "github_token_missing",
      dgettext("errors", "GITHUB_TOKEN is not configured on the Symphony server.")
    )
  end

  def render(conn, :unauthorized) do
    error(conn, 401, "github_unauthorized", dgettext("errors", "GitHub rejected the configured GITHUB_TOKEN."))
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
    error(conn, 503, "github_network_error", dgettext("errors", "Failed to reach GitHub. Try again in a moment."))
  end

  def render(conn, {:malformed_response, _body}) do
    error(conn, 502, "github_malformed_response", dgettext("errors", "GitHub returned an unexpected response."))
  end

  def render(conn, :missing_credentials),
    do:
      error(
        conn,
        503,
        "tracker_credentials_missing",
        dgettext("errors", "GITHUB_TOKEN / LINEAR_API_KEY missing on server")
      )

  def render(conn, :remote_unauthorized),
    do: error(conn, 502, "tracker_unauthorized", dgettext("errors", "Remote tracker rejected the token (401)"))

  def render(conn, :remote_forbidden),
    do: error(conn, 502, "tracker_forbidden", dgettext("errors", "Remote tracker forbade the request (403)"))

  def render(conn, :remote_rate_limited),
    do: error(conn, 429, "tracker_rate_limited", dgettext("errors", "Remote tracker rate limit hit; retry later"))

  def render(conn, :remote_unavailable),
    do: error(conn, 502, "tracker_unavailable", dgettext("errors", "Remote tracker unreachable; try again"))

  def render(conn, :not_supported_on_remote),
    do:
      error(
        conn,
        501,
        "tracker_not_supported",
        dgettext("errors", "This action is not supported on the remote tracker")
      )

  def render(conn, :sync_disabled),
    do: error(conn, 409, "tracker_sync_disabled", dgettext("errors", "Local-first sync is disabled on this server."))

  def render(conn, :public_tunnel_disabled),
    do:
      error(
        conn,
        409,
        "public_tunnel_disabled",
        dgettext("errors", "The public preview tunnel is disabled for this workspace.")
      )

  def render(conn, :public_tunnel_start_failed),
    do:
      error(
        conn,
        502,
        "public_tunnel_start_failed",
        dgettext("errors", "Failed to start the Cloudflare tunnel. Check the server logs.")
      )

  def render(conn, :no_remote_adapter),
    do:
      error(
        conn,
        422,
        "tracker_no_remote_adapter",
        dgettext("errors", "This project has no remote tracker to sync from.")
      )

  def render(conn, {:remote_validation, details}),
    do:
      error(
        conn,
        422,
        "tracker_validation_failed",
        dgettext("errors", "Remote tracker rejected the request"),
        details
      )

  def render(conn, :no_failing_checks),
    do:
      error(
        conn,
        422,
        "no_failing_checks",
        dgettext("errors", "No failing checks found on the linked pull request(s).")
      )

  def render(conn, :update_branch_conflict),
    do:
      error(
        conn,
        422,
        "update_branch_conflict",
        dgettext(
          "errors",
          "Could not update the branch automatically — resolve conflicts on GitHub, then retry."
        )
      )

  def render(conn, :invalid_pr_number),
    do: error(conn, 422, "invalid_pr_number", dgettext("errors", "Invalid pull request number."))

  def render(conn, :invalid_pr_url),
    do: error(conn, 422, "invalid_pr_url", dgettext("errors", "Invalid GitHub pull request URL."))

  def render(conn, :pr_url_required),
    do: error(conn, 422, "pr_url_required", dgettext("errors", "A pull request URL is required."))

  def render(conn, :no_failed_runs),
    do:
      error(
        conn,
        422,
        "no_failed_runs",
        dgettext("errors", "No failed workflow runs found for this pull request.")
      )

  def render(conn, :orchestrator_unavailable),
    do:
      error(
        conn,
        503,
        "orchestrator_unavailable",
        dgettext("errors", "Orchestrator is unavailable. Try again in a moment.")
      )

  def render(conn, :already_running),
    do:
      error(
        conn,
        409,
        "already_running",
        dgettext("errors", "An agent is already running on this issue.")
      )

  def render(conn, :no_slots),
    do: error(conn, 503, "no_slots", dgettext("errors", "No orchestrator slots are available right now."))

  def render(conn, :not_dispatchable),
    do:
      error(
        conn,
        422,
        "not_dispatchable",
        dgettext("errors", "This issue is not in an active, routable state for agent dispatch.")
      )

  def render(conn, :invalid_merge_method),
    do: error(conn, 422, "invalid_merge_method", dgettext("errors", "Merge method must be merge, squash, or rebase."))

  def render(conn, :pull_request_not_mergeable),
    do:
      error(
        conn,
        422,
        "pull_request_not_mergeable",
        dgettext("errors", "GitHub does not consider this pull request mergeable yet.")
      )

  def render(conn, :pull_request_merge_conflict),
    do:
      error(
        conn,
        409,
        "pull_request_merge_conflict",
        dgettext("errors", "The pull request cannot be merged because it has conflicts.")
      )

  def render(conn, :pull_request_merge_blocked),
    do:
      error(
        conn,
        422,
        "pull_request_merge_blocked",
        dgettext(
          "errors",
          "GitHub blocked the merge. Required checks, reviews, or branch rules may still be pending."
        )
      )

  def render(conn, :pull_request_merge_forbidden),
    do:
      error(
        conn,
        403,
        "pull_request_merge_forbidden",
        dgettext("errors", "The configured GitHub token is not allowed to merge this pull request.")
      )

  def render(conn, {:adapter_error, _reason}),
    do: error(conn, 500, "tracker_internal", dgettext("errors", "Tracker adapter error"))

  def render(conn, {:assistant_config_unavailable, _reason}) do
    error(
      conn,
      503,
      "assistant_config_unavailable",
      dgettext("errors", "Could not load Codex CLI models. Check that Codex is installed and configured.")
    )
  end

  def render(conn, :invalid_thread_id),
    do: validation(conn, dgettext("errors", "thread_id must be a positive integer"))

  def render(conn, :invalid_path),
    do:
      error(
        conn,
        422,
        "invalid_issue_document_path",
        dgettext("errors", "Issue document path must be a markdown file under docs/superpowers.")
      )

  def render(conn, :not_markdown),
    do:
      error(
        conn,
        422,
        "invalid_issue_document_path",
        dgettext("errors", "Issue document path must be a markdown file under docs/superpowers.")
      )

  def render(conn, :not_found),
    do: not_found(conn, "issue_document_not_found", dgettext("errors", "Issue document not found"))

  def render(conn, :too_large),
    do: error(conn, 413, "issue_document_too_large", dgettext("errors", "Issue document is too large."))

  def render(conn, :attachment_not_found),
    do: not_found(conn, "attachment_not_found", dgettext("errors", "Attachment not found"))

  def render(conn, :push_not_configured),
    do: error(conn, 503, "push_not_configured", dgettext("errors", "Web Push is not configured"))

  def render(conn, :push_not_configured_vapid),
    do:
      error(
        conn,
        503,
        "push_not_configured",
        dgettext("errors", "Web Push is not configured (missing VAPID keys)")
      )

  def render(conn, :unknown_credential),
    do: not_found(conn, "unknown_credential", dgettext("errors", "unknown provider/credential"))

  def render(conn, :unknown_settings_group),
    do: not_found(conn, "not_found", dgettext("errors", "unknown settings group"))

  def render(conn, :missing_runtime_id),
    do: error(conn, 422, "invalid_report", dgettext("errors", "runtime_id is required"))

  def render(conn, message) when is_binary(message), do: server_error(conn, message)
  def render(conn, _reason), do: server_error(conn)

  @spec validation(Conn.t(), String.t()) :: Conn.t()
  def validation(conn, message) when is_binary(message) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: %{code: "validation_failed", message: message, details: %{}}})
  end

  @spec validation_msg(Conn.t(), String.t(), map()) :: Conn.t()
  def validation_msg(conn, msgid, bindings \\ %{}) when is_binary(msgid) and is_map(bindings) do
    validation(conn, dgettext("errors", msgid, bindings))
  end

  defp error(conn, status, code, message, details \\ nil) do
    body = %{error: %{code: code, message: message}}
    body = if details, do: put_in(body, [:error, :details], details), else: body

    conn
    |> put_status(status)
    |> json(body)
  end

  defp rate_limited_message(%DateTime{} = reset_at) do
    dgettext("errors", "GitHub API rate limit exceeded. Access resets at %{time}.", time: Calendar.strftime(reset_at, "%H:%M UTC"))
  end

  defp rate_limited_message(_reset_at) do
    dgettext("errors", "GitHub API rate limit exceeded. Try again shortly.")
  end

  defp not_found(conn, code, message) do
    conn
    |> put_status(:not_found)
    |> json(%{error: %{code: code, message: message}})
  end

  defp server_error(conn) do
    conn
    |> put_status(:internal_server_error)
    |> json(%{error: %{code: "request_failed", message: dgettext("errors", "Request failed")}})
  end

  defp server_error(conn, message) do
    conn
    |> put_status(:internal_server_error)
    |> json(%{error: %{code: "request_failed", message: message}})
  end
end
