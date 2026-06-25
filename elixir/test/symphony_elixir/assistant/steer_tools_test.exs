defmodule SymphonyElixir.Assistant.SteerToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.SteerTools
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

  test "assistant spec requires identifier and message" do
    spec = SteerTools.assistant_tool_spec()
    assert spec["name"] == "steer_agent"
    assert "identifier" in spec["inputSchema"]["required"]
    assert "message" in spec["inputSchema"]["required"]
  end

  test "delivers a steering message to a running agent" do
    issue = issue_fixture()
    test_pid = self()

    steer = fn identifier, message, reply_to ->
      send(test_pid, {:steered, identifier, message, reply_to})
      :ok
    end

    assert {:ok, result} =
             SteerTools.execute(
               "macro",
               %{"identifier" => issue.identifier, "message" => "  focus on the failing test  "},
               steer: steer
             )

    assert result.tool == "steer_agent"
    assert result.data.delivered == true
    assert result.data.issue.identifier == issue.identifier
    assert result.data.steer_message == "focus on the failing test"
    assert_received {:steered, _id, "focus on the failing test", nil}
  end

  test "returns agent_not_running when no steerable turn is active" do
    issue = issue_fixture()

    assert {:error, :agent_not_running} =
             SteerTools.execute(
               "macro",
               %{"identifier" => issue.identifier, "message" => "hello"},
               steer: fn _id, _msg, _reply -> {:error, :ActiveTurnNotSteerable} end
             )
  end

  test "requires a non-empty message" do
    issue = issue_fixture()

    assert {:error, :missing_message} =
             SteerTools.execute(
               "macro",
               %{"identifier" => issue.identifier, "message" => "   "},
               steer: fn _id, _msg, _reply -> :ok end
             )
  end

  test "errors when the issue is unknown in the project" do
    {:ok, _} = Context.ensure_project(%{name: "Macro", slug: "macro"})

    assert {:error, :issue_not_found} =
             SteerTools.execute(
               "macro",
               %{"identifier" => "MACRO-999", "message" => "hi"},
               steer: fn _id, _msg, _reply -> :ok end
             )
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
