defmodule SymphonyElixir.Assistant.AuthoringGoalControlTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{AuthoringGoalControl, History, Thread}
  alias SymphonyElixir.Codex.Session, as: CodexStore
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow

  @fake_codex_app_server Path.expand("../../support/fixtures/fake_codex_app_server.py", __DIR__)

  setup do
    migrate_repo()
    clean_repo()

    tmp_dir = Path.join(System.tmp_dir!(), "symphony-authoring-goal-#{System.unique_integer([:positive])}")
    File.rm_rf!(tmp_dir)
    File.mkdir_p!(tmp_dir)

    workflow_file = Path.join(tmp_dir, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: tmp_dir)
    enable_codex_goals!(workflow_file)
    Workflow.set_workflow_file_path(workflow_file)

    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    workspace = Path.join(tmp_dir, "MAC-1")
    File.mkdir_p!(workspace)

    {:ok, thread} =
      History.ensure_issue_thread("macro-markets", "MAC-1", %{
        workspace_path: workspace,
        agent_kind: "codex"
      })

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      File.rm_rf!(tmp_dir)
    end)

    {:ok, thread: thread, workflow_file: workflow_file}
  end

  test "status reports a metadata-only goal when no native Codex goal exists yet", %{thread: thread} do
    {:ok, %Thread{} = enabled} = History.set_goal_mode(thread, true, "Audit the admin UI")

    assert {:ok, payload, _thread} = AuthoringGoalControl.status(enabled)
    assert payload.enabled == true
    assert payload.objective == "Audit the admin UI"
    assert payload.native == false
    assert payload.goal == nil
  end

  test "clear disables the flag and drops the objective", %{thread: thread} do
    {:ok, enabled} = History.set_goal_mode(thread, true, "Audit")

    assert {:ok, payload, updated} = AuthoringGoalControl.clear(enabled)
    assert payload.enabled == false
    assert payload.objective == nil
    assert History.thread_goal_mode(updated) == false
    assert History.thread_goal_objective(updated) == nil
  end

  test "set_objective persists the objective and keeps the goal enabled", %{thread: thread} do
    assert {:ok, payload, updated} = AuthoringGoalControl.set_objective(thread, "  Finish the spec  ")
    assert payload.enabled == true
    assert payload.objective == "Finish the spec"
    assert History.thread_goal_mode(updated) == true
    assert History.thread_goal_objective(updated) == "Finish the spec"
  end

  test "set_objective rejects a blank objective", %{thread: thread} do
    assert {:error, :empty_objective} = AuthoringGoalControl.set_objective(thread, "   ")
  end

  test "set_objective_metadata validates activation before returning metadata status", %{thread: thread} do
    assert {:ok, payload, updated} = AuthoringGoalControl.set_objective_metadata(thread, "  Finish the spec  ")
    assert payload.enabled == true
    assert payload.objective == "Finish the spec"
    # The immediate payload truthfully reports that native synchronization is pending.
    assert payload.native == false
    assert payload.goal == nil
    assert History.thread_goal_mode(updated) == true
    assert History.thread_goal_objective(updated) == "Finish the spec"
  end

  test "set_objective_metadata rejects a blank objective", %{thread: thread} do
    assert {:error, :empty_objective} = AuthoringGoalControl.set_objective_metadata(thread, "   ")
  end

  test "set_objective_metadata cannot bypass workspace preflight", %{thread: thread} do
    missing = %{thread | workspace_path: Path.join(thread.workspace_path, "missing"), agent_kind: "codex"}

    assert {:error, {:authoring_goal_unavailable, :workspace_not_executable}} =
             AuthoringGoalControl.set_objective_metadata(missing, "Must not persist")

    {:ok, unchanged} = History.get_thread(thread.id)
    refute History.thread_goal_mode(unchanged)
  end

  test "sync_native_objective is a no-op (metadata payload) without a native Codex thread", %{thread: thread} do
    {:ok, enabled} = History.set_goal_mode(thread, true, "Audit the admin UI")

    assert {:ok, payload, _thread} = AuthoringGoalControl.sync_native_objective(enabled)
    assert payload.enabled == true
    assert payload.objective == "Audit the admin UI"
    assert payload.native == false
    assert payload.goal == nil
  end

  test "payload_from_native_update shapes a live Codex goal for the UI", %{thread: thread} do
    {:ok, enabled} = History.set_goal_mode(thread, true, "Audit the admin UI")

    payload =
      AuthoringGoalControl.payload_from_native_update(enabled, %{
        "objective" => "Audit the admin UI",
        "status" => "active",
        "timeUsedSeconds" => 90,
        "tokensUsed" => 12_000,
        "tokenBudget" => 50_000
      })

    assert payload.enabled == true
    assert payload.native == true
    assert payload.goal.status == "running"
    assert payload.goal.timeUsedSeconds == 90
    assert payload.goal.tokensUsed == 12_000
    assert payload.goal.tokenBudget == 50_000
  end

  test "clear never removes the execution goal from a shared workspace", %{
    thread: thread
  } do
    workspace = thread.workspace_path
    assert is_binary(workspace)

    :ok =
      CodexStore.put_goal(workspace, %{
        "objective" => "Stale authoring objective",
        "status" => "active"
      })

    assert {:ok, %{"objective" => "Stale authoring objective"}} = CodexStore.read_goal(workspace)

    assert {:ok, payload, _updated} = AuthoringGoalControl.clear(thread)
    assert payload.enabled == false
    assert {:ok, %{"objective" => "Stale authoring objective"}} = CodexStore.read_goal(workspace)
  end

  test "clear preserves metadata when Claude storage cannot be cleared", %{thread: thread} do
    Application.put_env(:symphony_elixir, :claude_goal_supported_override, true)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :claude_goal_supported_override) end)

    claude_thread = %{thread | agent_kind: "claude"}
    {:ok, enabled} = History.set_goal_mode(claude_thread, true, "Audit")
    sidecar = SymphonyElixir.Claude.GoalStore.path(thread.workspace_path, :authoring, thread.id)
    File.mkdir_p!(sidecar)

    assert {:error, {:goal_store_read_failed, :eisdir}} =
             AuthoringGoalControl.clear(enabled)

    {:ok, unchanged} = History.get_thread(thread.id)
    assert History.thread_goal_mode(unchanged)
    assert History.thread_goal_objective(unchanged) == "Audit"
  end

  test "authoring metadata is supported for every persistent thread scope", %{thread: issue_thread} do
    scopes = ["project", "project_session", "project_explore", "freeform", "issue", "issue_session", "kb"]

    Enum.each(scopes, fn scope ->
      thread =
        if scope == "issue" do
          File.mkdir_p!(issue_thread.workspace_path)
          %{issue_thread | agent_kind: "codex"}
        else
          attrs = %{
            scope: scope,
            status: "active",
            workspace_path: Path.join(issue_thread.workspace_path, scope),
            agent_kind: "codex",
            project_slug: if(scope == "freeform", do: nil, else: issue_thread.project_slug),
            issue_identifier: if(scope == "issue_session", do: "MAC-1", else: nil)
          }

          File.mkdir_p!(attrs.workspace_path)
          {:ok, created} = %Thread{} |> Thread.changeset(attrs) |> Repo.insert()
          created
        end

      assert {:ok, payload, updated} =
               AuthoringGoalControl.set_objective(thread, "Objective for #{scope}")

      assert payload.enabled
      assert History.thread_goal_objective(updated) == "Objective for #{scope}"
    end)
  end

  test "pause requires a native Codex goal", %{thread: thread} do
    {:ok, enabled} = History.set_goal_mode(thread, true, "Audit")
    assert {:error, :no_codex_thread} = AuthoringGoalControl.pause(enabled)
  end

  test "activation fails clearly when the persisted workspace is not executable", %{thread: thread} do
    missing = %{thread | workspace_path: Path.join(thread.workspace_path, "missing"), agent_kind: "codex"}

    assert {:error, {:authoring_goal_unavailable, :workspace_not_executable}} =
             AuthoringGoalControl.set_objective(missing, "Audit")
  end

  test "activation rejects providers without native goal support", %{thread: thread} do
    File.mkdir_p!(thread.workspace_path)
    unsupported = %{thread | agent_kind: "cursor"}

    assert {:error, {:authoring_goal_unavailable, {:unsupported_agent, "cursor"}}} =
             AuthoringGoalControl.set_objective(unsupported, "Audit")
  end

  test "activation rejects a thread without a persisted provider", %{thread: thread} do
    providerless = %{thread | agent_kind: nil, agent_thread_ids: %{}, codex_thread_id: nil}

    assert {:error, {:authoring_goal_unavailable, {:unsupported_agent, "unknown"}}} =
             AuthoringGoalControl.set_objective(providerless, "Audit")
  end

  test "activation rejects a Claude version without native goal support", %{thread: thread} do
    Application.put_env(:symphony_elixir, :claude_goal_supported_override, false)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :claude_goal_supported_override) end)

    assert {:error, {:authoring_goal_unavailable, :claude_goal_unsupported_version}} =
             AuthoringGoalControl.set_objective(%{thread | agent_kind: "claude"}, "Audit")
  end

  test "Codex activation fails preflight without goals_enabled and does not persist metadata", %{
    thread: thread,
    workflow_file: workflow_file
  } do
    File.write!(workflow_file, String.replace(File.read!(workflow_file), "goals_enabled: true", "goals_enabled: false"))

    assert {:error, {:authoring_goal_unavailable, :codex_goals_disabled}} =
             AuthoringGoalControl.set_objective(thread, "Must remain inactive")

    assert {:ok, unchanged} = History.get_thread(thread.id)
    refute History.thread_goal_mode(unchanged)
    assert History.thread_goal_objective(unchanged) == nil
  end

  test "Codex activation uses the exact thread project's workspace root", %{thread: thread} do
    custom_root =
      Path.join(System.tmp_dir!(), "thread-8003-workspaces-#{System.unique_integer([:positive])}")

    workspace = Path.join(custom_root, "DIS-8003")
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(custom_root) end)

    {:ok, _project} = Context.ensure_project(%{name: "Distrib", slug: "distrib"})

    {:ok, _setup} =
      Context.upsert_project_setup("distrib", %{
        workflow_markdown:
          SymphonyElixir.Workflow.to_markdown(
            %{
              "workspace" => %{"root" => custom_root},
              "codex" => %{
                "command" => "python3 #{@fake_codex_app_server}",
                "goals_enabled" => true
              }
            },
            ""
          )
      })

    {:ok, project_thread} =
      thread
      |> Thread.changeset(%{
        project_slug: "distrib",
        issue_identifier: "DIS-8003",
        workspace_path: workspace,
        agent_kind: "codex",
        agent_thread_ids: %{"codex" => "thread-8003"}
      })
      |> Repo.update()

    assert {:ok, payload, updated} =
             AuthoringGoalControl.set_objective(project_thread, "Finish thread 8003")

    assert payload.native
    assert payload.objective == "Finish thread 8003"
    assert History.thread_goal_mode(updated)
  end

  test "normalizes native lifecycle statuses and preserves Codex accounting", %{thread: thread} do
    {:ok, enabled} = History.set_goal_mode(thread, true, "Audit")

    for {native_status, expected} <- [
          {"pending", "starting"},
          {"active", "running"},
          {"paused", "paused"},
          {"completed", "completed"},
          {"blocked", "blocked"},
          {"failed", "failed"},
          {"budget_exceeded", "budgetLimited"},
          {"usage_limit", "usageLimited"}
        ] do
      payload =
        AuthoringGoalControl.payload_from_native_update(enabled, %{
          "objective" => "Audit",
          "status" => native_status,
          "tokenBudget" => 10_000,
          "tokensUsed" => 4_000,
          "timeUsedSeconds" => 30
        })

      assert payload.goal.status == expected
      assert payload.goal.tokenBudget == 10_000
      assert payload.goal.tokensUsed == 4_000
      assert payload.goal.timeUsedSeconds == 30
    end
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo, do: SymphonyElixir.TestSupport.truncate_tracker!(Repo)

  defp enable_codex_goals!(workflow_file) do
    workflow_file
    |> File.read!()
    |> String.replace("codex:\n", "codex:\n  goals_enabled: true\n", global: false)
    |> then(&File.write!(workflow_file, &1))
  end
end
