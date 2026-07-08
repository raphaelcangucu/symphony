defmodule SymphonyElixir.OpenCode.CliRunnerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.OpenCode.CliRunner

  test "build_args includes model and resume session when present" do
    args = CliRunner.build_args(%{cli_session_id: "abc123", model: "opencode/gpt-5.5"})
    assert args =~ "run --format json"
    assert args =~ "--model opencode/gpt-5.5"
    assert args =~ "--session abc123"
  end

  test "build_args omits model flag for empty/auto" do
    args = CliRunner.build_args(%{cli_session_id: nil, model: nil})
    assert args =~ "run"
    refute args =~ "--model"
  end

  test "build_args rejects unsafe model" do
    args = CliRunner.build_args(%{cli_session_id: nil, model: "x; rm -rf /"})
    refute args =~ "--model"
    refute args =~ "rm -rf"
  end

  test "execution mode maps plan to opencode plan agent and yolo to auto" do
    plan_args = CliRunner.build_args(%{cli_session_id: nil, model: nil, execution_mode: "plan"})
    assert plan_args =~ "--agent plan"
    refute plan_args =~ "--auto"

    build_args = CliRunner.build_args(%{cli_session_id: nil, model: nil, execution_mode: "build"})
    assert build_args =~ "--agent build"
    refute build_args =~ "--auto"

    yolo_args = CliRunner.build_args(%{cli_session_id: nil, model: nil, execution_mode: "yolo"})
    assert yolo_args =~ "--agent build"
    assert yolo_args =~ "--auto"
  end
end
