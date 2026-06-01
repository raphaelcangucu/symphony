defmodule SymphonyElixir.Tracker.Sync.LocalFirstTracker do
  @moduledoc """
  Local-first implementation of the orchestrator's `SymphonyElixir.Tracker`
  behaviour for remote-backed projects (GitHub/Linear) when sync is enabled.

  Reads are served from the local mirror (scoped to the configured project, in the
  active states, filtered by the configured assignee so gating parity with the
  remote is preserved). Writes persist locally, mark fields dirty for LWW, and
  enqueue an `Outbox` entry the sync engine pushes to the remote.

  Safety: when the assignee filter cannot be resolved (e.g. `assignee: me` with no
  cached viewer login) reads return `{:ok, []}` so the orchestrator never picks up
  issues that may not be assigned to this worker.
  """

  @behaviour SymphonyElixir.Tracker

  import Ecto.Query

  require Logger

  alias SymphonyElixir.Config
  alias SymphonyElixir.GitHub.Config, as: GitHubConfig
  alias SymphonyElixir.GitHub.Viewer
  alias SymphonyElixir.LocalTracker.{Comment, Context, IssueMapper, IssueRecord, IssueRelation, Project}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{LocalStore, Outbox}

  @impl true
  def project_identity, do: remote_adapter().project_identity()

  @impl true
  def default_prompt_template, do: remote_adapter().default_prompt_template()

  @spec enrich_issue(term()) :: term()
  def enrich_issue(issue), do: issue

  @impl true
  def fetch_candidate_issues, do: fetch_issues_by_states(Config.active_states())

  @impl true
  def fetch_issues_by_states(states) when is_list(states) do
    with {:ok, project} <- resolve_project(),
         {:ok, filter} <- resolve_assignee_filter(project) do
      {:ok, query_issues(project, states, filter)}
    else
      :skip -> {:ok, []}
      {:error, _reason} -> {:ok, []}
    end
  end

  def fetch_issues_by_states(_states), do: {:error, :invalid_states}

  @impl true
  def fetch_issue_states_by_ids(issue_ids) when is_list(issue_ids) do
    with {:ok, project} <- resolve_project() do
      ids = Enum.map(issue_ids, &to_string/1)

      issues =
        project
        |> base_query()
        |> where([issue], issue.identifier in ^ids)
        |> Repo.all()
        |> IssueMapper.to_issues()

      {:ok, issues}
    end
  end

  def fetch_issue_states_by_ids(_issue_ids), do: {:error, :invalid_issue_ids}

  @impl true
  def create_comment(issue_id, body) when is_binary(issue_id) and is_binary(body) do
    with {:ok, project} <- resolve_project(),
         {:ok, identifier} <- resolve_identifier(project, issue_id),
         {:ok, _comment} <- Context.add_comment(project.slug, identifier, body) do
      enqueue(project, identifier, "comment", "create", %{"identifier" => identifier, "body" => body}, nil)
      :ok
    else
      :skip -> {:error, :project_not_resolved}
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def update_issue_state(issue_id, state_name) when is_binary(issue_id) and is_binary(state_name) do
    with {:ok, project} <- resolve_project(),
         {:ok, identifier} <- resolve_identifier(project, issue_id),
         {:ok, _issue} <- Context.update_issue_state(project.slug, identifier, state_name) do
      LocalStore.mark_dirty(identifier, project.slug, [:state])
      payload = %{"identifier" => identifier, "state" => state_name}
      enqueue(project, identifier, "state", "move", payload, "state:move:#{project.id}:#{identifier}")
      :ok
    else
      :skip -> {:error, :project_not_resolved}
      {:error, reason} -> {:error, reason}
    end
  end

  # -- reads -------------------------------------------------------------------

  defp query_issues(project, states, filter) do
    project
    |> base_query()
    |> join(:inner, [issue], status in assoc(issue, :status))
    |> where([_issue, status], status.name in ^states)
    |> apply_assignee_filter(filter)
    |> Repo.all()
    |> IssueMapper.to_issues()
  end

  defp base_query(project) do
    IssueRecord
    |> where([issue], issue.project_id == ^project.id)
    |> order_by([issue], asc: issue.inserted_at, asc: issue.id)
    |> preload(^issue_preloads())
  end

  defp apply_assignee_filter(query, :any), do: query

  defp apply_assignee_filter(query, {:login, login}) when is_binary(login) do
    lowered = String.downcase(login)
    where(query, [issue, _status], fragment("lower(?) = ?", issue.assignee_id, ^lowered))
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

  # -- project + assignee resolution ------------------------------------------

  defp resolve_project do
    case project_slug() do
      slug when is_binary(slug) -> find_or_backfill_project(slug)
      _ -> :skip
    end
  end

  defp find_or_backfill_project(slug) do
    case Repo.get_by(Project, slug: slug) do
      %Project{} = project -> {:ok, project}
      nil -> backfill_project(slug)
    end
  end

  defp backfill_project(slug) do
    case backfill_attrs(slug, Config.tracker_kind()) do
      nil ->
        :skip

      attrs ->
        case Context.ensure_project(attrs) do
          {:ok, project} -> {:ok, project}
          {:error, reason} -> log_skip(slug, reason)
        end
    end
  end

  defp backfill_attrs(slug, "github") do
    with repo when is_binary(repo) <- GitHubConfig.repo(),
         project_id when is_binary(project_id) <- GitHubConfig.project_id() do
      %{name: slug, slug: slug, tracker_kind: "github", tracker_config: %{"repo" => repo, "project_id" => project_id}}
    else
      _ -> nil
    end
  end

  defp backfill_attrs(_slug, _kind), do: nil

  defp log_skip(slug, reason) do
    Logger.warning("local_first_tracker backfill skipped project=#{slug} reason=#{inspect(reason)}")
    :skip
  end

  defp project_slug do
    case Application.get_env(:symphony_elixir, :tracker_sync_project_slug) do
      slug when is_binary(slug) -> slug
      _ -> slug_from_identity(remote_adapter().project_identity())
    end
  end

  defp slug_from_identity(identity) when is_binary(identity) do
    identity |> String.split("/") |> List.last() |> String.trim()
  end

  defp slug_from_identity(_identity), do: nil

  defp resolve_assignee_filter(project) do
    assignee_fun().(project)
    |> case do
      {:ok, :any} -> {:ok, :any}
      {:ok, login} when is_binary(login) -> {:ok, {:login, login}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp assignee_fun do
    Application.get_env(:symphony_elixir, :tracker_sync_assignee_fun, &default_assignee/1)
  end

  defp default_assignee(%Project{tracker_kind: "github"}) do
    case GitHubConfig.assignee() do
      nil -> {:ok, :any}
      assignee -> resolve_github_assignee(assignee)
    end
  end

  defp default_assignee(_project), do: {:ok, :any}

  defp resolve_github_assignee(assignee) do
    case String.downcase(String.trim(assignee)) do
      "" ->
        {:ok, :any}

      "me" ->
        case Viewer.cached_login(File.cwd!()) do
          login when is_binary(login) -> {:ok, login}
          _ -> {:error, :missing_github_viewer_login}
        end

      normalized ->
        {:ok, normalized}
    end
  end

  # -- writes ------------------------------------------------------------------

  defp resolve_identifier(project, issue_ref) do
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

  defp enqueue(project, identifier, entity_type, operation, payload, dedup_key) do
    Outbox.enqueue(%{
      project_id: project.id,
      issue_id: issue_id_for(project, identifier),
      entity_type: entity_type,
      operation: operation,
      payload: payload,
      dedup_key: dedup_key
    })
  end

  defp issue_id_for(project, identifier) do
    case Context.get_issue(project.slug, identifier) do
      {:ok, issue} -> issue.id
      _ -> nil
    end
  end

  defp parse_positive_integer(value) do
    case Integer.parse(value) do
      {id, ""} when id > 0 -> [id]
      _ -> []
    end
  end

  defp remote_adapter do
    case Config.tracker_kind() do
      "linear" -> SymphonyElixir.Linear.Tracker
      _ -> SymphonyElixir.GitHub.Tracker
    end
  end
end
