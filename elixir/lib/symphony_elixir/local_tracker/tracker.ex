defmodule SymphonyElixir.LocalTracker.Tracker do
  @moduledoc """
  Local SQLite-backed tracker implementation.
  """

  @behaviour SymphonyElixir.Tracker

  import Ecto.Query

  require Logger

  alias SymphonyElixir.{Config, Issue}

  alias SymphonyElixir.LocalTracker.{
    Comment,
    Context,
    IssueMapper,
    IssueRecord,
    IssueRelation,
    Project,
    Viewer
  }

  alias SymphonyElixir.Repo

  @spec project_identity() :: String.t() | nil
  def project_identity, do: Config.local_project_slug()

  @spec default_prompt_template() :: String.t()
  def default_prompt_template do
    """
    You are working on a local Symphony tracker issue.

    Identifier: {{ issue.identifier }}
    Title: {{ issue.title }}

    Body:
    {% if issue.description %}
    {{ issue.description }}
    {% else %}
    No description provided.
    {% endif %}

    {% if issue.comments.size > 0 %}
    ## Local discussion

    {% for comment in issue.comments %}
    ---
    **{{ comment.author }}** ({{ comment.kind }}) — {{ comment.created_at }}

    {{ comment.body }}

    {% endfor %}
    {% endif %}
    """
  end

  @spec fetch_candidate_issues() :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_candidate_issues do
    fetch_issues_by_states(Config.active_states())
  end

  @spec fetch_issues_by_states([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_states(states) when is_list(states) do
    case resolve_assignee_filter() do
      {:ok, assignee_filter} ->
        with {:ok, project} <- fetch_active_project() do
          issues =
            IssueRecord
            |> where([issue], issue.project_id == ^project.id)
            |> join(:inner, [issue], status in assoc(issue, :status))
            |> where([_issue, status], status.name in ^states)
            |> maybe_filter_assignee(assignee_filter)
            |> order_by([issue], asc: issue.inserted_at, asc: issue.id)
            |> preload(^issue_preloads())
            |> Repo.all()
            |> IssueMapper.to_issues()

          {:ok, issues}
        end

      :empty ->
        {:ok, []}
    end
  end

  def fetch_issues_by_states(_states), do: {:error, :invalid_states}

  defp resolve_assignee_filter do
    case Config.local_assignee() do
      nil ->
        {:ok, :any}

      "me" ->
        case Viewer.current() do
          {:ok, %{login: login}} ->
            {:ok, {:login, login}}

          {:error, reason} ->
            Logger.warning("viewer_unavailable_for_local_assignee_filter reason=#{inspect(reason)}")

            :empty
        end

      login when is_binary(login) ->
        {:ok, {:login, login}}
    end
  end

  defp maybe_filter_assignee(query, :any), do: query

  defp maybe_filter_assignee(query, {:login, login}) when is_binary(login) do
    where(query, [issue, _status], issue.assignee_id == ^login)
  end

  @spec fetch_issue_states_by_ids([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issue_states_by_ids(issue_ids) when is_list(issue_ids) do
    ids = Enum.map(issue_ids, &to_string/1)
    database_ids = Enum.flat_map(ids, &parse_positive_integer/1)

    with {:ok, project} <- fetch_active_project() do
      issues =
        IssueRecord
        |> where([issue], issue.project_id == ^project.id)
        |> where([issue], issue.identifier in ^ids or issue.id in ^database_ids)
        |> order_by([issue], asc: issue.inserted_at, asc: issue.id)
        |> preload(^issue_preloads())
        |> Repo.all()
        |> IssueMapper.to_issues()

      {:ok, issues}
    end
  end

  def fetch_issue_states_by_ids(_issue_ids), do: {:error, :invalid_issue_ids}

  @spec create_comment(String.t(), String.t()) :: :ok | {:error, term()}
  def create_comment(issue_id, body) when is_binary(issue_id) and is_binary(body) do
    with {:ok, identifier} <- resolve_issue_identifier(issue_id),
         {:ok, _comment} <- Context.add_comment(Config.local_project_slug(), identifier, body) do
      :ok
    else
      {:error, reason} -> {:error, reason}
    end
  end

  @spec update_issue_state(String.t(), String.t()) :: :ok | {:error, term()}
  def update_issue_state(issue_id, state_name)
      when is_binary(issue_id) and is_binary(state_name) do
    with {:ok, identifier} <- resolve_issue_identifier(issue_id),
         {:ok, _issue} <- Context.update_issue_state(Config.local_project_slug(), identifier, state_name) do
      :ok
    else
      {:error, reason} -> {:error, reason}
    end
  end

  defp fetch_active_project do
    case Config.local_project_slug() do
      slug when is_binary(slug) ->
        case Repo.get_by(Project, slug: slug) do
          %Project{} = project -> {:ok, project}
          nil -> {:error, :project_not_found}
        end

      _slug ->
        {:error, :project_not_configured}
    end
  end

  defp issue_preloads do
    [
      :status,
      :labels,
      comments: from(comment in Comment, order_by: [asc: comment.inserted_at, asc: comment.id]),
      source_relations:
        from(relation in IssueRelation,
          where: relation.type == "blocked_by",
          preload: [target_issue: :status]
        )
    ]
  end

  defp resolve_issue_identifier(issue_ref) when is_binary(issue_ref) do
    with {:ok, project} <- fetch_active_project() do
      database_ids = parse_positive_integer(issue_ref)

      IssueRecord
      |> where([issue], issue.project_id == ^project.id)
      |> where([issue], issue.identifier == ^issue_ref or issue.id in ^database_ids)
      |> select([issue], issue.identifier)
      |> Repo.one()
      |> case do
        identifier when is_binary(identifier) -> {:ok, identifier}
        nil -> {:error, :issue_not_found}
      end
    end
  end

  defp parse_positive_integer(value) do
    case Integer.parse(value) do
      {id, ""} when id > 0 -> [id]
      _parse_error -> []
    end
  end
end
