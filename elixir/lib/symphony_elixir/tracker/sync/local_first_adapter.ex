defmodule SymphonyElixir.Tracker.Sync.LocalFirstAdapter do
  @moduledoc """
  `Tracker.IssueAdapter` wrapper for remote-backed projects when local-first sync
  is enabled. Reads are served from the local store via `LocalTracker.IssueAdapter`.
  Writes persist locally, mark touched fields dirty for LWW, and enqueue an
  `Outbox` entry the sync engine pushes to the remote.
  """

  @behaviour SymphonyElixir.Tracker.IssueAdapter

  import Ecto.Query

  alias SymphonyElixir.LocalTracker.{Context, IssueAdapter, IssueRecord, Project}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Engine, GroupStatus, LocalStore, Outbox}

  @impl true
  def kind, do: :github

  @impl true
  def list_issues(%Project{} = project, filters) do
    Engine.ensure_seeded(project)
    maybe_request_sync_for_pending_work(project)
    IssueAdapter.list_issues(project, filters)
  end

  @impl true
  def get_issue(%Project{} = project, identifier) do
    Engine.ensure_seeded(project)

    with {:ok, dto} <- IssueAdapter.get_issue(project, identifier) do
      {:ok, %{dto | attachments: remote_attachments(project, identifier)}}
    end
  end

  @impl true
  def list_statuses(%Project{} = project), do: IssueAdapter.list_statuses(project)

  @impl true
  def list_labels(%Project{} = project), do: IssueAdapter.list_labels(project)

  @impl true
  def list_assignable_users(%Project{} = project), do: IssueAdapter.list_assignable_users(project)

  @impl true
  def list_comments(%Project{} = project, identifier), do: IssueAdapter.list_comments(project, identifier)

  @impl true
  def create_issue(%Project{} = project, attrs) do
    with {:ok, dto} <- IssueAdapter.create_issue(project, attrs) do
      enqueue(project, dto.identifier, "issue", "create", attrs, "issue:create:#{project.id}:#{dto.identifier}")
      {:ok, dto}
    end
  end

  @impl true
  def update_issue(%Project{} = project, identifier, attrs) do
    with {:ok, dto} <- IssueAdapter.update_issue(project, identifier, attrs) do
      LocalStore.mark_dirty(identifier, project.slug, dirty_fields(attrs))
      payload = attrs |> stringify() |> Map.put("identifier", identifier)
      enqueue(project, identifier, "issue", "update", payload, "issue:update:#{project.id}:#{identifier}")
      {:ok, dto}
    end
  end

  @impl true
  def move_issue(%Project{} = project, identifier, attrs) do
    with {:ok, before} <- Context.get_issue(project.slug, identifier),
         {:ok, dto} <- IssueAdapter.move_issue(project, identifier, attrs),
         :ok <- maybe_enqueue_status_move(project, dto, before, attrs) do
      {:ok, dto}
    end
  end

  @spec archive_issue(Project.t(), String.t()) :: {:ok, term()} | {:error, term()}
  def archive_issue(%Project{} = project, identifier) do
    with {:ok, dto} <- IssueAdapter.archive_issue(project, identifier) do
      payload = %{"identifier" => identifier}
      enqueue(project, identifier, "issue", "archive", payload, "issue:archive:#{project.id}:#{identifier}")
      {:ok, dto}
    end
  end

  @spec restore_issue(Project.t(), String.t()) :: {:ok, term()} | {:error, term()}
  def restore_issue(%Project{} = project, identifier) do
    with {:ok, dto} <- IssueAdapter.restore_issue(project, identifier) do
      payload = %{"identifier" => identifier}
      enqueue(project, identifier, "issue", "restore", payload, "issue:archive:#{project.id}:#{identifier}")
      {:ok, dto}
    end
  end

  @spec delete_issue(Project.t(), String.t()) :: {:ok, term()} | {:error, term()}
  def delete_issue(%Project{} = project, identifier) do
    with {:ok, dto} <- IssueAdapter.delete_issue(project, identifier) do
      payload = %{"identifier" => identifier}
      enqueue(project, identifier, "issue", "delete", payload, "issue:delete:#{project.id}:#{identifier}")
      {:ok, dto}
    end
  end

  @impl true
  def add_comment(%Project{} = project, identifier, body, attrs) do
    with {:ok, comment} <- IssueAdapter.add_comment(project, identifier, body, attrs),
         {:ok, comment} <- LocalStore.mark_comment_sync_status(comment.id, "pending") do
      payload = %{"identifier" => identifier, "body" => body, "comment_id" => comment.id}
      enqueue(project, identifier, "comment", "create", payload, nil)
      {:ok, comment}
    end
  end

  @impl true
  def update_comment(%Project{} = project, identifier, comment_id, body) do
    with {:ok, comment} <- IssueAdapter.update_comment(project, identifier, comment_id, body),
         {:ok, comment} <- LocalStore.mark_comment_sync_status(comment.id, "pending") do
      payload = %{
        "identifier" => identifier,
        "body" => body,
        "comment_id" => comment.id,
        "remote_id" => comment.remote_id
      }

      enqueue(
        project,
        identifier,
        "comment",
        "update",
        payload,
        "comment:update:#{project.id}:#{comment.id}"
      )

      {:ok, comment}
    end
  end

  @impl true
  def delete_comment(%Project{} = project, identifier, comment_id) do
    with {:ok, comment} <- IssueAdapter.delete_comment(project, identifier, comment_id) do
      if is_binary(comment.remote_id) and comment.remote_id != "" do
        payload = %{
          "identifier" => identifier,
          "comment_id" => comment.id,
          "remote_id" => comment.remote_id
        }

        enqueue(project, identifier, "comment", "delete", payload, nil)
      else
        Outbox.discard_comment_entries(project.id, comment.id)
      end

      {:ok, comment}
    end
  end

  defp maybe_enqueue_status_move(project, dto, before, attrs) do
    case requested_status_name(attrs) do
      nil ->
        :ok

      status_name when status_name == before.status.name ->
        :ok

      status_name ->
        dto
        |> GroupStatus.push_identifiers()
        |> Enum.each(&enqueue_status_move(project, &1, status_name))

        # Flush this project's outbox once for the whole (possibly grouped) move,
        # not once per identifier. A per-member trigger fans a single board move
        # into N concurrent sync passes that contend for the SQLite write lock
        # (surfacing as "database is locked"/"Database busy") and widens the
        # outbox dedup race window.
        Engine.request_sync_project(project.slug, force: true)
        :ok
    end
  end

  defp enqueue_status_move(project, identifier, status_name) do
    LocalStore.mark_dirty(identifier, project.slug, [:state])
    payload = %{"identifier" => identifier, "state" => status_name}
    enqueue(project, identifier, "state", "move", payload, "state:move:#{project.id}:#{identifier}")
    :ok
  end

  defp requested_status_name(attrs) do
    attrs
    |> Map.get("status", Map.get(attrs, "state", Map.get(attrs, :status, Map.get(attrs, :state))))
    |> case do
      status when is_binary(status) ->
        trimmed = String.trim(status)
        if trimmed == "", do: nil, else: trimmed

      _ ->
        nil
    end
  end

  # Attachments are remote-only metadata that the local mirror does not persist,
  # so we fetch them live for the single-issue detail read. Best-effort: a remote
  # hiccup must not break rendering the locally-cached issue.
  defp remote_attachments(%Project{tracker_kind: kind} = project, identifier) do
    with adapter when not is_nil(adapter) <- SymphonyElixir.Tracker.IssueAdapter.remote_for(kind),
         true <- function_exported?(adapter, :list_attachments, 2),
         {:ok, attachments} when is_list(attachments) <- adapter.list_attachments(project, identifier) do
      attachments
    else
      _ -> []
    end
  end

  defp enqueue(project, identifier, entity_type, operation, payload, dedup_key) do
    Outbox.enqueue(%{
      project_id: project.id,
      issue_id: issue_id_for(project, identifier),
      entity_type: entity_type,
      operation: operation,
      payload: stringify(payload),
      dedup_key: dedup_key
    })
  end

  defp issue_id_for(project, identifier) do
    case Context.get_issue(project.slug, identifier) do
      {:ok, issue} -> issue.id
      _ -> nil
    end
  end

  defp maybe_request_sync_for_pending_work(%Project{id: project_id} = project) do
    project
    |> local_only_issue_identifiers()
    |> then(&Outbox.requeue_failed_issue_creates(project_id, &1))

    project
    |> dirty_outbox_dedup_keys()
    |> then(&Outbox.requeue_latest_failed_by_dedup_keys(project_id, &1))

    enqueue_current_dirty_issue_updates(project)

    if Outbox.pending_count(project_id) > 0 do
      Engine.request_sync(force: true)
    end

    :ok
  end

  defp local_only_issue_identifiers(%Project{id: project_id}) do
    IssueRecord
    |> where([issue], issue.project_id == ^project_id)
    |> where([issue], is_nil(issue.remote_id) or issue.remote_id == "")
    |> where([issue], is_nil(issue.archived_at))
    |> select([issue], issue.identifier)
    |> Repo.all()
  end

  defp dirty_outbox_dedup_keys(%Project{id: project_id}) do
    IssueRecord
    |> where([issue], issue.project_id == ^project_id)
    |> where([issue], not is_nil(issue.dirty_fields))
    |> select([issue], {issue.identifier, issue.dirty_fields})
    |> Repo.all()
    |> Enum.flat_map(fn {identifier, dirty_fields} ->
      dirty_fields
      |> Map.keys()
      |> Enum.flat_map(&dirty_field_dedup_keys(project_id, identifier, &1))
    end)
    |> Enum.uniq()
  end

  defp enqueue_current_dirty_issue_updates(%Project{} = project) do
    project
    |> dirty_issue_records()
    |> Enum.each(fn issue ->
      payload = dirty_issue_update_payload(issue)

      if map_size(Map.delete(payload, "identifier")) > 0 do
        enqueue(project, issue.identifier, "issue", "update", payload, "issue:update:#{project.id}:#{issue.identifier}")
      end
    end)
  end

  defp dirty_issue_records(%Project{id: project_id}) do
    IssueRecord
    |> where([issue], issue.project_id == ^project_id)
    |> where([issue], not is_nil(issue.dirty_fields))
    |> preload(:labels)
    |> Repo.all()
    |> Enum.filter(fn issue -> issue.dirty_fields != %{} end)
  end

  defp dirty_issue_update_payload(%IssueRecord{} = issue) do
    dirty = issue.dirty_fields || %{}

    %{"identifier" => issue.identifier}
    |> maybe_put_dirty_value(dirty, "title", issue.title)
    |> maybe_put_dirty_value(dirty, "description", issue.description)
    |> maybe_put_dirty_value(dirty, "priority", issue.priority)
    |> maybe_put_dirty_assignees(dirty, issue.assignee_id)
    |> maybe_put_dirty_labels(dirty, issue.labels)
  end

  defp maybe_put_dirty_value(payload, dirty, field, value) do
    if Map.has_key?(dirty, field), do: Map.put(payload, field, value), else: payload
  end

  defp maybe_put_dirty_assignees(payload, dirty, assignee_id) do
    if Map.has_key?(dirty, "assignee_id") do
      Map.put(payload, "assignee_ids", List.wrap(assignee_id) |> Enum.reject(&is_nil/1))
    else
      payload
    end
  end

  defp maybe_put_dirty_labels(payload, dirty, labels) do
    if Map.has_key?(dirty, "labels") do
      label_names =
        labels
        |> List.wrap()
        |> Enum.map(&Map.get(&1, :name))
        |> Enum.reject(&(is_nil(&1) or &1 == ""))

      Map.put(payload, "label_ids", label_names)
    else
      payload
    end
  end

  defp dirty_field_dedup_keys(project_id, identifier, "state"),
    do: ["state:move:#{project_id}:#{identifier}"]

  defp dirty_field_dedup_keys(project_id, identifier, field)
       when field in ["title", "description", "priority", "assignee_id", "labels"],
       do: ["issue:update:#{project_id}:#{identifier}"]

  defp dirty_field_dedup_keys(_project_id, _identifier, _field), do: []

  defp dirty_fields(attrs) do
    attrs
    |> Map.keys()
    |> Enum.map(&to_dirty_field/1)
    |> Enum.reject(&is_nil/1)
  end

  defp to_dirty_field(key) when key in [:title, "title"], do: :title
  defp to_dirty_field(key) when key in [:description, "description"], do: :description
  defp to_dirty_field(key) when key in [:priority, "priority"], do: :priority

  defp to_dirty_field(key)
       when key in [:assignee_id, "assignee_id", :assignee, "assignee", :assignee_ids, "assignee_ids"],
       do: :assignee_id

  defp to_dirty_field(key) when key in [:label_ids, "label_ids", :labels, "labels", :agent, "agent"], do: :labels
  defp to_dirty_field(_key), do: nil

  defp stringify(map), do: Map.new(map, fn {k, v} -> {to_string(k), v} end)
end
