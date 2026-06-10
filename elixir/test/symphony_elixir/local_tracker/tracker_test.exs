defmodule SymphonyElixir.LocalTracker.TrackerTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.LocalTracker.{
    Context,
    IssueLabel,
    Label,
    Tracker,
    Viewer
  }

  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()

    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "local",
      local_database_path: Path.join(System.tmp_dir!(), "local-tracker-test.sqlite3"),
      local_project_slug: "macro-markets",
      local_api_token_env: "LOCAL_TRACKER_TEST_TOKEN",
      tracker_active_states: ["Todo", "In Progress"],
      tracker_terminal_states: ["Done"]
    )

    :ok
  end

  test "config detects local tracker and exposes local settings" do
    assert Config.tracker_kind() == "local"
    assert Config.local_project_slug() == "macro-markets"
    assert Config.local_database_path() =~ "local-tracker-test.sqlite3"
    assert Config.local_api_token_env() == "LOCAL_TRACKER_TEST_TOKEN"
    assert SymphonyElixir.Tracker.adapter() == Tracker
  end

  test "fetch_candidate_issues returns active issues for the configured project" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _other_project} = Context.ensure_project(%{name: "Macro Ops", slug: "macro-ops"})
    {:ok, ready} = Context.create_issue("macro-markets", %{title: "Ready work", status: "Todo"})
    {:ok, _running} = Context.create_issue("macro-markets", %{title: "Running work", status: "In Progress"})
    {:ok, _done} = Context.create_issue("macro-markets", %{title: "Done work", status: "Done"})
    {:ok, _other} = Context.create_issue("macro-ops", %{title: "Other project", status: "Todo"})
    add_label!(ready, "symphony:codex")

    assert {:ok, issues} = Tracker.fetch_candidate_issues()

    assert Enum.map(issues, & &1.identifier) == ["MAC-1", "MAC-2"]
    assert Enum.map(issues, & &1.state) == ["Todo", "In Progress"]
    assert Enum.find(issues, &(&1.identifier == "MAC-1")).labels == ["symphony:codex"]
  end

  test "fetch_issues_by_states and fetch_issue_states_by_ids stay scoped to configured project" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _other_project} = Context.ensure_project(%{name: "Macro Ops", slug: "macro-ops"})
    {:ok, _local_issue} = Context.create_issue("macro-markets", %{title: "Local project", status: "Todo"})
    {:ok, _other_issue} = Context.create_issue("macro-ops", %{title: "Duplicate identifier", status: "Done"})

    assert {:ok, [todo_issue]} = Tracker.fetch_issues_by_states(["Todo"])
    assert todo_issue.identifier == "MAC-1"
    assert todo_issue.state == "Todo"

    assert {:ok, [state_issue]} = Tracker.fetch_issue_states_by_ids(["MAC-1"])
    assert state_issue.identifier == "MAC-1"
    assert state_issue.state == "Todo"
  end

  test "create_comment and update_issue_state write to configured project only" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _other_project} = Context.ensure_project(%{name: "Macro Ops", slug: "macro-ops"})
    {:ok, local_issue} = Context.create_issue("macro-markets", %{title: "Local project", status: "Todo"})
    {:ok, _other_issue} = Context.create_issue("macro-ops", %{title: "Duplicate identifier", status: "Todo"})

    assert :ok = Tracker.create_comment(to_string(local_issue.id), "Local tracker comment")
    assert :ok = Tracker.update_issue_state(to_string(local_issue.id), "Done")

    assert {:ok, [local_issue]} = Tracker.fetch_issue_states_by_ids(["MAC-1"])
    assert local_issue.state == "Done"
    assert [%{body: "Local tracker comment"}] = local_issue.comments

    assert {:ok, [other_issue]} =
             SymphonyElixir.LocalTracker.Context
             |> fetch_issue_from_project("macro-ops", ["MAC-1"])

    assert other_issue.state == "Todo"
    assert other_issue.comments == []
  end

  test "mapped blockers make local todo issues non-dispatchable until blocker is terminal" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, blocker} = Context.create_issue("macro-markets", %{title: "Blocking work", status: "In Progress"})
    {:ok, blocked} = Context.create_issue("macro-markets", %{title: "Blocked work", status: "Todo"})
    add_label!(blocked, "symphony:codex")
    {:ok, _relation} = Context.add_blocker("macro-markets", blocked.identifier, blocker.identifier)

    assert {:ok, issues} = Tracker.fetch_candidate_issues()
    blocked_issue = Enum.find(issues, &(&1.identifier == blocked.identifier))

    refute Orchestrator.should_dispatch_issue_for_test(blocked_issue, empty_orchestrator_state())

    assert :ok = Tracker.update_issue_state(blocker.identifier, "Done")
    assert {:ok, refreshed_issues} = Tracker.fetch_candidate_issues()
    refreshed_blocked_issue = Enum.find(refreshed_issues, &(&1.identifier == blocked.identifier))

    assert Orchestrator.should_dispatch_issue_for_test(refreshed_blocked_issue, empty_orchestrator_state())
  end

  test "mapped blockers make local rework issues non-dispatchable until blocker is terminal" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, blocker} = Context.create_issue("macro-markets", %{title: "Blocking rework", status: "In Progress"})
    {:ok, blocked} = Context.create_issue("macro-markets", %{title: "Blocked rework", status: "Rework"})
    add_label!(blocked, "symphony:codex")
    {:ok, _relation} = Context.add_blocker("macro-markets", blocked.identifier, blocker.identifier)

    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "local",
      local_project_slug: "macro-markets",
      tracker_active_states: ["Todo", "In Progress", "Rework"],
      tracker_terminal_states: ["Done"]
    )

    assert {:ok, issues} = Tracker.fetch_candidate_issues()
    blocked_issue = Enum.find(issues, &(&1.identifier == blocked.identifier))

    refute Orchestrator.should_dispatch_issue_for_test(blocked_issue, empty_orchestrator_state())

    assert :ok = Tracker.update_issue_state(blocker.identifier, "Done")
    assert {:ok, refreshed_issues} = Tracker.fetch_candidate_issues()
    refreshed_blocked_issue = Enum.find(refreshed_issues, &(&1.identifier == blocked.identifier))

    assert Orchestrator.should_dispatch_issue_for_test(refreshed_blocked_issue, empty_orchestrator_state())
  end

  describe "fetch_candidate_issues/0 with local.assignee" do
    setup do
      unless Process.whereis(Viewer.Server) do
        {:ok, _pid} = start_supervised(Viewer.Server)
      end

      Viewer.invalidate_cache()

      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "local",
        local_database_path: Path.join(System.tmp_dir!(), "local-tracker-test.sqlite3"),
        local_project_slug: "assignee-filter",
        local_assignee: "me",
        tracker_active_states: ["Todo"],
        tracker_terminal_states: ["Done"]
      )

      {:ok, _project} = Context.ensure_project(%{name: "AF", slug: "assignee-filter"})

      {:ok, _} =
        Context.create_issue("assignee-filter", %{
          title: "Mine",
          status: "Todo",
          assignee_id: "octocat"
        })

      {:ok, _} =
        Context.create_issue("assignee-filter", %{
          title: "Theirs",
          status: "Todo",
          assignee_id: "another"
        })

      on_exit(fn -> Viewer.invalidate_cache() end)

      :ok
    end

    test "returns only the viewer's issues when assignee=me" do
      Viewer.put_cached(%{login: "octocat", name: nil, avatar_url: nil})

      assert {:ok, issues} = Tracker.fetch_candidate_issues()
      assert Enum.map(issues, & &1.title) == ["Mine"]
    end

    test "returns empty list and logs warning when viewer unavailable" do
      System.delete_env("GITHUB_TOKEN")
      Viewer.invalidate_cache()

      log =
        capture_log(fn ->
          assert {:ok, []} = Tracker.fetch_candidate_issues()
        end)

      assert log =~ "viewer_unavailable_for_local_assignee_filter"
    end
  end

  defp fetch_issue_from_project(_context_module, project_slug, identifiers) do
    previous_slug = Config.local_project_slug()

    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "local",
      local_project_slug: project_slug,
      tracker_active_states: ["Todo", "In Progress", "Done"],
      tracker_terminal_states: ["Done"]
    )

    result = Tracker.fetch_issue_states_by_ids(identifiers)

    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "local",
      local_project_slug: previous_slug,
      tracker_active_states: ["Todo", "In Progress"],
      tracker_terminal_states: ["Done"]
    )

    result
  end

  defp empty_orchestrator_state do
    struct!(Orchestrator.State, running: %{}, claimed: MapSet.new(), max_concurrent_agents: 10)
  end

  defp add_label!(issue, name) do
    {:ok, label} =
      %Label{}
      |> Label.changeset(%{project_id: issue.project_id, name: name})
      |> Repo.insert()

    %IssueLabel{}
    |> IssueLabel.changeset(%{issue_id: issue.id, label_id: label.id})
    |> Repo.insert!()
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
