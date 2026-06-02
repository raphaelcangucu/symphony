defmodule SymphonyElixir.Jira.SyncDriverTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Jira.SyncDriver
  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}
  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixir.Tracker.Sync.OutboxEntry

  defmodule StubAdapter do
    def list_issues(_project, _filters) do
      {:ok,
       [
         IssueDTO.build(%{
           id: "10001",
           identifier: "ABC-12",
           title: "t",
           status: %{name: "In Progress"},
           updated_at: "2026-06-01T00:00:00Z"
         })
       ]}
    end

    def list_comments(_project, "ABC-12") do
      {:ok, [%{remote_id: "c-1", body: "hi", author: "Bot", remote_updated_at: "2026-06-01T01:00:00Z"}]}
    end

    def move_issue(_project, _id, %{"status" => state}) do
      {:ok, IssueDTO.build(%{id: "10001", identifier: "ABC-12", title: state, status: %{name: state}})}
    end

    def add_comment(_project, _id, _body, _attrs) do
      {:ok, %{remote_id: "c-2", body: "added", author: "Bot", remote_updated_at: "2026-06-01T02:00:00Z"}}
    end

    def create_issue(_project, _payload) do
      {:ok, IssueDTO.build(%{id: "10010", identifier: "ABC-99", title: "new"})}
    end
  end

  setup do
    Application.put_env(:symphony_elixir, :jira_sync_adapter, StubAdapter)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :jira_sync_adapter) end)
    %{project: %Project{id: 1, slug: "acme", tracker_kind: "jira", tracker_config: %{"project_key" => "ABC"}}}
  end

  test "pull normalizes issues with comments", %{project: project} do
    assert {:ok, [issue]} = SyncDriver.pull(project, [])
    assert issue.remote_id == "10001"
    assert [%{remote_id: "c-1"}] = issue.comments
  end

  test "push state/move delegates to move_issue", %{project: project} do
    entry = %OutboxEntry{entity_type: "state", operation: "move", payload: %{"identifier" => "ABC-12", "state" => "Done"}}
    assert {:ok, "10001"} = SyncDriver.push(project, entry)
  end

  test "push comment/create delegates to add_comment", %{project: project} do
    entry = %OutboxEntry{entity_type: "comment", operation: "create", payload: %{"identifier" => "ABC-12", "body" => "hi"}}
    assert {:ok, "c-2"} = SyncDriver.push(project, entry)
  end

  test "push issue/create delegates to create_issue", %{project: project} do
    entry = %OutboxEntry{entity_type: "issue", operation: "create", payload: %{"title" => "new"}}
    assert {:ok, "10010"} = SyncDriver.push(project, entry)
  end

  test "push rejects unsupported entity types", %{project: project} do
    entry = %OutboxEntry{entity_type: "label", operation: "create", payload: %{}}
    assert {:error, {:unsupported_push, "label", "create"}} = SyncDriver.push(project, entry)
  end

  test "pull_pull_requests is empty (GitHub owns source control)", %{project: project} do
    assert {:ok, []} = SyncDriver.pull_pull_requests(project, %IssueRecord{identifier: "ABC-12"})
  end
end
