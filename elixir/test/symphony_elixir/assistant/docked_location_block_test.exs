defmodule SymphonyElixir.Assistant.DockedLocationBlockTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.AgentSession

  describe "docked_location_block/1" do
    test "describes the project board view" do
      block = AgentSession.docked_location_block(%{"maestro" => %{"kind" => "project", "view" => "board"}})
      assert block =~ "board"
    end

    test "describes the project list view" do
      block = AgentSession.docked_location_block(%{"maestro" => %{"kind" => "project", "view" => "list"}})
      assert block =~ "list"
    end

    test "describes an open issue drawer" do
      block =
        AgentSession.docked_location_block(%{
          "maestro" => %{"kind" => "issue", "view" => "board", "issueIdentifier" => "ACME-7"}
        })

      assert block =~ "issue"
    end

    test "is empty without a docked maestro context" do
      assert AgentSession.docked_location_block(%{}) == ""
      assert AgentSession.docked_location_block(%{"surface" => "home"}) == ""
    end
  end
end
