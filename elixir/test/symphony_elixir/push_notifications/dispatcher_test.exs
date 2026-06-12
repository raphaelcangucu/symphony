defmodule SymphonyElixir.PushNotifications.DispatcherTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Evidence.Record, as: EvidenceRecord
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
end
