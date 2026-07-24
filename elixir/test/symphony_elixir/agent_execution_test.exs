defmodule SymphonyElixir.AgentExecutionTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentExecution
  alias SymphonyElixir.Claude.GoalStore
  alias SymphonyElixir.Codex.Session, as: CodexStore
  alias SymphonyElixir.SessionEvents
  alias SymphonyElixir.Workspace

  defmodule SnapshotStub do
    use GenServer

    def start_link(snapshot), do: GenServer.start_link(__MODULE__, snapshot, name: __MODULE__)

    @impl true
    def init(snapshot), do: {:ok, snapshot}

    @impl true
    def handle_call(:snapshot, _from, snapshot), do: {:reply, snapshot, snapshot}
  end

  setup do
    previous_sessions_dir = Application.get_env(:symphony_elixir, :codex_sessions_dir)

    on_exit(fn ->
      case previous_sessions_dir do
        nil -> Application.delete_env(:symphony_elixir, :codex_sessions_dir)
        value -> Application.put_env(:symphony_elixir, :codex_sessions_dir, value)
      end
    end)

    :ok
  end

  defp running_entry(overrides) do
    Map.merge(
      %{
        issue_id: "issue-1",
        identifier: "SYM-1",
        state: "In Progress",
        session_id: "thread-turn",
        agent_input_tokens: 10,
        agent_output_tokens: 20,
        agent_total_tokens: 30,
        turn_count: 2,
        started_at: DateTime.utc_now(),
        last_codex_timestamp: DateTime.utc_now(),
        last_codex_message: nil,
        last_codex_event: :notification,
        runtime_seconds: 42
      },
      overrides
    )
  end

  describe "from_snapshot/1" do
    test "marks recently active running issues as live" do
      snapshot = %{running: [running_entry(%{})], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.issue_id == "issue-1"
      assert execution.issue_identifier == "SYM-1"
      assert execution.status == :live
      assert execution.session_id == "thread-turn"
      assert execution.turn_count == 2
      assert execution.tokens == %{input: 10, output: 20, total: 30}
      refute execution.long_running
      assert execution.long_running_kind == nil
      assert execution.long_running_label == nil
    end

    test "defaults bundle role to standalone for ordinary runs" do
      snapshot = %{running: [running_entry(%{})], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.bundle_role == :standalone
      assert execution.parent_identifier == nil
      assert execution.unit_id == nil
      assert execution.repo == nil
      assert execution.child_identifiers == []
    end

    test "projects parent coordinator bundle context" do
      entry = running_entry(%{bundle_role: :parent, child_identifiers: ["SYM-2", "SYM-3"]})
      snapshot = %{running: [entry], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.bundle_role == :parent
      assert execution.child_identifiers == ["SYM-2", "SYM-3"]
      assert execution.parent_identifier == nil
    end

    test "projects child run bundle context" do
      entry =
        running_entry(%{
          identifier: "SYM-2",
          bundle_role: :child,
          parent_identifier: "SYM-1",
          unit_id: "be",
          repo: "macro/be"
        })

      snapshot = %{running: [entry], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.bundle_role == :child
      assert execution.parent_identifier == "SYM-1"
      assert execution.unit_id == "be"
      assert execution.repo == "macro/be"
      assert execution.child_identifiers == []
    end

    test "marks Codex goal executions as pursuing a goal from native goal data" do
      goal = %{
        kind: "goal",
        source: "native",
        status: "active",
        objective: "Ship the issue",
        capabilities: ["get", "edit", "clear"]
      }

      snapshot = %{running: [running_entry(%{agent_kind: "codex", goal: goal})], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.long_running
      assert execution.long_running_kind == "goal"
      assert execution.long_running_label == "Pursuing goal"
      assert execution.goal.objective == "Ship the issue"
    end

    test "marks Claude goal executions as pursuing a workflow" do
      snapshot = %{running: [running_entry(%{agent_kind: "claude", agent_goal: "Ship the issue"})], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.long_running
      assert execution.long_running_kind == "workflow"
      assert execution.long_running_label == "Pursuing workflow"
    end

    test "projects a cleared Claude sidecar canonically without resurrecting cached workflow" do
      identifier = "SYM-CLAUDE-CLEARED"
      issue_ref = %{identifier: identifier, project_slug: nil}
      workspace = Workspace.path_for_issue(issue_ref)
      on_exit(fn -> File.rm_rf(workspace) end)

      assert :ok =
               GoalStore.put(workspace, :execution, %{
                 "status" => "running",
                 "objective" => "Native objective",
                 "pending_command" => "clear"
               })

      assert {:ok, %{"revision" => revision}} = GoalStore.read(workspace, :execution)
      assert :ok = GoalStore.acknowledge_pending(workspace, :execution, :clear, revision, nil)

      entry =
        running_entry(%{
          identifier: identifier,
          agent_kind: "claude",
          agent_goal: "Stale cached workflow",
          issue: issue_ref
        })

      assert [execution] = AgentExecution.from_snapshot(%{running: [entry], retrying: []})
      assert execution.goal.kind == "goal"
      assert execution.goal.source == "claude"
      assert execution.goal.status == "completed"
      assert execution.goal.objective == nil
      refute execution.goal.kind == "workflow"
    end

    test "Codex running entries ignore the cached agent_goal (Codex thread is the source of truth)" do
      snapshot = %{running: [running_entry(%{agent_kind: "codex", agent_goal: "Ship the issue"})], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      # No native goal data (no orchestrator goal, no workspace mirror), so the
      # cached agent_goal must NOT be surfaced as a Codex goal.
      assert execution.goal == nil
      refute execution.long_running
    end

    test "Codex running entries surface the native goal mirror from the workspace sidecar" do
      identifier = "SYM-MIRROR-1"
      issue_ref = %{identifier: identifier, project_slug: nil}
      workspace = Workspace.path_for_issue(issue_ref)
      on_exit(fn -> File.rm_rf(workspace) end)

      :ok = CodexStore.put_goal(workspace, %{"objective" => "Pursue the native goal", "status" => "active"})

      entry = running_entry(%{identifier: identifier, agent_kind: "codex", issue: issue_ref})
      snapshot = %{running: [entry], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.goal.kind == "goal"
      assert execution.goal.source == "native"
      assert execution.goal.objective == "Pursue the native goal"
      # Projected (non-live-thread) capabilities include stopping the live
      # orchestrator run; native pause/resume still require a resolvable thread.
      assert execution.goal.capabilities == ["get", "edit", "clear", "stop"]
      assert execution.long_running
      assert execution.long_running_label == "Pursuing goal"
    end

    test "marks running issues with stale activity as idle" do
      stale = DateTime.add(DateTime.utc_now(), -10 * 60, :second)
      snapshot = %{running: [running_entry(%{last_codex_timestamp: stale})], retrying: []}

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.status == :idle
    end

    test "surfaces the real run failure for interrupted stale Codex runs" do
      identifier = "SYM-RUNFAIL-#{System.unique_integer([:positive])}"
      issue = %{identifier: identifier, project_slug: nil, labels: ["backend"], agent_kind: "codex"}
      workspace = Workspace.path_for_issue(issue)
      sessions_dir = Path.join(System.tmp_dir!(), "codex-sessions-#{System.unique_integer([:positive])}")
      thread_id = "thread-runfail"

      File.mkdir_p!(workspace)
      File.mkdir_p!(sessions_dir)
      Application.put_env(:symphony_elixir, :codex_sessions_dir, sessions_dir)

      on_exit(fn ->
        File.rm_rf(workspace)
        File.rm_rf(sessions_dir)
      end)

      :ok = CodexStore.write(workspace, thread_id)
      write_rollout!(sessions_dir, thread_id)

      message =
        "Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying."

      :ok = SessionEvents.append_run_failure(workspace, {:turn_failed, message})

      stale = DateTime.add(DateTime.utc_now(), -10 * 60, :second)

      snapshot = %{
        running: [
          running_entry(%{
            identifier: identifier,
            issue: issue,
            agent_kind: "codex",
            last_codex_timestamp: stale
          })
        ],
        retrying: []
      }

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.status == :aborted
      assert execution.last_message == message
      assert execution.error == message <> ". Use Resume in the execution panel."
      refute execution.error =~ "{:turn_failed"
      refute execution.error =~ "Turn aborted"
    end

    test "classifies operator-paused stale Codex runs as paused, not aborted" do
      identifier = "SYM-PAUSED-#{System.unique_integer([:positive])}"
      issue = %{identifier: identifier, project_slug: nil, labels: ["backend"], agent_kind: "codex"}
      workspace = Workspace.path_for_issue(issue)
      sessions_dir = Path.join(System.tmp_dir!(), "codex-sessions-#{System.unique_integer([:positive])}")
      thread_id = "thread-paused"

      File.mkdir_p!(workspace)
      File.mkdir_p!(sessions_dir)
      Application.put_env(:symphony_elixir, :codex_sessions_dir, sessions_dir)

      on_exit(fn ->
        File.rm_rf(workspace)
        File.rm_rf(sessions_dir)
      end)

      :ok = CodexStore.write(workspace, thread_id)
      write_rollout!(sessions_dir, thread_id)

      # A deliberate operator stop is recorded as a `user_stop` abort event.
      :ok = SessionEvents.append_abort(workspace, "user_stop", detail: "Stopped manually via hard reset")

      stale = DateTime.add(DateTime.utc_now(), -10 * 60, :second)

      snapshot = %{
        running: [
          running_entry(%{
            identifier: identifier,
            issue: issue,
            agent_kind: "codex",
            last_codex_timestamp: stale
          })
        ],
        retrying: []
      }

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.status == :paused
      assert execution.last_event == "turn_paused"
      # A pause is benign and resumable, so it carries no error.
      assert execution.error == nil
    end

    test "marks running issues awaiting input or approval as waiting" do
      input_required = running_entry(%{last_codex_event: :turn_input_required})
      approval = running_entry(%{identifier: "SYM-2", last_codex_event: :approval_required})

      statuses =
        %{running: [input_required, approval], retrying: []}
        |> AgentExecution.from_snapshot()
        |> Enum.map(& &1.status)

      assert statuses == [:waiting, :waiting]
    end

    test "projects retry entries with an error as error status" do
      snapshot = %{
        running: [],
        retrying: [%{issue_id: "issue-9", identifier: "SYM-9", attempt: 3, due_in_ms: 5_000, error: "boom"}]
      }

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.status == :error
      assert execution.issue_id == "issue-9"
      assert execution.issue_identifier == "SYM-9"
      assert execution.retry_attempt == 3
      assert execution.error == "boom"
    end

    test "projects retry entries without an error as retrying" do
      snapshot = %{
        running: [],
        retrying: [%{issue_id: "issue-9", identifier: "SYM-9", attempt: 2, due_in_ms: 5_000, error: nil}]
      }

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.status == :retrying
      assert execution.error == nil
    end

    test "prefers the running entry when an issue is both running and retrying" do
      snapshot = %{
        running: [running_entry(%{})],
        retrying: [%{issue_id: "issue-1", identifier: "SYM-1", attempt: 1, due_in_ms: 1_000, error: "stale"}]
      }

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.status == :live
    end

    test "from_snapshot/1 surfaces execution_session_id from the running entry" do
      snapshot = %{
        running: [running_entry(%{execution_session_id: 8015})],
        retrying: []
      }

      assert [execution] = AgentExecution.from_snapshot(snapshot)
      assert execution.execution_session_id == 8015
      # existing session_id (agent/codex) remains distinct
      assert execution.session_id == "thread-turn"
    end
  end

  describe "subagent_executions/2" do
    alias SymphonyElixir.Workpad.ExecutionBundle

    defp coordinator_bundle do
      %ExecutionBundle{
        version: 1,
        mode: "bundle",
        parent: "MAC-1",
        units: [
          %{
            id: "api",
            type: :child_run,
            issue: "MAC-12",
            repo: "macro/be",
            produces: ["schema"],
            consumes: [],
            depends_on: [],
            deliverable: "pr"
          },
          %{
            id: "ui",
            type: :child_run,
            issue: "MAC-13",
            repo: "macro/fe",
            produces: [],
            consumes: ["schema"],
            depends_on: ["api"],
            deliverable: "pr"
          }
        ],
        shared_contracts: [
          %{
            id: "schema",
            kind: "openapi",
            owner_unit: "api",
            consumers: ["ui"],
            artifact: "openapi.yaml",
            status: :draft
          }
        ]
      }
    end

    defp injected_resolvers do
      [
        bundle_loader: fn
          "MAC-1" -> {:ok, coordinator_bundle()}
          _ -> :error
        end,
        slug_resolver: fn _ -> "macro-markets" end,
        terminal_resolver: fn _ -> false end,
        state_resolver: fn _ -> "In Progress" end,
        issue_id_resolver: fn id -> "id-" <> id end,
        lab_bundle_child_orchestration: true
      ]
    end

    test "projects gated subagent units as :waiting executions nested under the parent" do
      snapshot = %{
        running: [
          %{identifier: "MAC-1", parent_identifier: nil, unit_id: nil},
          %{identifier: "MAC-12", parent_identifier: "MAC-1", unit_id: "MAC-12"}
        ],
        retrying: []
      }

      assert [waiting] = AgentExecution.subagent_executions(snapshot, injected_resolvers())

      assert waiting.issue_identifier == "MAC-13"
      assert waiting.status == :waiting
      assert waiting.bundle_role == :subagent
      assert waiting.parent_identifier == "MAC-1"
      assert waiting.unit_id == "ui"
      assert waiting.repo == "macro/fe"
      assert waiting.tokens == nil
      assert waiting.long_running == false
    end
  end

  describe "format_failure/1" do
    test "extracts turn_failed messages" do
      assert AgentExecution.format_failure({:turn_failed, "claude exited with code 1"}) ==
               "claude exited with code 1"
    end

    test "extracts inspected turn_failed messages" do
      message =
        "Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying."

      assert AgentExecution.format_failure("{:turn_failed, #{inspect(message)}}") == message
    end

    test "strips runtime error stack traces" do
      error =
        "{%RuntimeError{message: \"Agent run failed for issue_id=5 issue_identifier=1859: " <>
          "{:turn_failed, \\\"claude exited with code 1\\\"}\"}, " <>
          "[{SymphonyElixir.AgentRunner, :fail_run, 2, " <>
          "[file: ~c\"lib/symphony_elixir/agent_runner.ex\", line: 87]}]}"

      assert AgentExecution.format_failure("agent exited: " <> error) == "claude exited with code 1"
    end
  end

  describe "list/2 derivation from persisted execution sessions" do
    alias Ecto.Adapters.SQL
    alias SymphonyElixir.Agent.ExecutionSession
    alias SymphonyElixir.Repo

    setup do
      migrate_repo()
      SQL.query!(Repo, "DELETE FROM assistant_threads", [])
      :ok
    end

    test "derives an interrupted row from a real execution session, not workspace-log scanning" do
      {:ok, session} =
        ExecutionSession.ensure("advising", "CDE-9999",
          workspace_path: "/tmp/advising/CDE-9999",
          agent_kind: "codex"
        )

      {:ok, _finished} = ExecutionSession.finish(session.id, "aborted")

      start_supervised!({SnapshotStub, %{running: [], retrying: []}})

      executions = AgentExecution.list(SnapshotStub, 1_000)
      row = Enum.find(executions, &(&1.issue_identifier == "CDE-9999"))

      assert row
      assert row.status == :aborted
      assert row.session_id == to_string(session.id)
      assert row.execution_session_id == session.id
    end
  end

  defp write_rollout!(sessions_dir, thread_id) do
    path = Path.join([sessions_dir, "2026", "rollout-#{thread_id}.jsonl"])
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, ~s({"type":"event_msg","payload":{"type":"task_started"}}\n))
    :ok
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(SymphonyElixir.Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
