defmodule SymphonyElixir.Tracker.WorkpadTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.Workpad

  test "classifies workpad bodies" do
    assert Workpad.classify("## Codex Workpad\n\nPlan...") == "workpad"
    assert Workpad.classify("  # codex workpad") == "workpad"
    assert Workpad.classify("Regular comment") == "comment"
    assert Workpad.classify(nil) == "comment"
  end

  test "workpad?/1 mirrors classify" do
    assert Workpad.workpad?("## Codex Workpad")
    refute Workpad.workpad?("hello")
  end

  test "classifies evidence bodies" do
    assert Workpad.classify("## Codex Evidence\n\nRun...") == "evidence"
    assert Workpad.classify("  # codex evidence") == "evidence"
    refute Workpad.classify("## Codex Evidence") == "workpad"
  end

  test "evidence?/1 mirrors classify" do
    assert Workpad.evidence?("## Codex Evidence")
    refute Workpad.evidence?("## Codex Workpad")
    refute Workpad.evidence?(nil)
  end
end
