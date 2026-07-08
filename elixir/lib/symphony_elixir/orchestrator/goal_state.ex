defmodule SymphonyElixir.Orchestrator.GoalState do
  @moduledoc """
  Normalizes agent goal/turn update payloads into the orchestrator's canonical
  goal-state map.

  Native agents (codex/opencode) emit `thread/goal/*` events carrying a rich
  goal object; prompt-driven agents (claude/cursor) surface a workflow-style
  goal. `for_update/2` reconciles the incoming update against the running
  entry's existing goal, returning the merged goal map, the existing goal
  unchanged, or `nil` when the goal was cleared.

  Pure: stdlib only, no orchestrator state and no side effects.
  """

  @doc """
  Derives the running entry's next goal from a live agent `update`:

  - `thread/goal/cleared` → `nil`
  - a goal payload → merged/normalized goal map
  - no goal in the update → the existing goal unchanged
  """
  @spec for_update(map(), map()) :: map() | nil
  def for_update(running_entry, update) do
    existing = Map.get(running_entry, :goal)

    case goal_update_payload(update) do
      :clear ->
        nil

      %{} = goal ->
        normalize_goal_payload(goal, Map.get(running_entry, :agent_kind), existing)

      nil ->
        existing
    end
  end

  defp goal_update_payload(%{payload: %{"method" => "thread/goal/cleared"}}), do: :clear
  defp goal_update_payload(%{payload: %{"method" => "thread/goal/updated", "params" => %{"goal" => goal}}}), do: goal
  defp goal_update_payload(%{payload: %{"method" => "turn/completed", "params" => %{"goal" => goal}}}), do: goal
  defp goal_update_payload(%{payload: %{"params" => %{"goal" => goal}}}), do: goal
  defp goal_update_payload(_update), do: nil

  # credo:disable-for-next-line Credo.Check.Refactor.CyclomaticComplexity
  defp normalize_goal_payload(goal, agent_kind, existing) when is_map(goal) do
    prompt_goal? = agent_kind in ["claude", "cursor"]

    %{
      kind: if(prompt_goal?, do: "workflow", else: "goal"),
      source: if(prompt_goal?, do: "prompt", else: "native"),
      objective: goal_value(goal, "objective") || map_value(existing, :objective),
      status: goal_value(goal, "status") || map_value(existing, :status) || "active",
      token_budget: goal_value(goal, "tokenBudget") || map_value(existing, :token_budget),
      tokens_used: goal_value(goal, "tokensUsed") || map_value(existing, :tokens_used),
      time_used_seconds: goal_value(goal, "timeUsedSeconds") || map_value(existing, :time_used_seconds),
      updated_at: goal_value(goal, "updatedAt") || map_value(existing, :updated_at),
      capabilities: if(prompt_goal?, do: ["view"], else: ["get", "edit", "pause", "resume", "clear"])
    }
  end

  defp normalize_goal_payload(_goal, _agent_kind, existing), do: existing

  defp goal_value(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Macro.underscore(key) |> String.to_atom())
  rescue
    ArgumentError -> Map.get(map, key)
  end

  defp map_value(map, key) when is_map(map), do: Map.get(map, key)
  defp map_value(_map, _key), do: nil
end
