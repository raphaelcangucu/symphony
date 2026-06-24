defmodule SymphonyElixir.GitHub.IssueAdapter.QueryTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.IssueAdapter.Query
  alias SymphonyElixir.Tracker.IssueDTO

  test "normalize_item maps a projectV2 item into IssueDTO" do
    item = %{
      "id" => "PVTI_1",
      "content" => %{
        "__typename" => "Issue",
        "id" => "I_1",
        "number" => 42,
        "title" => "Fix bug",
        "body" => "details",
        "url" => "https://github.com/o/r/issues/42",
        "assignees" => %{"nodes" => [%{"login" => "octocat"}]},
        "labels" => %{"nodes" => [%{"name" => "bug"}]},
        "createdAt" => "2026-05-28T00:00:00Z",
        "updatedAt" => "2026-05-28T01:00:00Z"
      },
      "fieldValues" => %{
        "nodes" => [
          %{
            "__typename" => "ProjectV2ItemFieldSingleSelectValue",
            "name" => "In Progress",
            "field" => %{"name" => "Symphony State"}
          }
        ]
      }
    }

    dto = Query.normalize_item(item, "Symphony State", "demo")

    assert %IssueDTO{} = dto
    assert dto.identifier == "42"
    assert dto.title == "Fix bug"
    assert dto.assignee == "octocat"
    assert dto.labels == ["bug"]
    assert dto.status.name == "In Progress"
    assert dto.project_slug == "demo"
  end

  test "normalize_item maps repository, parent, and sub-issue summary" do
    item = %{
      "content" => %{
        "__typename" => "Issue",
        "id" => "I_1",
        "number" => 2,
        "title" => "Aplicativo IOS",
        "body" => "",
        "url" => "https://github.com/xipcash/ios/issues/2",
        "repository" => %{"nameWithOwner" => "xipcash/ios"},
        "parent" => nil,
        "subIssuesSummary" => %{"total" => 4, "completed" => 4, "percentCompleted" => 100}
      },
      "fieldValues" => %{"nodes" => []}
    }

    dto = Query.normalize_item(item, "Status", "xipcash")

    assert dto.repository_full_name == "xipcash/ios"
    assert dto.parent_identifier == nil
    assert dto.sub_issue_summary == %{total: 4, completed: 4, percent_completed: 100}
  end

  test "normalize_item maps a parent issue number into parent_identifier" do
    item = %{
      "content" => %{
        "__typename" => "Issue",
        "id" => "I_2",
        "number" => 77,
        "title" => "Landing wheel",
        "body" => "",
        "url" => "https://github.com/xipcash/frontend/issues/77",
        "repository" => %{"nameWithOwner" => "xipcash/frontend"},
        "parent" => %{"number" => 2, "repository" => %{"nameWithOwner" => "xipcash/ios"}},
        "subIssuesSummary" => %{"total" => 0, "completed" => 0, "percentCompleted" => 0}
      },
      "fieldValues" => %{"nodes" => []}
    }

    dto = Query.normalize_item(item, "Status", "xipcash")

    assert dto.parent_identifier == "2"
    assert dto.sub_issue_summary == nil
  end

  test "normalize_item skips non-issue content" do
    item = %{"id" => "PVTI_2", "content" => %{"__typename" => "DraftIssue"}, "fieldValues" => %{"nodes" => []}}
    assert Query.normalize_item(item, "Symphony State", "demo") == nil
  end

  test "category_for maps known names" do
    assert Query.category_for("In Progress") == "started"
    assert Query.category_for("Done") == "completed"
    assert Query.category_for("Cancelled") == "canceled"
    assert Query.category_for("Backlog") == "backlog"
    assert Query.category_for("Whatever") == "unstarted"
  end
end
