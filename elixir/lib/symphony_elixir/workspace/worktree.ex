defmodule SymphonyElixir.Workspace.Worktree do
  @moduledoc """
  Creates and tracks isolated git worktrees for child runs, so multiple runs in
  the same repository never share a checkout. Worktrees live under
  `<repo>/.worktrees/<slug>` on a per-child feature branch.
  """

  @spec ensure(String.t(), String.t(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def ensure(repo_path, slug, branch) when is_binary(repo_path) and is_binary(slug) and is_binary(branch) do
    path = Path.join([repo_path, ".worktrees", slug])

    if File.dir?(path) do
      {:ok, path}
    else
      create(repo_path, path, branch)
    end
  end

  defp create(repo_path, path, branch) do
    File.mkdir_p!(Path.dirname(path))

    case System.cmd("git", ["worktree", "add", path, "-b", branch], cd: repo_path, stderr_to_stdout: true) do
      {_out, 0} -> {:ok, path}
      {out, _code} -> {:error, {:worktree_failed, String.trim(out)}}
    end
  end

  @spec remove(String.t(), String.t()) :: :ok
  def remove(repo_path, path) do
    _ = System.cmd("git", ["worktree", "remove", "--force", path], cd: repo_path, stderr_to_stdout: true)
    :ok
  end
end
