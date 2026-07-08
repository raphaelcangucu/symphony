defmodule SymphonyElixir.AgentAvailabilityTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentAvailability

  setup do
    AgentAvailability.invalidate_cache()
    :ok
  end

  test "probe reports available=true with a version and resolved path for a real binary" do
    # `sh` exists on every CI/dev host; "--version"-less binaries still count as available.
    result = AgentAvailability.probe_command("sh")

    assert result.available == true
    assert result.command == "sh"
    assert is_binary(result.path)
  end

  test "probe reports available=false with a nil path for a missing binary" do
    result = AgentAvailability.probe_command("definitely-not-a-real-binary-xyz")

    assert result == %{
             available: false,
             version: nil,
             command: "definitely-not-a-real-binary-xyz",
             path: nil,
             authenticated: nil,
             detail: nil
           }
  end

  test "probe/0 keys results by agent kind and caches them" do
    assert %{codex: %{available: _}, claude: %{available: _}, opencode: %{available: _}} =
             AgentAvailability.probe()

    assert %{codex: _} = AgentAvailability.probe()
  end

  test "probe/0 includes opencode with health fields" do
    AgentAvailability.invalidate_cache()
    result = AgentAvailability.probe()
    assert Map.has_key?(result, :opencode)
    assert Map.has_key?(result.opencode, :authenticated)
    assert Map.has_key?(result.opencode, :detail)
  end
end
