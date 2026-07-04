defmodule SymphonyElixir.Assistant.ExecutionBundleToolsTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias SymphonyElixir.Assistant.{ProjectBoardTools, ToolExecutor}
  alias SymphonyElixir.Codex.DynamicTool
  alias SymphonyElixir.LocalTracker.{Context, IssueAdapter, Label}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Setting
  alias SymphonyElixir.Tracker.Workpad
  alias SymphonyElixir.Workpad.ExecutionBundle

  setup do
    migrate_repo()
    clean_repo()
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    :ok
  end

  test "classify_execution_unit returns child_run for a different repo" do
    assert {:ok, result} =
             ToolExecutor.execute("macro-markets", "classify_execution_unit", %{
               "repo" => "macro-markets/backend",
               "parent_repo" => "macro-markets/frontend"
             })

    assert result.tool == "classify_execution_unit"
    assert result.data.classification == "child_run"
    assert result.data.rule == "different_repo"
  end

  test "classify_execution_unit returns workpad_task for the same repo" do
    assert {:ok, result} =
             ToolExecutor.execute("macro-markets", "classify_execution_unit", %{
               "repo" => "macro-markets/frontend",
               "parent_repo" => "macro-markets/frontend"
             })

    assert result.data.classification == "workpad_task"
    assert result.data.rule == "same_repo_inline"
  end

  test "classify_execution_unit is exposed in the project board tool specs" do
    names = Enum.map(ProjectBoardTools.tool_specs(), & &1["name"])
    assert "classify_execution_unit" in names
  end

  test "classify_execution_unit reports child_run for same-repo contract-coupled work" do
    assert {:ok, result} =
             ToolExecutor.execute("macro-markets", "classify_execution_unit", %{
               "repo" => "macro-markets/app",
               "parent_repo" => "macro-markets/app",
               "consumes" => ["api"]
             })

    assert result.data.classification == "child_run"
    assert result.data.rule == "shared_contract"
  end

  describe "create_subtask" do
    setup do
      {:ok, parent} = Context.create_issue("macro-markets", %{"title" => "Lottery wheel", "status" => "Backlog"})
      %{parent: parent}
    end

    test "auto-classifies an independent deliverable as a child_run", %{parent: parent} do
      assert {:ok, result} =
               ToolExecutor.execute("macro-markets", "create_subtask", %{
                 "parent_identifier" => parent.identifier,
                 "title" => "Backend wheel API",
                 "repo" => "macro-markets/backend",
                 "deliverable" => "pr"
               })

      assert result.tool == "create_subtask"
      assert result.data.unit_type == "child_run"
      assert result.data.parent == parent.identifier
    end

    test "auto-classifies a same-repo subtask as a workpad_task", %{parent: parent} do
      assert {:ok, result} =
               ToolExecutor.execute("macro-markets", "create_subtask", %{
                 "parent_identifier" => parent.identifier,
                 "title" => "Tweak copy",
                 "repo" => "macro-markets/app"
               })

      assert result.data.unit_type == "workpad_task"
    end

    test "maps a legacy explicit subagent_unit unit_type to child_run", %{parent: parent} do
      assert {:ok, result} =
               ToolExecutor.execute("macro-markets", "create_subtask", %{
                 "parent_identifier" => parent.identifier,
                 "title" => "Positions backend",
                 "repo" => "macro-markets/app",
                 "unit_type" => "subagent_unit"
               })

      assert result.data.unit_type == "child_run"
    end

    test "links the child under the parent and surfaces parent_identifier", %{parent: parent} do
      {:ok, result} =
        ToolExecutor.execute("macro-markets", "create_subtask", %{
          "parent_identifier" => parent.identifier,
          "title" => "Child issue",
          "repo" => "macro-markets/app"
        })

      {:ok, child} = Context.get_issue("macro-markets", result.data.subtask)
      child_dto = IssueAdapter.to_dto(child)
      assert child_dto.parent_identifier == parent.identifier
    end

    test "writes the unit into the parent's workpad execution bundle", %{parent: parent} do
      {:ok, result} =
        ToolExecutor.execute("macro-markets", "create_subtask", %{
          "parent_identifier" => parent.identifier,
          "title" => "Child issue",
          "repo" => "macro-markets/backend",
          "deliverable" => "pr"
        })

      {:ok, comments} = Context.list_comments("macro-markets", parent.identifier)
      workpad = Enum.find(comments, &Workpad.workpad?(&1.body))
      assert workpad
      {:ok, bundle} = ExecutionBundle.parse(workpad.body)
      assert Enum.any?(bundle.units, &(&1.id == result.data.subtask))
    end
  end

  describe "set_issue_parent" do
    setup do
      {:ok, a} = Context.create_issue("macro-markets", %{"title" => "Parent A", "status" => "Backlog"})
      {:ok, b} = Context.create_issue("macro-markets", %{"title" => "Child B", "status" => "Backlog"})
      {:ok, c} = Context.create_issue("macro-markets", %{"title" => "Other C", "status" => "Backlog"})
      {:ok, _relation} = Context.add_blocker("macro-markets", b.identifier, a.identifier, "sub_issue_of")
      %{a: a, b: b, c: c}
    end

    test "rejects creating a cycle", %{a: a, b: b} do
      assert {:error, {:reparent_cycle, parent}} =
               ToolExecutor.execute("macro-markets", "set_issue_parent", %{
                 "identifier" => a.identifier,
                 "parent_identifier" => b.identifier
               })

      assert parent == b.identifier
    end

    test "reparents a subtask to a new parent", %{b: b, c: c} do
      assert {:ok, result} =
               ToolExecutor.execute("macro-markets", "set_issue_parent", %{
                 "identifier" => b.identifier,
                 "parent_identifier" => c.identifier
               })

      assert result.data.parent == c.identifier

      {:ok, child} = Context.get_issue("macro-markets", b.identifier)
      assert IssueAdapter.to_dto(child).parent_identifier == c.identifier
    end

    test "detaches a subtask when parent_identifier is null", %{b: b} do
      assert {:ok, result} =
               ToolExecutor.execute("macro-markets", "set_issue_parent", %{
                 "identifier" => b.identifier,
                 "parent_identifier" => nil
               })

      assert result.data.parent == nil

      {:ok, child} = Context.get_issue("macro-markets", b.identifier)
      assert IssueAdapter.to_dto(child).parent_identifier == nil
    end
  end

  describe "bundle inspection and contracts" do
    setup do
      {:ok, parent} = Context.create_issue("macro-markets", %{"title" => "Coordinator", "status" => "Backlog"})

      workpad = """
      ## Codex Workpad

      ### Execution bundle

      ```yaml
      version: 1
      mode: bundle
      parent: macro-markets#1
      units:
        - id: frontend
          type: child_run
          repo: macro-markets/frontend
          consumes: [lottery-api]
      ```
      """

      {:ok, _comment} = Context.add_comment("macro-markets", parent.identifier, workpad, %{"author" => "assistant"})
      %{parent: parent}
    end

    test "get_execution_bundle returns the parsed units", %{parent: parent} do
      assert {:ok, result} =
               ToolExecutor.execute("macro-markets", "get_execution_bundle", %{"parent_identifier" => parent.identifier})

      assert Enum.any?(result.data.units, &(&1.id == "frontend"))
    end

    test "preview_execution_plan reports a consumer without a producer", %{parent: parent} do
      assert {:ok, result} =
               ToolExecutor.execute("macro-markets", "preview_execution_plan", %{"parent_identifier" => parent.identifier})

      assert result.data.ok == false
      assert Enum.any?(result.data.warnings, &(&1.code == :missing_contract_producer))
    end

    test "define_shared_contract adds the contract to the bundle", %{parent: parent} do
      assert {:ok, _result} =
               ToolExecutor.execute("macro-markets", "define_shared_contract", %{
                 "parent_identifier" => parent.identifier,
                 "id" => "lottery-api",
                 "owner_unit" => "backend",
                 "kind" => "graphql_mutation",
                 "consumers" => ["frontend"]
               })

      {:ok, bundle_result} =
        ToolExecutor.execute("macro-markets", "get_execution_bundle", %{"parent_identifier" => parent.identifier})

      contract = Enum.find(bundle_result.data.shared_contracts, &(&1.id == "lottery-api"))
      assert contract
      assert contract.owner_unit == "backend"
    end

    test "update_shared_contract flips a ready contract to changing on body change", %{parent: parent} do
      ToolExecutor.execute("macro-markets", "define_shared_contract", %{
        "parent_identifier" => parent.identifier,
        "id" => "lottery-api",
        "owner_unit" => "backend",
        "kind" => "graphql_mutation"
      })

      ToolExecutor.execute("macro-markets", "update_shared_contract", %{
        "parent_identifier" => parent.identifier,
        "id" => "lottery-api",
        "status" => "ready"
      })

      assert {:ok, result} =
               ToolExecutor.execute("macro-markets", "update_shared_contract", %{
                 "parent_identifier" => parent.identifier,
                 "id" => "lottery-api",
                 "body" => "type Mutation { spinWheel: Prize }"
               })

      assert result.data.status == "changing"
    end
  end

  describe "parent<->child comms tools" do
    setup do
      {:ok, parent} = Context.create_issue("macro-markets", %{"title" => "Coordinator", "status" => "Backlog"})

      workpad = """
      ## Codex Workpad

      ### Execution bundle

      ```yaml
      version: 1
      mode: bundle
      parent: macro-markets#1
      units:
        - id: backend
          type: child_run
          repo: macro-markets/backend
          produces: [lottery-api]
        - id: frontend
          type: child_run
          repo: macro-markets/frontend
          depends_on: [backend]
          consumes: [lottery-api]
      ```
      """

      {:ok, _comment} = Context.add_comment("macro-markets", parent.identifier, workpad, %{"author" => "assistant"})
      %{parent: parent}
    end

    test "query_bundle_status returns a status row per dispatchable unit", %{parent: parent} do
      assert {:ok, result} =
               ToolExecutor.execute("macro-markets", "query_bundle_status", %{
                 "parent_identifier" => parent.identifier
               })

      assert result.tool == "query_bundle_status"
      assert result.data.parent == parent.identifier

      unit_ids = Enum.map(result.data.units, & &1.unit_id)
      assert "backend" in unit_ids
      assert "frontend" in unit_ids

      frontend = Enum.find(result.data.units, &(&1.unit_id == "frontend"))
      assert frontend.status == :waiting
      assert "backend" in frontend.blocked_by
    end

    test "query_bundle_status requires a parent_identifier" do
      assert {:error, {:missing_required_field, :parent_identifier}} =
               ToolExecutor.execute("macro-markets", "query_bundle_status", %{})
    end

    test "report_unit_status writes a durable status block to the parent workpad", %{parent: parent} do
      assert {:ok, result} =
               ToolExecutor.execute("macro-markets", "report_unit_status", %{
                 "parent_identifier" => parent.identifier,
                 "unit" => "backend",
                 "phase" => "pr_open",
                 "summary" => "API published",
                 "contracts_ready" => true,
                 "pr_url" => "https://github.com/clouapp/back/pull/1"
               })

      assert result.tool == "report_unit_status"
      assert result.data.contracts_ready == true

      {:ok, comments} = Context.list_comments("macro-markets", parent.identifier)
      workpad = Enum.find(comments, &Workpad.workpad?(&1.body))
      assert workpad.body =~ "### Unit status: backend"
      assert workpad.body =~ "phase: pr_open"
      assert workpad.body =~ "contracts_ready: true"
      assert workpad.body =~ "https://github.com/clouapp/back/pull/1"
    end

    test "report_unit_status replaces a prior block for the same unit", %{parent: parent} do
      ToolExecutor.execute("macro-markets", "report_unit_status", %{
        "parent_identifier" => parent.identifier,
        "unit" => "backend",
        "phase" => "started"
      })

      ToolExecutor.execute("macro-markets", "report_unit_status", %{
        "parent_identifier" => parent.identifier,
        "unit" => "backend",
        "phase" => "done"
      })

      {:ok, comments} = Context.list_comments("macro-markets", parent.identifier)
      workpad = Enum.find(comments, &Workpad.workpad?(&1.body))

      occurrences =
        workpad.body
        |> String.split("### Unit status: backend")
        |> length()
        |> Kernel.-(1)

      assert occurrences == 1
      assert workpad.body =~ "phase: done"
      refute workpad.body =~ "phase: started"
    end

    test "report_unit_status requires unit and phase", %{parent: parent} do
      assert {:error, {:missing_required_field, :unit}} =
               ToolExecutor.execute("macro-markets", "report_unit_status", %{
                 "parent_identifier" => parent.identifier,
                 "phase" => "done"
               })

      assert {:error, {:missing_required_field, :phase}} =
               ToolExecutor.execute("macro-markets", "report_unit_status", %{
                 "parent_identifier" => parent.identifier,
                 "unit" => "backend"
               })
    end

    test "comms tools are advertised on the coding-agent surface" do
      names = Enum.map(DynamicTool.coding_agent_tool_specs(), & &1["name"])
      assert "query_bundle_status" in names
      assert "report_unit_status" in names
      assert "update_shared_contract" in names
    end
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    Repo.delete_all(Setting)

    for table <- [
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
      SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end
end
