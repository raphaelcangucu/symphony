defmodule SymphonyElixir.Assistant.NativeThreadNamesTest do
  use ExUnit.Case, async: false

  import ExUnit.CaptureLog

  alias SymphonyElixir.Assistant.{NativeThreadNames, Thread}

  test "syncs a canonical title to the stored native Codex thread" do
    test_pid = self()

    thread = %Thread{
      id: 13,
      title: "  Chat · SYM-13 · Native titles  ",
      workspace_path: "/tmp/SYM-13",
      agent_thread_ids: %{"codex" => "codex-thread-13"}
    }

    setter = fn workspace, thread_id, name, opts ->
      send(test_pid, {:set_name, workspace, thread_id, name, opts})
      :ok
    end

    assert NativeThreadNames.sync(thread, setter: setter, coding_agent_opts: [workspace_root: "/tmp"]) == thread

    assert_receive {:set_name, "/tmp/SYM-13", "codex-thread-13", "Chat · SYM-13 · Native titles", [workspace_root: "/tmp"]}
  end

  test "uses the legacy native Codex thread id when the backend map is empty" do
    test_pid = self()

    thread = %Thread{
      id: 14,
      title: "Legacy title",
      workspace_path: "/tmp/SYM-14",
      codex_thread_id: "legacy-codex-thread",
      agent_thread_ids: %{}
    }

    setter = fn _workspace, thread_id, _name, _opts ->
      send(test_pid, {:set_name, thread_id})
      :ok
    end

    assert NativeThreadNames.sync(thread, setter: setter) == thread
    assert_receive {:set_name, "legacy-codex-thread"}
  end

  test "uses the configured application setter when no explicit setter is supplied" do
    test_pid = self()
    previous = Application.get_env(:symphony_elixir, :native_thread_name_setter)

    Application.put_env(:symphony_elixir, :native_thread_name_setter, fn _, thread_id, name, _ ->
      send(test_pid, {:configured_setter, thread_id, name})
      :ok
    end)

    on_exit(fn ->
      if previous,
        do: Application.put_env(:symphony_elixir, :native_thread_name_setter, previous),
        else: Application.delete_env(:symphony_elixir, :native_thread_name_setter)
    end)

    thread = %Thread{
      title: "Configured title",
      workspace_path: "/tmp/configured",
      agent_thread_ids: %{"codex" => "configured-thread"}
    }

    assert NativeThreadNames.sync(thread) == thread
    assert_receive {:configured_setter, "configured-thread", "Configured title"}
  end

  test "skips threads without complete native naming context" do
    setter = fn _workspace, _thread_id, _name, _opts -> flunk("setter must not run") end

    assert NativeThreadNames.sync(%Thread{title: "No native id", workspace_path: "/tmp"}, setter: setter)
    assert NativeThreadNames.sync(%Thread{title: "No workspace", agent_thread_ids: %{"codex" => "id"}}, setter: setter)

    assert NativeThreadNames.sync(
             %Thread{title: "   ", workspace_path: "/tmp", agent_thread_ids: %{"codex" => "id"}},
             setter: setter
           )
  end

  test "logs native failures without rolling back the Symphony title" do
    thread = %Thread{
      id: 15,
      title: "Keep this title",
      workspace_path: "/tmp/SYM-15",
      agent_thread_ids: %{"codex" => "codex-thread-15"}
    }

    log =
      capture_log(fn ->
        assert NativeThreadNames.sync(thread, setter: fn _, _, _, _ -> {:error, :offline} end) == thread
      end)

    assert log =~ "native thread name sync failed"
    assert log =~ "codex-thread-15"
  end
end
