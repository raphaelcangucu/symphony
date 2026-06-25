defmodule SymphonyElixir.AgentRunnerTest do
  use SymphonyElixir.TestSupport

  setup do
    migrate_repo()
    clean_repo()
    seed_project_with_prompt("mac", "Ticket {{ issue.identifier }}")
    :ok
  end

  defp seed_project_with_prompt(slug, prompt, workflow_config \\ %{}) do
    {:ok, project} =
      SymphonyElixir.LocalTracker.Context.ensure_project(%{name: slug, slug: slug, tracker_kind: "local"})

    {:ok, _setup} =
      %SymphonyElixir.LocalTracker.ProjectSetup{}
      |> SymphonyElixir.LocalTracker.ProjectSetup.changeset(%{
        project_id: project.id,
        workflow_markdown: SymphonyElixir.Workflow.to_markdown(workflow_config, prompt || ""),
        validation_commands: %{"commands" => []},
        scan_summary: %{}
      })
      |> SymphonyElixir.Repo.insert()

    project
  end

  test "explicit issue.agent_kind always wins" do
    issue = %SymphonyElixir.Issue{identifier: "X-1", agent_kind: "claude", project_slug: "alpha"}
    assert SymphonyElixir.AgentRunner.issue_agent_kind(issue) == "claude"
  end

  test "explicit issue.agent_kind wins regardless of project config" do
    issue = %SymphonyElixir.Issue{identifier: "A-1", project_slug: "mac", agent_kind: "claude"}
    assert SymphonyElixir.AgentRunner.issue_agent_kind(issue) == "claude"
  end

  test "falls back to codex when there is no slug and no user default" do
    issue = %SymphonyElixir.Issue{identifier: "G-1", project_slug: nil, agent_kind: nil}
    assert SymphonyElixir.AgentRunner.issue_agent_kind(issue) == "codex"
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

      after_create_hook =
        "mkdir -p docs/superpowers && printf '%s\\n' '# Handoff' 'from runner workspace' > docs/superpowers/handoff.md"

      write_workflow_file!(Workflow.workflow_file_path(),
        workspace_root: workspace_root,
        command: "#{codex_binary} app-server",
        prompt: "Ticket {{ issue.identifier }}"
      )

      seed_project_with_prompt("mac-artifacts", "Ticket {{ issue.identifier }}", %{
        "hooks" => %{"after_create" => after_create_hook}
      })

      issue = %Issue{
        identifier: "MAC-10",
        project_slug: "mac-artifacts",
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
        project_slug: "mac",
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
               "params" => %{"threadId" => "thread-runner-goal", "objective" => "Ship from runner", "status" => "active"}
             }
    after
      File.rm_rf(test_root)
    end
  end

  test "resumes the issue's durable Codex goal thread and pursues its native goal" do
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
          *'"method":"thread/resume"'*)
            printf '%s\\n' '{"id":5,"result":{"thread":{"id":"thread-runner-issue-goal"}}}'
            ;;
          *'"method":"thread/goal/get"'*)
            printf '%s\\n' '{"id":6,"result":{"goal":{"objective":"Ship from issue","status":"active"}}}'
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

      # The issue owns a durable Codex goal thread; `agent_goal` is a stale cache
      # that must NOT be re-seeded onto the native thread.
      issue = %Issue{
        identifier: "MAC-12",
        project_slug: "mac",
        title: "Pursue durable goal",
        description: "Runner should resume the durable Codex goal thread",
        state: "In Progress",
        agent_kind: "codex",
        agent_session_id: "thread-runner-issue-goal",
        agent_goal: "  Stale cached goal  "
      }

      assert :ok = AgentRunner.run(issue)

      messages =
        trace_file
        |> File.read!()
        |> String.split("\n", trim: true)
        |> Enum.map(&String.trim_leading(&1, "JSON:"))
        |> Enum.map(&Jason.decode!/1)

      methods = Enum.map(messages, &Map.get(&1, "method"))

      assert "thread/resume" in methods
      assert "thread/goal/get" in methods
      refute "thread/start" in methods

      # The native goal is authoritative: a resumed active goal is not overwritten
      # with the stale cached objective.
      refute "thread/goal/set" in methods

      assert Enum.find(messages, &(Map.get(&1, "method") == "thread/resume"))["params"]["threadId"] ==
               "thread-runner-issue-goal"
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
        project_slug: "mac",
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

  test "run/3 reports {:incomplete, :max_turns} when the loop exhausts turns with the issue still active" do
    test_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-elixir-agent-runner-incomplete-#{System.unique_integer([:positive])}"
      )

    try do
      workspace_root = Path.join(test_root, "workspaces")
      codex_binary = Path.join(test_root, "fake-codex")
      trace_file = Path.join(test_root, "codex-incomplete.trace")

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
            printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-incomplete"}}}'
            ;;
          *'"method":"turn/start"'*)
            printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-incomplete"}}}'
            printf '%s\\n' '{"method":"turn/completed"}'
            ;;
        esac
      done
      """)

      File.chmod!(codex_binary, 0o755)

      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "local",
        workspace_root: workspace_root,
        command: "#{codex_binary} app-server",
        prompt: "Ticket {{ issue.identifier }}"
      )

      issue = %Issue{
        id: "issue-incomplete",
        identifier: "MAC-99",
        project_slug: "mac",
        title: "Never finishes",
        state: "In Progress"
      }

      issue_state_fetcher = fn ["issue-incomplete"] -> {:ok, [%{issue | state: "In Progress"}]} end

      assert :ok =
               AgentRunner.run(issue, self(),
                 max_turns: 2,
                 continuation_delay_ms: 0,
                 issue_state_fetcher: issue_state_fetcher,
                 # Keep the outer loop alive: the fake agent does no git work, so the
                 # handoff gate would otherwise stop early as :completed. This test is
                 # about exhausting the turn budget, not the handoff gate itself.
                 handoff_ready_evaluator: fn _ws -> :continue end
               )

      assert_received {:agent_outcome, "issue-incomplete", {:incomplete, :max_turns}}
    after
      File.rm_rf(test_root)
    end
  end

  test "run/3 pauses for continuation_delay_ms between continuation turns" do
    test_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-elixir-agent-runner-delay-#{System.unique_integer([:positive])}"
      )

    try do
      workspace_root = Path.join(test_root, "workspaces")
      codex_binary = Path.join(test_root, "fake-codex")

      File.mkdir_p!(test_root)

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
            printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-delay"}}}'
            ;;
          *'"method":"turn/start"'*)
            printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-delay"}}}'
            printf '%s\\n' '{"method":"turn/completed"}'
            ;;
        esac
      done
      """)

      File.chmod!(codex_binary, 0o755)

      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "local",
        workspace_root: workspace_root,
        command: "#{codex_binary} app-server",
        prompt: "Ticket {{ issue.identifier }}"
      )

      issue = %Issue{
        id: "issue-delay",
        identifier: "MAC-DELAY",
        project_slug: "mac",
        title: "Loops with delay",
        state: "In Progress"
      }

      issue_state_fetcher = fn ["issue-delay"] -> {:ok, [%{issue | state: "In Progress"}]} end

      delay_ms = 100

      {elapsed_us, :ok} =
        :timer.tc(fn ->
          AgentRunner.run(issue, self(),
            max_turns: 3,
            continuation_delay_ms: delay_ms,
            issue_state_fetcher: issue_state_fetcher,
            # Keep the outer loop alive so the continuation delay is actually
            # exercised across turns (the fake agent does no git work).
            handoff_ready_evaluator: fn _ws -> :continue end
          )
        end)

      assert_received {:agent_outcome, "issue-delay", {:incomplete, :max_turns}}

      # 3 turns means 2 continuation pauses of delay_ms each.
      assert elapsed_us >= 2 * delay_ms * 1000 * 0.75
    after
      File.rm_rf(test_root)
    end
  end

  test "claude execution sessions carry Symphony dynamic tools" do
    issue = %SymphonyElixir.Issue{id: "1", identifier: "X-1"}

    opts = AgentRunner.claude_session_opts([workspace_root: "/tmp"], "claude", issue)

    specs = Keyword.fetch!(opts, :dynamic_tools)
    assert Enum.any?(specs, &(&1["name"] == "set_issue_status"))

    executor = Keyword.fetch!(opts, :tool_executor)
    assert is_function(executor, 2)
  end

  test "claude_session_opts is a no-op for non-claude agents" do
    issue = %SymphonyElixir.Issue{id: "1", identifier: "X-1"}
    assert AgentRunner.claude_session_opts([], "codex", issue) == []
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
