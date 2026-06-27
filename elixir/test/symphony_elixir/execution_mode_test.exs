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

  test "default is build" do
    assert ExecutionMode.default() == "build"
  end

  test "normalize/1 coerces unknown values to the default" do
    assert ExecutionMode.normalize("plan") == "plan"
    assert ExecutionMode.normalize("turbo") == "build"
    assert ExecutionMode.normalize(nil) == "build"
  end

  test "codex policy escalates with mode" do
    assert ExecutionMode.codex_policy("plan").sandbox == "read-only"
    assert ExecutionMode.codex_policy("build").sandbox == "workspace-write"
    assert ExecutionMode.codex_policy("yolo").sandbox == "danger-full-access"
  end

  test "codex policy keeps approval non-interactive" do
    assert ExecutionMode.codex_policy("plan").approval_policy == "never"
    assert ExecutionMode.codex_policy("build").approval_policy == "never"
    assert ExecutionMode.codex_policy("yolo").approval_policy == "never"
  end

  test "codex policy falls back to build for unknown modes" do
    assert ExecutionMode.codex_policy("turbo").sandbox == "workspace-write"
  end

  test "claude permission_mode mapping" do
    assert ExecutionMode.claude_permission_mode("plan") == "plan"
    assert ExecutionMode.claude_permission_mode("build") == "acceptEdits"
    assert ExecutionMode.claude_permission_mode("yolo") == "bypassPermissions"
    assert ExecutionMode.claude_permission_mode("turbo") == "acceptEdits"
  end

  test "cursor force only on yolo" do
    refute ExecutionMode.cursor_force?("plan")
    refute ExecutionMode.cursor_force?("build")
    assert ExecutionMode.cursor_force?("yolo")
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
    refute "plan" in ExecutionMode.available_for("cursor")
    assert "build" in ExecutionMode.available_for("cursor")
    assert "yolo" in ExecutionMode.available_for("cursor")
  end

  test "all/0 lists every mode" do
    assert ExecutionMode.all() == ["plan", "build", "yolo"]
  end
end
