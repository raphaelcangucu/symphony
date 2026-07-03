defmodule SymphonyElixir.GitHub.ProjectPullRequests do
  @moduledoc """
  Project-scoped open pull request listing for the Quick-Open launcher.

  Runs one GitHub search per configured repo (`repo:<owner>/<name> is:pr
  is:open`) and annotates each hit with a best-effort tracker issue identifier
  derived from the `Symphony-Issue:` marker in the PR body. Read-only; capped.
  """

  alias SymphonyElixir.GitHub.{Client, IssueMarker, RepoSpec}

  require Logger

  @per_repo_limit 30

  @type pull_request :: %{
          number: integer(),
          title: String.t() | nil,
          url: String.t() | nil,
          repo: String.t(),
          author: String.t() | nil,
          updated_at: String.t() | nil,
          issue_identifier: String.t() | nil
        }

  @spec list_open([String.t()], keyword()) :: [pull_request()]
  def list_open(repos, opts \\ []) when is_list(repos) do
    marker_key = Keyword.get(opts, :marker_key, IssueMarker.default_key())

    repos
    |> Enum.flat_map(&search_repo(&1, marker_key, opts))
    |> Enum.uniq_by(& &1.url)
    |> Enum.sort_by(& &1.updated_at, &>=/2)
  end

  defp search_repo(repo, marker_key, opts) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         query = ~s(repo:#{owner}/#{name} is:pr is:open),
         path = "/search/issues?" <> URI.encode_query(%{"q" => query, "per_page" => "#{@per_repo_limit}"}),
         {:ok, %{body: %{"items" => items}}} when is_list(items) <- rest_get(path, opts) do
      Enum.flat_map(items, &normalize(&1, repo, marker_key))
    else
      {:error, reason} ->
        Logger.debug("ProjectPullRequests search failed repo=#{repo} reason=#{inspect(reason)}")
        []

      _ ->
        []
    end
  end

  defp normalize(%{"number" => number} = item, repo, marker_key)
       when is_integer(number) and number > 0 do
    [
      %{
        number: number,
        title: string_or_nil(item["title"]),
        url: pr_url(item),
        repo: repo,
        author: get_in(item, ["user", "login"]),
        updated_at: string_or_nil(item["updated_at"]),
        issue_identifier: marker_identifier(item["body"], marker_key)
      }
    ]
  end

  defp normalize(_item, _repo, _marker_key), do: []

  defp pr_url(item) do
    case get_in(item, ["pull_request", "html_url"]) do
      url when is_binary(url) and url != "" -> url
      _ -> string_or_nil(item["html_url"])
    end
  end

  defp marker_identifier(body, marker_key) when is_binary(body) do
    case IssueMarker.extract(body, marker_key) do
      [identifier | _] when is_binary(identifier) -> identifier
      _ -> nil
    end
  end

  defp marker_identifier(_body, _marker_key), do: nil

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

  defp string_or_nil(value) when is_binary(value) and value != "", do: value
  defp string_or_nil(_value), do: nil
end
