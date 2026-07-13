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

  test "version_at_least? compares semver from version strings" do
    assert AgentAvailability.version_at_least?("2.1.139", "2.1.139")
    assert AgentAvailability.version_at_least?("2.1.140", "2.1.139")
    assert AgentAvailability.version_at_least?("claude 2.2.0 (abc)", "2.1.139")
    refute AgentAvailability.version_at_least?("2.1.138", "2.1.139")
    refute AgentAvailability.version_at_least?(nil, "2.1.139")
  end

  test "claude_goal_supported? honors override" do
    Application.put_env(:symphony_elixir, :claude_goal_supported_override, true)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :claude_goal_supported_override) end)
    assert AgentAvailability.claude_goal_supported?() == true

    Application.put_env(:symphony_elixir, :claude_goal_supported_override, false)
    assert AgentAvailability.claude_goal_supported?() == false
  end

  test "Claude Goal preflight reports version, trust, hooks, and native support failures" do
    workspace = System.tmp_dir!()

    for reason <- [
          :claude_goal_unsupported_version,
          :claude_workspace_untrusted,
          :claude_hooks_unavailable,
          :claude_goal_native_support_unavailable
        ] do
      Application.put_env(:symphony_elixir, :claude_goal_preflight_override, {:error, reason})
      assert {:error, ^reason} = AgentAvailability.claude_goal_preflight(workspace)
    end

    Application.put_env(:symphony_elixir, :claude_goal_preflight_override, :ok)
    assert :ok = AgentAvailability.claude_goal_preflight(workspace)

    on_exit(fn -> Application.delete_env(:symphony_elixir, :claude_goal_preflight_override) end)
  end
end
