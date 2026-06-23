defmodule SymphonyElixir.AgentExecutionTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentExecution
  alias SymphonyElixir.Codex.Session, as: CodexSession
  alias SymphonyElixir.Workspace

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

    test "marks Codex goal executions as pursuing a goal from native goal data" do
      goal = %{
        kind: "goal",
        source: "native",
        status: "active",
        objective: "Ship the issue",
        capabilities: ["get", "edit", "clear"]
      }

      snapshot = %{running: [running_entry(%{agent_kind: "codex", goal: goal})], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.long_running
      assert execution.long_running_kind == "goal"
      assert execution.long_running_label == "Pursuing goal"
      assert execution.goal.objective == "Ship the issue"
    end

    test "marks Claude goal executions as pursuing a workflow" do
      snapshot = %{running: [running_entry(%{agent_kind: "claude", agent_goal: "Ship the issue"})], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.long_running
      assert execution.long_running_kind == "workflow"
      assert execution.long_running_label == "Pursuing workflow"
    end

    test "Codex running entries ignore the cached agent_goal (Codex thread is the source of truth)" do
      snapshot = %{running: [running_entry(%{agent_kind: "codex", agent_goal: "Ship the issue"})], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      # No native goal data (no orchestrator goal, no workspace mirror), so the
      # cached agent_goal must NOT be surfaced as a Codex goal.
      assert execution.goal == nil
      refute execution.long_running
    end

    test "Codex running entries surface the native goal mirror from the workspace sidecar" do
      identifier = "SYM-MIRROR-1"
      issue_ref = %{identifier: identifier, project_slug: nil}
      workspace = Workspace.path_for_issue(issue_ref)
      on_exit(fn -> File.rm_rf(workspace) end)

      :ok = CodexSession.put_goal(workspace, %{"objective" => "Pursue the native goal", "status" => "active"})

      entry = running_entry(%{identifier: identifier, agent_kind: "codex", issue: issue_ref})
      snapshot = %{running: [entry], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.goal.kind == "goal"
      assert execution.goal.source == "native"
      assert execution.goal.objective == "Pursue the native goal"
      # Projected (non-live-thread) capabilities only — native pause/resume require
      # a live resolvable thread the UI dispatches into instead.
      assert execution.goal.capabilities == ["get", "edit", "clear"]
      assert execution.long_running
      assert execution.long_running_label == "Pursuing goal"
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

    test "projects retry entries with an error as error status" do
      snapshot = %{
        running: [],
        retrying: [%{issue_id: "issue-9", identifier: "SYM-9", attempt: 3, due_in_ms: 5_000, error: "boom"}]
      }

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.status == :error
      assert execution.issue_id == "issue-9"
      assert execution.issue_identifier == "SYM-9"
      assert execution.retry_attempt == 3
      assert execution.error == "boom"
    end

    test "projects retry entries without an error as retrying" do
      snapshot = %{
        running: [],
        retrying: [%{issue_id: "issue-9", identifier: "SYM-9", attempt: 2, due_in_ms: 5_000, error: nil}]
      }

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.status == :retrying
      assert execution.error == nil
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

  describe "format_failure/1" do
    test "extracts turn_failed messages" do
      assert AgentExecution.format_failure({:turn_failed, "claude exited with code 1"}) ==
               "claude exited with code 1"
    end

    test "strips runtime error stack traces" do
      error =
        "{%RuntimeError{message: \"Agent run failed for issue_id=5 issue_identifier=1859: {:turn_failed, \\\"claude exited with code 1\\\"}\"}, [{SymphonyElixir.AgentRunner, :fail_run, 2, [file: ~c\"lib/symphony_elixir/agent_runner.ex\", line: 87]}]}"

      assert AgentExecution.format_failure("agent exited: " <> error) == "claude exited with code 1"
    end
  end
end
