defmodule SymphonyElixir.PushNotifications.Dispatcher do
  @moduledoc """
  Sends browser push notifications for operator-relevant Symphony events.

  Delivery is best-effort: missing VAPID config or subscriptions is a no-op.
  """

  alias SymphonyElixir.Evidence.Record, as: EvidenceRecord
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.IssueRecord
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.PushNotifications.{Config, Sender}
  alias SymphonyElixir.LocalTracker.Project

  require Logger

  @human_review_kind "human_review"
  @evidence_kind "evidence"
  @agent_retry_kind "agent_retry"
  @agent_incomplete_kind "agent_incomplete"
  @agent_blocked_kind "agent_blocked"
  @pr_limit_reached_kind "pr_limit_reached"
  @pr_needs_human_kind "pr_needs_human"
  @pr_ci_unrelated_kind "pr_ci_unrelated"

  @spec human_review_needed(IssueRecord.t(), String.t()) :: :ok
  def human_review_needed(%IssueRecord{} = issue, status_name) when is_binary(status_name) do
    with true <- wait_state?(issue, status_name),
         slug when is_binary(slug) <- project_slug(issue),
         identifier when is_binary(identifier) <- issue.identifier do
      title = issue.title || identifier

      notify(@human_review_kind, %{
        title: "Human review needed",
        body: "#{identifier}: #{title}",
        url: issue_url(slug, identifier),
        tag: "human_review:#{slug}:#{identifier}"
      })
    else
      _ -> :ok
    end
  end

  def human_review_needed(_issue, _status_name), do: :ok

  @spec evidence_generated(map(), EvidenceRecord.t()) :: :ok
  def evidence_generated(issue, %EvidenceRecord{} = record) do
    slug = Map.get(issue, :project_slug) || Map.get(issue, "project_slug")
    identifier = Map.get(issue, :identifier) || Map.get(issue, "identifier")

    with true <- is_binary(slug) and slug != "",
         true <- is_binary(identifier) and identifier != "" do
      runs = record.manifest["runs"] || []
      passed = Enum.count(runs, &(&1["status"] == "passed"))
      total = length(runs)
      summary = if total > 0, do: "#{passed}/#{total} runs passed", else: "Evidence recorded"

      notify(@evidence_kind, %{
        title: "Evidence generated",
        body: "#{identifier}: #{summary}",
        url: issue_url(slug, identifier, "evidence"),
        tag: "evidence:#{slug}:#{identifier}:#{record.run_id}"
      })
    else
      _ -> :ok
    end
  end

  def evidence_generated(_issue, _record), do: :ok

  @spec agent_retry_scheduled(map()) :: :ok
  def agent_retry_scheduled(%{identifier: identifier, project_slug: slug} = metadata)
      when is_binary(identifier) and is_binary(slug) and slug != "" do
    attempt = Map.get(metadata, :attempt, 1)
    error = Map.get(metadata, :error)
    error_text = retry_error_text(error)

    notify(@agent_retry_kind, %{
      title: "Agent run failed — retry scheduled",
      body: "#{identifier}: attempt #{attempt}#{error_text}",
      url: issue_url(slug, identifier),
      tag: "agent_retry:#{slug}:#{identifier}"
    })
  end

  def agent_retry_scheduled(_metadata), do: :ok

  @spec agent_run_incomplete(Issue.t(), term()) :: :ok
  def agent_run_incomplete(%Issue{identifier: identifier, project_slug: slug} = issue, reason)
      when is_binary(identifier) and is_binary(slug) and slug != "" do
    title = issue.title || identifier

    notify(@agent_incomplete_kind, %{
      title: "Agent run incomplete",
      body: "#{identifier}: #{title} (#{incomplete_reason_summary(reason)})",
      url: issue_url(slug, identifier),
      tag: "agent_incomplete:#{slug}:#{identifier}"
    })
  end

  def agent_run_incomplete(_issue, _reason), do: :ok

  @spec agent_run_blocked(Issue.t(), term()) :: :ok
  def agent_run_blocked(%Issue{identifier: identifier, project_slug: slug} = issue, violations)
      when is_binary(identifier) and is_binary(slug) and slug != "" do
    title = issue.title || identifier
    summary = blocked_summary(violations)

    notify(@agent_blocked_kind, %{
      title: "Agent run blocked",
      body: "#{identifier}: #{title} — #{summary}",
      url: issue_url(slug, identifier),
      tag: "agent_blocked:#{slug}:#{identifier}"
    })
  end

  def agent_run_blocked(_issue, _violations), do: :ok

  @spec pr_monitor_attention(Project.t(), String.t(), term()) :: :ok
  def pr_monitor_attention(%Project{slug: slug}, identifier, {:stay, :limit_reached})
      when is_binary(slug) and slug != "" and is_binary(identifier) do
    notify(@pr_limit_reached_kind, %{
      title: "Auto-fix limit reached",
      body: "#{identifier}: PR monitor stopped automatic rework",
      url: issue_url(slug, identifier, "pull-request"),
      tag: "pr_limit:#{slug}:#{identifier}"
    })
  end

  def pr_monitor_attention(%Project{slug: slug}, identifier, {:stay, :needs_human})
      when is_binary(slug) and slug != "" and is_binary(identifier) do
    notify(@pr_needs_human_kind, %{
      title: "PR feedback needs you",
      body: "#{identifier}: review findings need human attention",
      url: issue_url(slug, identifier, "pull-request"),
      tag: "pr_needs_human:#{slug}:#{identifier}"
    })
  end

  def pr_monitor_attention(%Project{slug: slug}, identifier, {:stay, :unrelated})
      when is_binary(slug) and slug != "" and is_binary(identifier) do
    notify(@pr_ci_unrelated_kind, %{
      title: "CI failure may be unrelated",
      body: "#{identifier}: kept in review — consider re-running failed jobs",
      url: issue_url(slug, identifier, "pull-request"),
      tag: "pr_ci_unrelated:#{slug}:#{identifier}"
    })
  end

  def pr_monitor_attention(_project, _identifier, _action), do: :ok

  @spec notify(String.t(), map()) :: :ok
  def notify(kind, payload) when is_binary(kind) and is_map(payload) do
    if Config.enabled?() do
      Sender.deliver_all(kind, payload)
    else
      :ok
    end
  end

  defp wait_state?(%IssueRecord{project: %Project{id: id}} = issue, status_name) when not is_nil(id) do
    states =
      issue.project
      |> ProjectConfig.resolve()
      |> Map.get(:wait_states)
      |> case do
        [] -> SymphonyElixir.Config.wait_states()
        list when is_list(list) -> list
        _ -> SymphonyElixir.Config.wait_states()
      end

    status_name in states
  end

  defp wait_state?(_issue, status_name), do: status_name == "Human Review"

  defp project_slug(%IssueRecord{project: %Project{slug: slug}}) when is_binary(slug), do: slug
  defp project_slug(_issue), do: nil

  defp issue_url(project_slug, identifier, tab \\ nil) do
    base = "/tracker/projects/#{project_slug}/board/issues/#{identifier}"

    case tab do
      tab when is_binary(tab) and tab != "" -> "#{base}/#{tab}"
      _ -> base
    end
  end

  defp retry_error_text(error) when is_binary(error) and error != "" do
    snippet = String.slice(error, 0, 120)
    " — #{snippet}"
  end

  defp retry_error_text(_error), do: ""

  defp incomplete_reason_summary(:max_turns), do: "max turns reached"
  defp incomplete_reason_summary({:publish_gate, _}), do: "publish gate unsatisfied"
  defp incomplete_reason_summary({:validate_gate, _}), do: "validate gate unsatisfied"
  defp incomplete_reason_summary(other), do: inspect(other)

  defp blocked_summary(violations) when is_list(violations) do
    case length(violations) do
      0 -> "publish gate blocked"
      n -> "#{n} publish gate violation(s)"
    end
  end

  defp blocked_summary(_), do: "publish gate blocked"
end
