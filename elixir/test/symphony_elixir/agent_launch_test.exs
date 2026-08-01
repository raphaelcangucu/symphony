defmodule SymphonyElixir.AgentLaunchTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentLaunch
  alias SymphonyElixir.AgentLifecycle.Resolver.Result

  test "combines one resolved executable with one isolated account home" do
    resolution = %Result{
      preferred_source: :managed,
      effective_source: :managed,
      executable_path: "/managed/codex",
      version: "1.2.3",
      fallback_reason: nil,
      probed_at: 100
    }

    account = %{
      id: "work",
      agent_kind: "codex",
      home: "/isolated/codex/work",
      authentication_status: "authenticated"
    }

    assert {:ok, launch} =
             AgentLaunch.resolve("codex", "personal", "work",
               resolver: fn "codex" -> {:ok, resolution} end,
               account_resolver: fn "codex", "personal", "work" -> {:ok, account} end
             )

    assert launch.agent_kind == "codex"
    assert launch.account_id == "work"
    assert launch.executable_path == "/managed/codex"
    assert launch.executable_version == "1.2.3"
    assert launch.effective_source == :managed
    assert launch.environment == %{"CODEX_HOME" => "/isolated/codex/work"}
  end

  test "injects provider commands and environment without discarding caller options" do
    for {agent, option} <- [
          {"claude", :claude_command},
          {"cursor", :cursor_command},
          {"opencode", :opencode_command}
        ] do
      launch = launch(agent, "/managed/#{agent}")
      options = AgentLaunch.inject_options(launch, model: "kept")

      assert options[:model] == "kept"
      assert options[option] == "/managed/#{agent}"
      assert options[:agent_env] != %{}
    end

    options =
      AgentLaunch.inject_options(launch("codex", "/managed/codex"),
        codex_config: %{"approval_policy" => "never"}
      )

    assert options[:codex_config]["approval_policy"] == "never"
    assert options[:codex_config]["command"] =~ "/managed/codex"
    assert options[:agent_env] == %{"CODEX_HOME" => "/isolated/codex"}
  end

  test "launch provenance is a value and does not change with later defaults" do
    launch = launch("claude", "/managed/claude")
    changed_defaults = %{global_account_id: "another", executable_path: "/managed/claude-2"}

    assert launch.account_id == "account"
    assert launch.executable_path == "/managed/claude"
    refute launch.account_id == changed_defaults.global_account_id
    refute launch.executable_path == changed_defaults.executable_path
  end

  defp launch(agent, executable) do
    AgentLaunch.new!(
      agent_kind: agent,
      account_id: "account",
      account_home: "/isolated/#{agent}",
      preferred_source: :managed,
      effective_source: :managed,
      executable_path: executable,
      executable_version: "1.0.0",
      fallback_reason: nil,
      probed_at: 100
    )
  end
end
