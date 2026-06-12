defmodule SymphonyElixir.PushNotifications.Dispatcher do
  @moduledoc """
  Sends browser push notifications for operator-relevant Symphony events.

  Delivery is best-effort: missing VAPID config or subscriptions is a no-op.
  """

  alias SymphonyElixir.Evidence.Record, as: EvidenceRecord
  alias SymphonyElixir.LocalTracker.IssueRecord
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.PushNotifications.{Config, Sender}
  alias SymphonyElixir.LocalTracker.Project

  require Logger

  @human_review_kind "human_review"
  @evidence_kind "evidence"

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
end
