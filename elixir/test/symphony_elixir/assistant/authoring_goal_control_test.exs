defmodule SymphonyElixir.Assistant.AuthoringGoalControlTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{AuthoringGoalControl, History, Thread}
  alias SymphonyElixir.Codex.Session, as: CodexStore
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow

  setup do
    migrate_repo()
    clean_repo()

    tmp_dir = Path.join(System.tmp_dir!(), "symphony-authoring-goal-#{System.unique_integer([:positive])}")
    File.rm_rf!(tmp_dir)
    File.mkdir_p!(tmp_dir)

    workflow_file = Path.join(tmp_dir, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: tmp_dir)
    Workflow.set_workflow_file_path(workflow_file)

    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, thread} = History.ensure_issue_thread("macro-markets", "MAC-1", %{workspace_path: Path.join(tmp_dir, "MAC-1")})

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      File.rm_rf!(tmp_dir)
    end)

    {:ok, thread: thread}
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

  test "set_objective_metadata persists without touching the native goal", %{thread: thread} do
    assert {:ok, payload, updated} = AuthoringGoalControl.set_objective_metadata(thread, "  Finish the spec  ")
    assert payload.enabled == true
    assert payload.objective == "Finish the spec"
    # Metadata-only: never reports a native goal (no Codex port round-trip).
    assert payload.native == false
    assert payload.goal == nil
    assert History.thread_goal_mode(updated) == true
    assert History.thread_goal_objective(updated) == "Finish the spec"
  end

  test "set_objective_metadata rejects a blank objective", %{thread: thread} do
    assert {:error, :empty_objective} = AuthoringGoalControl.set_objective_metadata(thread, "   ")
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
    assert payload.goal.status == "active"
    assert payload.goal.timeUsedSeconds == 90
    assert payload.goal.tokensUsed == 12_000
    assert payload.goal.tokenBudget == 50_000
  end

  test "clear removes a mirrored workspace goal so execution cannot read a stale objective", %{
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
    assert CodexStore.read_goal(workspace) == :error
  end

  test "pause requires a native Codex goal", %{thread: thread} do
    {:ok, enabled} = History.set_goal_mode(thread, true, "Audit")
    assert {:error, :no_codex_thread} = AuthoringGoalControl.pause(enabled)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo, do: SymphonyElixir.TestSupport.truncate_tracker!(Repo)
end
