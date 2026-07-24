defmodule SymphonyElixir.Assistant.AgentSessionFileChangeCaptureTest do
  # Regression coverage for the file_change relay fallback: when Codex reports a
  # file_change item with only paths (no embedded native patch), AgentSession must
  # capture ONLY those reported paths via a targeted, single-file git diff — never a
  # full workspace diff — and persist the bounded per-file shape alongside the legacy
  # aggregate fields the UI already reads.
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{AgentSession, History, Thread}
  alias SymphonyElixir.GitFixtures
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow

  @fake_codex_app_server Path.expand("../../support/fixtures/fake_codex_app_server.py", __DIR__)

  setup do
    Repo.delete_all(Thread)
    workspace = Path.join(System.tmp_dir!(), "file-change-capture-#{System.unique_integer([:positive])}")
    workflow_root = Path.join(System.tmp_dir!(), "file-change-workflow-#{System.unique_integer([:positive])}")
    workflow_file = Path.join(workflow_root, "WORKFLOW.md")
    previous_workflow_file = Application.get_env(:symphony_elixir, :workflow_file_path)

    File.mkdir_p!(workspace)
    File.mkdir_p!(workflow_root)
    File.write!(workflow_file, Workflow.to_markdown(%{"workspace" => %{"root" => System.tmp_dir!()}}, ""))
    Workflow.set_workflow_file_path(workflow_file)

    GitFixtures.sh!(workspace, """
    git init -b main . &&
    git config user.email t@t && git config user.name t &&
    printf 'line one\\n' > tracked.txt && git add -A && git commit -m init
    """)

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

  test "captures the reported path via a targeted single-file git diff when no native patch arrives", %{
    workspace: workspace
  } do
    # Codex has already edited the tracked file on disk before its file_change item
    # reaches the relay without an embedded native patch.
    File.write!(Path.join(workspace, "tracked.txt"), "line one\nline two\n")

    {:ok, thread} = History.create_freeform_thread(%{workspace_path: workspace, agent_kind: "codex"})
    test_pid = self()

    assert {:ok, _result} =
             AgentSession.send_message_to_thread(
               thread,
               "edit the file",
               %{"agent" => "codex"},
               codex_config: %{
                 "command" => "env FAKE_CODEX_FILE_CHANGE_EVENT=tracked.txt python3 #{@fake_codex_app_server}",
                 "approval_policy" => "never",
                 "thread_sandbox" => "danger-full-access"
               },
               workspace_root: System.tmp_dir!(),
               dynamic_tools: [],
               on_tool_call_completed: fn tool_call -> send(test_pid, {:tool_call_completed, tool_call}) end
             )

    assert_received {:tool_call_completed, %{name: "apply_patch"} = tool_call}

    assert tool_call.result["paths"] == ["tracked.txt"]
    assert [file] = tool_call.result["files"]
    assert file["path"] == "tracked.txt"
    assert file["status"] == "modified"
    assert file["patch"] =~ "+line two"
    assert file["additions"] == 1
    assert file["deletions"] == 0
    assert file["truncated"] == false

    assert tool_call.result["diff"] =~ "+line two"
    assert tool_call.result["additions"] == 1
    assert tool_call.result["deletions"] == 0
  end

  test "rejects a reported path that would escape the thread workspace", %{workspace: workspace} do
    outside = Path.join(System.tmp_dir!(), "fcc-outside-#{System.unique_integer([:positive])}")
    File.mkdir_p!(outside)
    File.write!(Path.join(outside, "secret.txt"), "top secret\n")
    on_exit(fn -> File.rm_rf!(outside) end)

    {:ok, thread} = History.create_freeform_thread(%{workspace_path: workspace, agent_kind: "codex"})
    test_pid = self()
    escaping_path = "../#{Path.basename(outside)}/secret.txt"

    assert {:ok, _result} =
             AgentSession.send_message_to_thread(
               thread,
               "edit the file",
               %{"agent" => "codex"},
               codex_config: %{
                 "command" => "env FAKE_CODEX_FILE_CHANGE_EVENT=#{escaping_path} python3 #{@fake_codex_app_server}",
                 "approval_policy" => "never",
                 "thread_sandbox" => "danger-full-access"
               },
               workspace_root: System.tmp_dir!(),
               dynamic_tools: [],
               on_tool_call_completed: fn tool_call -> send(test_pid, {:tool_call_completed, tool_call}) end
             )

    assert_received {:tool_call_completed, %{name: "apply_patch"} = tool_call}

    assert tool_call.result["paths"] == [escaping_path]
    assert tool_call.result["files"] == []
    assert tool_call.result["diff"] == nil
  end
end
