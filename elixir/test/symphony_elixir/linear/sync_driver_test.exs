defmodule SymphonyElixir.Linear.SyncDriverTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Linear.SyncDriver
  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}
  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixir.Tracker.Sync.OutboxEntry

  defmodule StubAdapter do
    def list_issues(_project, _filters) do
      {:ok, [IssueDTO.build(%{id: "LIN_1", identifier: "MM-12", title: "t", status: %{name: "Todo"}, updated_at: "2026-06-01T00:00:00Z"})]}
    end

    def move_issue(_project, _id, %{"status" => state}), do: {:ok, IssueDTO.build(%{id: "LIN_1", identifier: "MM-12", title: state, status: %{name: state}})}
  end

  setup do
    Application.put_env(:symphony_elixir, :linear_sync_adapter, StubAdapter)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :linear_sync_adapter) end)
    %{project: %Project{id: 1, slug: "mm", tracker_config: %{}}}
  end

  test "pull normalizes issues with no comments", %{project: project} do
    assert {:ok, [issue]} = SyncDriver.pull(project, [])
    assert issue.remote_id == "LIN_1"
    assert issue.comments == []
  end

  test "pull_pull_requests is empty (GitHub owns source control)", %{project: project} do
    assert {:ok, []} = SyncDriver.pull_pull_requests(project, %IssueRecord{identifier: "MM-12"})
  end

  test "push state move delegates to move_issue", %{project: project} do
    entry = %OutboxEntry{entity_type: "state", operation: "move", payload: %{"identifier" => "MM-12", "state" => "Done"}}
    assert {:ok, "LIN_1"} = SyncDriver.push(project, entry)
  end
end
