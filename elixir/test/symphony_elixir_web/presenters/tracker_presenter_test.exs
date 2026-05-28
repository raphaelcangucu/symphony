defmodule SymphonyElixirWeb.TrackerPresenterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixirWeb.TrackerPresenter

  test "issue/1 serializes an IssueDTO" do
    dto =
      IssueDTO.build(%{
        id: "9",
        identifier: "#9",
        title: "Remote issue",
        description: "body",
        priority: 2,
        status: %{name: "In Progress", category: "started", position: 2, is_terminal: false},
        assignee: "octocat",
        creator: "octocat",
        url: "https://github.com/o/r/issues/9",
        project_slug: "remote",
        created_at: "2026-05-28T00:00:00Z",
        updated_at: "2026-05-28T00:00:00Z"
      })

    json = TrackerPresenter.issue(dto)

    assert json.identifier == "#9"
    assert json.status == %{name: "In Progress", category: "started", position: 2, is_terminal: false}
    assert json.assignee_id == "octocat"
    assert json.creator == "octocat"
    assert json.project_slug == "remote"
  end

  test "project/1 includes tracker_kind and tracker_config" do
    project = %SymphonyElixir.LocalTracker.Project{
      id: 1, name: "P", slug: "p", description: nil,
      tracker_kind: "github", tracker_config: %{"project_id" => "PVT_1"}
    }

    json = SymphonyElixirWeb.TrackerPresenter.project(project)
    assert json.tracker_kind == "github"
    assert json.tracker_config == %{"project_id" => "PVT_1"}
  end
end
