defmodule SymphonyElixir.OrchestratorIncompleteTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Issue

  test "incomplete_workpad_comment_body explains the max-turns reason and missing PR" do
    body = Orchestrator.incomplete_workpad_comment_body(:max_turns)

    assert body =~ "## Codex Workpad"
    assert body =~ "max turns"
    assert body =~ "No pull request"
  end

  test "stores the reported agent outcome on the matching running entry" do
    issue_id = "issue-incomplete"

    issue = %Issue{
      id: issue_id,
      identifier: "DIS-1",
      title: "Never finishes",
      state: "Todo",
      project_slug: "distributionmachine"
    }

    orchestrator_name = Module.concat(__MODULE__, :OutcomeOrchestrator)
    {:ok, pid} = Orchestrator.start_link(name: orchestrator_name)

    on_exit(fn ->
      if Process.alive?(pid), do: Process.exit(pid, :normal)
    end)

    initial_state = :sys.get_state(pid)

    running_entry = %{
      pid: self(),
      ref: make_ref(),
      identifier: issue.identifier,
      issue: issue,
      session_id: "session-live",
      turn_count: 1,
      started_at: DateTime.utc_now()
    }

    :sys.replace_state(pid, fn _ ->
      %{initial_state | running: %{issue_id => running_entry}}
    end)

    send(pid, {:agent_outcome, issue_id, {:incomplete, :max_turns}})

    state = :sys.get_state(pid)

    assert get_in(state.running, [issue_id, :agent_outcome]) == {:incomplete, :max_turns}
  end

  test "ignores an agent outcome for an unknown running issue" do
    orchestrator_name = Module.concat(__MODULE__, :UnknownOutcomeOrchestrator)
    {:ok, pid} = Orchestrator.start_link(name: orchestrator_name)

    on_exit(fn ->
      if Process.alive?(pid), do: Process.exit(pid, :normal)
    end)

    send(pid, {:agent_outcome, "missing", {:incomplete, :max_turns}})

    state = :sys.get_state(pid)

    assert state.running == %{}
  end
end
