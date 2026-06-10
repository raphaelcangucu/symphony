defmodule SymphonyElixir.RunContract do
  @moduledoc """
  Deterministic deliverable checks for an issue run (publish gate).

  Inspects ground truth in the workspace: every git repo directly under the
  workspace root (or the workspace itself when it is a repo) is checked for
  committed-but-unpublished work and, via a pluggable checker, for a pull
  request on its current branch. A workspace with clean trees and no commits
  ahead of base satisfies the contract (no-op run).
  """

  require Logger

  defmodule RepoState do
    @moduledoc false
    @enforce_keys [:path, :name]
    defstruct [:path, :name, :branch, :default_branch, dirty?: false, upstream?: false, ahead_count: 0]

    @type t :: %__MODULE__{
            path: Path.t(),
            name: String.t(),
            branch: String.t() | nil,
            default_branch: String.t() | nil,
            dirty?: boolean(),
            upstream?: boolean(),
            ahead_count: non_neg_integer()
          }
  end

  @type violation :: %{repo: String.t(), kind: atom(), detail: String.t()}
  @type pr_checker :: (RepoState.t() -> {:ok, map()} | :none | {:error, term()})

  @spec repo_states(Path.t()) :: [RepoState.t()]
  def repo_states(workspace) when is_binary(workspace) do
    workspace |> repo_dirs() |> Enum.map(&inspect_repo/1)
  end

  @spec work_present?([RepoState.t()]) :: boolean()
  def work_present?(repo_states) do
    Enum.any?(repo_states, &(&1.dirty? or &1.ahead_count > 0))
  end

  defp repo_dirs(workspace) do
    cond do
      File.dir?(Path.join(workspace, ".git")) ->
        [workspace]

      File.dir?(workspace) ->
        workspace
        |> File.ls!()
        |> Enum.sort()
        |> Enum.map(&Path.join(workspace, &1))
        |> Enum.filter(&File.dir?(Path.join(&1, ".git")))

      true ->
        []
    end
  end

  defp inspect_repo(path) do
    branch = git_value(path, ["branch", "--show-current"])
    default_branch = default_branch(path)
    upstream? = match?({:ok, _}, git(path, ["rev-parse", "--abbrev-ref", "@{upstream}"]))

    %RepoState{
      path: path,
      name: Path.basename(path),
      branch: presence(branch),
      default_branch: default_branch,
      dirty?: git_value(path, ["status", "--porcelain"]) != "",
      upstream?: upstream?,
      ahead_count: ahead_count(path, presence(branch), default_branch, upstream?)
    }
  end

  defp ahead_count(path, branch, default_branch, upstream?) do
    cond do
      upstream? ->
        count(path, ["rev-list", "--count", "@{upstream}..HEAD"])

      is_binary(default_branch) and is_binary(branch) and branch != default_branch ->
        count(path, ["rev-list", "--count", "origin/#{default_branch}..HEAD"])

      true ->
        0
    end
  end

  defp default_branch(path) do
    case git(path, ["rev-parse", "--abbrev-ref", "origin/HEAD"]) do
      {:ok, "origin/" <> name} -> name
      _other -> nil
    end
  end

  defp git(path, args) do
    case System.cmd("git", args, cd: path, stderr_to_stdout: true) do
      {output, 0} -> {:ok, String.trim(output)}
      {output, status} -> {:error, {status, String.trim(output)}}
    end
  end

  defp git_value(path, args) do
    case git(path, args) do
      {:ok, value} -> value
      {:error, _reason} -> ""
    end
  end

  defp count(path, args) do
    with {:ok, value} <- git(path, args),
         {n, ""} <- Integer.parse(value) do
      n
    else
      _other -> 0
    end
  end

  defp presence(""), do: nil
  defp presence(value), do: value
end
