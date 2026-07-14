defmodule SymphonyElixir.Assistant.TurnConfigurationTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.TurnConfiguration

  test "issue session defaults to plan + planning toolkit" do
    config = TurnConfiguration.resolve(scope: "issue")

    assert config.mode == "plan"
    assert config.skill_profile == "planning"
    assert config.skill_profile_selection == "auto"
    assert config.preload_slugs == ["brainstorming", "writing-plans"]
    refute config.allows_writes?
    refute config.mode_locked?
  end

  test "issue_session defaults to build + implementation toolkit" do
    config = TurnConfiguration.resolve(scope: "issue_session")

    assert config.mode == "build"
    assert config.skill_profile == "implementation"
    assert config.allows_writes?
  end

  test "explore locks mode to plan and uses explore toolkit" do
    config = TurnConfiguration.resolve(scope: "project_explore", mode: "yolo")

    assert config.mode == "plan"
    assert config.skill_profile == "explore"
    assert config.mode_locked?
    refute config.allows_writes?
  end

  test "explicit skill profile stays independent from mode" do
    config =
      TurnConfiguration.resolve(
        scope: "issue",
        mode: "yolo",
        skill_profile: "debugging"
      )

    assert config.mode == "yolo"
    assert config.skill_profile == "debugging"
    assert config.allows_writes?
    assert "systematic-debugging" in config.preload_slugs
  end

  test "legacy authoring skill profile maps to planning" do
    config =
      TurnConfiguration.resolve(
        scope: "issue",
        mode: "build",
        skill_profile: "authoring"
      )

    assert config.skill_profile == "planning"
    assert config.skill_profile_selection == "planning"
  end

  test "autonomous runtime defaults to yolo and orchestrator toolkit" do
    config = TurnConfiguration.resolve(scope: "issue", runtime: "autonomous")

    assert config.mode == "yolo"
    assert config.skill_profile == "orchestrator"
    assert config.runtime == "autonomous"
    refute config.allows_writes?
  end

  test "unknown mode coerces via ExecutionMode.default" do
    config = TurnConfiguration.resolve(scope: "issue_session", mode: "turbo")
    assert config.mode == "yolo"
  end
end
