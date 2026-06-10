defmodule SymphonyElixir.Tracker.Sync.LocalFirstTracker do
  @moduledoc """
  Local-first implementation of the orchestrator's `SymphonyElixir.Tracker`
  behaviour for remote-backed projects (GitHub/Linear) when sync is enabled.

  Reads are served from the local mirror across every non-archived project in the
  SQLite store (or a single project when `:tracker_sync_project_slug` is set), in
  the active states, filtered per project by assignee so gating parity with the
  remote is preserved. Writes persist locally, mark fields dirty for LWW, and
  enqueue an `Outbox` entry the sync engine pushes to the remote.

  Safety: when a project's assignee filter cannot be resolved (e.g. `assignee: me`
  with no cached viewer login) that project's issues are skipped so the
  orchestrator never picks up issues that may not be assigned to this worker.
  """

  @behaviour SymphonyElixir.Tracker

  import Ecto.Query

  require Logger

  alias SymphonyElixir.Config
  alias SymphonyElixir.GitHub.Config, as: GitHubConfig
  alias SymphonyElixir.Jira.Config, as: JiraConfig
  alias SymphonyElixir.Linear.Config, as: LinearConfig
  alias SymphonyElixir.LocalTracker.{Comment, Context, IssueMapper, IssueRecord, IssueRelation, Project}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Orchestration, as: OrchestrationSettings
  alias SymphonyElixir.Tracker.Identity
  alias SymphonyElixir.Tracker.Sync.{LocalStore, Outbox}

  @impl true
  def project_identity, do: remote_adapter().project_identity()

  @impl true
  def default_prompt_template, do: remote_adapter().default_prompt_template()

  @spec enrich_issue(term()) :: term()
  def enrich_issue(issue), do: issue

  @impl true
  def fetch_candidate_issues do
    issues =
      list_orchestrator_projects()
      |> Enum.flat_map(fn project ->
        with_project_isolation(project, fn ->
          config = SymphonyElixir.ProjectConfig.resolve(project)

          case resolve_assignee_filter(project) do
            {:ok, filter} -> query_issues(project, config.active_states, filter)
            {:error, _reason} -> []
          end
        end)
      end)

    {:ok, issues}
  end

  @impl true
  def fetch_issues_by_states(states) when is_list(states) do
    issues =
      list_orchestrator_projects()
      |> Enum.flat_map(fn project ->
        with_project_isolation(project, fn ->
          case resolve_assignee_filter(project) do
            {:ok, filter} -> query_issues(project, states, filter)
            {:error, _reason} -> []
          end
        end)
      end)

    {:ok, issues}
  end

  def fetch_issues_by_states(_states), do: {:error, :invalid_states}

  @impl true
  def fetch_issue_states_by_ids(issue_ids) when is_list(issue_ids) do
    ids = Enum.map(issue_ids, &to_string/1)
    database_ids = Enum.flat_map(ids, &parse_positive_integer/1)
    project_ids = list_orchestrator_projects() |> Enum.map(& &1.id)

    issues =
      if project_ids == [] do
        []
      else
        IssueRecord
        |> where([issue], issue.project_id in ^project_ids)
        |> where([issue], issue.identifier in ^ids or issue.id in ^database_ids or issue.remote_id in ^ids)
        |> order_by([issue], asc: issue.inserted_at, asc: issue.id)
        |> preload(^issue_preloads())
        |> Repo.all()
        |> IssueMapper.to_issues()
      end

    {:ok, issues}
  end

  def fetch_issue_states_by_ids(_issue_ids), do: {:error, :invalid_issue_ids}

  @impl true
  def create_comment(issue_id, body) when is_binary(issue_id) and is_binary(body) do
    with {:ok, project} <- resolve_project_for_issue(issue_id),
         {:ok, identifier} <- resolve_identifier(project, issue_id),
         {:ok, comment} <- Context.add_comment(project.slug, identifier, body),
         {:ok, comment} <- LocalStore.mark_comment_sync_status(comment.id, "pending") do
      payload = %{"identifier" => identifier, "body" => body, "comment_id" => comment.id}
      enqueue(project, identifier, "comment", "create", payload, nil)
      :ok
    else
      :skip -> {:error, :project_not_resolved}
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def update_issue_state(issue_id, state_name) when is_binary(issue_id) and is_binary(state_name) do
    with {:ok, project} <- resolve_project_for_issue(issue_id),
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

  # Per-project isolation: a project whose config/assignee cannot be resolved is
  # skipped with a logged warning so a single bad project never crashes the poll
  # cycle and the remaining projects still contribute issues.
  defp with_project_isolation(project, fun) do
    case SymphonyElixir.ProjectConfig.validate(project) do
      :ok ->
        fun.()

      {:error, issues} ->
        Logger.warning("multi_orchestrator: project=#{project.slug} skipped reason=invalid workflow_config: #{Enum.join(issues, "; ")}")

        []
    end
  rescue
    error ->
      Logger.warning("multi_orchestrator: project=#{project.slug} skipped reason=#{Exception.message(error)}")
      []
  end

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

  # Match the canonical provider assignee id (GitHub login / Linear user id /
  # Jira accountId). Falls back to the display `assignee_id` only when the
  # canonical id has not been synced yet (e.g. legacy GitHub rows where the
  # display value already IS the login), which never produces false positives.
  defp apply_assignee_filter(query, {:remote, value}) when is_binary(value) do
    lowered = String.downcase(value)

    where(
      query,
      [issue, _status],
      fragment("lower(coalesce(?, ?)) = ?", issue.assignee_remote_id, issue.assignee_id, ^lowered)
    )
  end

  defp issue_preloads do
    [
      :project,
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

  defp list_orchestrator_projects do
    case Application.get_env(:symphony_elixir, :tracker_sync_project_slug) do
      slug when is_binary(slug) ->
        case find_or_backfill_project(slug) do
          {:ok, project} -> [Repo.preload(project, :setup)]
          :skip -> []
        end

      _ ->
        Context.list_projects() |> Repo.preload(:setup)
    end
  end

  defp resolve_project_for_issue(issue_ref) do
    list_orchestrator_projects()
    |> Enum.reduce_while(:skip, fn project, _acc ->
      case resolve_identifier(project, issue_ref) do
        {:ok, _identifier} -> {:halt, {:ok, project}}
        {:error, _} -> {:cont, :skip}
      end
    end)
    |> case do
      {:ok, project} -> {:ok, project}
      :skip -> :skip
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

  defp resolve_assignee_filter(project) do
    assignee_fun().(project)
    |> case do
      {:ok, :any} -> {:ok, :any}
      {:ok, value} when is_binary(value) -> {:ok, {:remote, value}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp assignee_fun do
    Application.get_env(:symphony_elixir, :tracker_sync_assignee_fun, &default_assignee/1)
  end

  # Resolves the assignee gate for a project. Precedence:
  #   1. An explicit, literal `assignee` config value (not "me") is honored as-is.
  #   2. `assignee: me` — or, when `require_assignee_match` is on, no config —
  #      restricts to the connected provider identity (login/accountId/user id).
  #   3. Otherwise no assignee restriction.
  # A `{:error, reason}` SKIPS the project so the orchestrator never grabs work
  # that may not belong to this operator when the identity cannot be resolved.
  defp default_assignee(%Project{tracker_kind: kind}) do
    case configured_assignee_directive(kind) do
      {:literal, value} -> {:ok, value}
      :viewer -> resolve_viewer_match(kind)
      :any -> {:ok, :any}
    end
  end

  defp configured_assignee_directive(kind) do
    case provider_assignee_config(kind) do
      value when is_binary(value) ->
        case value |> String.trim() |> String.downcase() do
          "" -> enforcement_directive()
          "me" -> :viewer
          normalized -> {:literal, normalized}
        end

      _ ->
        enforcement_directive()
    end
  end

  defp enforcement_directive do
    if OrchestrationSettings.require_assignee_match?(), do: :viewer, else: :any
  end

  defp provider_assignee_config("github"), do: GitHubConfig.assignee()
  defp provider_assignee_config("local"), do: GitHubConfig.assignee()
  defp provider_assignee_config("linear"), do: LinearConfig.assignee()
  defp provider_assignee_config("jira"), do: JiraConfig.assignee()
  defp provider_assignee_config(_kind), do: nil

  defp resolve_viewer_match(kind) do
    case Identity.resolve(kind) do
      {:ok, %{match_value: value}} when is_binary(value) and value != "" -> {:ok, value}
      {:ok, _identity} -> {:error, :missing_viewer_identity}
      {:error, reason} -> {:error, reason}
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
