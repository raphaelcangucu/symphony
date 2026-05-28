defmodule SymphonyElixir.LocalTracker.IssueAdapter do
  @moduledoc "Local SQLite-backed implementation of `Tracker.IssueAdapter`."

  @behaviour SymphonyElixir.Tracker.IssueAdapter

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord, Project, WorkflowStatus}
  alias SymphonyElixir.Tracker.IssueDTO

  @impl true
  def kind, do: :local

  @impl true
  def list_issues(%Project{slug: slug}, filters) do
    dtos = slug |> Context.list_issues(filters) |> Enum.map(&to_dto/1)
    {:ok, dtos}
  end

  @impl true
  def get_issue(%Project{slug: slug}, identifier) do
    with {:ok, issue} <- Context.get_issue(slug, identifier) do
      {:ok, to_dto(issue)}
    end
  end

  @impl true
  def create_issue(%Project{slug: slug}, attrs) do
    with {:ok, issue} <- Context.create_issue(slug, attrs) do
      {:ok, to_dto(issue)}
    end
  end

  @impl true
  def update_issue(%Project{slug: slug}, identifier, attrs) do
    with {:ok, issue} <- Context.update_issue(slug, identifier, attrs) do
      {:ok, to_dto(issue)}
    end
  end

  @impl true
  def move_issue(%Project{slug: slug}, identifier, attrs) do
    with {:ok, issue} <- Context.move_issue(slug, identifier, attrs) do
      {:ok, to_dto(issue)}
    end
  end

  @impl true
  def list_statuses(%Project{slug: slug}) do
    statuses = slug |> Context.list_statuses() |> Enum.map(&status_to_map/1)
    {:ok, statuses}
  end

  @impl true
  def list_comments(%Project{slug: slug}, identifier) do
    Context.list_comments(slug, identifier)
  end

  @impl true
  def add_comment(%Project{slug: slug}, identifier, body, attrs) do
    Context.add_comment(slug, identifier, body, attrs)
  end

  @spec to_dto(IssueRecord.t()) :: IssueDTO.t()
  def to_dto(%IssueRecord{} = issue) do
    IssueDTO.build(%{
      id: to_string(issue.id),
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      position: issue.position,
      status: status_to_map(issue.status),
      assignee: issue.assignee_id,
      creator: issue.creator,
      url: issue.url,
      project_slug: project_slug(issue),
      created_at: iso8601(issue.inserted_at),
      updated_at: iso8601(issue.updated_at)
    })
  end

  defp status_to_map(%WorkflowStatus{} = status) do
    %{name: status.name, category: status.category, position: status.position, is_terminal: status.is_terminal}
  end

  defp status_to_map(_), do: nil

  defp project_slug(%IssueRecord{project: %Project{slug: slug}}), do: slug
  defp project_slug(_), do: nil

  defp iso8601(%DateTime{} = dt), do: dt |> DateTime.truncate(:second) |> DateTime.to_iso8601()
  defp iso8601(_), do: nil
end
