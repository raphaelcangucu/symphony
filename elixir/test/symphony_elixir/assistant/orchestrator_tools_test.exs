defmodule SymphonyElixir.Assistant.OrchestratorToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.OrchestratorTools
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!()
    :ok
  end

  defp issue_fixture do
    {:ok, _} = Context.ensure_project(%{name: "Macro", slug: "macro"})
    {:ok, issue} = Context.create_issue("macro", %{"title" => "T", "status" => "Todo"})
    issue
  end

  test "assistant spec requires identifier" do
    spec = OrchestratorTools.assistant_tool_spec()
    assert spec["name"] == "get_issue_orchestrator_state"
    assert "identifier" in spec["inputSchema"]["required"]
  end

  test "reports idle when orchestrator has no entry" do
    issue = issue_fixture()

    assert {:ok, result} =
             OrchestratorTools.execute("macro", %{"identifier" => issue.identifier}, orchestrator_state: fn _identifier -> {:error, :issue_not_found} end)

    assert result.data.active == false
    assert result.data.issue.identifier == issue.identifier
    assert result.data.orchestrator == nil
  end

  test "passes through orchestrator payload when active" do
    issue = issue_fixture()
    payload = %{status: "running", attempts: %{restart_count: 0}}

    assert {:ok, result} =
             OrchestratorTools.execute("macro", %{"identifier" => issue.identifier}, orchestrator_state: fn _identifier -> {:ok, payload} end)

    assert result.data.active == true
    assert result.data.orchestrator == payload
  end

  test "errors when issue is unknown" do
    {:ok, _} = Context.ensure_project(%{name: "Macro", slug: "macro"})

    assert {:error, :issue_not_found} =
             OrchestratorTools.execute("macro", %{"identifier" => "MACRO-999"})
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
