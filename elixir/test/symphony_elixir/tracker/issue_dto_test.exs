defmodule SymphonyElixir.Tracker.IssueDTOTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.IssueDTO

  test "build/1 carries repository, parent, and sub-issue summary" do
    dto =
      IssueDTO.build(%{
        identifier: "2",
        title: "Aplicativo IOS",
        repository_full_name: "xipcash/ios",
        parent_identifier: nil,
        sub_issue_summary: %{total: 4, completed: 4, percent_completed: 100}
      })

    assert dto.repository_full_name == "xipcash/ios"
    assert dto.parent_identifier == nil
    assert dto.sub_issue_summary == %{total: 4, completed: 4, percent_completed: 100}
  end

  test "build/1 defaults the new fields" do
    dto = IssueDTO.build(%{identifier: "9", title: "No metadata"})
    assert dto.repository_full_name == nil
    assert dto.parent_identifier == nil
    assert dto.sub_issue_summary == nil
  end
end
