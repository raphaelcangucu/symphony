defmodule SymphonyElixir.Evidence.RunStatusTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Evidence.RunStatus

  test "overall_status passes when a targeted unit run passes despite a failed full-suite run" do
    runs = [
      %{"kind" => "unit", "repo" => "frontend", "status" => "failed"},
      %{"kind" => "unit", "repo" => "frontend", "status" => "passed"}
    ]

    assert RunStatus.overall_status(runs) == "passed"
  end

  test "overall_status fails when the best run for a repo is blocked" do
    runs = [
      %{"kind" => "unit", "repo" => "frontend", "status" => "passed"},
      %{"kind" => "e2e", "repo" => "frontend", "status" => "blocked"}
    ]

    assert RunStatus.overall_status(runs) == "failed"
  end

  test "canonical_runs keeps one entry per kind and repo" do
    runs = [
      %{"kind" => "unit", "repo" => "frontend", "status" => "failed", "command" => "full"},
      %{"kind" => "unit", "repo" => "frontend", "status" => "passed", "command" => "targeted"},
      %{"kind" => "lint", "repo" => "frontend", "status" => "passed", "command" => "eslint paths"}
    ]

    canonical = RunStatus.canonical_runs(runs)
    assert length(canonical) == 2

    assert Enum.any?(canonical, &(&1["status"] == "passed" and &1["command"] == "targeted"))
    assert Enum.any?(canonical, &(&1["kind"] == "lint" and &1["status"] == "passed"))
  end
end
