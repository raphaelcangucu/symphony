defmodule SymphonyElixir.LocalTracker.IssueAdapter do
  @moduledoc "Local SQLite-backed implementation of `Tracker.IssueAdapter`."

  @behaviour SymphonyElixir.Tracker.IssueAdapter

  import Ecto.Query

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord, Project, WorkflowStatus}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixir.Tracker.LabelResolver
  alias SymphonyElixir.Tracker.Sync.UserRecord

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

  @spec archive_issue(Project.t(), String.t()) :: {:ok, IssueDTO.t()} | {:error, term()}
  def archive_issue(%Project{slug: slug}, identifier) do
    with {:ok, issue} <- Context.archive_issue(slug, identifier) do
      {:ok, to_dto(issue)}
    end
  end

  @spec restore_issue(Project.t(), String.t()) :: {:ok, IssueDTO.t()} | {:error, term()}
  def restore_issue(%Project{slug: slug}, identifier) do
    with {:ok, issue} <- Context.restore_issue(slug, identifier) do
      {:ok, to_dto(issue)}
    end
  end

  @spec delete_issue(Project.t(), String.t()) :: {:ok, IssueDTO.t()} | {:error, term()}
  def delete_issue(%Project{slug: slug}, identifier) do
    with {:ok, issue} <- Context.delete_issue(slug, identifier) do
      {:ok, to_dto(issue)}
    end
  end

  @impl true
  def list_statuses(%Project{slug: slug}) do
    statuses = slug |> Context.list_statuses() |> Enum.map(&status_to_map/1)
    {:ok, statuses}
  end

  @impl true
  def list_labels(%Project{slug: slug}) do
    labels =
      slug
      |> Context.list_issues([])
      |> Enum.map(&to_dto/1)
      |> Enum.flat_map(& &1.labels)
      |> Enum.reject(&(is_nil(&1) or &1 == ""))
      |> Enum.uniq()
      |> Enum.map(fn name -> %{id: name, name: name, color: nil} end)

    {:ok, labels}
  end

  @impl true
  def list_assignable_users(%Project{id: project_id}) do
    users =
      UserRecord
      |> where([user], user.project_id == ^project_id)
      |> order_by([user], asc: user.login)
      |> Repo.all()
      |> Enum.map(fn user ->
        %{
          id: user.remote_id,
          login: user.login,
          name: user.name,
          avatar_url: user.avatar_url
        }
      end)

    {:ok, users}
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
      labels: labels_to_names(issue.labels, issue.project),
      assignee: issue.assignee_id,
      creator: issue.creator,
      agent_goal: issue.agent_goal,
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

  defp labels_to_names(labels, %Project{} = project) when is_list(labels) do
    labels
    |> Enum.map(fn
      %{name: name} when is_binary(name) -> LabelResolver.display_name(project, name)
      _label -> nil
    end)
    |> Enum.reject(&(is_nil(&1) or &1 == ""))
  end

  defp labels_to_names(labels, _project) when is_list(labels) do
    labels
    |> Enum.map(fn
      %{name: name} when is_binary(name) -> name
      _label -> nil
    end)
    |> Enum.reject(&is_nil/1)
  end

  defp labels_to_names(_labels, _project), do: []

  defp project_slug(%IssueRecord{project: %Project{slug: slug}}), do: slug
  defp project_slug(_), do: nil

  defp iso8601(%DateTime{} = dt), do: dt |> DateTime.truncate(:second) |> DateTime.to_iso8601()
  defp iso8601(_), do: nil
end
