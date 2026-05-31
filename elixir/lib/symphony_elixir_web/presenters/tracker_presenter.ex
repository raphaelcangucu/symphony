defmodule SymphonyElixirWeb.TrackerPresenter do
  @moduledoc "JSON DTOs for the local tracker API and realtime payloads."

  alias SymphonyElixir.LocalTracker.{
    ActivityEvent,
    Comment,
    IssueRecord,
    IssueRelation,
    Project,
    ProjectSetup,
    Repository,
    WorkflowStatus
  }

  alias SymphonyElixir.AgentExecution
  alias SymphonyElixir.Tracker.IssueDTO

  @spec project(Project.t(), [WorkflowStatus.t()] | nil, [Repository.t()] | nil, ProjectSetup.t() | nil) :: map()
  def project(%Project{} = project, statuses \\ nil, repositories \\ nil, setup \\ nil) do
    %{
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      tracker_kind: project.tracker_kind,
      tracker_config: project.tracker_config,
      statuses: statuses && Enum.map(statuses, &status/1),
      repositories: repositories && Enum.map(repositories, &repository/1),
      setup: setup && project_setup(setup),
      archived_at: iso8601(project.archived_at),
      inserted_at: iso8601(project.inserted_at),
      updated_at: iso8601(project.updated_at)
    }
  end

  @spec repository(Repository.t()) :: map()
  def repository(%Repository{} = repository) do
    %{
      id: repository.id,
      github_full_name: repository.github_full_name,
      clone_url: repository.clone_url,
      default_branch: repository.default_branch,
      selected_branch: repository.selected_branch,
      local_path: repository.local_path,
      workspace_path: repository.workspace_path,
      role: repository.role,
      scan_summary: repository.scan_summary
    }
  end

  @spec project_setup(ProjectSetup.t()) :: map()
  def project_setup(%ProjectSetup{} = setup) do
    %{
      id: setup.id,
      workflow_config: setup.workflow_config,
      after_create_hook: setup.after_create_hook,
      prompt_template: setup.prompt_template,
      validation_commands: Map.get(setup.validation_commands || %{}, "commands", []),
      scan_summary: setup.scan_summary
    }
  end

  @spec status(map()) :: map()
  def status(%{name: name} = status) when is_map_key(status, :category) do
    %{
      id: Map.get(status, :id),
      name: name,
      category: Map.get(status, :category),
      position: Map.get(status, :position),
      is_terminal: Map.get(status, :is_terminal, false)
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

  @spec issue(IssueDTO.t()) :: map()
  def issue(%IssueDTO{} = dto) do
    %{
      id: dto.id,
      identifier: dto.identifier,
      title: dto.title,
      description: dto.description,
      priority: dto.priority,
      position: dto.position,
      assignee_id: dto.assignee,
      creator: dto.creator,
      worker_id: nil,
      agent_session_id: nil,
      branch_name: nil,
      url: dto.url,
      project_slug: dto.project_slug,
      status: dto.status,
      labels: dto.labels,
      blocked_by: dto.blocked_by,
      started_at: nil,
      completed_at: nil,
      inserted_at: dto.created_at,
      updated_at: dto.updated_at
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
      creator: issue.creator,
      worker_id: issue.worker_id,
      agent_session_id: issue.agent_session_id,
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

  @spec comment(Comment.t() | map()) :: map()
  def comment(%Comment{} = comment) do
    %{
      id: comment.id,
      issue_id: comment.issue_id,
      kind: comment.kind,
      body: comment.body,
      author: comment.author,
      url: nil,
      inserted_at: iso8601(comment.inserted_at),
      updated_at: iso8601(comment.updated_at)
    }
  end

  def comment(comment) when is_map(comment) do
    %{
      id: Map.get(comment, :id),
      issue_id: nil,
      kind: Map.get(comment, :kind, "comment"),
      body: Map.get(comment, :body),
      author: Map.get(comment, :author),
      url: Map.get(comment, :url),
      inserted_at: Map.get(comment, :created_at),
      updated_at: Map.get(comment, :updated_at)
    }
  end

  @spec activity_event(ActivityEvent.t()) :: map()
  def activity_event(%ActivityEvent{} = event) do
    %{
      id: event.id,
      issue_id: event.issue_id,
      event_type: event.event_type,
      metadata: event.metadata || %{},
      inserted_at: iso8601(event.inserted_at)
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

  @spec agent_execution(AgentExecution.t()) :: map()
  def agent_execution(execution) when is_map(execution) do
    %{
      issue_id: Map.get(execution, :issue_id),
      issue_identifier: execution.issue_identifier,
      status: Atom.to_string(execution.status),
      session_id: execution.session_id,
      last_event: event_to_string(execution.last_event),
      last_message: AgentExecution.humanize_message(execution.last_message),
      last_event_at: iso8601(execution.last_event_at),
      turn_count: execution.turn_count,
      runtime_seconds: execution.runtime_seconds,
      started_at: iso8601(execution.started_at),
      retry_attempt: execution.retry_attempt,
      error: execution.error,
      tokens: execution.tokens
    }
  end

  defp event_to_string(nil), do: nil
  defp event_to_string(event) when is_atom(event), do: Atom.to_string(event)
  defp event_to_string(event) when is_binary(event), do: event
  defp event_to_string(event), do: inspect(event)

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
