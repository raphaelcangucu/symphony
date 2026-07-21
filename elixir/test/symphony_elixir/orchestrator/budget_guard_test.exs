defmodule SymphonyElixir.Orchestrator.BudgetGuardTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Orchestrator

  test "run is over budget once cumulative tokens reach the ceiling" do
    assert Orchestrator.run_budget_exceeded?(%{agent_total_tokens: 4_000_000}, 4_000_000)
    assert Orchestrator.run_budget_exceeded?(%{agent_total_tokens: 12_300_000}, 4_000_000)
  end

  test "run is within budget below the ceiling" do
    refute Orchestrator.run_budget_exceeded?(%{agent_total_tokens: 1_200_000}, 4_000_000)
  end

  test "a budget of zero disables the guard" do
    refute Orchestrator.run_budget_exceeded?(%{agent_total_tokens: 999_999_999}, 0)
  end

  test "missing token data is never over budget" do
    refute Orchestrator.run_budget_exceeded?(%{}, 4_000_000)
  end

  test "within budget action is a no-op" do
    entry = %{agent_total_tokens: 1_000_000, retry_attempt: 0}
    assert Orchestrator.budget_overrun_action(entry, 4_000_000, 2) == :within_budget
  end

  test "first overrun re-queues the run with the next attempt" do
    entry = %{agent_total_tokens: 5_000_000, retry_attempt: 0}
    assert Orchestrator.budget_overrun_action(entry, 4_000_000, 2) == {:retry, 1}
  end

  test "overrun past the retry cap parks the run instead of looping" do
    entry = %{agent_total_tokens: 5_000_000, retry_attempt: 2}
    assert Orchestrator.budget_overrun_action(entry, 4_000_000, 2) == :park
  end

  test "a disabled budget never acts" do
    entry = %{agent_total_tokens: 999_999_999, retry_attempt: 0}
    assert Orchestrator.budget_overrun_action(entry, 0, 2) == :within_budget
  end

  test "coordinator parent runs are never stopped by the implementer token budget" do
    entry = %{
      agent_total_tokens: 12_300_000,
      retry_attempt: 2,
      bundle_role: :parent,
      identifier: "510"
    }

    assert Orchestrator.budget_overrun_action(entry, 4_000_000, 2) == :within_budget
  end

  test "parent_unified is subject to budget guard like standalone" do
    entry = %{agent_total_tokens: 5_000_000, retry_attempt: 0, bundle_role: :parent_unified}
    assert Orchestrator.budget_overrun_action(entry, 4_000_000, 0) == :park
  end

  test "child and standalone runs remain guarded when over budget" do
    child = %{agent_total_tokens: 5_000_000, retry_attempt: 0, bundle_role: :child, parent_identifier: "510"}
    standalone = %{agent_total_tokens: 5_000_000, retry_attempt: 0, bundle_role: :standalone}

    assert Orchestrator.budget_overrun_action(child, 4_000_000, 2) == {:retry, 1}
    assert Orchestrator.budget_overrun_action(standalone, 4_000_000, 2) == {:retry, 1}
  end

  test "a non-child run keeps the default (no requeue) lifecycle when its run ends incomplete" do
    entry = %{parent_identifier: nil, retry_attempt: 0}
    assert Orchestrator.child_requeue_action(entry, 2) == :default
  end

  test "an incomplete bundle child is re-queued so it does not strand the bundle" do
    entry = %{parent_identifier: "510", retry_attempt: 0}
    assert Orchestrator.child_requeue_action(entry, 2) == {:requeue, 1}
  end

  test "a bundle child that keeps ending incomplete is parked after the retry cap" do
    entry = %{parent_identifier: "510", retry_attempt: 2}
    assert Orchestrator.child_requeue_action(entry, 2) == :park
  end

  test "token progress logging triggers once per interval crossed" do
    assert Orchestrator.token_threshold_crossed?(990_000, 1_010_000, 1_000_000)
    refute Orchestrator.token_threshold_crossed?(1_010_000, 1_050_000, 1_000_000)
    refute Orchestrator.token_threshold_crossed?(0, 500_000, 1_000_000)
  end

  test "token progress logging is disabled for a non-positive interval" do
    refute Orchestrator.token_threshold_crossed?(0, 9_000_000, 0)
  end

  describe "effective_token_budget/2" do
    test "the operator budget wins when the guard is enabled" do
      assert Orchestrator.effective_token_budget(4_000_000, 15_000_000) == 4_000_000
    end

    test "the hard ceiling backstops a disabled operator budget" do
      assert Orchestrator.effective_token_budget(0, 15_000_000) == 15_000_000
    end

    test "both zero means truly unbounded (guard fully off)" do
      assert Orchestrator.effective_token_budget(0, 0) == 0
      refute Orchestrator.run_budget_exceeded?(%{agent_total_tokens: 999_999_999}, 0)
    end

    test "a disabled operator budget still parks a runaway that crosses the hard ceiling" do
      budget = Orchestrator.effective_token_budget(0, 15_000_000)
      entry = %{agent_total_tokens: 16_000_000, retry_attempt: 2, bundle_role: :standalone}

      assert Orchestrator.budget_overrun_action(entry, budget, 2) == :park
    end
  end
end
