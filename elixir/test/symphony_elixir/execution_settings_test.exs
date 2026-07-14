defmodule SymphonyElixir.ExecutionSettingsTest do
  use ExUnit.Case, async: true
  alias SymphonyElixir.ExecutionSettings

  test "resolve_agent prefers settings over label over project over user over codex" do
    assert ExecutionSettings.resolve_agent(%{
             settings_agent: "cursor",
             label_agent: "codex",
             project_agent: "claude",
             user_agent: "opencode"
           }) == "cursor"

    assert ExecutionSettings.resolve_agent(%{
             settings_agent: nil,
             label_agent: "codex",
             project_agent: "claude",
             user_agent: "opencode"
           }) == "codex"

    assert ExecutionSettings.resolve_agent(%{
             settings_agent: nil,
             label_agent: nil,
             project_agent: "claude",
             user_agent: "opencode"
           }) == "claude"

    assert ExecutionSettings.resolve_agent(%{
             settings_agent: nil,
             label_agent: nil,
             project_agent: nil,
             user_agent: "opencode"
           }) == "opencode"

    assert ExecutionSettings.resolve_agent(%{
             settings_agent: nil,
             label_agent: nil,
             project_agent: nil,
             user_agent: nil
           }) == "codex"
  end

  test "resolve_model prefers settings over project over user over nil" do
    assert ExecutionSettings.resolve_model(%{
             settings_model: "a",
             project_model: "b",
             user_model: "c"
           }) == "a"

    assert ExecutionSettings.resolve_model(%{
             settings_model: nil,
             project_model: "b",
             user_model: "c"
           }) == "b"

    assert ExecutionSettings.resolve_model(%{
             settings_model: nil,
             project_model: nil,
             user_model: "c"
           }) == "c"

    assert ExecutionSettings.resolve_model(%{
             settings_model: nil,
             project_model: nil,
             user_model: nil
           }) == nil
  end

  test "resolve_effort mirrors model precedence" do
    assert ExecutionSettings.resolve_effort(%{
             settings_effort: "high",
             project_effort: "medium",
             user_effort: "low"
           }) == "high"

    assert ExecutionSettings.resolve_effort(%{
             settings_effort: nil,
             project_effort: nil,
             user_effort: "low"
           }) == "low"
  end
end
