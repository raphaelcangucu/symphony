defmodule SymphonyElixir.LocalTracker.Context do
  @moduledoc """
  Persistence boundary for Symphony's local tracker.
  """

  import Ecto.Query

  alias SymphonyElixir.LocalTracker.{
    ActivityEvent,
    Broadcaster,
    Comment,
    IssueRecord,
    IssueRelation,
    Project,
    ProjectSetup,
    Repository,
    Seeds,
    WorkflowStatus
  }

  alias SymphonyElixir.Repo

  @issue_preloads [:project, :status]
  @default_issue_status "Todo"

  @type missing_error ::
          :project_not_found | :issue_not_found | :status_not_found | :blocker_not_found

  @spec ensure_project(map()) :: {:ok, Project.t()} | {:error, Ecto.Changeset.t()}
  def ensure_project(attrs) when is_map(attrs) do
    changeset = Project.changeset(%Project{}, attrs)

    if changeset.valid? do
      slug = Ecto.Changeset.get_change(changeset, :slug)

      case Repo.get_by(Project, slug: slug) do
        nil -> create_project_with_default_statuses(attrs)
        %Project{} = project -> ensure_default_statuses(project) |> tap_project_event("project_updated")
      end
    else
      {:error, changeset}
    end
  end

  @spec create_workspace_project(map()) :: {:ok, Project.t()} | {:error, Ecto.Changeset.t()}
  def create_workspace_project(attrs) when is_map(attrs) do
    Repo.transaction(fn ->
      with {:ok, project} <- insert_project(project_attrs(attrs)),
           {:ok, _statuses} <- insert_workspace_statuses(project, attr(attrs, :workflow_statuses, [])),
           {:ok, _repositories} <- insert_workspace_repositories(project, attr(attrs, :repositories, [])),
           {:ok, _setup} <- insert_workspace_setup(project, attr(attrs, :setup, %{})) do
        Broadcaster.project_changed("project_created", project)
        project
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  @spec list_projects() :: [Project.t()]
  def list_projects do
    Project
    |> order_by([project], asc: project.name)
    |> Repo.all()
  end

  @spec get_project(String.t()) :: {:ok, Project.t()} | {:error, :project_not_found}
  def get_project(project_slug) when is_binary(project_slug), do: fetch_project(project_slug)

  @spec list_statuses(String.t()) :: [WorkflowStatus.t()]
  def list_statuses(project_slug) when is_binary(project_slug) do
    case Repo.get_by(Project, slug: project_slug) do
      nil ->
        []

      %Project{} = project ->
        statuses_for_project(project.id)
    end
  end

  @spec list_repositories(String.t()) :: [Repository.t()]
  def list_repositories(project_slug) when is_binary(project_slug) do
    case Repo.get_by(Project, slug: project_slug) do
      nil ->
        []

      %Project{} = project ->
        Repository
        |> where([repository], repository.project_id == ^project.id)
        |> order_by([repository], asc: repository.workspace_path)
        |> Repo.all()
    end
  end

  @spec get_project_setup(String.t()) :: ProjectSetup.t() | nil
  def get_project_setup(project_slug) when is_binary(project_slug) do
    case Repo.get_by(Project, slug: project_slug) do
      nil -> nil
      %Project{} = project -> Repo.get_by(ProjectSetup, project_id: project.id)
    end
  end

  @spec list_issues(String.t()) :: [IssueRecord.t()]
  def list_issues(project_slug) when is_binary(project_slug) do
    case fetch_project(project_slug) do
      {:ok, project} ->
        IssueRecord
        |> where([issue], issue.project_id == ^project.id)
        |> order_by([issue], asc: issue.position, asc: issue.id)
        |> preload(^@issue_preloads)
        |> Repo.all()

      {:error, :project_not_found} ->
        []
    end
  end

  @spec get_issue(String.t(), String.t()) :: {:ok, IssueRecord.t()} | {:error, missing_error()}
  def get_issue(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, issue} <- fetch_project_issue(project.id, identifier) do
      {:ok, Repo.preload(issue, @issue_preloads)}
    end
  end

  @spec create_issue(String.t(), map()) ::
          {:ok, IssueRecord.t()} | {:error, Ecto.Changeset.t() | missing_error()}
  def create_issue(project_slug, attrs) when is_binary(project_slug) and is_map(attrs) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, status} <- fetch_status(project.id, attr(attrs, :status, @default_issue_status)) do
      position = attr(attrs, :position, next_issue_position(project.id, status.id))

      attrs
      |> issue_create_attrs()
      |> Map.merge(%{
        project_id: project.id,
        status_id: status.id,
        identifier: next_identifier(project),
        position: position
      })
      |> insert_issue()
    end
  end

  @spec update_issue(String.t(), String.t(), map()) ::
          {:ok, IssueRecord.t()} | {:error, Ecto.Changeset.t() | missing_error()}
  def update_issue(project_slug, identifier, attrs)
      when is_binary(project_slug) and is_binary(identifier) and is_map(attrs) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, issue} <- fetch_project_issue(project.id, identifier),
         {:ok, status} <- fetch_move_status(project.id, attrs, issue.status_id) do
      changes =
        attrs
        |> mutable_issue_attrs()
        |> Map.put(:status_id, status.id)
        |> maybe_put_started_at(issue, status)
        |> maybe_put_completed_at(status)

      issue
      |> IssueRecord.changeset(changes)
      |> Repo.update()
      |> preload_issue_result()
      |> tap_issue_event("issue_updated", %{status: status.name})
    end
  end

  @spec move_issue(String.t(), String.t(), map()) ::
          {:ok, IssueRecord.t()} | {:error, Ecto.Changeset.t() | missing_error()}
  def move_issue(project_slug, identifier, attrs)
      when is_binary(project_slug) and is_binary(identifier) and is_map(attrs) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, issue} <- fetch_project_issue(project.id, identifier),
         {:ok, status} <- fetch_move_status(project.id, attrs, issue.status_id) do
      project.id
      |> persist_moved_issue(issue, status, attrs)
      |> tap_issue_event("issue_moved", %{status: status.name})
    end
  end

  @spec update_issue_state(String.t(), String.t(), String.t()) ::
          {:ok, IssueRecord.t()} | {:error, Ecto.Changeset.t() | missing_error()}
  def update_issue_state(project_slug, identifier, state_name)
      when is_binary(project_slug) and is_binary(identifier) and is_binary(state_name) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, issue} <- fetch_project_issue(project.id, identifier),
         {:ok, status} <- fetch_status(issue.project_id, state_name) do
      changes =
        %{status_id: status.id}
        |> maybe_put_started_at(issue, status)
        |> maybe_put_completed_at(status)

      issue
      |> IssueRecord.changeset(changes)
      |> Repo.update()
      |> preload_issue_result()
      |> tap_issue_event("issue_updated", %{status: status.name})
    end
  end

  @spec add_comment(String.t(), String.t(), String.t(), map()) ::
          {:ok, Comment.t()} | {:error, Ecto.Changeset.t() | missing_error()}
  def add_comment(project_slug, identifier, body, attrs \\ %{})
      when is_binary(project_slug) and is_binary(identifier) and is_binary(body) and is_map(attrs) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, issue} <- fetch_project_issue(project.id, identifier) do
      attrs
      |> Map.new()
      |> Map.take([:kind, "kind", :author, "author"])
      |> normalize_keys()
      |> Map.merge(%{
        issue_id: issue.id,
        body: body,
        kind: attr(attrs, :kind, "comment"),
        author: attr(attrs, :author, "local")
      })
      |> then(&Comment.changeset(%Comment{}, &1))
      |> Repo.insert()
      |> tap_comment_event(issue)
    end
  end

  @spec list_comments(String.t(), String.t()) :: {:ok, [Comment.t()]} | {:error, missing_error()}
  def list_comments(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, issue} <- fetch_project_issue(project.id, identifier) do
      comments =
        Comment
        |> where([comment], comment.issue_id == ^issue.id)
        |> order_by([comment], asc: comment.inserted_at, asc: comment.id)
        |> Repo.all()

      {:ok, comments}
    end
  end

  @spec add_blocker(String.t(), String.t(), String.t(), String.t()) ::
          {:ok, IssueRelation.t()} | {:error, Ecto.Changeset.t() | missing_error()}
  def add_blocker(project_slug, source_identifier, target_identifier, type \\ "blocked_by")
      when is_binary(project_slug) and is_binary(source_identifier) and is_binary(target_identifier) and
             is_binary(type) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, source_issue} <- fetch_project_issue(project.id, source_identifier),
         {:ok, target_issue} <- fetch_project_issue(project.id, target_identifier) do
      %{
        source_issue_id: source_issue.id,
        target_issue_id: target_issue.id,
        type: type
      }
      |> then(&IssueRelation.changeset(%IssueRelation{}, &1))
      |> Repo.insert()
      |> preload_relation_result()
      |> tap_relation_event(source_issue)
    end
  end

  @spec list_blockers(String.t(), String.t()) :: {:ok, [IssueRelation.t()]} | {:error, missing_error()}
  def list_blockers(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, issue} <- fetch_project_issue(project.id, identifier) do
      relations =
        IssueRelation
        |> where([relation], relation.source_issue_id == ^issue.id)
        |> order_by([relation], asc: relation.inserted_at, asc: relation.id)
        |> preload([:source_issue, :target_issue])
        |> Repo.all()

      {:ok, relations}
    end
  end

  @spec delete_blocker(String.t(), String.t(), String.t(), String.t()) ::
          {:ok, IssueRelation.t()} | {:error, Ecto.Changeset.t() | missing_error()}
  def delete_blocker(project_slug, source_identifier, target_identifier, type \\ "blocked_by")
      when is_binary(project_slug) and is_binary(source_identifier) and is_binary(target_identifier) and
             is_binary(type) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, source_issue} <- fetch_project_issue(project.id, source_identifier),
         {:ok, target_issue} <- fetch_project_issue(project.id, target_identifier),
         {:ok, relation} <- fetch_relation(source_issue.id, target_issue.id, type) do
      relation
      |> Repo.delete()
      |> tap_relation_event(source_issue)
    end
  end

  defp create_project_with_default_statuses(attrs) do
    Repo.transaction(fn ->
      with {:ok, project} <- insert_project(attrs),
           {:ok, project} <- ensure_default_statuses(project) do
        Broadcaster.project_changed("project_created", project)
        project
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  defp insert_project(attrs) do
    %Project{}
    |> Project.changeset(attrs)
    |> Repo.insert()
  end

  defp insert_workspace_statuses(%Project{} = project, statuses) do
    statuses
    |> normalize_statuses()
    |> Enum.reduce_while({:ok, []}, fn attrs, {:ok, acc} ->
      attrs = Map.put(attrs, :project_id, project.id)

      %WorkflowStatus{}
      |> WorkflowStatus.changeset(attrs)
      |> Repo.insert()
      |> case do
        {:ok, status} -> {:cont, {:ok, [status | acc]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp insert_workspace_repositories(%Project{} = project, repositories) when is_list(repositories) do
    repositories
    |> Enum.map(&repository_attrs(project, &1))
    |> Enum.reduce_while({:ok, []}, fn attrs, {:ok, acc} ->
      %Repository{}
      |> Repository.changeset(attrs)
      |> Repo.insert()
      |> case do
        {:ok, repository} -> {:cont, {:ok, [repository | acc]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp insert_workspace_repositories(_project, _repositories), do: {:error, workspace_changeset_error(:repositories)}

  defp insert_workspace_setup(%Project{} = project, setup_attrs) when is_map(setup_attrs) do
    %ProjectSetup{}
    |> ProjectSetup.changeset(setup_attrs(project, setup_attrs))
    |> Repo.insert()
  end

  defp insert_workspace_setup(_project, _setup_attrs), do: {:error, workspace_changeset_error(:setup)}

  defp project_attrs(attrs) do
    %{
      name: attr(attrs, :name),
      slug: attr(attrs, :slug),
      description: attr(attrs, :description)
    }
  end

  defp normalize_statuses([]), do: normalize_default_statuses()

  defp normalize_statuses(statuses) when is_list(statuses) do
    Enum.map(statuses, fn status ->
      %{
        name: attr(status, :name),
        category: attr(status, :category, "active"),
        position: attr(status, :position, 0),
        is_terminal: attr(status, :is_terminal, false)
      }
    end)
  end

  defp normalize_statuses(_statuses), do: []

  defp normalize_default_statuses do
    Seeds.default_statuses()
    |> Enum.with_index()
    |> Enum.map(fn {{name, category, is_terminal}, position} ->
      %{name: name, category: category, position: position, is_terminal: is_terminal}
    end)
  end

  defp repository_attrs(%Project{} = project, attrs) when is_map(attrs) do
    %{
      project_id: project.id,
      github_full_name: attr(attrs, :github_full_name),
      clone_url: attr(attrs, :clone_url),
      default_branch: attr(attrs, :default_branch),
      selected_branch: attr(attrs, :selected_branch),
      local_path: attr(attrs, :local_path),
      workspace_path: attr(attrs, :workspace_path),
      role: attr(attrs, :role),
      scan_summary: attr(attrs, :scan_summary, %{})
    }
  end

  defp setup_attrs(%Project{} = project, attrs) do
    %{
      project_id: project.id,
      workflow_config: attr(attrs, :workflow_config, %{}),
      after_create_hook: attr(attrs, :after_create_hook),
      prompt_template: attr(attrs, :prompt_template),
      validation_commands: validation_commands_attrs(attr(attrs, :validation_commands, [])),
      scan_summary: attr(attrs, :scan_summary, %{})
    }
  end

  defp validation_commands_attrs(commands) when is_list(commands), do: %{"commands" => commands}
  defp validation_commands_attrs(%{} = commands), do: commands
  defp validation_commands_attrs(_commands), do: %{"commands" => []}

  defp workspace_changeset_error(field) do
    {%Project{}, %{field => ["is invalid"]}}
  end

  defp ensure_default_statuses(%Project{} = project) do
    Seeds.default_statuses()
    |> Enum.with_index()
    |> Enum.reduce_while({:ok, project}, fn {{name, category, is_terminal}, position}, {:ok, project} ->
      attrs = %{
        project_id: project.id,
        name: name,
        category: category,
        position: position,
        is_terminal: is_terminal
      }

      %WorkflowStatus{}
      |> WorkflowStatus.changeset(attrs)
      |> Repo.insert(
        on_conflict: :nothing,
        conflict_target: [:project_id, :name]
      )
      |> case do
        {:ok, _status} -> {:cont, {:ok, project}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp tap_project_event({:ok, %Project{} = project} = result, event_name) do
    Broadcaster.project_changed(event_name, project)
    result
  end

  defp tap_project_event(result, _event_name), do: result

  defp statuses_for_project(project_id) do
    WorkflowStatus
    |> where([status], status.project_id == ^project_id)
    |> order_by([status], asc: status.position)
    |> Repo.all()
  end

  defp fetch_project(project_slug) do
    case Repo.get_by(Project, slug: project_slug) do
      nil -> {:error, :project_not_found}
      %Project{} = project -> {:ok, project}
    end
  end

  defp fetch_status(project_id, status_name) when is_binary(status_name) do
    case Repo.get_by(WorkflowStatus, project_id: project_id, name: status_name) do
      nil -> {:error, :status_not_found}
      %WorkflowStatus{} = status -> {:ok, status}
    end
  end

  defp fetch_status(_project_id, _status_name), do: {:error, :status_not_found}

  defp fetch_move_status(project_id, attrs, current_status_id) do
    case attr(attrs, :status) || attr(attrs, :state) || attr(attrs, :status_name) do
      nil -> {:ok, Repo.get!(WorkflowStatus, current_status_id)}
      status_name -> fetch_status(project_id, status_name)
    end
  end

  defp fetch_project_issue(project_id, identifier) do
    IssueRecord
    |> where([issue], issue.project_id == ^project_id and issue.identifier == ^identifier)
    |> Repo.one()
    |> case do
      nil -> {:error, :issue_not_found}
      %IssueRecord{} = issue -> {:ok, issue}
    end
  end

  defp fetch_relation(source_issue_id, target_issue_id, type) do
    IssueRelation
    |> where(
      [relation],
      relation.source_issue_id == ^source_issue_id and relation.target_issue_id == ^target_issue_id and
        relation.type == ^type
    )
    |> preload([:source_issue, :target_issue])
    |> Repo.one()
    |> case do
      nil -> {:error, :blocker_not_found}
      %IssueRelation{} = relation -> {:ok, relation}
    end
  end

  defp insert_issue(attrs) do
    %IssueRecord{}
    |> IssueRecord.changeset(attrs)
    |> Repo.insert()
    |> preload_issue_result()
    |> tap_issue_event("issue_created", %{})
  end

  defp persist_moved_issue(project_id, %IssueRecord{} = issue, %WorkflowStatus{} = status, attrs) do
    Repo.transaction(fn ->
      target_position = requested_issue_position(attrs, issue.position)

      with {:ok, moved_position} <- reorder_issue_siblings(project_id, issue, status.id, target_position),
           {:ok, moved_issue} <- update_moved_issue(issue, status, attrs, moved_position) do
        moved_issue
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  defp reorder_issue_siblings(project_id, %IssueRecord{} = issue, target_status_id, target_position) do
    if issue.status_id == target_status_id do
      reorder_same_status_siblings(project_id, issue, target_position)
    else
      reorder_cross_status_siblings(project_id, issue, target_status_id, target_position)
    end
  end

  defp reorder_same_status_siblings(project_id, %IssueRecord{} = issue, target_position) do
    siblings = ordered_sibling_issues(project_id, issue.status_id, issue.id)
    target_index = clamp_position(target_position, length(siblings))
    ordered_issues = List.insert_at(siblings, target_index, issue)

    with :ok <- update_sibling_positions(ordered_issues, issue.id) do
      {:ok, target_index}
    end
  end

  defp reorder_cross_status_siblings(project_id, %IssueRecord{} = issue, target_status_id, target_position) do
    source_siblings = ordered_sibling_issues(project_id, issue.status_id, issue.id)
    target_siblings = ordered_sibling_issues(project_id, target_status_id, issue.id)
    target_index = clamp_position(target_position, length(target_siblings))
    ordered_target_issues = List.insert_at(target_siblings, target_index, issue)

    with :ok <- update_sibling_positions(source_siblings, issue.id),
         :ok <- update_sibling_positions(ordered_target_issues, issue.id) do
      {:ok, target_index}
    end
  end

  defp ordered_sibling_issues(project_id, status_id, moving_issue_id) do
    IssueRecord
    |> where([issue], issue.project_id == ^project_id and issue.status_id == ^status_id and issue.id != ^moving_issue_id)
    |> order_by([issue], asc: issue.position, asc: issue.id)
    |> Repo.all()
  end

  defp update_sibling_positions(issues, moving_issue_id) do
    issues
    |> Enum.with_index()
    |> Enum.reduce_while(:ok, fn
      {%IssueRecord{id: ^moving_issue_id}, _position}, :ok ->
        {:cont, :ok}

      {%IssueRecord{} = issue, position}, :ok ->
        case issue |> IssueRecord.changeset(%{position: position}) |> Repo.update() do
          {:ok, _issue} -> {:cont, :ok}
          {:error, reason} -> {:halt, {:error, reason}}
        end
    end)
  end

  defp update_moved_issue(%IssueRecord{} = issue, %WorkflowStatus{} = status, attrs, position) do
    changes =
      attrs
      |> mutable_issue_attrs()
      |> Map.merge(%{status_id: status.id, position: position})
      |> maybe_put_started_at(issue, status)
      |> maybe_put_completed_at(status)

    issue
    |> IssueRecord.changeset(changes)
    |> Repo.update()
    |> preload_issue_result()
  end

  defp requested_issue_position(attrs, current_position) do
    case Ecto.Type.cast(:integer, attr(attrs, :position, current_position)) do
      {:ok, position} -> max(position, 0)
      :error -> current_position
    end
  end

  defp clamp_position(position, sibling_count) do
    position
    |> max(0)
    |> min(sibling_count)
  end

  defp next_identifier(project) do
    prefix =
      project.slug
      |> String.replace(~r/[^[:alnum:]]/, "")
      |> String.slice(0, 3)
      |> String.upcase()
      |> case do
        "" -> "LOC"
        value -> value
      end

    current_max =
      IssueRecord
      |> where([issue], issue.project_id == ^project.id)
      |> select([issue], issue.identifier)
      |> Repo.all()
      |> Enum.map(&identifier_number(&1, prefix))
      |> Enum.max(fn -> 0 end)

    next_number = current_max + 1

    "#{prefix}-#{next_number}"
  end

  defp identifier_number(identifier, prefix) do
    case Regex.run(~r/^#{Regex.escape(prefix)}-(\d+)$/, identifier) do
      [_, number] -> String.to_integer(number)
      _other -> 0
    end
  end

  defp next_issue_position(project_id, status_id) do
    IssueRecord
    |> where([issue], issue.project_id == ^project_id and issue.status_id == ^status_id)
    |> select([issue], count(issue.id))
    |> Repo.one()
  end

  defp mutable_issue_attrs(attrs) do
    attrs
    |> Map.new()
    |> Map.take([
      :title,
      "title",
      :description,
      "description",
      :priority,
      "priority",
      :position,
      "position",
      :assignee_id,
      "assignee_id",
      :worker_id,
      "worker_id",
      :branch_name,
      "branch_name",
      :url,
      "url",
      :started_at,
      "started_at",
      :completed_at,
      "completed_at"
    ])
    |> normalize_keys()
  end

  defp issue_create_attrs(attrs) do
    attrs
    |> Map.new()
    |> Map.take([
      :title,
      "title",
      :description,
      "description",
      :priority,
      "priority",
      :assignee_id,
      "assignee_id",
      :worker_id,
      "worker_id",
      :branch_name,
      "branch_name",
      :url,
      "url"
    ])
    |> normalize_keys()
  end

  defp normalize_keys(attrs) do
    Map.new(attrs, fn
      {key, value} when is_binary(key) -> {String.to_existing_atom(key), value}
      {key, value} -> {key, value}
    end)
  end

  defp maybe_put_started_at(changes, issue, %WorkflowStatus{name: "In Progress"}) do
    Map.put_new(changes, :started_at, issue.started_at || DateTime.utc_now())
  end

  defp maybe_put_started_at(changes, _issue, _status), do: changes

  defp maybe_put_completed_at(changes, %WorkflowStatus{is_terminal: true}) do
    Map.put_new(changes, :completed_at, DateTime.utc_now())
  end

  defp maybe_put_completed_at(changes, _status), do: changes

  defp preload_issue_result({:ok, %IssueRecord{} = issue}), do: {:ok, Repo.preload(issue, @issue_preloads)}
  defp preload_issue_result(result), do: result

  defp preload_relation_result({:ok, %IssueRelation{} = relation}) do
    {:ok, Repo.preload(relation, [:source_issue, :target_issue])}
  end

  defp preload_relation_result(result), do: result

  defp tap_issue_event({:ok, %IssueRecord{} = issue} = result, event_type, metadata) do
    insert_event(issue.id, event_type, metadata)
    Broadcaster.issue_changed(event_type, issue)
    result
  end

  defp tap_issue_event(result, _event_type, _metadata), do: result

  defp tap_comment_event({:ok, %Comment{} = comment} = result, issue) do
    insert_event(issue.id, "comment_created", %{comment_id: comment.id})
    Broadcaster.comment_created(Repo.preload(issue, :project), comment)
    result
  end

  defp tap_comment_event(result, _issue), do: result

  defp tap_relation_event({:ok, %IssueRelation{} = relation} = result, issue) do
    insert_event(issue.id, "blocker_changed", %{relation_id: relation.id})
    Broadcaster.blocker_changed(Repo.preload(issue, :project), relation)
    result
  end

  defp tap_relation_event(result, _issue), do: result

  defp insert_event(issue_id, event_type, metadata) do
    %ActivityEvent{}
    |> ActivityEvent.changeset(%{issue_id: issue_id, event_type: event_type, metadata: metadata})
    |> Repo.insert()
  end

  defp attr(attrs, key, default \\ nil) do
    Map.get(attrs, key, Map.get(attrs, Atom.to_string(key), default))
  end
end
