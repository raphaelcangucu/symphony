defmodule SymphonyElixir.RunContract.Finalizer do
  @moduledoc """
  Mechanical fallback for the publish gate: commits leftover work, publishes
  branches, and opens pull requests when the agent could not. Invoked by the
  orchestrator only after corrective turns were exhausted. Never pushes to the
  repo's default branch — work found there is moved to `symphony/<identifier>`.
  """

  require Logger
  alias SymphonyElixir.Issue
  alias SymphonyElixir.RunContract
  alias SymphonyElixir.RunContract.RepoState

  @type pr :: %{
          repo: String.t(),
          url: String.t(),
          number: integer() | nil,
          state: String.t() | nil,
          title: String.t() | nil
        }

  @spec finalize(Path.t(), Issue.t(), keyword()) :: {:ok, [pr()]} | {:error, {String.t(), term()}}
  def finalize(workspace, %Issue{} = issue, opts \\ []) do
    runner = Keyword.get(opts, :runner, &System.cmd/3)

    workspace
    |> RunContract.repo_states()
    |> Enum.filter(&(&1.dirty? or &1.ahead_count > 0))
    |> Enum.reduce_while({:ok, []}, fn repo, {:ok, acc} ->
      case finalize_repo(repo, issue, runner) do
        {:ok, pr} -> {:cont, {:ok, [pr | acc]}}
        {:error, reason} -> {:halt, {:error, {repo.name, reason}}}
      end
    end)
    |> case do
      {:ok, prs} -> {:ok, Enum.reverse(prs)}
      error -> error
    end
  end

  defp finalize_repo(%RepoState{} = repo, issue, runner) do
    Logger.warning("Finalizer publishing repo=#{repo.name} branch=#{repo.branch} issue_identifier=#{issue.identifier}")

    with :ok <- maybe_commit_dirty(repo, issue, runner),
         :ok <- maybe_branch_off_default(repo, issue, runner),
         :ok <- push(repo, runner),
         {:ok, pr} <- ensure_pull_request(repo, issue, runner) do
      {:ok, Map.put(pr, :repo, repo.name)}
    end
  end

  defp maybe_commit_dirty(%RepoState{dirty?: false}, _issue, _runner), do: :ok

  defp maybe_commit_dirty(%RepoState{path: path}, issue, runner) do
    with :ok <- run(runner, "git", ["add", "-A"], path) do
      run(runner, "git", ["commit", "-m", "chore(#{issue.identifier}): commit remaining work from agent run"], path)
    end
  end

  defp maybe_branch_off_default(%RepoState{branch: branch, default_branch: default} = repo, issue, runner)
       when is_binary(branch) and branch == default do
    run(runner, "git", ["checkout", "-b", "symphony/#{String.downcase(issue.identifier)}"], repo.path)
  end

  defp maybe_branch_off_default(_repo, _issue, _runner), do: :ok

  defp push(%RepoState{path: path}, runner) do
    run(runner, "git", ["push", "-u", "origin", "HEAD"], path)
  end

  defp ensure_pull_request(%RepoState{path: path} = repo, issue, runner) do
    checker = RunContract.gh_pr_checker(runner: runner)

    case checker.(current_branch_state(repo, runner)) do
      {:ok, pr} ->
        {:ok, pr}

      :none ->
        create_pull_request(path, repo, issue, runner)

      {:error, reason} ->
        {:error, {:pr_check_failed, reason}}
    end
  end

  defp create_pull_request(path, repo, issue, runner) do
    body_file = Path.join(System.tmp_dir!(), "symphony-pr-body-#{System.unique_integer([:positive])}.md")
    File.write!(body_file, pr_body(issue))

    base_args = if is_binary(repo.default_branch), do: ["--base", repo.default_branch], else: []

    try do
      with :ok <- run(runner, "gh", ["pr", "create", "--title", pr_title(issue), "--body-file", body_file] ++ base_args, path) do
        view_pull_request(path, runner)
      end
    after
      File.rm(body_file)
    end
  end

  defp view_pull_request(path, runner) do
    case runner.("gh", ["pr", "view", "--json", "url,number,state,title"], cd: path, stderr_to_stdout: true) do
      {output, 0} ->
        case Jason.decode(String.trim(output)) do
          {:ok, %{"url" => url} = pr} -> {:ok, %{url: url, number: pr["number"], state: pr["state"], title: pr["title"]}}
          {:error, reason} -> {:error, {:pr_view_decode_failed, reason}}
        end

      {output, status} ->
        {:error, {:pr_view_failed, status, String.trim(output)}}
    end
  end

  # Re-read branch name after a possible checkout -b so the PR lookup targets
  # the branch actually being pushed.
  defp current_branch_state(%RepoState{path: path} = repo, runner) do
    case runner.("git", ["branch", "--show-current"], cd: path, stderr_to_stdout: true) do
      {output, 0} -> %{repo | branch: String.trim(output)}
      _failure -> repo
    end
  end

  defp pr_title(%Issue{identifier: identifier, title: title}), do: "#{identifier}: #{title}"

  defp pr_body(%Issue{} = issue) do
    description =
      case Map.get(issue, :description) do
        text when is_binary(text) and text != "" -> String.slice(text, 0, 4_000)
        _missing -> "(no issue description)"
      end

    """
    ## Summary

    Automated publish for **#{issue.identifier}: #{issue.title}**.

    #{description}

    > ⚠️ Symphony run-contract finalizer: the agent completed work in this
    > workspace but did not publish it. Symphony pushed the branch and opened
    > this PR mechanically. Review with extra care.
    """
  end

  defp run(runner, cmd, args, path) do
    case runner.(cmd, args, cd: path, stderr_to_stdout: true) do
      {_output, 0} -> :ok
      {output, status} -> {:error, {cmd, args, status, String.trim(output)}}
    end
  end
end
