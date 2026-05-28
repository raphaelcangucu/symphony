defmodule SymphonyElixir.LocalTracker.DevEnv.StepTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.DevEnv.Step

  test "requires description and command" do
    refute Step.changeset(%Step{}, %{project_id: 1}).valid?
  end

  test "validates source inclusion" do
    refute Step.changeset(%Step{}, %{project_id: 1, description: "d", command: "c", source: "bogus"}).valid?
    assert Step.changeset(%Step{}, %{project_id: 1, description: "d", command: "c", source: "convention"}).valid?
  end

  test "sources lists the allowed step sources" do
    assert Step.sources() == ~w(convention readme heuristic manual)
  end
end
