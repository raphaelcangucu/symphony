defmodule SymphonyElixir.PushNotifications.MentionNotifier do
  @moduledoc false

  alias SymphonyElixir.LocalTracker.{Comment, IssueRecord, Project}
  alias SymphonyElixir.PushNotifications.{Dispatcher, MentionParser}
  alias SymphonyElixir.Repo

  @spec deliver_if_needed(Comment.t(), :after_remote_sync | :local_only) :: :ok
  def deliver_if_needed(%Comment{kind: "comment", sync_status: "synced"} = comment, _reason) do
    with %IssueRecord{} = issue <- Repo.get(IssueRecord, comment.issue_id),
         %Project{} = project <- Repo.get(Project, issue.project_id) do
      logins = MentionParser.parse_logins(comment.body)
      mentioned = MentionParser.resolve_users(project.id, logins)
      Dispatcher.comment_mentioned(project, issue, comment, mentioned)
    else
      _ -> :ok
    end
  end

  def deliver_if_needed(_comment, _reason), do: :ok
end
