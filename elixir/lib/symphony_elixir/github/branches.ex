defmodule SymphonyElixir.GitHub.Branches do
  @moduledoc """
  Project-scoped repo branch listing for the Quick-Open launcher and clone
  branch pickers, via REST `GET /repos/:owner/:repo/branches` (capped) and
  prefix search via `GET /repos/:owner/:repo/git/matching-refs/heads/:prefix`.
  """

  alias SymphonyElixir.GitHub.{Client, RepoSpec}

  require Logger

  @per_repo_limit 100
  @search_min_length 2

  @type branch :: %{
          name: String.t(),
          repo: String.t(),
          protected: boolean(),
          commit_sha: String.t() | nil
        }

  @doc "Lists up to #{@per_repo_limit} branches per repo (first GitHub page)."
  @spec list_for_project([String.t()], keyword()) :: [branch()]
  def list_for_project(repos, opts \\ []) when is_list(repos) do
    repos
    |> Enum.flat_map(&list_repo(&1, opts))
    |> Enum.sort_by(& &1.name)
  end

  @doc """
  Prefix-searches branches across project repos via Git matching-refs.

  Returns `[]` when `query` is blank or shorter than #{@search_min_length} chars
  after trim (callers should fall back to `list_for_project/2`).
  """
  @spec search_for_project([String.t()], String.t(), keyword()) :: [branch()]
  def search_for_project(repos, query, opts \\ []) when is_list(repos) and is_binary(query) do
    case normalize_search_query(query) do
      nil ->
        []

      prefix ->
        repos
        |> Enum.flat_map(&search_repo(&1, prefix, opts))
        |> Enum.uniq_by(&{&1.repo, &1.name})
        |> Enum.sort_by(& &1.name)
    end
  end

  defp list_repo(repo, opts) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         path = "/repos/#{owner}/#{name}/branches?" <> URI.encode_query(%{"per_page" => "#{@per_repo_limit}"}),
         {:ok, %{body: branches}} when is_list(branches) <- rest_get(path, opts) do
      Enum.flat_map(branches, &normalize_list_item(&1, repo))
    else
      {:error, reason} ->
        Logger.debug("Branches list failed repo=#{repo} reason=#{inspect(reason)}")
        []

      _ ->
        []
    end
  end

  defp search_repo(repo, prefix, opts) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         path = matching_refs_path(owner, name, prefix),
         {:ok, %{body: refs}} when is_list(refs) <- rest_get(path, opts) do
      Enum.flat_map(refs, &normalize_ref_item(&1, repo))
    else
      {:error, reason} ->
        Logger.debug("Branches search failed repo=#{repo} prefix=#{prefix} reason=#{inspect(reason)}")
        []

      _ ->
        []
    end
  end

  defp matching_refs_path(owner, name, prefix) do
    encoded =
      prefix
      |> String.split("/", trim: false)
      |> Enum.map_join("/", &URI.encode/1)

    "/repos/#{owner}/#{name}/git/matching-refs/heads/#{encoded}"
  end

  defp normalize_search_query(query) do
    trimmed =
      query
      |> String.trim()
      |> String.trim_leading("refs/heads/")

    if String.length(trimmed) >= @search_min_length, do: trimmed, else: nil
  end

  defp normalize_list_item(%{"name" => name} = node, repo) when is_binary(name) and name != "" do
    [
      %{
        name: name,
        repo: repo,
        protected: node["protected"] == true,
        commit_sha: get_in(node, ["commit", "sha"])
      }
    ]
  end

  defp normalize_list_item(_node, _repo), do: []

  defp normalize_ref_item(%{"ref" => "refs/heads/" <> name} = node, repo)
       when is_binary(name) and name != "" do
    [
      %{
        name: name,
        repo: repo,
        protected: false,
        commit_sha: get_in(node, ["object", "sha"])
      }
    ]
  end

  defp normalize_ref_item(_node, _repo), do: []

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
