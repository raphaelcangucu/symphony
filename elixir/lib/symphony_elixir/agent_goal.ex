defmodule SymphonyElixir.AgentGoal do
  @moduledoc """
  Agent-neutral facade for long-running goals.

  Routes `get` / `set_objective` / `pause` / `resume` / `clear` / `set_budget` to
  Codex native goals, Claude `/goal` mirrors, or `unsupported_for_agent` for
  Cursor (and other non-goal agents).
  """

  alias SymphonyElixir.Assistant.AuthoringGoalControl
  alias SymphonyElixir.Assistant.{History, Thread, TurnManager}
  alias SymphonyElixir.Claude.GoalControl, as: ClaudeGoal
  alias SymphonyElixir.Codex.GoalControl, as: CodexGoal
  alias SymphonyElixir.LocalTracker.{Context, Project}

  @type context :: String.t()
  @type action :: String.t()

  @spec execute(Project.t() | nil, String.t() | nil, action(), context(), map(), keyword()) ::
          {:ok, map()} | {:error, term()}
  def execute(project, identifier, action, context, args \\ %{}, opts \\ [])
      when (is_struct(project, Project) or is_nil(project)) and (is_binary(identifier) or is_nil(identifier)) and
             is_binary(action) and is_binary(context) and is_map(args) and is_list(opts) do
    with {:ok, context} <- normalize_context(context) do
      execute_context(project, identifier, action, context, args, opts)
    end
  end

  defp execute_context(project, _identifier, action, "authoring", args, opts) do
    with {:ok, thread} <- current_authoring_thread(project, opts),
         {:ok, agent} <- resolve_authoring_agent(thread, args, opts) do
      authoring_dispatch(%{thread | agent_kind: agent}, action, args)
    end
  end

  defp execute_context(%Project{} = project, identifier, action, "execution", args, _opts)
       when is_binary(identifier) do
    with {:ok, agent} <- resolve_agent(project, identifier, args) do
      dispatch(project, identifier, action, "execution", agent, args)
    end
  end

  defp execute_context(_project, _identifier, _action, "execution", _args, _opts),
    do: {:error, :missing_identifier}

  defp dispatch(project, identifier, action, context, "codex", args) do
    codex_dispatch(project, identifier, action, context, args)
  end

  defp dispatch(project, identifier, action, context, "claude", args) do
    claude_dispatch(project, identifier, action, context, args)
  end

  defp dispatch(_project, _identifier, action, _context, _agent, _args)
       when action in ["get"] do
    {:ok, %{goal: nil}}
  end

  defp dispatch(_project, _identifier, _action, _context, _agent, _args) do
    {:error, :unsupported_for_agent}
  end

  defp codex_dispatch(project, identifier, action, "execution", args) do
    case action do
      "get" ->
        wrap_execution(CodexGoal.get(project, identifier))

      "set_objective" ->
        with {:ok, objective} <- required_objective(args) do
          wrap_execution(CodexGoal.set_objective(project, identifier, objective))
        end

      "pause" ->
        wrap_execution(CodexGoal.pause(project, identifier))

      "resume" ->
        wrap_execution(CodexGoal.resume(project, identifier))

      "clear" ->
        wrap_clear(CodexGoal.clear(project, identifier))

      "set_budget" ->
        with {:ok, budget} <- parse_token_budget(Map.get(args, "token_budget")) do
          wrap_execution(CodexGoal.set_budget(project, identifier, budget))
        end

      other ->
        {:error, {:invalid_action, other}}
    end
  end

  defp authoring_dispatch(thread, action, args) do
    case action do
      "get" ->
        coalesced_authoring_status(thread)

      "set_objective" ->
        with {:ok, objective} <- required_objective(args) do
          wrap_authoring(AuthoringGoalControl.set_objective(thread, objective))
        end

      "pause" ->
        wrap_authoring(AuthoringGoalControl.pause(thread))

      "resume" ->
        wrap_authoring(AuthoringGoalControl.resume(thread))

      "clear" ->
        wrap_authoring(AuthoringGoalControl.clear(thread), cleared: true)

      "set_budget" ->
        {:error, "token_budget is only supported for execution goals (context: execution)."}

      other ->
        {:error, {:invalid_action, other}}
    end
  end

  defp claude_dispatch(project, identifier, action, _context, args) do
    role = :execution

    case action do
      "get" ->
        wrap_execution(ClaudeGoal.get(project, identifier, role))

      "set_objective" ->
        with {:ok, objective} <- required_objective(args),
             {:ok, goal} <- ClaudeGoal.set_objective(project, identifier, role, objective) do
          {:ok, %{goal: goal, enabled: true, objective: objective, native: true}}
        end

      "clear" ->
        case ClaudeGoal.clear(project, identifier, role) do
          {:ok, :cleared} ->
            {:ok, %{goal: nil, cleared: true, enabled: false, objective: nil, native: false}}

          {:ok, goal} ->
            {:ok, %{goal: goal, cleared: false, enabled: true, objective: Map.get(goal, "objective"), native: true}}

          {:error, reason} ->
            {:error, reason}
        end

      "pause" ->
        ClaudeGoal.pause(project, identifier, role)

      "resume" ->
        ClaudeGoal.resume(project, identifier, role)

      "set_budget" ->
        ClaudeGoal.set_budget(project, identifier, role, Map.get(args, "token_budget"))

      other ->
        {:error, {:invalid_action, other}}
    end
  end

  defp wrap_execution({:ok, nil}), do: {:ok, %{goal: nil}}
  defp wrap_execution({:ok, :cleared}), do: {:ok, %{goal: nil, cleared: true}}
  defp wrap_execution({:ok, goal}), do: {:ok, %{goal: goal}}
  defp wrap_execution({:error, reason}), do: {:error, reason}

  defp wrap_clear({:ok, :cleared}), do: {:ok, %{goal: nil, cleared: true}}
  defp wrap_clear({:ok, goal}), do: {:ok, %{goal: goal, cleared: true}}
  defp wrap_clear({:error, reason}), do: {:error, reason}

  defp wrap_authoring(result, opts \\ [])

  defp wrap_authoring({:ok, payload, thread}, opts) do
    data = %{
      enabled: Map.get(payload, :enabled),
      objective: Map.get(payload, :objective),
      native: Map.get(payload, :native),
      status: Map.get(payload, :status),
      provider: Map.get(payload, :provider),
      source: Map.get(payload, :source),
      capabilities: Map.get(payload, :capabilities, []),
      revision: History.thread_goal_revision(thread) || Map.get(payload, :revision),
      updated_at: History.thread_goal_updated_at(thread) || Map.get(payload, :updated_at),
      request_order:
        Keyword.get_lazy(opts, :request_order, fn ->
          System.unique_integer([:positive, :monotonic])
        end),
      goal: Map.get(payload, :goal)
    }

    data = if Keyword.get(opts, :cleared, false), do: Map.put(data, :cleared, true), else: data
    {:ok, data}
  end

  defp wrap_authoring({:error, reason}, _opts), do: {:error, reason}

  defp coalesced_authoring_status(%Thread{id: id}) when is_integer(id) do
    operation = fn ->
      with {:ok, current_thread} <- History.get_thread(id) do
        AuthoringGoalControl.status(current_thread)
      end
    end

    case TurnManager.resolve_goal_status_sync(id, operation) do
      {:ok, result, request_order} -> wrap_authoring(result, request_order: request_order)
      {:error, reason} -> {:error, reason}
    end
  end

  defp resolve_agent(%Project{} = project, identifier, args) do
    explicit = normalize_agent(Map.get(args, "agent") || Map.get(args, :agent))

    cond do
      is_binary(explicit) ->
        {:ok, explicit}

      true ->
        case Context.get_agent_settings(project.slug, identifier) do
          {:ok, %{agent_kind: kind}} when is_binary(kind) and kind != "" ->
            {:ok, normalize_agent(kind) || "codex"}

          _ ->
            case Context.get_issue(project.slug, identifier) do
              {:ok, %{agent: agent}} when is_binary(agent) and agent != "" ->
                {:ok, normalize_agent(agent) || "codex"}

              {:ok, %{agent_kind: kind}} when is_binary(kind) and kind != "" ->
                {:ok, normalize_agent(kind) || "codex"}

              _ ->
                {:ok, "codex"}
            end
        end
    end
  end

  defp resolve_authoring_agent(%Thread{} = thread, args, opts) do
    explicit = normalize_agent(Map.get(args, "agent") || Map.get(args, :agent))

    current =
      normalize_agent(Keyword.get(opts, :agent_kind)) ||
        normalize_agent(thread.agent_kind) ||
        inferred_thread_agent(thread)

    cond do
      current not in ["codex", "claude"] ->
        {:error, {:authoring_goal_unavailable, {:unsupported_agent, current || "unknown"}}}

      is_binary(explicit) and explicit != current ->
        {:error, {:assistant_thread_agent_mismatch, current, explicit}}

      true ->
        {:ok, current}
    end
  end

  defp inferred_thread_agent(%Thread{} = thread) do
    cond do
      match?({:ok, _ref}, History.conversation_ref(thread, "claude")) -> "claude"
      match?({:ok, _ref}, History.conversation_ref(thread, "codex")) -> "codex"
      true -> nil
    end
  end

  defp current_authoring_thread(project, opts) do
    with {:ok, thread_id} <- required_thread_id(Keyword.get(opts, :assistant_thread_id)),
         {:ok, %Thread{} = thread} <- History.get_thread(thread_id),
         :ok <- validate_active_thread(thread),
         :ok <- validate_thread_project(thread, project),
         :ok <- validate_thread_issue(thread, Keyword.get(opts, :bound_issue_identifier)) do
      {:ok, thread}
    end
  end

  defp required_thread_id(id) when is_integer(id) and id > 0, do: {:ok, id}
  defp required_thread_id(_id), do: {:error, :missing_assistant_thread}

  defp validate_active_thread(%Thread{status: "active"}), do: :ok
  defp validate_active_thread(%Thread{}), do: {:error, :assistant_thread_not_active}

  defp validate_thread_project(%Thread{project_slug: nil}, nil), do: :ok
  defp validate_thread_project(%Thread{}, nil), do: :ok

  defp validate_thread_project(%Thread{project_slug: slug}, %Project{slug: slug})
       when is_binary(slug),
       do: :ok

  defp validate_thread_project(%Thread{}, _project), do: {:error, :assistant_thread_context_mismatch}

  defp validate_thread_issue(%Thread{issue_identifier: identifier}, identifier)
       when is_binary(identifier) and identifier != "",
       do: :ok

  defp validate_thread_issue(%Thread{}, nil), do: :ok
  defp validate_thread_issue(%Thread{}, _identifier), do: {:error, :assistant_thread_context_mismatch}

  defp normalize_agent(agent) when is_binary(agent) do
    case String.trim(String.downcase(agent)) do
      "codex" -> "codex"
      "claude" -> "claude"
      "cursor" -> "cursor"
      "opencode" -> "opencode"
      _ -> nil
    end
  end

  defp normalize_agent(_), do: nil

  defp normalize_context("authoring"), do: {:ok, "authoring"}
  defp normalize_context("execution"), do: {:ok, "execution"}
  defp normalize_context(_), do: {:error, :invalid_context}

  defp required_objective(args) do
    case Map.get(args, "objective") || Map.get(args, :objective) do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> {:error, :empty_objective}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, :empty_objective}
    end
  end

  defp parse_token_budget(nil), do: {:ok, nil}
  defp parse_token_budget(value) when is_integer(value) and value > 0, do: {:ok, value}

  defp parse_token_budget(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {budget, ""} when budget > 0 -> {:ok, budget}
      _ -> {:error, :invalid_budget}
    end
  end

  defp parse_token_budget(_), do: {:error, :invalid_budget}
end
