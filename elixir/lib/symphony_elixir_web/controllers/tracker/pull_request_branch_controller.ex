defmodule SymphonyElixirWeb.Tracker.PullRequestBranchController do
  @moduledoc """
  Updates a pull request branch with its base branch (merge) via GitHub's
  update-branch endpoint. GitHub-backed projects only.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.PullRequestBranchUpdate
  alias SymphonyElixirWeb.TrackerErrors

  @spec update(Conn.t(), map()) :: Conn.t()
  def update(conn, %{"project_slug" => project_slug, "number" => number}) do
    with {:ok, parsed} <- parse_number(number),
         {:ok, project} <- Context.get_project(project_slug),
         {:ok, :accepted} <- PullRequestBranchUpdate.update(project, parsed) do
      json(conn, %{data: %{updated: true}})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp parse_number(number) when is_binary(number) do
    case Integer.parse(number) do
      {parsed, ""} when parsed > 0 -> {:ok, parsed}
      _ -> {:error, :invalid_pr_number}
    end
  end
end
