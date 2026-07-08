defmodule SymphonyElixir.Orchestrator.GoalStateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Orchestrator.GoalState

  describe "for_update/2" do
    test "clears the goal on a thread/goal/cleared event" do
      update = %{payload: %{"method" => "thread/goal/cleared"}}
      assert GoalState.for_update(%{goal: %{objective: "old"}}, update) == nil
    end

    test "keeps the existing goal when the update carries no goal" do
      existing = %{objective: "kept"}
      update = %{payload: %{"method" => "turn/completed", "params" => %{}}}
      assert GoalState.for_update(%{agent_kind: "codex", goal: existing}, update) == existing
    end

    test "normalizes a native goal for codex/opencode agents" do
      update = %{
        payload: %{
          "method" => "thread/goal/updated",
          "params" => %{"goal" => %{"objective" => "Ship it", "status" => "active"}}
        }
      }

      goal = GoalState.for_update(%{agent_kind: "codex", goal: nil}, update)

      assert goal.kind == "goal"
      assert goal.source == "native"
      assert goal.objective == "Ship it"
      assert goal.status == "active"
      assert goal.capabilities == ["get", "edit", "pause", "resume", "clear"]
    end

    test "normalizes a workflow goal for prompt-driven agents" do
      update = %{payload: %{"params" => %{"goal" => %{"objective" => "Plan the work"}}}}

      goal = GoalState.for_update(%{agent_kind: "claude", goal: nil}, update)

      assert goal.kind == "workflow"
      assert goal.source == "prompt"
      assert goal.capabilities == ["view"]
    end

    test "reads camelCase goal fields via the snake_case fallback" do
      update = %{
        payload: %{
          "method" => "thread/goal/updated",
          "params" => %{"goal" => %{"objective" => "X", "tokenBudget" => 1000, "tokensUsed" => 250}}
        }
      }

      goal = GoalState.for_update(%{agent_kind: "codex", goal: nil}, update)

      assert goal.token_budget == 1000
      assert goal.tokens_used == 250
    end

    test "falls back to the existing goal fields when the update omits them" do
      existing = %{objective: "kept", status: "paused"}
      update = %{payload: %{"params" => %{"goal" => %{"tokensUsed" => 5}}}}

      goal = GoalState.for_update(%{agent_kind: "codex", goal: existing}, update)

      assert goal.objective == "kept"
      assert goal.status == "paused"
      assert goal.tokens_used == 5
    end

    test "defaults status to active when neither update nor existing provide one" do
      update = %{payload: %{"params" => %{"goal" => %{"objective" => "New"}}}}

      goal = GoalState.for_update(%{agent_kind: "codex", goal: nil}, update)

      assert goal.status == "active"
    end
  end
end
