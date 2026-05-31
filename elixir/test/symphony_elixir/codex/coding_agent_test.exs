defmodule SymphonyElixir.Codex.CodingAgentTest do
  use SymphonyElixir.TestSupport

  describe "goal mode" do
    test "sets the thread goal after thread start and before turn start when goals are enabled" do
      with_fake_goal_server(fn workspace, issue, trace_file ->
        enable_goals!()

        assert {:ok, _result} =
                 AppServer.run(workspace, "Build the feature", issue, goal: "Ship the feature")

        messages = outbound_messages(trace_file)
        goal_message = message_with_method(messages, "thread/goal/set")

        assert goal_message == %{
                 "id" => 4,
                 "method" => "thread/goal/set",
                 "params" => %{"threadId" => "thread-goal", "goal" => "Ship the feature"}
               }

        assert message_order(messages) == ["initialize", "initialized", "thread/start", "thread/goal/set", "turn/start"]
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

  defp write_goal_fake_codex!(codex_binary, trace_file, response_mode) do
    goal_response =
      case response_mode do
        :goal_ok -> ~s({"id":4,"result":{}})
        :goal_error -> ~s({"id":4,"error":{"code":-32601,"message":"Method not found"}})
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
          printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-goal"}}}'
          ;;
        *'"method":"thread/goal/set"'*)
          printf '%s\\n' '#{goal_response}'
          ;;
        *'"method":"turn/start"'*)
          printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-goal"}}}'
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

  defp enable_goals! do
    workflow_file = Workflow.workflow_file_path()

    updated_workflow =
      workflow_file
      |> File.read!()
      |> String.replace("codex:\n", "codex:\n  goals_enabled: true\n", global: false)

    File.write!(workflow_file, updated_workflow)

    if Process.whereis(SymphonyElixir.WorkflowStore) do
      SymphonyElixir.WorkflowStore.force_reload()
    end

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

  defp message_order(messages) do
    Enum.map(messages, &Map.get(&1, "method"))
  end
end
