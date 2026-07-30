defmodule SymphonyElixir.Agent.ExecutionSessionTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias SymphonyElixir.Agent.ConversationRef
  alias SymphonyElixir.Agent.ExecutionSession
  alias SymphonyElixir.Agent.ExecutionTranscript
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Issue
  alias SymphonyElixir.Orchestrator
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    SQL.query!(Repo, "DELETE FROM assistant_threads", [])
    :ok
  end

  test "ensure/3 creates one issue_execution session and reuses it while active" do
    {:ok, s1} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "codex",
        requested_model: "gpt-5.6-sol",
        requested_effort: "low"
      )

    {:ok, s2} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "codex"
      )

    assert s1.id == s2.id
    assert s1.scope == "issue_execution"
    assert s1.metadata["origin"] == "orchestrator"
    assert s1.requested_model == "gpt-5.6-sol"
    assert s1.requested_effort == "low"
  end

  test "execution transcript stores the task brief and one readable message per completed turn" do
    {:ok, session} =
      ExecutionSession.ensure("advising", "CDE-1190",
        workspace_path: "/tmp/advising/CDE-1190",
        agent_kind: "codex",
        requested_model: "gpt-5.6-terra",
        requested_effort: "high"
      )

    entry = %{
      execution_session_id: session.id,
      issue: %Issue{
        identifier: "CDE-1190",
        title: "Implement transcript",
        description: "Persist the autonomous execution transcript."
      },
      agent_kind: "codex",
      model: "gpt-5.6-terra",
      turn_count: 1
    }

    {entry, true} =
      ExecutionTranscript.record(entry, %{
        event: :notification,
        timestamp: DateTime.utc_now(),
        payload: %{"method" => "item/agentMessage/delta", "params" => %{"delta" => "Implemented "}}
      })

    {entry, false} =
      ExecutionTranscript.record(entry, %{
        event: :notification,
        timestamp: DateTime.utc_now(),
        payload: %{"method" => "item/agentMessage/delta", "params" => %{"delta" => "the transcript."}}
      })

    {_entry, true} =
      ExecutionTranscript.record(entry, %{event: :turn_completed, timestamp: DateTime.utc_now()})

    messages = History.list_messages_for_thread(session.id)
    assert Enum.map(messages, & &1.role) == ["user", "assistant", "assistant"]
    assert Enum.at(messages, 0).content == "Persist the autonomous execution transcript."
    assert Enum.at(messages, 1).content =~ "Execution started for CDE-1190"
    assert Enum.at(messages, 2).content == "Implemented the transcript."
  end

  test "execution transcript separates provider progress updates while preserving streaming deltas" do
    {:ok, session} =
      ExecutionSession.ensure("advising", "CDE-1191",
        workspace_path: "/tmp/advising/CDE-1191",
        agent_kind: "codex"
      )

    entry = %{
      execution_session_id: session.id,
      issue: %Issue{identifier: "CDE-1191", title: "Readable timeline"},
      agent_kind: "codex",
      turn_count: 1
    }

    {entry, true} =
      ExecutionTranscript.record(entry, %{
        event: :notification,
        timestamp: DateTime.utc_now(),
        payload: %{"method" => "item/agentMessage/delta", "params" => %{"delta" => "First "}}
      })

    {entry, false} =
      ExecutionTranscript.record(entry, %{
        event: :notification,
        timestamp: DateTime.utc_now(),
        payload: %{"method" => "item/agentMessage/delta", "params" => %{"delta" => "sentence."}}
      })

    {entry, false} =
      ExecutionTranscript.record(entry, %{
        event: :notification,
        timestamp: DateTime.utc_now(),
        payload: %{"method" => "item/progress", "params" => %{"agent_message" => "Second update."}}
      })

    {_entry, true} =
      ExecutionTranscript.record(entry, %{event: :turn_completed, timestamp: DateTime.utc_now()})

    messages = History.list_messages_for_thread(session.id)
    assert Enum.at(messages, 2).content == "First sentence.\n\nSecond update."
  end

  test "execution transcript separates complete prose incorrectly sent as adjacent deltas" do
    {:ok, session} =
      ExecutionSession.ensure("advising", "CDE-1192",
        workspace_path: "/tmp/advising/CDE-1192",
        agent_kind: "codex"
      )

    entry = %{
      execution_session_id: session.id,
      issue: %Issue{identifier: "CDE-1192", title: "Readable provider updates"},
      agent_kind: "codex",
      turn_count: 1
    }

    {entry, true} =
      ExecutionTranscript.record(entry, %{
        event: :notification,
        timestamp: DateTime.utc_now(),
        payload: %{
          "method" => "item/agentMessage/delta",
          "params" => %{"delta" => "The review completed successfully."}
        }
      })

    {entry, false} =
      ExecutionTranscript.record(entry, %{
        event: :notification,
        timestamp: DateTime.utc_now(),
        payload: %{
          "method" => "item/agentMessage/delta",
          "params" => %{"delta" => "Publication remains blocked by authentication."}
        }
      })

    {_entry, true} =
      ExecutionTranscript.record(entry, %{event: :turn_completed, timestamp: DateTime.utc_now()})

    messages = History.list_messages_for_thread(session.id)

    assert Enum.at(messages, 2).content ==
             "The review completed successfully.\n\nPublication remains blocked by authentication."
  end

  test "reactivation clears requested provenance when explicit nil keys are supplied" do
    {:ok, original} =
      ExecutionSession.ensure("advising", "CDE-1182",
        workspace_path: "/tmp/advising/CDE-1182",
        agent_kind: "codex",
        requested_model: "gpt-5.5",
        requested_effort: "high"
      )

    {:ok, resumed} =
      ExecutionSession.ensure("advising", "CDE-1182",
        workspace_path: "/tmp/advising/CDE-1182",
        agent_kind: "codex",
        requested_model: nil,
        requested_effort: nil
      )

    assert resumed.id == original.id
    assert resumed.requested_model == nil
    assert resumed.requested_effort == nil
  end

  test "put_model_provenance/2 persists native model confirmation without metadata duplicates" do
    {:ok, session} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "cursor",
        requested_model: "composer-2.5"
      )

    assert {:ok, updated} =
             ExecutionSession.put_model_provenance(session.id,
               resolved_model: "composer-2.5",
               resolved_effort: "medium"
             )

    assert updated.requested_model == "composer-2.5"
    assert updated.resolved_model == "composer-2.5"
    assert updated.resolved_effort == nil
    refute Map.has_key?(updated.metadata, "model")
    refute Map.has_key?(updated.metadata, "effort")
  end

  test "put_provider_binding/3 preserves the provider-confirmed conversation identity" do
    {:ok, session} =
      ExecutionSession.ensure("advising", "CDE-1183",
        workspace_path: "/tmp/advising/CDE-1183",
        agent_kind: "cursor"
      )

    assert session.provider_bindings == %{}

    assert {:ok, updated} =
             ExecutionSession.put_provider_binding(
               session.id,
               "cursor",
               "auto-router-conversation-42"
             )

    assert updated.provider_bindings == %{"cursor" => "auto-router-conversation-42"}

    assert {:ok,
            %ConversationRef{
              provider: "cursor",
              conversation_id: "auto-router-conversation-42"
            }} = ExecutionSession.latest_conversation_ref("advising", "CDE-1183", "cursor")

    issue = %Issue{project_slug: "advising", identifier: "CDE-1183"}
    retry_opts = Orchestrator.agent_run_opts_for_test(issue, "cursor", [worktree: false], 2)

    assert %ConversationRef{
             provider: "cursor",
             conversation_id: "auto-router-conversation-42"
           } = Keyword.fetch!(retry_opts, :conversation_ref)

    assert Keyword.fetch!(retry_opts, :attempt) == 2

    assert {:ok, _archived} = ExecutionSession.archive_latest("advising", "CDE-1183")
    reset_opts = Orchestrator.agent_run_opts_for_test(issue, "cursor", [], 0)
    refute Keyword.has_key?(reset_opts, :conversation_ref)
  end

  test "orchestrator persists the provider binding reported by the live runner" do
    {:ok, session} =
      ExecutionSession.ensure("advising", "CDE-1184",
        workspace_path: "/tmp/advising/CDE-1184",
        agent_kind: "claude"
      )

    orchestrator_name = Module.concat(__MODULE__, :ProviderBindingOrchestrator)
    {:ok, pid} = Orchestrator.start_link(name: orchestrator_name)
    on_exit(fn -> if Process.alive?(pid), do: Process.exit(pid, :normal) end)

    issue = %Issue{
      id: "provider-binding-run",
      identifier: "CDE-1184",
      project_slug: "advising",
      state: "In Progress"
    }

    running_entry = %{
      pid: self(),
      ref: make_ref(),
      identifier: issue.identifier,
      issue: issue,
      agent_kind: "claude",
      session_id: nil,
      execution_session_id: session.id,
      turn_count: 0
    }

    :sys.replace_state(pid, fn state ->
      %{state | running: %{issue.id => running_entry}}
    end)

    send(pid, {
      :codex_worker_update,
      issue.id,
      %{
        event: :provider_binding,
        timestamp: DateTime.utc_now(),
        provider: "claude",
        conversation_id: "claude-native-session-8"
      }
    })

    _state = :sys.get_state(pid)
    assert {:ok, updated} = History.get_thread(session.id)
    assert updated.provider_bindings == %{"claude" => "claude-native-session-8"}
  end

  test "Cursor execution sessions keep effort only in the native model slug" do
    {:ok, session} =
      ExecutionSession.ensure("advising", "CDE-1181",
        workspace_path: "/tmp/advising/CDE-1181",
        agent_kind: "cursor",
        requested_model: "cursor-grok-4.5-high",
        requested_effort: "high"
      )

    assert session.requested_model == "cursor-grok-4.5-high"
    assert session.requested_effort == nil

    {:ok, resumed} =
      ExecutionSession.ensure("advising", "CDE-1181",
        workspace_path: "/tmp/advising/CDE-1181",
        agent_kind: "cursor",
        requested_effort: "high"
      )

    assert resumed.id == session.id
    assert resumed.requested_effort == nil
  end

  test "ensure/3 reopens the latest finished session and updates agent_kind" do
    {:ok, original} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "codex"
      )

    {:ok, with_resolution} =
      ExecutionSession.put_model_provenance(original.id,
        resolved_model: "gpt-5.6-sol",
        resolved_effort: "low"
      )

    {:ok, _finished} = ExecutionSession.finish(with_resolution.id, "aborted")

    {:ok, resumed} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "cursor",
        requested_model: "composer-2.5"
      )

    assert resumed.id == original.id
    assert resumed.status == "active"
    assert resumed.agent_kind == "cursor"
    assert resumed.requested_model == "composer-2.5"
    assert resumed.resolved_model == nil
    assert resumed.resolved_effort == nil
  end

  test "ensure/3 with force_new creates a distinct session after finish" do
    {:ok, original} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "codex"
      )

    {:ok, _finished} = ExecutionSession.finish(original.id, "aborted")

    {:ok, forced} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "cursor",
        force_new: true
      )

    assert forced.id != original.id
    assert forced.status == "active"
    assert forced.agent_kind == "cursor"
  end

  test "finish/2 maps a run outcome onto the stored status enum and persists it" do
    {:ok, s} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "codex"
      )

    {:ok, closed} = ExecutionSession.finish(s.id, "aborted")
    assert closed.status == "error"
    assert {:ok, reloaded} = History.get_thread(s.id)
    assert reloaded.status == "error"
  end

  test "recent_non_live/0 returns finished execution sessions and excludes active ones" do
    {:ok, active} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "codex"
      )

    {:ok, other} =
      ExecutionSession.ensure("advising", "CDE-2000",
        workspace_path: "/tmp/advising/CDE-2000",
        agent_kind: "codex"
      )

    {:ok, _finished} = ExecutionSession.finish(other.id, "completed")

    recent = ExecutionSession.recent_non_live()
    ids = Enum.map(recent, & &1.id)
    assert other.id in ids
    refute active.id in ids
  end

  test "archive_latest/2 prevents ensure/3 from reusing the prior session" do
    {:ok, original} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "codex"
      )

    assert {:ok, archived} = ExecutionSession.archive_latest("advising", "CDE-1180")
    assert archived.id == original.id
    assert archived.status == "archived"

    {:ok, next} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "cursor"
      )

    assert next.id != original.id
    assert next.status == "active"
  end

  test "missing provider conversation blocks redispatch durably until hard reset" do
    {:ok, session} =
      ExecutionSession.ensure("advising", "CDE-1185",
        workspace_path: "/tmp/advising/CDE-1185",
        agent_kind: "codex"
      )

    assert {:ok, blocked} =
             ExecutionSession.block_provider_resume(
               session.id,
               "codex",
               "thread-missing"
             )

    assert blocked.status == "error"
    assert ExecutionSession.provider_resume_blocked?("advising", "CDE-1185")

    issue = %Issue{
      project_slug: "advising",
      identifier: "CDE-1185"
    }

    assert Orchestrator.provider_resume_blocked_for_test(issue)

    assert {:ok, _archived} = ExecutionSession.archive_latest("advising", "CDE-1185")
    refute ExecutionSession.provider_resume_blocked?("advising", "CDE-1185")
    refute Orchestrator.provider_resume_blocked_for_test(issue)
  end

  test "latest_agent_kind/2 returns the reusable execution thread agent_kind" do
    assert ExecutionSession.latest_agent_kind("advising", "CDE-1180") == nil

    {:ok, _session} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "cursor"
      )

    assert ExecutionSession.latest_agent_kind("advising", "CDE-1180") == "cursor"
  end

  test "latest_agent_kind/2 ignores archived sessions and prefers the latest reusable one" do
    {:ok, older} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "codex"
      )

    assert {:ok, _} = ExecutionSession.archive_latest("advising", "CDE-1180")

    {:ok, newer} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "claude"
      )

    assert newer.id != older.id
    assert ExecutionSession.latest_agent_kind("advising", "CDE-1180") == "claude"

    {:ok, _} = ExecutionSession.finish(newer.id, "completed")
    assert ExecutionSession.latest_agent_kind("advising", "CDE-1180") == "claude"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
