defmodule SymphonyElixir.Linear.IssueAdapter.QueryTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Linear.IssueAdapter.Query
  alias SymphonyElixir.Tracker.IssueDTO

  test "normalize_issue maps a Linear issue node into IssueDTO" do
    node = %{
      "id" => "uuid-1",
      "identifier" => "LIN-42",
      "title" => "Ship it",
      "description" => "body",
      "priority" => 2,
      "url" => "https://linear.app/x/issue/LIN-42",
      "state" => %{"name" => "In Progress", "type" => "started", "position" => 2.0},
      "assignee" => %{"displayName" => "Octo"},
      "creator" => %{"displayName" => "Cat"},
      "createdAt" => "2026-05-28T00:00:00Z",
      "updatedAt" => "2026-05-28T01:00:00Z"
    }

    dto = Query.normalize_issue(node, "demo")

    assert %IssueDTO{} = dto
    assert dto.identifier == "LIN-42"
    assert dto.status.name == "In Progress"
    assert dto.status.category == "started"
    assert dto.assignee == "Octo"
    assert dto.creator == "Cat"
  end

  test "category_for maps Linear state types" do
    assert Query.category_for("started") == "started"
    assert Query.category_for("completed") == "completed"
    assert Query.category_for("canceled") == "canceled"
    assert Query.category_for("backlog") == "backlog"
    assert Query.category_for("unstarted") == "unstarted"
    assert Query.category_for("triage") == "unstarted"
  end
end
