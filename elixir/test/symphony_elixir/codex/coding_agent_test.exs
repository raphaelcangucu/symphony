defmodule SymphonyElixir.Codex.CodingAgentTest do
  use SymphonyElixir.TestSupport

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

        assert message_order(messages) == ["initialize", "initialized", "thread/start", "thread/goal/set", "turn/start"]
      end)
    end

    test "continues without setting a goal for whitespace-only goal text" do
      with_fake_goal_server(fn workspace, issue, trace_file ->
        enable_goals!()

        assert {:ok, _result} =
                 AppServer.run(workspace, "Build the feature", issue, goal: " \n\t ")

        messages = outbound_messages(trace_file)

        refute message_with_method(messages, "thread/goal/set")
        assert message_order(messages) == ["initialize", "initialized", "thread/start", "turn/start"]
      end)
    end

    test "warns and continues without setting a goal for non-binary goal values" do
      with_fake_goal_server(fn workspace, issue, trace_file ->
        enable_goals!()

        log =
          capture_log(fn ->
            assert {:ok, _result} =
                     AppServer.run(workspace, "Build the feature", issue, goal: false)
          end)

        messages = outbound_messages(trace_file)

        refute message_with_method(messages, "thread/goal/set")
        assert message_order(messages) == ["initialize", "initialized", "thread/start", "turn/start"]
        assert log =~ "Codex goal option must be a string"
      end)
    end

    test "warns and continues without setting a goal when goals are disabled" do
      with_fake_goal_server(fn workspace, issue, trace_file ->
        log =
          capture_log(fn ->
            assert {:ok, _result} =
                     AppServer.run(workspace, "Build the feature", issue, goal: "Ship the feature")
          end)

        messages = outbound_messages(trace_file)

        refute message_with_method(messages, "thread/goal/set")
        assert message_order(messages) == ["initialize", "initialized", "thread/start", "turn/start"]
        assert log =~ "Codex goal provided but goal mode is disabled"
      end)
    end

    test "warns and continues when Codex rejects the goal-set request" do
      with_fake_goal_server(:goal_error, fn workspace, issue, trace_file ->
        enable_goals!()

        log =
          capture_log(fn ->
            assert {:ok, _result} =
                     AppServer.run(workspace, "Build the feature", issue, goal: "Ship the feature")
          end)

        messages = outbound_messages(trace_file)

        assert message_with_method(messages, "thread/goal/set")
        assert message_order(messages) == ["initialize", "initialized", "thread/start", "thread/goal/set", "turn/start"]
        assert log =~ "Codex failed to set thread goal"
      end)
    end

    test "auto-continues while completed turns report an active goal" do
      with_fake_goal_server([:active, :completed], fn workspace, issue, trace_file ->
        enable_goals!()

        assert {:ok, result} =
                 AppServer.run(workspace, "Build the feature", issue, goal: "Ship the feature")

        messages = outbound_messages(trace_file)
        turn_starts = messages_with_method(messages, "turn/start")

        assert result[:result] == :turn_completed
        assert length(turn_starts) == 2

        assert turn_prompt(Enum.at(turn_starts, 0)) =~ "Build the feature"

        assert turn_prompt(Enum.at(turn_starts, 1)) =~
                 "Continue working toward the active goal"
      end)
    end

    test "stops auto-continuation when completed turns report a blocked goal" do
      with_fake_goal_server([:blocked, :active], fn workspace, issue, trace_file ->
        enable_goals!()

        assert {:ok, _result} =
                 AppServer.run(workspace, "Build the feature", issue, goal: "Ship the feature")

        messages = outbound_messages(trace_file)

        assert messages_with_method(messages, "thread/goal/set") |> length() == 1
        assert messages_with_method(messages, "turn/start") |> length() == 1
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

  defp write_goal_fake_codex!(codex_binary, trace_file, response_mode) do
    goal_response =
      case response_mode do
        statuses when is_list(statuses) -> ~s({"id":4,"result":{}})
        :goal_ok -> ~s({"id":4,"result":{}})
        :goal_error -> ~s({"id":4,"error":{"code":-32601,"message":"Method not found"}})
      end

    turn_completion_cases =
      response_mode
      |> turn_completion_statuses()
      |> Enum.with_index(1)
      |> Enum.map_join("\n", fn {status, index} ->
        """
                  #{index})
                    printf '%s\\n' '#{turn_completed_payload(status)}'
                    ;;
        """
      end)

    turn_completion_count = length(turn_completion_statuses(response_mode))

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
        *'"method":"turn/start"'*)
          turn_count=$((turn_count + 1))
          printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-goal"}}}'
          case "$turn_count" in
    #{turn_completion_cases}
            *)
              printf '%s\\n' '{"method":"turn/completed"}'
              ;;
          esac
          if [ "$turn_count" -ge #{turn_completion_count} ]; then
            exit 0
          fi
          ;;
        *)
          ;;
      esac
    done
    """)

    File.chmod!(codex_binary, 0o755)
  end

  defp turn_completion_statuses(statuses) when is_list(statuses), do: statuses
  defp turn_completion_statuses(_response_mode), do: [:unknown]

  defp turn_completed_payload(:active),
    do: ~s({"method":"turn/completed","params":{"goal":{"status":"active"}}})

  defp turn_completed_payload(:completed),
    do: ~s({"method":"turn/completed","params":{"goal":{"status":"completed"}}})

  defp turn_completed_payload(:blocked),
    do: ~s({"method":"turn/completed","params":{"goal":{"status":"blocked"}}})

  defp turn_completed_payload(:unknown), do: ~s({"method":"turn/completed"})

  defp enable_goals! do
    workflow_file = Workflow.workflow_file_path()

    updated_workflow =
      workflow_file
      |> File.read!()
      |> String.replace("codex:\n", "codex:\n  goals_enabled: true\n", global: false)

    File.write!(workflow_file, updated_workflow)
    :ok
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
