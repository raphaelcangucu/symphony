defmodule SymphonyElixir.ConfigAgentKindTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Config

  test "explicit agent.kind wins over section inference" do
    assert Config.agent_kind_from_config(%{"agent" => %{"kind" => "claude"}, "codex" => %{}}) == "claude"
    assert Config.agent_kind_from_config(%{"agent" => %{"kind" => "codex"}, "claude" => %{}}) == "codex"
  end

  test "exactly one agent section infers that kind (compat)" do
    assert Config.agent_kind_from_config(%{"codex" => %{"command" => "codex app-server"}}) == "codex"
    assert Config.agent_kind_from_config(%{"claude" => %{}}) == "claude"
  end

  test "no section and no explicit kind means inherit (nil)" do
    assert Config.agent_kind_from_config(%{}) == nil
    assert Config.agent_kind_from_config(%{"agent" => %{"max_turns" => 5}}) == nil
  end

  test "both sections without explicit kind means inherit (nil)" do
    assert Config.agent_kind_from_config(%{"codex" => %{}, "claude" => %{}}) == nil
  end

  test "invalid explicit kind is ignored" do
    assert Config.agent_kind_from_config(%{"agent" => %{"kind" => "gemini"}}) == nil
    assert Config.agent_kind_from_config(%{"agent" => %{"kind" => "gemini"}, "codex" => %{}}) == "codex"
  end

  test "non-map input means inherit" do
    assert Config.agent_kind_from_config(nil) == nil
  end
end
