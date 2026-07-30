defmodule SymphonyElixirWeb.TrackerPresenter do
  @moduledoc "JSON DTOs for the local tracker API and realtime payloads."

  alias SymphonyElixir.LocalTracker.{
    ActivityEvent,
    Comment,
    IssueRecord,
    IssueRelation,
    Label,
    Project,
    ProjectSetup,
    Repository,
    WorkflowStatus
  }

  alias SymphonyElixir.AgentExecution
  alias SymphonyElixir.PromptTemplates.Template
  alias SymphonyElixir.AgentRouting
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.DisplayIdentifier
  alias SymphonyElixir.Tracker.ExternalUrl
  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixir.Tracker.Sync.StateRecord

  @spec datetime_iso8601(DateTime.t() | nil) :: String.t() | nil
  def datetime_iso8601(datetime), do: iso8601(datetime)

  @spec project(Project.t(), [WorkflowStatus.t()] | nil, [Repository.t()] | nil, ProjectSetup.t() | nil) :: map()
  def project(%Project{} = project, statuses \\ nil, repositories \\ nil, setup \\ nil) do
    %{
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      tracker_kind: project.tracker_kind,
      tracker_config: project.tracker_config,
      tracker_url: ExternalUrl.for(project),
      statuses: statuses && Enum.map(statuses, &status/1),
      repositories: repositories && Enum.map(repositories, &repository/1),
      setup: setup && project_setup(setup),
      archived_at: iso8601(project.archived_at),
      warmed_at: iso8601(project.warmed_at),
      warm_up_status: project.warm_up_status,
      last_warm_up_run_id: project.last_warm_up_run_id,
      inserted_at: iso8601(project.inserted_at),
      updated_at: iso8601(project.updated_at)
    }
  end

  @doc "Serializes a project's background sync health for the tracker UI."
  @spec sync_state(StateRecord.t() | nil) :: map() | nil
  def sync_state(nil), do: nil

  def sync_state(%StateRecord{} = state) do
    %{
      status: state.status,
      last_error: state.last_error,
      last_pull_at: iso8601(state.last_pull_at),
      last_push_at: iso8601(state.last_push_at),
      last_full_sync_at: iso8601(state.last_full_sync_at)
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
      workflow_markdown: setup.workflow_markdown,
      after_create_hook: setup.after_create_hook,
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
    label_agent = AgentRouting.label_agent_kind(dto.labels)

    %{
      id: dto.id,
      identifier: dto.identifier,
      display_identifier: DisplayIdentifier.resolve(dto.identifier, dto.url, dto.repository_full_name),
      title: dto.title,
      description: dto.description,
      priority: dto.priority,
      position: dto.position,
      assignee_id: dto.assignee,
      creator: dto.creator,
      agent_goal: dto.agent_goal,
      worker_id: nil,
      agent_session_id: nil,
      branch_name: nil,
      url: dto.url,
      project_slug: dto.project_slug,
      status: dto.status,
      labels: dto.labels,
      agent_kind: label_agent,
      blocked_by: dto.blocked_by,
      attachments: Enum.map(dto.attachments, &issue_attachment/1),
      started_at: nil,
      completed_at: nil,
      inserted_at: dto.created_at,
      updated_at: dto.updated_at,
      repository_full_name: dto.repository_full_name,
      parent_identifier: dto.parent_identifier,
      sub_issue_summary: dto.sub_issue_summary,
      sync_status: dto.sync_status || "synced",
      last_sync_error: dto.last_sync_error
    }
    |> merge_execution_pins(dto.project_slug, dto.identifier, label_agent)
  end

  @spec issue(IssueRecord.t()) :: map()
  def issue(%IssueRecord{} = issue) do
    label_agent = AgentRouting.label_agent_kind(loaded_label_names(issue))

    %{
      id: issue.id,
      identifier: issue.identifier,
      display_identifier: DisplayIdentifier.resolve(issue.identifier, issue.url),
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      position: issue.position,
      assignee_id: issue.assignee_id,
      creator: issue.creator,
      agent_goal: issue.agent_goal,
      worker_id: issue.worker_id,
      agent_session_id: issue.agent_session_id,
      branch_name: issue.branch_name,
      url: issue.url,
      project_slug: loaded_project_slug(issue),
      status: loaded_status(issue),
      started_at: iso8601(issue.started_at),
      completed_at: iso8601(issue.completed_at),
      inserted_at: iso8601(issue.inserted_at),
      updated_at: iso8601(issue.updated_at),
      sync_status: issue.sync_status || "synced",
      last_sync_error: issue.last_sync_error
    }
    |> merge_execution_pins(loaded_project_slug(issue), issue.identifier, label_agent)
  end

  defp merge_execution_pins(base, slug, identifier, label_agent)
       when is_binary(slug) and is_binary(identifier) do
    case Context.get_agent_settings(slug, identifier) do
      {:ok, settings} ->
        Map.merge(base, %{
          agent_kind: settings.agent_kind || label_agent,
          model: settings.model,
          effort: settings.effort
        })

      {:error, :not_found} ->
        Map.merge(base, %{
          agent_kind: label_agent,
          model: nil,
          effort: nil
        })
    end
  end

  defp merge_execution_pins(base, _slug, _identifier, label_agent) do
    Map.merge(base, %{agent_kind: label_agent, model: nil, effort: nil})
  end

  defp issue_attachment(attachment) do
    %{
      id: attachment.id,
      filename: attachment.filename,
      mime_type: attachment.mime_type,
      size: attachment.size,
      created: attachment.created,
      author: attachment.author,
      is_image: attachment.is_image
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
      sync_status: comment.sync_status || "synced",
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
      sync_status: Map.get(comment, :sync_status, "synced"),
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
      title: loaded_issue_title(relation.target_issue),
      status: loaded_issue_status(relation.target_issue),
      inserted_at: iso8601(relation.inserted_at)
    }
  end

  @spec agent_execution(AgentExecution.t()) :: map()
  def agent_execution(execution) when is_map(execution) do
    %{
      issue_id: Map.get(execution, :issue_id),
      issue_identifier: execution.issue_identifier,
      status: Atom.to_string(execution.status),
      agent_kind: Map.get(execution, :agent_kind),
      model: Map.get(execution, :model),
      session_id: execution.session_id,
      execution_session_id: Map.get(execution, :execution_session_id),
      last_event: event_to_string(execution.last_event),
      last_message: AgentExecution.humanize_message(execution.last_message),
      last_event_at: iso8601(execution.last_event_at),
      turn_count: execution.turn_count,
      runtime_seconds: execution.runtime_seconds,
      started_at: iso8601(execution.started_at),
      retry_attempt: execution.retry_attempt,
      error: execution.error,
      goal: Map.get(execution, :goal),
      long_running: Map.get(execution, :long_running),
      long_running_kind: Map.get(execution, :long_running_kind),
      long_running_label: Map.get(execution, :long_running_label),
      parent_identifier: Map.get(execution, :parent_identifier),
      bundle_role: bundle_role_to_string(Map.get(execution, :bundle_role)),
      unit_id: Map.get(execution, :unit_id),
      repo: Map.get(execution, :repo),
      child_identifiers: Map.get(execution, :child_identifiers, []),
      tokens: execution.tokens
    }
  end

  defp bundle_role_to_string(role) when is_atom(role) and not is_nil(role), do: Atom.to_string(role)
  defp bundle_role_to_string(role) when is_binary(role), do: role
  defp bundle_role_to_string(_role), do: "standalone"

  @spec assistant_thread(map()) :: map()
  def assistant_thread(thread) when is_map(thread) do
    %{
      id: thread.id,
      scope: thread.scope,
      project_slug: thread.project_slug,
      project_name: Map.get(thread, :project_name),
      issue_identifier: thread.issue_identifier,
      agent_kind: Map.get(thread, :agent_kind),
      requested_model: Map.get(thread, :requested_model),
      requested_effort: Map.get(thread, :requested_effort),
      resolved_model: Map.get(thread, :resolved_model),
      resolved_effort: Map.get(thread, :resolved_effort),
      title: thread.title,
      status: thread.status,
      workspace_path: Map.get(thread, :workspace_path),
      labels: sidebar_labels(Map.get(thread, :metadata)),
      needs_review: sidebar_needs_review(Map.get(thread, :metadata)),
      permission_level: thread_permission_level(Map.get(thread, :metadata)),
      preview: Map.get(thread, :preview),
      updated_at: iso8601(thread.updated_at)
    }
  end

  defp thread_permission_level(%{"permission_level" => level})
       when level in ~w(ask_for_approval approve_for_me full_access),
       do: level

  defp thread_permission_level(_metadata), do: nil

  @spec recent_item(map()) :: map()
  def recent_item(item) when is_map(item) do
    %{
      id: item.id,
      kind: to_string(item.kind),
      scope: scope_string(item.scope),
      project_slug: item.project_slug,
      project_name: item.project_name,
      title: item.title,
      identifier: item.identifier,
      thread_id: item.thread_id,
      agent_kind: Map.get(item, :agent_kind),
      status: item.status,
      status_kind: to_string(item.status_kind),
      preview: item.preview,
      updated_at: iso8601(item.updated_at)
    }
  end

  @spec prompt_template(Template.t()) :: map()
  def prompt_template(%Template{} = template) do
    %{
      id: template.id,
      slug: template.slug,
      name: template.name,
      description: template.description,
      category: template.category,
      body: template.body,
      agentKind: template.agent_kind,
      model: template.model,
      effort: template.effort,
      mode: template.mode,
      scope: template.scope,
      builtIn: template.built_in,
      enabled: template.enabled,
      position: template.position,
      insertedAt: iso8601(template.inserted_at),
      updatedAt: iso8601(template.updated_at)
    }
  end

  @spec assistant_command(map()) :: map()
  def assistant_command(command) when is_map(command) do
    %{
      slug: Map.get(command, :slug),
      name: Map.get(command, :name),
      description: Map.get(command, :description),
      kind: Map.get(command, :kind),
      category: Map.get(command, :category),
      submitKind: Map.get(command, :submit_kind),
      source: Map.get(command, :source)
    }
  end

  defp scope_string(nil), do: nil
  defp scope_string(scope), do: to_string(scope)

  defp event_to_string(nil), do: nil
  defp event_to_string(event) when is_atom(event), do: Atom.to_string(event)
  defp event_to_string(event) when is_binary(event), do: event
  defp event_to_string(event), do: inspect(event)

  defp loaded_status(%IssueRecord{status: %WorkflowStatus{} = status}), do: status(status)
  defp loaded_status(_issue), do: nil

  defp loaded_project_slug(%IssueRecord{project: %Project{} = project}), do: project.slug
  defp loaded_project_slug(_issue), do: nil

  defp loaded_label_names(%IssueRecord{labels: labels}) when is_list(labels) do
    Enum.flat_map(labels, fn
      %Label{name: name} when is_binary(name) -> [name]
      name when is_binary(name) -> [name]
      _label -> []
    end)
  end

  defp loaded_label_names(_issue), do: []

  defp loaded_issue_identifier(%IssueRecord{} = issue), do: issue.identifier
  defp loaded_issue_identifier(_issue), do: nil
  defp loaded_issue_title(%IssueRecord{} = issue), do: issue.title
  defp loaded_issue_title(_issue), do: nil
  defp loaded_issue_status(%IssueRecord{status: %WorkflowStatus{} = issue_status}), do: status(issue_status)
  defp loaded_issue_status(_issue), do: nil

  defp sidebar_labels(%{"sidebar_labels" => labels}) when is_list(labels), do: labels
  defp sidebar_labels(_metadata), do: []

  defp sidebar_needs_review(%{"sidebar_needs_review" => needs_review}) when is_boolean(needs_review),
    do: needs_review

  defp sidebar_needs_review(_metadata), do: false

  defp iso8601(%DateTime{} = datetime) do
    datetime
    |> DateTime.truncate(:second)
    |> DateTime.to_iso8601()
  end

  defp iso8601(_datetime), do: nil
end
