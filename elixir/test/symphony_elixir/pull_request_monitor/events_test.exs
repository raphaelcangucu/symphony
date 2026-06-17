defmodule SymphonyElixir.PullRequestMonitor.EventsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.PullRequestMonitor.Events
  alias SymphonyElixir.PullRequestMonitor.MonitorState

  defp pr(overrides) do
    Map.merge(
      %{
        url: "https://github.com/o/r/pull/7",
        state: "open",
        merged: false,
        author: "codex-bot",
        head_sha: "abc",
        checks_state: nil,
        pipelines: [],
        conversation: []
      },
      overrides
    )
  end

  defp failing_pipeline do
    [
      %{
        name: "CI",
        url: "https://github.com/o/r/actions/runs/99",
        jobs: [
          %{name: "test", status: "COMPLETED", conclusion: "FAILURE", url: nil, job_id: 1}
        ]
      }
    ]
  end

  test "merged PR yields :merged unless already done" do
    assert Events.detect(pr(%{merged: true, state: "merged"}), nil) == :merged

    row = %MonitorState{last_action: "moved_to_done"}
    assert Events.detect(pr(%{merged: true, state: "merged"}), row) == :none

    awaiting = %MonitorState{last_action: "merged_awaiting_others"}
    assert Events.detect(pr(%{merged: true, state: "merged"}), awaiting) == :none
  end

  test "concluded failing checks yield {:ci_failure, fingerprint} once per fingerprint" do
    failing = pr(%{checks_state: "FAILURE", pipelines: failing_pipeline()})

    assert {:ci_failure, fp} = Events.detect(failing, nil)
    assert is_binary(fp)

    seen = %MonitorState{last_checks_fingerprint: fp}
    assert Events.detect(failing, seen) == :none
  end

  test "in-progress jobs suppress ci_failure" do
    running = [
      %{
        name: "CI",
        url: nil,
        jobs: [
          %{name: "a", status: "COMPLETED", conclusion: "FAILURE", url: nil, job_id: 1},
          %{name: "b", status: "IN_PROGRESS", conclusion: nil, url: nil, job_id: 2}
        ]
      }
    ]

    assert Events.detect(pr(%{checks_state: "FAILURE", pipelines: running}), nil) == :none
  end

  test "new non-author review yields {:review_findings, marker}; symphony headers and author excluded" do
    convo = [
      %{
        author: "codex-bot",
        body: "self note",
        kind: "comment",
        review_state: nil,
        created_at: "2026-06-10T10:00:00Z"
      },
      %{
        author: "review-bot",
        body: "## CI failure — automated fix requested\nfoo",
        kind: "comment",
        review_state: nil,
        created_at: "2026-06-10T10:05:00Z"
      },
      %{
        author: "review-bot",
        body: "Blocking: SQL injection in foo.ex",
        kind: "review",
        review_state: "CHANGES_REQUESTED",
        created_at: "2026-06-10T11:00:00Z"
      }
    ]

    assert {:review_findings, "2026-06-10T11:00:00Z"} =
             Events.detect(pr(%{conversation: convo}), nil)

    seen = %MonitorState{last_review_marker: "2026-06-10T11:00:00Z"}
    assert Events.detect(pr(%{conversation: convo}), seen) == :none
  end

  test "ci_failure fires when checks_state is nil but jobs have failed" do
    failing = pr(%{checks_state: nil, pipelines: failing_pipeline()})
    assert {:ci_failure, _fp} = Events.detect(failing, nil)
  end

  test "closed unmerged PR yields :none for CI failures" do
    failing = pr(%{state: "closed", checks_state: "FAILURE", pipelines: failing_pipeline()})
    assert Events.detect(failing, nil) == :none
  end

  test "failing_jobs/1 returns only failing jobs and checks_fingerprint/1 is nil without failures" do
    assert Events.failing_jobs(pr(%{})) == []
    assert Events.checks_fingerprint(pr(%{})) == nil

    failing = pr(%{pipelines: failing_pipeline()})
    assert [%{name: "test"}] = Events.failing_jobs(failing)
    assert is_binary(Events.checks_fingerprint(failing))
  end

  test "monitor-authored headers are excluded from review findings" do
    convo = [
      %{
        author: "symphony-bot",
        body: "## Automatic fix limit reached\nMax rework attempts hit.",
        kind: "comment",
        review_state: nil,
        created_at: "2026-06-10T12:00:00Z"
      },
      %{
        author: "symphony-bot",
        body: "## PR feedback — needs human attention\nPlease review manually.",
        kind: "comment",
        review_state: nil,
        created_at: "2026-06-10T12:05:00Z"
      }
    ]

    assert Events.detect(pr(%{conversation: convo}), nil) == :none
  end

  test "merged wins over pending review findings" do
    convo = [
      %{
        author: "x",
        body: "y",
        kind: "review",
        review_state: nil,
        created_at: "2026-06-10T11:00:00Z"
      }
    ]

    assert Events.detect(pr(%{merged: true, state: "merged", conversation: convo}), nil) == :merged
  end
end
