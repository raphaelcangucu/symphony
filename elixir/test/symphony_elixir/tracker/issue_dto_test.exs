defmodule SymphonyElixir.Tracker.IssueDTOTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.IssueDTO

  test "build/1 fills defaults and keeps provided values" do
    dto =
      IssueDTO.build(%{
        id: "1",
        identifier: "#42",
        title: "Hello",
        status: %{name: "In Progress", category: "started", position: 2, is_terminal: false},
        project_slug: "demo"
      })

    assert dto.identifier == "42"
    assert dto.title == "Hello"
    assert dto.status.name == "In Progress"
    assert dto.labels == []
    assert dto.blocked_by == []
    assert dto.priority == nil
    assert dto.position == nil
  end

  test "build/1 defaults and keeps group fields" do
    assert IssueDTO.build(%{identifier: "MAC-1", title: "T"}).group_member_identifiers == []
    assert IssueDTO.build(%{identifier: "MAC-1", title: "T"}).group_lead_identifier == nil

    dto = IssueDTO.build(%{identifier: "MAC-2", title: "T", group_lead_identifier: "MAC-1"})
    assert dto.group_lead_identifier == "MAC-1"
  end
end
