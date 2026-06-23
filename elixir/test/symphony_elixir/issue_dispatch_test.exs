defmodule SymphonyElixir.IssueDispatchTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.IssueDispatch
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.IssueRecord
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    previous_sync = Application.get_env(:symphony_elixir, :tracker, []) |> Keyword.get(:sync_enabled)
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)

    on_exit(fn ->
      tracker_config = Application.get_env(:symphony_elixir, :tracker, [])

      tracker_config =
        case previous_sync do
          nil -> Keyword.delete(tracker_config, :sync_enabled)
          value -> Keyword.put(tracker_config, :sync_enabled, value)
        end

      Application.put_env(:symphony_elixir, :tracker, tracker_config)
    end)

    {:ok, _project} = Context.ensure_project(%{name: "Pref", slug: "pref"})
    {:ok, issue} = Context.create_issue("pref", %{"title" => "Dispatchable", "status" => "Todo"})
    {:ok, issue} = Context.update_issue("pref", issue.identifier, %{"labels" => ["symphony"]})
    {:ok, issue: issue}
  end

  test "resume nudges the orchestrator for active issues", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "In Progress"})
    {:ok, project} = Context.get_project("pref")

    assert {:ok, result} =
             IssueDispatch.resume(project, issue.identifier, %{"instructions" => "pick up tests"})

    assert result.action == "resume"
    assert result.message =~ issue.identifier

    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert updated.status.name == "In Progress"

    {:ok, comments} = Context.list_comments("pref", issue.identifier)
    resume_comment = Enum.find(comments, &String.contains?(&1.body, "## Resume agent run"))
    assert resume_comment.body =~ "### Plan"
    assert resume_comment.body =~ "slice evidence"
  end

  test "Codex resume routes the goal natively and never caches agent_goal", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "In Progress"})
    {:ok, project} = Context.get_project("pref")

    assert {:ok, _result} =
             IssueDispatch.resume(project, issue.identifier, %{agent: "codex", goal: "Drive the native goal"})

    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert updated.agent_goal in [nil, ""]
  end

  test "non-Codex resume keeps caching agent_goal as workflow guidance", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "In Progress"})
    {:ok, project} = Context.get_project("pref")

    assert {:ok, _result} =
             IssueDispatch.resume(project, issue.identifier, %{agent: "claude", goal: "Follow the workflow"})

    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert updated.agent_goal == "Follow the workflow"
  end

  test "restart keeps active issues in place", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "In Progress"})
    {:ok, project} = Context.get_project("pref")

    assert {:ok, result} = IssueDispatch.restart(project, issue.identifier, %{})
    assert result.action == "restart"

    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert updated.status.name == "In Progress"

    {:ok, comments} = Context.list_comments("pref", issue.identifier)
    refute Enum.any?(comments, &String.contains?(&1.body, "## Restart agent run"))

    {:ok, events} = Context.list_activity_events("pref", issue.identifier)

    assert Enum.any?(events, fn event ->
             event.event_type == "agent_dispatch_requested" and
               event.metadata["action"] == "restart"
           end)
  end

  test "restart with instructions keeps a guidance comment", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "In Progress"})
    {:ok, project} = Context.get_project("pref")

    assert {:ok, _result} = IssueDispatch.restart(project, issue.identifier, %{instructions: "Use the new plan"})

    {:ok, comments} = Context.list_comments("pref", issue.identifier)
    restart_comment = Enum.find(comments, &String.contains?(&1.body, "## Restart agent run"))
    assert restart_comment.body =~ "Use the new plan"
  end

  test "hard reset clears the persisted agent session and keeps the issue dispatchable", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "In Progress"})
    {:ok, record} = Context.set_agent_session_id("pref", issue.identifier, "thread-123")
    assert record.agent_session_id == "thread-123"

    {:ok, project} = Context.get_project("pref")

    assert {:ok, result} = IssueDispatch.hard_reset(project, issue.identifier, %{})
    assert result.action == "hard_reset"
    assert result.message =~ issue.identifier

    assert Repo.get!(IssueRecord, record.id).agent_session_id == nil

    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert updated.status.name == "In Progress"

    {:ok, comments} = Context.list_comments("pref", issue.identifier)
    refute Enum.any?(comments, &String.contains?(&1.body, "## Hard reset agent run"))

    {:ok, events} = Context.list_activity_events("pref", issue.identifier)

    assert Enum.any?(events, fn event ->
             event.event_type == "agent_dispatch_requested" and
               event.metadata["action"] == "hard_reset"
           end)
  end

  test "stop pauses the run but preserves the agent session and status", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "In Progress"})
    {:ok, record} = Context.set_agent_session_id("pref", issue.identifier, "thread-keep")

    {:ok, project} = Context.get_project("pref")

    assert {:ok, result} = IssueDispatch.stop(project, issue.identifier, %{})
    assert result.action == "stop"
    assert result.message =~ issue.identifier

    # Session is intentionally kept so the issue can be resumed later.
    assert Repo.get!(IssueRecord, record.id).agent_session_id == "thread-keep"

    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert updated.status.name == "In Progress"
  end

  test "resume moves non-active issues into a dispatchable status", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "Done"})
    {:ok, project} = Context.get_project("pref")

    assert {:ok, result} = IssueDispatch.resume(project, issue.identifier, %{})
    assert result.action == "resume"

    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    refute updated.status.is_terminal
  end

  test "continue_work moves wait-state issues to in-progress and nudges dispatch", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "Human Review"})
    {:ok, project} = Context.get_project("pref")

    assert {:ok, result} =
             IssueDispatch.continue_work(project, issue.identifier, %{
               "instructions" => "Complete evidence only",
               "target_status" => "In Progress"
             })

    assert result.action == "continue_work"
    assert result.message =~ issue.identifier

    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert updated.status.name == "In Progress"

    {:ok, comments} = Context.list_comments("pref", issue.identifier)
    continue_comment = Enum.find(comments, &String.contains?(&1.body, "## Continue agent work"))
    assert continue_comment.body =~ "### Plan"
    assert continue_comment.body =~ "every plan item is `[x]`"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_comments",
          "local_tracker_issue_labels",
          "local_tracker_issues",
          "local_tracker_labels",
          "local_tracker_workflow_statuses",
          "local_tracker_project_setups",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Ecto.Adapters.SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end
end
