defmodule SymphonyElixirWeb.Tracker.PullRequestMergeController do
  @moduledoc """
  Merges a GitHub pull request and marks the related tracker issue Done.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.PullRequests
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.PullRequestMerge
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixirWeb.{TrackerErrors, TrackerPresenter}

  @done_status "Done"
  @default_method "merge"

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"project_slug" => project_slug, "identifier" => identifier, "number" => number} = params) do
    with {:ok, parsed_number} <- parse_number(number),
         {:ok, project} <- Context.get_project(project_slug),
         {:ok, prs} <- PullRequests.for_project_issue(project, identifier),
         {:ok, pr} <- find_pull_request(prs, parsed_number),
         {:ok, result} <-
           PullRequestMerge.merge(
             project,
             parsed_number,
             merge_method(params),
             bypass: force_merge?(params),
             repo: pr_repo(pr) || default_repo(project)
           ),
         {:ok, issue} <- IssueAdapter.dispatch(project, :move_issue, [identifier, %{"status" => @done_status}]) do
      json(conn, %{data: Map.put(result, :issue, TrackerPresenter.issue(issue))})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp parse_number(number) when is_binary(number) do
    case Integer.parse(number) do
      {parsed, ""} when parsed > 0 -> {:ok, parsed}
      _other -> {:error, :invalid_pr_number}
    end
  end

  defp parse_number(_number), do: {:error, :invalid_pr_number}

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

  defp merge_method(params) do
    case Map.get(params, "method") do
      method when is_binary(method) -> method
      _other -> @default_method
    end
  end

  defp force_merge?(%{"bypass" => true}), do: true
  defp force_merge?(%{"bypass" => "true"}), do: true
  defp force_merge?(_params), do: false
end
