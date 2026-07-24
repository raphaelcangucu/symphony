defmodule SymphonyElixir.Assistant.HistoryAgentFieldsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Agent.ConversationRef
  alias SymphonyElixir.Assistant.History

  setup do
    SymphonyElixir.Repo.delete_all(SymphonyElixir.Assistant.Thread)
    :ok
  end

  test "threads default to agent_kind nil and empty provider bindings" do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: "/tmp/x"})
    assert thread.agent_kind == nil
    assert thread.provider_bindings == %{}
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
