defmodule SymphonyElixir.AgentAvailabilityTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentAvailability

  setup do
    AgentAvailability.invalidate_cache()
    :ok
  end

  test "probe reports available=true with a version for a real binary" do
    # `sh` exists on every CI/dev host; "--version"-less binaries still count as available.
    result = AgentAvailability.probe_command("sh", cache: false)

    assert result.available == true
    assert result.command == "sh"
  end

  test "probe reports available=false for a missing binary" do
    result = AgentAvailability.probe_command("definitely-not-a-real-binary-xyz", cache: false)

    assert result == %{available: false, version: nil, command: "definitely-not-a-real-binary-xyz"}
  end

  test "probe/0 keys results by agent kind and caches them" do
    assert %{codex: %{available: _}, claude: %{available: _}} = AgentAvailability.probe()
    assert %{codex: _} = AgentAvailability.probe()
  end
end
