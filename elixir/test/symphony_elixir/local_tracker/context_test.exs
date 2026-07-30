defmodule SymphonyElixir.LocalTracker.ContextTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueMapper, Label, ProjectSetup}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.LocalStore

  setup do
    migrate_repo()
    clean_repo()
    :ok
  end

  test "ensure_project creates project with default statuses idempotently" do
    assert {:ok, project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    assert {:ok, same_project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    assert same_project.id == project.id
    assert Context.list_projects() |> Enum.map(& &1.slug) == ["macro-markets"]

    statuses = Context.list_statuses(project.slug)

    assert Enum.map(statuses, & &1.name) == [
             "Backlog",
             "Todo",
             "In Progress",
             "Human Review",
             "Merging",
             "Rework",
             "Done"
           ]
  end

  test "update_project changes name and description without touching the slug" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    assert {:ok, updated} =
             Context.update_project("macro-markets", %{"name" => "Macro Markets v2", "description" => "Renamed"})

    assert updated.slug == "macro-markets"
    assert updated.name == "Macro Markets v2"
    assert updated.description == "Renamed"
  end

  test "update_project switches a local project to a github tracker config" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    config = %{"project_id" => "PVT_kwDOCpPais4BY509", "repo" => "clouapp/front", "status_field" => "Status"}

    assert {:ok, updated} =
             Context.update_project("macro-markets", %{"tracker" => %{"kind" => "github", "config" => config}})

    assert updated.tracker_kind == "github"
    assert updated.tracker_config == config
  end

  test "update_project rejects a github tracker missing required config keys" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    assert {:error, %Ecto.Changeset{} = changeset} =
             Context.update_project("macro-markets", %{"tracker" => %{"kind" => "github", "config" => %{}}})

    assert "tracker_config" in Enum.map(changeset.errors, fn {field, _} -> Atom.to_string(field) end)
  end

  test "update_project returns project_not_found for an unknown slug" do
    assert {:error, :project_not_found} = Context.update_project("nope", %{"name" => "Nope"})
  end

  test "archive_project hides project from default list and include_archived returns it" do
    {:ok, _project} = Context.ensure_project(%{"name" => "Archive Me", "slug" => "archive-me"})

    assert {:ok, archived} = Context.archive_project("archive-me")
    assert archived.archived_at
    refute Enum.any?(Context.list_projects(), &(&1.slug == "archive-me"))
    assert Enum.any?(Context.list_projects(include_archived: true), &(&1.slug == "archive-me"))
  end

  test "restore_project returns archived project to default list" do
    {:ok, _project} = Context.ensure_project(%{"name" => "Restore Me", "slug" => "restore-me"})
    {:ok, _archived} = Context.archive_project("restore-me")

    assert {:ok, restored} = Context.restore_project("restore-me")
    refute restored.archived_at
    assert Enum.any?(Context.list_projects(), &(&1.slug == "restore-me"))
  end

  test "delete_project rejects active project and deletes archived project" do
    {:ok, _project} = Context.ensure_project(%{"name" => "Delete Me", "slug" => "delete-me"})

    assert {:error, :project_not_archived} = Context.delete_project("delete-me")
    {:ok, _archived} = Context.archive_project("delete-me")
    assert {:ok, deleted} = Context.delete_project("delete-me")
    assert deleted.slug == "delete-me"
    assert {:error, :project_not_found} = Context.get_project("delete-me")
  end

  test "create_workspace_project persists repositories, custom statuses, and setup metadata" do
    assert {:ok, project} =
             Context.create_workspace_project(%{
               "name" => "Macro Markets",
               "slug" => "macro-markets",
               "description" => "Multi-repo workspace",
               "workflow_statuses" => [
                 %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false},
                 %{"name" => "Review", "category" => "wait", "position" => 1, "is_terminal" => false},
                 %{"name" => "Done", "category" => "terminal", "position" => 2, "is_terminal" => true}
               ],
               "repositories" => [
                 %{
                   "github_full_name" => "clouapp/front",
                   "clone_url" => "https://github.com/clouapp/front.git",
                   "default_branch" => "homolog",
                   "selected_branch" => "homolog",
                   "workspace_path" => "frontend",
                   "role" => "frontend",
                   "scan_summary" => %{"stack" => ["node"], "validation_commands" => ["npm test"]}
                 },
                 %{
                   "github_full_name" => "clouapp/api",
                   "clone_url" => "https://github.com/clouapp/api.git",
                   "default_branch" => "main",
                   "selected_branch" => "main",
                   "workspace_path" => "backend",
                   "role" => "backend",
                   "scan_summary" => %{"stack" => ["elixir"], "validation_commands" => ["mix test"]}
                 }
               ],
               "setup" => %{
                 "workflow_config" => %{"active_states" => ["Todo"], "terminal_states" => ["Done"]},
                 "after_create_hook" => "git clone https://github.com/clouapp/front.git frontend",
                 "prompt_template" => "Use frontend/ and backend/.",
                 "validation_commands" => ["npm test", "mix test"],
                 "scan_summary" => %{"repository_count" => 2}
               }
             })

    assert project.slug == "macro-markets"
    assert Enum.map(Context.list_statuses(project.slug), & &1.name) == ["Todo", "Review", "Done"]

    repositories =
      Repo.query!("select github_full_name, workspace_path, role from local_tracker_repositories order by workspace_path").rows

    assert repositories == [
             ["clouapp/api", "backend", "backend"],
             ["clouapp/front", "frontend", "frontend"]
           ]

    assert %ProjectSetup{validation_commands: %{"commands" => ["npm test", "mix test"]}} = Repo.one(ProjectSetup)
  end

  test "create_issue creates the next identifier and stores requested status" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    assert {:ok, first_issue} =
             Context.create_issue("macro-markets", %{
               "title" => "Build local tracker",
               "description" => "Create local project manager",
               "status" => "Todo",
               "priority" => 1
             })

    assert {:ok, second_issue} =
             Context.create_issue("macro-markets", %{
               title: "Add board",
               status: "Backlog"
             })

    assert first_issue.identifier == "MAC-1"
    assert first_issue.title == "Build local tracker"
    assert first_issue.status.name == "Todo"
    assert second_issue.identifier == "MAC-2"
    assert second_issue.status.name == "Backlog"
  end

  test "create_issue does not reuse an identifier after a task is deleted" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, first_issue} = Context.create_issue("macro-markets", %{title: "First", status: "Todo"})

    assert {:ok, _deleted} = Context.delete_issue("macro-markets", first_issue.identifier)
    assert {:ok, replacement} = Context.create_issue("macro-markets", %{title: "Replacement", status: "Todo"})

    assert first_issue.identifier == "MAC-1"
    assert replacement.identifier == "MAC-2"
  end

  test "archive_issue hides the issue from the board and restore_issue brings it back" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{title: "Archive me", status: "Todo"})

    assert {:ok, archived} = Context.archive_issue("macro-markets", "MAC-1")
    assert archived.archived_at

    assert Context.list_issues("macro-markets") |> Enum.map(& &1.identifier) == []
    assert Context.list_issues("macro-markets", include_archived: true) |> Enum.map(& &1.identifier) == ["MAC-1"]

    assert {:ok, restored} = Context.restore_issue("macro-markets", "MAC-1")
    assert is_nil(restored.archived_at)
    assert Context.list_issues("macro-markets") |> Enum.map(& &1.identifier) == ["MAC-1"]
  end

  test "delete_issue removes the issue and its children" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{title: "Delete me", status: "Todo"})
    {:ok, _comment} = Context.add_comment("macro-markets", "MAC-1", "a note")

    assert {:ok, deleted} = Context.delete_issue("macro-markets", "MAC-1")
    assert deleted.identifier == "MAC-1"

    assert {:error, :issue_not_found} = Context.get_issue("macro-markets", "MAC-1")
    assert Context.list_issues("macro-markets") == []
  end

  test "archive_issue returns issue_not_found for an unknown identifier" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    assert {:error, :issue_not_found} = Context.archive_issue("macro-markets", "MAC-404")
    assert {:error, :issue_not_found} = Context.delete_issue("macro-markets", "MAC-404")
    assert {:error, :project_not_found} = Context.archive_issue("nope", "MAC-1")
  end

  test "create_issue stores Codex goal text for dispatch" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    assert {:ok, issue} =
             Context.create_issue("macro-markets", %{
               "title" => "Goal mode",
               "status" => "Todo",
               "agent_goal" => "Ship the goal-mode path"
             })

    assert issue.agent_goal == "Ship the goal-mode path"

    assert {:ok, reloaded} = Context.get_issue("macro-markets", "MAC-1")
    assert reloaded.agent_goal == "Ship the goal-mode path"
  end

  test "create_issue stores selected agent as a routing label" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    assert {:ok, issue} =
             Context.create_issue("macro-markets", %{
               "title" => "Route to Codex",
               "status" => "Todo",
               "agent" => "codex"
             })

    assert Enum.map(issue.labels, & &1.name) == ["symphony:codex"]

    assert {:ok, reloaded} = Context.get_issue("macro-markets", "MAC-1")
    assert Enum.map(reloaded.labels, & &1.name) == ["symphony:codex"]
  end

  test "create_issue persists execution settings before issue_created broadcast" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    :ok = Phoenix.PubSub.subscribe(SymphonyElixir.PubSub, "project:macro-markets")

    assert {:ok, _issue} =
             Context.create_issue("macro-markets", %{
               title: "Pinned before notify",
               status: "Todo",
               agent: "codex",
               model: "gpt-5.5",
               effort: "high"
             })

    assert_receive {:tracker_event, "issue_created", %{issue: payload}}, 1_000
    assert payload.agent_kind == "codex"
    assert payload.model == "gpt-5.5"
    assert payload.effort == "high"
  end

  test "update_issue persists execution settings before issue_updated broadcast" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    assert {:ok, _issue} =
             Context.create_issue("macro-markets", %{title: "Later pin", status: "Todo"})

    :ok = Phoenix.PubSub.subscribe(SymphonyElixir.PubSub, "project:macro-markets")

    assert {:ok, _updated} =
             Context.update_issue("macro-markets", "MAC-1", %{
               "agent" => "claude",
               "model" => "sonnet",
               "effort" => "xhigh"
             })

    assert_receive {:tracker_event, "issue_updated", %{issue: payload}}, 1_000
    assert payload.agent_kind == "claude"
    assert payload.model == "sonnet"
    assert payload.effort == "xhigh"
  end

  test "move_issue updates the agent routing label" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{title: "Move me", status: "Todo", agent: "claude"})

    assert {:ok, issue} =
             Context.move_issue("macro-markets", "MAC-1", %{
               status: "In Progress",
               agent: "codex"
             })

    assert Enum.map(issue.labels, & &1.name) == ["symphony:codex"]
  end

  test "move_issue updates workflow status and mutable fields" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{title: "Move me", status: "Todo"})

    assert {:ok, issue} =
             Context.move_issue("macro-markets", "MAC-1", %{
               status: "In Progress",
               worker_id: "worker-1",
               branch_name: "mac-1-move-me"
             })

    assert issue.status.name == "In Progress"
    assert issue.worker_id == "worker-1"
    assert issue.branch_name == "mac-1-move-me"
    assert %DateTime{} = issue.started_at
  end

  test "set_agent_session_id persists the agent session id and surfaces it on reload" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{title: "Resume me", status: "In Progress"})

    assert {:ok, issue} =
             Context.set_agent_session_id("macro-markets", "MAC-1", "019e7191-fd28-7ec2-b53a-c4195e15147b")

    assert issue.agent_session_id == "019e7191-fd28-7ec2-b53a-c4195e15147b"

    assert {:ok, reloaded} = Context.get_issue("macro-markets", "MAC-1")
    assert reloaded.agent_session_id == "019e7191-fd28-7ec2-b53a-c4195e15147b"
  end

  test "set_agent_session_id returns an error for an unknown issue" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    assert {:error, :issue_not_found} = Context.set_agent_session_id("macro-markets", "MAC-404", "abc")
  end

  test "move_issue reorders same-column siblings before refetch" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _first_issue} = Context.create_issue("macro-markets", %{title: "First", status: "Todo"})
    {:ok, _second_issue} = Context.create_issue("macro-markets", %{title: "Second", status: "Todo"})
    {:ok, _third_issue} = Context.create_issue("macro-markets", %{title: "Third", status: "Todo"})

    assert {:ok, moved_issue} = Context.move_issue("macro-markets", "MAC-3", %{status: "Todo", position: 0})
    assert moved_issue.position == 0
    assert moved_issue.status.name == "Todo"

    todo_issues =
      "macro-markets"
      |> Context.list_issues()
      |> Enum.filter(&(&1.status.name == "Todo"))

    assert Enum.map(todo_issues, & &1.identifier) == ["MAC-3", "MAC-1", "MAC-2"]
    assert Enum.map(todo_issues, & &1.position) == [0, 1, 2]
  end

  test "move_issue inserts cross-column moves at target position before refetch" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _todo_issue} = Context.create_issue("macro-markets", %{title: "Todo issue", status: "Todo"})
    {:ok, _first_started_issue} = Context.create_issue("macro-markets", %{title: "First started", status: "In Progress"})
    {:ok, _second_started_issue} = Context.create_issue("macro-markets", %{title: "Second started", status: "In Progress"})

    assert {:ok, moved_issue} = Context.move_issue("macro-markets", "MAC-1", %{status: "In Progress", position: 0})
    assert moved_issue.position == 0
    assert moved_issue.status.name == "In Progress"

    in_progress_issues =
      "macro-markets"
      |> Context.list_issues()
      |> Enum.filter(&(&1.status.name == "In Progress"))

    assert Enum.map(in_progress_issues, & &1.identifier) == ["MAC-1", "MAC-2", "MAC-3"]
    assert Enum.map(in_progress_issues, & &1.position) == [0, 1, 2]
  end

  test "update_issue_state scopes issue identifier by project and marks terminal state completed" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{title: "Finish me", status: "Todo"})

    assert {:ok, issue} = Context.update_issue_state("macro-markets", "MAC-1", "Done")

    assert issue.status.name == "Done"
    assert %DateTime{} = issue.completed_at
  end

  test "add_comment and add_blocker persist related records" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _source} = Context.create_issue("macro-markets", %{title: "Blocked", status: "Todo"})
    {:ok, _target} = Context.create_issue("macro-markets", %{title: "Blocker", status: "Todo"})

    assert {:ok, comment} = Context.add_comment("macro-markets", "MAC-1", "Needs another issue", %{author: "codex"})
    assert comment.body == "Needs another issue"
    assert comment.author == "codex"

    assert {:ok, relation} = Context.add_blocker("macro-markets", "MAC-1", "MAC-2")
    assert relation.type == "blocked_by"
  end

  test "list_comments and list_blockers are scoped by project and issue identifier" do
    {:ok, _first_project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _second_project} = Context.ensure_project(%{name: "Macro Market Ops", slug: "macro-market-ops"})
    {:ok, _first_source} = Context.create_issue("macro-markets", %{title: "First project source", status: "Todo"})
    {:ok, _first_target} = Context.create_issue("macro-markets", %{title: "First project target", status: "Todo"})
    {:ok, _second_source} = Context.create_issue("macro-market-ops", %{title: "Second project source", status: "Todo"})
    {:ok, _second_target} = Context.create_issue("macro-market-ops", %{title: "Second project target", status: "Todo"})

    assert {:ok, _first_comment} = Context.add_comment("macro-markets", "MAC-1", "First project comment")
    assert {:ok, _second_comment} = Context.add_comment("macro-market-ops", "MAC-1", "Second project comment")
    assert {:ok, _first_relation} = Context.add_blocker("macro-markets", "MAC-1", "MAC-2")
    assert {:ok, _second_relation} = Context.add_blocker("macro-market-ops", "MAC-1", "MAC-2")

    assert {:ok, [comment]} = Context.list_comments("macro-markets", "MAC-1")
    assert comment.body == "First project comment"

    assert {:ok, [relation]} = Context.list_blockers("macro-markets", "MAC-1")
    assert relation.source_issue.identifier == "MAC-1"
    assert relation.target_issue.identifier == "MAC-2"
  end

  test "project scoped writes do not update duplicate identifiers in another project" do
    {:ok, _first_project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _second_project} = Context.ensure_project(%{name: "Macro Market Ops", slug: "macro-market-ops"})
    {:ok, _first_issue} = Context.create_issue("macro-markets", %{title: "First project", status: "Todo"})
    {:ok, _second_issue} = Context.create_issue("macro-market-ops", %{title: "Second project", status: "Todo"})

    assert {:ok, issue} = Context.update_issue_state("macro-market-ops", "MAC-1", "Done")

    assert issue.title == "Second project"
    assert issue.status.name == "Done"

    assert {:ok, first_project_issue} = Context.move_issue("macro-markets", "MAC-1", %{})
    assert first_project_issue.title == "First project"
    assert first_project_issue.status.name == "Todo"
  end

  describe "create_issue/2 with creator" do
    setup do
      {:ok, project} = Context.ensure_project(%{name: "T", slug: "creator-project"})
      {:ok, project: project}
    end

    test "persists the creator field when provided", %{project: _project} do
      assert {:ok, issue} =
               Context.create_issue("creator-project", %{
                 title: "An issue",
                 description: "with creator",
                 status: "Todo",
                 creator: "octocat"
               })

      assert issue.creator == "octocat"
    end

    test "leaves creator nil when omitted" do
      assert {:ok, issue} =
               Context.create_issue("creator-project", %{
                 title: "Issue without creator",
                 status: "Todo"
               })

      assert issue.creator == nil
    end
  end

  test "count_issues_by_project_ids returns a per-project issue count map" do
    {:ok, first_project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, second_project} = Context.ensure_project(%{name: "Macro Market Ops", slug: "macro-market-ops"})
    {:ok, empty_project} = Context.ensure_project(%{name: "Empty", slug: "empty-project"})

    {:ok, _} = Context.create_issue("macro-markets", %{title: "First", status: "Todo"})
    {:ok, _} = Context.create_issue("macro-markets", %{title: "Second", status: "Backlog"})
    {:ok, _} = Context.create_issue("macro-market-ops", %{title: "Only one", status: "Todo"})

    counts = Context.count_issues_by_project_ids([first_project.id, second_project.id, empty_project.id])

    assert counts[first_project.id] == 2
    assert counts[second_project.id] == 1
    refute Map.has_key?(counts, empty_project.id)
  end

  test "count_issues_by_project_ids returns an empty map when given no ids" do
    assert Context.count_issues_by_project_ids([]) == %{}
    assert Context.count_issues_by_project_ids([nil]) == %{}
  end

  describe "list_issues/2 filters" do
    setup do
      {:ok, project} = Context.ensure_project(%{name: "F", slug: "filter-project"})

      {:ok, _i1} =
        Context.create_issue("filter-project", %{
          title: "Add dark mode",
          description: "ui",
          status: "Todo",
          assignee_id: "alice",
          creator: "alice"
        })

      {:ok, _i2} =
        Context.create_issue("filter-project", %{
          title: "Backend fix",
          description: "API",
          status: "Todo",
          assignee_id: "bob",
          creator: "alice"
        })

      {:ok, _i3} =
        Context.create_issue("filter-project", %{
          title: "Investigate Dark patterns",
          description: nil,
          status: "Todo",
          assignee_id: nil,
          creator: "carol"
        })

      {:ok, project: project}
    end

    test "search filter matches title, description, identifier (case-insensitive)" do
      titles =
        "filter-project"
        |> Context.list_issues(search: "dark")
        |> Enum.map(& &1.title)
        |> Enum.sort()

      assert titles == ["Add dark mode", "Investigate Dark patterns"]
    end

    test "assignee filter matches the assignee_id column exactly" do
      assert ["Add dark mode"] =
               "filter-project"
               |> Context.list_issues(assignee: "alice")
               |> Enum.map(& &1.title)
    end

    test "creator filter matches the creator column exactly" do
      titles =
        "filter-project"
        |> Context.list_issues(creator: "alice")
        |> Enum.map(& &1.title)
        |> Enum.sort()

      assert titles == ["Add dark mode", "Backend fix"]
    end

    test "filters AND together" do
      assert [%{title: "Add dark mode"}] =
               Context.list_issues("filter-project", search: "dark", assignee: "alice")
    end

    test "escapes SQL wildcards in search term" do
      {:ok, _} =
        Context.create_issue("filter-project", %{
          title: "100% complete",
          status: "Todo"
        })

      assert [%{title: "100% complete"}] =
               Context.list_issues("filter-project", search: "100%")
    end
  end

  test "returns explicit not found errors" do
    assert {:error, :project_not_found} = Context.create_issue("missing", %{title: "No project"})
    assert {:error, :project_not_found} = Context.move_issue("missing", "MAC-1", %{status: "Todo"})
    assert {:error, :project_not_found} = Context.update_issue_state("missing", "MAC-1", "Done")
    assert {:error, :project_not_found} = Context.add_comment("missing", "MAC-1", "No issue")
    assert {:error, :project_not_found} = Context.add_blocker("missing", "MAC-1", "MAC-2")

    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{title: "Unknown status"})

    assert {:error, :status_not_found} = Context.update_issue_state("macro-markets", "MAC-1", "Missing")
    assert {:error, :issue_not_found} = Context.add_blocker("macro-markets", "MAC-1", "MAC-2")
  end

  test "create_workspace_project stores github tracker and skips statuses" do
    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "Remote GH",
        "slug" => "remote-gh",
        "tracker" => %{
          "kind" => "github",
          "config" => %{"repo" => "o/r", "project_id" => "PVT_1"}
        },
        "repositories" => [],
        "setup" => %{}
      })

    assert project.tracker_kind == "github"
    assert project.tracker_config["project_id"] == "PVT_1"
    assert Context.list_statuses("remote-gh") == []
  end

  test "create_issue seeds workflow statuses for a remote project with an empty mirror" do
    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Remote GH",
        "slug" => "remote-gh",
        "tracker" => %{
          "kind" => "github",
          "config" => %{"repo" => "o/r", "project_id" => "PVT_1"}
        },
        "repositories" => [],
        "setup" => %{}
      })

    assert Context.list_statuses("remote-gh") == []

    assert {:ok, issue} = Context.create_issue("remote-gh", %{title: "Local first", status: "Todo"})
    assert issue.status.name == "Todo"

    assert "Todo" in Enum.map(Context.list_statuses("remote-gh"), & &1.name)
  end

  test "create_workspace_project defaults to local tracker" do
    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "Local WS",
        "slug" => "local-ws",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [%{"github_full_name" => "o/r", "workspace_path" => "r", "role" => "service"}],
        "setup" => %{}
      })

    assert project.tracker_kind == "local"
    assert Enum.any?(Context.list_statuses("local-ws"), &(&1.name == "Todo"))
  end

  test "add_issue_label attaches a label by name and is idempotent" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{title: "Incomplete run", status: "Todo"})

    assert {:ok, _} = Context.add_issue_label("macro-markets", "MAC-1", "symphony:incomplete")
    assert {:ok, _} = Context.add_issue_label("macro-markets", "MAC-1", "symphony:incomplete")

    assert {:ok, issue} = Context.get_issue("macro-markets", "MAC-1")
    assert Enum.count(issue.labels, &(&1.name == "symphony:incomplete")) == 1
  end

  test "add_issue_label returns project_not_found for an unknown project" do
    assert {:error, :project_not_found} =
             Context.add_issue_label("missing", "MAC-1", "symphony:incomplete")
  end

  test "remove_issue_label detaches a label and is idempotent" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{title: "Blocked run", status: "Todo"})

    assert {:ok, _} = Context.add_issue_label("macro-markets", "MAC-1", "symphony:blocked")

    assert {:ok, issue} = Context.get_issue("macro-markets", "MAC-1")
    assert Enum.any?(issue.labels, &(&1.name == "symphony:blocked"))

    assert {:ok, _} = Context.remove_issue_label("macro-markets", "MAC-1", "symphony:blocked")
    assert {:ok, _} = Context.remove_issue_label("macro-markets", "MAC-1", "symphony:blocked")

    assert {:ok, issue} = Context.get_issue("macro-markets", "MAC-1")
    refute Enum.any?(issue.labels, &(&1.name == "symphony:blocked"))
  end

  test "update_issue resolves assignee_ids via cached tracker users" do
    {:ok, project} = Context.ensure_project(%{name: "Assignee Edit", slug: "assignee-edit"})
    {:ok, _issue} = Context.create_issue("assignee-edit", %{title: "Assign me", status: "Todo"})

    :ok =
      LocalStore.upsert_users(project, [
        %{id: "U1", login: "alice", name: "Alice"}
      ])

    assert {:ok, updated} =
             Context.update_issue("assignee-edit", "ASS-1", %{"assignee_ids" => ["U1"]})

    assert updated.assignee_id == "alice"

    assert {:ok, cleared} = Context.update_issue("assignee-edit", "ASS-1", %{"assignee_ids" => []})
    assert cleared.assignee_id == nil
  end

  test "update_issue accepts priority changes" do
    {:ok, _project} = Context.ensure_project(%{name: "Priority Edit", slug: "priority-edit"})
    {:ok, _issue} = Context.create_issue("priority-edit", %{title: "Priority", status: "Todo"})

    assert {:ok, updated} =
             Context.update_issue("priority-edit", "PRI-1", %{"priority" => 2})

    assert updated.priority == 2
  end

  test "update_issue resolves remote label ids to stored names" do
    {:ok, project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    %Label{}
    |> Label.changeset(%{
      project_id: project.id,
      name: "bug",
      remote_id: "LA_kwDOJHngx88AAAACmEYycw"
    })
    |> Repo.insert!()

    {:ok, _issue} = Context.create_issue("macro-markets", %{title: "Label id", status: "Todo"})

    assert {:ok, updated} =
             Context.update_issue("macro-markets", "MAC-1", %{
               "label_ids" => ["LA_kwDOJHngx88AAAACmEYycw"]
             })

    label_names = Enum.map(updated.labels, & &1.name)
    assert "bug" in label_names
    refute "LA_kwDOJHngx88AAAACmEYycw" in label_names
  end

  test "update_issue replaces all labels with the provided set, including symphony labels" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{title: "Label edit", status: "Todo"})

    assert {:ok, _} = Context.add_issue_label("macro-markets", "MAC-1", "symphony:codex")
    assert {:ok, _} = Context.add_issue_label("macro-markets", "MAC-1", "old-label")

    assert {:ok, updated} =
             Context.update_issue("macro-markets", "MAC-1", %{
               "label_ids" => ["bug", "frontend"]
             })

    label_names = Enum.map(updated.labels, & &1.name)
    assert "bug" in label_names
    assert "frontend" in label_names
    refute "symphony:codex" in label_names
    refute "old-label" in label_names
  end

  test "update_issue can remove a symphony label while keeping the remaining labels" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{title: "Symphony labels", status: "Todo"})

    assert {:ok, _} = Context.add_issue_label("macro-markets", "MAC-1", "symphony")
    assert {:ok, _} = Context.add_issue_label("macro-markets", "MAC-1", "symphony:codex")
    assert {:ok, _} = Context.add_issue_label("macro-markets", "MAC-1", "symphony:incomplete")

    assert {:ok, updated} =
             Context.update_issue("macro-markets", "MAC-1", %{
               "label_ids" => ["symphony", "symphony:codex"]
             })

    label_names = Enum.map(updated.labels, & &1.name)
    assert "symphony" in label_names
    assert "symphony:codex" in label_names
    refute "symphony:incomplete" in label_names

    assert {:ok, reloaded} = Context.get_issue("macro-markets", "MAC-1")
    reloaded_names = Enum.map(reloaded.labels, & &1.name)
    assert "symphony" in reloaded_names
    assert "symphony:codex" in reloaded_names
    refute "symphony:incomplete" in reloaded_names
  end

  test "update_issue keeps the agent routing label when the agent attr is provided" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{title: "Routing", status: "Todo"})

    assert {:ok, _} = Context.add_issue_label("macro-markets", "MAC-1", "old-label")

    assert {:ok, updated} =
             Context.update_issue("macro-markets", "MAC-1", %{
               "label_ids" => ["bug"],
               "agent" => "codex"
             })

    label_names = Enum.map(updated.labels, & &1.name)
    assert "bug" in label_names
    assert "symphony:codex" in label_names
    refute "old-label" in label_names
  end

  test "update_issue clears all labels when label_ids is empty" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{title: "Clear labels", status: "Todo"})

    assert {:ok, _} = Context.add_issue_label("macro-markets", "MAC-1", "bug")
    assert {:ok, _} = Context.add_issue_label("macro-markets", "MAC-1", "frontend")

    assert {:ok, updated} =
             Context.update_issue("macro-markets", "MAC-1", %{
               "label_ids" => []
             })

    assert Enum.map(updated.labels, & &1.name) == []
  end

  test "set_issue_parent records a sub_issue_of relation surfaced as parent_identifier" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Parent", status: "Todo"})
    {:ok, _child} = Context.create_issue("macro-markets", %{title: "Child", status: "Backlog"})

    assert {:ok, child} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")
    assert IssueMapper.to_issue(child).parent_identifier == "MAC-1"
    assert {:ok, ["MAC-2"]} = Context.list_subtask_children("macro-markets", "MAC-1")
  end

  test "set_issue_parent replaces an existing parent" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _p1} = Context.create_issue("macro-markets", %{title: "P1", status: "Todo"})
    {:ok, _p2} = Context.create_issue("macro-markets", %{title: "P2", status: "Todo"})
    {:ok, _child} = Context.create_issue("macro-markets", %{title: "Child", status: "Todo"})

    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-3", "MAC-1")
    assert {:ok, child} = Context.set_issue_parent("macro-markets", "MAC-3", "MAC-2")

    assert IssueMapper.to_issue(child).parent_identifier == "MAC-2"
    assert {:ok, ["MAC-3"]} = Context.list_subtask_children("macro-markets", "MAC-2")
    assert {:ok, []} = Context.list_subtask_children("macro-markets", "MAC-1")
  end

  test "set_issue_parent rejects self-parenting and cycles" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Parent", status: "Todo"})
    {:ok, _child} = Context.create_issue("macro-markets", %{title: "Child", status: "Todo"})

    assert {:error, :cannot_parent_self} = Context.set_issue_parent("macro-markets", "MAC-1", "MAC-1")
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")
    assert {:error, :parent_cycle} = Context.set_issue_parent("macro-markets", "MAC-1", "MAC-2")
  end

  test "clear_issue_parent removes the parent relation idempotently" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Parent", status: "Todo"})
    {:ok, _child} = Context.create_issue("macro-markets", %{title: "Child", status: "Todo"})
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")

    assert {:ok, child} = Context.clear_issue_parent("macro-markets", "MAC-2")
    assert IssueMapper.to_issue(child).parent_identifier == nil
    assert {:ok, []} = Context.list_subtask_children("macro-markets", "MAC-1")

    assert {:ok, _} = Context.clear_issue_parent("macro-markets", "MAC-2")
  end

  test "move_issue records an issue_moved activity event for a parent and every sub-issue" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Parent", status: "Todo"})
    {:ok, _c1} = Context.create_issue("macro-markets", %{title: "C1", status: "Todo"})
    {:ok, _c2} = Context.create_issue("macro-markets", %{title: "C2", status: "Todo"})
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-3", "MAC-1")

    assert {:ok, _parent} = Context.move_issue("macro-markets", "MAC-1", %{status: "In Progress"})

    for identifier <- ["MAC-1", "MAC-2", "MAC-3"] do
      assert {:ok, events} = Context.list_activity_events("macro-markets", identifier)

      assert Enum.any?(events, &(&1.event_type == "issue_moved")),
             "expected an issue_moved event for #{identifier}"
    end
  end

  test "move_issue drags a parent's sub-issues to the parent's new status" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Parent", status: "Todo"})
    {:ok, _c1} = Context.create_issue("macro-markets", %{title: "C1", status: "Backlog"})
    {:ok, _c2} = Context.create_issue("macro-markets", %{title: "C2", status: "Backlog"})
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-3", "MAC-1")

    assert {:ok, parent} = Context.move_issue("macro-markets", "MAC-1", %{status: "In Progress"})
    assert parent.status.name == "In Progress"

    assert {:ok, c1} = Context.get_issue("macro-markets", "MAC-2")
    assert {:ok, c2} = Context.get_issue("macro-markets", "MAC-3")
    assert c1.status.name == "In Progress"
    assert c2.status.name == "In Progress"
  end

  test "move_issue drags a coordinator parent's bundle-unit children along (board precedence)" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Coordinator", status: "Todo"})
    {:ok, _c1} = Context.create_issue("macro-markets", %{title: "C1", status: "Backlog"})
    {:ok, _c2} = Context.create_issue("macro-markets", %{title: "C2", status: "Backlog"})
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-3", "MAC-1")

    bundle_workpad = """
    ## Codex Workpad

    ### Execution bundle

    ```yaml
    version: 1
    mode: bundle
    parent: MAC-1
    units:
      - id: unit-c1
        type: child_run
        issue: MAC-2
        repo: macro-markets/app
        deliverable: pr
      - id: unit-c2
        type: child_run
        issue: MAC-3
        repo: macro-markets/app
        depends_on: [unit-c1]
        deliverable: pr
    ```
    """

    {:ok, _workpad} = Context.add_comment("macro-markets", "MAC-1", bundle_workpad, %{kind: "workpad"})

    assert {:ok, parent} = Context.move_issue("macro-markets", "MAC-1", %{status: "In Progress"})
    assert parent.status.name == "In Progress"

    # Board precedence still applies for children behind the parent's target
    # (Backlog → In Progress). Wait/terminal/ahead children are not dragged.
    assert {:ok, c1} = Context.get_issue("macro-markets", "MAC-2")
    assert {:ok, c2} = Context.get_issue("macro-markets", "MAC-3")
    assert c1.status.name == "In Progress"
    assert c2.status.name == "In Progress"
  end

  test "move_issue does not drag a Human Review sub-issue when the parent moves to In Progress" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Parent", status: "Todo"})
    {:ok, _released} = Context.create_issue("macro-markets", %{title: "Released", status: "Todo"})
    {:ok, _active} = Context.create_issue("macro-markets", %{title: "Active", status: "Backlog"})
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-3", "MAC-1")

    {:ok, _} = Context.move_issue("macro-markets", "MAC-2", %{status: "Human Review"})

    assert {:ok, _parent} = Context.move_issue("macro-markets", "MAC-1", %{status: "In Progress"})

    assert {:ok, released} = Context.get_issue("macro-markets", "MAC-2")
    assert {:ok, active} = Context.get_issue("macro-markets", "MAC-3")
    assert released.status.name == "Human Review"
    assert active.status.name == "In Progress"

    assert {:ok, released_events} = Context.list_activity_events("macro-markets", "MAC-2")
    refute Enum.any?(released_events, &(&1.event_type == "issue_moved" and &1.metadata["status"] == "In Progress"))
  end

  test "move_issue does not drag a Done sub-issue when the parent moves to In Progress" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Parent", status: "Todo"})
    {:ok, _done} = Context.create_issue("macro-markets", %{title: "Done child", status: "Todo"})
    {:ok, _active} = Context.create_issue("macro-markets", %{title: "Active", status: "Backlog"})
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-3", "MAC-1")

    {:ok, _} = Context.move_issue("macro-markets", "MAC-2", %{status: "Done"})

    assert {:ok, _parent} = Context.move_issue("macro-markets", "MAC-1", %{status: "In Progress"})

    assert {:ok, done_child} = Context.get_issue("macro-markets", "MAC-2")
    assert {:ok, active} = Context.get_issue("macro-markets", "MAC-3")
    assert done_child.status.name == "Done"
    assert active.status.name == "In Progress"
  end

  test "move_issue on a sub-issue leaves its parent and siblings in place" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Parent", status: "Todo"})
    {:ok, _c1} = Context.create_issue("macro-markets", %{title: "C1", status: "Todo"})
    {:ok, _c2} = Context.create_issue("macro-markets", %{title: "C2", status: "Todo"})
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-3", "MAC-1")

    assert {:ok, moved} = Context.move_issue("macro-markets", "MAC-2", %{status: "In Progress"})
    assert moved.identifier == "MAC-2"
    assert moved.status.name == "In Progress"

    assert {:ok, parent} = Context.get_issue("macro-markets", "MAC-1")
    assert {:ok, sibling} = Context.get_issue("macro-markets", "MAC-3")
    assert parent.status.name == "Todo"
    assert sibling.status.name == "Todo"
  end

  test "move_issue skips a sub-issue already in the parent's target status" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Parent", status: "Todo"})
    {:ok, _c1} = Context.create_issue("macro-markets", %{title: "C1", status: "Backlog"})
    {:ok, _c2} = Context.create_issue("macro-markets", %{title: "C2", status: "In Progress"})
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-3", "MAC-1")

    assert {:ok, _parent} = Context.move_issue("macro-markets", "MAC-1", %{status: "In Progress"})

    assert {:ok, c1_events} = Context.list_activity_events("macro-markets", "MAC-2")
    assert Enum.any?(c1_events, &(&1.event_type == "issue_moved"))

    assert {:ok, c2_events} = Context.list_activity_events("macro-markets", "MAC-3")
    refute Enum.any?(c2_events, &(&1.event_type == "issue_moved"))
  end

  test "move_issue rolls a parent up to its child's new status" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Parent", status: "Todo"})
    {:ok, _child} = Context.create_issue("macro-markets", %{title: "Child", status: "Todo"})
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")

    assert {:ok, _moved} = Context.move_issue("macro-markets", "MAC-2", %{status: "In Progress"})

    assert {:ok, parent} = Context.get_issue("macro-markets", "MAC-1")
    assert parent.status.name == "In Progress"
  end

  test "move_issue holds a parent at its least-advanced child" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Parent", status: "Todo"})
    {:ok, _c1} = Context.create_issue("macro-markets", %{title: "C1", status: "Todo"})
    {:ok, _c2} = Context.create_issue("macro-markets", %{title: "C2", status: "Todo"})
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-3", "MAC-1")

    {:ok, _} = Context.move_issue("macro-markets", "MAC-2", %{status: "Human Review"})
    {:ok, _} = Context.move_issue("macro-markets", "MAC-3", %{status: "In Progress"})

    # One child in review and another still in progress -> the parent stays at the
    # least-advanced status (In Progress).
    assert {:ok, parent} = Context.get_issue("macro-markets", "MAC-1")
    assert parent.status.name == "In Progress"
  end

  test "move_issue rolls a parent to Done only once every child is Done" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Parent", status: "Todo"})
    {:ok, _c1} = Context.create_issue("macro-markets", %{title: "C1", status: "Todo"})
    {:ok, _c2} = Context.create_issue("macro-markets", %{title: "C2", status: "Todo"})
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-3", "MAC-1")

    {:ok, _} = Context.move_issue("macro-markets", "MAC-2", %{status: "Done"})

    assert {:ok, parent} = Context.get_issue("macro-markets", "MAC-1")
    assert parent.status.name == "Todo"

    {:ok, _} = Context.move_issue("macro-markets", "MAC-3", %{status: "Done"})

    assert {:ok, parent} = Context.get_issue("macro-markets", "MAC-1")
    assert parent.status.name == "Done"
  end

  test "update_issue_state rolls the parent up to follow an agent move" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Parent", status: "Todo"})
    {:ok, _child} = Context.create_issue("macro-markets", %{title: "Child", status: "Todo"})
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")

    assert {:ok, _child} = Context.update_issue_state("macro-markets", "MAC-2", "In Progress")

    assert {:ok, parent} = Context.get_issue("macro-markets", "MAC-1")
    assert parent.status.name == "In Progress"
  end

  test "reconcile_parent_statuses recomputes parents from out-of-sync children" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Parent", status: "Todo"})
    {:ok, _child} = Context.create_issue("macro-markets", %{title: "Child", status: "In Progress"})
    # Attaching an already-advanced child leaves the parent out of sync (attach
    # does not roll up); reconcile is what a remote pull uses to repair it.
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")

    assert {:ok, parent_before} = Context.get_issue("macro-markets", "MAC-1")
    assert parent_before.status.name == "Todo"

    assert {:ok, changed} = Context.reconcile_parent_statuses("macro-markets")
    assert {"MAC-1", "In Progress"} in changed

    assert {:ok, parent} = Context.get_issue("macro-markets", "MAC-1")
    assert parent.status.name == "In Progress"
  end

  test "parent_issue returns the parent issue or nil" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Parent", status: "Todo"})
    {:ok, _child} = Context.create_issue("macro-markets", %{title: "Child", status: "Todo"})
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")

    assert {:ok, %{identifier: "MAC-1"}} = Context.parent_issue("macro-markets", "MAC-2")
    assert {:ok, nil} = Context.parent_issue("macro-markets", "MAC-1")
  end

  test "move_issue sends a single human review push for the moved issue" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    {:ok, _setup} =
      Context.upsert_project_setup("macro-markets", %{
        workflow_markdown: """
        ---
        tracker:
          wait_states:
            - Human Review
        ---

        Prompt.
        """,
        validation_commands: [],
        scan_summary: %{}
      })

    {:ok, _issue} = Context.create_issue("macro-markets", %{title: "Solo", status: "Todo"})

    trace_push_dispatch_calls()

    task = Task.async(fn -> Context.move_issue("macro-markets", "MAC-1", %{status: "Human Review"}) end)

    assert {:ok, moved} = Task.await(task)
    assert moved.identifier == "MAC-1"

    assert_receive {:trace, _pid, :call, {SymphonyElixir.PushNotifications.Dispatcher, :notify, ["human_review", %{tag: "human_review:macro-markets:MAC-1"}]}}

    refute_receive {:trace, _pid, :call, {SymphonyElixir.PushNotifications.Dispatcher, :notify, ["human_review", _payload]}}
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

  defp trace_push_dispatch_calls do
    test_pid = self()
    :erlang.trace(:all, true, [:call, {:tracer, test_pid}])
    :erlang.trace_pattern({SymphonyElixir.PushNotifications.Dispatcher, :notify, 2}, true, [:local])

    on_exit(fn ->
      :erlang.trace(:all, false, [:call])
      :erlang.trace_pattern({SymphonyElixir.PushNotifications.Dispatcher, :notify, 2}, false, [:local])
    end)
  end
end
