defmodule SymphonyElixir.KnowledgeBase.RepoDocs do
  @moduledoc "Lists a project's repositories and detects each repository's `docs/` folder."

  alias SymphonyElixir.KnowledgeBase.Paths
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.Repository

  @type repo_info :: %{
          repo_slug: String.t(),
          workspace_path: String.t(),
          github_full_name: String.t() | nil,
          default_branch: String.t(),
          role: String.t() | nil,
          docs_present?: boolean()
        }

  @spec list_repositories(String.t()) :: [repo_info()]
  def list_repositories(project_slug) when is_binary(project_slug) do
    project_slug
    |> Context.list_repositories()
    |> Enum.map(&describe(project_slug, &1))
  end

  @spec fetch_repository(String.t(), String.t()) ::
          {:ok, Repository.t()} | {:error, :repo_not_found}
  def fetch_repository(project_slug, repo_slug)
      when is_binary(project_slug) and is_binary(repo_slug) do
    workspace_path = Paths.workspace_path_from_slug(repo_slug)

    project_slug
    |> Context.list_repositories()
    |> Enum.find(fn repo -> repo.workspace_path == workspace_path end)
    |> case do
      %Repository{} = repo -> {:ok, repo}
      nil -> {:error, :repo_not_found}
    end
  end

  defp describe(project_slug, %Repository{} = repo) do
    %{
      repo_slug: Paths.repo_slug(repo.workspace_path),
      workspace_path: repo.workspace_path,
      github_full_name: repo.github_full_name,
      default_branch: configured_branch(repo),
      role: repo.role,
      docs_present?: File.dir?(Paths.docs_root(project_slug, repo.workspace_path))
    }
  end

  defp configured_branch(%Repository{} = repo) do
    cond do
      is_binary(repo.selected_branch) and repo.selected_branch != "" -> repo.selected_branch
      is_binary(repo.default_branch) and repo.default_branch != "" -> repo.default_branch
      true -> "main"
    end
  end
end
