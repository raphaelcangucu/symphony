defmodule SymphonyElixir.Workspace.Clone do
  @moduledoc """
  Clones configured project repositories into a workspace directory.

  Mirrors `Workspace.Standalone` clone behavior so issue and standalone
  workspaces can honor per-repo branch overrides at creation time.
  """

  alias SymphonyElixir.LocalTracker.{Context, Git, Repository}

  @spec materialize(Path.t(), String.t(), map(), keyword()) :: :ok | {:error, term()}
  def materialize(workspace, project_slug, branches, opts \\ [])
      when is_binary(workspace) and is_binary(project_slug) and is_map(branches) do
    git = Keyword.get(opts, :git, Git)

    case Context.list_repositories(project_slug) do
      [] ->
        :ok

      repos ->
        repos
        |> Enum.reduce_while(:ok, fn repo, :ok ->
          case clone_repository(git, workspace, repo, branches) do
            :ok -> {:cont, :ok}
            {:error, reason} -> {:halt, {:error, reason}}
          end
        end)
    end
  end

  defp clone_repository(git, workspace_root, %Repository{} = repo, branches) do
    dest = Path.join(workspace_root, repo.workspace_path)

    if repository_materialized?(dest, repo.workspace_path) do
      :ok
    else
      url = repo.clone_url || "https://github.com/#{repo.github_full_name}.git"
      branch = clone_branch(repo, branches)

      case git.clone(url, dest, branch: branch) do
        {:ok, _} -> :ok
        {:error, message} -> {:error, {:repository_clone_failed, repo.workspace_path, message}}
      end
    end
  end

  defp repository_materialized?(destination, workspace_path)
       when workspace_path in [".", ""] do
    File.exists?(Path.join(destination, ".git"))
  end

  defp repository_materialized?(destination, _workspace_path), do: File.exists?(destination)

  defp clone_branch(%Repository{} = repo, branches) when is_map(branches) do
    Map.get(branches, repo.workspace_path) ||
      Map.get(branches, "__default__") ||
      repo.selected_branch ||
      repo.default_branch
  end
end
