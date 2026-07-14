defmodule SymphonyElixir.Assistant.FileActivityPresenterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.FileActivityPresenter, as: P

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

  test "normalizes per-change native patches when a top-level diff is absent" do
    diff_a = "--- a/a.ex\n+++ b/a.ex\n@@\n+one\n+two"
    diff_b = "--- a/b.ex\n+++ b/b.ex\n@@\n-gone"

    item = %{
      "id" => "f4",
      "type" => "file_change",
      "status" => "completed",
      "changes" => [
        %{"path" => "a.ex", "status" => "modified", "diff" => diff_a},
        %{"path" => "b.ex", "unifiedDiff" => diff_b}
      ]
    }

    assert {:completed, tc} = P.from_event(event("item/completed", item))

    assert tc.result["paths"] == ["a.ex", "b.ex"]
    assert tc.result["additions"] == 2
    assert tc.result["deletions"] == 1

    assert tc.result["files"] == [
             %{"path" => "a.ex", "status" => "modified", "patch" => diff_a, "additions" => 2, "deletions" => 0},
             %{"path" => "b.ex", "status" => "modified", "patch" => diff_b, "additions" => 0, "deletions" => 1}
           ]

    assert tc.result["diff"] == diff_a <> "\n" <> diff_b
  end

  test "splits a top-level diff across files when changes carry paths but no native patch" do
    diff = "--- a/a.ex\n+++ b/a.ex\n@@\n+one\n--- a/b.ex\n+++ b/b.ex\n@@\n-gone\n-also gone"

    item = %{
      "id" => "f5",
      "type" => "file_change",
      "status" => "completed",
      "unifiedDiff" => diff,
      "changes" => [%{"path" => "a.ex"}, %{"path" => "b.ex"}]
    }

    assert {:completed, tc} = P.from_event(event("item/completed", item))

    assert tc.result["paths"] == ["a.ex", "b.ex"]
    assert tc.result["diff"] == diff
    assert tc.result["additions"] == 1
    assert tc.result["deletions"] == 2
    assert [file_a, file_b] = tc.result["files"]
    assert file_a["path"] == "a.ex"
    assert file_a["additions"] == 1
    assert file_b["path"] == "b.ex"
    assert file_b["deletions"] == 2
  end

  test "reports no native files when only bare paths reach the presenter" do
    item = %{
      "id" => "f6",
      "type" => "file_change",
      "status" => "completed",
      "changes" => [%{"path" => "a.ex"}, %{"path" => "b.ex"}]
    }

    assert {:completed, tc} = P.from_event(event("item/completed", item))

    assert tc.result["paths"] == ["a.ex", "b.ex"]
    assert tc.result["files"] == []
    assert tc.result["diff"] == nil
    assert tc.result["additions"] == 0
    assert tc.result["deletions"] == 0
  end
end
