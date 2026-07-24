defmodule SymphonyElixir.Assistant.AgentSessionGoalRelayTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{AgentSession, History, Thread}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow

  @fake_codex_app_server Path.expand("../../support/fixtures/fake_codex_app_server.py", __DIR__)

  setup do
    Repo.delete_all(Thread)
    workspace = Path.join(System.tmp_dir!(), "goal-relay-#{System.unique_integer([:positive])}")
    workflow_root = Path.join(System.tmp_dir!(), "goal-relay-workflow-#{System.unique_integer([:positive])}")
    workflow_file = Path.join(workflow_root, "WORKFLOW.md")
    previous_workflow_file = Application.get_env(:symphony_elixir, :workflow_file_path)

    File.mkdir_p!(workspace)
    File.mkdir_p!(workflow_root)
    File.write!(workflow_file, Workflow.to_markdown(%{"workspace" => %{"root" => System.tmp_dir!()}}, ""))
    Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      Repo.delete_all(Thread)
      File.rm_rf!(workspace)
      File.rm_rf!(workflow_root)

      if is_binary(previous_workflow_file) do
        Workflow.set_workflow_file_path(previous_workflow_file)
      else
        Workflow.clear_workflow_file_path()
      end
    end)

    %{workspace: workspace}
  end

  test "relays a native Goal update from the provider stream", %{workspace: workspace} do
    {:ok, thread} =
      History.create_freeform_thread(%{
        workspace_path: workspace,
        agent_kind: "codex"
      })

    test_pid = self()

    assert {:ok, _result} =
             AgentSession.send_message_to_thread(
               thread,
               "continue",
               %{"agent" => "codex"},
               codex_config: %{
                 "command" => "env FAKE_CODEX_GOAL_EVENT=1 python3 #{@fake_codex_app_server}",
                 "approval_policy" => "never",
                 "thread_sandbox" => "danger-full-access"
               },
               workspace_root: System.tmp_dir!(),
               dynamic_tools: [],
               on_goal_updated: fn goal -> send(test_pid, {:goal_updated, goal}) end
             )

    assert_received {:goal_updated,
                     %{
                       "objective" => "Audit",
                       "status" => "active",
                       "tokensUsed" => 12,
                       "timeUsedSeconds" => 7
                     }}
  end
end
