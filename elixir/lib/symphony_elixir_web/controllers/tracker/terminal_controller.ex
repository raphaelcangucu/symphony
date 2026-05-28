defmodule SymphonyElixirWeb.Tracker.TerminalController do
  @moduledoc "Terminal endpoints for local tracker issues."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Terminal.Registry
  alias SymphonyElixirWeb.TrackerErrors

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    case Registry.open_project_issue_session(project_slug, identifier) do
      {:ok, session} -> json(conn, %{data: session_payload(session)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp session_payload(session) do
    %{
      project_slug: session.project_slug,
      issue_identifier: session.issue_identifier,
      session_name: session.session_name,
      cwd: session.cwd,
      state: session.state,
      output: session.output,
      channel_topic: "terminal:#{session.project_slug}:#{session.issue_identifier}"
    }
  end
end
