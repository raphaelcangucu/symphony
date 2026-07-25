defmodule SymphonyElixir.Assistant.NativeThreadNamesTest do
  use ExUnit.Case, async: false

  import ExUnit.CaptureLog

  alias SymphonyElixir.Assistant.{NativeThreadNames, Thread}

  test "syncs a canonical title to the stored native Codex thread" do
    test_pid = self()

    thread = %Thread{
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

  test "skips historical Codex ids when another agent is active" do
    setter = fn _workspace, _thread_id, _name, _opts -> flunk("setter must not run") end

    thread = %Thread{
      title: "Claude session",
      workspace_path: "/tmp/claude",
      agent_kind: "claude",
      agent_thread_ids: %{"codex" => "historical-codex-id"}
    }

    assert NativeThreadNames.sync(thread, setter: setter) == thread
  end

  test "logs native failures without rolling back the Symphony title" do
    thread = %Thread{
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

  test "contains setter exceptions, exits, and unexpected results" do
    thread = %Thread{
      title: "Keep this title",
      workspace_path: "/tmp/SYM-16",
      agent_thread_ids: %{"codex" => "codex-thread-16"}
    }

    for setter <- [
          fn _, _, _, _ -> raise "port closed" end,
          fn _, _, _, _ -> exit(:epipe) end,
          fn _, _, _, _ -> :unexpected end
        ] do
      log =
        capture_log(fn ->
          assert NativeThreadNames.sync(thread, setter: setter) == thread
        end)

      assert log =~ "native thread name sync failed"
    end
  end

  test "reloads the canonical title inside the serialized sync" do
    test_pid = self()

    stale = %Thread{
      id: 17,
      title: "Stale title",
      workspace_path: "/tmp/SYM-17",
      agent_thread_ids: %{"codex" => "codex-thread-17"}
    }

    current = %{stale | title: "Current title"}

    assert NativeThreadNames.sync(stale,
             reloader: fn 17 -> {:ok, current} end,
             setter: fn _, _, name, _ ->
               send(test_pid, {:canonical_name, name})
               :ok
             end
           ) == current

    assert_receive {:canonical_name, "Current title"}
  end

  test "skips synchronization when a persisted thread cannot be reloaded" do
    thread = %Thread{
      id: 19,
      title: "Potentially stale",
      workspace_path: "/tmp/SYM-19",
      agent_thread_ids: %{"codex" => "codex-thread-19"}
    }

    setter = fn _workspace, _thread_id, _name, _opts -> flunk("setter must not run") end

    assert NativeThreadNames.sync(thread,
             reloader: fn 19 -> {:error, :not_found} end,
             setter: setter
           ) == thread
  end

  test "serializes concurrent native updates for the same Symphony thread" do
    test_pid = self()

    thread = %Thread{
      title: "Canonical title",
      workspace_path: "/tmp/SYM-18",
      agent_thread_ids: %{"codex" => "codex-thread-18"}
    }

    setter = fn _, _, _, _ ->
      send(test_pid, {:setter_entered, self()})

      receive do
        :release_setter -> :ok
      end
    end

    first = Task.async(fn -> NativeThreadNames.sync(thread, setter: setter) end)
    assert_receive {:setter_entered, first_pid}

    second = Task.async(fn -> NativeThreadNames.sync(thread, setter: setter) end)
    refute_receive {:setter_entered, _second_pid}, 50

    send(first_pid, :release_setter)
    assert Task.await(first) == thread

    assert_receive {:setter_entered, second_pid}, 1_000
    send(second_pid, :release_setter)
    assert Task.await(second) == thread
  end
end
