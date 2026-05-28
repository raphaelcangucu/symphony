defmodule SymphonyElixir.LocalTracker.ContextTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, ProjectSetup}
  alias SymphonyElixir.Repo

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
          "local_tracker_issue_labels",
          "local_tracker_labels",
          "local_tracker_comments",
          "local_tracker_issues",
          "local_tracker_workflow_statuses",
          "local_tracker_project_setups",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end
end
