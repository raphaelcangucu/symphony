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
end
