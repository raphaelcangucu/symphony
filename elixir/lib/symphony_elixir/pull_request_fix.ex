defmodule SymphonyElixir.PullRequestFix do
  @moduledoc """
  Requests an agent fix for a PR with failing checks: posts an issue comment with
  the failing-job log tails and moves the issue to `Rework` so the orchestrator
  re-dispatches the agent with that failure context.

  GitHub-backed projects only (PR linkage is GitHub-only).
  """

  alias SymphonyElixir.GitHub.{CheckLogs, PullRequests}
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueAdapter

  @rework_state "Rework"
  @max_jobs 3
  @failure_conclusions ~w(FAILURE TIMED_OUT CANCELLED STARTUP_FAILURE ACTION_REQUIRED)

  @spec request_fix(Project.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def request_fix(%Project{} = project, identifier) when is_binary(identifier) do
    with {:ok, repo} <- PullRequests.resolve_repo(project),
         {:ok, prs} <- PullRequests.for_issue(repo, identifier),
         failing = collect_failing(prs),
         :ok <- ensure_present(failing),
         enriched = enrich_with_logs(repo, failing),
         body = build_comment(enriched),
         {:ok, comment} <- IssueAdapter.dispatch(project, :add_comment, [identifier, body, %{}]),
         {:ok, _issue} <-
           IssueAdapter.dispatch(project, :move_issue, [identifier, %{"status" => @rework_state}]) do
      {:ok, %{comment: comment, status: @rework_state, jobs: Enum.map(enriched, & &1.job)}}
    end
  end

  @spec build_comment([map()]) :: String.t()
  def build_comment(entries) when is_list(entries) do
    prs = entries |> Enum.map(& &1.pr) |> Enum.uniq_by(& &1.number)

    sections =
      Enum.map(prs, fn pr ->
        pr_entries = Enum.filter(entries, &(&1.pr.number == pr.number))
        pr_section(pr, pr_entries)
      end)

    header() <> Enum.join(sections, "\n")
  end

  defp ensure_present([]), do: {:error, :no_failing_checks}
  defp ensure_present([_ | _]), do: :ok

  defp collect_failing(prs) do
    prs
    |> Enum.flat_map(&failing_entries_for_pr/1)
    |> Enum.take(@max_jobs)
  end

  defp failing_entries_for_pr(pr) do
    pr
    |> Map.get(:pipelines, [])
    |> Enum.flat_map(&failing_entries_for_pipeline(pr, &1))
  end

  defp failing_entries_for_pipeline(pr, pipeline) do
    pipeline
    |> Map.get(:jobs, [])
    |> Enum.filter(&failing_job?/1)
    |> Enum.map(fn job -> %{pr: pr, pipeline: pipeline, job: job} end)
  end

  defp failing_job?(%{conclusion: conclusion}) when is_binary(conclusion),
    do: String.upcase(conclusion) in @failure_conclusions

  defp failing_job?(_job), do: false

  defp enrich_with_logs(repo, failing) do
    Enum.map(failing, fn entry ->
      Map.put(entry, :excerpt, fetch_excerpt(repo, entry.job))
    end)
  end

  defp fetch_excerpt(repo, %{job_id: id}) when is_integer(id) and id > 0 do
    case CheckLogs.failing_job_excerpt(repo, id) do
      {:ok, text} -> text
      {:error, _reason} -> nil
    end
  end

  defp fetch_excerpt(_repo, _job), do: nil

  defp header do
    "## CI failure — automated fix requested\n\n" <>
      "Symphony detected failing checks on the linked pull request(s). " <>
      "Please reproduce, fix the failing tests, and revalidate.\n\n"
  end

  defp pr_section(pr, entries) do
    title = pr.title || "(untitled)"

    head = "### PR ##{pr.number} — #{title}\n#{pr.url}\n\n**Failing checks:**\n"

    head <> Enum.map_join(entries, "\n", &job_block/1)
  end

  defp job_block(%{job: job, excerpt: excerpt}) do
    name = job[:name] || "check"
    conclusion = job[:conclusion] || "FAILURE"
    url = job[:url]

    heading = "\n#### #{name} — #{conclusion}\n"
    heading = if url, do: heading <> "#{url}\n", else: heading

    case excerpt do
      text when is_binary(text) and text != "" -> heading <> "\n```log\n" <> text <> "\n```\n"
      _ -> heading <> "\n_(log unavailable)_\n"
    end
  end
end
