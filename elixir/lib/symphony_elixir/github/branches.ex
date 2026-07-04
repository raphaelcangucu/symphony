defmodule SymphonyElixir.GitHub.Branches do
  @moduledoc """
  Project-scoped repo branch listing for the Quick-Open launcher, via REST
  `GET /repos/:owner/:repo/branches`. Read-only; capped per repo.
  """

  alias SymphonyElixir.GitHub.{Client, RepoSpec}

  require Logger

  @per_repo_limit 100

  @type branch :: %{
          name: String.t(),
          repo: String.t(),
          protected: boolean(),
          commit_sha: String.t() | nil
        }

  @spec list_for_project([String.t()], keyword()) :: [branch()]
  def list_for_project(repos, opts \\ []) when is_list(repos) do
    repos
    |> Enum.flat_map(&list_repo(&1, opts))
    |> Enum.sort_by(& &1.name)
  end

  defp list_repo(repo, opts) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         path = "/repos/#{owner}/#{name}/branches?" <> URI.encode_query(%{"per_page" => "#{@per_repo_limit}"}),
         {:ok, %{body: branches}} when is_list(branches) <- rest_get(path, opts) do
      Enum.flat_map(branches, &normalize(&1, repo))
    else
      {:error, reason} ->
        Logger.debug("Branches list failed repo=#{repo} reason=#{inspect(reason)}")
        []

      _ ->
        []
    end
  end

  defp normalize(%{"name" => name} = node, repo) when is_binary(name) and name != "" do
    [
      %{
        name: name,
        repo: repo,
        protected: node["protected"] == true,
        commit_sha: get_in(node, ["commit", "sha"])
      }
    ]
  end

  defp normalize(_node, _repo), do: []

  defp rest_get(path, opts) do
    case Keyword.get(opts, :rest_get_fun) do
      fun when is_function(fun, 2) -> fun.(path, [])
      _ -> client_module(opts).rest_get(path, [])
    end
  end

  defp client_module(opts) do
    case Keyword.get(opts, :client_module) do
      module when is_atom(module) and not is_nil(module) -> module
      _ -> Application.get_env(:symphony_elixir, :github_client_module, Client)
    end
  end
end
