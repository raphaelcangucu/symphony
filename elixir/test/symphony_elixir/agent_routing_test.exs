defmodule SymphonyElixir.AgentRoutingTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentRouting

  describe "label_agent_kind/1" do
    test "symphony:codex resolves to codex" do
      assert AgentRouting.label_agent_kind(["symphony:codex"]) == "codex"
    end

    test "symphony:claude resolves to claude" do
      assert AgentRouting.label_agent_kind(["symphony:claude"]) == "claude"
    end

    test "symphony:cursor resolves to cursor" do
      assert AgentRouting.label_agent_kind(["symphony:cursor"]) == "cursor"
    end

    test "plain symphony label returns nil (no per-task preference)" do
      assert AgentRouting.label_agent_kind(["symphony"]) == nil
    end

    test "claude label wins over codex when both present" do
      assert AgentRouting.label_agent_kind(["symphony:codex", "symphony:claude"]) == "claude"
    end

    test "cursor label wins over codex when both present" do
      assert AgentRouting.label_agent_kind(["symphony:codex", "symphony:cursor"]) == "cursor"
    end

    test "returns nil without symphony family labels" do
      assert AgentRouting.label_agent_kind(["bug"]) == nil
    end
  end

  describe "routable?/1" do
    test "base symphony label is routable" do
      assert AgentRouting.routable?(["symphony"])
    end

    test "symphony:claude is routable" do
      assert AgentRouting.routable?(["symphony:claude"])
    end

    test "symphony:codex is routable" do
      assert AgentRouting.routable?(["symphony:codex"])
    end

    test "symphony:cursor is routable" do
      assert AgentRouting.routable?(["symphony:cursor"])
    end

    test "non-symphony label is not routable" do
      refute AgentRouting.routable?(["bug"])
    end

    test "empty labels is not routable" do
      refute AgentRouting.routable?([])
    end

    test "case-insensitive symphony label" do
      assert AgentRouting.routable?(["SYMPHONY"])
    end
  end
end
