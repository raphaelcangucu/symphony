defmodule SymphonyElixir.OpenCode.CodingAgentTest do
  use ExUnit.Case, async: false

  test "CodingAgent.adapter_for/1 routes opencode" do
    assert SymphonyElixir.CodingAgent.adapter_for("opencode") == SymphonyElixir.OpenCode.CodingAgent
  end
end
