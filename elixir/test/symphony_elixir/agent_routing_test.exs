defmodule SymphonyElixir.AgentRoutingTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentRouting

  @configured ["codex", "claude"]

  test "symphony:codex resolves to codex" do
    assert AgentRouting.resolve_agent_kind(["symphony:codex"], @configured, "codex") == "codex"
  end

  test "symphony:claude resolves to claude" do
    assert AgentRouting.resolve_agent_kind(["symphony:claude"], @configured, "codex") == "claude"
  end

  test "symphony alone uses default agent kind" do
    assert AgentRouting.resolve_agent_kind(["symphony"], @configured, "codex") == "codex"
    assert AgentRouting.resolve_agent_kind(["symphony"], @configured, "claude") == "claude"
  end

  test "claude label wins over codex when both present" do
    assert AgentRouting.resolve_agent_kind(["symphony:codex", "symphony:claude"], @configured, "codex") ==
             "claude"
  end

  test "returns nil when agent kind is not configured" do
    assert AgentRouting.resolve_agent_kind(["symphony:claude"], ["codex"], "codex") == nil
  end

  test "returns nil without symphony family labels" do
    refute AgentRouting.routable?(["bug"], @configured, "codex")
  end
end
