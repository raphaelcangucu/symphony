defmodule SymphonyElixir.LocalTracker.Context do
  @moduledoc """
  Persistence boundary for Symphony's local tracker.
  """

  import Ecto.Query

  alias SymphonyElixir.AgentRouting
  alias SymphonyElixir.Config
  alias SymphonyElixir.Tracker.ExternalUrl

  alias SymphonyElixir.LocalTracker.{
    ActivityEvent,
    Broadcaster,
    Comment,
    IssueLabel,
    IssueRecord,
    IssueRelation,
    Label,
    Project,
    ProjectSetup,
    Repository,
    Seeds,
    WorkflowStatus
  }

  alias SymphonyElixir.Repo

  @issue_preloads [:project, :status, :labels]
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
    project_attributes = project_attrs(attrs)
    remote? = project_attributes.tracker_kind in ["github", "linear"]

    Repo.transaction(fn ->
      with {:ok, project} <- insert_project(project_attributes),
           {:ok, _statuses} <- maybe_insert_statuses(project, attrs, remote?),
           {:ok, _repositories} <- insert_workspace_repositories(project, attr(attrs, :repositories, [])),
           {:ok, _setup} <- maybe_insert_setup(project, attrs, remote?) do
        Broadcaster.project_changed("project_created", project)
        project
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  defp maybe_insert_statuses(_project, _attrs, true), do: {:ok, []}

  defp maybe_insert_statuses(project, attrs, false),
    do: insert_workspace_statuses(project, attr(attrs, :workflow_statuses, []))

  defp maybe_insert_setup(_project, _attrs, true), do: {:ok, nil}

  defp maybe_insert_setup(project, attrs, false),
    do: insert_workspace_setup(project, attr(attrs, :setup, %{}))

  @spec list_projects(keyword()) :: [Project.t()]
  def list_projects(opts \\ []) when is_list(opts) do
    include_archived? = Keyword.get(opts, :include_archived, false)

    Project
    |> maybe_active_projects(include_archived?)
    |> order_by([project], asc: project.name)
    |> Repo.all()
  end

  @spec get_project(String.t()) :: {:ok, Project.t()} | {:error, :project_not_found}
  def get_project(project_slug) when is_binary(project_slug), do: fetch_project(project_slug)

  @spec archive_project(String.t()) :: {:ok, Project.t()} | {:error, missing_error()}
  def archive_project(project_slug) when is_binary(project_slug) do
    with {:ok, project} <- fetch_project(project_slug) do
      project
      |> Ecto.Changeset.change(archived_at: DateTime.utc_now())
      |> Repo.update()
      |> tap_project_event("project_archived")
    end
  end

  @spec restore_project(String.t()) :: {:ok, Project.t()} | {:error, missing_error()}
  def restore_project(project_slug) when is_binary(project_slug) do
    with {:ok, project} <- fetch_project(project_slug) do
      project
      |> Ecto.Changeset.change(archived_at: nil)
      |> Repo.update()
      |> tap_project_event("project_restored")
    end
  end

  @spec delete_project(String.t()) :: {:ok, Project.t()} | {:error, missing_error() | :project_not_archived}
  def delete_project(project_slug) when is_binary(project_slug) do
    with {:ok, project} <- fetch_project(project_slug),
         :ok <- ensure_project_archived(project) do
      delete_archived_project(project)
    end
  end

  @spec update_project(String.t(), map()) ::
          {:ok, Project.t()} | {:error, Ecto.Changeset.t() | missing_error()}
  def update_project(project_slug, attrs) when is_binary(project_slug) and is_map(attrs) do
    with {:ok, project} <- fetch_project(project_slug) do
      project
      |> Project.changeset(project_update_attrs(attrs))
      |> Repo.update()
      |> tap_project_event("project_updated")
    end
  end

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

  @spec replace_repositories(String.t(), [map()]) ::
          {:ok, [Repository.t()]} | {:error, :project_not_found | Ecto.Changeset.t()}
  def replace_repositories(project_slug, repositories)
      when is_binary(project_slug) and is_list(repositories) do
    with {:ok, project} <- fetch_project(project_slug) do
      Repo.transaction(fn ->
        Repository
        |> where([repository], repository.project_id == ^project.id)
        |> Repo.delete_all()

        case insert_workspace_repositories(project, repositories) do
          {:ok, inserted} ->
            Broadcaster.project_changed("project_updated", project)
            inserted

          {:error, reason} ->
            Repo.rollback(reason)
        end
      end)
    end
  end

  @spec get_project_setup(String.t()) :: ProjectSetup.t() | nil
  def get_project_setup(project_slug) when is_binary(project_slug) do
    case Repo.get_by(Project, slug: project_slug) do
      nil -> nil
      %Project{} = project -> Repo.get_by(ProjectSetup, project_id: project.id)
    end
  end

  @spec upsert_project_setup(String.t(), map()) ::
          {:ok, ProjectSetup.t()} | {:error, :project_not_found | Ecto.Changeset.t()}
  def upsert_project_setup(project_slug, attrs) when is_binary(project_slug) and is_map(attrs) do
    with {:ok, project} <- fetch_project(project_slug) do
      existing = Repo.get_by(ProjectSetup, project_id: project.id) || %ProjectSetup{}

      existing
      |> ProjectSetup.changeset(upsert_setup_attrs(project, normalize_setup_attrs(attrs)))
      |> Repo.insert_or_update()
      |> case do
        {:ok, setup} ->
          Broadcaster.project_changed("project_updated", project)
          {:ok, setup}

        {:error, changeset} ->
          {:error, changeset}
      end
    end
  end

  @spec count_issues_by_project_ids([integer()]) :: %{integer() => non_neg_integer()}
  def count_issues_by_project_ids(project_ids) when is_list(project_ids) do
    case Enum.reject(project_ids, &is_nil/1) do
      [] ->
        %{}

      ids ->
        IssueRecord
        |> where([issue], issue.project_id in ^ids)
        |> group_by([issue], issue.project_id)
        |> select([issue], {issue.project_id, count(issue.id)})
        |> Repo.all()
        |> Map.new()
    end
  end

  @spec list_issues(String.t(), keyword()) :: [IssueRecord.t()]
  def list_issues(project_slug, opts \\ []) when is_binary(project_slug) and is_list(opts) do
    case fetch_project(project_slug) do
      {:ok, project} ->
        IssueRecord
        |> where([issue], issue.project_id == ^project.id)
        |> apply_issue_filters(opts)
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

  @doc """
  Resolves the project slug for an issue identifier alone. Returns `nil` when no
  issue matches or when the identifier maps to more than one distinct project
  (ambiguous), so callers can fall back to a non-project-scoped behavior.
  """
  @spec find_project_slug(String.t()) :: String.t() | nil
  def find_project_slug(identifier) when is_binary(identifier) do
    slugs =
      from(issue in IssueRecord,
        join: project in assoc(issue, :project),
        where: issue.identifier == ^identifier,
        distinct: true,
        select: project.slug
      )
      |> Repo.all()

    case slugs do
      [slug] -> slug
      _ -> nil
    end
  end

  def find_project_slug(_identifier), do: nil

  @spec create_issue(String.t(), map()) ::
          {:ok, IssueRecord.t()} | {:error, Ecto.Changeset.t() | missing_error()}
  def create_issue(project_slug, attrs) when is_binary(project_slug) and is_map(attrs) do
    with {:ok, project} <- fetch_project(project_slug),
         :ok <- ensure_project_statuses(project),
         {:ok, status} <- fetch_status(project.id, attr(attrs, :status, @default_issue_status)) do
      position = attr(attrs, :position, next_issue_position(project.id, status.id))
      agent = attr(attrs, :agent)

      attrs
      |> issue_create_attrs()
      |> Map.merge(%{
        project_id: project.id,
        status_id: status.id,
        identifier: next_identifier(project),
        position: position,
        agent: agent
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
      |> sync_agent_routing_label_result(project.id, attr(attrs, :agent))
      |> preload_issue_result()
      |> tap_issue_event("issue_updated", %{status: status.name})
    end
  end

  @spec set_agent_session_id(String.t(), String.t(), String.t()) ::
          {:ok, IssueRecord.t()} | {:error, Ecto.Changeset.t() | missing_error()}
  def set_agent_session_id(project_slug, identifier, agent_session_id)
      when is_binary(project_slug) and is_binary(identifier) and is_binary(agent_session_id) and
             agent_session_id != "" do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, issue} <- fetch_project_issue(project.id, identifier) do
      issue
      |> IssueRecord.changeset(%{agent_session_id: agent_session_id})
      |> Repo.update()
      |> preload_issue_result()
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

  @spec archive_issue(String.t(), String.t()) ::
          {:ok, IssueRecord.t()} | {:error, Ecto.Changeset.t() | missing_error()}
  def archive_issue(project_slug, identifier)
      when is_binary(project_slug) and is_binary(identifier) do
    set_issue_archived_at(project_slug, identifier, DateTime.utc_now())
  end

  @spec restore_issue(String.t(), String.t()) ::
          {:ok, IssueRecord.t()} | {:error, Ecto.Changeset.t() | missing_error()}
  def restore_issue(project_slug, identifier)
      when is_binary(project_slug) and is_binary(identifier) do
    set_issue_archived_at(project_slug, identifier, nil)
  end

  @spec delete_issue(String.t(), String.t()) ::
          {:ok, IssueRecord.t()} | {:error, missing_error()}
  def delete_issue(project_slug, identifier)
      when is_binary(project_slug) and is_binary(identifier) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, issue} <- fetch_project_issue(project.id, identifier) do
      delete_issue_with_children(issue)
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

  @doc """
  Attaches a label (by name) to an issue, creating the label if needed. Idempotent:
  re-attaching an existing label is a no-op success.
  """
  @spec add_issue_label(String.t(), String.t(), String.t()) ::
          {:ok, IssueRecord.t()} | {:error, Ecto.Changeset.t() | missing_error()}
  def add_issue_label(project_slug, identifier, label_name)
      when is_binary(project_slug) and is_binary(identifier) and is_binary(label_name) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, issue} <- fetch_project_issue(project.id, identifier),
         {:ok, label} <- ensure_label(project.id, label_name),
         {:ok, _issue_label} <- ensure_issue_label_idempotent(issue.id, label.id) do
      {:ok, issue}
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

  @doc """
  Lists the append-only activity events for an issue, newest first.
  """
  @spec list_activity_events(String.t(), String.t()) ::
          {:ok, [ActivityEvent.t()]} | {:error, term()}
  def list_activity_events(project_slug, identifier)
      when is_binary(project_slug) and is_binary(identifier) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, issue} <- fetch_project_issue(project.id, identifier) do
      events =
        ActivityEvent
        |> where([event], event.issue_id == ^issue.id)
        |> order_by([event], desc: event.inserted_at, desc: event.id)
        |> Repo.all()

      {:ok, events}
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

  defp project_update_attrs(attrs) do
    base =
      %{}
      |> copy_present(attrs, :name, :name)
      |> copy_present(attrs, :description, :description)

    case fetch_attr(attrs, :tracker) do
      {:ok, tracker} when is_map(tracker) ->
        base
        |> copy_present(tracker, :kind, :tracker_kind)
        |> copy_tracker_config(tracker)

      _absent ->
        base
    end
  end

  defp copy_present(map, source, source_key, target_key) do
    case fetch_attr(source, source_key) do
      {:ok, value} -> Map.put(map, target_key, value)
      :error -> map
    end
  end

  defp copy_tracker_config(map, tracker) do
    kind =
      case fetch_attr(tracker, :kind) do
        {:ok, value} -> value
        :error -> Map.get(map, :tracker_kind)
      end

    case fetch_attr(tracker, :config) do
      {:ok, config} when is_map(config) ->
        config =
          if kind == "github" do
            ExternalUrl.enrich_github_config(config)
          else
            config
          end

        Map.put(map, :tracker_config, config)

      _absent ->
        map
    end
  end

  defp fetch_attr(attrs, key) when is_map(attrs) and is_atom(key) do
    string_key = Atom.to_string(key)

    cond do
      Map.has_key?(attrs, key) -> {:ok, Map.get(attrs, key)}
      Map.has_key?(attrs, string_key) -> {:ok, Map.get(attrs, string_key)}
      true -> :error
    end
  end

  defp project_attrs(attrs) do
    tracker = attr(attrs, :tracker, %{})
    tracker_kind = attr(tracker, :kind, "local")
    tracker_config = attr(tracker, :config, %{})

    tracker_config =
      if tracker_kind == "github" do
        ExternalUrl.enrich_github_config(tracker_config)
      else
        tracker_config
      end

    %{
      name: attr(attrs, :name),
      slug: attr(attrs, :slug),
      description: attr(attrs, :description),
      tracker_kind: tracker_kind,
      tracker_config: tracker_config
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
      workflow_markdown: attr(attrs, :workflow_markdown),
      after_create_hook: attr(attrs, :after_create_hook),
      validation_commands: validation_commands_attrs(attr(attrs, :validation_commands, [])),
      scan_summary: attr(attrs, :scan_summary, %{})
    }
  end

  @setup_update_fields [
    :workflow_markdown,
    :after_create_hook,
    :validation_commands,
    :scan_summary
  ]

  defp normalize_setup_attrs(attrs) do
    Map.new(attrs, fn {key, value} -> {to_string(key), value} end)
  end

  defp upsert_setup_attrs(%Project{} = project, attrs) do
    Enum.reduce(@setup_update_fields, %{project_id: project.id}, fn field, acc ->
      case Map.fetch(attrs, Atom.to_string(field)) do
        {:ok, value} -> Map.put(acc, field, setup_field_value(field, value))
        :error -> acc
      end
    end)
  end

  defp setup_field_value(:validation_commands, value), do: validation_commands_attrs(value)
  defp setup_field_value(_field, value), do: value

  defp validation_commands_attrs(commands) when is_list(commands), do: %{"commands" => commands}
  defp validation_commands_attrs(%{} = commands), do: commands
  defp validation_commands_attrs(_commands), do: %{"commands" => []}

  defp workspace_changeset_error(field) do
    {%Project{}, %{field => ["is invalid"]}}
  end

  defp ensure_default_statuses(%Project{} = project) do
    case insert_status_tuples(project.id, Seeds.default_statuses()) do
      :ok -> {:ok, project}
      {:error, _reason} = error -> error
    end
  end

  # Local-first safety net: a remote-backed project skips status seeding at
  # creation time (statuses come from the remote board). When the remote is
  # unreachable the mirror can stay empty, which would block issue creation.
  # Seeding from the configured workflow states keeps creation local-first.
  defp ensure_project_statuses(%Project{id: project_id}) do
    case statuses_for_project(project_id) do
      [] -> insert_status_tuples(project_id, Config.workflow_statuses())
      [_ | _] -> :ok
    end
  end

  defp insert_status_tuples(project_id, status_tuples) do
    status_tuples
    |> Enum.with_index()
    |> Enum.reduce_while(:ok, fn {{name, category, is_terminal}, position}, :ok ->
      attrs = %{
        project_id: project_id,
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
        {:ok, _status} -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp tap_project_event({:ok, %Project{} = project} = result, event_name) do
    Broadcaster.project_changed(event_name, project)
    result
  end

  defp tap_project_event(result, _event_name), do: result

  defp maybe_active_projects(query, true), do: query

  defp maybe_active_projects(query, false), do: where(query, [project], is_nil(project.archived_at))

  defp apply_issue_filters(query, opts) do
    query
    |> maybe_filter_archived(Keyword.get(opts, :include_archived, false))
    |> maybe_filter_search(Keyword.get(opts, :search))
    |> maybe_filter_assignee(Keyword.get(opts, :assignee))
    |> maybe_filter_creator(Keyword.get(opts, :creator))
  end

  defp maybe_filter_archived(query, true), do: query
  defp maybe_filter_archived(query, _include), do: where(query, [issue], is_nil(issue.archived_at))

  defp maybe_filter_search(query, nil), do: query
  defp maybe_filter_search(query, ""), do: query

  defp maybe_filter_search(query, term) when is_binary(term) do
    escaped = escape_like_term(term)
    pattern = "%" <> escaped <> "%"

    where(
      query,
      [issue],
      fragment("? LIKE ? ESCAPE '\\'", issue.title, ^pattern) or
        fragment("? LIKE ? ESCAPE '\\'", issue.description, ^pattern) or
        fragment("? LIKE ? ESCAPE '\\'", issue.identifier, ^pattern)
    )
  end

  defp maybe_filter_search(query, _other), do: query

  defp maybe_filter_assignee(query, nil), do: query
  defp maybe_filter_assignee(query, ""), do: query

  defp maybe_filter_assignee(query, value) when is_binary(value) do
    where(query, [issue], issue.assignee_id == ^value)
  end

  defp maybe_filter_assignee(query, _other), do: query

  defp maybe_filter_creator(query, nil), do: query
  defp maybe_filter_creator(query, ""), do: query

  defp maybe_filter_creator(query, value) when is_binary(value) do
    where(query, [issue], issue.creator == ^value)
  end

  defp maybe_filter_creator(query, _other), do: query

  defp escape_like_term(term) do
    term
    |> String.trim()
    |> String.replace("\\", "\\\\")
    |> String.replace("%", "\\%")
    |> String.replace("_", "\\_")
  end

  defp ensure_project_archived(%Project{archived_at: nil}), do: {:error, :project_not_archived}

  defp ensure_project_archived(%Project{}), do: :ok

  defp delete_archived_project(%Project{} = project) do
    Repo.transaction(fn ->
      delete_project_owned_rows(project.id)

      case Repo.delete(project) do
        {:ok, deleted_project} -> deleted_project
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  defp delete_project_owned_rows(project_id) do
    issue_ids = project_issue_ids(project_id)
    label_ids = project_label_ids(project_id)

    delete_issue_owned_rows(issue_ids)
    delete_project_label_links(label_ids)

    Repo.delete_all(from(issue in IssueRecord, where: issue.project_id == ^project_id))
    Repo.delete_all(from(label in Label, where: label.project_id == ^project_id))
    Repo.delete_all(from(status in WorkflowStatus, where: status.project_id == ^project_id))
    Repo.delete_all(from(repository in Repository, where: repository.project_id == ^project_id))
    Repo.delete_all(from(setup in ProjectSetup, where: setup.project_id == ^project_id))
  end

  defp project_issue_ids(project_id) do
    IssueRecord
    |> where([issue], issue.project_id == ^project_id)
    |> select([issue], issue.id)
    |> Repo.all()
  end

  defp project_label_ids(project_id) do
    Label
    |> where([label], label.project_id == ^project_id)
    |> select([label], label.id)
    |> Repo.all()
  end

  defp delete_issue_owned_rows([]), do: :ok

  defp delete_issue_owned_rows(issue_ids) do
    Repo.delete_all(from(event in ActivityEvent, where: event.issue_id in ^issue_ids))
    Repo.delete_all(from(comment in Comment, where: comment.issue_id in ^issue_ids))
    Repo.delete_all(from(issue_label in IssueLabel, where: issue_label.issue_id in ^issue_ids))
    Repo.delete_all(from(relation in IssueRelation, where: relation.source_issue_id in ^issue_ids))
    Repo.delete_all(from(relation in IssueRelation, where: relation.target_issue_id in ^issue_ids))
  end

  defp delete_project_label_links([]), do: :ok

  defp delete_project_label_links(label_ids) do
    Repo.delete_all(from(issue_label in IssueLabel, where: issue_label.label_id in ^label_ids))
  end

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

  defp set_issue_archived_at(project_slug, identifier, archived_at) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, issue} <- fetch_project_issue(project.id, identifier) do
      issue
      |> IssueRecord.changeset(%{archived_at: archived_at})
      |> Repo.update()
      |> preload_issue_result()
    end
  end

  defp delete_issue_with_children(%IssueRecord{id: issue_id} = issue) do
    Repo.transaction(fn ->
      Repo.delete_all(from(event in ActivityEvent, where: event.issue_id == ^issue_id))
      Repo.delete_all(from(relation in IssueRelation, where: relation.source_issue_id == ^issue_id))
      Repo.delete_all(from(relation in IssueRelation, where: relation.target_issue_id == ^issue_id))
      Repo.delete_all(from(link in IssueLabel, where: link.issue_id == ^issue_id))
      Repo.delete_all(from(comment in Comment, where: comment.issue_id == ^issue_id))
      Repo.delete_all(from(pr in SymphonyElixir.Tracker.Sync.PullRequestRecord, where: pr.issue_id == ^issue_id))

      case Repo.delete(issue) do
        {:ok, deleted} -> deleted
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
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
    |> sync_agent_routing_label_result(Map.get(attrs, :project_id), attr(attrs, :agent))
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
    |> sync_agent_routing_label_result(issue.project_id, attr(attrs, :agent))
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
      :agent_goal,
      "agent_goal",
      :worker_id,
      "worker_id",
      :agent_session_id,
      "agent_session_id",
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
      :agent_goal,
      "agent_goal",
      :creator,
      "creator",
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

  defp sync_agent_routing_label_result({:ok, %IssueRecord{} = issue}, project_id, agent) do
    case normalize_agent_kind(agent) do
      nil -> {:ok, issue}
      agent_kind -> replace_agent_routing_label(issue, project_id, agent_kind)
    end
  end

  defp sync_agent_routing_label_result(result, _project_id, _agent), do: result

  defp replace_agent_routing_label(%IssueRecord{} = issue, project_id, agent_kind) when is_integer(project_id) do
    with :ok <- delete_agent_routing_labels(issue.id),
         {:ok, label} <- ensure_label(project_id, agent_label_name(agent_kind)),
         {:ok, _issue_label} <- ensure_issue_label(issue.id, label.id) do
      {:ok, issue}
    end
  end

  defp replace_agent_routing_label(%IssueRecord{} = issue, _project_id, _agent_kind), do: {:ok, issue}

  defp delete_agent_routing_labels(issue_id) do
    agent_label_ids =
      Label
      |> where([label], label.name in ^AgentRouting.agent_labels())
      |> select([label], label.id)
      |> Repo.all()

    if agent_label_ids != [] do
      IssueLabel
      |> where([issue_label], issue_label.issue_id == ^issue_id and issue_label.label_id in ^agent_label_ids)
      |> Repo.delete_all()
    end

    :ok
  end

  defp ensure_label(project_id, name) do
    case Repo.get_by(Label, project_id: project_id, name: name) do
      %Label{} = label ->
        {:ok, label}

      nil ->
        %Label{}
        |> Label.changeset(%{project_id: project_id, name: name})
        |> Repo.insert()
    end
  end

  defp ensure_issue_label(issue_id, label_id) do
    %IssueLabel{}
    |> IssueLabel.changeset(%{issue_id: issue_id, label_id: label_id})
    |> Repo.insert()
  end

  defp ensure_issue_label_idempotent(issue_id, label_id) do
    case Repo.get_by(IssueLabel, issue_id: issue_id, label_id: label_id) do
      %IssueLabel{} = existing -> {:ok, existing}
      nil -> ensure_issue_label(issue_id, label_id)
    end
  end

  defp normalize_agent_kind(agent) when is_binary(agent) do
    agent = agent |> String.trim() |> String.downcase()
    if agent in ["codex", "claude"], do: agent, else: nil
  end

  defp normalize_agent_kind(_agent), do: nil

  defp agent_label_name(agent_kind), do: "symphony:" <> agent_kind

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
