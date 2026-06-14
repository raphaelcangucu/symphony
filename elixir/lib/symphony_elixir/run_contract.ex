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

  @spec evaluate_publish([RepoState.t()], pr_checker()) :: :satisfied | {:violations, [violation()]}
  def evaluate_publish(repo_states, pr_checker) when is_function(pr_checker, 1) do
    case Enum.flat_map(repo_states, &repo_violations(&1, pr_checker)) do
      [] -> :satisfied
      violations -> {:violations, violations}
    end
  end

  @spec pull_requests([RepoState.t()], pr_checker()) :: [map()]
  def pull_requests(repo_states, pr_checker) when is_function(pr_checker, 1) do
    repo_states
    |> Enum.filter(&published_repo?/1)
    |> Enum.flat_map(fn repo ->
      case pr_checker.(repo) do
        {:ok, pr} -> [Map.put(pr, :repo, repo.name)]
        _other -> []
      end
    end)
  end

  @spec summary_text([RepoState.t()]) :: String.t()
  def summary_text([]), do: "No git repositories found in the workspace."

  def summary_text(repo_states) do
    Enum.map_join(repo_states, "\n", fn repo ->
      "- #{repo.name}: branch=#{repo.branch || "?"} commits_ahead=#{repo.ahead_count}" <>
        " uncommitted=#{yes_no(repo.dirty?)} pushed=#{yes_no(repo.upstream?)}"
    end)
  end

  @doc """
  Default PR checker backed by the `gh` CLI, querying by head branch in the
  repo's own directory so it works for any GitHub repo regardless of the
  project's tracker kind. Closed PRs do not satisfy the gate; merged ones do.
  """
  @spec gh_pr_checker(keyword()) :: pr_checker()
  def gh_pr_checker(opts \\ []) do
    runner = Keyword.get(opts, :runner, &System.cmd/3)

    fn %RepoState{} = repo ->
      args = [
        "pr",
        "list",
        "--head",
        repo.branch || "",
        "--state",
        "all",
        "--json",
        "url,state,number,title",
        "--limit",
        "1"
      ]

      case runner.("gh", args, cd: repo.path, stderr_to_stdout: true) do
        {output, 0} -> decode_pr_list(output)
        {output, status} -> {:error, {status, String.trim(output)}}
      end
    end
  end

  defp repo_violations(%RepoState{dirty?: true} = repo, _pr_checker) do
    [%{repo: repo.name, kind: :uncommitted_changes, detail: "working tree has uncommitted changes"}]
  end

  defp repo_violations(%RepoState{ahead_count: 0}, _pr_checker), do: []

  defp repo_violations(%RepoState{upstream?: false} = repo, _pr_checker) do
    [
      %{
        repo: repo.name,
        kind: :unpublished_branch,
        detail: "branch #{repo.branch} has #{repo.ahead_count} commit(s) without an upstream"
      }
    ]
  end

  defp repo_violations(%RepoState{} = repo, pr_checker) do
    case pr_checker.(repo) do
      {:ok, %{url: url}} when is_binary(url) ->
        []

      :none ->
        [
          %{
            repo: repo.name,
            kind: :missing_pull_request,
            detail: "branch #{repo.branch} is pushed but has no pull request"
          }
        ]

      {:error, reason} ->
        [
          %{
            repo: repo.name,
            kind: :pr_check_failed,
            detail: "could not verify pull request: #{inspect(reason)}"
          }
        ]
    end
  end

  defp decode_pr_list(output) do
    case Jason.decode(String.trim(output)) do
      {:ok, [%{"url" => url, "state" => state} = pr | _rest]} when state != "CLOSED" ->
        {:ok, %{url: url, state: state, number: pr["number"], title: pr["title"]}}

      {:ok, _closed_or_empty} ->
        :none

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp published_repo?(repo) do
    repo.upstream? and (repo.ahead_count > 0 or feature_branch?(repo))
  end

  defp feature_branch?(%RepoState{branch: branch, default_branch: default}) do
    is_binary(branch) and branch != "" and branch != default
  end

  defp feature_branch?(_repo), do: false

  defp yes_no(true), do: "yes"
  defp yes_no(false), do: "no"

  defp repo_dirs(workspace) do
    cond do
      git_worktree_root?(workspace) ->
        [workspace]

      File.dir?(workspace) ->
        workspace
        |> File.ls!()
        |> Enum.sort()
        |> Enum.map(&Path.join(workspace, &1))
        |> Enum.filter(&File.dir?/1)
        |> Enum.filter(&git_worktree_root?/1)

      true ->
        []
    end
  end

  # A directory is a repo root only when git resolves its own top level back to
  # that same directory. This deliberately ignores an orphan or partial `.git`
  # at the workspace root (git fails, or resolves to an ancestor) so the genuine
  # sub-repos are still discovered instead of being masked by a bogus root entry.
  defp git_worktree_root?(dir) do
    case git(dir, ["rev-parse", "--show-toplevel"]) do
      {:ok, toplevel} -> toplevel != "" and Path.expand(toplevel) == Path.expand(dir)
      {:error, _reason} -> false
    end
  end

  defp inspect_repo(path) do
    branch = git_value(path, ["branch", "--show-current"])
    default_branch = default_branch(path)
    branch = presence(branch)
    upstream? = tracking_upstream?(path) or remote_contains_head?(path, branch)

    %RepoState{
      path: path,
      name: Path.basename(path),
      branch: branch,
      default_branch: default_branch,
      dirty?: git_value(path, ["status", "--porcelain"]) != "",
      upstream?: upstream?,
      ahead_count: ahead_count(path, branch, default_branch, upstream?)
    }
  end

  defp tracking_upstream?(path) do
    match?({:ok, _}, git(path, ["rev-parse", "--abbrev-ref", "@{upstream}"]))
  end

  # Branches pushed without local upstream tracking (or after a mechanical publish)
  # still count as published when origin has the same commit at refs/heads/<branch>.
  defp remote_contains_head?(path, branch) when is_binary(branch) and branch != "" do
    with {:ok, head} <- git(path, ["rev-parse", "HEAD"]),
         {:ok, output} <- git(path, ["ls-remote", "--heads", "origin", branch]),
         true <- output != "" do
      output
      |> String.split()
      |> Enum.any?(fn sha -> sha == head end)
    else
      _ -> false
    end
  end

  defp remote_contains_head?(_path, _branch), do: false

  defp ahead_count(path, branch, default_branch, upstream?) do
    cond do
      upstream? and tracking_upstream?(path) ->
        count(path, ["rev-list", "--count", "@{upstream}..HEAD"])

      upstream? and is_binary(branch) and branch != "" ->
        count(path, ["rev-list", "--count", "origin/#{branch}..HEAD"])

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
