defmodule SymphonyElixir.Codex.CodingAgentSteerTest do
  use SymphonyElixir.TestSupport

  test "writes turn/steer with the active expectedTurnId when steered mid-turn" do
    with_fake_steer_server(fn workspace, issue, trace_file ->
      test_pid = self()

      runner =
        Task.async(fn ->
          AppServer.run(workspace, "Build the feature", issue,
            on_message: fn message ->
              if Map.get(message, :event) == :session_started do
                send(test_pid, {:turn_started, Map.get(message, :turn_id)})
              end
            end
          )
        end)

      # Wait until the turn is actually running and we know its id.
      assert_receive {:turn_started, "turn-steer"}, 2_000

      # Steer the in-flight turn; the fake server only completes after it sees turn/steer.
      send(runner.pid, {:codex_steer, [%{"type" => "text", "text" => "Focus on tests"}], self()})

      assert {:ok, _result} = Task.await(runner, 5_000)

      messages = outbound_messages(trace_file)
      steer = message_with_method(messages, "turn/steer")

      assert steer["params"]["threadId"] == "thread-steer"
      assert steer["params"]["expectedTurnId"] == "turn-steer"
      assert steer["params"]["input"] == [%{"type" => "text", "text" => "Focus on tests"}]
    end)
  end

  defp with_fake_steer_server(fun) when is_function(fun, 3) do
    test_root =
      Path.join(System.tmp_dir!(), "symphony-coding-agent-steer-#{System.unique_integer([:positive])}")

    try do
      workspace_root = Path.join(test_root, "workspaces")
      workspace = Path.join(workspace_root, "MT-STEER")
      codex_binary = Path.join(test_root, "fake-codex")
      trace_file = Path.join(test_root, "codex-steer.trace")

      File.mkdir_p!(workspace)
      write_steer_fake_codex!(codex_binary, trace_file)

      write_workflow_file!(Workflow.workflow_file_path(),
        workspace_root: workspace_root,
        command: "#{codex_binary} app-server"
      )

      issue = %Issue{
        id: "issue-steer",
        identifier: "MT-STEER",
        title: "Steer mode",
        description: "Exercise turn/steer",
        state: "In Progress",
        url: "https://example.org/issues/MT-STEER",
        labels: ["backend"]
      }

      fun.(workspace, issue, trace_file)
    after
      File.rm_rf(test_root)
    end
  end

  # The fake server answers init/thread/turn-start, then blocks reading stdin until it
  # receives the turn/steer line, answers it, and only then completes the turn.
  defp write_steer_fake_codex!(codex_binary, trace_file) do
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
          printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-steer"}}}'
          ;;
        *'"method":"turn/start"'*)
          printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-steer"}}}'
          printf '%s\\n' '{"method":"turn/started","params":{"turn":{"id":"turn-steer"}}}'
          ;;
        *'"method":"turn/steer"'*)
          printf '%s\\n' '{"id":100,"result":{"turnId":"turn-steer"}}'
          printf '%s\\n' '{"method":"turn/completed","params":{"turn":{"id":"turn-steer","status":"completed"}}}'
          exit 0
          ;;
        *)
          ;;
      esac
    done
    """)

    File.chmod!(codex_binary, 0o755)
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
end
