defmodule SymphonyElixir.Tracker.ExternalUrl do
  @moduledoc """
  Builds external tracker URLs for local projects connected to remote boards.
  """

  alias SymphonyElixir.GitHub.Discovery, as: GitHubDiscovery
  alias SymphonyElixir.Jira.Config, as: JiraConfig
  alias SymphonyElixir.LocalTracker.Project

  @spec for(Project.t()) :: String.t() | nil
  def for(%Project{tracker_kind: "local"}), do: nil

  def for(%Project{tracker_kind: "linear", tracker_config: config}) do
    case config_string(config, "project_slug") do
      nil -> nil
      slug -> "https://linear.app/project/#{slug}/issues"
    end
  end

  def for(%Project{tracker_kind: "github", tracker_config: config}) do
    case config_string(config, "project_url") do
      url when is_binary(url) ->
        url

      _ ->
        github_fallback_url(config)
    end
  end

  def for(%Project{tracker_kind: "jira", tracker_config: config}) do
    with key when is_binary(key) <- config_string(config, "project_key"),
         base when is_binary(base) <- jira_base_url(config) do
      String.trim_trailing(base, "/") <> "/jira/software/projects/" <> key <> "/boards"
    else
      _ -> nil
    end
  end

  def for(_project), do: nil

  @spec enrich_github_config(map()) :: map()
  def enrich_github_config(config) when is_map(config) do
    if config_string(config, "project_url") do
      config
    else
      enrich_github_config_from_api(config)
    end
  end

  def enrich_github_config(_config), do: %{}

  defp enrich_github_config_from_api(config) do
    case config_string(config, "project_id") do
      project_id when is_binary(project_id) ->
        case GitHubDiscovery.fetch_project(project_id) do
          {:ok, project} ->
            config
            |> put_present("project_url", project.url || GitHubDiscovery.board_url(project))
            |> put_present("project_number", project.number)
            |> put_present("owner_kind", get_in(project, [:owner, :kind]))

          _ ->
            config
        end

      _ ->
        config
    end
  end

  defp put_present(config, _key, value) when value in [nil, ""], do: config
  defp put_present(config, key, value), do: Map.put(config, key, value)

  defp github_fallback_url(config) do
    repo = config_string(config, "repo")
    number = config_integer(config, "project_number")

    cond do
      is_binary(repo) and is_integer(number) ->
        github_board_url_from_repo(repo, config_string(config, "owner_kind"), number)

      is_binary(repo) ->
        "https://github.com/#{repo}/issues"

      true ->
        # Never call the GitHub API from request-time URL rendering — listing
        # projects blocked the whole tracker UI for seconds whenever a project
        # only had a GraphQL project_id and no cached project_url.
        nil
    end
  end

  defp github_board_url_from_repo(repo, owner_kind, number) do
    owner = repo |> String.split("/") |> List.first()

    if is_binary(owner) and owner != "" do
      scope =
        case owner_kind do
          "user" -> "users"
          _ -> "orgs"
        end

      "https://github.com/#{scope}/#{owner}/projects/#{number}"
    else
      nil
    end
  end

  defp jira_base_url(config) do
    config_string(config, "base_url") || JiraConfig.base_url()
  end

  defp config_string(config, key) when is_map(config) do
    case Map.get(config, key) do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> nil
          trimmed -> trimmed
        end

      _ ->
        nil
    end
  end

  defp config_string(_config, _key), do: nil

  defp config_integer(config, key) when is_map(config) do
    case Map.get(config, key) do
      value when is_integer(value) -> value
      value when is_binary(value) -> parse_integer(value)
      _ -> nil
    end
  end

  defp config_integer(_config, _key), do: nil

  defp parse_integer(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {parsed, ""} -> parsed
      _ -> nil
    end
  end
end
