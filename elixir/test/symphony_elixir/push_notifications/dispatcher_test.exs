defmodule SymphonyElixir.PushNotifications.DispatcherTest do
  use ExUnit.Case, async: false

  alias Gettext
  alias SymphonyElixir.Evidence.Record, as: EvidenceRecord
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.{IssueRecord, Project, Viewer}
  alias SymphonyElixir.PushNotifications.Dispatcher
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Setting
  alias SymphonyElixirWeb.Gettext, as: GettextBackend

  setup do
    Repo.delete_all(Setting)
    on_exit(fn -> Repo.delete_all(Setting) end)
    :ok
  end

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
    assert :ok = Dispatcher.pr_monitor_attention(project, "MAC-7", {:stay, :merge_conflict})
    assert :ok = Dispatcher.pr_monitor_attention(project, "MAC-7", :move_done)
    assert :ok = Dispatcher.pr_monitor_attention(project, "MAC-7", :move_rework)
  end

  test "issue_assigned title is Portuguese when ui locale is pt-BR" do
    {:ok, _} = Settings.put("ui", "locale", "pt-BR")

    assert Gettext.dgettext(GettextBackend, "push", "Issue assigned to you") ==
             "Issue assigned to you"

    Gettext.put_locale(GettextBackend, Settings.Ui.effective_gettext_locale())

    assert Gettext.dgettext(GettextBackend, "push", "Issue assigned to you") ==
             "Tarefa associada a você"
  end

  test "issue_assigned title is English when ui locale is auto" do
    Gettext.put_locale(GettextBackend, Settings.Ui.effective_gettext_locale())
    assert Gettext.dgettext(GettextBackend, "push", "Issue assigned to you") == "Issue assigned to you"
  end

  test "issue_assigned notifies when assignee changes to the operator" do
    ensure_viewer_server()
    Viewer.put_cached(%{login: "alice", name: "Alice", avatar_url: nil})
    on_exit(fn -> Viewer.invalidate_cache() end)

    issue = %IssueRecord{
      identifier: "MAC-8",
      title: "Nova tarefa",
      assignee_id: "alice",
      assignee_remote_id: "alice",
      project: %Project{slug: "macro-markets", tracker_kind: "github"}
    }

    assert :ok = Dispatcher.issue_assigned(issue, %{assignee_id: nil, assignee_remote_id: nil})
  end

  test "issue_assigned is a no-op when assignee is unchanged" do
    issue = %IssueRecord{
      identifier: "MAC-9",
      title: "Same owner",
      assignee_id: "alice",
      assignee_remote_id: "alice",
      project: %Project{slug: "macro-markets", tracker_kind: "github"}
    }

    previous = %{assignee_id: "alice", assignee_remote_id: "alice"}
    assert :ok = Dispatcher.issue_assigned(issue, previous)
  end

  test "issue_assigned is a no-op when assignee is someone else" do
    ensure_viewer_server()
    Viewer.put_cached(%{login: "bob", name: "Bob", avatar_url: nil})
    on_exit(fn -> Viewer.invalidate_cache() end)

    issue = %IssueRecord{
      identifier: "MAC-10",
      title: "For Alice",
      assignee_id: "alice",
      assignee_remote_id: "alice",
      project: %Project{slug: "macro-markets", tracker_kind: "github"}
    }

    assert :ok = Dispatcher.issue_assigned(issue, %{assignee_id: nil, assignee_remote_id: nil})
  end

  defp ensure_viewer_server do
    unless Process.whereis(Viewer.Server) do
      {:ok, _pid} = start_supervised(Viewer.Server)
    end

    :ok
  end
end
