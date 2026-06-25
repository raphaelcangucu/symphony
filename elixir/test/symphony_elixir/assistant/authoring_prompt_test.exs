defmodule SymphonyElixir.Assistant.AuthoringPromptTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.SubtaskAuthoring

  test "authoring guidance explains the two execution shapes and tools" do
    text = SubtaskAuthoring.guidance()

    assert text =~ "workpad_task"
    assert text =~ "child_run"
    assert text =~ "create_subtask"
    assert text =~ "set_issue_parent"
    assert text =~ "shared contract"
  end

  test "authoring guidance names the inspection and preview tools" do
    text = SubtaskAuthoring.guidance()

    assert text =~ "classify_execution_unit"
    assert text =~ "preview_execution_plan"
    assert text =~ "define_shared_contract"
  end
end
