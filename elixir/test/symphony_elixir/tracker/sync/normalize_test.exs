defmodule SymphonyElixir.Tracker.Sync.NormalizeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixir.Tracker.Sync.Normalize

  test "maps an IssueDTO into the local-store shape" do
    dto =
      IssueDTO.build(%{
        id: "I_kwDO1",
        identifier: "507",
        title: "Title",
        description: "Body",
        priority: 2,
        position: 3,
        status: %{name: "Human Review", category: "review", position: nil, is_terminal: false},
        labels: ["bug", "p1"],
        assignee: "octocat",
        creator: "octocat",
        url: "https://github.com/o/r/issues/507",
        updated_at: "2026-06-01T12:00:00Z"
      })

    norm = Normalize.issue(dto, comments: [%{remote_id: "IC_1", body: "hi", author: "octo", remote_updated_at: ~U[2026-06-01 12:00:00Z]}])

    assert norm.remote_id == "I_kwDO1"
    assert norm.identifier == "507"
    assert norm.remote_number == 507
    assert norm.state == "Human Review"
    assert norm.assignee_id == "octocat"
    assert norm.remote_url == "https://github.com/o/r/issues/507"
    assert %DateTime{} = norm.remote_updated_at
    assert Enum.map(norm.labels, & &1.name) == ["bug", "p1"]
    assert Enum.map(norm.comments, & &1.remote_id) == ["IC_1"]
  end

  test "tolerates a missing updated_at by using now" do
    dto = IssueDTO.build(%{id: "I_2", identifier: "1", title: "t", status: %{name: "Todo"}})
    norm = Normalize.issue(dto, [])
    assert %DateTime{} = norm.remote_updated_at
  end

  test "keeps the GitHub issue number from a repo-scoped identifier" do
    dto =
      IssueDTO.build(%{
        id: "I_5",
        identifier: "ios#5",
        title: "PoC BLE",
        status: %{name: "Todo"}
      })

    norm = Normalize.issue(dto, [])

    assert norm.identifier == "ios#5"
    assert norm.remote_number == 5
  end

  test "preserves GitHub parent and sub-issue metadata for local grouping" do
    dto =
      IssueDTO.build(%{
        id: "I_child",
        identifier: "ios#3",
        title: "Child",
        status: %{name: "Done"},
        repository_full_name: "xipcash/ios",
        parent_identifier: "ios#2",
        sub_issue_summary: %{total: 4, completed: 4, percent_completed: 100}
      })

    norm = Normalize.issue(dto, [])

    assert norm.repository_full_name == "xipcash/ios"
    assert norm.parent_identifier == "ios#2"
    assert norm.sub_issue_summary == %{total: 4, completed: 4, percent_completed: 100}
  end

  test "maps GitHub-shaped comments (id/updated_at/kind) into the local-store shape" do
    dto = IssueDTO.build(%{id: "I_3", identifier: "510", title: "t", status: %{name: "Human Review"}})

    github_comments = [
      %{
        id: "IC_workpad",
        body: "## Codex Workpad\n\nProgress notes",
        author: "symphony-bot",
        kind: "workpad",
        url: "https://github.com/o/r/issues/510#issuecomment-1",
        created_at: "2026-06-01T10:00:00Z",
        updated_at: "2026-06-02T12:00:00Z"
      },
      %{
        id: "IC_reply",
        body: "looks good",
        author: "octocat",
        kind: "comment",
        url: nil,
        created_at: "2026-06-02T13:00:00Z",
        updated_at: "2026-06-02T13:00:00Z"
      }
    ]

    norm = Normalize.issue(dto, comments: github_comments)

    assert Enum.map(norm.comments, & &1.remote_id) == ["IC_workpad", "IC_reply"]
    assert Enum.map(norm.comments, & &1.kind) == ["workpad", "comment"]
    assert Enum.all?(norm.comments, &match?(%DateTime{}, &1.remote_updated_at))
  end

  test "defaults comment kind to comment when absent" do
    dto = IssueDTO.build(%{id: "I_4", identifier: "1", title: "t", status: %{name: "Todo"}})

    norm = Normalize.issue(dto, comments: [%{id: "IC_1", body: "hi", author: "octo"}])

    assert [%{kind: "comment", remote_id: "IC_1"}] = norm.comments
  end
end
