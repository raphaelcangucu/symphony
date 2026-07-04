defmodule SymphonyElixir.GitHub.ProjectIssues do
  @moduledoc """
  Project-scoped GitHub issue listing and markdown formatting for Load Context.
  """

  alias SymphonyElixir.GitHub.{Client, RepoSpec}

  require Logger

  @per_repo_limit 50

  @type issue :: %{
          number: integer(),
          title: String.t() | nil,
          url: String.t() | nil,
          repo: String.t(),
          state: String.t() | nil,
          author: String.t() | nil,
          updated_at: String.t() | nil,
          body: String.t() | nil
        }

  @spec list([String.t()], keyword()) :: [issue()]
  def list(repos, opts \\ []) when is_list(repos) do
    repos
    |> Enum.flat_map(&search_repo(&1, opts))
    |> Enum.uniq_by(&{&1.repo, &1.number})
    |> Enum.sort_by(&(&1.updated_at || ""), &>=/2)
  end

  @spec issue_markdown(issue()) :: String.t()
  def issue_markdown(issue) when is_map(issue) do
    [
      "### GitHub issue #{issue.repo}##{issue.number}",
      "",
      "- Title: #{issue.title || "Untitled"}",
      "- State: #{issue.state || "unknown"}",
      optional_line("- URL: ", issue.url),
      "",
      "#### Body",
      "",
      blank_to_placeholder(issue.body)
    ]
    |> Enum.reject(&is_nil/1)
    |> Enum.join("\n")
  end

  defp search_repo(repo, opts) do
    state = Keyword.get(opts, :state, "open")

    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         query = issue_search_query(owner, name, state),
         path = "/search/issues?" <> URI.encode_query(%{"q" => query, "per_page" => "#{@per_repo_limit}"}),
         {:ok, %{body: %{"items" => items}}} when is_list(items) <- rest_get(path, opts) do
      Enum.flat_map(items, &normalize(&1, repo))
    else
      {:error, reason} ->
        Logger.debug("ProjectIssues search failed repo=#{repo} reason=#{inspect(reason)}")
        []

      _ ->
        []
    end
  end

  defp normalize(%{"number" => number} = item, repo) when is_integer(number) and number > 0 do
    [
      %{
        number: number,
        title: string_or_nil(item["title"]),
        url: string_or_nil(item["html_url"]),
        repo: repo,
        state: string_or_nil(item["state"]),
        author: get_in(item, ["user", "login"]),
        updated_at: string_or_nil(item["updated_at"]),
        body: string_or_nil(item["body"])
      }
    ]
  end

  defp normalize(_item, _repo), do: []

  defp issue_search_query(owner, name, "all"), do: ~s(repo:#{owner}/#{name} is:issue)
  defp issue_search_query(owner, name, state), do: ~s(repo:#{owner}/#{name} is:issue state:#{state})

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

  defp optional_line(_prefix, nil), do: nil
  defp optional_line(_prefix, ""), do: nil
  defp optional_line(prefix, value), do: prefix <> to_string(value)

  defp blank_to_placeholder(value) when is_binary(value) do
    case String.trim(value) do
      "" -> "_No body._"
      trimmed -> trimmed
    end
  end

  defp blank_to_placeholder(_value), do: "_No body._"

  defp string_or_nil(value) when is_binary(value) and value != "", do: value
  defp string_or_nil(_value), do: nil
end
