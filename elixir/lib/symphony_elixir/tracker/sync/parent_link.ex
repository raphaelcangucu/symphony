defmodule SymphonyElixir.Tracker.Sync.ParentLink do
  @moduledoc """
  Enqueues local parent↔child sub-issue relations for push to GitHub's
  `addSubIssue` / `removeSubIssue` GraphQL mutations.
  """

  import Ecto.Query

  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.{Context, IssueRecord, IssueRelation, Project}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Engine, Outbox}

  @spec enqueue_link(Project.t(), String.t(), String.t()) :: :ok
  def enqueue_link(%Project{tracker_kind: "github"} = project, child_identifier, parent_identifier)
      when is_binary(child_identifier) and is_binary(parent_identifier) do
    if Config.tracker_sync_enabled?() do
      Outbox.enqueue(%{
        project_id: project.id,
        issue_id: issue_id(project, child_identifier),
        entity_type: "relation",
        operation: "link_parent",
        payload: %{
          "child_identifier" => child_identifier,
          "parent_identifier" => parent_identifier
        },
        dedup_key: link_dedup_key(project.id, child_identifier)
      })

      Engine.request_sync_project(project.slug, force: true)
    end

    :ok
  end

  def enqueue_link(_project, _child_identifier, _parent_identifier), do: :ok

  @spec enqueue_unlink(Project.t(), String.t(), String.t()) :: :ok
  def enqueue_unlink(%Project{tracker_kind: "github"} = project, child_identifier, parent_identifier)
      when is_binary(child_identifier) and is_binary(parent_identifier) do
    if Config.tracker_sync_enabled?() do
      Outbox.enqueue(%{
        project_id: project.id,
        issue_id: issue_id(project, child_identifier),
        entity_type: "relation",
        operation: "unlink_parent",
        payload: %{
          "child_identifier" => child_identifier,
          "parent_identifier" => parent_identifier
        },
        dedup_key: unlink_dedup_key(project.id, child_identifier)
      })

      Engine.request_sync_project(project.slug, force: true)
    end

    :ok
  end

  def enqueue_unlink(_project, _child_identifier, _parent_identifier), do: :ok

  @doc """
  Re-enqueues parent links for local `sub_issue_of` relations that were never
  pushed (e.g. created before `addSubIssue` support existed).
  """
  @spec requeue_unsynced_relations(Project.t()) :: :ok
  def requeue_unsynced_relations(%Project{tracker_kind: "github", id: project_id} = project) do
    if Config.tracker_sync_enabled?() do
      project_id
      |> unsynced_sub_issue_relations()
      |> Enum.each(fn {child_identifier, parent_identifier} ->
        Outbox.enqueue(%{
          project_id: project_id,
          issue_id: issue_id(project, child_identifier),
          entity_type: "relation",
          operation: "link_parent",
          payload: %{
            "child_identifier" => child_identifier,
            "parent_identifier" => parent_identifier
          },
          dedup_key: link_dedup_key(project_id, child_identifier)
        })
      end)
    end

    :ok
  end

  def requeue_unsynced_relations(_project), do: :ok

  defp unsynced_sub_issue_relations(project_id) do
    from(relation in IssueRelation,
      join: child in IssueRecord,
      on: child.id == relation.source_issue_id,
      join: parent in IssueRecord,
      on: parent.id == relation.target_issue_id,
      where: relation.type == ^IssueRelation.subtask_type(),
      where: relation.remote_origin == false,
      where: child.project_id == ^project_id,
      where: parent.project_id == ^project_id,
      where: not is_nil(child.remote_id) and child.remote_id != "",
      where: not is_nil(parent.remote_id) and parent.remote_id != "",
      select: {child.identifier, parent.identifier}
    )
    |> Repo.all()
  end

  defp issue_id(%Project{slug: slug}, identifier) do
    case Context.get_issue(slug, identifier) do
      {:ok, issue} -> issue.id
      _ -> nil
    end
  end

  defp link_dedup_key(project_id, child_identifier),
    do: "relation:link_parent:#{project_id}:#{child_identifier}"

  defp unlink_dedup_key(project_id, child_identifier),
    do: "relation:unlink_parent:#{project_id}:#{child_identifier}"
end
