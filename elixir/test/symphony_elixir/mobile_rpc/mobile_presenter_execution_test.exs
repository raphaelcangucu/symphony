defmodule SymphonyElixir.MobileRpc.MobilePresenterExecutionTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.Thread
  alias SymphonyElixir.MobileRpc.{MobilePresenter, OrchestratorService}
  alias SymphonyElixir.Repo

  test "merges persisted provenance when the live execution already owns the thread id" do
    executions = [
      %{
        execution_session_id: 42,
        session_id: "42",
        issue_identifier: "DEV-42",
        status: "aborted",
        agent_kind: "codex",
        model: nil,
        requested_model: nil,
        requested_effort: nil,
        resolved_model: nil,
        resolved_effort: nil
      }
    ]

    threads = [
      %{
        id: 42,
        issue_identifier: "DEV-42",
        status: "error",
        agent_kind: "codex",
        provider_bindings: %{"codex" => "native-run-42"},
        requested_model: "gpt-5.6-sol",
        requested_effort: "high",
        resolved_model: "gpt-5.6-sol",
        resolved_effort: "high"
      }
    ]

    assert [
             %{
               execution_session_id: 42,
               session_id: "native-run-42",
               status: "aborted",
               model: "gpt-5.6-sol",
               requested_model: "gpt-5.6-sol",
               requested_effort: "high",
               resolved_model: "gpt-5.6-sol",
               resolved_effort: "high"
             }
           ] = OrchestratorService.reconcile_execution_threads(executions, threads)
  end

  test "marks history-only active executions as recoverable instead of falsely live" do
    suffix = System.unique_integer([:positive])

    {:ok, thread} =
      %Thread{}
      |> Thread.changeset(%{
        scope: "issue_execution",
        project_slug: "mobile-routing-#{suffix}",
        issue_identifier: "DEV-#{suffix}",
        workspace_path: System.tmp_dir!(),
        agent_kind: "claude",
        requested_model: "claude-opus-5",
        requested_effort: "high",
        resolved_model: "claude-opus-5",
        resolved_effort: "high",
        status: "active",
        title: "Mobile execution"
      })
      |> Repo.insert()

    on_exit(fn -> Repo.delete(thread) end)

    assert {:ok, %{"worktrees" => worktrees}} =
             MobilePresenter.call("worktree.ps", %{"limit" => 10_000}, %{})

    assert %{
             "worktreeId" => id,
             "sessionScope" => "issue_execution",
             "issueIdentifier" => "DEV-" <> _,
             "agentKind" => "claude"
           } = Enum.find(worktrees, &(&1["worktreeId"] == to_string(thread.id)))

    assert id == to_string(thread.id)

    assert %{
             execution_session_id: execution_session_id,
             issue_identifier: issue_identifier,
             status: "error",
             agent_kind: "claude",
             requested_model: "claude-opus-5",
             requested_effort: "high",
             resolved_model: "claude-opus-5",
             resolved_effort: "high",
             error: "Execution is not active on this host. Retry to recover.",
             long_running: false
           } =
             OrchestratorService.list_executions()
             |> Enum.find(&(&1.execution_session_id == thread.id))

    assert execution_session_id == thread.id
    assert issue_identifier == thread.issue_identifier

    assert {:ok,
            %{
              project_slug: project_slug,
              agent_kind: "claude",
              requested_model: "claude-opus-5",
              requested_effort: "high",
              resolved_model: "claude-opus-5",
              resolved_effort: "high"
            }} =
             OrchestratorService.session_context(thread.id)

    assert project_slug == thread.project_slug
  end
end
