defmodule SymphonyElixir.Settings.AgentCliTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.AgentCli
  alias SymphonyElixir.Settings.Setting

  setup do
    Repo.delete_all(Setting)
    :ok
  end

  test "every agent defaults to managed, automatic updates, and no failover" do
    for agent <- ~w(codex claude cursor opencode) do
      assert AgentCli.for(agent) == %{
               "preferred_source" => "managed",
               "auto_update" => true,
               "failover_enabled" => false
             }
    end
  end

  test "casts and persists an explicit PATH preference" do
    value = %{
      "preferred_source" => "path",
      "auto_update" => false,
      "failover_enabled" => true
    }

    assert {:ok, ^value} = Settings.put("agent_cli", "codex", value)
    assert AgentCli.for("codex") == value
  end

  test "rejects unknown fields, sources, agents, and non-booleans" do
    assert :error = AgentCli.cast("codex", %{"preferred_source" => "global"})
    assert :error = AgentCli.cast("codex", %{"auto_update" => "yes"})
    assert :error = AgentCli.cast("codex", %{"extra" => true})
    assert :error = AgentCli.cast("unknown", %{})
  end
end
