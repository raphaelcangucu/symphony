defmodule SymphonyElixir.Assistant.AgentSessionAgentTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Agent.ConversationRef
  alias SymphonyElixir.Assistant.{AgentSession, History}
  alias SymphonyElixir.Claude.GoalStore
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Setting

  setup do
    Repo.delete_all(SymphonyElixir.Assistant.Thread)
    Repo.delete_all(Setting)

    on_exit(fn ->
      # Clean up any Settings rows this test may have written so they don't leak
      # into later test modules (e.g. assistant_channel_test which doesn't truncate settings).
      Repo.delete_all(Setting)
    end)

    :ok
  end

  test "the runner receives the resolved agent kind and canonical conversation ref" do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: "/tmp/agent-test"})
    {:ok, ref} = ConversationRef.new("claude", "sess-prev")
    {:ok, thread} = History.put_conversation_ref(thread, ref)

    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      send(
        test_pid,
        {:runner_opts, Keyword.get(opts, :agent_kind), Keyword.get(opts, :conversation_ref)}
      )

      {:ok,
       %{
         assistant_message: "ok",
         tool_calls: [],
         conversation_id: "sess-new",
         run_id: "t1"
       }}
    end

    {:ok, _result} =
      AgentSession.send_message_to_thread(thread, "hello", %{"agent" => "claude"}, runner: runner)

    assert_received {:runner_opts, "claude",
                     %ConversationRef{
                       provider: "claude",
                       conversation_id: "sess-prev"
                     }}

    reloaded = Repo.get!(SymphonyElixir.Assistant.Thread, thread.id)

    assert {:ok, %ConversationRef{conversation_id: "sess-new"}} =
             History.conversation_ref(reloaded, "claude")

    assert reloaded.agent_kind == "claude"
  end

  test "without context.agent the thread's stored agent (or settings default) applies" do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: "/tmp/agent-test"})
    {:ok, _} = SymphonyElixir.Settings.put("agents", "default_agent_kind", "claude")

    test_pid = self()

    runner = fn _w, _p, _i, opts ->
      send(test_pid, {:agent, Keyword.get(opts, :agent_kind)})
      {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "x", run_id: "t"}}
    end

    {:ok, _} = AgentSession.send_message_to_thread(thread, "hi", %{}, runner: runner)
    assert_received {:agent, "claude"}
  end

  test "claude resume uses the persisted backend id on the next turn (fresh thread read)" do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: "/tmp/agent-test"})
    test_pid = self()

    runner = fn _w, _p, _i, opts ->
      send(test_pid, {:conversation_ref, Keyword.get(opts, :conversation_ref)})
      {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "cl-1", run_id: "t"}}
    end

    {:ok, _} = AgentSession.send_message_to_thread(thread, "turn 1", %{"agent" => "claude"}, runner: runner)
    assert_received {:conversation_ref, nil}

    # Same STALE struct (simulates the channel's frozen assign) — the session layer must reload.
    {:ok, _} = AgentSession.send_message_to_thread(thread, "turn 2", %{"agent" => "claude"}, runner: runner)
    assert_received {:conversation_ref, %ConversationRef{provider: "claude", conversation_id: "cl-1"}}
  end

  test "rejects a provider switch while an enabled Goal is bound to another provider" do
    workspace = Path.join(System.tmp_dir!(), "goal-provider-switch-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    {:ok, thread} =
      History.create_freeform_thread(%{workspace_path: workspace, agent_kind: "codex"})

    {:ok, thread} = History.set_goal_mode(thread, true, "Audit")

    assert {:error, {:authoring_goal_provider_mismatch, "codex", "claude"}} =
             AgentSession.send_message_to_thread(thread, "switch", %{"agent" => "claude"}, runner: fn _, _, _, _ -> flunk("provider mismatch must fail before running") end)

    assert Repo.get!(SymphonyElixir.Assistant.Thread, thread.id).agent_kind == "codex"
    assert :error = GoalStore.read(workspace, :authoring, thread.id)
  end
end
