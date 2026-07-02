defmodule SymphonyElixir.GitHub.SyncDriverTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.GitHub.SyncDriver
  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}
  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixir.Tracker.Sync.OutboxEntry

  defmodule RateLimitedPRs do
    def resolve_repo(_project), do: {:ok, "owner/repo"}
    def for_issue(_repo, _identifier, _opts \\ []), do: {:error, {:rate_limited, %{reset_at: nil}}}
  end

  defmodule StubApi do
    def list_issue_prs(_repo, _identifier, _branch, _opts \\ []),
      do: {:ok, [%{number: 7, url: "pr7", title: "t", state: "open"}]}
  end

  defmodule StubAdapter do
    def list_issues(_project, _filters) do
      {:ok,
       [
         IssueDTO.build(%{
           id: "I_1",
           identifier: "1",
           title: "Issue one",
           status: %{name: "Todo"},
           labels: ["bug"],
           updated_at: "2026-06-01T00:00:00Z"
         })
       ]}
    end

    def list_comments(_project, "1"), do: {:ok, [%{remote_id: "IC_1", body: "hi", author: "octo", remote_updated_at: ~U[2026-06-01 00:00:00Z]}]}
    def list_comments(_project, _id), do: {:ok, []}

    def move_issue(_project, _id, %{"status" => state}), do: {:ok, IssueDTO.build(%{id: "I_1", identifier: "1", title: state, status: %{name: state}})}
    def add_comment(_project, _id, _body, _attrs), do: {:ok, %{remote_id: "IC_new"}}
    def create_issue(_project, _attrs), do: {:ok, IssueDTO.build(%{id: "I_new", identifier: "9", title: "new", status: %{name: "Todo"}})}
    def archive_issue(_project, id), do: {:ok, "PVTI_archived_" <> id}
    def restore_issue(_project, id), do: {:ok, "PVTI_restored_" <> id}
    def delete_issue(_project, id), do: {:ok, "PVTI_deleted_" <> id}

    def update_issue(_project, identifier, attrs),
      do: {:ok, IssueDTO.build(%{id: "I_" <> identifier, identifier: identifier, title: Map.get(attrs, "title", "updated"), status: %{name: "Todo"}})}

    def link_sub_issue(_project, parent_id, child_id), do: {:ok, "linked_#{parent_id}_#{child_id}"}
    def unlink_sub_issue(_project, parent_id, child_id), do: {:ok, "unlinked_#{parent_id}_#{child_id}"}
  end

  setup do
    Application.put_env(:symphony_elixir, :github_sync_adapter, StubAdapter)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :github_sync_adapter) end)
    %{project: %Project{id: 1, slug: "mm", tracker_config: %{}}}
  end

  test "pull returns light normalized issues without per-issue comments", %{project: project} do
    assert {:ok, [issue]} = SyncDriver.pull(project, [])
    assert issue.remote_id == "I_1"
    assert issue.state == "Todo"
    # The background pull is light: comments are enriched separately (active states
    # only), so a routine pull never spends a comments call per issue.
    assert issue.comments == []
    assert Enum.map(issue.labels, & &1.name) == ["bug"]
  end

  test "push of a state move calls move_issue", %{project: project} do
    entry = %OutboxEntry{entity_type: "state", operation: "move", payload: %{"identifier" => "1", "state" => "Done"}}
    assert {:ok, _remote_id} = SyncDriver.push(project, entry)
  end

  test "push of a comment create calls add_comment", %{project: project} do
    entry = %OutboxEntry{entity_type: "comment", operation: "create", payload: %{"identifier" => "1", "body" => "hello"}}
    assert {:ok, "IC_new"} = SyncDriver.push(project, entry)
  end

  defmodule NodeIdAdapter do
    # The real GitHub adapter returns the created comment under `:id` (a GraphQL
    # node id), not `:remote_id`; the driver must still link it.
    def add_comment(_project, _identifier, _body, _attrs), do: {:ok, %{id: "IC_node", kind: "evidence"}}
  end

  test "push of a comment create links the created node id when the adapter returns :id", %{project: project} do
    Application.put_env(:symphony_elixir, :github_sync_adapter, NodeIdAdapter)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :github_sync_adapter) end)

    entry = %OutboxEntry{entity_type: "comment", operation: "create", payload: %{"identifier" => "GAM-5", "body" => "## Codex Evidence"}}
    assert {:ok, "IC_node"} = SyncDriver.push(project, entry)
  end

  test "push of an issue archive calls archive_issue", %{project: project} do
    entry = %OutboxEntry{entity_type: "issue", operation: "archive", payload: %{"identifier" => "1"}}
    assert {:ok, "PVTI_archived_1"} = SyncDriver.push(project, entry)
  end

  test "push of an issue restore calls restore_issue", %{project: project} do
    entry = %OutboxEntry{entity_type: "issue", operation: "restore", payload: %{"identifier" => "1"}}
    assert {:ok, "PVTI_restored_1"} = SyncDriver.push(project, entry)
  end

  test "push of an issue update calls update_issue", %{project: project} do
    entry = %OutboxEntry{
      entity_type: "issue",
      operation: "update",
      payload: %{"identifier" => "3984", "title" => "Updated title", "label_ids" => ["bug"]}
    }

    assert {:ok, "I_3984"} = SyncDriver.push(project, entry)
  end

  test "push of an issue delete calls delete_issue", %{project: project} do
    entry = %OutboxEntry{entity_type: "issue", operation: "delete", payload: %{"identifier" => "1"}}
    assert {:ok, "PVTI_deleted_1"} = SyncDriver.push(project, entry)
  end

  test "push of a relation link_parent calls link_sub_issue", %{project: project} do
    entry = %OutboxEntry{
      entity_type: "relation",
      operation: "link_parent",
      payload: %{"parent_identifier" => "510", "child_identifier" => "MAC-12"}
    }

    assert {:ok, "linked_510_MAC-12"} = SyncDriver.push(project, entry)
  end

  test "push of a relation unlink_parent calls unlink_sub_issue", %{project: project} do
    entry = %OutboxEntry{
      entity_type: "relation",
      operation: "unlink_parent",
      payload: %{"parent_identifier" => "510", "child_identifier" => "MAC-12"}
    }

    assert {:ok, "unlinked_510_MAC-12"} = SyncDriver.push(project, entry)
  end

  test "pull_pull_requests falls back to GitHub.Api when GraphQL PR lookup is rate-limited", %{
    project: project
  } do
    Application.put_env(:symphony_elixir, :github_pr_module, RateLimitedPRs)
    Application.put_env(:symphony_elixir, :github_api_module, StubApi)

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :github_pr_module)
      Application.delete_env(:symphony_elixir, :github_api_module)
    end)

    issue = %IssueRecord{identifier: "42", branch_name: "feat/x"}

    assert {:ok, [%{number: 7, state: "open", url: "pr7"}]} =
             SyncDriver.pull_pull_requests(project, issue)
  end
end
