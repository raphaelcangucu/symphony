defmodule SymphonyElixir.AgentExecutionTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentExecution

  defp running_entry(overrides) do
    Map.merge(
      %{
        issue_id: "issue-1",
        identifier: "SYM-1",
        state: "In Progress",
        session_id: "thread-turn",
        agent_input_tokens: 10,
        agent_output_tokens: 20,
        agent_total_tokens: 30,
        turn_count: 2,
        started_at: DateTime.utc_now(),
        last_codex_timestamp: DateTime.utc_now(),
        last_codex_message: nil,
        last_codex_event: :notification,
        runtime_seconds: 42
      },
      overrides
    )
  end

  describe "from_snapshot/1" do
    test "marks recently active running issues as live" do
      snapshot = %{running: [running_entry(%{})], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.issue_id == "issue-1"
      assert execution.issue_identifier == "SYM-1"
      assert execution.status == :live
      assert execution.session_id == "thread-turn"
      assert execution.turn_count == 2
      assert execution.tokens == %{input: 10, output: 20, total: 30}
      refute execution.long_running
      assert execution.long_running_kind == nil
      assert execution.long_running_label == nil
    end

    test "marks Codex goal executions as pursuing a goal" do
      snapshot = %{running: [running_entry(%{agent_kind: "codex", agent_goal: "Ship the issue"})], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.long_running
      assert execution.long_running_kind == "goal"
      assert execution.long_running_label == "Pursuing goal"
    end

    test "marks Claude goal executions as pursuing a workflow" do
      snapshot = %{running: [running_entry(%{agent_kind: "claude", agent_goal: "Ship the issue"})], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.long_running
      assert execution.long_running_kind == "workflow"
      assert execution.long_running_label == "Pursuing workflow"
    end

    test "marks running issues with stale activity as idle" do
      stale = DateTime.add(DateTime.utc_now(), -10 * 60, :second)
      snapshot = %{running: [running_entry(%{last_codex_timestamp: stale})], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.status == :idle
    end

    test "marks running issues awaiting input or approval as waiting" do
      input_required = running_entry(%{last_codex_event: :turn_input_required})
      approval = running_entry(%{identifier: "SYM-2", last_codex_event: :approval_required})

      statuses =
        %{running: [input_required, approval], retrying: []}
        |> AgentExecution.from_snapshot()
        |> Enum.map(& &1.status)

      assert statuses == [:waiting, :waiting]
    end

    test "projects retry entries as retrying with attempt and error" do
      snapshot = %{
        running: [],
        retrying: [%{issue_id: "issue-9", identifier: "SYM-9", attempt: 3, due_in_ms: 5_000, error: "boom"}]
      }

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.status == :retrying
      assert execution.issue_id == "issue-9"
      assert execution.issue_identifier == "SYM-9"
      assert execution.retry_attempt == 3
      assert execution.error == "boom"
    end

    test "prefers the running entry when an issue is both running and retrying" do
      snapshot = %{
        running: [running_entry(%{})],
        retrying: [%{issue_id: "issue-1", identifier: "SYM-1", attempt: 1, due_in_ms: 1_000, error: "stale"}]
      }

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.status == :live
    end
  end
end
