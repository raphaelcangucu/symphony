defmodule SymphonyElixir.Agent.BackendCapabilitiesTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Agent.BackendCapabilities

  test "describes Codex native controls and collaboration" do
    capabilities = BackendCapabilities.for("codex")

    assert capabilities.resume
    assert capabilities.interrupt
    assert capabilities.steer
    assert capabilities.native_goal
    assert capabilities.model_selection
    assert capabilities.multi_agent
  end

  test "keeps unsupported controls explicit for other providers" do
    for provider <- ~w(claude cursor opencode) do
      capabilities = BackendCapabilities.for(provider)
      assert capabilities.provider == provider
      assert capabilities.resume
      assert capabilities.interrupt
      refute capabilities.steer
      refute capabilities.multi_agent
    end

    assert BackendCapabilities.for("claude").native_goal
    refute BackendCapabilities.for("cursor").native_goal
    refute BackendCapabilities.for("opencode").native_goal
  end

  test "returns an inert contract for an unsupported provider" do
    capabilities = BackendCapabilities.for("unknown")

    assert capabilities.provider == "unknown"
    refute capabilities.resume
    refute capabilities.interrupt
    refute capabilities.native_goal
  end

  test "CodingAgent exposes the selected adapter capabilities through one facade" do
    assert SymphonyElixir.CodingAgent.capabilities("codex").multi_agent
    assert SymphonyElixir.CodingAgent.capabilities("claude").native_goal
    refute SymphonyElixir.CodingAgent.capabilities("cursor").native_goal
    refute SymphonyElixir.CodingAgent.capabilities("opencode").steer
  end

  test "CodingAgent never substitutes the default adapter for an unknown provider" do
    assert_raise ArgumentError, ~r/unsupported agent provider/, fn ->
      SymphonyElixir.CodingAgent.adapter_for("unknown")
    end
  end
end
