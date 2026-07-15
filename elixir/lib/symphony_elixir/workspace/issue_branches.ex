defmodule SymphonyElixir.Workspace.IssueBranches do
  @moduledoc """
  Checks out the per-issue feature branch in every git repository under a workspace.

  Used when provisioning an isolated parallel working tree so a new session starts
  on a fresh branch instead of inheriting whatever branch a clone happened to have.
  """

  alias SymphonyElixir.{LocalTracker.Context, ProjectConfig, Repo, RunContract}

  @spec ensure(Path.t(), String.t(), String.t()) :: :ok | {:error, term()}
  def ensure(workspace, project_slug, issue_identifier)
      when is_binary(workspace) and is_binary(project_slug) and is_binary(issue_identifier) do
    with {:ok, branch} <- resolve_branch_name(project_slug, issue_identifier),
         :ok <- checkout_repos(workspace, branch) do
      :ok
    end
  end

  defp resolve_branch_name(project_slug, issue_identifier) do
    with {:ok, project} <- Context.get_project(project_slug),
         config <- project |> Repo.preload(:setup) |> ProjectConfig.resolve() do
      {:ok, interpolate_pattern(ProjectConfig.source_control_branch_pattern(config), issue_identifier)}
    end
  end

  defp interpolate_pattern(pattern, issue_identifier) when is_binary(pattern) and is_binary(issue_identifier) do
    String.replace(pattern, "{issue}", issue_identifier)
  end

  defp checkout_repos(workspace, branch) do
    workspace
    |> RunContract.repo_states()
    |> Enum.reduce_while(:ok, fn repo, :ok ->
      case checkout_branch(repo.path, branch) do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, {:branch_checkout_failed, repo.name, reason}}}
      end
    end)
  end

  defp checkout_branch(repo_path, branch) do
    cond do
      current_branch(repo_path) == branch ->
        :ok

      branch_exists?(repo_path, branch) ->
        case run_git(repo_path, ["checkout", branch]) do
          {:ok, _} -> :ok
          {:error, reason} -> {:error, reason}
        end

      true ->
        case run_git(repo_path, ["checkout", "-b", branch]) do
          {:ok, _} -> :ok
          {:error, reason} -> {:error, reason}
        end
    end
  end

  defp current_branch(repo_path) do
    case run_git(repo_path, ["branch", "--show-current"]) do
      {:ok, output} -> output
      _ -> nil
    end
  end

  defp branch_exists?(repo_path, branch) do
    case System.cmd("git", ["show-ref", "--verify", "--quiet", "refs/heads/" <> branch],
           cd: repo_path,
           stderr_to_stdout: true
         ) do
      {_out, 0} -> true
      {_out, _} -> false
    end
  end

  defp run_git(repo_path, args) do
    case System.cmd("git", args, cd: repo_path, stderr_to_stdout: true) do
      {output, 0} -> {:ok, String.trim(output)}
      {output, _code} -> {:error, String.trim(output)}
    end
  end
end
