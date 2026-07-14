defmodule SymphonyElixir.Assistant.SkillProfilesTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.SkillProfiles

  test "valid?/1 accepts profiles and auto" do
    assert SkillProfiles.valid?("auto")
    assert SkillProfiles.valid?("planning")
    assert SkillProfiles.valid?("implementation")
    refute SkillProfiles.valid?("authoring")
    refute SkillProfiles.valid?(nil)
  end

  test "normalize/1 maps legacy authoring/execution aliases" do
    assert SkillProfiles.normalize("authoring") == "planning"
    assert SkillProfiles.normalize("execution") == "implementation"
    assert SkillProfiles.normalize("PLANNING") == "planning"
    assert SkillProfiles.normalize("nope") == "auto"
    assert SkillProfiles.normalize(nil) == "auto"
  end

  test "planning profile preloads brainstorming and writing-plans" do
    profile = SkillProfiles.get("planning")
    assert profile.preload == ["brainstorming", "writing-plans"]
    assert "using-superpowers" in profile.visible
  end

  test "implementation profile preloads TDD and verification" do
    profile = SkillProfiles.get("implementation")
    assert "test-driven-development" in profile.preload
    assert "verification-before-completion" in profile.preload
  end

  test "resolve_auto/3 picks profile from scope and mode" do
    assert SkillProfiles.resolve_auto("project_explore", "plan") == "explore"
    assert SkillProfiles.resolve_auto("issue", "plan") == "planning"
    assert SkillProfiles.resolve_auto("issue", "build") == "implementation"
    assert SkillProfiles.resolve_auto("issue", "yolo") == "implementation"
    assert SkillProfiles.resolve_auto("issue", "yolo", runtime: "autonomous") == "orchestrator"
  end

  test "resolve/4 keeps pinned profiles when selection is not auto" do
    assert SkillProfiles.resolve("debugging", "issue", "yolo") == "debugging"
    assert SkillProfiles.resolve("auto", "issue", "plan") == "planning"
    assert SkillProfiles.resolve("authoring", "issue", "yolo") == "planning"
  end
end
