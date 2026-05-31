defmodule SymphonyElixir.AgentRunnerTest do
  use SymphonyElixir.TestSupport

  test "passes workspace artifacts into the first agent turn prompt" do
    test_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-elixir-agent-runner-artifacts-#{System.unique_integer([:positive])}"
      )

    try do
      workspace_root = Path.join(test_root, "workspaces")
      codex_binary = Path.join(test_root, "fake-codex")
      trace_file = Path.join(test_root, "codex.trace")
      previous_trace = System.get_env("SYMP_TEST_CODEX_ARTIFACT_TRACE")

      on_exit(fn ->
        if is_binary(previous_trace) do
          System.put_env("SYMP_TEST_CODEX_ARTIFACT_TRACE", previous_trace)
        else
          System.delete_env("SYMP_TEST_CODEX_ARTIFACT_TRACE")
        end
      end)

      File.mkdir_p!(test_root)
      System.put_env("SYMP_TEST_CODEX_ARTIFACT_TRACE", trace_file)

      File.write!(codex_binary, """
      #!/bin/sh
      trace_file="${SYMP_TEST_CODEX_ARTIFACT_TRACE:-/tmp/codex-artifacts.trace}"
      count=0

      while IFS= read -r line; do
        count=$((count + 1))
        printf 'JSON:%s\\n' "$line" >> "$trace_file"
        case "$count" in
          1)
            printf '%s\\n' '{"id":1,"result":{}}'
            ;;
          2)
            ;;
          3)
            printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-artifacts"}}}'
            ;;
          4)
            printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-artifacts"}}}'
            printf '%s\\n' '{"method":"turn/completed"}'
            exit 0
            ;;
        esac
      done
      """)

      File.chmod!(codex_binary, 0o755)

      write_workflow_file!(Workflow.workflow_file_path(),
        workspace_root: workspace_root,
        hook_after_create: "mkdir -p docs/superpowers && printf '%s\\n' '# Handoff' 'from runner workspace' > docs/superpowers/handoff.md",
        command: "#{codex_binary} app-server",
        prompt: "Ticket {{ issue.identifier }}"
      )

      issue = %Issue{
        identifier: "MAC-10",
        title: "Inject workspace artifacts",
        description: "Runner should pass workspace",
        state: "In Progress"
      }

      assert :ok = AgentRunner.run(issue)

      turn_prompt =
        trace_file
        |> File.read!()
        |> String.split("\n", trim: true)
        |> Enum.map(&String.trim_leading(&1, "JSON:"))
        |> Enum.map(&Jason.decode!/1)
        |> Enum.find_value(fn
          %{"method" => "turn/start", "params" => %{"input" => input}} ->
            Enum.map_join(input, "\n", &Map.get(&1, "text", ""))

          _payload ->
            nil
        end)

      assert turn_prompt =~ "Ticket MAC-10"
      assert turn_prompt =~ "docs/superpowers/handoff.md"
      assert turn_prompt =~ "Handoff"
      assert turn_prompt =~ "from runner workspace"
    after
      System.delete_env("SYMP_TEST_CODEX_ARTIFACT_TRACE")
      File.rm_rf(test_root)
    end
  end
end
