defmodule SymphonyElixir.Assistant.HistoryAgentFieldsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.History

  setup do
    SymphonyElixir.Repo.delete_all(SymphonyElixir.Assistant.Thread)
    :ok
  end

  test "threads default to agent_kind nil and empty agent_thread_ids" do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: "/tmp/x"})
    assert thread.agent_kind == nil
    assert thread.agent_thread_ids == %{}
  end

  test "put_agent_thread_id stores per-kind backend ids and mirrors codex_thread_id" do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: "/tmp/x"})

    {:ok, thread} = History.put_agent_thread_id(thread, "codex", "codex-t1")
    assert History.agent_thread_id(thread, "codex") == "codex-t1"
    assert thread.codex_thread_id == "codex-t1"

    {:ok, thread} = History.put_agent_thread_id(thread, "claude", "sess-9")
    assert History.agent_thread_id(thread, "claude") == "sess-9"
    assert History.agent_thread_id(thread, "codex") == "codex-t1"
  end

  test "set_thread_agent persists the per-thread agent choice" do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: "/tmp/x"})
    {:ok, thread} = History.set_thread_agent(thread, "claude")
    assert thread.agent_kind == "claude"
  end

  test "agent_thread_id is nil-safe for threads predating the map" do
    assert History.agent_thread_id(%SymphonyElixir.Assistant.Thread{agent_thread_ids: nil}, "codex") == nil
  end
end
