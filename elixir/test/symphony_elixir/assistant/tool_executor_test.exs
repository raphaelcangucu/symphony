defmodule SymphonyElixir.Assistant.ToolExecutorTest do
  use ExUnit.Case, async: false

  import Ecto.Query

  alias SymphonyElixir.Assistant.ToolExecutor
  alias SymphonyElixir.LocalTracker.{Context, WorkflowStatus}
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

    assert Enum.any?(ToolExecutor.tool_specs(), fn
             %{"name" => "list_issues", "inputSchema" => %{"type" => "object"}} -> true
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

      for tool <- ["update_issue", "move_issue", "add_comment", "dispatch_codex"] do
        spec = Enum.find(specs, &(&1["name"] == tool))
        assert get_in(spec, ["inputSchema", "properties", "identifier", "const"]) == "MAC-1"
      end

      assert required_fields(specs, "update_issue") == []
      refute "identifier" in required_fields(specs, "move_issue")
      refute "identifier" in required_fields(specs, "add_comment")
      refute "identifier" in required_fields(specs, "dispatch_codex")
      assert "status" in required_fields(specs, "move_issue")
      assert "body" in required_fields(specs, "add_comment")
      assert "instructions" in required_fields(specs, "dispatch_codex")
    end

    test "injects the bound identifier when a mutable tool omits it" do
      executor = ToolExecutor.issue_bound_codex_tool_executor("macro-markets", "MAC-1")

      assert %{
               "success" => true,
               "toolResult" => %{"tool" => "add_comment", "message" => "Added comment to MAC-1."}
             } = executor.("add_comment", %{"body" => "Clarify the issue"})

      assert {:ok, comments} = Context.list_comments("macro-markets", "MAC-1")
      assert [%{body: "Clarify the issue"}] = comments
    end

    test "rejects mutable tool calls for a different issue identifier" do
      executor = ToolExecutor.issue_bound_codex_tool_executor("macro-markets", "MAC-1")

      for {tool, arguments} <- [
            {"update_issue", %{"identifier" => "MAC-2", "title" => "Wrong issue"}},
            {"move_issue", %{"identifier" => "MAC-2", "status" => "In Progress"}},
            {"add_comment", %{"identifier" => "MAC-2", "body" => "Wrong issue"}},
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
          "local_tracker_projects"
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
