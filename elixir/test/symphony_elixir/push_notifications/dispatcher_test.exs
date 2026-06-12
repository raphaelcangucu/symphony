defmodule SymphonyElixir.PushNotifications.DispatcherTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Evidence.Record, as: EvidenceRecord
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}
  alias SymphonyElixir.PushNotifications.Dispatcher

  test "human_review_needed ignores non-wait states" do
    issue = %IssueRecord{
      identifier: "MAC-1",
      title: "Example",
      project: %Project{slug: "macro-markets"}
    }

    assert :ok = Dispatcher.human_review_needed(issue, "In Progress")
  end

  test "human_review_needed accepts Human Review by default" do
    issue = %IssueRecord{
      identifier: "MAC-2",
      title: "Review me",
      project: %Project{slug: "macro-markets"}
    }

    assert :ok = Dispatcher.human_review_needed(issue, "Human Review")
  end

  test "evidence_generated builds payload for persisted record" do
    issue = %{project_slug: "macro-markets", identifier: "MAC-3"}

    record = %EvidenceRecord{
      run_id: "run-1",
      manifest: %{"runs" => [%{"status" => "passed"}, %{"status" => "failed"}]}
    }

    assert :ok = Dispatcher.evidence_generated(issue, record)
  end

  test "agent_retry_scheduled accepts retry metadata" do
    assert :ok =
             Dispatcher.agent_retry_scheduled(%{
               identifier: "MAC-4",
               project_slug: "macro-markets",
               attempt: 2,
               error: "agent exited: :normal"
             })
  end

  test "agent_run_incomplete accepts issue and reason" do
    issue = %Issue{identifier: "MAC-5", project_slug: "macro-markets", title: "Incomplete task"}

    assert :ok = Dispatcher.agent_run_incomplete(issue, :max_turns)
  end

  test "agent_run_blocked accepts issue and violations" do
    issue = %Issue{identifier: "MAC-6", project_slug: "macro-markets", title: "Blocked task"}

    assert :ok = Dispatcher.agent_run_blocked(issue, [:missing_pr])
  end

  test "pr_monitor_attention handles human-attention actions only" do
    project = %Project{slug: "macro-markets"}

    assert :ok = Dispatcher.pr_monitor_attention(project, "MAC-7", {:stay, :limit_reached})
    assert :ok = Dispatcher.pr_monitor_attention(project, "MAC-7", {:stay, :needs_human})
    assert :ok = Dispatcher.pr_monitor_attention(project, "MAC-7", {:stay, :unrelated})
    assert :ok = Dispatcher.pr_monitor_attention(project, "MAC-7", :move_done)
    assert :ok = Dispatcher.pr_monitor_attention(project, "MAC-7", :move_rework)
  end
end
