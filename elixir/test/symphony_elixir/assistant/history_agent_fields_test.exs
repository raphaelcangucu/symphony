defmodule SymphonyElixir.Assistant.HistoryAgentFieldsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Agent.ConversationRef
  alias SymphonyElixir.Assistant.{History, Thread}
  alias SymphonyElixir.Repo

  setup do
    SymphonyElixir.Repo.delete_all(SymphonyElixir.Assistant.Thread)
    :ok
  end

  test "threads default to agent_kind nil and empty provider bindings" do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: "/tmp/x"})
    assert thread.agent_kind == nil
    assert thread.provider_bindings == %{}
    assert thread.requested_model == nil
    assert thread.requested_effort == nil
    assert thread.resolved_model == nil
    assert thread.resolved_effort == nil
  end

  test "model provenance is canonical thread data and trims input" do
    {:ok, thread} =
      History.create_freeform_thread(%{
        workspace_path: "/tmp/model-provenance",
        requested_model: "  gpt-5.6-sol ",
        requested_effort: " medium ",
        metadata: %{"model" => "legacy-model", "effort" => "legacy-effort"}
      })

    assert thread.requested_model == "gpt-5.6-sol"
    assert thread.requested_effort == "medium"
    assert thread.resolved_model == nil
    assert thread.resolved_effort == nil
    refute Map.has_key?(thread.metadata, "model")
    refute Map.has_key?(thread.metadata, "effort")

    assert {:ok, resolved} =
             History.put_model_provenance(thread, %{
               resolved_model: " gpt-5.6-terra ",
               resolved_effort: " high "
             })

    assert resolved.requested_model == "gpt-5.6-sol"
    assert resolved.requested_effort == "medium"
    assert resolved.resolved_model == "gpt-5.6-terra"
    assert resolved.resolved_effort == "high"
  end

  test "resolved provenance is never inferred from requested values" do
    {:ok, thread} =
      History.create_freeform_thread(%{
        workspace_path: "/tmp/request-only",
        requested_model: "claude-sonnet-5",
        requested_effort: "medium"
      })

    assert {:ok, unchanged} = History.put_model_provenance(thread, %{})
    assert unchanged.requested_model == "claude-sonnet-5"
    assert unchanged.requested_effort == "medium"
    assert unchanged.resolved_model == nil
    assert unchanged.resolved_effort == nil
  end

  test "Cursor effort is canonical only in the model slug at every thread write" do
    {:ok, thread} =
      History.create_freeform_thread(%{
        workspace_path: "/tmp/cursor-effort-invariant",
        agent_kind: "cursor",
        requested_model: "cursor-grok-4.5-high",
        requested_effort: "high",
        resolved_model: "cursor-grok-4.5-high",
        resolved_effort: "high"
      })

    assert thread.requested_effort == nil
    assert thread.resolved_effort == nil

    {:ok, codex_thread} =
      History.create_freeform_thread(%{
        workspace_path: "/tmp/provider-switch-effort",
        agent_kind: "codex",
        requested_model: "gpt-5.5",
        requested_effort: "high",
        resolved_model: "gpt-5.5",
        resolved_effort: "high"
      })

    assert {:ok, switched} = History.set_thread_agent(codex_thread, "cursor")
    assert switched.requested_effort == nil
    assert switched.resolved_effort == nil
  end

  test "model provenance migration preserves populated canonical columns" do
    {:ok, thread} =
      History.create_freeform_thread(%{
        workspace_path: "/tmp/migration-canonical",
        requested_model: "gpt-5.6-sol",
        requested_effort: "low"
      })

    Repo.query!(
      """
      UPDATE assistant_threads
      SET metadata = json_set(metadata, '$.model', 'legacy-model', '$.effort', 'legacy-effort')
      WHERE id = ?
      """,
      [thread.id]
    )

    Repo.query!("DELETE FROM schema_migrations WHERE version = 20260717115500")
    Ecto.Migrator.run(Repo, :up, to: 202_607_171_155_00, log: false)

    migrated = Repo.get!(Thread, thread.id)
    assert migrated.requested_model == "gpt-5.6-sol"
    assert migrated.requested_effort == "low"
    refute Map.has_key?(migrated.metadata, "model")
    refute Map.has_key?(migrated.metadata, "effort")
  end

  test "model provenance migration discards untrusted current-turn fields" do
    {:ok, thread} =
      History.create_freeform_thread(%{
        workspace_path: "/tmp/migration-current-turn"
      })

    Repo.query!(
      """
      UPDATE assistant_threads
      SET metadata = json_set(
        metadata,
        '$.current_turn.model',
        'stale-turn-model',
        '$.current_turn.effort',
        'stale-turn-effort'
      )
      WHERE id = ?
      """,
      [thread.id]
    )

    Repo.query!("DELETE FROM schema_migrations WHERE version = 20260717115500")
    Ecto.Migrator.run(Repo, :up, to: 202_607_171_155_00, log: false)

    migrated = Repo.get!(Thread, thread.id)
    assert migrated.requested_model == nil
    assert migrated.requested_effort == nil
    refute get_in(migrated.metadata, ["current_turn", "model"])
    refute get_in(migrated.metadata, ["current_turn", "effort"])
  end

  test "model provenance migration repairs duplicated Cursor effort columns" do
    {:ok, thread} =
      History.create_freeform_thread(%{
        workspace_path: "/tmp/migration-cursor-effort",
        agent_kind: "cursor",
        requested_model: "cursor-grok-4.5-high",
        resolved_model: "cursor-grok-4.5-high"
      })

    Repo.query!(
      """
      UPDATE assistant_threads
      SET requested_effort = 'high', resolved_effort = 'high'
      WHERE id = ?
      """,
      [thread.id]
    )

    Repo.query!("DELETE FROM schema_migrations WHERE version = 20260717115500")
    Ecto.Migrator.run(Repo, :up, to: 202_607_171_155_00, log: false)

    migrated = Repo.get!(Thread, thread.id)
    assert migrated.requested_effort == nil
    assert migrated.resolved_effort == nil
  end

  test "conversation refs store one canonical id per provider" do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: "/tmp/x"})

    {:ok, codex_ref} = ConversationRef.new("codex", "codex-t1")
    {:ok, thread} = History.put_conversation_ref(thread, codex_ref)
    assert {:ok, ^codex_ref} = History.conversation_ref(thread, "codex")

    {:ok, claude_ref} = ConversationRef.new("claude", "sess-9")
    {:ok, thread} = History.put_conversation_ref(thread, claude_ref)
    assert {:ok, ^claude_ref} = History.conversation_ref(thread, "claude")
    assert {:ok, ^codex_ref} = History.conversation_ref(thread, "codex")
    assert thread.provider_bindings == %{"claude" => "sess-9", "codex" => "codex-t1"}
  end

  test "stale provider writers preserve bindings for other providers" do
    {:ok, original} = History.create_freeform_thread(%{workspace_path: "/tmp/x"})
    {:ok, codex_ref} = ConversationRef.new("codex", "codex-t1")
    {:ok, claude_ref} = ConversationRef.new("claude", "claude-t1")

    assert {:ok, _with_codex} = History.put_conversation_ref(original, codex_ref)
    assert {:ok, updated} = History.put_conversation_ref(original, claude_ref)

    assert updated.provider_bindings == %{
             "claude" => "claude-t1",
             "codex" => "codex-t1"
           }
  end

  test "set_thread_agent persists the per-thread agent choice" do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: "/tmp/x"})
    {:ok, thread} = History.set_thread_agent(thread, "claude")
    assert thread.agent_kind == "claude"
  end

  test "conversation lookup rejects absent bindings" do
    assert :error =
             History.conversation_ref(
               %SymphonyElixir.Assistant.Thread{provider_bindings: %{}},
               "codex"
             )
  end

  test "thread validation rejects nested, blank, and unsupported provider bindings" do
    for bindings <- [
          %{"claude" => %{"conversation_id" => "nested"}},
          %{"cursor" => " "},
          %{"unknown" => "conversation"}
        ] do
      assert {:error, changeset} =
               History.create_freeform_thread(%{
                 workspace_path: "/tmp/invalid-bindings",
                 provider_bindings: bindings
               })

      assert {"must map supported providers to non-empty conversation ids", _metadata} =
               Keyword.fetch!(changeset.errors, :provider_bindings)
    end
  end

  test "thread validation rejects updates when stored bindings are non-canonical" do
    legacy = %SymphonyElixir.Assistant.Thread{
      scope: "freeform",
      workspace_path: "/tmp/legacy",
      status: "active",
      provider_bindings: %{"claude" => %{"external_id" => "legacy"}}
    }

    changeset = SymphonyElixir.Assistant.Thread.changeset(legacy, %{title: "Still invalid"})

    refute changeset.valid?

    assert {"must map supported providers to non-empty conversation ids", _metadata} =
             Keyword.fetch!(changeset.errors, :provider_bindings)
  end

  test "thread validation rejects updates when the stored provider name is invalid" do
    legacy = %SymphonyElixir.Assistant.Thread{
      scope: "freeform",
      workspace_path: "/tmp/legacy",
      status: "active",
      agent_kind: "openai",
      provider_bindings: %{}
    }

    changeset = SymphonyElixir.Assistant.Thread.changeset(legacy, %{title: "Still invalid"})

    refute changeset.valid?
    assert {_message, _metadata} = Keyword.fetch!(changeset.errors, :agent_kind)
  end
end
