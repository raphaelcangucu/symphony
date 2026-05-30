defmodule SymphonyElixirWeb.Tracker.PullRequestFixController do
  @moduledoc """
  Posts a CI-failure comment and moves the issue to `Rework` so the orchestrator
  re-dispatches the agent with the failure context. GitHub-backed projects only.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.PullRequestFix
  alias SymphonyElixirWeb.TrackerErrors

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, result} <- PullRequestFix.request_fix(project, identifier) do
      conn
      |> put_status(:created)
      |> json(%{data: %{moved_to: result.status, comment_posted: true, jobs: result.jobs}})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
end
