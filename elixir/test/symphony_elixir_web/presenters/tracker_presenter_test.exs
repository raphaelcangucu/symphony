defmodule SymphonyElixirWeb.TrackerPresenterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixirWeb.TrackerPresenter

  test "issue/1 serializes an IssueDTO" do
    dto =
      IssueDTO.build(%{
        id: "9",
        identifier: "9",
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

    assert json.identifier == "9"
    assert json.status == %{name: "In Progress", category: "started", position: 2, is_terminal: false}
    assert json.assignee_id == "octocat"
    assert json.creator == "octocat"
    assert json.project_slug == "remote"
  end

  test "project/1 includes tracker_kind and tracker_config" do
    project = %SymphonyElixir.LocalTracker.Project{
      id: 1,
      name: "P",
      slug: "p",
      description: nil,
      tracker_kind: "github",
      tracker_config: %{"project_id" => "PVT_1"}
    }

    json = SymphonyElixirWeb.TrackerPresenter.project(project)
    assert json.tracker_kind == "github"
    assert json.tracker_config == %{"project_id" => "PVT_1"}
  end

  test "project/1 includes warm-up readiness" do
    project = %SymphonyElixir.LocalTracker.Project{
      id: 1,
      name: "P",
      slug: "p",
      warm_up_status: "succeeded",
      last_warm_up_run_id: 7
    }

    json = SymphonyElixirWeb.TrackerPresenter.project(project)
    assert json.warm_up_status == "succeeded"
    assert json.last_warm_up_run_id == 7
  end

  test "sync_state/1 serializes a StateRecord and passes nil through" do
    state = %SymphonyElixir.Tracker.Sync.StateRecord{
      status: "error",
      last_error: ":remote_unavailable",
      last_pull_at: ~U[2026-06-10 21:00:00.000000Z],
      last_push_at: ~U[2026-06-10 21:00:00.000000Z],
      last_full_sync_at: nil
    }

    json = TrackerPresenter.sync_state(state)

    assert json.status == "error"
    assert json.last_error == ":remote_unavailable"
    assert json.last_pull_at == "2026-06-10T21:00:00Z"
    assert json.last_push_at == "2026-06-10T21:00:00Z"
    assert json.last_full_sync_at == nil

    assert TrackerPresenter.sync_state(nil) == nil
  end

  test "comment/1 exposes sync_status for local comments" do
    comment = %SymphonyElixir.LocalTracker.Comment{
      id: 1,
      issue_id: 2,
      kind: "workpad",
      body: "## Codex Workpad",
      author: "agent",
      sync_status: "pending",
      inserted_at: ~U[2026-06-10 00:00:00.000000Z],
      updated_at: ~U[2026-06-10 00:00:00.000000Z]
    }

    assert %{sync_status: "pending"} = TrackerPresenter.comment(comment)
  end

  test "comment/1 defaults sync_status for remote comment maps" do
    assert %{sync_status: "synced"} = TrackerPresenter.comment(%{id: "c1", body: "hello"})
  end

  test "agent_execution/1 serializes status, session and tokens" do
    execution = %{
      issue_identifier: "SYM-1",
      status: :live,
      session_id: "thread-turn",
      last_event: :turn_completed,
      last_message: nil,
      last_event_at: ~U[2026-05-28T00:00:00Z],
      turn_count: 3,
      runtime_seconds: 120,
      started_at: ~U[2026-05-28T00:00:00Z],
      retry_attempt: 0,
      error: nil,
      tokens: %{input: 10, output: 20, total: 30}
    }

    json = TrackerPresenter.agent_execution(execution)

    assert json.issue_identifier == "SYM-1"
    assert json.status == "live"
    assert json.session_id == "thread-turn"
    assert json.last_event == "turn_completed"
    assert json.turn_count == 3
    assert json.tokens == %{input: 10, output: 20, total: 30}
    assert json.last_event_at == "2026-05-28T00:00:00Z"
  end
end
