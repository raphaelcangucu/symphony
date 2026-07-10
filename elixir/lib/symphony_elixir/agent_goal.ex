defmodule SymphonyElixir.AgentGoal do
  @moduledoc """
  Agent-neutral facade for long-running goals.

  Routes `get` / `set_objective` / `pause` / `resume` / `clear` / `set_budget` to
  Codex native goals, Claude `/goal` mirrors, or `unsupported_for_agent` for
  Cursor (and other non-goal agents).
  """

  alias SymphonyElixir.Assistant.AuthoringGoalControl
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Claude.GoalControl, as: ClaudeGoal
  alias SymphonyElixir.Codex.GoalControl, as: CodexGoal
  alias SymphonyElixir.LocalTracker.{Context, Project}
  alias SymphonyElixir.Workspace

  @type context :: String.t()
  @type action :: String.t()

  @spec execute(Project.t(), String.t(), action(), context(), map()) ::
          {:ok, map()} | {:error, term()}
  def execute(%Project{} = project, identifier, action, context, args \\ %{})
      when is_binary(identifier) and is_binary(action) and is_binary(context) and is_map(args) do
    with {:ok, context} <- normalize_context(context),
         {:ok, agent} <- resolve_agent(project, identifier, args) do
      dispatch(project, identifier, action, context, agent, args)
    end
  end

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

  defp codex_dispatch(project, identifier, action, "authoring", args) do
    with {:ok, thread} <- ensure_authoring_thread(project, identifier) do
      case action do
        "get" ->
          wrap_authoring(AuthoringGoalControl.status(thread))

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
  end

  defp claude_dispatch(project, identifier, action, context, args) do
    role = if context == "authoring", do: :authoring, else: :execution

    case action do
      "get" ->
        wrap_execution(ClaudeGoal.get(project, identifier, role))

      "set_objective" ->
        with {:ok, objective} <- required_objective(args),
             {:ok, goal} <- ClaudeGoal.set_objective(project, identifier, role, objective),
             :ok <- maybe_enable_authoring_metadata(project, identifier, context, objective) do
          {:ok, %{goal: goal, enabled: true, objective: objective, native: true}}
        end

      "clear" ->
        case ClaudeGoal.clear(project, identifier, role) do
          {:ok, :cleared} ->
            _ = maybe_disable_authoring_metadata(project, identifier, context)
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

  defp wrap_authoring({:ok, payload, _thread}, opts) do
    data = %{
      enabled: Map.get(payload, :enabled),
      objective: Map.get(payload, :objective),
      native: Map.get(payload, :native),
      goal: Map.get(payload, :goal)
    }

    data = if Keyword.get(opts, :cleared, false), do: Map.put(data, :cleared, true), else: data
    {:ok, data}
  end

  defp wrap_authoring({:error, reason}, _opts), do: {:error, reason}

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

  defp ensure_authoring_thread(%Project{} = project, identifier) do
    issue_ref = %{id: nil, identifier: identifier, project_slug: project.slug}

    History.ensure_issue_thread(project.slug, identifier, %{
      workspace_path: Workspace.path_for_issue(issue_ref)
    })
  end

  defp maybe_enable_authoring_metadata(project, identifier, "authoring", objective) do
    case ensure_authoring_thread(project, identifier) do
      {:ok, thread} ->
        case History.set_goal_mode(thread, true, objective) do
          {:ok, _} -> :ok
          {:error, reason} -> {:error, reason}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp maybe_enable_authoring_metadata(_project, _identifier, _context, _objective), do: :ok

  defp maybe_disable_authoring_metadata(project, identifier, "authoring") do
    case ensure_authoring_thread(project, identifier) do
      {:ok, thread} ->
        case History.set_goal_mode(thread, false, nil) do
          {:ok, _} -> :ok
          {:error, _} -> :ok
        end

      _ ->
        :ok
    end
  end

  defp maybe_disable_authoring_metadata(_project, _identifier, _context), do: :ok
end
