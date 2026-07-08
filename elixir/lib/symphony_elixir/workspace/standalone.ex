defmodule SymphonyElixir.Workspace.Standalone do
  @moduledoc """
  Named standalone workspaces: clean working trees that belong to a project but
  to no issue, materialized at `<segment_root>/__ws_<name>`.

  When the project has repositories configured in the local tracker they are
  cloned individually (honoring an optional per-repo branch override);
  otherwise the project's `after_create` hook populates the tree, mirroring
  `ProjectExploreWorkspace`.
  """

  alias SymphonyElixir.LocalTracker.{Context, Git, Repository}
  alias SymphonyElixir.Workspace

  @prefix "__ws_"
  @max_name_length 64

  @doc "Prefix that marks a standalone workspace directory."
  @spec prefix() :: String.t()
  def prefix, do: @prefix

  @doc """
  Resolves the on-disk path for a standalone workspace name, sanitizing the
  name to a filesystem-safe segment.
  """
  @spec path_for(String.t(), String.t()) :: {:ok, Path.t()} | {:error, :invalid_workspace_name}
  def path_for(project_slug, name) when is_binary(project_slug) and is_binary(name) do
    case safe_name(name) do
      {:ok, safe} ->
        layout = Workspace.project_layout(project_slug)
        {:ok, Path.join(segment_root(layout), @prefix <> safe)}

      {:error, _reason} = error ->
        error
    end
  end

  @doc """
  Creates the standalone workspace and returns its path.

  `branches` maps a repository `workspace_path` (directory name) to the branch
  to clone; repos not listed fall back to `selected_branch || default_branch`.
  Fails when the directory already exists so two workspaces never collide.
  """
  @spec create(String.t(), String.t(), map(), keyword()) :: {:ok, Path.t()} | {:error, term()}
  def create(project_slug, name, branches \\ %{}, opts \\ [])
      when is_binary(project_slug) and is_binary(name) and is_map(branches) and is_list(opts) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, path} <- path_for(project_slug, name),
         :ok <- ensure_absent(path) do
      case Context.list_repositories(project_slug) do
        [] -> materialize_via_hook(path, project_slug, name)
        repos -> materialize_clones(path, repos, branches, opts)
      end
    end
  end

  defp ensure_absent(path) do
    if File.exists?(path) do
      {:error, :workspace_already_exists}
    else
      :ok
    end
  end

  defp materialize_via_hook(path, project_slug, name) do
    Workspace.ensure_at(path, %{identifier: "standalone:" <> name, project_slug: project_slug})
  end

  defp materialize_clones(path, repos, branches, opts) do
    git = Keyword.get(opts, :git, Git)
    File.mkdir_p!(path)

    repos
    |> Enum.reduce_while({:ok, path}, fn repo, {:ok, root} ->
      case clone_repository(git, root, repo, branches) do
        :ok -> {:cont, {:ok, root}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, root} ->
        {:ok, root}

      {:error, reason} ->
        _ = File.rm_rf(path)
        {:error, reason}
    end
  end

  defp clone_repository(git, workspace_root, %Repository{} = repo, branches) do
    dest = Path.join(workspace_root, repo.workspace_path)
    url = repo.clone_url || "https://github.com/#{repo.github_full_name}.git"
    branch = Map.get(branches, repo.workspace_path) || repo.selected_branch || repo.default_branch

    case git.clone(url, dest, branch: branch) do
      {:ok, _} -> :ok
      {:error, message} -> {:error, {:repository_clone_failed, repo.workspace_path, message}}
    end
  end

  defp safe_name(name) do
    sanitized =
      name
      |> String.trim()
      |> String.replace(~r/[^a-zA-Z0-9._-]+/, "-")
      |> String.trim("-")
      |> String.slice(0, @max_name_length)

    case sanitized do
      "" -> {:error, :invalid_workspace_name}
      safe -> {:ok, safe}
    end
  end

  defp segment_root(%{root: root, segment: segment}) when is_binary(segment) and segment != "" do
    Path.expand(Path.join(root, segment))
  end

  defp segment_root(%{root: root}), do: Path.expand(root)
end
