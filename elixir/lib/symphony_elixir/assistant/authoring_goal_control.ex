defmodule SymphonyElixir.Assistant.AuthoringGoalControl do
  @moduledoc """
  Operator controls for the thread-scoped **Authoring goal** that runs native
  goal mode directly inside an assistant conversation.

  This is the authoring counterpart to `SymphonyElixir.Codex.GoalControl` (which
  drives the orchestrator/execution goal keyed by issue). Here the native goal
  lives on the *assistant thread's* Codex conversation binding, so
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
  alias SymphonyElixir.{AgentAvailability, InstanceConfig, ProjectConfig, Repo, Workspace}
  alias SymphonyElixir.LocalTracker.Context

  @native_agent_kind "codex"
  @capabilities ["get", "edit", "pause", "resume", "clear"]
  @claude_capabilities ["get", "edit", "clear"]

  @type payload :: %{
          enabled: boolean(),
          objective: String.t() | nil,
          native: boolean(),
          status: String.t() | nil,
          provider: String.t(),
          source: String.t(),
          capabilities: [String.t()],
          revision: String.t() | nil,
          updated_at: String.t() | nil,
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

    if enabled do
      case fetch_native_goal(thread) do
        {:ok, goal} -> {:ok, build_payload(enabled, objective, goal), thread}
        {:error, :no_codex_thread} -> {:ok, build_payload(enabled, objective, nil), thread}
        {:error, reason} -> {:error, reason}
      end
    else
      {:ok, build_payload(false, nil, nil), thread}
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

  @doc "Returns Goal controls supported by the authoritative thread provider."
  @spec capabilities(Thread.t()) :: [String.t()]
  def capabilities(%Thread{} = thread) do
    case authoring_agent(thread) do
      "codex" -> @capabilities
      "claude" -> @claude_capabilities
      _ -> []
    end
  end

  @doc "Returns whether the authoritative thread provider supports a Goal control."
  @spec supports_capability?(Thread.t(), String.t()) :: boolean()
  def supports_capability?(%Thread{} = thread, capability) when is_binary(capability) do
    capability in capabilities(thread)
  end

  @doc """
  Verifies that pause can be issued without contacting the native provider.

  Requires the authoritative Codex provider, a persisted native Codex thread
  identifier, and an executable workspace.
  """
  @spec pause_preflight(Thread.t()) :: :ok | {:error, term()}
  def pause_preflight(%Thread{} = thread) do
    with :ok <- require_pause_provider(thread),
         {:ok, _thread_id} <- require_codex_thread(thread),
         {:ok, _workspace} <- executable_workspace(thread) do
      :ok
    end
  end

  @doc "Pauses the native authoring goal (status: paused). Keeps the goal enabled. Codex only."
  @spec pause(Thread.t()) :: result()
  def pause(%Thread{} = thread) do
    with :ok <- pause_preflight(thread) do
      with_native(thread, {:set, %{status: "paused"}})
    end
  end

  @doc """
  Flips the native authoring goal back to active. Codex only — Claude has no
  pause/resume on `/goal`. Before the first provider conversation exists, the
  metadata-only goal is already active, so resume succeeds without a native
  round-trip and lets the continuation establish that conversation.
  """
  @spec resume(Thread.t()) :: result()
  def resume(%Thread{} = thread) do
    cond do
      not supports_capability?(thread, "resume") ->
        {:error, :unsupported_for_agent}

      is_nil(codex_conversation_id(thread)) ->
        with {:ok, updated} <- History.bump_goal_revision(thread) do
          {:ok,
           build_payload(
             History.thread_goal_mode(updated),
             History.thread_goal_objective(updated),
             nil
           ), updated}
        end

      true ->
        with_native(thread, {:set, %{status: "active"}})
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
  Pushes the thread's stored objective into the provider-native goal (best-effort).

  Native objective synchronization may reset provider accounting, so the
  caller should only run it when no turn is running (otherwise it both competes
  for the thread and clobbers the live timer/budget). Returns the refreshed
  payload with the native goal merged when the set succeeds.
  """
  @spec sync_native_objective(Thread.t()) :: result()
  def sync_native_objective(%Thread{} = thread) do
    case History.thread_goal_objective(thread) do
      objective when is_binary(objective) and objective != "" ->
        sync_native_objective(thread, objective)

      _ ->
        {:ok, build_payload(History.thread_goal_mode(thread), nil, nil), thread}
    end
  end

  @doc "Pushes an explicit objective into the thread's native agent goal."
  @spec sync_native_objective(Thread.t(), String.t()) :: result()
  def sync_native_objective(%Thread{} = thread, objective) when is_binary(objective) do
    case String.trim(objective) do
      "" ->
        {:error, :empty_objective}

      trimmed ->
        case sync_agent_objective(thread, trimmed) do
          {:ok, goal} ->
            {:ok, build_payload(History.thread_goal_mode(thread), trimmed, goal), thread}

          {:error, :no_codex_thread} ->
            {:ok, build_payload(History.thread_goal_mode(thread), trimmed, nil), thread}

          {:error, reason} ->
            {:error, reason}
        end
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
    with {:ok, workspace} <- executable_workspace(thread),
         :ok <- AgentAvailability.claude_goal_preflight(workspace),
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

  defp require_pause_provider(%Thread{} = thread) do
    if authoring_agent(thread) == "codex", do: :ok, else: {:error, :unsupported_for_agent}
  end

  defp with_native(%Thread{} = thread, command) do
    case do_manage(thread, command) do
      {:ok, goal} ->
        with {:ok, updated} <- History.bump_goal_revision(thread) do
          {:ok,
           build_payload(
             History.thread_goal_mode(updated),
             History.thread_goal_objective(updated),
             goal
           ), updated}
        end

      {:error, reason} ->
        {:error, reason}
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
        case codex_conversation_id(thread) do
          nil -> {:error, :no_codex_thread}
          _id -> do_manage(thread, :get)
        end
    end
  end

  defp safe_manage(%Thread{} = thread, command) do
    case codex_conversation_id(thread) do
      nil -> {:error, :no_codex_thread}
      _id -> do_manage(thread, command)
    end
  end

  defp do_manage(%Thread{} = thread, command) do
    with {:ok, thread_id} <- require_codex_thread(thread),
         {:ok, workspace} <- executable_workspace(thread),
         {:ok, workspace_root} <- workspace_root(thread, workspace) do
      opts = [
        thread_id: thread_id,
        workspace_root: workspace_root,
        codex_config: codex_config(thread.project_slug)
      ]

      CodingAgent.manage_goal(workspace, command, opts)
    end
  end

  defp workspace_root(%Thread{project_slug: project_slug, issue_identifier: identifier}, _workspace)
       when is_binary(project_slug) and project_slug != "" do
    {:ok, Workspace.workspace_root_for(%{id: nil, identifier: identifier, project_slug: project_slug})}
  end

  defp workspace_root(%Thread{}, workspace) when is_binary(workspace) do
    {:ok, Path.dirname(Path.expand(workspace))}
  end

  defp require_codex_thread(%Thread{} = thread) do
    case codex_conversation_id(thread) do
      id when is_binary(id) ->
        case String.trim(id) do
          "" -> {:error, :no_codex_thread}
          persisted_id -> {:ok, persisted_id}
        end

      _ ->
        {:error, :no_codex_thread}
    end
  end

  defp codex_conversation_id(%Thread{} = thread) do
    case History.conversation_ref(thread, @native_agent_kind) do
      {:ok, %{conversation_id: conversation_id}} -> conversation_id
      :error -> nil
    end
  end

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

  defp read_claude_goal(%Thread{id: id} = thread) when is_integer(id) do
    with {:ok, workspace} <- executable_workspace(thread) do
      ClaudeGoalStore.read(workspace, :authoring, id)
    end
  end

  defp present_agent_thread?(thread, kind) do
    case History.conversation_ref(thread, kind) do
      {:ok, _ref} -> true
      :error -> false
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
    capabilities = if source == "claude", do: @claude_capabilities, else: @capabilities

    %{
      enabled: enabled,
      objective: objective,
      native: is_map(goal),
      status: payload_status(enabled, goal),
      provider: if(source == "claude", do: "claude", else: "codex"),
      source: source,
      capabilities: capabilities,
      revision: goal_string(goal_value(goal, "revision")),
      updated_at: goal_string(goal_value(goal, "updated_at")),
      goal: serialize_goal(goal, objective)
    }
  end

  # Codex's native goal map is `{threadId, objective, status, tokenBudget,
  # tokensUsed, timeUsedSeconds}`. Enrich it into the AgentExecutionGoal shape the
  # front-end `normalizeGoal/1` expects (kind/source/capabilities + camelCase).
  defp serialize_goal(goal, objective_fallback) when is_map(goal) do
    source = if Map.get(goal, "source") == "claude", do: "claude", else: "native"
    capabilities = if source == "claude", do: @claude_capabilities, else: @capabilities

    %{
      kind: "goal",
      source: source,
      objective: goal_string(Map.get(goal, "objective")) || objective_fallback,
      status: normalize_lifecycle_status(Map.get(goal, "status")),
      capabilities: capabilities,
      tokenBudget: goal_number(Map.get(goal, "tokenBudget")),
      tokensUsed: goal_number(Map.get(goal, "tokensUsed")),
      timeUsedSeconds: goal_number(Map.get(goal, "timeUsedSeconds")),
      updatedAt: goal_timestamp(Map.get(goal, "updatedAt") || Map.get(goal, "updated_at")),
      revision: goal_string(Map.get(goal, "revision"))
    }
  end

  defp serialize_goal(_goal, _objective_fallback), do: nil

  defp goal_string(value) when is_binary(value) and value != "", do: value
  defp goal_string(_value), do: nil

  defp goal_number(value) when is_number(value), do: value
  defp goal_number(_value), do: nil

  defp goal_timestamp(value) when is_number(value), do: value
  defp goal_timestamp(value) when is_binary(value) and value != "", do: value
  defp goal_timestamp(_value), do: nil

  defp goal_value(goal, key) when is_map(goal), do: Map.get(goal, key)
  defp goal_value(_goal, _key), do: nil

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
