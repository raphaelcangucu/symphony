defmodule SymphonyElixir.Codex.CodingAgentTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Agent.ConversationRef

  describe "goal mode" do
    test "sets the trimmed thread goal after thread start and before turn start when goals are enabled" do
      with_fake_goal_server(fn workspace, issue, trace_file ->
        enable_goals!()

        assert {:ok, _result} =
                 AppServer.run(workspace, "Build the feature", issue, goal: "  Ship the feature\n")

        messages = outbound_messages(trace_file)
        goal_message = message_with_method(messages, "thread/goal/set")

        assert goal_message == %{
                 "id" => 4,
                 "method" => "thread/goal/set",
                 "params" => %{"threadId" => "thread-goal", "objective" => "Ship the feature", "status" => "active"}
               }

        assert message_order(messages) == [
                 "initialize",
                 "initialized",
                 "thread/start",
                 "thread/goal/set",
                 "turn/start",
                 "thread/goal/get"
               ]
      end)
    end

    test "rejects a whitespace-only goal before starting an ordinary turn" do
      with_fake_goal_server(fn workspace, issue, trace_file ->
        enable_goals!()

        assert {:error, {:goal_activation_failed, :empty_objective}} =
                 AppServer.run(workspace, "Build the feature", issue, goal: " \n\t ")

        refute File.exists?(trace_file)
      end)
    end

    test "rejects a non-binary goal before starting an ordinary turn" do
      with_fake_goal_server(fn workspace, issue, trace_file ->
        enable_goals!()

        assert {:error, {:goal_activation_failed, :invalid_objective}} =
                 AppServer.run(workspace, "Build the feature", issue, goal: false)

        refute File.exists?(trace_file)
      end)
    end

    test "fails before an ordinary turn when native goals are disabled" do
      with_fake_goal_server(fn workspace, issue, trace_file ->
        assert {:error, {:goal_activation_failed, :goals_disabled}} =
                 AppServer.run(workspace, "Build the feature", issue, goal: "Ship the feature")

        refute File.exists?(trace_file)
      end)
    end

    test "fails before an ordinary turn when Codex rejects native goal activation" do
      with_fake_goal_server(:goal_error, fn workspace, issue, trace_file ->
        enable_goals!()

        assert {:error, {:goal_activation_failed, {:response_error, %{"code" => -32601, "message" => "Method not found"}}}} =
                 AppServer.run(workspace, "Build the feature", issue, goal: "Ship the feature")

        messages = outbound_messages(trace_file)

        assert message_with_method(messages, "thread/goal/set")
        assert message_order(messages) == ["initialize", "initialized", "thread/start", "thread/goal/set"]
        refute message_with_method(messages, "turn/start")
      end)
    end

    test "auto-continues after a separate active goal update and bare turn completion" do
      with_fake_goal_server([:active, :completed], fn workspace, issue, trace_file ->
        enable_goals!()

        assert {:ok, result} =
                 AppServer.run(workspace, "Build the feature", issue, goal: "Ship the feature")

        messages = outbound_messages(trace_file)
        turn_starts = messages_with_method(messages, "turn/start")

        assert result[:result] == :turn_completed
        assert length(turn_starts) == 2
        refute message_with_method(messages, "thread/goal/get")

        assert turn_prompt(Enum.at(turn_starts, 0)) =~ "Build the feature"

        assert turn_prompt(Enum.at(turn_starts, 1)) =~
                 "Continue working toward the active goal"
      end)
    end

    test "stops auto-continuation after a separate terminal goal update" do
      with_fake_goal_server([:blocked, :active], fn workspace, issue, trace_file ->
        enable_goals!()

        assert {:ok, _result} =
                 AppServer.run(workspace, "Build the feature", issue, goal: "Ship the feature")

        messages = outbound_messages(trace_file)

        assert messages_with_method(messages, "thread/goal/set") |> length() == 1
        assert messages_with_method(messages, "turn/start") |> length() == 1
      end)
    end

    test "gets the authoritative active goal after a bare completion with no goal update" do
      with_fake_goal_server(:missing_update_active, fn workspace, issue, trace_file ->
        enable_goals!()

        assert {:ok, result} =
                 AppServer.run(workspace, "Build the feature", issue, goal: "Ship the feature")

        messages = outbound_messages(trace_file)

        assert result[:result] == :turn_completed
        assert messages_with_method(messages, "thread/goal/get") |> length() == 1
        assert messages_with_method(messages, "turn/start") |> length() == 2
      end)
    end

    test "stops auto-continuation at the configured max goal turn budget" do
      with_fake_goal_server([:active, :active, :completed], fn workspace, issue, trace_file ->
        enable_goals!()

        log =
          capture_log(fn ->
            assert {:ok, _result} =
                     AppServer.run(workspace, "Build the feature", issue,
                       goal: "Ship the feature",
                       max_goal_turns: 2
                     )
          end)

        messages = outbound_messages(trace_file)

        assert messages_with_method(messages, "turn/start") |> length() == 2
        assert log =~ "Codex goal turn budget exhausted"
      end)
    end

    test "does not auto-continue when no goal is provided" do
      with_fake_goal_server([:active, :completed], fn workspace, issue, trace_file ->
        enable_goals!()

        assert {:ok, _result} = AppServer.run(workspace, "Build the feature", issue)

        messages = outbound_messages(trace_file)

        refute message_with_method(messages, "thread/goal/set")
        assert messages_with_method(messages, "turn/start") |> length() == 1
      end)
    end
  end

  describe "workspace session sidecar ownership" do
    test "a non-goal session never overwrites the durable sidecar" do
      with_fake_goal_server([:active, :completed], fn workspace, issue, _trace_file ->
        enable_goals!()
        write_session_sidecar!(workspace, "durable-thread")

        assert {:ok, _result} = AppServer.run(workspace, "Build the feature", issue)

        # Interactive/non-goal sessions share the working tree with the issue's
        # durable goal thread. Overwriting the sidecar here cross-links session
        # logs and makes the next goal-mode run resume the wrong conversation.
        assert {:ok, "durable-thread"} = SymphonyElixir.Codex.Session.resolve(workspace)
      end)
    end

    test "a non-goal session does not create the sidecar" do
      with_fake_goal_server([:active, :completed], fn workspace, issue, _trace_file ->
        enable_goals!()

        assert {:ok, _result} = AppServer.run(workspace, "Build the feature", issue)

        refute File.exists?(Path.join([Path.expand(workspace), ".symphony", "codex-session.json"]))
      end)
    end

    test "a goal-mode session persists its thread id in the sidecar" do
      with_fake_goal_server([:completed], fn workspace, issue, _trace_file ->
        enable_goals!()

        assert {:ok, _result} =
                 AppServer.run(workspace, "Build the feature", issue, goal: "Ship the feature")

        assert {:ok, "thread-goal"} = SymphonyElixir.Codex.Session.resolve(workspace)
      end)
    end
  end

  describe "explicit interactive thread resume" do
    test "resumes the provided thread outside goal mode without reading goal state" do
      with_fake_resume_server(:present, fn workspace, issue, trace_file ->
        assert {:ok, result} =
                 AppServer.run(workspace, "Continue the chat", issue,
                   conversation_ref: %ConversationRef{
                     provider: "codex",
                     conversation_id: "thread-resume"
                   }
                 )

        messages = outbound_messages(trace_file)

        assert result.conversation_id == "thread-resume"

        assert message_order(messages) == [
                 "initialize",
                 "initialized",
                 "thread/resume",
                 "turn/start"
               ]

        refute message_with_method(messages, "thread/start")
        refute message_with_method(messages, "thread/goal/get")
        refute File.exists?(Path.join([Path.expand(workspace), ".symphony", "codex-session.json"]))
      end)
    end

    test "returns a stable error when the explicit resume target no longer exists" do
      with_fake_resume_server(:missing, fn workspace, issue, trace_file ->
        assert {:error, {:resume_conversation_failed, "thread-missing", _reason}} =
                 AppServer.run(workspace, "Continue the chat", issue,
                   conversation_ref: %ConversationRef{
                     provider: "codex",
                     conversation_id: "thread-missing"
                   }
                 )

        messages = outbound_messages(trace_file)

        assert message_order(messages) == [
                 "initialize",
                 "initialized",
                 "thread/resume"
               ]
      end)
    end
  end

  describe "durable goal threads" do
    test "resumes the stored thread and reads the native goal instead of overwriting it" do
      with_fake_resume_server(:present, fn workspace, issue, trace_file ->
        enable_goals!()
        write_session_sidecar!(workspace, "thread-resume")

        assert {:ok, _result} =
                 AppServer.run(workspace, "Build the feature", issue, goal: "Ship the feature")

        messages = outbound_messages(trace_file)

        assert message_order(messages) == [
                 "initialize",
                 "initialized",
                 "thread/resume",
                 "thread/goal/get",
                 "turn/start"
               ]

        refute message_with_method(messages, "thread/start")
        refute message_with_method(messages, "thread/goal/set")
      end)
    end

    test "seeds the goal when a resumed thread has no native goal yet" do
      with_fake_resume_server(:null, fn workspace, issue, trace_file ->
        enable_goals!()
        write_session_sidecar!(workspace, "thread-resume")

        assert {:ok, _result} =
                 AppServer.run(workspace, "Build the feature", issue, goal: "Ship the feature")

        messages = outbound_messages(trace_file)

        assert message_with_method(messages, "thread/resume")
        assert message_with_method(messages, "thread/goal/get")

        goal_set = message_with_method(messages, "thread/goal/set")
        assert goal_set["params"]["objective"] == "Ship the feature"
      end)
    end

    test "fails preflight without touching the durable thread when goals are disabled" do
      with_fake_resume_server(:present, fn workspace, issue, trace_file ->
        write_session_sidecar!(workspace, "thread-resume")

        assert {:error, {:goal_activation_failed, :goals_disabled}} =
                 AppServer.run(workspace, "Build the feature", issue, goal: "Ship the feature")

        refute File.exists?(trace_file)
        assert {:ok, "thread-resume"} = SymphonyElixir.Codex.Session.resolve(workspace)
      end)
    end

    test "does not replace a stale durable goal conversation with a fresh thread" do
      with_fake_resume_server(:missing, fn workspace, _issue, trace_file ->
        enable_goals!()
        write_session_sidecar!(workspace, "thread-resume")

        assert {:error, {:resume_conversation_failed, "thread-resume", _reason}} =
                 AppServer.ensure_goal(
                   workspace,
                   %{objective: "Ship the feature", status: "active"},
                   workspace_root: Path.dirname(workspace)
                 )

        messages = outbound_messages(trace_file)
        assert message_order(messages) == ["initialize", "initialized", "thread/resume"]
        refute message_with_method(messages, "thread/start")
        assert {:ok, "thread-resume"} = SymphonyElixir.Codex.Session.resolve(workspace)
      end)
    end
  end

  describe "native goal control (manage_goal/3)" do
    test "reads the current goal after resuming the stored thread" do
      with_fake_resume_server(:present, fn workspace, _issue, trace_file ->
        enable_goals!()

        assert {:ok, goal} =
                 AppServer.manage_goal(workspace, :get,
                   thread_id: "thread-resume",
                   workspace_root: Path.dirname(workspace)
                 )

        assert goal["objective"] == "Resume the migration"
        assert goal["status"] == "active"

        messages = outbound_messages(trace_file)
        assert message_order(messages) == ["initialize", "initialized", "thread/resume", "thread/goal/get"]
      end)
    end

    test "pauses the goal with a status-only thread/goal/set" do
      with_fake_resume_server(:present, fn workspace, _issue, trace_file ->
        enable_goals!()

        assert {:ok, _goal} =
                 AppServer.manage_goal(workspace, {:set, %{status: "paused"}},
                   thread_id: "thread-resume",
                   workspace_root: Path.dirname(workspace)
                 )

        goal_set = message_with_method(outbound_messages(trace_file), "thread/goal/set")
        assert goal_set["params"] == %{"threadId" => "thread-resume", "status" => "paused"}
      end)
    end

    test "removes the token budget when set to nil" do
      with_fake_resume_server(:present, fn workspace, _issue, trace_file ->
        enable_goals!()

        assert {:ok, _goal} =
                 AppServer.manage_goal(workspace, {:set, %{token_budget: nil}},
                   thread_id: "thread-resume",
                   workspace_root: Path.dirname(workspace)
                 )

        goal_set = message_with_method(outbound_messages(trace_file), "thread/goal/set")
        assert Map.has_key?(goal_set["params"], "tokenBudget")
        assert goal_set["params"]["tokenBudget"] == nil
      end)
    end

    test "clears the goal and reports cleared" do
      with_fake_resume_server(:present, fn workspace, _issue, trace_file ->
        enable_goals!()

        assert {:ok, :cleared} =
                 AppServer.manage_goal(workspace, :clear,
                   thread_id: "thread-resume",
                   workspace_root: Path.dirname(workspace)
                 )

        assert message_with_method(outbound_messages(trace_file), "thread/goal/clear")
      end)
    end

    test "refuses goal mutations when goal mode is disabled" do
      with_fake_resume_server(:present, fn workspace, _issue, _trace_file ->
        assert {:error, :goals_disabled} =
                 AppServer.manage_goal(workspace, {:set, %{status: "paused"}},
                   thread_id: "thread-resume",
                   workspace_root: Path.dirname(workspace)
                 )
      end)
    end
  end

  describe "tool call resilience" do
    test "a crashing client tool does not abort the run; the failure is reported back" do
      with_fake_tool_server(fn workspace, issue ->
        test_pid = self()
        on_message = fn message -> send(test_pid, {:codex_event, message}) end

        log =
          capture_log(fn ->
            assert {:ok, result} =
                     AppServer.run(workspace, "Build the feature", issue,
                       tool_executor: fn _tool, _arguments -> raise "boom tool" end,
                       on_message: on_message
                     )

            assert result[:result] == :turn_completed
          end)

        assert_received {:codex_event, %{event: :tool_call_failed, result: %{"success" => false}}}
        assert log =~ "boom tool"
      end)
    end
  end

  describe "transient error handling" do
    test "fails the turn when an error event precedes completion with no agent message" do
      with_fake_error_server([emit_agent_message: false], fn workspace, issue ->
        log =
          capture_log(fn ->
            assert {:error, {:turn_failed, reason}} =
                     AppServer.run(workspace, "Build the feature", issue)

            assert reason == "stream disconnected"
          end)

        assert log =~ "treating as failed"
      end)
    end

    test "still completes when the turn recovers and produces an agent message" do
      with_fake_error_server([emit_agent_message: true], fn workspace, issue ->
        assert {:ok, result} = AppServer.run(workspace, "Build the feature", issue)
        assert result[:result] == :turn_completed
      end)
    end

    test "compacts the thread and retries once when Codex reports context window exhaustion" do
      with_fake_context_window_server(fn workspace, issue, trace_file ->
        assert {:ok, result} = AppServer.run(workspace, "Build the feature", issue)
        assert result[:result] == :turn_completed

        messages = outbound_messages(trace_file)
        assert message_with_method(messages, "thread/compact/start")

        assert message_order(messages) == [
                 "initialize",
                 "initialized",
                 "thread/start",
                 "turn/start",
                 "thread/compact/start",
                 "turn/start"
               ]
      end)
    end
  end

  describe "process group reaping" do
    test "stop_session kills the whole Codex process group, not just the immediate child" do
      with_fake_reaper_server(fn workspace, pid_file ->
        assert {:ok, session} = AppServer.start_session(workspace)

        grandchild_pid = wait_for_pid_file!(pid_file)
        assert os_process_alive?(grandchild_pid), "fake grandchild should be running before teardown"

        AppServer.stop_session(session)

        assert eventually_dead?(grandchild_pid),
               "stop_session must reap the backgrounded grandchild (pid #{grandchild_pid})"
      end)
    end
  end

  describe "execution mode sandbox" do
    test "plan mode starts the thread in a read-only sandbox" do
      with_fake_goal_server(fn workspace, issue, trace_file ->
        assert {:ok, _result} =
                 AppServer.run(workspace, "Build the feature", issue, execution_mode: "plan")

        thread_start = message_with_method(outbound_messages(trace_file), "thread/start")
        assert thread_start["params"]["sandbox"] == "read-only"
      end)
    end

    test "yolo mode starts the thread in danger-full-access" do
      with_fake_goal_server(fn workspace, issue, trace_file ->
        assert {:ok, _result} =
                 AppServer.run(workspace, "Build the feature", issue, execution_mode: "yolo")

        thread_start = message_with_method(outbound_messages(trace_file), "thread/start")
        assert thread_start["params"]["sandbox"] == "danger-full-access"
      end)
    end

    test "build mode keeps the configured workspace-write sandbox" do
      with_fake_goal_server(fn workspace, issue, trace_file ->
        assert {:ok, _result} =
                 AppServer.run(workspace, "Build the feature", issue, execution_mode: "build")

        thread_start = message_with_method(outbound_messages(trace_file), "thread/start")
        assert thread_start["params"]["sandbox"] == "workspace-write"
      end)
    end

    test "no execution mode leaves the configured sandbox untouched" do
      with_fake_goal_server(fn workspace, issue, trace_file ->
        assert {:ok, _result} = AppServer.run(workspace, "Build the feature", issue)

        thread_start = message_with_method(outbound_messages(trace_file), "thread/start")
        assert thread_start["params"]["sandbox"] == "workspace-write"
      end)
    end
  end

  defp with_fake_goal_server(response_mode \\ :goal_ok, fun) when is_function(fun, 3) do
    test_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-elixir-coding-agent-goal-#{System.unique_integer([:positive])}"
      )

    try do
      workspace_root = Path.join(test_root, "workspaces")
      workspace = Path.join(workspace_root, "MT-GOAL")
      codex_binary = Path.join(test_root, "fake-codex")
      trace_file = Path.join(test_root, "codex-goal.trace")

      File.mkdir_p!(workspace)
      write_goal_fake_codex!(codex_binary, trace_file, response_mode)

      write_workflow_file!(Workflow.workflow_file_path(),
        workspace_root: workspace_root,
        command: "#{codex_binary} app-server"
      )

      issue = %Issue{
        id: "issue-goal",
        identifier: "MT-GOAL",
        title: "Goal mode",
        description: "Exercise Codex goal mode",
        state: "In Progress",
        url: "https://example.org/issues/MT-GOAL",
        labels: ["backend"]
      }

      fun.(workspace, issue, trace_file)
    after
      File.rm_rf(test_root)
    end
  end

  defp with_fake_resume_server(goal_get_mode, fun) when is_function(fun, 3) do
    test_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-elixir-coding-agent-resume-#{System.unique_integer([:positive])}"
      )

    try do
      workspace_root = Path.join(test_root, "workspaces")
      workspace = Path.join(workspace_root, "MT-RESUME")
      codex_binary = Path.join(test_root, "fake-codex")
      trace_file = Path.join(test_root, "codex-resume.trace")

      File.mkdir_p!(workspace)
      write_resume_fake_codex!(codex_binary, trace_file, goal_get_mode)

      write_workflow_file!(Workflow.workflow_file_path(),
        workspace_root: workspace_root,
        command: "#{codex_binary} app-server"
      )

      issue = %Issue{
        id: "issue-resume",
        identifier: "MT-RESUME",
        title: "Resume goal",
        description: "Exercise Codex durable goal threads",
        state: "In Progress",
        url: "https://example.org/issues/MT-RESUME",
        labels: ["backend"]
      }

      fun.(workspace, issue, trace_file)
    after
      File.rm_rf(test_root)
    end
  end

  defp write_session_sidecar!(workspace, thread_id) do
    path = Path.join([Path.expand(workspace), ".symphony", "codex-session.json"])
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, Jason.encode!(%{"thread_id" => thread_id, "updated_at" => "2026-01-01T00:00:00Z"}))
    :ok
  end

  defp write_resume_fake_codex!(codex_binary, trace_file, goal_get_mode) do
    {resume_response, goal_get_response} =
      case goal_get_mode do
        :present ->
          {
            ~s({"id":5,"result":{"thread":{"id":"thread-resume"}}}),
            ~s({"id":6,"result":{"goal":{"threadId":"thread-resume","objective":"Resume the migration","status":"active","tokenBudget":200000,"tokensUsed":10,"timeUsedSeconds":5}}})
          }

        :null ->
          {
            ~s({"id":5,"result":{"thread":{"id":"thread-resume"}}}),
            ~s({"id":6,"result":{"goal":null}})
          }

        :missing ->
          {
            ~s({"id":5,"error":{"code":-32004,"message":"Thread not found"}}),
            ~s({"id":6,"result":{"goal":null}})
          }
      end

    File.write!(codex_binary, """
    #!/bin/sh
    trace_file="#{trace_file}"

    while IFS= read -r line; do
      printf 'JSON:%s\\n' "$line" >> "$trace_file"

      case "$line" in
        *'"method":"initialize"'*)
          printf '%s\\n' '{"id":1,"result":{}}'
          ;;
        *'"method":"initialized"'*)
          ;;
        *'"method":"thread/start"'*)
          printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-resume"}}}'
          ;;
        *'"method":"thread/resume"'*)
          printf '%s\\n' '#{resume_response}'
          ;;
        *'"method":"thread/goal/get"'*)
          printf '%s\\n' '#{goal_get_response}'
          ;;
        *'"method":"thread/goal/set"'*)
          printf '%s\\n' '{"id":4,"result":{"goal":{"threadId":"thread-resume","objective":"Resume the migration","status":"active","tokenBudget":null,"tokensUsed":0,"timeUsedSeconds":0}}}'
          ;;
        *'"method":"thread/goal/clear"'*)
          printf '%s\\n' '{"id":7,"result":{"cleared":true}}'
          ;;
        *'"method":"turn/start"'*)
          printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-resume"}}}'
          printf '%s\\n' '{"method":"thread/goal/updated","params":{"threadId":"thread-resume","goal":{"status":"completed"}}}'
          printf '%s\\n' '{"method":"turn/completed"}'
          exit 0
          ;;
        *)
          ;;
      esac
    done
    """)

    File.chmod!(codex_binary, 0o755)
  end

  defp with_fake_tool_server(fun) when is_function(fun, 2) do
    test_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-elixir-coding-agent-tool-#{System.unique_integer([:positive])}"
      )

    try do
      workspace_root = Path.join(test_root, "workspaces")
      workspace = Path.join(workspace_root, "MT-TOOL")
      codex_binary = Path.join(test_root, "fake-codex")

      File.mkdir_p!(workspace)
      write_tool_fake_codex!(codex_binary)

      write_workflow_file!(Workflow.workflow_file_path(),
        workspace_root: workspace_root,
        command: "#{codex_binary} app-server"
      )

      issue = %Issue{
        id: "issue-tool",
        identifier: "MT-TOOL",
        title: "Tool resilience",
        description: "Exercise Codex client tool crash handling",
        state: "In Progress",
        url: "https://example.org/issues/MT-TOOL",
        labels: ["backend"]
      }

      fun.(workspace, issue)
    after
      File.rm_rf(test_root)
    end
  end

  # Emits a single client tool call during the turn, then completes the turn once
  # Symphony sends the tool result back. This exercises the inline tool-call path
  # so a crashing executor must not take down the run.
  defp write_tool_fake_codex!(codex_binary) do
    File.write!(codex_binary, """
    #!/bin/sh
    while IFS= read -r line; do
      case "$line" in
        *'"method":"initialize"'*)
          printf '%s\\n' '{"id":1,"result":{}}'
          ;;
        *'"method":"thread/start"'*)
          printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-tool"}}}'
          ;;
        *'"method":"turn/start"'*)
          printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-tool"}}}'
          printf '%s\\n' '{"id":"call-1","method":"item/tool/call","params":{"tool":"boom","arguments":{}}}'
          ;;
        *'"id":"call-1"'*)
          printf '%s\\n' '{"method":"turn/completed"}'
          exit 0
          ;;
        *)
          ;;
      esac
    done
    """)

    File.chmod!(codex_binary, 0o755)
  end

  defp with_fake_error_server(opts, fun) when is_function(fun, 2) do
    emit_agent_message = Keyword.get(opts, :emit_agent_message, false)

    test_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-elixir-coding-agent-error-#{System.unique_integer([:positive])}"
      )

    try do
      workspace_root = Path.join(test_root, "workspaces")
      workspace = Path.join(workspace_root, "MT-ERR")
      codex_binary = Path.join(test_root, "fake-codex")

      File.mkdir_p!(workspace)
      write_error_fake_codex!(codex_binary, emit_agent_message)

      write_workflow_file!(Workflow.workflow_file_path(),
        workspace_root: workspace_root,
        command: "#{codex_binary} app-server"
      )

      issue = %Issue{
        id: "issue-error",
        identifier: "MT-ERR",
        title: "Transient error",
        description: "Exercise Codex transient error handling",
        state: "In Progress",
        url: "https://example.org/issues/MT-ERR",
        labels: ["backend"]
      }

      fun.(workspace, issue)
    after
      File.rm_rf(test_root)
    end
  end

  defp write_error_fake_codex!(codex_binary, emit_agent_message) do
    agent_message_line =
      if emit_agent_message do
        ~s(      printf '%s\\n' '{"method":"item/agentMessage/delta","params":{"delta":"working on it"}}')
      else
        "      :"
      end

    File.write!(codex_binary, """
    #!/bin/sh
    while IFS= read -r line; do
      case "$line" in
        *'"method":"initialize"'*)
          printf '%s\\n' '{"id":1,"result":{}}'
          ;;
        *'"method":"initialized"'*)
          ;;
        *'"method":"thread/start"'*)
          printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-error"}}}'
          ;;
        *'"method":"turn/start"'*)
          printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-error"}}}'
          printf '%s\\n' '{"method":"error","params":{"message":"stream disconnected"}}'
    #{agent_message_line}
          printf '%s\\n' '{"method":"turn/completed"}'
          exit 0
          ;;
        *)
          ;;
      esac
    done
    """)

    File.chmod!(codex_binary, 0o755)
  end

  defp with_fake_context_window_server(fun) when is_function(fun, 3) do
    test_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-elixir-coding-agent-context-#{System.unique_integer([:positive])}"
      )

    try do
      workspace_root = Path.join(test_root, "workspaces")
      workspace = Path.join(workspace_root, "MT-CTX")
      codex_binary = Path.join(test_root, "fake-codex")
      trace_file = Path.join(test_root, "codex-context.trace")

      File.mkdir_p!(workspace)
      write_context_window_fake_codex!(codex_binary, trace_file)

      write_workflow_file!(Workflow.workflow_file_path(),
        workspace_root: workspace_root,
        command: "#{codex_binary} app-server"
      )

      issue = %Issue{
        id: "issue-context",
        identifier: "MT-CTX",
        title: "Context window",
        description: "Exercise Codex context compaction",
        state: "In Progress",
        url: "https://example.org/issues/MT-CTX",
        labels: ["backend"]
      }

      fun.(workspace, issue, trace_file)
    after
      File.rm_rf(test_root)
    end
  end

  defp write_context_window_fake_codex!(codex_binary, trace_file) do
    context_error =
      "Codex ran out of room in the model context window. Start a new thread or clear earlier history before retrying."

    File.write!(codex_binary, """
    #!/bin/sh
    trace_file="#{trace_file}"
    turn_count=0

    while IFS= read -r line; do
      printf 'JSON:%s\\n' "$line" >> "$trace_file"

      case "$line" in
        *'"method":"initialize"'*)
          printf '%s\\n' '{"id":1,"result":{}}'
          ;;
        *'"method":"initialized"'*)
          ;;
        *'"method":"thread/start"'*)
          printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-context"}}}'
          ;;
        *'"method":"turn/start"'*)
          turn_count=$((turn_count + 1))
          printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-context-'$turn_count'"}}}'
          if [ "$turn_count" -eq 1 ]; then
            printf '%s\\n' '{"method":"turn/failed","params":{"error":{"message":"#{context_error}","codexErrorInfo":{"code":"ContextWindowExceeded"}}}}'
          else
            printf '%s\\n' '{"method":"turn/completed"}'
            exit 0
          fi
          ;;
        *'"method":"thread/compact/start"'*)
          printf '%s\\n' '{"id":8,"result":{}}'
          printf '%s\\n' '{"method":"turn/completed","params":{"compaction":true}}'
          ;;
        *)
          ;;
      esac
    done
    """)

    File.chmod!(codex_binary, 0o755)
  end

  defp write_goal_fake_codex!(codex_binary, trace_file, response_mode) do
    goal_response =
      case response_mode do
        statuses when is_list(statuses) -> ~s({"id":4,"result":{}})
        :goal_ok -> ~s({"id":4,"result":{}})
        :missing_update_active -> ~s({"id":4,"result":{}})
        :goal_error -> ~s({"id":4,"error":{"code":-32601,"message":"Method not found"}})
      end

    goal_get_response =
      case response_mode do
        :missing_update_active ->
          ~s({"id":6,"result":{"goal":{"threadId":"thread-goal","objective":"Ship the feature","status":"active"}}})

        _ ->
          ~s({"id":6,"result":{"goal":{"threadId":"thread-goal","objective":"Ship the feature","status":"completed"}}})
      end

    turn_completion_cases =
      response_mode
      |> turn_completion_statuses()
      |> Enum.with_index(1)
      |> Enum.map_join("\n", fn {status, index} ->
        """
                  #{index})
        #{turn_lifecycle_events(status)}
                    ;;
        """
      end)

    turn_completion_count = length(turn_completion_statuses(response_mode))

    goal_get_exit =
      if response_mode == :goal_ok,
        do: "          exit 0",
        else: ""

    completion_exit =
      if response_mode == :goal_ok do
        ""
      else
        """
          if [ "$turn_count" -ge #{turn_completion_count} ]; then
            exit 0
          fi
        """
      end

    File.write!(codex_binary, """
    #!/bin/sh
    trace_file="#{trace_file}"
    turn_count=0

    while IFS= read -r line; do
      printf 'JSON:%s\\n' "$line" >> "$trace_file"

      case "$line" in
        *'"method":"initialize"'*)
          printf '%s\\n' '{"id":1,"result":{}}'
          ;;
        *'"method":"initialized"'*)
          ;;
        *'"method":"thread/start"'*)
          printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-goal"}}}'
          ;;
        *'"method":"thread/goal/set"'*)
          printf '%s\\n' '#{goal_response}'
          ;;
        *'"method":"thread/goal/get"'*)
          printf '%s\\n' '#{goal_get_response}'
    #{goal_get_exit}
          ;;
        *'"method":"turn/start"'*)
          turn_count=$((turn_count + 1))
          printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-goal"}}}'
          case "$turn_count" in
    #{turn_completion_cases}
            *)
              printf '%s\\n' '{"method":"turn/completed"}'
              ;;
          esac
    #{completion_exit}
          ;;
        *)
          ;;
      esac
    done
    """)

    File.chmod!(codex_binary, 0o755)
  end

  defp turn_completion_statuses(statuses) when is_list(statuses), do: statuses
  defp turn_completion_statuses(:missing_update_active), do: [:missing, :completed]
  defp turn_completion_statuses(_response_mode), do: [:unknown]

  defp turn_lifecycle_events(status) when status in [:active, :completed, :blocked] do
    """
                    printf '%s\\n' '{"method":"thread/goal/updated","params":{"threadId":"thread-goal","goal":{"status":"#{status}"}}}'
                    printf '%s\\n' '{"method":"turn/completed"}'
    """
  end

  defp turn_lifecycle_events(status) when status in [:missing, :unknown] do
    ~s(                    printf '%s\\n' '{"method":"turn/completed"}')
  end

  defp enable_goals! do
    workflow_file = Workflow.workflow_file_path()

    updated_workflow =
      workflow_file
      |> File.read!()
      |> String.replace("codex:\n", "codex:\n  goals_enabled: true\n", global: false)

    File.write!(workflow_file, updated_workflow)
    :ok
  end

  # Spawns a fake Codex app-server that backgrounds a long-lived `sleep`
  # grandchild at startup (recording its pid), then completes only the
  # start_session handshake (initialize + thread/start). The grandchild lets us
  # prove teardown kills the whole process group, not just the immediate child.
  defp with_fake_reaper_server(fun) when is_function(fun, 2) do
    test_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-elixir-coding-agent-reaper-#{System.unique_integer([:positive])}"
      )

    pid_file = Path.join(test_root, "grandchild.pid")

    try do
      workspace_root = Path.join(test_root, "workspaces")
      workspace = Path.join(workspace_root, "MT-REAP")
      codex_binary = Path.join(test_root, "fake-codex")

      File.mkdir_p!(workspace)

      File.write!(codex_binary, """
      #!/bin/sh
      sleep 300 &
      echo "$!" > "#{pid_file}"

      while IFS= read -r line; do
        case "$line" in
          *'"method":"initialize"'*)
            printf '%s\\n' '{"id":1,"result":{}}'
            ;;
          *'"method":"initialized"'*)
            ;;
          *'"method":"thread/start"'*)
            printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-reaper"}}}'
            ;;
        esac
      done
      """)

      File.chmod!(codex_binary, 0o755)

      write_workflow_file!(Workflow.workflow_file_path(),
        workspace_root: workspace_root,
        command: "#{codex_binary} app-server"
      )

      fun.(workspace, pid_file)
    after
      case File.read(pid_file) do
        {:ok, raw} -> System.cmd("kill", ["-9", String.trim(raw)], stderr_to_stdout: true)
        _ -> :ok
      end

      File.rm_rf(test_root)
    end
  end

  defp wait_for_pid_file!(pid_file), do: wait_for_pid_file!(pid_file, 50)

  defp wait_for_pid_file!(pid_file, 0), do: flunk("fake codex never wrote its pid to #{pid_file}")

  defp wait_for_pid_file!(pid_file, attempts) do
    case File.read(pid_file) do
      {:ok, raw} when raw != "" ->
        String.trim(raw)

      _ ->
        Process.sleep(20)
        wait_for_pid_file!(pid_file, attempts - 1)
    end
  end

  defp os_process_alive?(pid) when is_binary(pid) do
    match?({_, 0}, System.cmd("kill", ["-0", pid], stderr_to_stdout: true))
  end

  defp eventually_dead?(pid), do: eventually_dead?(pid, 50)

  defp eventually_dead?(_pid, 0), do: false

  defp eventually_dead?(pid, attempts) do
    if os_process_alive?(pid) do
      Process.sleep(20)
      eventually_dead?(pid, attempts - 1)
    else
      true
    end
  end

  defp outbound_messages(trace_file) do
    trace_file
    |> File.read!()
    |> String.split("\n", trim: true)
    |> Enum.map(fn "JSON:" <> json -> Jason.decode!(json) end)
  end

  defp message_with_method(messages, method) do
    Enum.find(messages, &(Map.get(&1, "method") == method))
  end

  defp messages_with_method(messages, method) do
    Enum.filter(messages, &(Map.get(&1, "method") == method))
  end

  defp turn_prompt(%{"params" => %{"input" => input}}) when is_list(input) do
    Enum.map_join(input, "\n", &Map.get(&1, "text", ""))
  end

  defp message_order(messages) do
    Enum.map(messages, &Map.get(&1, "method"))
  end
end
