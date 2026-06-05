defmodule SymphonyElixir.SettingsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Setting

  setup do
    Repo.delete_all(Setting)
    :ok
  end

  test "get returns the in-code default when no row exists" do
    assert Settings.get("agents", "default_agent_kind") == "codex"
  end

  test "put upserts by (group, name) and get returns the stored value" do
    assert {:ok, "claude"} = Settings.put("agents", "default_agent_kind", "claude")
    assert Settings.get("agents", "default_agent_kind") == "claude"

    assert {:ok, "codex"} = Settings.put("agents", "default_agent_kind", "codex")
    assert Settings.get("agents", "default_agent_kind") == "codex"
    assert Repo.aggregate(Setting, :count) == 1
  end

  test "put rejects unknown groups, unknown names, and invalid values" do
    assert {:error, :unknown_group} = Settings.put("nope", "default_agent_kind", "codex")
    assert {:error, :unknown_setting} = Settings.put("agents", "nope", "codex")
    assert {:error, :invalid_value} = Settings.put("agents", "default_agent_kind", "gemini")
  end

  test "get_group and all merge stored rows over defaults" do
    assert Settings.get_group("agents") == %{"default_agent_kind" => "codex"}

    {:ok, _} = Settings.put("agents", "default_agent_kind", "claude")

    assert Settings.get_group("agents") == %{"default_agent_kind" => "claude"}
    assert Settings.all() == %{"agents" => %{"default_agent_kind" => "claude"}}
  end

  test "a corrupt payload falls back to the default" do
    Repo.insert!(%Setting{group: "agents", name: "default_agent_kind", payload: %{"bogus" => true}})
    assert Settings.get("agents", "default_agent_kind") == "codex"
  end

  test "a stale stored value that no longer casts falls back to the default" do
    Repo.insert!(%Setting{group: "agents", name: "default_agent_kind", payload: %{"value" => "gemini"}})
    assert Settings.get("agents", "default_agent_kind") == "codex"
  end

  test "Settings.Agents.default_agent_kind/0 convenience reads the chain" do
    assert Settings.Agents.default_agent_kind() == "codex"
    {:ok, _} = Settings.put("agents", "default_agent_kind", "claude")
    assert Settings.Agents.default_agent_kind() == "claude"
  end
end
