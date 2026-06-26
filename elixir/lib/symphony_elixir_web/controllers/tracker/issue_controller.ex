defmodule SymphonyElixirWeb.Tracker.IssueController do
  @moduledoc "Issue endpoints for the local tracker JSON API."

  use Phoenix.Controller, formats: [:json]

  require Logger

  alias Plug.Conn
  alias SymphonyElixir.{AgentPreference, IssueDispatch, Orchestrator, ProjectConfig, Repo}
  alias SymphonyElixir.Codex.GoalControl
  alias SymphonyElixir.GitHub.AttachmentRewriter
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.Viewer
  alias SymphonyElixir.Tracker.{IssueAdapter, LabelResolver}
  alias SymphonyElixirWeb.TrackerErrors
  alias SymphonyElixirWeb.TrackerPresenter

  @agent_labels %{"codex" => "Codex", "claude" => "Claude", "cursor" => "Cursor"}

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug} = params) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, filters} <- build_filters(params),
         {:ok, issues} <- IssueAdapter.dispatch(project, :list_issues, [filters]) do
      json(conn, %{data: Enum.map(issues, &present_issue(project, &1))})
    else
      {:error, :project_not_found} -> TrackerErrors.render(conn, :project_not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec form_options(Conn.t(), map()) :: Conn.t()
  def form_options(conn, %{"project_slug" => project_slug}) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, labels} <- list_form_labels(project),
         {:ok, users} <- list_form_assignees(project),
         {:ok, statuses} <- IssueAdapter.dispatch(project, :list_statuses, []) do
      json(conn, %{
        data: %{
          labels: Enum.map(labels, &present_label/1),
          assignees: Enum.map(users, &present_user/1),
          statuses: Enum.map(statuses, &TrackerPresenter.status/1),
          agents: agent_options(),
          effective_agent: effective_agent(project)
        }
      })
    else
      {:error, :project_not_found} -> TrackerErrors.render(conn, :project_not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"project_slug" => project_slug} = params) do
    with {:ok, project} <- Context.get_project(project_slug),
         attrs =
           params
           |> normalize_create_attrs(project)
           |> maybe_inject_creator(),
         {:ok, issue} <- IssueAdapter.dispatch(project, :create_issue, [attrs]) do
      maybe_establish_codex_goal(project, issue, params)

      conn
      |> put_status(:created)
      |> json(%{data: present_issue(project, reload_issue(project, issue))})
    else
      {:error, :project_not_found} -> TrackerErrors.render(conn, :project_not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec create_subtask(Conn.t(), map()) :: Conn.t()
  def create_subtask(conn, %{"project_slug" => project_slug, "identifier" => parent_identifier} = params) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, _parent} <- IssueAdapter.dispatch(project, :get_issue, [parent_identifier]),
         attrs =
           params
           |> Map.drop(["project_slug", "identifier"])
           |> normalize_create_attrs(project)
           |> maybe_inject_creator(),
         {:ok, issue} <- IssueAdapter.dispatch(project, :create_issue, [attrs]),
         {:ok, _child} <- Context.set_issue_parent(project_slug, issue.identifier, parent_identifier) do
      maybe_establish_codex_goal(project, issue, params)

      conn
      |> put_status(:created)
      |> json(%{data: present_issue(project, reload_issue(project, issue))})
    else
      {:error, :project_not_found} -> TrackerErrors.render(conn, :project_not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec set_parent(Conn.t(), map()) :: Conn.t()
  def set_parent(conn, %{
        "project_slug" => project_slug,
        "identifier" => identifier,
        "parent_identifier" => parent_identifier
      })
      when is_binary(parent_identifier) and parent_identifier != "" do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, _child} <- Context.set_issue_parent(project_slug, identifier, parent_identifier),
         {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      json(conn, %{data: present_issue(project, issue)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def set_parent(conn, _params), do: TrackerErrors.validation_msg(conn, "parent_identifier is required")

  @spec clear_parent(Conn.t(), map()) :: Conn.t()
  def clear_parent(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, _child} <- Context.clear_issue_parent(project_slug, identifier),
         {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      json(conn, %{data: present_issue(project, issue)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  # Codex goals live on the native Codex thread, not on `agent_goal`. When an
  # issue is created with a Codex goal, establish the native thread + goal now so
  # the UI and future runs read it from Codex. Best-effort: never fails issue
  # creation (e.g. when goal mode is disabled or the workspace is unavailable).
  defp maybe_establish_codex_goal(project, issue, params) do
    with "codex" <- Map.get(params, "agent"),
         goal when is_binary(goal) <- Map.get(params, "goal"),
         trimmed when trimmed != "" <- String.trim(goal),
         identifier when is_binary(identifier) <- Map.get(issue, :identifier) do
      case GoalControl.set_objective(project, identifier, trimmed) do
        {:ok, _goal} ->
          :ok

        {:error, reason} ->
          Logger.debug("Skipping Codex goal establishment on create identifier=#{identifier} reason=#{inspect(reason)}")
          :ok
      end
    else
      _ -> :ok
    end
  end

  defp reload_issue(project, issue) do
    case Map.get(issue, :identifier) do
      identifier when is_binary(identifier) ->
        case IssueAdapter.dispatch(project, :get_issue, [identifier]) do
          {:ok, reloaded} -> reloaded
          _ -> issue
        end

      _ ->
        issue
    end
  end

  # Symphony-managed GitHub asset URLs that could not be mapped to a local upload
  # are rewritten to the bearer-authenticated tracker proxy path so the SPA can
  # render private-repo images. This is a render-time concern only — nothing is
  # persisted and agent-facing presenters are left untouched.
  defp present_issue(project, issue) do
    issue
    |> rewrite_remote_assets(project)
    |> TrackerPresenter.issue()
  end

  defp rewrite_remote_assets(%{description: description} = issue, %{slug: slug})
       when is_binary(description) and is_binary(slug) do
    %{issue | description: AttachmentRewriter.proxy_remote_assets(description, slug)}
  end

  defp rewrite_remote_assets(issue, _project), do: issue

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"project_slug" => project_slug, "id" => identifier}) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      json(conn, %{data: present_issue(project, issue)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec update(Conn.t(), map()) :: Conn.t()
  def update(conn, %{"project_slug" => project_slug, "id" => identifier} = params) do
    with {:ok, project} <- Context.get_project(project_slug) do
      attrs =
        params
        |> Map.drop(["project_slug", "id"])
        |> normalize_update_attrs(project)

      if Map.has_key?(attrs, "agent") and attrs["agent"] not in ["codex", "claude", "cursor", nil] do
        TrackerErrors.validation_msg(conn, "agent must be codex, claude, cursor, or null")
      else
        case IssueAdapter.dispatch(project, :update_issue, [identifier, attrs]) do
          {:ok, issue} ->
            if Map.has_key?(attrs, "agent") do
              Orchestrator.cancel_retry(identifier)
              Orchestrator.request_refresh()
            end

            json(conn, %{data: present_issue(project, issue)})

          {:error, reason} ->
            TrackerErrors.render(conn, reason)
        end
      end
    else
      {:error, :project_not_found} -> TrackerErrors.render(conn, :project_not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec move(Conn.t(), map()) :: Conn.t()
  def move(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    attrs = Map.drop(params, ["project_slug", "identifier"])

    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, issue} <- IssueAdapter.dispatch(project, :move_issue, [identifier, attrs]) do
      json(conn, %{data: present_issue(project, issue)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec sync(Conn.t(), map()) :: Conn.t()
  def sync(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, _record} <- SymphonyElixir.Tracker.Sync.Engine.sync_issue(project, identifier),
         {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      json(conn, %{data: present_issue(project, issue)})
    else
      {:error, :project_not_found} -> TrackerErrors.render(conn, :project_not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec archive(Conn.t(), map()) :: Conn.t()
  def archive(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    dispatch_issue_action(conn, project_slug, :archive_issue, [identifier])
  end

  @spec restore(Conn.t(), map()) :: Conn.t()
  def restore(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    dispatch_issue_action(conn, project_slug, :restore_issue, [identifier])
  end

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    dispatch_issue_action(conn, project_slug, :delete_issue, [identifier])
  end

  @spec dispatch_agent(Conn.t(), map()) :: Conn.t()
  def dispatch_agent(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    action = Map.get(params, "action", "resume")
    opts = dispatch_opts(params)

    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, result} <- run_dispatch_action(project, identifier, action, opts) do
      json(conn, %{data: result})
    else
      {:error, :project_not_found} ->
        TrackerErrors.render(conn, :project_not_found)

      {:error, :invalid_action} ->
        TrackerErrors.validation_msg(conn, "action must be resume, restart, hard_reset, stop, or continue_work")

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  @doc """
  Drives the native Codex goal controls (pause/resume/clear/edit/budget/get) for
  an issue's durable goal thread. Mutations map directly onto `thread/goal/*`.
  """
  @spec goal_control(Conn.t(), map()) :: Conn.t()
  def goal_control(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    action = Map.get(params, "action", "get")

    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, result} <- run_goal_action(project, identifier, action, params) do
      json(conn, %{data: goal_control_payload(action, result)})
    else
      {:error, :project_not_found} ->
        TrackerErrors.render(conn, :project_not_found)

      {:error, :invalid_action} ->
        TrackerErrors.validation_msg(conn, "action must be get, pause, resume, clear, set_objective, or set_budget")

      {:error, :empty_objective} ->
        TrackerErrors.validation_msg(conn, "objective is required for set_objective")

      {:error, :invalid_budget} ->
        TrackerErrors.validation_msg(conn, "token_budget must be a positive integer or null")

      {:error, :goals_disabled} ->
        TrackerErrors.validation_msg(conn, "Codex goal mode is disabled for this project")

      {:error, :no_codex_thread} ->
        TrackerErrors.validation_msg(conn, "no Codex goal thread exists for this issue yet")

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  defp run_goal_action(project, identifier, "get", _params),
    do: GoalControl.get(project, identifier)

  defp run_goal_action(project, identifier, "pause", _params),
    do: GoalControl.pause(project, identifier)

  defp run_goal_action(project, identifier, "resume", _params),
    do: GoalControl.resume(project, identifier)

  defp run_goal_action(project, identifier, "clear", _params),
    do: GoalControl.clear(project, identifier)

  defp run_goal_action(project, identifier, "set_objective", params),
    do: GoalControl.set_objective(project, identifier, Map.get(params, "objective", ""))

  defp run_goal_action(project, identifier, "set_budget", params) do
    case parse_token_budget(Map.get(params, "token_budget")) do
      {:ok, budget} -> GoalControl.set_budget(project, identifier, budget)
      :error -> {:error, :invalid_budget}
    end
  end

  defp run_goal_action(_project, _identifier, _action, _params), do: {:error, :invalid_action}

  defp parse_token_budget(nil), do: {:ok, nil}
  defp parse_token_budget(value) when is_integer(value) and value > 0, do: {:ok, value}

  defp parse_token_budget(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {budget, ""} when budget > 0 -> {:ok, budget}
      _ -> :error
    end
  end

  defp parse_token_budget(_value), do: :error

  defp goal_control_payload(action, :cleared), do: %{action: action, cleared: true, goal: nil}
  defp goal_control_payload(action, goal), do: %{action: action, goal: goal}

  defp run_dispatch_action(project, identifier, "resume", opts),
    do: IssueDispatch.resume(project, identifier, opts)

  defp run_dispatch_action(project, identifier, "restart", opts),
    do: IssueDispatch.restart(project, identifier, opts)

  defp run_dispatch_action(project, identifier, "hard_reset", opts),
    do: IssueDispatch.hard_reset(project, identifier, opts)

  defp run_dispatch_action(project, identifier, "stop", opts),
    do: IssueDispatch.stop(project, identifier, opts)

  defp run_dispatch_action(project, identifier, "continue_work", opts),
    do: IssueDispatch.continue_work(project, identifier, opts)

  defp run_dispatch_action(_project, _identifier, _action, _opts), do: {:error, :invalid_action}

  defp dispatch_opts(params) do
    %{
      agent: Map.get(params, "agent"),
      goal: Map.get(params, "goal"),
      instructions: Map.get(params, "instructions"),
      target_status: Map.get(params, "target_status")
    }
  end

  defp dispatch_issue_action(conn, project_slug, action, args) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, issue} <- IssueAdapter.dispatch(project, action, args) do
      json(conn, %{data: present_issue(project, issue)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp build_filters(params) do
    with {:ok, assignee} <- resolve_me(Map.get(params, "assignee")),
         {:ok, creator} <- resolve_me(Map.get(params, "creator")) do
      filters =
        []
        |> put_filter(:search, trim_or_nil(Map.get(params, "q")))
        |> put_filter(:assignee, assignee)
        |> put_filter(:creator, creator)

      {:ok, filters}
    end
  end

  defp put_filter(opts, _key, nil), do: opts
  defp put_filter(opts, _key, ""), do: opts
  defp put_filter(opts, key, value), do: Keyword.put(opts, key, value)

  defp resolve_me(nil), do: {:ok, nil}
  defp resolve_me(""), do: {:ok, nil}

  defp resolve_me("me") do
    case Viewer.current() do
      {:ok, %{login: login}} -> {:ok, login}
      {:error, _reason} = error -> error
    end
  end

  defp resolve_me(value) when is_binary(value), do: {:ok, value}

  defp normalize_update_attrs(params, %{} = project) do
    label_ids =
      params
      |> Map.get("label_ids", Map.get(params, "labels"))
      |> normalize_string_list()
      |> then(&LabelResolver.resolve_names(project, &1))

    params
    |> Map.take(["title", "description", "status"])
    |> maybe_put_priority(params)
    |> maybe_put_assignee_ids(params)
    |> maybe_put_label_ids(label_ids)
    |> maybe_put_agent_update(params)
  end

  # Preserve the raw "agent" value (including nil and invalid strings) when the
  # key is present so update/2 can validate it and Context can clear/replace the
  # routing label. Absent key stays absent (no-op for routing labels).
  defp maybe_put_agent_update(attrs, params) do
    if Map.has_key?(params, "agent") do
      Map.put(attrs, "agent", Map.get(params, "agent"))
    else
      attrs
    end
  end

  defp maybe_put_priority(attrs, params) do
    if Map.has_key?(params, "priority") do
      Map.put(attrs, "priority", params["priority"])
    else
      attrs
    end
  end

  defp maybe_put_assignee_ids(attrs, params) do
    if Map.has_key?(params, "assignee_ids") or Map.has_key?(params, "assignees") do
      assignee_ids =
        normalize_string_list(Map.get(params, "assignee_ids") || Map.get(params, "assignees"))

      Map.put(attrs, "assignee_ids", assignee_ids)
    else
      attrs
    end
  end

  defp maybe_put_label_ids(attrs, []), do: attrs
  defp maybe_put_label_ids(attrs, label_ids), do: Map.put(attrs, "label_ids", label_ids)

  defp normalize_create_attrs(params, %{} = project) do
    label_ids =
      params
      |> Map.get("label_ids", Map.get(params, "labels"))
      |> normalize_string_list()
      |> then(&LabelResolver.resolve_names(project, &1))

    assignee_ids = normalize_string_list(Map.get(params, "assignee_ids") || Map.get(params, "assignees"))

    params
    |> Map.take(["title", "description", "status", "priority"])
    |> Map.put("label_ids", label_ids)
    |> Map.put("assignee_ids", assignee_ids)
    |> maybe_put_agent(Map.get(params, "agent"))
    |> maybe_put_agent_goal(Map.get(params, "agent"), Map.get(params, "goal"))
  end

  defp maybe_put_agent(attrs, agent) when agent in ["codex", "claude", "cursor"], do: Map.put(attrs, "agent", agent)
  defp maybe_put_agent(attrs, _agent), do: attrs

  # Claude/Cursor consume `agent_goal` as workflow guidance. Codex goals are not
  # stored here — they live on the native Codex thread and are established via
  # `maybe_establish_codex_goal/3` after the issue exists.
  defp maybe_put_agent_goal(attrs, agent, goal) when agent in ["claude", "cursor"] and is_binary(goal) do
    case String.trim(goal) do
      "" -> attrs
      trimmed -> Map.put(attrs, "agent_goal", trimmed)
    end
  end

  defp maybe_put_agent_goal(attrs, _agent, _goal), do: attrs

  defp normalize_string_list(value) when is_list(value) do
    value
    |> Enum.filter(&(is_binary(&1) and String.trim(&1) != ""))
    |> Enum.map(&String.trim/1)
    |> Enum.uniq()
  end

  defp normalize_string_list(_value), do: []

  # Both coding-agent backends are always selectable per task; no option is
  # highlighted as "default" since the effective agent is exposed separately via
  # effective_agent/1 (resolved at the project level at form-load time).
  defp agent_options do
    Enum.map(["codex", "claude", "cursor"], fn kind ->
      %{value: kind, label: Map.fetch!(@agent_labels, kind), default: false}
    end)
  end

  defp effective_agent(project) do
    project_kind =
      project
      |> Repo.preload(:setup)
      |> ProjectConfig.resolve()
      |> Map.get(:agent_kind)

    AgentPreference.resolve([], project_kind)
  end

  defp list_form_labels(project) do
    with {:ok, labels} <- remote_catalog(project, :list_labels),
         true <- labels != [] do
      {:ok, labels}
    else
      _ -> IssueAdapter.dispatch(project, :list_labels, [])
    end
  end

  defp list_form_assignees(project) do
    with {:ok, users} <- IssueAdapter.dispatch(project, :list_assignable_users, []),
         true <- users != [] do
      {:ok, users}
    else
      _ ->
        with {:ok, users} <- remote_catalog(project, :list_assignable_users),
             :ok <- SymphonyElixir.Tracker.Sync.LocalStore.upsert_users(project, users) do
          {:ok, users}
        else
          _ -> {:ok, []}
        end
    end
  end

  defp remote_catalog(%{tracker_kind: kind} = project, fun) when fun in [:list_labels, :list_assignable_users] do
    case IssueAdapter.remote_for(kind) do
      nil ->
        {:error, :local_tracker}

      module ->
        apply(module, fun, [project])
    end
  end

  defp present_label(label) when is_map(label) do
    %{id: Map.get(label, :id), name: Map.get(label, :name), color: Map.get(label, :color)}
  end

  defp present_user(user) when is_map(user) do
    %{
      id: Map.get(user, :id),
      login: Map.get(user, :login),
      name: Map.get(user, :name),
      avatar_url: Map.get(user, :avatar_url)
    }
  end

  defp maybe_inject_creator(attrs) do
    case Viewer.current() do
      {:ok, %{login: login}} -> Map.put_new(attrs, "creator", login)
      {:error, _reason} -> attrs
    end
  end

  defp trim_or_nil(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp trim_or_nil(_), do: nil
end
