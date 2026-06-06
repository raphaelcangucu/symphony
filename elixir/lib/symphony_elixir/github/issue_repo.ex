defmodule SymphonyElixir.GitHub.IssueRepo do
  @moduledoc """
  Resolves which GitHub repository owns a tracker issue in multi-repo projects.

  Candidate repositories are ordered by: the issue's remote URL, configured
  workspace repositories, then the tracker's primary `repo` config.
  """

  alias SymphonyElixir.GitHub.{Client, IssueAdapter, RepoSpec}
  alias SymphonyElixir.LocalTracker.{Context, Project}

  @spec candidate_repos(Project.t(), String.t()) :: [String.t()]
  def candidate_repos(%Project{} = project, identifier) when is_binary(identifier) do
    url_repo =
      case Context.get_issue(project.slug, identifier) do
        {:ok, issue} -> repo_from_issue_url(issue.remote_url || issue.url)
        _ -> :error
      end

    configured =
      project.slug
      |> Context.list_repositories()
      |> Enum.map(& &1.github_full_name)

    tracker =
      case project.tracker_config do
        %{"repo" => repo} when is_binary(repo) -> repo
        _ -> nil
      end

    []
    |> prepend_if_ok(url_repo)
    |> Kernel.++(configured)
    |> Kernel.++(List.wrap(tracker))
    |> Enum.uniq()
    |> Enum.reject(&(is_nil(&1) or &1 == ""))
  end

  @spec resolve(Project.t(), String.t(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def resolve(%Project{} = project, identifier, opts \\ []) when is_binary(identifier) do
    with {:ok, number} <- parse_issue_number(identifier) do
      find_repo(project, identifier, number, opts)
    end
  end

  @spec repo_from_issue_url(String.t() | nil) :: {:ok, String.t()} | :error
  def repo_from_issue_url(url) when is_binary(url) do
    case URI.parse(url) do
      %URI{host: host, path: path} when host in ["github.com", "www.github.com"] ->
        case String.split(String.trim_leading(path || "", "/"), "/") do
          [owner, repo, "issues", _number | _] when owner != "" and repo != "" ->
            {:ok, "#{owner}/#{repo}"}

          _ ->
            :error
        end

      _ ->
        :error
    end
  end

  def repo_from_issue_url(_), do: :error

  defp find_repo(%Project{} = project, identifier, number, opts) do
    candidate_repos(project, identifier)
    |> Enum.reduce_while({:error, :issue_not_found}, fn repo, _acc ->
      with {:ok, {owner, name}} <- RepoSpec.split(repo),
           {:ok, _} <- issue_exists?(owner, name, number, opts) do
        {:halt, {:ok, repo}}
      else
        _ -> {:cont, {:error, :issue_not_found}}
      end
    end)
  end

  defp issue_exists?(owner, name, number, opts) do
    variables = %{"owner" => owner, "name" => name, "number" => number}
    client = client_module(opts)
    graphql_opts = Keyword.take(opts, [:request_fun, :operation_name])

    case client.graphql(IssueAdapter.Query.issue_node_id_query(), variables, graphql_opts) do
      {:ok, response} -> IssueAdapter.Query.issue_details(response)
      {:error, reason} -> {:error, reason}
    end
  end

  defp prepend_if_ok(acc, {:ok, repo}), do: [repo | acc]
  defp prepend_if_ok(acc, _), do: acc

  defp parse_issue_number(identifier) do
    identifier
    |> String.trim()
    |> String.trim_leading("#")
    |> Integer.parse()
    |> case do
      {number, ""} when number > 0 -> {:ok, number}
      _ -> {:error, {:invalid_issue_identifier, identifier}}
    end
  end

  defp client_module(opts) do
    case Keyword.get(opts, :client_module) do
      nil -> Application.get_env(:symphony_elixir, :github_client_module, Client)
      module when is_atom(module) -> module
    end
  end
end
