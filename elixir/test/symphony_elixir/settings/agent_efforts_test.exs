defmodule SymphonyElixir.Settings.AgentEffortsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.AgentEfforts
  alias SymphonyElixir.Settings.Setting

  setup do
    Repo.delete_all(Setting)
    on_exit(fn -> Repo.delete_all(Setting) end)
    :ok
  end

  test "agent_efforts selected defaults to nil" do
    assert AgentEfforts.selected("codex") == nil
    assert AgentEfforts.selected("claude") == nil
    assert AgentEfforts.selected("cursor") == nil
    assert AgentEfforts.selected("opencode") == nil
  end

  test "agent_efforts cast accepts known effort" do
    assert {:ok, "high"} = AgentEfforts.cast("codex", "high")
    assert :error = AgentEfforts.cast("codex", "nope")
  end

  test "agent_efforts cast clears nil and blank to CLI default" do
    assert {:ok, nil} = AgentEfforts.cast("claude", nil)
    assert {:ok, nil} = AgentEfforts.cast("claude", "")
    assert {:ok, nil} = AgentEfforts.cast("claude", "  ")
  end

  test "agents include opencode and options are the shared allowlist" do
    assert AgentEfforts.agents() == ~w(codex claude cursor opencode)
    assert AgentEfforts.options("codex") == ~w(low medium high xhigh max)
    assert AgentEfforts.options("opencode") == ~w(low medium high xhigh max)
    assert AgentEfforts.options("unknown") == []
  end

  test "settings registry exposes agent_efforts group" do
    assert Settings.get_group("agent_efforts") == %{
             "codex" => nil,
             "claude" => nil,
             "cursor" => nil,
             "opencode" => nil
           }

    assert {:ok, "medium"} = Settings.put("agent_efforts", "codex", "medium")
    assert Settings.get("agent_efforts", "codex") == "medium"
    assert AgentEfforts.selected("codex") == "medium"

    assert {:error, :invalid_value} = Settings.put("agent_efforts", "codex", "nope")
    assert {:error, :unknown_setting} = Settings.put("agent_efforts", "gemini", "high")
  end
end
