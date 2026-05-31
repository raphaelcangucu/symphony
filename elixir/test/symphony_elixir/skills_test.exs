defmodule SymphonyElixir.SkillsTest do
  use ExUnit.Case, async: true
  alias SymphonyElixir.Skills

  test "load/1 returns concatenated skill bodies" do
    content = Skills.load(["brainstorming", "writing-plans"])
    assert content =~ "brainstorming"
    assert content =~ "writing-plans" or content =~ "Writing Plans"
  end

  test "load/1 ignores unknown skills" do
    assert Skills.load(["does-not-exist"]) == ""
  end

  test "available/0 lists vendored skills" do
    names = Skills.available()
    assert "brainstorming" in names
    assert "writing-plans" in names
  end
end
