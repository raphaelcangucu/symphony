defmodule SymphonyElixir.AgentRunnerValidateGateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentRunner
  alias SymphonyElixir.Workpad.ExecutionContract

  test "satisfied gate returns original result without corrective turns" do
    evaluator = fn _workspace -> :satisfied end
    run_turn = fn _prompt -> raise "must not run corrective turn" end

    assert :completed = AgentRunner.apply_validate_gate(:completed, "/tmp/ws", evaluator, run_turn, 2)
  end

  test "incomplete execution contract skips final validate corrective turns" do
    evaluator = fn _workspace -> raise "must not evaluate validate while scope is incomplete" end
    run_turn = fn _prompt -> raise "must not run corrective turn while scope is incomplete" end

    assert :completed =
             AgentRunner.apply_validate_gate(:completed, "/tmp/ws", evaluator, run_turn, 2, execution_contract: incomplete_contract())
  end

  test "complete execution contract allows final validate corrective turns" do
    {:ok, agent} = Agent.start_link(fn -> 0 end)

    evaluator = fn _workspace ->
      case Agent.get_and_update(agent, fn n -> {n, n + 1} end) do
        0 -> {:violations, [%{kind: :unit_not_green, repo: "frontend", detail: "no passing unit run"}]}
        _ -> :satisfied
      end
    end

    run_turn = fn prompt ->
      assert prompt =~ "Validate gate failed"
      :ok
    end

    assert :completed =
             AgentRunner.apply_validate_gate(:completed, "/tmp/ws", evaluator, run_turn, 2, execution_contract: complete_contract())
  end

  test "violation triggers corrective turns until satisfied" do
    {:ok, agent} = Agent.start_link(fn -> 0 end)

    evaluator = fn _workspace ->
      case Agent.get_and_update(agent, fn n -> {n, n + 1} end) do
        0 -> {:violations, [%{kind: :unit_not_green, repo: "frontend", detail: "no passing unit run"}]}
        _ -> :satisfied
      end
    end

    run_turn = fn prompt ->
      assert prompt =~ "Validate gate failed"
      assert prompt =~ "evidence"
      assert prompt =~ "no passing unit run"
      assert prompt =~ "(frontend)"
      :ok
    end

    assert :completed = AgentRunner.apply_validate_gate(:completed, "/tmp/ws", evaluator, run_turn, 2)
  end

  test "all environment-blocked violations skip corrective turns" do
    violations = [%{kind: :environment_blocked, repo: "backend", detail: "Docker unreachable"}]
    evaluator = fn _workspace -> {:violations, violations} end
    run_turn = fn _prompt -> raise "must not run corrective turn when environment-blocked" end

    assert {:incomplete, {:validate_gate, ^violations}} =
             AgentRunner.apply_validate_gate(:completed, "/tmp/ws", evaluator, run_turn, 2)
  end

  test "mixed environment-blocked and code violations still run corrective turns" do
    {:ok, agent} = Agent.start_link(fn -> 0 end)

    violations = [
      %{kind: :environment_blocked, repo: "backend", detail: "Docker unreachable"},
      %{kind: :unit_not_green, repo: "frontend", detail: "no passing unit run"}
    ]

    evaluator = fn _workspace ->
      case Agent.get_and_update(agent, fn n -> {n, n + 1} end) do
        0 -> {:violations, violations}
        _ -> :satisfied
      end
    end

    run_turn = fn prompt ->
      assert prompt =~ "Validate gate failed"
      :ok
    end

    assert :completed = AgentRunner.apply_validate_gate(:completed, "/tmp/ws", evaluator, run_turn, 2)
  end

  test "exhausted corrective turns return validate_gate incomplete" do
    violations = [%{kind: :e2e_missing, repo: nil, detail: "UI paths changed but no passing e2e run"}]
    evaluator = fn _workspace -> {:violations, violations} end
    run_turn = fn _prompt -> :ok end

    assert {:incomplete, {:validate_gate, ^violations}} =
             AgentRunner.apply_validate_gate(:completed, "/tmp/ws", evaluator, run_turn, 2)
  end

  test "failed corrective turn stops early with validate_gate incomplete" do
    violations = [%{kind: :manifest_missing, repo: nil, detail: "no manifest"}]
    evaluator = fn _workspace -> {:violations, violations} end
    run_turn = fn _prompt -> {:error, :turn_failed} end

    assert {:incomplete, {:validate_gate, ^violations}} =
             AgentRunner.apply_validate_gate(:completed, "/tmp/ws", evaluator, run_turn, 2)
  end

  test "errors pass through" do
    evaluator = fn _workspace -> raise "must not evaluate" end

    assert {:error, :boom} =
             AgentRunner.apply_validate_gate({:error, :boom}, "/tmp/ws", evaluator, fn _ -> :ok end, 2)
  end

  test "publish gate passes a validate_gate incomplete result through untouched" do
    violations = [%{kind: :unit_not_green, repo: "frontend", detail: "failing"}]
    evaluator = fn _workspace -> raise "must not evaluate publish" end

    assert {:incomplete, {:validate_gate, ^violations}} =
             AgentRunner.apply_publish_gate(
               {:incomplete, {:validate_gate, violations}},
               "/tmp/ws",
               evaluator,
               fn _ -> :ok end,
               2
             )
  end

  test "incomplete execution contract skips final publish corrective turns" do
    evaluator = fn _workspace -> raise "must not evaluate publish while scope is incomplete" end
    run_turn = fn _prompt -> raise "must not run publish corrective turn while scope is incomplete" end

    assert :completed =
             AgentRunner.apply_publish_gate(:completed, "/tmp/ws", evaluator, run_turn, 2, execution_contract: incomplete_contract())
  end

  defp incomplete_contract do
    struct!(ExecutionContract, %{
      source_plan: "docs/superpowers/plans/demo.md",
      mode: "full-plan",
      scope_status: "in_progress",
      tasks: [%{status: :pending, title: "Task 2: Not done", remaining: []}],
      scope_complete?: false,
      final_validate_allowed?: false,
      final_publish_allowed?: false,
      next_incomplete: %{status: :pending, title: "Task 2: Not done", remaining: []}
    })
  end

  defp complete_contract do
    struct!(ExecutionContract, %{
      source_plan: "docs/superpowers/plans/demo.md",
      mode: "full-plan",
      scope_status: "complete",
      tasks: [%{status: :done, title: "Task 1: Done", remaining: []}],
      scope_complete?: true,
      final_validate_allowed?: true,
      final_publish_allowed?: true,
      next_incomplete: nil
    })
  end
end
