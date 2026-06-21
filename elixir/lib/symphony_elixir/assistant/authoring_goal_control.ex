defmodule SymphonyElixir.Assistant.AuthoringGoalControl do
  @moduledoc """
  Operator controls for the tab-scoped **Authoring goal** that runs Codex native
  goal mode directly inside an issue assistant conversation.

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
  alias SymphonyElixir.{InstanceConfig, ProjectConfig, Repo, Workspace}
  alias SymphonyElixir.LocalTracker.Context

  @native_agent_kind "codex"
  @capabilities ["get", "edit", "pause", "resume", "clear"]

  @type payload :: %{
          enabled: boolean(),
          objective: String.t() | nil,
          native: boolean(),
          goal: map() | nil
        }

  @type result :: {:ok, payload(), Thread.t()} | {:error, term()}

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

  @doc "Pauses the native authoring goal (status: paused). Keeps the goal enabled."
  @spec pause(Thread.t()) :: result()
  def pause(%Thread{} = thread) do
    with_native(thread, {:set, %{status: "paused"}})
  end

  @doc """
  Flips the native authoring goal back to active. The autonomous continuation
  batch (the actual turns) is kicked by the caller (channel) after this returns;
  this only mutates native goal state.
  """
  @spec resume(Thread.t()) :: result()
  def resume(%Thread{} = thread) do
    with_native(thread, {:set, %{status: "active"}})
  end

  @doc "Removes the authoring goal: clears the native goal (best-effort) and disables the flag."
  @spec clear(Thread.t()) :: result()
  def clear(%Thread{} = thread) do
    _ = safe_manage(thread, :clear)

    case History.set_goal_mode(thread, false, nil) do
      {:ok, updated} -> {:ok, build_payload(false, nil, nil), updated}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc """
  Replaces the authoring objective. Persists it to thread metadata and, when a
  native goal already exists, updates it (resetting native accounting per the
  Codex contract) and reactivates it.

  Prefer `set_objective_metadata/2` + `sync_native_objective/1` from the channel:
  the native `thread/goal/set` is a Codex port round-trip that can block (and, if
  a turn holds the thread, fight it), so it must run off the channel process.
  """
  @spec set_objective(Thread.t(), String.t()) :: result()
  def set_objective(%Thread{} = thread, objective) when is_binary(objective) do
    case String.trim(objective) do
      "" ->
        {:error, :empty_objective}

      trimmed ->
        with {:ok, updated} <- History.set_goal_mode(thread, true, trimmed) do
          goal =
            case safe_manage(updated, {:set, %{objective: trimmed, status: "active"}}) do
              {:ok, goal} -> goal
              _ -> nil
            end

          {:ok, build_payload(true, trimmed, goal), updated}
        end
    end
  end

  @doc """
  Persists the authoring objective to thread metadata only — no Codex port
  round-trip. This is the fast half of an edit: it never blocks on (or fights) an
  in-flight turn, so the operator's save always lands immediately. Reflect it in
  the native goal afterwards with `sync_native_objective/1` (off the channel).
  """
  @spec set_objective_metadata(Thread.t(), String.t()) :: result()
  def set_objective_metadata(%Thread{} = thread, objective) when is_binary(objective) do
    case String.trim(objective) do
      "" ->
        {:error, :empty_objective}

      trimmed ->
        with {:ok, updated} <- History.set_goal_mode(thread, true, trimmed) do
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
          case safe_manage(thread, {:set, %{objective: objective, status: "active"}}) do
            {:ok, goal} -> goal
            _ -> nil
          end

        {:ok, build_payload(enabled, objective, goal), thread}

      _ ->
        {:ok, build_payload(enabled, nil, nil), thread}
    end
  end

  # --- internals -----------------------------------------------------------

  defp with_native(%Thread{} = thread, command) do
    enabled = History.thread_goal_mode(thread)
    objective = History.thread_goal_objective(thread)

    case do_manage(thread, command) do
      {:ok, goal} -> {:ok, build_payload(enabled, objective, goal), thread}
      {:error, reason} -> {:error, reason}
    end
  end

  defp fetch_native_goal(%Thread{} = thread) do
    case codex_thread_id(thread) do
      nil -> {:error, :no_codex_thread}
      _id -> do_manage(thread, :get)
    end
  end

  defp safe_manage(%Thread{} = thread, command) do
    case codex_thread_id(thread) do
      nil -> {:error, :no_codex_thread}
      _id -> do_manage(thread, command)
    end
  end

  defp do_manage(%Thread{} = thread, command) do
    with {:ok, thread_id} <- require_codex_thread(thread) do
      issue_ref = issue_ref(thread)
      workspace = thread.workspace_path || Workspace.path_for_issue(issue_ref)

      opts = [
        thread_id: thread_id,
        workspace_root: Workspace.workspace_root_for(issue_ref),
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

  defp issue_ref(%Thread{project_slug: slug, issue_identifier: identifier}) do
    %{id: nil, identifier: identifier, project_slug: slug}
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

  defp build_payload(enabled, objective, goal) do
    %{
      enabled: enabled,
      objective: objective,
      native: is_map(goal),
      goal: serialize_goal(goal, objective)
    }
  end

  # Codex's native goal map is `{threadId, objective, status, tokenBudget,
  # tokensUsed, timeUsedSeconds}`. Enrich it into the AgentExecutionGoal shape the
  # front-end `normalizeGoal/1` expects (kind/source/capabilities + camelCase).
  defp serialize_goal(goal, objective_fallback) when is_map(goal) do
    %{
      kind: "goal",
      source: "native",
      objective: goal_string(Map.get(goal, "objective")) || objective_fallback,
      status: goal_string(Map.get(goal, "status")),
      capabilities: @capabilities,
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
end
