defmodule SymphonyElixir.OrchestratorTaskSupervisorTest do
  use ExUnit.Case, async: true

  defp ensure_task_supervisor(name) do
    case Process.whereis(name) do
      nil -> start_supervised!({Task.Supervisor, name: name})
      pid -> pid
    end
  end

  test "the orchestrator Task.Supervisor is registered and distinct from the shared one" do
    ensure_task_supervisor(SymphonyElixir.TaskSupervisor)
    ensure_task_supervisor(SymphonyElixir.Orchestrator.TaskSupervisor)

    shared = Process.whereis(SymphonyElixir.TaskSupervisor)
    orchestrator = Process.whereis(SymphonyElixir.Orchestrator.TaskSupervisor)

    assert is_pid(shared)
    assert is_pid(orchestrator)
    refute shared == orchestrator
  end

  test "orchestrator source references Orchestrator.TaskSupervisor for dispatch" do
    source = File.read!("lib/symphony_elixir/orchestrator.ex")
    assert source =~ "SymphonyElixir.Orchestrator.TaskSupervisor"
    refute source =~ "Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor"
  end
end
