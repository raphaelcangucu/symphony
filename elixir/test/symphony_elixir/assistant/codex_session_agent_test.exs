defmodule SymphonyElixir.Assistant.CodexSessionAgentTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{CodexSession, History}
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

  test "the runner receives the resolved agent kind and the per-agent backend thread id" do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: "/tmp/agent-test"})
    {:ok, thread} = History.put_agent_thread_id(thread, "claude", "sess-prev")

    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      send(test_pid, {:runner_opts, Keyword.get(opts, :agent_kind), Keyword.get(opts, :agent_thread_id)})
      {:ok, %{assistant_message: "ok", tool_calls: [], thread_id: "sess-new", turn_id: "t1"}}
    end

    {:ok, _result} =
      CodexSession.send_message_to_thread(thread, "hello", %{"agent" => "claude"}, runner: runner)

    assert_received {:runner_opts, "claude", "sess-prev"}

    reloaded = Repo.get!(SymphonyElixir.Assistant.Thread, thread.id)
    assert History.agent_thread_id(reloaded, "claude") == "sess-new"
    assert reloaded.agent_kind == "claude"
  end

  test "without context.agent the thread's stored agent (or settings default) applies" do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: "/tmp/agent-test"})
    {:ok, _} = SymphonyElixir.Settings.put("agents", "default_agent_kind", "claude")

    test_pid = self()

    runner = fn _w, _p, _i, opts ->
      send(test_pid, {:agent, Keyword.get(opts, :agent_kind)})
      {:ok, %{assistant_message: "ok", tool_calls: [], thread_id: "x", turn_id: "t"}}
    end

    {:ok, _} = CodexSession.send_message_to_thread(thread, "hi", %{}, runner: runner)
    assert_received {:agent, "claude"}
  end

  test "claude resume uses the persisted backend id on the next turn (fresh thread read)" do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: "/tmp/agent-test"})
    test_pid = self()

    runner = fn _w, _p, _i, opts ->
      send(test_pid, {:thread_id_opt, Keyword.get(opts, :agent_thread_id)})
      {:ok, %{assistant_message: "ok", tool_calls: [], cli_session_id: "cl-1", turn_id: "t"}}
    end

    {:ok, _} = CodexSession.send_message_to_thread(thread, "turn 1", %{"agent" => "claude"}, runner: runner)
    assert_received {:thread_id_opt, nil}

    # Same STALE struct (simulates the channel's frozen assign) — the session layer must reload.
    {:ok, _} = CodexSession.send_message_to_thread(thread, "turn 2", %{"agent" => "claude"}, runner: runner)
    assert_received {:thread_id_opt, "cl-1"}
  end
end
