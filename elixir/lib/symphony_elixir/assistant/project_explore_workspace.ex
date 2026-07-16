defmodule SymphonyElixir.Assistant.ProjectExploreWorkspace do
  @moduledoc """
  Prepares a project-level Codex workspace with repositories on their default branches.

  Repositories come from the local tracker when configured; otherwise the workflow
  `after_create` hook runs once under the project slug directory.
  """

  alias SymphonyElixir.LocalTracker.{Context, Git, Repository}
  alias SymphonyElixir.Workspace

  @explore_issue_prefix "explore:"

  @doc """
  Absolute path of the project's shared explore / default workspace.

  Uses `Workspace.project_layout/1` so per-project `workspace.root` overrides the
  process-level root (same segment root the inventory exposes as `kind: :project`).
  """
  @spec path(String.t()) :: Path.t()
  def path(project_slug) when is_binary(project_slug) do
    %{root: root, segment: segment} = Workspace.project_layout(project_slug)

    case segment do
      segment when is_binary(segment) and segment != "" ->
        Path.expand(Path.join(root, segment))

      _empty ->
        Path.expand(root)
    end
  end

  @spec ensure(String.t(), keyword()) :: {:ok, Path.t()} | {:error, term()}
  def ensure(project_slug, opts \\ []) when is_binary(project_slug) do
    with {:ok, slug} <- normalize_slug(project_slug),
         {:ok, _project} <- Context.get_project(slug) do
      workspace = path(slug)
      repos = Context.list_repositories(slug)

      case repos do
        [] -> Workspace.ensure_at(workspace, explore_issue_identifier(slug))
        _ -> ensure_repository_clones(workspace, repos, opts)
      end
    end
  end

  defp ensure_repository_clones(workspace, repos, opts) do
    git = Keyword.get(opts, :git, Git)
    :ok = File.mkdir_p!(workspace)

    repos
    |> Enum.reduce_while({:ok, workspace}, fn repo, {:ok, root} ->
      case clone_repository(git, root, repo) do
        :ok -> {:cont, {:ok, root}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp clone_repository(git, workspace_root, %Repository{} = repo) do
    dest = Path.join(workspace_root, repo.workspace_path)
    url = repo.clone_url || "https://github.com/#{repo.github_full_name}.git"
    branch = repo.selected_branch || repo.default_branch

    case git.clone(url, dest, branch: branch) do
      {:ok, _} ->
        :ok

      {:error, _message} ->
        # Idempotent for explore default: an existing checkout is usable even when
        # origin differs (SSH vs HTTPS, local seed clone, etc.).
        if File.dir?(Path.join(dest, ".git")) do
          :ok
        else
          {:error, {:repository_clone_failed, repo.workspace_path, "clone failed and destination is not a git checkout"}}
        end
    end
  end

  defp explore_issue_identifier(slug), do: @explore_issue_prefix <> slug

  defp normalize_slug(slug) do
    case String.trim(slug) do
      "" -> {:error, {:missing_required_field, :project_slug}}
      trimmed -> {:ok, trimmed}
    end
  end
end
