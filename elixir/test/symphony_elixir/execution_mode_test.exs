defmodule SymphonyElixir.ExecutionModeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.ExecutionMode

  test "valid?/1" do
    assert ExecutionMode.valid?("plan")
    assert ExecutionMode.valid?("build")
    assert ExecutionMode.valid?("yolo")
    refute ExecutionMode.valid?("turbo")
    refute ExecutionMode.valid?(nil)
  end

  test "default is yolo (non-interactive runs cannot approve mid-run)" do
    assert ExecutionMode.default() == "yolo"
  end

  test "normalize/1 coerces unknown values to the default" do
    assert ExecutionMode.normalize("plan") == "plan"
    assert ExecutionMode.normalize("turbo") == "yolo"
    assert ExecutionMode.normalize(nil) == "yolo"
  end

  test "codex policy escalates with mode" do
    assert ExecutionMode.codex_policy("plan").sandbox == "read-only"
    assert ExecutionMode.codex_policy("build").sandbox == "workspace-write"
    assert ExecutionMode.codex_policy("yolo").sandbox == "danger-full-access"
  end

  test "codex policy keeps approval non-interactive on the arity-1 (autonomous) ceiling" do
    assert ExecutionMode.codex_policy("plan").approval_policy == "never"
    assert ExecutionMode.codex_policy("build").approval_policy == "never"
    assert ExecutionMode.codex_policy("yolo").approval_policy == "never"
  end

  test "codex policy falls back to the default (yolo) for unknown modes" do
    assert ExecutionMode.codex_policy("turbo").sandbox == "danger-full-access"
  end

  test "codex_approval_override prompts only for interactive build" do
    assert ExecutionMode.codex_approval_override("build", true) == {:force, "on-request"}
    assert ExecutionMode.codex_approval_override("build", false) == {:force, "never"}
    assert ExecutionMode.codex_approval_override("yolo", true) == {:force, "never"}
    assert ExecutionMode.codex_approval_override("yolo", false) == {:force, "never"}
    assert ExecutionMode.codex_approval_override("plan", true) == :honor_config
    assert ExecutionMode.codex_approval_override("plan", false) == :honor_config
    # unknown coerces to yolo
    assert ExecutionMode.codex_approval_override("turbo", true) == {:force, "never"}
  end

  test "claude permission_mode defaults to the autonomous ceiling (arity-1)" do
    assert ExecutionMode.claude_permission_mode("plan") == "plan"
    assert ExecutionMode.claude_permission_mode("build") == "bypassPermissions"
    assert ExecutionMode.claude_permission_mode("yolo") == "bypassPermissions"
    assert ExecutionMode.claude_permission_mode("turbo") == "bypassPermissions"
  end

  test "claude permission_mode uses default (prompting) only for interactive build" do
    assert ExecutionMode.claude_permission_mode("plan", true) == "plan"
    assert ExecutionMode.claude_permission_mode("build", true) == "default"
    assert ExecutionMode.claude_permission_mode("build", false) == "bypassPermissions"
    assert ExecutionMode.claude_permission_mode("yolo", true) == "bypassPermissions"
    assert ExecutionMode.claude_permission_mode("turbo", true) == "bypassPermissions"
  end

  test "claude_interactive_approval? is true only for interactive build" do
    assert ExecutionMode.claude_interactive_approval?("build", true)
    refute ExecutionMode.claude_interactive_approval?("build", false)
    refute ExecutionMode.claude_interactive_approval?("plan", true)
    refute ExecutionMode.claude_interactive_approval?("yolo", true)
    refute ExecutionMode.claude_interactive_approval?("turbo", true)
  end

  test "cursor_force?/1 is true for every mode including plan" do
    assert ExecutionMode.cursor_force?("plan")
    assert ExecutionMode.cursor_force?("build")
    assert ExecutionMode.cursor_force?("yolo")
    assert ExecutionMode.cursor_force?(nil)
  end

  test "cursor_interactive_approval? is true only for interactive build" do
    assert ExecutionMode.cursor_interactive_approval?("build", true)
    refute ExecutionMode.cursor_interactive_approval?("build", false)
    refute ExecutionMode.cursor_interactive_approval?("plan", true)
    refute ExecutionMode.cursor_interactive_approval?("yolo", true)
    refute ExecutionMode.cursor_interactive_approval?("turbo", true)
  end

  test "opencode agent mapping" do
    assert ExecutionMode.opencode_agent("plan") == "plan"
    assert ExecutionMode.opencode_agent("build") == "build"
    assert ExecutionMode.opencode_agent("yolo") == "build"
  end

  test "modes available per agent" do
    assert "plan" in ExecutionMode.available_for("codex")
    assert "build" in ExecutionMode.available_for("codex")
    assert "yolo" in ExecutionMode.available_for("codex")
    assert "plan" in ExecutionMode.available_for("cursor")
    assert "build" in ExecutionMode.available_for("cursor")
    assert "yolo" in ExecutionMode.available_for("cursor")
  end

  test "all/0 lists every mode" do
    assert ExecutionMode.all() == ["plan", "build", "yolo"]
  end
end
