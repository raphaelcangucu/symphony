defmodule SymphonyElixir.Assistant.ToolExecutorTest do
  use ExUnit.Case, async: false

  import Ecto.Query

  alias SymphonyElixir.Assistant.{ProjectExploreWorkspace, ToolExecutor}
  alias SymphonyElixir.LocalTracker.{Context, Templates, WorkflowStatus}
  alias SymphonyElixir.Repo

  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    migrate_repo()
    clean_repo()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
    end)

    :ok
  end

  test "creates an issue through the project tracker adapter" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    assert {:ok, result} =
             ToolExecutor.execute("macro-markets", "create_issue", %{
               "title" => "Add assistant panel",
               "description" => "Global project assistant",
               "status" => "Todo",
               "priority" => 2
             })

    assert result.tool == "create_issue"
    assert result.message == "Created issue MAC-1: Add assistant panel"
    assert result.data.identifier == "MAC-1"
    assert result.data.title == "Add assistant panel"
  end

  test "dispatches Codex work by adding a comment and moving the issue into progress" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Fix tests", "status" => "Todo"})

    assert {:ok, result} =
             ToolExecutor.execute("macro-markets", "dispatch_codex", %{
               "identifier" => "MAC-1",
               "instructions" => "Reproduce the failing test and fix it."
             })

    assert result.tool == "dispatch_codex"
    assert result.message == "Requested Codex work on MAC-1"
    assert result.data.identifier == "MAC-1"
    assert result.data.status.name == "In Progress"

    assert {:ok, comments} = Context.list_comments("macro-markets", "MAC-1")
    assert [%{body: body, author: "assistant"}] = comments
    assert body =~ "Reproduce the failing test and fix it."
  end

  test "dispatches Codex work by forcing Codex routing on the issue" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Fix tests", "status" => "Todo", "agent" => "claude"})

    assert {:ok, result} =
             ToolExecutor.execute("macro-markets", "dispatch_codex", %{
               "identifier" => "MAC-1",
               "instructions" => "Reproduce the failing test and fix it."
             })

    assert result.data.status.name == "In Progress"

    assert {:ok, reloaded} = Context.get_issue("macro-markets", "MAC-1")
    assert Enum.map(reloaded.labels, & &1.name) == ["symphony:codex"]
  end

  test "dispatches Codex work with a persisted goal for the orchestrator" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Fix tests", "status" => "Todo"})

    assert {:ok, result} =
             ToolExecutor.execute("macro-markets", "dispatch_codex", %{
               "identifier" => "MAC-1",
               "instructions" => "Reproduce the failing test and fix it.",
               "goal" => "  Fix the regression, verify, and stop when complete.  "
             })

    assert result.tool == "dispatch_codex"
    assert result.data.identifier == "MAC-1"
    assert result.data.status.name == "In Progress"
    assert result.data.agent_goal == "Fix the regression, verify, and stop when complete."

    assert {:ok, reloaded} = Context.get_issue("macro-markets", "MAC-1")
    assert reloaded.agent_goal == "Fix the regression, verify, and stop when complete."

    assert {:ok, comments} = Context.list_comments("macro-markets", "MAC-1")
    assert [%{body: body, author: "assistant"}] = comments
    assert body =~ "Reproduce the failing test and fix it."
  end

  test "dispatches Codex work without persisting blank goal values" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Fix tests", "status" => "Todo"})

    assert {:ok, result} =
             ToolExecutor.execute("macro-markets", "dispatch_codex", %{
               "identifier" => "MAC-1",
               "instructions" => "Reproduce the failing test and fix it.",
               "goal" => " \n\t "
             })

    assert result.data.status.name == "In Progress"
    assert result.data.agent_goal == nil

    assert {:ok, reloaded} = Context.get_issue("macro-markets", "MAC-1")
    assert reloaded.agent_goal == nil
  end

  test "dispatches Codex work by clearing an existing goal when no goal is provided" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    {:ok, _issue} =
      Context.create_issue("macro-markets", %{
        "title" => "Fix tests",
        "status" => "Todo",
        "agent_goal" => "Stale long-running goal"
      })

    assert {:ok, result} =
             ToolExecutor.execute("macro-markets", "dispatch_codex", %{
               "identifier" => "MAC-1",
               "instructions" => "Reproduce the failing test and fix it."
             })

    assert result.data.status.name == "In Progress"
    assert result.data.agent_goal == nil

    assert {:ok, reloaded} = Context.get_issue("macro-markets", "MAC-1")
    assert reloaded.agent_goal == nil
  end

  test "does not add a Codex dispatch comment when the active status is unavailable" do
    {:ok, project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Fix tests", "status" => "Todo"})

    Repo.delete_all(
      from(status in WorkflowStatus,
        where: status.project_id == ^project.id and status.name == "In Progress"
      )
    )

    assert {:error, :status_not_found} =
             ToolExecutor.execute("macro-markets", "dispatch_codex", %{
               "identifier" => "MAC-1",
               "instructions" => "This should not be persisted."
             })

    assert {:ok, []} = Context.list_comments("macro-markets", "MAC-1")
  end

  describe "create_draft_issue" do
    setup do
      {:ok, project} = Context.ensure_project(%{name: "Macro", slug: "macro"})
      {:ok, _status} = seed_status(project, "Triage", "triage")
      :ok
    end

    test "creates an issue in the non-actionable draft status" do
      assert {:ok, result} =
               ToolExecutor.execute("macro", "create_draft_issue", %{
                 "title" => "Add export button",
                 "description" => "quick note"
               })

      assert result.tool == "create_draft_issue"
      assert result.data.status.name == "Triage"
      assert result.data.title == "Add export button"
    end

    test "falls back to the backlog status when the configured draft status is absent" do
      {:ok, _project} = Context.ensure_project(%{name: "Front", slug: "front"})

      assert {:ok, result} =
               ToolExecutor.execute("front", "create_draft_issue", %{
                 "title" => "Make it multitenant"
               })

      assert result.tool == "create_draft_issue"
      assert result.data.status.name == "Backlog"
      assert result.data.title == "Make it multitenant"
    end

    test "prefers a backlog category over a lower-positioned unstarted status" do
      {:ok, project} = Context.ensure_project(%{name: "Edge", slug: "edge"})

      Repo.delete_all(from(status in WorkflowStatus, where: status.project_id == ^project.id))
      {:ok, _unstarted} = seed_status(project, "Up Next", "unstarted")
      {:ok, _backlog} = seed_status(project, "Icebox", "backlog")
      {:ok, _started} = seed_status(project, "Doing", "started")

      assert {:ok, result} =
               ToolExecutor.execute("edge", "create_draft_issue", %{"title" => "Anchor chat"})

      assert result.data.status.name == "Icebox"
    end
  end

  test "fails fast for an unsupported tool" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    assert {:error, {:unsupported_tool, "delete_everything"}} =
             ToolExecutor.execute("macro-markets", "delete_everything", %{})
  end

  test "filters agent executions by issue id instead of project-local identifier alone" do
    {:ok, _first_project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, first_issue} = Context.create_issue("macro-markets", %{"title" => "First", "status" => "Todo"})

    {:ok, _second_project} = Context.ensure_project(%{name: "Magic Maps", slug: "magic-maps"})
    {:ok, second_issue} = Context.create_issue("magic-maps", %{"title" => "Second", "status" => "Todo"})

    execution = %{
      issue_id: to_string(second_issue.id),
      issue_identifier: first_issue.identifier,
      status: :live,
      session_id: "thread-turn",
      last_event: nil,
      last_message: nil,
      last_event_at: nil,
      turn_count: 1,
      runtime_seconds: 10,
      started_at: nil,
      retry_attempt: 0,
      error: nil,
      tokens: nil
    }

    assert {:ok, result} =
             ToolExecutor.execute("macro-markets", "get_agent_executions", %{}, agent_execution_list: fn -> [execution] end)

    assert result.data.agent_executions == []
  end

  test "exposes tracker actions as Codex dynamic tools and returns content items" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Existing", "status" => "Todo"})

    assert Enum.any?(ToolExecutor.combined_tool_specs(), fn
             %{"name" => "github_graphql", "inputSchema" => %{"required" => required}} -> "query" in required
             _ -> false
           end)

    assert Enum.any?(ToolExecutor.tool_specs(), fn
             %{"name" => "list_issues", "inputSchema" => %{"type" => "object"}} -> true
             _ -> false
           end)

    assert Enum.any?(ToolExecutor.tool_specs(), fn
             %{"name" => "provision_github_project"} -> true
             _ -> false
           end)

    assert Enum.any?(ToolExecutor.tool_specs(), fn
             %{"name" => "create_issue", "inputSchema" => %{"required" => required}} -> "title" in required
             _ -> false
           end)

    assert Enum.any?(ToolExecutor.tool_specs(), fn
             %{"name" => "dispatch_codex", "inputSchema" => %{"properties" => properties}} ->
               Map.has_key?(properties, "goal")

             _ ->
               false
           end)

    refute Enum.any?(ToolExecutor.tool_specs(), &(&1["name"] == "add_comment"))

    executor = ToolExecutor.codex_tool_executor("macro-markets")
    response = executor.("list_issues", %{})

    assert %{
             "success" => true,
             "contentItems" => [%{"type" => "inputText", "text" => text}],
             "toolResult" => %{"tool" => "list_issues", "data" => %{"issues" => [_issue]}}
           } = response

    assert text =~ "Found 1 issue(s)."

    assert %{"success" => false, "contentItems" => [%{"text" => error_text}]} = executor.("missing_tool", %{})
    assert error_text =~ "Unsupported assistant tool"
  end

  describe "read tools" do
    setup do
      {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
      {:ok, issue} = Context.create_issue("macro-markets", %{"title" => "Detail me", "status" => "Todo", "description" => "Body"})
      {:ok, _comment} = Context.add_comment("macro-markets", issue.identifier, "Note", %{"author" => "human"})
      {:ok, _template} = Templates.create_template(%{"name" => "Reference", "slug" => "reference", "description" => "Example board"})
      :ok
    end

    test "get_issue returns one issue without comments by default" do
      assert {:ok, result} = ToolExecutor.execute("macro-markets", "get_issue", %{"identifier" => "MAC-1"})
      assert result.tool == "get_issue"
      assert result.data.identifier == "MAC-1"
      assert result.data.title == "Detail me"
      refute Map.has_key?(result.data, :comments)
    end

    test "get_issue can include comments" do
      assert {:ok, result} =
               ToolExecutor.execute("macro-markets", "get_issue", %{
                 "identifier" => "MAC-1",
                 "include_comments" => true
               })

      assert [%{body: "Note", author: "human"}] = result.data.comments
    end

    test "get_project returns setup and statuses without listing issues" do
      assert {:ok, result} = ToolExecutor.execute("macro-markets", "get_project", %{})
      assert result.tool == "get_project"
      assert result.data.slug == "macro-markets"
      assert is_list(result.data.statuses)
      refute Map.has_key?(result.data, :issues)
    end

    test "get_template returns json by default and yaml when requested" do
      assert {:ok, json} = ToolExecutor.execute("macro-markets", "get_template", %{"slug" => "reference"})
      assert json.data.slug == "reference"

      assert {:ok, yaml} =
               ToolExecutor.execute("macro-markets", "get_template", %{"slug" => "reference", "format" => "yaml"})

      assert yaml.data.format == "yaml"
      assert yaml.data.yaml =~ "reference"
    end

    test "get_workflow returns the project's stored workflow markdown" do
      {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

      markdown = "---\ntracker:\n  active_states: [Todo]\n---\n\nRunning prompt"
      {:ok, _setup} = Context.upsert_project_setup("macro-markets", %{workflow_markdown: markdown})

      assert {:ok, result} = ToolExecutor.execute("macro-markets", "get_workflow", %{})
      assert result.data.project_slug == "macro-markets"
      assert result.data.markdown == markdown
      assert result.data.prompt == "Running prompt"
      assert result.data.config["tracker"]["active_states"] == ["Todo"]
    end

    test "get_workflow returns an empty payload when the project has no workflow markdown" do
      {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

      assert {:ok, result} = ToolExecutor.execute("macro-markets", "get_workflow", %{})
      assert result.data.project_slug == "macro-markets"
      assert result.data.markdown == ""
      assert result.data.prompt == ""
      assert result.data.config == %{}
    end

    test "read_workspace_file reads from the project explore workspace" do
      explore = ProjectExploreWorkspace.path("macro-markets")
      File.mkdir_p!(explore)
      File.write!(Path.join(explore, "notes.txt"), "line1\nline2\nline3\n")

      assert {:ok, result} =
               ToolExecutor.execute("macro-markets", "read_workspace_file", %{
                 "path" => "notes.txt",
                 "start_line" => 2,
                 "end_line" => 2
               })

      assert result.data.content == "line2"
      assert result.data.start_line == 2
      assert result.data.end_line == 2
    end

    test "read_workspace_file rejects path escape" do
      explore = ProjectExploreWorkspace.path("macro-markets")
      File.mkdir_p!(explore)

      assert {:error, :path_escape} =
               ToolExecutor.execute("macro-markets", "read_workspace_file", %{"path" => "../outside.txt"})
    end

    test "list_issues applies a default limit" do
      {:ok, _} = Context.ensure_project(%{name: "Limit Board", slug: "limit-board"})

      for n <- 1..25 do
        {:ok, _} = Context.create_issue("limit-board", %{"title" => "Issue #{n}", "status" => "Todo"})
      end

      assert {:ok, result} = ToolExecutor.execute("limit-board", "list_issues", %{})
      assert length(result.data.issues) == 20
    end
  end

  describe "combined Codex tools" do
    test "routes github_graphql to the server-side dynamic tool executor" do
      client = fn query, _variables, _opts ->
        {:ok, %{"data" => %{"viewer" => %{"login" => "tester"}}, "query" => query}}
      end

      executor = ToolExecutor.combined_codex_tool_executor("macro-markets", github_client: client)

      assert %{"success" => true, "contentItems" => [%{"text" => text}]} =
               executor.("github_graphql", %{"query" => "query { viewer { login } }"})

      assert text =~ "tester"
    end
  end

  describe "issue-bound Codex tools" do
    setup do
      {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
      {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Bound issue", "status" => "Todo"})
      {:ok, _other_issue} = Context.create_issue("macro-markets", %{"title" => "Other issue", "status" => "Todo"})

      :ok
    end

    test "exposes only existing-issue tools with schemas constrained to the bound issue" do
      specs = ToolExecutor.issue_bound_tool_specs("MAC-1")
      names = Enum.map(specs, & &1["name"])

      refute "create_issue" in names
      refute "create_draft_issue" in names
      refute "add_comment" in names
      assert "get_issue" in names
      assert "read_workspace_file" in names

      for tool <- ["update_issue", "move_issue", "dispatch_codex"] do
        spec = Enum.find(specs, &(&1["name"] == tool))
        assert get_in(spec, ["inputSchema", "properties", "identifier", "const"]) == "MAC-1"
      end

      assert required_fields(specs, "update_issue") == []
      refute "identifier" in required_fields(specs, "move_issue")
      refute "identifier" in required_fields(specs, "dispatch_codex")
      assert "status" in required_fields(specs, "move_issue")
      assert "instructions" in required_fields(specs, "dispatch_codex")
    end

    test "injects the bound identifier when a mutable tool omits it" do
      executor = ToolExecutor.issue_bound_codex_tool_executor("macro-markets", "MAC-1")

      assert %{
               "success" => true,
               "toolResult" => %{"tool" => "update_issue", "message" => "Updated issue MAC-1."}
             } = executor.("update_issue", %{"title" => "Bound issue (clarified)"})

      assert {:ok, issue} = Context.get_issue("macro-markets", "MAC-1")
      assert issue.title == "Bound issue (clarified)"
    end

    test "rejects add_comment in the issue-bound chat since chat replies are not comments" do
      executor = ToolExecutor.issue_bound_codex_tool_executor("macro-markets", "MAC-1")

      assert %{"success" => false, "contentItems" => [%{"text" => error_text}]} =
               executor.("add_comment", %{"body" => "Should not be posted"})

      assert error_text =~ "unsupported_issue_bound_tool"
    end

    test "rejects mutable tool calls for a different issue identifier" do
      executor = ToolExecutor.issue_bound_codex_tool_executor("macro-markets", "MAC-1")

      for {tool, arguments} <- [
            {"update_issue", %{"identifier" => "MAC-2", "title" => "Wrong issue"}},
            {"move_issue", %{"identifier" => "MAC-2", "status" => "In Progress"}},
            {"dispatch_codex", %{"identifier" => "MAC-2", "instructions" => "Wrong issue"}}
          ] do
        assert %{"success" => false, "contentItems" => [%{"text" => error_text}]} = executor.(tool, arguments)
        assert error_text =~ "issue_identifier_mismatch"
        assert error_text =~ "MAC-1"
        assert error_text =~ "MAC-2"
      end
    end
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- [
          "assistant_messages",
          "assistant_threads",
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_comments",
          "local_tracker_issue_labels",
          "local_tracker_issues",
          "local_tracker_labels",
          "local_tracker_workflow_statuses",
          "local_tracker_project_setups",
          "local_tracker_repositories",
          "local_tracker_projects",
          "local_tracker_workspace_template_repositories",
          "local_tracker_workspace_templates"
        ] do
      Ecto.Adapters.SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end

  defp seed_status(project, name, category) do
    next_position =
      Repo.aggregate(
        from(status in WorkflowStatus, where: status.project_id == ^project.id),
        :count,
        :id
      )

    %WorkflowStatus{}
    |> WorkflowStatus.changeset(%{
      project_id: project.id,
      name: name,
      category: category,
      position: next_position,
      is_terminal: false
    })
    |> Repo.insert()
  end

  defp required_fields(specs, tool) do
    specs
    |> Enum.find(&(&1["name"] == tool))
    |> get_in(["inputSchema", "required"])
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
