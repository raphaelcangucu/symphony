defmodule SymphonyElixir.Tracker.Sync.LocalStore do
  @moduledoc """
  Upserts remote tracker data (issues, comments, labels, pull requests) into the
  local SQLite store, keyed by `(project_id, remote_id)`.

  Insert path creates a fully mirrored issue. Update path applies field-level
  last-writer-wins via `Tracker.Sync.Merge`, preserving pending local edits
  (`dirty_fields`). All functions are idempotent.
  """

  import Ecto.Query

  alias SymphonyElixir.LocalTracker.{Comment, IssueLabel, IssueRecord, Label, Project, WorkflowStatus}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Merge, PullRequestRecord}

  # Fields subject to LWW merge on update (untouched-locally take remote).
  @syncable_fields ~w(title description priority assignee_id)a

  @spec upsert_remote_issue(Project.t(), map()) ::
          {:ok, IssueRecord.t()} | {:error, term()}
  def upsert_remote_issue(%Project{} = project, %{remote_id: remote_id} = remote)
      when is_binary(remote_id) do
    Repo.transaction(fn ->
      status_id = resolve_status_id(project.id, remote[:state])

      issue =
        case existing_issue(project.id, remote_id) do
          nil -> insert_issue!(project, remote, status_id)
          %IssueRecord{} = current -> update_issue!(current, remote, status_id)
        end

      :ok = upsert_labels!(project, issue, Map.get(remote, :labels, []))
      :ok = upsert_comments!(issue, Map.get(remote, :comments, []))

      Repo.preload(issue, [:status, :labels, :comments], force: true)
    end)
  end

  @doc """
  Marks `fields` as locally-edited on an issue (so a later remote pull respects
  LWW) and flips its `sync_status` to `pending`.
  """
  @spec mark_dirty(String.t(), String.t(), [atom()]) :: {:ok, IssueRecord.t()} | {:error, term()}
  def mark_dirty(identifier, project_slug, fields) when is_list(fields) do
    with {:ok, issue} <- SymphonyElixir.LocalTracker.Context.get_issue(project_slug, identifier) do
      now_iso = DateTime.to_iso8601(DateTime.utc_now())
      dirty = Enum.reduce(fields, issue.dirty_fields || %{}, fn field, acc -> Map.put(acc, Atom.to_string(field), now_iso) end)

      issue
      |> IssueRecord.changeset(%{dirty_fields: dirty, sync_status: "pending"})
      |> Repo.update()
    end
  end

  @spec upsert_pull_requests(IssueRecord.t(), [map()]) :: :ok
  def upsert_pull_requests(%IssueRecord{} = issue, prs) when is_list(prs) do
    now = DateTime.utc_now()

    Enum.each(prs, fn pr ->
      attrs = pr |> Map.put(:issue_id, issue.id) |> Map.put(:last_synced_at, now)

      case Repo.get_by(PullRequestRecord, issue_id: issue.id, remote_id: pr.remote_id) do
        nil -> %PullRequestRecord{}
        %PullRequestRecord{} = existing -> existing
      end
      |> PullRequestRecord.changeset(attrs)
      |> Repo.insert_or_update!()
    end)

    :ok
  end

  # -- issue insert/update -----------------------------------------------------

  defp insert_issue!(project, remote, status_id) do
    %IssueRecord{}
    |> IssueRecord.changeset(%{
      project_id: project.id,
      status_id: status_id,
      identifier: to_string(remote[:identifier]),
      title: remote[:title],
      description: remote[:description],
      priority: remote[:priority],
      position: remote[:position] || 0,
      assignee_id: remote[:assignee_id],
      creator: remote[:creator],
      branch_name: remote[:branch_name],
      url: remote[:remote_url],
      remote_id: remote[:remote_id],
      remote_number: remote[:remote_number],
      remote_url: remote[:remote_url],
      sync_status: "synced",
      remote_updated_at: remote[:remote_updated_at],
      last_synced_at: DateTime.utc_now(),
      dirty_fields: %{}
    })
    |> Repo.insert!()
  end

  defp update_issue!(%IssueRecord{} = current, remote, status_id) do
    merged =
      Merge.merge_fields(
        Map.from_struct(current),
        current.dirty_fields || %{},
        Map.take(remote, @syncable_fields),
        remote[:remote_updated_at],
        @syncable_fields
      )

    base = %{
      remote_number: remote[:remote_number],
      url: remote[:remote_url],
      remote_url: remote[:remote_url],
      branch_name: remote[:branch_name],
      remote_updated_at: remote[:remote_updated_at],
      last_synced_at: DateTime.utc_now(),
      dirty_fields: merged.dirty_fields,
      sync_status: if(merged.conflict?, do: "conflict", else: "synced")
    }

    # Only move status when the local `state` is not a pending local edit.
    base = if Map.has_key?(merged.dirty_fields, "state"), do: base, else: Map.put(base, :status_id, status_id)

    current
    |> IssueRecord.changeset(Map.merge(base, merged.attrs))
    |> Repo.update!()
  end

  defp existing_issue(project_id, remote_id) do
    IssueRecord
    |> where([i], i.project_id == ^project_id and i.remote_id == ^remote_id)
    |> Repo.one()
  end

  defp resolve_status_id(project_id, state_name) when is_binary(state_name) do
    case Repo.get_by(WorkflowStatus, project_id: project_id, name: state_name) do
      %WorkflowStatus{id: id} -> id
      nil -> first_status_id(project_id)
    end
  end

  defp resolve_status_id(project_id, _state), do: first_status_id(project_id)

  defp first_status_id(project_id) do
    WorkflowStatus
    |> where([s], s.project_id == ^project_id)
    |> order_by([s], asc: s.position, asc: s.id)
    |> limit(1)
    |> select([s], s.id)
    |> Repo.one()
  end

  # -- labels ------------------------------------------------------------------

  defp upsert_labels!(project, issue, labels) when is_list(labels) do
    label_ids =
      Enum.map(labels, fn label ->
        ensure_label!(project.id, label).id
      end)

    # Replace the remote-origin label set: clear current links, re-link.
    Repo.delete_all(from(il in IssueLabel, where: il.issue_id == ^issue.id))

    Enum.each(label_ids, fn label_id ->
      %IssueLabel{}
      |> IssueLabel.changeset(%{issue_id: issue.id, label_id: label_id})
      |> Repo.insert!(on_conflict: :nothing)
    end)

    :ok
  end

  defp ensure_label!(project_id, %{name: name} = label) do
    found =
      find_label_by_remote_id(project_id, label[:remote_id]) ||
        Repo.get_by(Label, project_id: project_id, name: name)

    attrs = %{project_id: project_id, name: name, color: label[:color], remote_id: label[:remote_id]}

    (found || %Label{})
    |> Label.changeset(attrs)
    |> Repo.insert_or_update!()
  end

  defp find_label_by_remote_id(project_id, remote_id) when is_binary(remote_id),
    do: Repo.get_by(Label, project_id: project_id, remote_id: remote_id)

  defp find_label_by_remote_id(_project_id, _remote_id), do: nil

  # -- comments ----------------------------------------------------------------

  defp upsert_comments!(issue, comments) when is_list(comments) do
    Enum.each(comments, fn comment ->
      attrs = %{
        issue_id: issue.id,
        kind: "comment",
        body: comment[:body],
        author: comment[:author] || "remote",
        remote_id: comment[:remote_id],
        remote_updated_at: comment[:remote_updated_at],
        last_synced_at: DateTime.utc_now(),
        sync_status: "synced"
      }

      case Repo.get_by(Comment, issue_id: issue.id, remote_id: comment[:remote_id]) do
        nil -> %Comment{}
        %Comment{} = existing -> existing
      end
      |> Comment.changeset(attrs)
      |> Repo.insert_or_update!()
    end)

    :ok
  end
end
