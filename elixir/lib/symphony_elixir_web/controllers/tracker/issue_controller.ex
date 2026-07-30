defmodule SymphonyElixirWeb.Tracker.IssueController do
  @moduledoc "Issue endpoints for the local tracker JSON API."

  use Phoenix.Controller, formats: [:json]

  require Logger

  alias Plug.Conn
  alias SymphonyElixir.{AgentPreference, IssueDispatch, Orchestrator, ProjectConfig, Repo}
  alias SymphonyElixir.Claude.GoalControl, as: ClaudeGoal
  alias SymphonyElixir.Codex.GoalControl
  alias SymphonyElixir.GitHub.AttachmentRewriter
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.Viewer
  alias SymphonyElixir.Tracker.{IssueAdapter, LabelResolver}
  alias SymphonyElixir.Tracker.Sync.ParentLink
  alias SymphonyElixirWeb.TrackerErrors
  alias SymphonyElixirWeb.TrackerPresenter

  # Compile-time copy of the canonical list so it can be used in guards.
  @agent_kinds SymphonyElixir.Settings.Agents.agent_kinds()
  @agent_labels %{"codex" => "Codex", "claude" => "Claude", "cursor" => "Cursor", "opencode" => "OpenCode"}
  @goal_actions ~w(get pause resume clear set_objective set_budget)

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
         :ok <- validate_execution_model(project, nil, params),
         attrs =
           params
           |> normalize_create_attrs(project)
           |> maybe_inject_creator(),
         {:ok, issue} <- IssueAdapter.dispatch(project, :create_issue, [attrs]) do
      maybe_establish_codex_goal(project, issue, params)
      persist_execution_settings(project, issue, params)

      conn
      |> put_status(:created)
      |> json(%{data: present_issue(project, reload_issue(project, issue))})
    else
      {:error, :project_not_found} -> TrackerErrors.render(conn, :project_not_found)
      {:error, {:invalid_request, message}} -> TrackerErrors.validation_msg(conn, message)
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
      ParentLink.enqueue_link(project, issue.identifier, parent_identifier)
      maybe_establish_codex_goal(project, issue, params)
      persist_execution_settings(project, issue, params)

      conn
      |> put_status(:created)
      |> json(%{data: present_issue(project, reload_issue(project, issue))})
    else
      {:error, :project_not_found} -> TrackerErrors.render(conn, :project_not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec subtasks(Conn.t(), map()) :: Conn.t()
  def subtasks(conn, %{"project_slug" => project_slug, "identifier" => parent_identifier}) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, identifiers} <- Context.list_subtask_children(project_slug, parent_identifier),
         {:ok, issues} <- load_subtasks(project, identifiers) do
      json(conn, %{data: Enum.map(issues, &present_issue(project, &1))})
    else
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
      ParentLink.enqueue_link(project, identifier, parent_identifier)
      json(conn, %{data: present_issue(project, issue)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def set_parent(conn, _params), do: TrackerErrors.validation_msg(conn, "parent_identifier is required")

  @spec clear_parent(Conn.t(), map()) :: Conn.t()
  def clear_parent(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, parent} <- Context.parent_issue(project_slug, identifier),
         {:ok, _child} <- Context.clear_issue_parent(project_slug, identifier),
         {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      if match?(%{identifier: parent_id} when is_binary(parent_id), parent) do
        ParentLink.enqueue_unlink(project, identifier, parent.identifier)
      end

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

  defp load_subtasks(project, identifiers) do
    Enum.reduce_while(identifiers, {:ok, []}, fn identifier, {:ok, issues} ->
      case IssueAdapter.dispatch(project, :get_issue, [identifier]) do
        {:ok, issue} -> {:cont, {:ok, [issue | issues]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, issues} -> {:ok, Enum.reverse(issues)}
      error -> error
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

      with :ok <- validate_agent_attr(attrs),
           :ok <- validate_execution_model(project, identifier, params) do
        case IssueAdapter.dispatch(project, :update_issue, [identifier, attrs]) do
          {:ok, issue} ->
            if Map.has_key?(attrs, "agent") do
              Orchestrator.cancel_retry(identifier)
              Orchestrator.request_refresh()
            end

            persist_execution_settings(project, issue, params)
            json(conn, %{data: present_issue(project, issue)})

          {:error, reason} ->
            TrackerErrors.render(conn, reason)
        end
      else
        {:error, {:invalid_request, message}} -> TrackerErrors.validation_msg(conn, message)
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
        TrackerErrors.validation_msg(conn, "action must be resume, hard_reset, stop, or continue_work")

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  @doc """
  Drives agent goal controls for an issue. Codex maps onto `thread/goal/*`;
  Claude maps onto the `/goal` sidecar mirror.
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

      {:error, :claude_goal_unsupported_version} ->
        TrackerErrors.validation_msg(conn, "Claude /goal requires Claude Code >= 2.1.139")

      {:error, :unsupported_for_agent} ->
        TrackerErrors.validation_msg(conn, "this goal action is not supported for the issue agent")

      {:error, :objective_too_long} ->
        TrackerErrors.validation_msg(conn, "objective must be at most 4000 characters")

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  defp run_goal_action(project, identifier, action, params) when action in @goal_actions do
    agent = resolve_goal_agent(project, identifier, params)

    case agent do
      "claude" -> run_claude_goal_action(project, identifier, action, params)
      "cursor" -> run_unsupported_goal_action(action)
      "opencode" -> run_unsupported_goal_action(action)
      _ -> run_codex_goal_action(project, identifier, action, params)
    end
  end

  defp run_goal_action(_project, _identifier, _action, _params), do: {:error, :invalid_action}

  defp run_unsupported_goal_action("get"), do: {:ok, nil}
  defp run_unsupported_goal_action(_action), do: {:error, :unsupported_for_agent}

  defp run_claude_goal_action(project, identifier, "get", _params),
    do: ClaudeGoal.get(project, identifier, :execution)

  defp run_claude_goal_action(project, identifier, "pause", _params),
    do: ClaudeGoal.pause(project, identifier, :execution)

  defp run_claude_goal_action(project, identifier, "resume", _params),
    do: ClaudeGoal.resume(project, identifier, :execution)

  defp run_claude_goal_action(project, identifier, "clear", _params),
    do: ClaudeGoal.clear(project, identifier, :execution)

  defp run_claude_goal_action(project, identifier, "set_objective", params),
    do: ClaudeGoal.set_objective(project, identifier, :execution, Map.get(params, "objective", ""))

  defp run_claude_goal_action(project, identifier, "set_budget", _params),
    do: ClaudeGoal.set_budget(project, identifier, :execution, nil)

  defp run_codex_goal_action(project, identifier, "get", _params),
    do: GoalControl.get(project, identifier)

  defp run_codex_goal_action(project, identifier, "pause", _params),
    do: GoalControl.pause(project, identifier)

  defp run_codex_goal_action(project, identifier, "resume", _params),
    do: GoalControl.resume(project, identifier)

  defp run_codex_goal_action(project, identifier, "clear", _params),
    do: GoalControl.clear(project, identifier)

  defp run_codex_goal_action(project, identifier, "set_objective", params),
    do: GoalControl.set_objective(project, identifier, Map.get(params, "objective", ""))

  defp run_codex_goal_action(project, identifier, "set_budget", params) do
    case parse_token_budget(Map.get(params, "token_budget")) do
      {:ok, budget} -> GoalControl.set_budget(project, identifier, budget)
      :error -> {:error, :invalid_budget}
    end
  end

  defp resolve_goal_agent(project, identifier, params) do
    explicit =
      case Map.get(params, "agent") do
        agent when is_binary(agent) -> String.trim(String.downcase(agent))
        _ -> nil
      end

    cond do
      explicit in @agent_kinds ->
        explicit

      true ->
        case Context.get_agent_settings(project.slug, identifier) do
          {:ok, %{agent_kind: kind}} when is_binary(kind) and kind != "" ->
            kind

          _ ->
            case IssueAdapter.dispatch(project, :get_issue, [identifier]) do
              {:ok, %{agent: agent}} when is_binary(agent) and agent != "" -> agent
              {:ok, %{agent_kind: kind}} when is_binary(kind) and kind != "" -> kind
              _ -> "codex"
            end
        end
    end
  end

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
      target_status: Map.get(params, "target_status"),
      model: Map.get(params, "model"),
      effort: Map.get(params, "effort"),
      mode: Map.get(params, "mode"),
      context_refs: Map.get(params, "context_refs", [])
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
    params
    |> Map.take(["title", "description", "status"])
    |> maybe_put_priority(params)
    |> maybe_put_assignee_ids(params)
    |> maybe_put_label_ids(params, project)
    |> maybe_put_agent_update(params)
    |> maybe_put_execution_pins(params)
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

  # Forward model/effort into create/update attrs so LocalTracker.Context can
  # persist pins before PubSub broadcast. Controller still persists after for
  # pure-remote adapters that do not go through Context.
  defp maybe_put_execution_pins(attrs, params) do
    attrs
    |> maybe_copy_execution_param(params, "model")
    |> maybe_copy_execution_param(params, "effort")
  end

  defp maybe_copy_execution_param(attrs, params, key) do
    if Map.has_key?(params, key) do
      Map.put(attrs, key, Map.get(params, key))
    else
      attrs
    end
  end

  defp validate_agent_attr(attrs) do
    if Map.has_key?(attrs, "agent") and attrs["agent"] not in [nil | @agent_kinds] do
      {:error, {:invalid_request, "agent must be codex, claude, cursor, or null"}}
    else
      :ok
    end
  end

  # Reject a model pin the target agent's CLI does not actually offer (e.g. a typo
  # or decommissioned model) before it is persisted and dispatched, and tell the
  # operator which models are valid. Fail-open by design: only a model positively
  # absent from a non-empty catalog is rejected (see `SymphonyElixir.AgentModel`).
  defp validate_execution_model(project, identifier, params) do
    case blank_execution_string(Map.get(params, "model")) do
      nil ->
        :ok

      model ->
        agent_kind = execution_agent_kind(project, identifier, params)

        case SymphonyElixir.AgentModel.validate(agent_kind, model) do
          :ok ->
            :ok

          {:error, %{valid_models: valid_models}} ->
            {:error, {:invalid_request, invalid_model_message(agent_kind, model, valid_models)}}
        end
    end
  end

  defp execution_agent_kind(project, identifier, params) do
    case normalized_agent_param(params) do
      agent when agent in @agent_kinds -> agent
      _ when is_binary(identifier) and identifier != "" -> resolve_goal_agent(project, identifier, params)
      _ -> SymphonyElixir.Settings.Agents.default_agent_kind()
    end
  end

  defp normalized_agent_param(params) do
    case Map.get(params, "agent") do
      agent when is_binary(agent) -> agent |> String.trim() |> String.downcase()
      _ -> nil
    end
  end

  defp invalid_model_message(agent_kind, model, valid_models) do
    valid_text = if valid_models == [], do: "none available", else: Enum.join(valid_models, ", ")

    ~s(Model "#{model}" is not available for #{agent_kind}. Valid #{agent_kind} models: #{valid_text}.)
  end

  # Writes agent/model/effort pins to issue_agent_settings after create/update.
  # Settings are the source of truth; symphony:* label mirror happens via the
  # existing create/update agent attr path (best-effort, settings-first here).
  defp persist_execution_settings(project, issue, params) when is_map(params) do
    attrs = execution_settings_attrs(params)

    if attrs == %{} do
      :ok
    else
      case issue_identifier(issue) do
        identifier when is_binary(identifier) ->
          case Context.put_agent_settings(project.slug, identifier, attrs) do
            :ok ->
              :ok

            {:error, reason} ->
              Logger.warning("Failed to persist execution settings project=#{project.slug} identifier=#{identifier} reason=#{inspect(reason)}")

              :ok
          end

        _ ->
          :ok
      end
    end
  end

  defp execution_settings_attrs(params) when is_map(params) do
    %{}
    |> maybe_put_execution_agent(params)
    |> maybe_put_execution_string(params, "model", :model)
    |> maybe_put_execution_string(params, "effort", :effort)
  end

  defp maybe_put_execution_agent(attrs, params) do
    if Map.has_key?(params, "agent") do
      case Map.get(params, "agent") do
        nil -> Map.put(attrs, :agent_kind, nil)
        agent when agent in @agent_kinds -> Map.put(attrs, :agent_kind, agent)
        _invalid -> attrs
      end
    else
      attrs
    end
  end

  defp maybe_put_execution_string(attrs, params, key, dest) do
    if Map.has_key?(params, key) do
      Map.put(attrs, dest, blank_execution_string(Map.get(params, key)))
    else
      attrs
    end
  end

  defp blank_execution_string(nil), do: nil

  defp blank_execution_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp blank_execution_string(_value), do: nil

  defp issue_identifier(%{identifier: identifier}) when is_binary(identifier), do: identifier
  defp issue_identifier(_issue), do: nil

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

  defp maybe_put_label_ids(attrs, params, project) do
    if Map.has_key?(params, "label_ids") or Map.has_key?(params, "labels") do
      label_ids =
        (Map.get(params, "label_ids") || Map.get(params, "labels"))
        |> normalize_string_list()
        |> then(&LabelResolver.resolve_names(project, &1))

      Map.put(attrs, "label_ids", label_ids)
    else
      attrs
    end
  end

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
    |> maybe_put_execution_pins(params)
  end

  defp maybe_put_agent(attrs, agent) when agent in @agent_kinds, do: Map.put(attrs, "agent", agent)
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
    Enum.map(@agent_kinds, fn kind ->
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
