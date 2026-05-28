defmodule SymphonyElixir.LocalTracker.IssueMapperTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Issue

  alias SymphonyElixir.LocalTracker.{
    Comment,
    IssueMapper,
    IssueRecord,
    IssueRelation,
    Label,
    WorkflowStatus
  }

  test "maps preloaded local issue records into orchestrator issue shape" do
    inserted_at = ~U[2026-05-27 00:00:00Z]
    updated_at = ~U[2026-05-27 00:01:00Z]

    record = %IssueRecord{
      id: 123,
      identifier: "MAC-1",
      title: "Build local tracker",
      description: "Local tracker work",
      priority: 1,
      branch_name: "mac-1-local-tracker",
      url: "http://localhost:4000/tracker/projects/macro-markets/issues/MAC-1",
      assignee_id: "worker-1",
      inserted_at: inserted_at,
      updated_at: updated_at,
      status: %WorkflowStatus{name: "Todo"},
      labels: [%Label{name: "symphony:codex"}, %Label{name: "Backend"}],
      comments: [
        %Comment{kind: "workpad", body: "## Workpad", author: "local", inserted_at: inserted_at}
      ],
      source_relations: [
        %IssueRelation{
          type: "blocked_by",
          target_issue: %IssueRecord{
            id: 456,
            identifier: "MAC-0",
            status: %WorkflowStatus{name: "Done"}
          }
        },
        %IssueRelation{
          type: "relates_to",
          target_issue: %IssueRecord{
            id: 789,
            identifier: "MAC-9",
            status: %WorkflowStatus{name: "Todo"}
          }
        }
      ]
    }

    assert %Issue{} = issue = IssueMapper.to_issue(record)
    assert issue.id == "123"
    assert issue.identifier == "MAC-1"
    assert issue.title == "Build local tracker"
    assert issue.description == "Local tracker work"
    assert issue.priority == 1
    assert issue.state == "Todo"
    assert issue.branch_name == "mac-1-local-tracker"
    assert issue.url == "http://localhost:4000/tracker/projects/macro-markets/issues/MAC-1"
    assert issue.assignee_id == "worker-1"
    assert issue.labels == ["symphony:codex", "backend"]
    assert issue.agent_kind == "codex"
    assert issue.assigned_to_worker == true
    assert issue.created_at == inserted_at
    assert issue.updated_at == updated_at
    assert issue.blocked_by == [%{id: "456", identifier: "MAC-0", state: "Done"}]

    assert issue.comments == [
             %{
               author: "local",
               body: "## Workpad",
               created_at: inserted_at,
               kind: "workpad",
               source: "local"
             }
           ]
  end
end
