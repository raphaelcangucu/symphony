defmodule SymphonyElixir.Assistant.SyncToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.SyncTools
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

  test "spec requires identifier" do
    spec = SyncTools.assistant_tool_spec()
    assert spec["name"] == "sync_issue"
    assert "identifier" in spec["inputSchema"]["required"]
  end

  test "returns the refreshed issue on success" do
    issue = issue_fixture()

    assert {:ok, result} =
             SyncTools.execute("macro", %{"identifier" => issue.identifier}, sync_issue: fn _project, _identifier -> {:ok, :synced} end)

    assert result.tool == "sync_issue"
    assert result.data.issue.identifier == issue.identifier
  end

  test "surfaces sync errors as structured failures" do
    issue = issue_fixture()

    assert {:error, :not_supported_on_remote} =
             SyncTools.execute("macro", %{"identifier" => issue.identifier}, sync_issue: fn _project, _identifier -> {:error, :not_supported_on_remote} end)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
