defmodule SymphonyElixir.AgentRunnerTest do
  use SymphonyElixir.TestSupport

  setup do
    migrate_repo()
    clean_repo()
    :ok
  end

  test "explicit issue.agent_kind always wins" do
    issue = %SymphonyElixir.Issue{identifier: "X-1", agent_kind: "claude", project_slug: "alpha"}
    assert SymphonyElixir.AgentRunner.issue_agent_kind(issue) == "claude"
  end

  test "uses the project's resolved agent kind when issue.agent_kind is blank" do
    {:ok, project} =
      SymphonyElixir.LocalTracker.Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "local"})

    {:ok, _setup} =
      %SymphonyElixir.LocalTracker.ProjectSetup{}
      |> SymphonyElixir.LocalTracker.ProjectSetup.changeset(%{
        project_id: project.id,
        workflow_config: %{},
        validation_commands: %{"commands" => []},
        scan_summary: %{}
      })
      |> SymphonyElixir.Repo.insert()

    issue = %SymphonyElixir.Issue{identifier: "A-1", project_slug: "alpha", agent_kind: nil}
    assert SymphonyElixir.AgentRunner.issue_agent_kind(issue) == SymphonyElixir.Config.default_agent_kind()
  end

  test "falls back to the global default when there is no slug" do
    issue = %SymphonyElixir.Issue{identifier: "G-1", project_slug: nil, agent_kind: nil}
    assert SymphonyElixir.AgentRunner.issue_agent_kind(issue) == SymphonyElixir.Config.default_agent_kind()
  end

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

  test "passes goal option through to Codex app-server sessions" do
    test_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-elixir-agent-runner-goal-#{System.unique_integer([:positive])}"
      )

    try do
      workspace_root = Path.join(test_root, "workspaces")
      codex_binary = Path.join(test_root, "fake-codex")
      trace_file = Path.join(test_root, "codex-goal.trace")

      File.mkdir_p!(test_root)

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
            printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-runner-goal"}}}'
            ;;
          *'"method":"thread/goal/set"'*)
            printf '%s\\n' '{"id":4,"result":{}}'
            ;;
          *'"method":"turn/start"'*)
            printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-runner-goal"}}}'
            printf '%s\\n' '{"method":"turn/completed","params":{"goal":{"status":"completed"}}}'
            exit 0
            ;;
        esac
      done
      """)

      File.chmod!(codex_binary, 0o755)

      write_workflow_file!(Workflow.workflow_file_path(),
        workspace_root: workspace_root,
        command: "#{codex_binary} app-server",
        prompt: "Ticket {{ issue.identifier }}"
      )

      enable_goals!()

      issue = %Issue{
        identifier: "MAC-11",
        title: "Pass goal option",
        description: "Runner should pass goal",
        state: "In Progress"
      }

      assert :ok = AgentRunner.run(issue, nil, goal: "  Ship from runner  ")

      messages =
        trace_file
        |> File.read!()
        |> String.split("\n", trim: true)
        |> Enum.map(&String.trim_leading(&1, "JSON:"))
        |> Enum.map(&Jason.decode!/1)

      assert Enum.find(messages, &(Map.get(&1, "method") == "thread/goal/set")) == %{
               "id" => 4,
               "method" => "thread/goal/set",
               "params" => %{"threadId" => "thread-runner-goal", "goal" => "Ship from runner"}
             }
    after
      File.rm_rf(test_root)
    end
  end

  test "passes issue goal through to Codex app-server sessions" do
    test_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-elixir-agent-runner-issue-goal-#{System.unique_integer([:positive])}"
      )

    try do
      workspace_root = Path.join(test_root, "workspaces")
      codex_binary = Path.join(test_root, "fake-codex")
      trace_file = Path.join(test_root, "codex-issue-goal.trace")

      File.mkdir_p!(test_root)

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
            printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-runner-issue-goal"}}}'
            ;;
          *'"method":"thread/goal/set"'*)
            printf '%s\\n' '{"id":4,"result":{}}'
            ;;
          *'"method":"turn/start"'*)
            printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-runner-issue-goal"}}}'
            printf '%s\\n' '{"method":"turn/completed","params":{"goal":{"status":"completed"}}}'
            exit 0
            ;;
        esac
      done
      """)

      File.chmod!(codex_binary, 0o755)

      write_workflow_file!(Workflow.workflow_file_path(),
        workspace_root: workspace_root,
        command: "#{codex_binary} app-server",
        prompt: "Ticket {{ issue.identifier }}"
      )

      enable_goals!()

      issue = %Issue{
        identifier: "MAC-12",
        title: "Pass issue goal",
        description: "Runner should pass issue goal",
        state: "In Progress",
        agent_kind: "codex",
        agent_goal: "  Ship from issue  "
      }

      assert :ok = AgentRunner.run(issue)

      messages =
        trace_file
        |> File.read!()
        |> String.split("\n", trim: true)
        |> Enum.map(&String.trim_leading(&1, "JSON:"))
        |> Enum.map(&Jason.decode!/1)

      assert Enum.find(messages, &(Map.get(&1, "method") == "thread/goal/set")) == %{
               "id" => 4,
               "method" => "thread/goal/set",
               "params" => %{"threadId" => "thread-runner-issue-goal", "goal" => "Ship from issue"}
             }
    after
      File.rm_rf(test_root)
    end
  end

  test "does not reset goal turn budget through the outer runner loop" do
    test_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-elixir-agent-runner-goal-budget-#{System.unique_integer([:positive])}"
      )

    try do
      workspace_root = Path.join(test_root, "workspaces")
      codex_binary = Path.join(test_root, "fake-codex")
      trace_file = Path.join(test_root, "codex-goal-budget.trace")

      File.mkdir_p!(test_root)

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
            printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-runner-goal-budget"}}}'
            ;;
          *'"method":"thread/goal/set"'*)
            printf '%s\\n' '{"id":4,"result":{}}'
            ;;
          *'"method":"turn/start"'*)
            printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-runner-goal-budget"}}}'
            printf '%s\\n' '{"method":"turn/completed","params":{"goal":{"status":"active"}}}'
            ;;
        esac
      done
      """)

      File.chmod!(codex_binary, 0o755)

      write_workflow_file!(Workflow.workflow_file_path(),
        workspace_root: workspace_root,
        command: "#{codex_binary} app-server",
        prompt: "Ticket {{ issue.identifier }}"
      )

      enable_goals!()

      issue = %Issue{
        id: "issue-runner-goal-budget",
        identifier: "MAC-12",
        title: "Keep goal budget scoped",
        description: "Runner should not reset goal budget",
        state: "In Progress"
      }

      issue_state_fetcher = fn ["issue-runner-goal-budget"] -> {:ok, [%{issue | state: "In Progress"}]} end

      assert :ok =
               AgentRunner.run(issue, nil,
                 goal: "  Ship with one budget  ",
                 max_goal_turns: 2,
                 max_turns: 3,
                 issue_state_fetcher: issue_state_fetcher
               )

      messages =
        trace_file
        |> File.read!()
        |> String.split("\n", trim: true)
        |> Enum.map(&String.trim_leading(&1, "JSON:"))
        |> Enum.map(&Jason.decode!/1)

      assert messages |> messages_with_method("thread/goal/set") |> length() == 1
      assert messages |> messages_with_method("turn/start") |> length() == 2
    after
      File.rm_rf(test_root)
    end
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

  defp messages_with_method(messages, method) do
    Enum.filter(messages, &(Map.get(&1, "method") == method))
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(SymphonyElixir.Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(SymphonyElixir.Repo)
  end
end
