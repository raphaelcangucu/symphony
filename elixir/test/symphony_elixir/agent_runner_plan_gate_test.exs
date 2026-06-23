defmodule SymphonyElixir.AgentRunnerPlanGateTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog

  alias SymphonyElixir.AgentRunner

  test "no corrective turn when workpad exists" do
    checker = fn -> :ok end
    run_turn = fn _prompt -> raise "must not run corrective turn" end
    assert :ok = AgentRunner.apply_plan_gate(checker, run_turn)
  end

  test "missing workpad triggers one corrective turn" do
    {:ok, agent} = Agent.start_link(fn -> 0 end)

    checker = fn ->
      case Agent.get_and_update(agent, fn n -> {n, n + 1} end) do
        0 -> {:error, :not_found}
        _ -> :ok
      end
    end

    run_turn = fn prompt ->
      assert prompt =~ "Plan gate failed"
      assert prompt =~ "workpad"
      assert prompt =~ "execution contract metadata"
      assert prompt =~ "### Plan"
      :ok
    end

    assert :ok = AgentRunner.apply_plan_gate(checker, run_turn)
  end

  test "invalid workpad contract triggers one corrective turn with the same prompt" do
    {:ok, agent} = Agent.start_link(fn -> 0 end)

    checker = fn ->
      case Agent.get_and_update(agent, fn n -> {n, n + 1} end) do
        0 -> {:error, :contract_absent}
        _ -> :ok
      end
    end

    run_turn = fn prompt ->
      assert prompt =~ "Plan gate failed"
      assert prompt =~ "execution contract metadata"
      assert prompt =~ "### Plan"
      :ok
    end

    assert :ok = AgentRunner.apply_plan_gate(checker, run_turn)
  end

  test "still-missing workpad logs and continues" do
    checker = fn -> {:error, :not_found} end
    run_turn = fn _prompt -> :ok end

    log =
      capture_log(fn ->
        assert :ok = AgentRunner.apply_plan_gate(checker, run_turn)
      end)

    assert log =~ "Plan gate still unsatisfied"
  end

  test "failed corrective turn logs and continues" do
    checker = fn -> {:error, :not_found} end
    run_turn = fn _prompt -> {:error, :agent_crashed} end

    capture_log(fn ->
      assert :ok = AgentRunner.apply_plan_gate(checker, run_turn)
    end)
  end
end
