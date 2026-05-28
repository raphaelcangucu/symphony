defmodule SymphonyElixir.LocalTracker.Broadcaster do
  @moduledoc "Broadcasts local tracker changes to subscribed tracker clients."

  alias SymphonyElixir.LocalTracker.{Comment, IssueRecord, IssueRelation, Project}
  alias SymphonyElixirWeb.TrackerPresenter

  @pubsub SymphonyElixir.PubSub

  @spec project_changed(String.t(), Project.t()) :: :ok
  def project_changed(event_name, %Project{} = project) when event_name in ["project_created", "project_updated"] do
    broadcast(project.slug, event_name, %{project: TrackerPresenter.project(project)})
  end

  @spec issue_changed(String.t(), IssueRecord.t()) :: :ok
  def issue_changed(event_name, %IssueRecord{} = issue) when event_name in ["issue_created", "issue_moved", "issue_updated"] do
    issue
    |> project_slug()
    |> broadcast(event_name, %{issue: TrackerPresenter.issue(issue)})
  end

  @spec comment_created(IssueRecord.t(), Comment.t()) :: :ok
  def comment_created(%IssueRecord{} = issue, %Comment{} = comment) do
    issue
    |> project_slug()
    |> broadcast("comment_created", %{
      issue_identifier: issue.identifier,
      comment: TrackerPresenter.comment(comment)
    })
  end

  @spec blocker_changed(IssueRecord.t(), IssueRelation.t()) :: :ok
  def blocker_changed(%IssueRecord{} = issue, %IssueRelation{} = relation) do
    issue
    |> project_slug()
    |> broadcast("blocker_changed", %{
      issue_identifier: issue.identifier,
      blocker: TrackerPresenter.blocker(relation)
    })
  end

  @spec topic(String.t()) :: String.t()
  def topic(project_slug) when is_binary(project_slug), do: "project:#{project_slug}"

  defp broadcast(nil, _event_name, _payload), do: :ok

  defp broadcast(project_slug, event_name, payload) do
    Phoenix.PubSub.broadcast(@pubsub, topic(project_slug), {:tracker_event, event_name, payload})
  end

  defp project_slug(%IssueRecord{project: %Project{slug: slug}}), do: slug
  defp project_slug(_issue), do: nil
end
