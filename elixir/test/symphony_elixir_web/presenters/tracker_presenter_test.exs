defmodule SymphonyElixirWeb.TrackerPresenterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.{IssueRecord, Label}
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
        updated_at: "2026-05-28T00:00:00Z",
        sync_status: "error",
        last_sync_error: "Could not resolve assignee"
      })

    json = TrackerPresenter.issue(dto)

    assert json.identifier == "9"
    assert json.status == %{name: "In Progress", category: "started", position: 2, is_terminal: false}
    assert json.assignee_id == "octocat"
    assert json.creator == "octocat"
    assert json.project_slug == "remote"
    assert json.sync_status == "error"
    assert json.last_sync_error == "Could not resolve assignee"
  end

  test "issue/1 serializes repository, parent, and sub-issue summary" do
    dto =
      IssueDTO.build(%{
        identifier: "2",
        title: "Aplicativo IOS",
        repository_full_name: "xipcash/ios",
        parent_identifier: "1",
        sub_issue_summary: %{total: 4, completed: 4, percent_completed: 100}
      })

    payload = TrackerPresenter.issue(dto)

    assert payload.repository_full_name == "xipcash/ios"
    assert payload.parent_identifier == "1"
    assert payload.sub_issue_summary == %{total: 4, completed: 4, percent_completed: 100}
  end

  test "issue/1 derives display_identifier from a GitHub URL while keeping the canonical identifier" do
    dto =
      IssueDTO.build(%{
        identifier: "537",
        title: "Plain-number GitHub issue",
        url: "https://github.com/clouapp/front/issues/537"
      })

    payload = TrackerPresenter.issue(dto)

    assert payload.identifier == "537"
    assert payload.display_identifier == "front#537"
  end

  test "issue/1 falls back display_identifier to the canonical id for an unreconciled local issue" do
    dto = IssueDTO.build(%{identifier: "MAC-1", title: "Local draft, no remote yet"})

    payload = TrackerPresenter.issue(dto)

    assert payload.identifier == "MAC-1"
    assert payload.display_identifier == "MAC-1"
  end

  test "issue/1 for an IssueRecord shows the external key once reconciled, keeping MAC-N internal" do
    record = %IssueRecord{
      id: 42,
      identifier: "MAC-5",
      title: "Local-first issue pushed to GitHub",
      position: 0,
      url: "https://github.com/clouapp/front/issues/547",
      remote_url: "https://github.com/clouapp/front/issues/547"
    }

    payload = TrackerPresenter.issue(record)

    assert payload.identifier == "MAC-5"
    assert payload.display_identifier == "front#547"
  end

  test "issue/1 for an IssueRecord falls back agent_kind from preloaded symphony labels" do
    record = %IssueRecord{
      id: 7,
      identifier: "MAC-7",
      title: "Label-routed issue",
      position: 0,
      labels: [%Label{name: "symphony:claude"}, %Label{name: "bug"}]
    }

    payload = TrackerPresenter.issue(record)

    assert payload.agent_kind == "claude"
    assert payload.model == nil
    assert payload.effort == nil
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
    assert json.bundle_role == "standalone"
    assert json.child_identifiers == []
  end

  test "agent_execution/1 serializes parent/child bundle context" do
    execution = %{
      issue_identifier: "SYM-2",
      status: :live,
      session_id: nil,
      last_event: nil,
      last_message: nil,
      last_event_at: nil,
      turn_count: 0,
      runtime_seconds: nil,
      started_at: nil,
      retry_attempt: 0,
      error: nil,
      parent_identifier: "SYM-1",
      bundle_role: :child,
      unit_id: "be",
      repo: "macro/be",
      child_identifiers: [],
      tokens: nil
    }

    json = TrackerPresenter.agent_execution(execution)

    assert json.parent_identifier == "SYM-1"
    assert json.bundle_role == "child"
    assert json.unit_id == "be"
    assert json.repo == "macro/be"
  end
end
