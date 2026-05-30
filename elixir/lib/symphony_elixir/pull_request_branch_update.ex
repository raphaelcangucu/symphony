defmodule SymphonyElixir.PullRequestBranchUpdate do
  @moduledoc """
  Updates a pull request's head branch with its base branch via GitHub's
  update-branch REST endpoint (merge commit). GitHub does not expose a rebase
  option on this endpoint, so this is merge-only. GitHub-backed projects only.
  """

  alias SymphonyElixir.GitHub.{Client, PullRequests, RepoSpec}
  alias SymphonyElixir.LocalTracker.Project

  @spec update(Project.t(), pos_integer(), keyword()) :: {:ok, :accepted} | {:error, term()}
  def update(%Project{} = project, number, opts \\ [])
      when is_integer(number) and number > 0 and is_list(opts) do
    with {:ok, repo} <- PullRequests.resolve_repo(project),
         {:ok, {owner, name}} <- RepoSpec.split(repo) do
      client = Keyword.get(opts, :client_module, default_client())
      rest_opts = Keyword.take(opts, [:request_fun])
      path = "/repos/#{owner}/#{name}/pulls/#{number}/update-branch"

      case client.rest_put(path, %{}, rest_opts) do
        {:ok, %{status: status}} when status in 200..299 -> {:ok, :accepted}
        {:error, {:github_api_status, 422}} -> {:error, :update_branch_conflict}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp default_client, do: Application.get_env(:symphony_elixir, :github_client_module, Client)
end
