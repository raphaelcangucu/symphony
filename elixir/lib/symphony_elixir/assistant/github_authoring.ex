defmodule SymphonyElixir.Assistant.GitHubAuthoring do
  @moduledoc """
  Prompt fragments for GitHub tracker authoring — especially multi-repo boards
  where issues are filed in different repositories but share one Project V2.
  """

  alias SymphonyElixir.LocalTracker.{Context, Project}

  @spec create_issue_guidance(Project.t() | nil) :: String.t()
  def create_issue_guidance(nil), do: ""

  def create_issue_guidance(%Project{tracker_kind: "github"} = project) do
    repos = Context.list_repositories(project.slug)
    default_repo = default_tracker_repo(project)

    if length(repos) > 1 do
      multi_repo_guidance(repos, default_repo)
    else
      single_repo_guidance(default_repo)
    end
  end

  def create_issue_guidance(_project), do: ""

  @spec create_issue_guidance_for_slug(String.t()) :: String.t()
  def create_issue_guidance_for_slug(project_slug) when is_binary(project_slug) do
    case Context.get_project(project_slug) do
      {:ok, project} -> create_issue_guidance(project)
      _ -> ""
    end
  end

  defp multi_repo_guidance(repos, default_repo) do
    repo_lines =
      repos
      |> Enum.map(fn repo ->
        "- `#{repo.github_full_name}` (#{repo.role || "linked"}, path `#{repo.workspace_path}/`)"
      end)
      |> Enum.join("\n")

    default_line =
      if is_binary(default_repo) and default_repo != "" do
        "Default/fallback repo in tracker config: `#{default_repo}` — used only when `repository` is omitted and no `area:*` label matches."
      else
        "No default repo in tracker config — pass `repository` on every create."
      end

    """
    GitHub multi-repo board (one Project, many issue repositories):
    - Before create_issue or create_draft_issue, call list_project_repositories.
    - Pass repository: "owner/name" for the repo that **owns** the task. Do not assume every task lives in the default repo.
    - Optional: add area:* labels (e.g. area:backend) — Symphony can infer the repo from linked repositories, but explicit repository is preferred.
    #{default_line}

    Linked repositories:
    #{repo_lines}
    """
    |> String.trim()
  end

  defp single_repo_guidance(default_repo) do
    case default_repo do
      repo when is_binary(repo) and repo != "" ->
        """
        GitHub tracker (single repo): create_issue files in `#{repo}` unless you pass repository explicitly.
        """
        |> String.trim()

      _ ->
        ""
    end
  end

  defp default_tracker_repo(%Project{tracker_config: config}) when is_map(config) do
    case Map.get(config, "repo") do
      repo when is_binary(repo) ->
        case String.trim(repo) do
          "" -> nil
          trimmed -> trimmed
        end

      _ ->
        nil
    end
  end

  defp default_tracker_repo(_project), do: nil
end
