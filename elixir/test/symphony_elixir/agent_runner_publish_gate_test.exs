defmodule SymphonyElixir.AgentRunnerPublishGateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentRunner

  test "satisfied gate returns original result without corrective turns" do
    evaluator = fn _workspace -> :satisfied end
    run_turn = fn _prompt -> raise "must not run corrective turn" end

    assert :completed = AgentRunner.apply_publish_gate(:completed, "/tmp/ws", evaluator, run_turn, 2)
  end

  test "violation triggers corrective turns until satisfied" do
    {:ok, agent} = Agent.start_link(fn -> 0 end)

    evaluator = fn _workspace ->
      case Agent.get_and_update(agent, fn n -> {n, n + 1} end) do
        0 -> {:violations, [%{repo: "frontend", kind: :unpublished_branch, detail: "no upstream"}]}
        _ -> :satisfied
      end
    end

    run_turn = fn prompt ->
      assert prompt =~ "Publish gate failed"
      assert prompt =~ "no upstream"
      :ok
    end

    assert :completed = AgentRunner.apply_publish_gate(:completed, "/tmp/ws", evaluator, run_turn, 2)
  end

  test "exhausted corrective turns return publish_gate incomplete" do
    violations = [%{repo: "frontend", kind: :missing_pull_request, detail: "no PR"}]
    evaluator = fn _workspace -> {:violations, violations} end
    run_turn = fn _prompt -> :ok end

    assert {:incomplete, {:publish_gate, ^violations}} =
             AgentRunner.apply_publish_gate(:completed, "/tmp/ws", evaluator, run_turn, 2)
  end

  test "failed corrective turn stops early with publish_gate incomplete" do
    violations = [%{repo: "frontend", kind: :missing_pull_request, detail: "no PR"}]
    evaluator = fn _workspace -> {:violations, violations} end
    run_turn = fn _prompt -> {:error, :turn_failed} end

    assert {:incomplete, {:publish_gate, ^violations}} =
             AgentRunner.apply_publish_gate(:completed, "/tmp/ws", evaluator, run_turn, 2)
  end

  test "errors pass through" do
    evaluator = fn _workspace -> raise "must not evaluate" end
    assert {:error, :boom} = AgentRunner.apply_publish_gate({:error, :boom}, "/tmp/ws", evaluator, fn _ -> :ok end, 2)
  end
end
