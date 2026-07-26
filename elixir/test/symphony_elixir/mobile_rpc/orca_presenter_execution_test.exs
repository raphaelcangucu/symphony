defmodule SymphonyElixir.MobileRpc.OrcaPresenterExecutionTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.Thread
  alias SymphonyElixir.MobileRpc.{OrcaPresenter, OrchestratorService}
  alias SymphonyElixir.Repo

  test "marks issue execution worktrees so mobile opens the orchestrator chat transport" do
    suffix = System.unique_integer([:positive])

    {:ok, thread} =
      %Thread{}
      |> Thread.changeset(%{
        scope: "issue_execution",
        project_slug: "mobile-routing-#{suffix}",
        issue_identifier: "DEV-#{suffix}",
        workspace_path: System.tmp_dir!(),
        agent_kind: "claude",
        status: "active",
        title: "Mobile execution"
      })
      |> Repo.insert()

    on_exit(fn -> Repo.delete(thread) end)

    assert {:ok, %{"worktrees" => worktrees}} =
             OrcaPresenter.call("worktree.ps", %{"limit" => 10_000}, %{})

    assert %{
             "worktreeId" => id,
             "sessionScope" => "issue_execution",
             "issueIdentifier" => "DEV-" <> _,
             "agentKind" => "claude"
           } = Enum.find(worktrees, &(&1["worktreeId"] == to_string(thread.id)))

    assert id == to_string(thread.id)

    assert {:ok, %{project_slug: project_slug}} =
             OrchestratorService.session_context(thread.id)

    assert project_slug == thread.project_slug
  end
end
