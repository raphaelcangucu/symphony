defmodule SymphonyElixir.OrchestratorSteerTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Issue

  test "steer forwards codex_steer to the running agent pid" do
    issue_id = "issue-steer"
    agent_pid = self()

    issue = %Issue{
      id: issue_id,
      identifier: "510",
      title: "Steer test",
      description: "Exercise orchestrator steer",
      state: "In Progress",
      url: "https://example.org/issues/510"
    }

    orchestrator_name = Module.concat(__MODULE__, :SteerOrchestrator)
    {:ok, pid} = Orchestrator.start_link(name: orchestrator_name)

    on_exit(fn ->
      if Process.alive?(pid), do: Process.exit(pid, :normal)
    end)

    initial_state = :sys.get_state(pid)

    running_entry = %{
      pid: agent_pid,
      ref: make_ref(),
      identifier: issue.identifier,
      issue: issue,
      session_id: "session-live",
      turn_count: 1,
      last_codex_message: nil,
      last_codex_timestamp: nil,
      last_codex_event: nil,
      started_at: DateTime.utc_now()
    }

    :sys.replace_state(pid, fn _ ->
      %{initial_state | running: %{issue_id => running_entry}}
    end)

    assert :ok = Orchestrator.steer(orchestrator_name, "510", "focus on tests", agent_pid)

    assert_receive {:codex_steer, [%{"type" => "text", "text" => "focus on tests"}], ^agent_pid}, 1_000
  end

  test "steer returns ActiveTurnNotSteerable when issue is not running" do
    orchestrator_name = Module.concat(__MODULE__, :SteerMissingOrchestrator)
    {:ok, pid} = Orchestrator.start_link(name: orchestrator_name)

    on_exit(fn ->
      if Process.alive?(pid), do: Process.exit(pid, :normal)
    end)

    assert {:error, :ActiveTurnNotSteerable} =
             Orchestrator.steer(orchestrator_name, "missing", "hello", self())
  end
end
