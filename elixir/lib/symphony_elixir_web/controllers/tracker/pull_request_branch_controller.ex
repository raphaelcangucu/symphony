defmodule SymphonyElixirWeb.Tracker.PullRequestBranchController do
  @moduledoc """
  Updates a pull request branch with its base branch (merge) via GitHub's
  update-branch endpoint. GitHub-backed projects only.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.PullRequests
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.PullRequestBranchUpdate
  alias SymphonyElixirWeb.TrackerErrors

  @spec update(Conn.t(), map()) :: Conn.t()
  def update(conn, %{"project_slug" => project_slug, "identifier" => identifier, "number" => number}) do
    with {:ok, parsed} <- parse_number(number),
         {:ok, project} <- Context.get_project(project_slug),
         {:ok, prs} <- PullRequests.for_project_issue(project, identifier),
         {:ok, pr} <- find_pull_request(prs, parsed),
         {:ok, :accepted} <-
           PullRequestBranchUpdate.update(project, parsed, repo: pr_repo(pr) || default_repo(project)) do
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

  defp find_pull_request(prs, parsed_number) do
    case Enum.find(prs, &(&1.number == parsed_number)) do
      %{} = pr -> {:ok, pr}
      _ -> {:error, :invalid_pr_number}
    end
  end

  defp pr_repo(pr) do
    Map.get(pr, :repo) || Map.get(pr, "repo")
  end

  defp default_repo(project) do
    case PullRequests.resolve_repo(project) do
      {:ok, repo} -> repo
      {:error, _reason} -> nil
    end
  end
end
