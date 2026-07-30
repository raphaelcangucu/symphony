defmodule SymphonyElixir.Orchestrator.WorkerTerminatorTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Orchestrator.WorkerTerminator

  test "cooperatively interrupts the worker before forcing termination" do
    parent = self()

    worker =
      spawn(fn ->
        receive do
          :agent_interrupt ->
            send(parent, :runner_interrupted)
        end
      end)

    force_stop = fn pid ->
      send(parent, {:forced, pid})
      Process.exit(pid, :kill)
      :ok
    end

    assert :ok = WorkerTerminator.stop(worker, grace_ms: 100, force_stop: force_stop)
    assert_receive :runner_interrupted
    refute_receive {:forced, ^worker}
    refute Process.alive?(worker)
  end

  test "force-stops an unresponsive worker after the cooperative grace period" do
    parent = self()

    worker =
      spawn(fn ->
        Process.flag(:trap_exit, true)

        receive do
          :agent_interrupt ->
            send(parent, :interrupt_ignored)

            receive do
              :never -> :ok
            end
        end
      end)

    force_stop = fn pid ->
      send(parent, {:forced, pid})
      Process.exit(pid, :kill)
      :ok
    end

    assert :ok = WorkerTerminator.stop(worker, grace_ms: 10, force_stop: force_stop)
    assert_receive :interrupt_ignored
    assert_receive {:forced, ^worker}
    refute Process.alive?(worker)
  end
end
