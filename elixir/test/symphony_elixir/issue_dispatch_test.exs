defmodule SymphonyElixir.IssueDispatchTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.IssueDispatch
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.IssueRecord
  alias SymphonyElixir.Repo
  alias SymphonyElixir.SessionEvents
  alias SymphonyElixir.Workspace

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

  test "resume assigns viewer and symphony label when gates are missing", %{issue: issue} do
    {:ok, _} = Context.update_issue("pref", issue.identifier, %{"labels" => []})
    {:ok, project} = Context.get_project("pref")

    unless Process.whereis(SymphonyElixir.LocalTracker.Viewer.Server) do
      {:ok, _pid} = start_supervised(SymphonyElixir.LocalTracker.Viewer.Server)
    end

    SymphonyElixir.LocalTracker.Viewer.invalidate_cache()
    SymphonyElixir.LocalTracker.Viewer.put_cached(%{login: "raphaelcangucu", name: nil, avatar_url: nil})

    assert {:ok, _result} =
             IssueDispatch.resume(project, issue.identifier, %{"instructions" => "pick up tests"})

    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert updated.assignee_id == "raphaelcangucu"
    assert Enum.any?(updated.labels, &(&1.name in ["symphony", "symphony:codex", "symphony:claude", "symphony:cursor"]))
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

  test "resume injects draft context refs into dispatch guidance", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "In Progress"})
    {:ok, context_issue} = Context.create_issue("pref", %{"title" => "Context source", "status" => "Todo"})
    {:ok, project} = Context.get_project("pref")

    assert {:ok, _result} =
             IssueDispatch.resume(project, issue.identifier, %{
               instructions: "Use the selected context",
               context_refs: [%{"type" => "issue", "id" => context_issue.identifier}]
             })

    {:ok, comments} = Context.list_comments("pref", issue.identifier)
    resume_comment = Enum.find(comments, &String.contains?(&1.body, "## Resume agent run"))

    assert resume_comment.body =~ "Use the selected context"
    assert resume_comment.body =~ "## Loaded Context"
    assert resume_comment.body =~ "### Board issue #{context_issue.identifier}"
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

  test "restart is no longer a public dispatch action", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "In Progress"})
    {:ok, project} = Context.get_project("pref")

    assert {:error, :invalid_action} = IssueDispatch.restart(project, issue.identifier, %{})
  end

  test "hard reset creates a new agent thread while preserving the workspace", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "In Progress"})
    {:ok, record} = Context.set_agent_session_id("pref", issue.identifier, "thread-123")
    assert record.agent_session_id == "thread-123"
    workspace = Workspace.path_for_issue(%{id: issue.id, identifier: issue.identifier, project_slug: "pref"})
    assert :ok = SessionEvents.append_run_failure(workspace, {:turn_failed, "old context full"})

    {:ok, project} = Context.get_project("pref")

    assert {:ok, result} = IssueDispatch.hard_reset(project, issue.identifier, %{})
    assert result.action == "hard_reset"
    assert result.message =~ issue.identifier

    assert Repo.get!(IssueRecord, record.id).agent_session_id == nil
    assert {:ok, [], 0} = SessionEvents.tail(workspace)

    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert updated.status.name == "In Progress"

    {:ok, comments} = Context.list_comments("pref", issue.identifier)
    reset_comment = Enum.find(comments, &String.contains?(&1.body, "## New agent thread"))
    assert reset_comment.body =~ "brand-new Codex thread"
    assert reset_comment.body =~ "Do not long-poll external CI"

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

  test "resume persists the operator's model/effort/mode overrides", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "In Progress"})
    {:ok, project} = Context.get_project("pref")

    assert {:ok, _result} =
             IssueDispatch.resume(project, issue.identifier, %{
               agent: "codex",
               model: "gpt-5.4",
               effort: "high",
               mode: "plan"
             })

    assert {:ok, settings} = Context.get_agent_settings("pref", issue.identifier)
    assert settings.agent_kind == "codex"
    assert settings.model == "gpt-5.4"
    assert settings.effort == "high"
    assert settings.mode == "plan"
  end

  test "resume coerces an invalid mode to the default", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "In Progress"})
    {:ok, project} = Context.get_project("pref")

    assert {:ok, _result} =
             IssueDispatch.resume(project, issue.identifier, %{agent: "codex", mode: "turbo"})

    assert {:ok, settings} = Context.get_agent_settings("pref", issue.identifier)
    assert settings.mode == "build"
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
          "local_tracker_issue_agent_settings",
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
