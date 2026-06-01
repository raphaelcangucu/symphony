defmodule SymphonyElixir.Tracker.Sync.LocalFirstAdapter do
  @moduledoc """
  `Tracker.IssueAdapter` wrapper for remote-backed projects when local-first sync
  is enabled. Reads are served from the local store via `LocalTracker.IssueAdapter`.
  Writes persist locally, mark touched fields dirty for LWW, and enqueue an
  `Outbox` entry the sync engine pushes to the remote.
  """

  @behaviour SymphonyElixir.Tracker.IssueAdapter

  alias SymphonyElixir.LocalTracker.{Context, IssueAdapter, Project}
  alias SymphonyElixir.Tracker.Sync.{LocalStore, Outbox}

  @impl true
  def kind, do: :github

  @impl true
  def list_issues(%Project{} = project, filters), do: IssueAdapter.list_issues(project, filters)

  @impl true
  def get_issue(%Project{} = project, identifier), do: IssueAdapter.get_issue(project, identifier)

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
      enqueue(project, identifier, "issue", "update", attrs, "issue:update:#{project.id}:#{identifier}")
      {:ok, dto}
    end
  end

  @impl true
  def move_issue(%Project{} = project, identifier, attrs) do
    with {:ok, dto} <- IssueAdapter.move_issue(project, identifier, attrs) do
      LocalStore.mark_dirty(identifier, project.slug, [:state])
      state = attrs["status"] || attrs["state"] || attrs[:status]
      payload = %{"identifier" => identifier, "state" => state}
      enqueue(project, identifier, "state", "move", payload, "state:move:#{project.id}:#{identifier}")
      {:ok, dto}
    end
  end

  @impl true
  def add_comment(%Project{} = project, identifier, body, attrs) do
    with {:ok, comment} <- IssueAdapter.add_comment(project, identifier, body, attrs) do
      payload = %{"identifier" => identifier, "body" => body}
      enqueue(project, identifier, "comment", "create", payload, nil)
      {:ok, comment}
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

  defp dirty_fields(attrs) do
    attrs
    |> Map.keys()
    |> Enum.map(&to_dirty_field/1)
    |> Enum.reject(&is_nil/1)
  end

  defp to_dirty_field(key) when key in [:title, "title"], do: :title
  defp to_dirty_field(key) when key in [:description, "description"], do: :description
  defp to_dirty_field(key) when key in [:priority, "priority"], do: :priority
  defp to_dirty_field(key) when key in [:assignee_id, "assignee_id", :assignee, "assignee"], do: :assignee_id
  defp to_dirty_field(_key), do: nil

  defp stringify(map), do: Map.new(map, fn {k, v} -> {to_string(k), v} end)
end
