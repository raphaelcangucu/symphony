defmodule SymphonyElixir.PullRequestMonitor do
  @moduledoc """
  PR follow-up monitor core: detects PR events for wait-state issues, asks the
  classifier for a verdict, and applies the resulting transition/comment.
  See docs/superpowers/specs/2026-06-10-pr-monitor-design.md.
  """

  alias SymphonyElixir.GitHub.PullRequests
  alias SymphonyElixir.LocalTracker.{Context, Project}
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.PushNotifications.Dispatcher, as: PushDispatcher
  alias SymphonyElixir.PullRequestFix
  alias SymphonyElixir.PullRequestMonitor.{Classifier, Events, MonitorState}
  alias SymphonyElixir.Tracker
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.Tracker.Sync.LocalStore
  alias SymphonyElixir.Workpad.PullRequestBlock

  require Logger

  @rework_state "Rework"
  @done_state "Done"

  @type action :: :move_done | :move_rework | {:stay, :limit_reached | :unrelated | :needs_human}

  @spec decide(:merged | :ci_failure | :review_findings, String.t() | nil, non_neg_integer(), pos_integer()) ::
          action()
  def decide(:merged, _verdict, _count, _max), do: :move_done
  def decide(:ci_failure, "pr_caused", count, max) when count < max, do: :move_rework
  def decide(:ci_failure, "pr_caused", _count, _max), do: {:stay, :limit_reached}
  def decide(:ci_failure, "unrelated", _count, _max), do: {:stay, :unrelated}
  def decide(:ci_failure, _verdict, _count, _max), do: {:stay, :needs_human}
  def decide(:review_findings, "fixable_by_agent", count, max) when count < max, do: :move_rework
  def decide(:review_findings, "fixable_by_agent", _count, _max), do: {:stay, :limit_reached}
  def decide(:review_findings, _verdict, _count, _max), do: {:stay, :needs_human}

  @spec process_issue(Project.t(), map(), keyword()) :: :ok
  def process_issue(%Project{} = project, issue, opts \\ []) do
    identifier = Map.get(issue, :identifier) || Map.get(issue, "identifier")
    config = Keyword.get_lazy(opts, :config, fn -> ProjectConfig.resolve(project) end)
    reader = Keyword.get(opts, :pull_request_reader, &default_pull_request_reader/3)

    with true <- is_binary(identifier) and identifier != "",
         true <- ProjectConfig.pr_monitor_enabled?(config),
         {:ok, repo} <- PullRequests.resolve_repo(project),
         {:ok, prs} <- reader.(project, identifier, opts) do
      Logger.info("PR monitor evaluated issue_identifier=#{identifier} project_slug=#{project.slug} prs=#{length(prs)}")

      reconcile_task_pull_requests(project, identifier, prs, opts)
      pr_opts = Keyword.put(opts, :all_prs, prs)
      Enum.each(prs, &process_pr(project, config, repo, identifier, &1, pr_opts))
    else
      false ->
        :ok

      {:error, reason} ->
        Logger.debug("PR monitor skipped issue=#{inspect(identifier)} reason=#{inspect(reason)}")
    end

    :ok
  end

  defp default_pull_request_reader(project, identifier, _opts) do
    PullRequests.for_project_issue(project, identifier)
  end

  # Persist detected PRs onto the task: upsert the local cache (incl. head_branch)
  # and merge the machine-readable block into the issue's workpad. Idempotent and
  # best-effort — failures here must never block the monitor's transition logic.
  defp reconcile_task_pull_requests(project, identifier, prs, opts) do
    records =
      prs
      |> Enum.filter(&is_binary(pr_field(&1, :url)))
      |> Enum.map(fn pr ->
        %{
          remote_id: pr_field(pr, :url),
          url: pr_field(pr, :url),
          number: pr_field(pr, :number),
          title: pr_field(pr, :title),
          state: pr_field(pr, :state) || "unknown",
          repo: pr_field(pr, :repo),
          head_branch: pr_field(pr, :head_ref),
          origin: "auto"
        }
      end)

    if records != [] do
      LocalStore.upsert_discovered_pull_requests(project.id, identifier, records)
      reconcile_workpad_block(project, identifier, records, opts)
    end

    :ok
  rescue
    error ->
      Logger.warning("PR monitor reconcile failed issue=#{identifier} reason=#{inspect(error)}")
      :ok
  end

  defp reconcile_workpad_block(project, identifier, records, opts) do
    upsert_fun = Keyword.get(opts, :workpad_upsert, &Tracker.upsert_workpad/2)

    current =
      case Context.latest_workpad(project.slug, identifier) do
        {:ok, %{body: body}} when is_binary(body) -> body
        _ -> nil
      end

    refs =
      Enum.map(records, fn record ->
        %{repo: record.repo, number: record.number, branch: record.head_branch, url: record.url}
      end)

    new_body = PullRequestBlock.upsert_block(current, refs)

    if new_body != current do
      case Context.get_issue(project.slug, identifier) do
        {:ok, issue} -> upsert_fun.(to_string(issue.id), new_body)
        _ -> :ok
      end
    end

    :ok
  end

  defp process_pr(project, config, repo, identifier, pr, opts) do
    pr_url = pr_field(pr, :url)

    if is_binary(pr_url) do
      row = MonitorState.get(project.slug, identifier, pr_url)
      event = Events.detect(pr, row)

      record_evaluation(project.slug, identifier, pr_url, event)
      maybe_clear_merge_conflict_state(project, identifier, pr, row)

      case event do
        :none -> :ok
        event -> handle_event(event, project, config, repo, identifier, pr, opts)
      end
    end
  end

  # Persist that this issue+PR was evaluated this tick, including no-op results,
  # so "why didn't the monitor act?" is answerable from data (and the panel)
  # instead of only from debug logs.
  defp record_evaluation(project_slug, identifier, pr_url, event) do
    MonitorState.upsert(project_slug, identifier, pr_url, %{
      last_checked_at: DateTime.utc_now(),
      last_event: event_label(event)
    })

    :ok
  end

  defp event_label(:none), do: "none"
  defp event_label(:merged), do: "merged"
  defp event_label({:merge_conflict, _head_sha}), do: "merge_conflict"
  defp event_label({:ci_failure, _fingerprint}), do: "ci_failure"
  defp event_label({:review_findings, _marker}), do: "review_findings"

  defp maybe_clear_merge_conflict_state(project, identifier, pr, row) do
    pr_url = pr_field(pr, :url)

    if is_binary(pr_url) and match?(%MonitorState{last_merge_conflict_head_sha: sha} when is_binary(sha), row) and
         not Events.merge_conflicting?(pr) do
      MonitorState.upsert(project.slug, identifier, pr_url, %{last_merge_conflict_head_sha: nil})
    end

    :ok
  end

  defp handle_event(:merged, project, config, _repo, identifier, pr, opts) do
    if ProjectConfig.pr_monitor_done_on_merge?(config) do
      all_prs = Keyword.get(opts, :all_prs, [pr])

      if PullRequests.all_merged?(all_prs) do
        apply_transition(
          project,
          config,
          identifier,
          pr,
          :move_done,
          merged_comment(pr),
          %{},
          0,
          %{},
          opts
        )
      else
        acknowledge_merged_awaiting_others(project, identifier, pr)
      end
    end
  end

  defp handle_event({:merge_conflict, head_sha}, project, _config, _repo, identifier, pr, _opts) do
    pr_url = pr_field(pr, :url)
    number = pr_field(pr, :number)

    PushDispatcher.pr_monitor_attention(project, identifier, {:stay, :merge_conflict})

    {:ok, _row} =
      MonitorState.upsert(project.slug, identifier, pr_url, %{
        last_merge_conflict_head_sha: head_sha,
        last_action: "merge_conflict_notified",
        last_action_at: DateTime.utc_now()
      })

    Logger.info("PR monitor merge conflict issue_identifier=#{identifier} project_slug=#{project.slug} pr_number=#{inspect(number)} head_sha=#{head_sha}")

    :ok
  end

  defp handle_event({:ci_failure, fingerprint}, project, config, repo, identifier, pr, opts) do
    consume = %{last_head_sha: pr_field(pr, :head_sha), last_checks_fingerprint: fingerprint}
    {:ok, _row} = MonitorState.upsert(project.slug, identifier, pr_field(pr, :url), consume)

    classifier = Keyword.get(opts, :classifier, &Classifier.classify/3)
    context = ci_context(repo, project, identifier, pr, opts)
    {:ok, verdict} = classifier.(:ci_failure, context, opts)

    run_decision(
      :ci_failure,
      verdict,
      %{last_checks_fingerprint: nil},
      project,
      config,
      repo,
      identifier,
      pr,
      opts
    )
  end

  defp handle_event({:review_findings, marker}, project, config, repo, identifier, pr, opts) do
    {:ok, _row} =
      MonitorState.upsert(project.slug, identifier, pr_field(pr, :url), %{last_review_marker: marker})

    classifier = Keyword.get(opts, :classifier, &Classifier.classify/3)
    review = latest_review_entry(pr, marker)
    context = review_context(repo, project, identifier, pr, review, opts)
    {:ok, verdict} = classifier.(:review_findings, context, opts)

    run_decision(
      {:review_findings, review},
      verdict,
      %{last_review_marker: nil},
      project,
      config,
      repo,
      identifier,
      pr,
      opts
    )
  end

  defp acknowledge_merged_awaiting_others(project, identifier, pr) do
    pr_url = pr_field(pr, :url)

    case MonitorState.get(project.slug, identifier, pr_url) do
      %{last_action: "merged_awaiting_others"} ->
        :ok

      _ ->
        Logger.info("PR monitor partial merge issue_identifier=#{identifier} project_slug=#{project.slug} pr_url=#{inspect(pr_url)} awaiting_other_prs=true")

        MonitorState.upsert(project.slug, identifier, pr_url, %{
          last_action: "merged_awaiting_others",
          last_action_at: DateTime.utc_now()
        })

        :ok
    end
  end

  defp run_decision(event, verdict, rollback_attrs, project, config, repo, identifier, pr, opts) do
    kind = event_kind(event)
    count = MonitorState.max_rework_count(project.slug, identifier)
    max = ProjectConfig.pr_monitor_max_auto_rework(config)
    action = decide(kind, verdict_value(verdict, "verdict"), count, max)
    comment = comment_for(action, event, verdict, repo, pr, count, max, opts)

    apply_transition(
      project,
      config,
      identifier,
      pr,
      action,
      comment,
      %{"verdict" => verdict_value(verdict, "verdict"), "summary" => verdict_value(verdict, "summary")},
      count,
      rollback_attrs,
      opts
    )
  end

  defp event_kind({:review_findings, _review}), do: :review_findings
  defp event_kind(kind) when is_atom(kind), do: kind

  defp apply_transition(project, config, identifier, pr, action, comment, classification, count, rollback_attrs, opts) do
    dispatch = Keyword.get(opts, :issue_dispatch, &IssueAdapter.dispatch/3)
    pr_url = pr_field(pr, :url)

    # Residual race accepted for v1: issue can leave wait state after this check
    # and before dispatch; we still gate to reduce unintended transitions.
    if issue_still_waiting?(project, identifier, config) do
      case normalize_dispatch_result(dispatch.(project, :add_comment, [identifier, comment, %{}])) do
        {:ok, _comment} ->
          persist_action_after_comment(
            project,
            identifier,
            pr_url,
            action,
            classification,
            count,
            dispatch,
            rollback_attrs,
            opts
          )

        {:error, reason} ->
          Logger.warning("PR monitor comment dispatch failed issue=#{identifier} pr_url=#{inspect(pr_url)} reason=#{inspect(reason)}")

          rollback_consumption(project, identifier, pr_url, rollback_attrs, reason)
      end
    else
      Logger.debug("PR monitor action discarded issue=#{identifier} reason=:left_wait_state")
      :ok
    end
  end

  defp persist_action_after_comment(
         project,
         identifier,
         pr_url,
         action,
         classification,
         count,
         dispatch,
         rollback_attrs,
         _opts
       ) do
    with {:ok, {last_action, extra}} <-
           apply_action_transition(project, identifier, action, count, dispatch),
         attrs <-
           Map.merge(extra, %{
             last_action: last_action,
             last_classification: classification,
             last_action_at: DateTime.utc_now()
           }),
         {:ok, _row} <- MonitorState.upsert(project.slug, identifier, pr_url, attrs) do
      PushDispatcher.pr_monitor_attention(project, identifier, action)
      :ok
    else
      {:error, reason} ->
        rollback_consumption(project, identifier, pr_url, rollback_attrs, reason)
    end
  end

  defp apply_action_transition(project, identifier, :move_done, _count, dispatch) do
    case normalize_dispatch_result(dispatch.(project, :move_issue, [identifier, %{"status" => @done_state}])) do
      {:ok, _issue} ->
        Logger.info("PR monitor moved issue_identifier=#{identifier} project_slug=#{project.slug} to=#{@done_state}")
        {:ok, {"moved_to_done", %{}}}

      {:error, reason} ->
        Logger.warning("PR monitor move to Done failed after comment issue=#{identifier} reason=#{inspect(reason)} retry_may_duplicate_comment=true")

        {:error, {:move_failed, reason}}
    end
  end

  defp apply_action_transition(project, identifier, :move_rework, count, dispatch) do
    case normalize_dispatch_result(dispatch.(project, :move_issue, [identifier, %{"status" => @rework_state}])) do
      {:ok, _issue} ->
        Logger.info("PR monitor moved issue_identifier=#{identifier} project_slug=#{project.slug} to=#{@rework_state} attempt=#{count + 1}")

        {:ok, {"moved_to_rework", %{auto_rework_count: count + 1}}}

      {:error, reason} ->
        Logger.warning("PR monitor move to Rework failed after comment issue=#{identifier} reason=#{inspect(reason)} retry_may_duplicate_comment=true")

        {:error, {:move_failed, reason}}
    end
  end

  defp apply_action_transition(_project, _identifier, {:stay, :limit_reached}, _count, _dispatch),
    do: {:ok, {"limit_reached", %{}}}

  defp apply_action_transition(_project, _identifier, {:stay, _reason}, _count, _dispatch),
    do: {:ok, {"kept_human_review", %{}}}

  defp normalize_dispatch_result({:ok, _} = ok), do: ok
  defp normalize_dispatch_result({:error, _} = error), do: error
  defp normalize_dispatch_result(other), do: {:error, {:unexpected_dispatch_result, other}}

  defp rollback_consumption(_project, _identifier, _pr_url, rollback_attrs, _reason)
       when map_size(rollback_attrs) == 0 do
    :ok
  end

  defp rollback_consumption(project, identifier, pr_url, rollback_attrs, reason) do
    Logger.warning("PR monitor rolling back consumed event issue=#{identifier} pr_url=#{inspect(pr_url)} reason=#{inspect(reason)}")

    case MonitorState.upsert(project.slug, identifier, pr_url, rollback_attrs) do
      {:ok, _row} ->
        :ok

      {:error, rollback_reason} ->
        Logger.warning("PR monitor failed to rollback consumed event issue=#{identifier} pr_url=#{inspect(pr_url)} reason=#{inspect(rollback_reason)}")

        :ok
    end
  end

  defp issue_still_waiting?(project, identifier, config) do
    case Context.get_issue(project.slug, identifier) do
      {:ok, issue} -> issue_state_name(issue) in (config.wait_states || [])
      _ -> false
    end
  end

  defp issue_state_name(%{status: %{name: name}}) when is_binary(name), do: name
  defp issue_state_name(%{"status" => %{"name" => name}}) when is_binary(name), do: name
  defp issue_state_name(%{state: state}) when is_binary(state) and state != "", do: state
  defp issue_state_name(%{"state" => state}) when is_binary(state) and state != "", do: state
  defp issue_state_name(_), do: nil

  defp merged_comment(pr) do
    "## PR merged — issue completed\n\n" <>
      "PR ##{pr_field(pr, :number)} (#{pr_field(pr, :url)}) was merged. " <>
      "Symphony moved this issue to Done."
  end

  defp comment_for(:move_done, _event, _verdict, _repo, pr, _count, _max, _opts), do: merged_comment(pr)

  defp comment_for(:move_rework, :ci_failure, verdict, repo, pr, count, max, opts) do
    check_logs = Keyword.get(opts, :check_logs)
    fix_opts = if is_function(check_logs, 2), do: [check_logs: check_logs], else: []
    entries = PullRequestFix.failing_entries(repo, [pr], fix_opts)

    header =
      "## CI failure — automated fix requested (attempt #{count + 1}/#{max})\n\n" <>
        "Symphony's PR monitor attributed this failure to the PR's changes: #{verdict_value(verdict, "summary")}\n\n"

    PullRequestFix.build_comment(entries, header: header)
  end

  defp comment_for(:move_rework, {:review_findings, review}, verdict, _repo, pr, count, max, _opts) do
    """
    ## Review feedback — automated fix requested (attempt #{count + 1}/#{max})

    Symphony's PR monitor judged the review findings on PR ##{pr_field(pr, :number)} (#{pr_field(pr, :url)}) as fixable by the agent: #{verdict_value(verdict, "summary")}

    > #{String.replace(review[:body] || "", "\n", "\n> ")}
    """
  end

  defp comment_for({:stay, :limit_reached}, _event, verdict, _repo, pr, _count, max, _opts) do
    """
    ## Automatic fix limit reached

    PR ##{pr_field(pr, :number)} (#{pr_field(pr, :url)}) still has actionable findings (#{verdict_value(verdict, "summary")}), but the automatic Rework limit (#{max}) was reached. A human needs to review this issue.
    """
  end

  defp comment_for({:stay, :unrelated}, _event, verdict, _repo, pr, _count, _max, _opts) do
    """
    ## CI failure — likely unrelated to this PR

    #{verdict_value(verdict, "summary")}

    Symphony kept this issue in review. Consider re-running the failed jobs from the PR tab (PR ##{pr_field(pr, :number)}: #{pr_field(pr, :url)}).
    """
  end

  defp comment_for({:stay, :needs_human}, _event, verdict, _repo, pr, _count, _max, _opts) do
    """
    ## PR feedback — needs human attention

    #{verdict_value(verdict, "summary")}

    PR ##{pr_field(pr, :number)}: #{pr_field(pr, :url)}
    """
  end

  defp ci_context(repo, project, identifier, pr, opts) do
    check_logs =
      Keyword.get(opts, :check_logs, fn r, id ->
        SymphonyElixir.GitHub.CheckLogs.failing_job_excerpt(r, id)
      end)

    failing_jobs =
      pr
      |> Events.failing_jobs()
      |> Enum.take(3)
      |> Enum.map(fn job ->
        excerpt =
          case job[:job_id] do
            id when is_integer(id) ->
              case check_logs.(repo, id) do
                {:ok, text} -> text
                _ -> nil
              end

            _ ->
              nil
          end

        %{name: job[:name], excerpt: excerpt}
      end)

    %{issue: issue_summary(project, identifier), pr: pr_summary(repo, pr, opts), failing_jobs: failing_jobs}
  end

  defp review_context(repo, project, identifier, pr, review, opts) do
    %{issue: issue_summary(project, identifier), pr: pr_summary(repo, pr, opts), review: review}
  end

  defp latest_review_entry(pr, marker) do
    pr
    |> pr_field(:conversation)
    |> List.wrap()
    |> Enum.find(%{}, &(Map.get(&1, :created_at) == marker))
    |> Map.take([:author, :body, :review_state])
    |> Map.new(fn {k, v} -> {if(k == :review_state, do: :state, else: k), v} end)
  end

  defp pr_summary(repo, pr, opts) do
    changed_files_fun = Keyword.get(opts, :changed_files, &default_changed_files/2)
    pr_repo = pr_field(pr, :repo) || repo
    number = pr_field(pr, :number)

    %{
      number: number,
      title: pr_field(pr, :title),
      head_ref: pr_field(pr, :head_ref),
      base_ref: pr_field(pr, :base_ref),
      changed_files: changed_files_fun.(pr_repo, number)
    }
  end

  defp default_changed_files(repo, number) do
    path = "/repos/#{repo}/pulls/#{number}/files?per_page=50"

    case SymphonyElixir.GitHub.Client.rest_get(path, []) do
      {:ok, %{body: files}} when is_list(files) ->
        files
        |> Enum.map(&Map.get(&1, "filename"))
        |> Enum.reject(&is_nil/1)

      _ ->
        []
    end
  end

  defp issue_summary(project, identifier) do
    case Context.get_issue(project.slug, identifier) do
      {:ok, issue} ->
        %{identifier: identifier, title: Map.get(issue, :title), description: Map.get(issue, :description)}

      _ ->
        %{identifier: identifier, title: nil, description: nil}
    end
  end

  defp pr_field(pr, key) when is_map(pr), do: Map.get(pr, key) || Map.get(pr, Atom.to_string(key))
  defp pr_field(_pr, _key), do: nil

  defp verdict_value(verdict, key) when is_map(verdict) do
    Map.get(verdict, key) || Map.get(verdict, String.to_atom(key))
  rescue
    ArgumentError -> nil
  end

  defp verdict_value(_verdict, _key), do: nil
end
