defmodule SymphonyElixir.PushNotifications.Dispatcher do
  @moduledoc """
  Sends browser push notifications for operator-relevant Symphony events.

  Delivery is best-effort: missing VAPID config or subscriptions is a no-op.
  """

  use Gettext, backend: SymphonyElixirWeb.Gettext

  alias Gettext, as: GettextCore
  alias SymphonyElixir.Evidence.Record, as: EvidenceRecord
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.{Comment, IssueRecord, Project}
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.PushNotifications.{Config, MentionParser, Sender}
  alias SymphonyElixir.Settings.Ui
  alias SymphonyElixir.Tracker.Identity
  alias SymphonyElixirWeb.Gettext, as: GettextBackend

  require Logger

  @human_review_kind "human_review"
  @evidence_kind "evidence"
  @agent_retry_kind "agent_retry"
  @agent_incomplete_kind "agent_incomplete"
  @agent_blocked_kind "agent_blocked"
  @pr_limit_reached_kind "pr_limit_reached"
  @pr_needs_human_kind "pr_needs_human"
  @pr_ci_unrelated_kind "pr_ci_unrelated"
  @pr_merge_conflict_kind "pr_merge_conflict"
  @issue_assigned_kind "issue_assigned"
  @comment_mention_kind "comment_mention"
  @assistant_input_kind "assistant_input_needed"

  @spec assistant_input_needed(map()) :: :ok
  def assistant_input_needed(%{project_slug: slug} = metadata) when is_binary(slug) and slug != "" do
    identifier = normalize_identifier(Map.get(metadata, :issue_identifier))
    request_kind = normalize_request_kind(Map.get(metadata, :request_kind))

    with_push_locale(fn ->
      notify(@assistant_input_kind, %{
        title: dgettext("push", "Needs your input"),
        body: assistant_input_body(identifier, request_kind),
        url: assistant_input_url(slug, identifier),
        tag: assistant_input_tag(slug, identifier, request_kind)
      })
    end)
  end

  def assistant_input_needed(_metadata), do: :ok

  @spec human_review_needed(IssueRecord.t(), String.t()) :: :ok
  def human_review_needed(%IssueRecord{} = issue, status_name) when is_binary(status_name) do
    with true <- wait_state?(issue, status_name),
         slug when is_binary(slug) <- project_slug(issue),
         identifier when is_binary(identifier) <- issue.identifier do
      title = issue.title || identifier

      with_push_locale(fn ->
        notify(@human_review_kind, %{
          title: dgettext("push", "Human review needed"),
          body: "#{identifier}: #{title}",
          url: issue_url(slug, identifier),
          tag: "human_review:#{slug}:#{identifier}"
        })
      end)
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

      summary =
        if total > 0,
          do: dgettext("push", "%{passed}/%{total} runs passed", passed: passed, total: total),
          else: dgettext("push", "Evidence recorded")

      with_push_locale(fn ->
        notify(@evidence_kind, %{
          title: dgettext("push", "Evidence generated"),
          body: "#{identifier}: #{summary}",
          url: issue_url(slug, identifier, "evidence"),
          tag: "evidence:#{slug}:#{identifier}:#{record.run_id}"
        })
      end)
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

    with_push_locale(fn ->
      notify(@agent_retry_kind, %{
        title: dgettext("push", "Agent run failed — retry scheduled"),
        body: "#{identifier}: attempt #{attempt}#{error_text}",
        url: issue_url(slug, identifier),
        tag: "agent_retry:#{slug}:#{identifier}"
      })
    end)
  end

  def agent_retry_scheduled(_metadata), do: :ok

  @spec agent_run_incomplete(Issue.t(), term()) :: :ok
  def agent_run_incomplete(%Issue{identifier: identifier, project_slug: slug} = issue, reason)
      when is_binary(identifier) and is_binary(slug) and slug != "" do
    title = issue.title || identifier

    with_push_locale(fn ->
      notify(@agent_incomplete_kind, %{
        title: dgettext("push", "Agent run incomplete"),
        body: "#{identifier}: #{title} (#{incomplete_reason_summary(reason)})",
        url: issue_url(slug, identifier),
        tag: "agent_incomplete:#{slug}:#{identifier}"
      })
    end)
  end

  def agent_run_incomplete(_issue, _reason), do: :ok

  @spec agent_run_blocked(Issue.t(), term()) :: :ok
  def agent_run_blocked(%Issue{identifier: identifier, project_slug: slug} = issue, violations)
      when is_binary(identifier) and is_binary(slug) and slug != "" do
    title = issue.title || identifier
    summary = blocked_summary(violations)

    with_push_locale(fn ->
      notify(@agent_blocked_kind, %{
        title: dgettext("push", "Agent run blocked"),
        body: "#{identifier}: #{title} — #{summary}",
        url: issue_url(slug, identifier),
        tag: "agent_blocked:#{slug}:#{identifier}"
      })
    end)
  end

  def agent_run_blocked(_issue, _violations), do: :ok

  @spec pr_monitor_attention(Project.t(), String.t(), term()) :: :ok
  def pr_monitor_attention(%Project{slug: slug}, identifier, {:stay, :limit_reached})
      when is_binary(slug) and slug != "" and is_binary(identifier) do
    with_push_locale(fn ->
      notify(@pr_limit_reached_kind, %{
        title: dgettext("push", "Auto-fix limit reached"),
        body: dgettext("push", "%{identifier}: PR monitor stopped automatic rework", identifier: identifier),
        url: issue_url(slug, identifier, "pull-request"),
        tag: "pr_limit:#{slug}:#{identifier}"
      })
    end)
  end

  def pr_monitor_attention(%Project{slug: slug}, identifier, {:stay, :needs_human})
      when is_binary(slug) and slug != "" and is_binary(identifier) do
    with_push_locale(fn ->
      notify(@pr_needs_human_kind, %{
        title: dgettext("push", "PR feedback needs you"),
        body: dgettext("push", "%{identifier}: review findings need human attention", identifier: identifier),
        url: issue_url(slug, identifier, "pull-request"),
        tag: "pr_needs_human:#{slug}:#{identifier}"
      })
    end)
  end

  def pr_monitor_attention(%Project{slug: slug}, identifier, {:stay, :unrelated})
      when is_binary(slug) and slug != "" and is_binary(identifier) do
    with_push_locale(fn ->
      notify(@pr_ci_unrelated_kind, %{
        title: dgettext("push", "CI failure may be unrelated"),
        body: dgettext("push", "%{identifier}: kept in review — consider re-running failed jobs", identifier: identifier),
        url: issue_url(slug, identifier, "pull-request"),
        tag: "pr_ci_unrelated:#{slug}:#{identifier}"
      })
    end)
  end

  def pr_monitor_attention(%Project{slug: slug}, identifier, {:stay, :merge_conflict})
      when is_binary(slug) and slug != "" and is_binary(identifier) do
    with_push_locale(fn ->
      notify(@pr_merge_conflict_kind, %{
        title: dgettext("push", "PR has merge conflicts"),
        body: dgettext("push", "%{identifier}: resolve merge conflicts before merging", identifier: identifier),
        url: issue_url(slug, identifier, "pull-request"),
        tag: "pr_merge_conflict:#{slug}:#{identifier}"
      })
    end)
  end

  def pr_monitor_attention(_project, _identifier, _action), do: :ok

  @type assignee_snapshot :: %{
          optional(:assignee_id) => String.t() | nil,
          optional(:assignee_remote_id) => String.t() | nil
        }

  @spec issue_assigned(IssueRecord.t(), assignee_snapshot() | nil) :: :ok
  def issue_assigned(%IssueRecord{} = issue, previous) do
    with true <- assignee_changed?(previous, issue),
         true <- assignee_matches_operator?(issue),
         slug when is_binary(slug) <- project_slug(issue),
         identifier when is_binary(identifier) <- issue.identifier do
      title = issue.title || identifier

      with_push_locale(fn ->
        notify(@issue_assigned_kind, %{
          title: dgettext("push", "Issue assigned to you"),
          body:
            dgettext("push", "%{identifier}: %{title} — click to view",
              identifier: identifier,
              title: title
            ),
          url: issue_url(slug, identifier),
          tag: "issue_assigned:#{slug}:#{identifier}"
        })
      end)
    else
      _ -> :ok
    end
  end

  def issue_assigned(_issue, _previous), do: :ok

  @spec comment_mentioned(Project.t(), IssueRecord.t(), Comment.t(), [map()]) :: :ok
  def comment_mentioned(%Project{} = project, %IssueRecord{} = issue, %Comment{} = comment, mentioned_users)
      when is_list(mentioned_users) do
    slug = project.slug
    identifier = issue.identifier

    with true <- is_binary(slug) and slug != "",
         true <- is_binary(identifier) and identifier != "" do
      author_keys = author_identity_keys(comment.author)
      snippet = comment_snippet(comment.body)

      Enum.each(mentioned_users, fn user ->
        target_keys = MentionParser.identity_keys_for_user(user)

        if mentions_author?(target_keys, author_keys) do
          :ok
        else
          with_push_locale(fn ->
            notify_to_identities(target_keys, @comment_mention_kind, %{
              title: dgettext("push", "%{author} mentioned you", author: comment.author || dgettext("push", "Someone")),
              body: "#{identifier}: #{snippet}",
              url: issue_url(slug, identifier),
              tag: "comment_mention:#{slug}:#{identifier}:#{comment.id}"
            })
          end)
        end
      end)
    else
      _ -> :ok
    end
  end

  def comment_mentioned(_project, _issue, _comment, _mentioned_users), do: :ok

  @spec notify(String.t(), map()) :: :ok
  def notify(kind, payload) when is_binary(kind) and is_map(payload) do
    if Config.enabled?() do
      Sender.deliver_all(kind, payload)
    else
      :ok
    end
  end

  defp with_push_locale(fun) when is_function(fun, 0) do
    GettextCore.with_locale(GettextBackend, Ui.effective_gettext_locale(), fun)
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

  defp assistant_input_url(slug, identifier) when is_binary(identifier),
    do: issue_url(slug, identifier, "authoring")

  defp assistant_input_url(slug, _identifier), do: "/tracker/projects/#{slug}/assistant"

  defp assistant_input_body(identifier, "approval") when is_binary(identifier),
    do: dgettext("push", "%{identifier}: approval required", identifier: identifier)

  defp assistant_input_body(identifier, "question") when is_binary(identifier),
    do: dgettext("push", "%{identifier}: answer needed", identifier: identifier)

  defp assistant_input_body(identifier, _kind) when is_binary(identifier),
    do: dgettext("push", "%{identifier}: input needed", identifier: identifier)

  defp assistant_input_body(_identifier, "approval"), do: dgettext("push", "Approval required")
  defp assistant_input_body(_identifier, "question"), do: dgettext("push", "Answer needed")
  defp assistant_input_body(_identifier, _kind), do: dgettext("push", "Input needed")

  defp assistant_input_tag(slug, identifier, request_kind) when is_binary(identifier),
    do: "assistant_input:#{slug}:#{identifier}:#{request_kind}"

  defp assistant_input_tag(slug, _identifier, request_kind), do: "assistant_input:#{slug}:#{request_kind}"

  defp normalize_identifier(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_identifier(_value), do: nil

  defp normalize_request_kind(kind) when kind in ["approval", "question"], do: kind
  defp normalize_request_kind(kind) when kind in [:approval, :question], do: Atom.to_string(kind)
  defp normalize_request_kind(_kind), do: "input"

  defp retry_error_text(error) when is_binary(error) and error != "" do
    snippet = String.slice(error, 0, 120)
    " — #{snippet}"
  end

  defp retry_error_text(_error), do: ""

  defp incomplete_reason_summary(:max_turns), do: dgettext("push", "max turns reached")
  defp incomplete_reason_summary({:publish_gate, _}), do: dgettext("push", "publish gate unsatisfied")
  defp incomplete_reason_summary({:validate_gate, _}), do: dgettext("push", "validate gate unsatisfied")
  defp incomplete_reason_summary(other), do: inspect(other)

  defp blocked_summary(violations) when is_list(violations) do
    case length(violations) do
      0 -> dgettext("push", "publish gate blocked")
      n -> dgettext("push", "%{count} publish gate violation(s)", count: n)
    end
  end

  defp blocked_summary(_), do: dgettext("push", "publish gate blocked")

  defp assignee_changed?(previous, %IssueRecord{} = issue) do
    previous_value = canonical_assignee(previous)
    next_value = canonical_assignee(issue)

    is_binary(next_value) and next_value != "" and next_value != previous_value
  end

  defp canonical_assignee(%IssueRecord{} = issue) do
    canonical_assignee(%{
      assignee_id: issue.assignee_id,
      assignee_remote_id: issue.assignee_remote_id
    })
  end

  defp canonical_assignee(snapshot) when is_map(snapshot) do
    (Map.get(snapshot, :assignee_remote_id) || Map.get(snapshot, "assignee_remote_id") ||
       Map.get(snapshot, :assignee_id) || Map.get(snapshot, "assignee_id"))
    |> normalize_assignee_value()
  end

  defp canonical_assignee(_snapshot), do: nil

  defp normalize_assignee_value(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: String.downcase(trimmed)
  end

  defp normalize_assignee_value(_value), do: nil

  defp assignee_matches_operator?(%IssueRecord{project: %Project{tracker_kind: kind}} = issue)
       when is_binary(kind) do
    case Identity.match_value(kind) do
      value when is_binary(value) ->
        canonical_assignee(issue) == normalize_assignee_value(value)

      _ ->
        false
    end
  end

  defp assignee_matches_operator?(_issue), do: false

  defp notify_to_identities(keys, kind, payload) when is_list(keys) and is_binary(kind) and is_map(payload) do
    if Config.enabled?() do
      Sender.deliver_to_identities(keys, kind, payload)
    else
      :ok
    end
  end

  defp author_identity_keys(author) when is_binary(author) do
    author |> String.trim() |> String.downcase() |> List.wrap()
  end

  defp author_identity_keys(_author), do: []

  defp mentions_author?(target_keys, author_keys) when is_list(target_keys) and is_list(author_keys) do
    author_set = MapSet.new(author_keys)
    Enum.any?(target_keys, &MapSet.member?(author_set, &1))
  end

  defp comment_snippet(body) when is_binary(body) do
    body
    |> String.split("\n", parts: 2)
    |> List.first()
    |> case do
      snippet when is_binary(snippet) ->
        trimmed = String.trim(snippet)
        if trimmed == "", do: dgettext("push", "New comment"), else: String.slice(trimmed, 0, 120)

      _ ->
        dgettext("push", "New comment")
    end
  end

  defp comment_snippet(_body), do: dgettext("push", "New comment")
end
