defmodule SymphonyElixir.Assistant.SettingsToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.SettingsTools

  test "tool_specs exposes get_settings and update_setting" do
    names = SettingsTools.tool_specs() |> Enum.map(& &1["name"])
    assert "get_settings" in names
    assert "update_setting" in names
  end

  test "get_settings returns every group by default" do
    assert {:ok, %{tool: "get_settings", data: %{settings: settings}}} =
             SettingsTools.execute("get_settings", %{})

    assert is_map(settings)
    assert Map.has_key?(settings, "agents")
  end

  test "get_settings rejects an unknown group" do
    assert {:error, {:unknown_settings_group, "nope"}} =
             SettingsTools.execute("get_settings", %{"group" => "nope"})
  end

  test "update_setting rejects an unknown group before touching the store" do
    assert {:error, :unknown_group} =
             SettingsTools.execute("update_setting", %{
               "group" => "nope",
               "name" => "whatever",
               "value" => 1
             })
  end

  test "update_setting requires a value" do
    assert {:error, {:missing_field, :value}} =
             SettingsTools.execute("update_setting", %{"group" => "ui", "name" => "theme"})
  end

  test "rejects unsupported tools" do
    assert {:error, {:unsupported_tool, "nope"}} = SettingsTools.execute("nope", %{})
  end
end
