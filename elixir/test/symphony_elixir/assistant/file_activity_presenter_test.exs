defmodule SymphonyElixir.Assistant.FileActivityPresenterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.FileActivityPresenter, as: P
  alias SymphonyElixir.Assistant.TurnTimeline

  defp event(method, item) do
    %{event: :notification, payload: %{"method" => method, "params" => %{"item" => item}}}
  end

  test "ignores unrelated events" do
    assert P.from_event(%{payload: %{"method" => "item/agentMessage/delta"}}) == :ignore
    assert P.from_event(event("item/started", %{"type" => "reasoning"})) == :ignore
    assert P.from_event(%{}) == :ignore
    assert P.from_event("nope") == :ignore
  end

  test "translates a started command" do
    assert {:started, tc} =
             P.from_event(event("item/started", %{"id" => "i1", "type" => "command_execution", "command" => "mix test"}))

    assert tc.name == "shell"
    assert tc.status == "running"
    assert tc.id == "i1"
    assert tc.arguments == %{"command" => "mix test"}
  end

  test "translates a completed command with argv, output, and exit code" do
    item = %{
      "id" => "i1",
      "type" => "command_execution",
      "status" => "completed",
      "command" => ["mix", "test"],
      "aggregatedOutput" => "1 passed",
      "exitCode" => 0
    }

    assert {:completed, tc} = P.from_event(event("item/completed", item))
    assert tc.status == "complete"
    assert tc.arguments == %{"command" => "mix test"}
    assert tc.output == "1 passed"
    assert tc.result == %{"exit_code" => 0}
  end

  test "marks a failed command as error" do
    item = %{"id" => "i1", "type" => "command_execution", "status" => "failed", "command" => "false"}
    assert {:completed, tc} = P.from_event(event("item/completed", item))
    assert tc.status == "error"
  end

  test "translates a completed file change with diff counts and explicit paths" do
    diff = "--- a/lib/foo.ex\n+++ b/lib/foo.ex\n@@\n+added one\n+added two\n-removed"

    item = %{
      "id" => "f1",
      "type" => "file_change",
      "status" => "completed",
      "unifiedDiff" => diff,
      "changes" => [%{"path" => "lib/foo.ex"}]
    }

    assert {:completed, tc} = P.from_event(event("item/completed", item))
    assert tc.name == "apply_patch"
    assert tc.status == "complete"
    assert tc.result["additions"] == 2
    assert tc.result["deletions"] == 1
    assert tc.result["paths"] == ["lib/foo.ex"]
    assert tc.result["diff"] == diff
  end

  test "derives file paths from the diff when changes are absent (camelCase type)" do
    diff = "--- a/lib/a.ex\n+++ b/lib/a.ex\n@@\n+x"
    item = %{"id" => "f2", "type" => "fileChange", "status" => "completed", "diff" => diff}
    assert {:completed, tc} = P.from_event(event("item/completed", item))
    assert tc.result["paths"] == ["lib/a.ex"]
  end

  test "started file change reports file_count without a diff" do
    item = %{"id" => "f3", "type" => "file_change", "changes" => [%{"path" => "a.ex"}, %{"path" => "b.ex"}]}
    assert {:started, tc} = P.from_event(event("item/started", item))
    assert tc.status == "running"
    assert tc.arguments == %{"paths" => ["a.ex", "b.ex"], "file_count" => 2}
  end

  test "sparse command completion retains start arguments and applies real completion fields" do
    started_item = %{
      "id" => "command-sparse",
      "type" => "command_execution",
      "command" => "mix test test/example_test.exs"
    }

    completed_item = %{
      "id" => "command-sparse",
      "type" => "command_execution",
      "status" => "completed",
      "aggregatedOutput" => "1 test, 0 failures",
      "exitCode" => 0
    }

    assert {:started, started} = P.from_event(event("item/started", started_item))
    assert {:completed, completed} = P.from_event(event("item/completed", completed_item))

    {timeline, _started} = TurnTimeline.upsert_tool_call(TurnTimeline.new(), started)
    {_timeline, merged} = TurnTimeline.upsert_tool_call(timeline, completed)

    assert merged.arguments == %{"command" => "mix test test/example_test.exs"}
    assert merged.status == "complete"
    assert merged.output == "1 test, 0 failures"
    assert merged.result == %{"exit_code" => 0}
  end

  test "sparse file completion retains start paths and merges diff counts into the start result" do
    started_item = %{
      "id" => "file-sparse",
      "type" => "file_change",
      "changes" => [%{"path" => "lib/a.ex"}, %{"path" => "lib/b.ex"}]
    }

    diff = "@@\n+added"

    completed_item = %{
      "id" => "file-sparse",
      "type" => "file_change",
      "status" => "completed",
      "unifiedDiff" => diff
    }

    assert {:started, started} = P.from_event(event("item/started", started_item))
    assert {:completed, completed} = P.from_event(event("item/completed", completed_item))

    {timeline, _started} = TurnTimeline.upsert_tool_call(TurnTimeline.new(), started)
    {_timeline, merged} = TurnTimeline.upsert_tool_call(timeline, completed)

    expected_paths = ["lib/a.ex", "lib/b.ex"]
    assert merged.arguments == %{"paths" => expected_paths, "file_count" => 2}

    assert merged.result == %{
             "paths" => expected_paths,
             "diff" => diff,
             "additions" => 1,
             "deletions" => 0
           }
  end
end
