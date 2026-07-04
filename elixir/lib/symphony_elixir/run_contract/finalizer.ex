defmodule SymphonyElixir.RunContract.Finalizer do
  @moduledoc """
  Mechanical fallback for the publish gate: commits leftover work, publishes
  branches, and opens pull requests when the agent could not. Invoked by the
  orchestrator only after corrective turns were exhausted. Never pushes to the
  repo's default branch — work found there is moved to `symphony/<identifier>`.
  """

  require Logger
  alias SymphonyElixir.GitHub.IssueMarker
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.RunContract
  alias SymphonyElixir.RunContract.RepoState

  @type pr :: %{
          repo: String.t(),
          url: String.t(),
          number: integer() | nil,
          state: String.t() | nil,
          title: String.t() | nil
        }

  @spec finalize(Path.t(), Issue.t(), keyword()) ::
          {:ok, [pr()]} | {:partial, [pr()], [{String.t(), term()}]}
  def finalize(workspace, %Issue{} = issue, opts \\ []) do
    runner = Keyword.get(opts, :runner, &System.cmd/3)

    default_branches = Keyword.get(opts, :default_branches, %{})
    pr_base = Keyword.get(opts, :pr_base)

    {prs, failures} =
      workspace
      |> RunContract.repo_states(default_branches: default_branches)
      |> Enum.filter(&(&1.dirty? or &1.ahead_count > 0))
      |> Enum.map(fn repo ->
        case finalize_repo(repo, issue, runner, pr_base) do
          {:ok, pr} -> {:ok, pr}
          {:error, reason} -> {:error, {repo.name, reason}}
        end
      end)
      |> Enum.reduce({[], []}, fn
        {:ok, pr}, {prs, failures} -> {[pr | prs], failures}
        {:error, failure}, {prs, failures} -> {prs, [failure | failures]}
      end)

    prs = Enum.reverse(prs)
    failures = Enum.reverse(failures)

    case failures do
      [] -> {:ok, prs}
      _ -> {:partial, prs, failures}
    end
  end

  defp finalize_repo(%RepoState{} = repo, issue, runner, pr_base) do
    Logger.warning("Finalizer publishing repo=#{repo.name} branch=#{repo.branch} base=#{inspect(pr_base || repo.default_branch)} issue_identifier=#{issue.identifier}")

    with :ok <- maybe_commit_dirty(repo, issue, runner),
         :ok <- maybe_branch_off_default(repo, issue, runner),
         :ok <- push(repo, issue, runner),
         {:ok, pr} <- ensure_pull_request(repo, issue, runner, pr_base) do
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

  defp push(%RepoState{} = repo, issue, runner) do
    path = repo.path
    branch = repo.branch || current_branch(repo, runner)
    push_ref = if is_binary(branch) and branch != "", do: branch, else: "HEAD"

    with :ok <- run(runner, "git", ["fetch", "origin"], path),
         :ok <- run(runner, "git", ["push", "-u", "origin", push_ref], path) do
      :ok
    else
      {:error, {"git", ["push" | _], _status, output}} when is_binary(output) ->
        if push_rejected?(output) do
          recover_push_after_rejection(repo, issue, runner)
        else
          {:error, {:push_failed, output}}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp push_rejected?(output) do
    String.contains?(output, ["rejected", "fetch first", "non-fast-forward"])
  end

  # credo:disable-for-lines:25
  defp recover_push_after_rejection(%RepoState{} = repo, issue, runner) do
    path = repo.path
    branch = current_branch(repo, runner)

    case branch do
      branch when is_binary(branch) and branch != "" ->
        case run(runner, "git", ["pull", "--rebase", "origin", branch], path) do
          :ok ->
            case run(runner, "git", ["push", "-u", "origin", "HEAD"], path) do
              :ok -> :ok
              {:error, reason} -> push_fallback_branch(repo, issue, runner, reason)
            end

          {:error, _rebase_failed} ->
            push_fallback_branch(repo, issue, runner, :rebase_failed)
        end

      _ ->
        push_fallback_branch(repo, issue, runner, :missing_branch)
    end
  end

  defp push_fallback_branch(%RepoState{path: path}, issue, runner, prior_reason) do
    fallback = "symphony/#{String.downcase(issue.identifier)}"

    with :ok <- checkout_branch(path, fallback, runner),
         :ok <- run(runner, "git", ["push", "-u", "origin", "HEAD"], path) do
      :ok
    else
      {:error, reason} -> {:error, {:push_failed, prior_reason, reason}}
    end
  end

  defp checkout_branch(path, branch, runner) do
    case run(runner, "git", ["checkout", branch], path) do
      :ok ->
        :ok

      {:error, _} ->
        run(runner, "git", ["checkout", "-B", branch], path)
    end
  end

  defp current_branch(%RepoState{path: path}, runner) do
    case runner.("git", ["branch", "--show-current"], cd: path, stderr_to_stdout: true) do
      {output, 0} -> String.trim(output)
      _failure -> nil
    end
  end

  defp ensure_pull_request(%RepoState{path: path} = repo, issue, runner, pr_base) do
    checker = RunContract.gh_pr_checker(runner: runner)

    case checker.(current_branch_state(repo, runner)) do
      {:ok, pr} ->
        {:ok, pr}

      :none ->
        create_pull_request(path, repo, issue, runner, pr_base)

      {:error, reason} ->
        {:error, {:pr_check_failed, reason}}
    end
  end

  defp create_pull_request(path, repo, issue, runner, pr_base) do
    body_file = Path.join(System.tmp_dir!(), "symphony-pr-body-#{System.unique_integer([:positive])}.md")
    File.write!(body_file, pull_request_body(issue))
    branch = current_branch(repo, runner)
    base = pr_base || repo.default_branch

    head_args = if is_binary(branch) and branch != "", do: ["--head", branch], else: []
    base_args = if is_binary(base) and base != "", do: ["--base", base], else: []

    try do
      with :ok <- maybe_publish_integration_base(path, repo, pr_base, runner),
           :ok <-
             run(
               runner,
               "gh",
               ["pr", "create", "--title", pr_title(issue), "--body-file", body_file] ++ head_args ++ base_args,
               path
             ) do
        view_pull_request(path, runner)
      end
    after
      File.rm(body_file)
    end
  end

  # A child PRs into the parent's per-repo integration branch (`pr_base`). That
  # branch is created locally by the worktree provisioner; `gh pr create --base`
  # needs it on origin, so we publish it here. Best-effort: a sibling or the
  # parent may have already pushed (and advanced) it, so a rejected push is fine.
  defp maybe_publish_integration_base(_path, _repo, nil, _runner), do: :ok

  defp maybe_publish_integration_base(_path, %RepoState{default_branch: default}, pr_base, _runner)
       when is_binary(default) and pr_base == default,
       do: :ok

  defp maybe_publish_integration_base(path, _repo, pr_base, runner) when is_binary(pr_base) do
    _ =
      runner.("git", ["push", "origin", "refs/heads/#{pr_base}:refs/heads/#{pr_base}"],
        cd: path,
        stderr_to_stdout: true
      )

    :ok
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

  @doc false
  @spec pull_request_body(Issue.t()) :: String.t()
  def pull_request_body(%Issue{} = issue) do
    description =
      case Map.get(issue, :description) do
        text when is_binary(text) and text != "" -> String.slice(text, 0, 4_000)
        _missing -> "(no issue description)"
      end

    marker =
      [issue.identifier]
      |> Enum.reject(&(is_nil(&1) or &1 == ""))
      |> Enum.uniq()
      |> Enum.map_join("\n", &IssueMarker.marker_line(&1, marker_key(issue)))

    """
    ## Summary

    Automated publish for **#{issue.identifier}: #{issue.title}**.

    #{description}

    > ⚠️ Symphony run-contract finalizer: the agent completed work in this
    > workspace but did not publish it. Symphony pushed the branch and opened
    > this PR mechanically. Review with extra care.

    #{marker}
    """
  end

  defp marker_key(%Issue{project_slug: slug}) when is_binary(slug) and slug != "" do
    case Context.get_project(slug) do
      {:ok, project} ->
        ProjectConfig.source_control_issue_marker_key(ProjectConfig.resolve(project))

      _ ->
        IssueMarker.default_key()
    end
  rescue
    _ -> IssueMarker.default_key()
  end

  defp marker_key(_issue), do: IssueMarker.default_key()

  defp run(runner, cmd, args, path) do
    case runner.(cmd, args, cd: path, stderr_to_stdout: true) do
      {_output, 0} -> :ok
      {output, status} -> {:error, {cmd, args, status, String.trim(output)}}
    end
  end
end
