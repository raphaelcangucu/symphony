defmodule SymphonyElixirWeb.TrackerPresenter do
  @moduledoc "JSON DTOs for the local tracker API and realtime payloads."

  alias SymphonyElixir.LocalTracker.{Comment, IssueRecord, IssueRelation, Project, WorkflowStatus}

  @spec project(Project.t(), [WorkflowStatus.t()] | nil) :: map()
  def project(%Project{} = project, statuses \\ nil) do
    %{
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      statuses: statuses && Enum.map(statuses, &status/1),
      inserted_at: iso8601(project.inserted_at),
      updated_at: iso8601(project.updated_at)
    }
  end

  @spec status(WorkflowStatus.t()) :: map()
  def status(%WorkflowStatus{} = status) do
    %{
      id: status.id,
      name: status.name,
      category: status.category,
      position: status.position,
      is_terminal: status.is_terminal
    }
  end

  @spec issue(IssueRecord.t()) :: map()
  def issue(%IssueRecord{} = issue) do
    %{
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      position: issue.position,
      assignee_id: issue.assignee_id,
      worker_id: issue.worker_id,
      branch_name: issue.branch_name,
      url: issue.url,
      project_slug: loaded_project_slug(issue),
      status: loaded_status(issue),
      started_at: iso8601(issue.started_at),
      completed_at: iso8601(issue.completed_at),
      inserted_at: iso8601(issue.inserted_at),
      updated_at: iso8601(issue.updated_at)
    }
  end

  @spec comment(Comment.t()) :: map()
  def comment(%Comment{} = comment) do
    %{
      id: comment.id,
      issue_id: comment.issue_id,
      kind: comment.kind,
      body: comment.body,
      author: comment.author,
      inserted_at: iso8601(comment.inserted_at),
      updated_at: iso8601(comment.updated_at)
    }
  end

  @spec blocker(IssueRelation.t()) :: map()
  def blocker(%IssueRelation{} = relation) do
    %{
      id: relation.id,
      type: relation.type,
      source_issue_id: relation.source_issue_id,
      target_issue_id: relation.target_issue_id,
      source_identifier: loaded_issue_identifier(relation.source_issue),
      target_identifier: loaded_issue_identifier(relation.target_issue),
      inserted_at: iso8601(relation.inserted_at)
    }
  end

  defp loaded_status(%IssueRecord{status: %WorkflowStatus{} = status}), do: status(status)
  defp loaded_status(_issue), do: nil

  defp loaded_project_slug(%IssueRecord{project: %Project{} = project}), do: project.slug
  defp loaded_project_slug(_issue), do: nil

  defp loaded_issue_identifier(%IssueRecord{} = issue), do: issue.identifier
  defp loaded_issue_identifier(_issue), do: nil

  defp iso8601(%DateTime{} = datetime) do
    datetime
    |> DateTime.truncate(:second)
    |> DateTime.to_iso8601()
  end

  defp iso8601(_datetime), do: nil
end
