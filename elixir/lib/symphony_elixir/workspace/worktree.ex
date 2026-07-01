defmodule SymphonyElixir.Workspace.Worktree do
  @moduledoc """
  Creates and tracks isolated git worktrees for child runs, so multiple runs in
  the same repository never share a checkout. Worktrees live under
  `<repo>/.worktrees/<slug>` on a per-child feature branch.
  """

  @doc """
  Ensures an isolated worktree exists at `<repo>/.worktrees/<slug>` on `branch`.

  When `base_branch` is given it is the start point the new branch forks from —
  the parent's per-repo integration branch (`symphony/<parent>/<repo>`). The base
  branch is created off the repo's current HEAD when it does not yet exist, so the
  first sibling lazily provisions it and later siblings fork off the same branch.
  Falls back to the current HEAD when `base_branch` is nil/empty.
  """
  @spec ensure(String.t(), String.t(), String.t(), String.t() | nil) ::
          {:ok, String.t()} | {:error, term()}
  def ensure(repo_path, slug, branch, base_branch \\ nil)
      when is_binary(repo_path) and is_binary(slug) and is_binary(branch) do
    path = Path.join([repo_path, ".worktrees", slug])

    if File.dir?(path) do
      {:ok, path}
    else
      with :ok <- ensure_base_branch(repo_path, base_branch) do
        create(repo_path, path, branch, base_branch)
      end
    end
  end

  defp ensure_base_branch(_repo_path, base_branch) when base_branch in [nil, ""], do: :ok

  defp ensure_base_branch(repo_path, base_branch) when is_binary(base_branch) do
    if branch_exists?(repo_path, base_branch) do
      :ok
    else
      case System.cmd("git", ["branch", base_branch], cd: repo_path, stderr_to_stdout: true) do
        {_out, 0} -> :ok
        {out, _code} -> {:error, {:base_branch_failed, String.trim(out)}}
      end
    end
  end

  defp branch_exists?(repo_path, branch) do
    {_out, code} =
      System.cmd("git", ["show-ref", "--verify", "--quiet", "refs/heads/" <> branch],
        cd: repo_path,
        stderr_to_stdout: true
      )

    code == 0
  end

  defp create(repo_path, path, branch, base_branch) do
    File.mkdir_p!(Path.dirname(path))
    args = ["worktree", "add", path, "-b", branch] ++ start_point_args(base_branch)

    case System.cmd("git", args, cd: repo_path, stderr_to_stdout: true) do
      {_out, 0} -> {:ok, path}
      {out, _code} -> {:error, {:worktree_failed, String.trim(out)}}
    end
  end

  defp start_point_args(base_branch) when base_branch in [nil, ""], do: []
  defp start_point_args(base_branch) when is_binary(base_branch), do: [base_branch]

  @spec remove(String.t(), String.t()) :: :ok
  def remove(repo_path, path) do
    _ = System.cmd("git", ["worktree", "remove", "--force", path], cd: repo_path, stderr_to_stdout: true)
    :ok
  end
end
