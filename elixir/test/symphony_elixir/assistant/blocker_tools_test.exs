defmodule SymphonyElixir.Assistant.BlockerToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.BlockerTools
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!()
    :ok
  end

  defp two_issues do
    {:ok, _} = Context.ensure_project(%{name: "Macro", slug: "macro"})
    {:ok, a} = Context.create_issue("macro", %{"title" => "A", "status" => "Todo"})
    {:ok, b} = Context.create_issue("macro", %{"title" => "B", "status" => "Todo"})
    {a, b}
  end

  test "spec advertises list/create/delete actions" do
    spec = BlockerTools.assistant_tool_spec()
    assert spec["name"] == "manage_blockers"
    assert "action" in spec["inputSchema"]["required"]
  end

  test "create then list then delete" do
    {a, b} = two_issues()

    assert {:ok, created} =
             BlockerTools.execute("macro", %{
               "action" => "create",
               "identifier" => a.identifier,
               "target" => b.identifier
             })

    assert created.data.blocker.source_identifier == a.identifier
    assert created.data.blocker.target_identifier == b.identifier

    assert {:ok, listed} =
             BlockerTools.execute("macro", %{"action" => "list", "identifier" => a.identifier})

    assert length(listed.data.blockers) == 1

    assert {:ok, _deleted} =
             BlockerTools.execute("macro", %{
               "action" => "delete",
               "identifier" => a.identifier,
               "target" => b.identifier
             })

    assert {:ok, empty} =
             BlockerTools.execute("macro", %{"action" => "list", "identifier" => a.identifier})

    assert empty.data.blockers == []
  end

  test "create requires target" do
    {a, _b} = two_issues()

    assert {:error, :missing_target} =
             BlockerTools.execute("macro", %{"action" => "create", "identifier" => a.identifier})
  end

  test "rejects unknown action" do
    {a, _b} = two_issues()

    assert {:error, {:invalid_action, "frobnicate"}} =
             BlockerTools.execute("macro", %{"action" => "frobnicate", "identifier" => a.identifier})
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
