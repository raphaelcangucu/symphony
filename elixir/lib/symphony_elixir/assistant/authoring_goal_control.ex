defmodule SymphonyElixir.Assistant.AuthoringGoalControl do
  @moduledoc """
  Operator controls for the thread-scoped **Authoring goal** that runs native
  goal mode directly inside an assistant conversation.

  This is the authoring counterpart to `SymphonyElixir.Codex.GoalControl` (which
  drives the orchestrator/execution goal keyed by issue). Here the native goal
  lives on the *assistant thread's* Codex thread (`agent_thread_ids["codex"]`), so
  every control resumes that specific thread via `CodingAgent.manage_goal/3`.

  Thread metadata (`goal_mode` + `goal_objective`) stays as the enabled-flag and
  display fallback; the native Codex goal is the source of truth for operational
  status, timer, and budget. When no native goal exists yet (the goal is enabled
  but no turn has established it), we return a metadata-only payload so the UI can
  still show the objective and offer edit/remove.

  All controls return a normalized payload shaped for the front-end
  `normalizeGoal/1` (camelCase keys), plus the enabled flag and objective.
  """

  require Logger

  alias SymphonyElixir.Assistant.{History, Thread}
  alias SymphonyElixir.Codex.CodingAgent
  alias SymphonyElixir.Claude.GoalStore, as: ClaudeGoalStore
  alias SymphonyElixir.{AgentAvailability, Config, InstanceConfig, ProjectConfig, Repo}
  alias SymphonyElixir.LocalTracker.Context

  @native_agent_kind "codex"
  @capabilities ["get", "edit", "pause", "resume", "clear"]

  @type payload :: %{
          enabled: boolean(),
          objective: String.t() | nil,
          native: boolean(),
          status: String.t() | nil,
          capabilities: [String.t()],
          goal: map() | nil
        }

  @type result :: {:ok, payload(), Thread.t()} | {:error, term()}

  @doc """
  Builds a goal-status payload from a native Codex goal map already received
  during a turn (e.g. `thread/goal/updated`). Avoids a blocking `thread/goal/get`
  round-trip while a goal batch is streaming.
  """
  @spec payload_from_native_update(Thread.t(), map()) :: payload()
  def payload_from_native_update(%Thread{} = thread, native_goal) when is_map(native_goal) do
    build_payload(
      History.thread_goal_mode(thread),
      History.thread_goal_objective(thread),
      native_goal
    )
  end

  @doc "Reads the current authoring goal state (native goal when available, else metadata-only)."
  @spec status(Thread.t()) :: result()
  def status(%Thread{} = thread) do
    enabled = History.thread_goal_mode(thread)
    objective = History.thread_goal_objective(thread)

    case fetch_native_goal(thread) do
      {:ok, goal} -> {:ok, build_payload(enabled, objective, goal), thread}
      {:error, :no_codex_thread} -> {:ok, build_payload(enabled, objective, nil), thread}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Validates and enables authoring Goal Mode on the exact assistant thread."
  @spec enable(Thread.t(), String.t() | nil) :: result()
  def enable(%Thread{} = thread, objective \\ nil) do
    case normalize_optional_objective(objective) do
      nil ->
        with :ok <- validate_activation(thread),
             {:ok, updated} <- History.set_goal_mode(thread, true, nil) do
          {:ok, build_payload(true, nil, nil), updated}
        end

      normalized ->
        set_objective(thread, normalized)
    end
  end

  @doc "Pauses the native authoring goal (status: paused). Keeps the goal enabled. Codex only."
  @spec pause(Thread.t()) :: result()
  def pause(%Thread{} = thread) do
    case authoring_agent(thread) do
      "claude" -> {:error, :unsupported_for_agent}
      _ -> with_native(thread, {:set, %{status: "paused"}})
    end
  end

  @doc """
  Flips the native authoring goal back to active. Codex only — Claude has no
  pause/resume on `/goal`.
  """
  @spec resume(Thread.t()) :: result()
  def resume(%Thread{} = thread) do
    case authoring_agent(thread) do
      "claude" -> {:error, :unsupported_for_agent}
      _ -> with_native(thread, {:set, %{status: "active"}})
    end
  end

  @doc "Removes the authoring goal after native/storage clear succeeds."
  @spec clear(Thread.t()) :: result()
  def clear(%Thread{} = thread) do
    with :ok <- clear_native_goal(thread),
         {:ok, updated} <- History.set_goal_mode(thread, false, nil) do
      {:ok, build_payload(false, nil, nil), updated}
    end
  end

  @doc """
  Replaces the authoring objective. Persists it to thread metadata and syncs the
  agent-native goal when possible (Codex thread/goal or Claude /goal mirror).

  Activation validates the persisted workspace and native provider before
  metadata is changed.
  """
  @spec set_objective(Thread.t(), String.t()) :: result()
  def set_objective(%Thread{} = thread, objective) when is_binary(objective) do
    case String.trim(objective) do
      "" ->
        {:error, :empty_objective}

      trimmed ->
        with :ok <- validate_activation(thread),
             {:ok, goal} <- activate_native_objective(thread, trimmed),
             {:ok, updated} <- History.set_goal_mode(thread, true, trimmed) do
          {:ok, build_payload(true, trimmed, goal), updated}
        end
    end
  end

  @doc """
  Compatibility entry point for callers that previously requested a metadata-only
  update. It now performs the same full preflight and native synchronization as
  `set_objective/2`; callers cannot bypass activation safety.
  """
  @spec set_objective_metadata(Thread.t(), String.t()) :: result()
  def set_objective_metadata(%Thread{} = thread, objective) when is_binary(objective) do
    case String.trim(objective) do
      "" ->
        {:error, :empty_objective}

      trimmed ->
        with :ok <- validate_activation(thread),
             {:ok, updated} <- History.set_goal_mode(thread, true, trimmed) do
          {:ok, build_payload(true, trimmed, nil), updated}
        end
    end
  end

  @doc """
  Pushes the thread's stored objective into the native Codex goal (best-effort).

  Per the Codex `thread/goal/set` contract this resets native accounting, so the
  caller should only run it when no turn is running (otherwise it both competes
  for the thread and clobbers the live timer/budget). Returns the refreshed
  payload with the native goal merged when the set succeeds.
  """
  @spec sync_native_objective(Thread.t()) :: result()
  def sync_native_objective(%Thread{} = thread) do
    enabled = History.thread_goal_mode(thread)

    case History.thread_goal_objective(thread) do
      objective when is_binary(objective) and objective != "" ->
        goal =
          case sync_agent_objective(thread, objective) do
            {:ok, goal} -> goal
            _ -> nil
          end

        {:ok, build_payload(enabled, objective, goal), thread}

      _ ->
        {:ok, build_payload(enabled, nil, nil), thread}
    end
  end

  # --- internals -----------------------------------------------------------

  defp sync_agent_objective(%Thread{} = thread, objective) do
    case authoring_agent(thread) do
      "claude" -> sync_claude_objective(thread, objective)
      _ -> safe_manage(thread, {:set, %{objective: objective, status: "active"}})
    end
  end

  defp activate_native_objective(%Thread{} = thread, objective) do
    case sync_agent_objective(thread, objective) do
      {:ok, goal} -> {:ok, goal}
      {:error, :no_codex_thread} -> {:ok, nil}
      {:error, reason} -> {:error, reason}
    end
  end

  defp sync_claude_objective(%Thread{} = thread, objective) do
    with :ok <- ensure_claude_supported(),
         {:ok, workspace} <- executable_workspace(thread),
         :ok <-
           ClaudeGoalStore.put(
             workspace,
             :authoring,
             %{"objective" => objective, "status" => "active", "pending_command" => "set"},
             thread.id
           ),
         {:ok, goal} <- read_claude_goal(thread) do
      {:ok,
       %{
         "objective" => Map.get(goal, "objective"),
         "status" => Map.get(goal, "status"),
         "source" => "claude"
       }}
    end
  end

  defp authoring_agent(%Thread{} = thread) do
    cond do
      is_binary(thread.agent_kind) and thread.agent_kind != "" -> thread.agent_kind
      present_agent_thread?(thread, "claude") -> "claude"
      present_agent_thread?(thread, "codex") -> "codex"
      true -> "unknown"
    end
  end

  defp with_native(%Thread{} = thread, command) do
    enabled = History.thread_goal_mode(thread)
    objective = History.thread_goal_objective(thread)

    case do_manage(thread, command) do
      {:ok, goal} -> {:ok, build_payload(enabled, objective, goal), thread}
      {:error, reason} -> {:error, reason}
    end
  end

  defp fetch_native_goal(%Thread{} = thread) do
    case authoring_agent(thread) do
      "claude" ->
        case read_claude_goal(thread) do
          {:ok, goal} -> {:ok, Map.put(goal, "source", "claude")}
          :error -> {:ok, nil}
          {:error, reason} -> {:error, reason}
        end

      _ ->
        case codex_thread_id(thread) do
          nil -> {:error, :no_codex_thread}
          _id -> do_manage(thread, :get)
        end
    end
  end

  defp safe_manage(%Thread{} = thread, command) do
    case codex_thread_id(thread) do
      nil -> {:error, :no_codex_thread}
      _id -> do_manage(thread, command)
    end
  end

  defp do_manage(%Thread{} = thread, command) do
    with {:ok, thread_id} <- require_codex_thread(thread),
         {:ok, workspace} <- executable_workspace(thread) do
      opts = [
        thread_id: thread_id,
        workspace_root: Config.workspace_root(),
        codex_config: codex_config(thread.project_slug)
      ]

      CodingAgent.manage_goal(workspace, command, opts)
    end
  end

  defp require_codex_thread(%Thread{} = thread) do
    case codex_thread_id(thread) do
      id when is_binary(id) and id != "" -> {:ok, id}
      _ -> {:error, :no_codex_thread}
    end
  end

  defp codex_thread_id(%Thread{agent_thread_ids: ids, codex_thread_id: legacy}) do
    from_map =
      case ids do
        %{} -> Map.get(ids, @native_agent_kind) || Map.get(ids, :codex)
        _ -> nil
      end

    from_map || legacy
  end

  defp codex_thread_id(_thread), do: nil

  defp codex_config(slug) when is_binary(slug) do
    case Context.get_project(slug) do
      {:ok, project} ->
        case project |> Repo.preload(:setup) |> ProjectConfig.resolve() |> Map.get(:codex) do
          codex when is_map(codex) -> InstanceConfig.merge_codex_section(codex)
          _ -> InstanceConfig.codex_section()
        end

      _ ->
        InstanceConfig.codex_section()
    end
  rescue
    error ->
      Logger.debug("AuthoringGoalControl codex_config fallback slug=#{slug} reason=#{inspect(error)}")
      InstanceConfig.codex_section()
  end

  defp codex_config(_slug), do: InstanceConfig.codex_section()

  defp clear_native_goal(%Thread{} = thread) do
    case authoring_agent(thread) do
      "claude" ->
        queue_claude_clear(thread)

      _ ->
        case safe_manage(thread, :clear) do
          {:ok, _goal} -> :ok
          {:error, :no_codex_thread} -> :ok
          {:error, reason} -> {:error, {:native_goal_clear_failed, reason}}
        end
    end
  end

  defp queue_claude_clear(%Thread{} = thread) do
    with {:ok, workspace} <- executable_workspace(thread) do
      ClaudeGoalStore.queue_clear(workspace, :authoring, thread.id)
    end
  end

  defp validate_activation(%Thread{} = thread) do
    with {:ok, workspace} <- executable_workspace(thread) do
      case authoring_agent(thread) do
        "codex" ->
          opts = [codex_config: codex_config(thread.project_slug)]

          if CodingAgent.goals_enabled?(opts),
            do: :ok,
            else: {:error, {:authoring_goal_unavailable, :codex_goals_disabled}}

        "claude" ->
          case AgentAvailability.claude_goal_preflight(workspace) do
            :ok -> :ok
            {:error, reason} -> {:error, {:authoring_goal_unavailable, reason}}
          end

        agent ->
          {:error, {:authoring_goal_unavailable, {:unsupported_agent, agent}}}
      end
    end
  end

  defp executable_workspace(%Thread{workspace_path: path}) when is_binary(path) and path != "" do
    if File.dir?(path) do
      {:ok, path}
    else
      {:error, {:authoring_goal_unavailable, :workspace_not_executable}}
    end
  end

  defp executable_workspace(%Thread{}),
    do: {:error, {:authoring_goal_unavailable, :workspace_not_executable}}

  defp ensure_claude_supported do
    if AgentAvailability.claude_goal_supported?(),
      do: :ok,
      else: {:error, :claude_goal_unsupported_version}
  end

  defp read_claude_goal(%Thread{id: id} = thread) when is_integer(id) do
    with {:ok, workspace} <- executable_workspace(thread) do
      ClaudeGoalStore.read(workspace, :authoring, id)
    end
  end

  defp present_agent_thread?(thread, kind) do
    case History.agent_thread_id(thread, kind) do
      id when is_binary(id) and id != "" -> true
      _ -> false
    end
  end

  defp normalize_optional_objective(objective) when is_binary(objective) do
    case String.trim(objective) do
      "" -> nil
      normalized -> normalized
    end
  end

  defp normalize_optional_objective(_objective), do: nil

  defp build_payload(enabled, objective, goal) do
    source = if is_map(goal) and Map.get(goal, "source") == "claude", do: "claude", else: "native"
    capabilities = if source == "claude", do: ["get", "edit", "clear"], else: @capabilities

    %{
      enabled: enabled,
      objective: objective,
      native: is_map(goal),
      status: payload_status(enabled, goal),
      capabilities: capabilities,
      goal: serialize_goal(goal, objective)
    }
  end

  # Codex's native goal map is `{threadId, objective, status, tokenBudget,
  # tokensUsed, timeUsedSeconds}`. Enrich it into the AgentExecutionGoal shape the
  # front-end `normalizeGoal/1` expects (kind/source/capabilities + camelCase).
  defp serialize_goal(goal, objective_fallback) when is_map(goal) do
    source = if Map.get(goal, "source") == "claude", do: "claude", else: "native"
    capabilities = if source == "claude", do: ["get", "edit", "clear"], else: @capabilities

    %{
      kind: "goal",
      source: source,
      objective: goal_string(Map.get(goal, "objective")) || objective_fallback,
      status: normalize_lifecycle_status(Map.get(goal, "status")),
      capabilities: capabilities,
      tokenBudget: goal_number(Map.get(goal, "tokenBudget")),
      tokensUsed: goal_number(Map.get(goal, "tokensUsed")),
      timeUsedSeconds: goal_number(Map.get(goal, "timeUsedSeconds")),
      updatedAt: nil
    }
  end

  defp serialize_goal(_goal, _objective_fallback), do: nil

  defp goal_string(value) when is_binary(value) and value != "", do: value
  defp goal_string(_value), do: nil

  defp goal_number(value) when is_number(value), do: value
  defp goal_number(_value), do: nil

  defp payload_status(false, _goal), do: nil
  defp payload_status(true, goal) when is_map(goal), do: normalize_lifecycle_status(Map.get(goal, "status"))
  defp payload_status(true, _goal), do: "starting"

  defp normalize_lifecycle_status(status) when is_atom(status),
    do: status |> Atom.to_string() |> normalize_lifecycle_status()

  defp normalize_lifecycle_status(status) when is_binary(status) do
    case status do
      value when value in ["pending", "starting", "queued"] -> "starting"
      value when value in ["active", "running", "in_progress"] -> "running"
      value when value in ["paused", "interrupted"] -> "paused"
      value when value in ["completed", "complete", "achieved", "succeeded"] -> "completed"
      value when value in ["blocked", "waiting"] -> "blocked"
      value when value in ["failed", "error"] -> "failed"
      value when value in ["budgetLimited", "budget_limited", "budget_exceeded"] -> "budgetLimited"
      value when value in ["usageLimited", "usage_limited", "usage_limit", "rate_limited"] -> "usageLimited"
      _ -> "failed"
    end
  end

  defp normalize_lifecycle_status(_status), do: "starting"
end
