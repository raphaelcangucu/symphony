defmodule SymphonyElixir.PullRequestMonitor.ReconcilerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.PullRequestMonitor.Reconciler

  test "candidates/3 keeps wait-state issues of enabled projects, skips in-flight" do
    issues = [
      %{identifier: "#1", project_slug: "enabled"},
      %{identifier: "#2", project_slug: "disabled"},
      %{identifier: "#3", project_slug: "enabled"},
      %{identifier: nil, project_slug: "enabled"}
    ]

    result = Reconciler.candidates(issues, MapSet.new(["enabled"]), MapSet.new(["#3"]))

    assert Enum.map(result, & &1.identifier) == ["#1"]
  end

  test "candidates/3 caps the batch size" do
    issues = for n <- 1..30, do: %{identifier: "##{n}", project_slug: "enabled"}

    result = Reconciler.candidates(issues, MapSet.new(["enabled"]), MapSet.new())

    assert length(result) == 10
  end
end
