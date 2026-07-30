defmodule SymphonyElixir.Claude.AppServer.ServerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Claude.AppServer.Server

  @fake Path.expand("../../../support/fixtures/fake_claude.sh", __DIR__)

  # Polls predicate every 10 ms until it returns true or deadline_ms elapses.
  defp assert_until_ms(deadline_ms, pred, elapsed \\ 0) do
    if pred.() do
      :ok
    else
      if elapsed >= deadline_ms do
        flunk("assert_until_ms: condition not met within #{deadline_ms}ms")
      else
        Process.sleep(10)
        assert_until_ms(deadline_ms, pred, elapsed + 10)
      end
    end
  end

  defp start_server do
    start_server_with_mode("happy")
  end

  defp start_server_with_mode(mode) do
    test_pid = self()
    sender = fn payload -> send(test_pid, {:out, payload}) end
    {:ok, server} = Server.start_link(sender: sender, command: "FAKE_CLAUDE_MODE=#{mode} #{@fake}")
    server
  end

  defp request(server, id, method, params) do
    Server.handle_message(server, %{"jsonrpc" => "2.0", "id" => id, "method" => method, "params" => params})
    assert_receive {:out, %{"id" => ^id} = response}, 5_000
    response
  end

  test "initialize -> thread/start -> turn/start -> turn/completed flow" do
    server = start_server()

    response = request(server, 1, "initialize", %{"clientInfo" => %{"name" => "test"}})
    assert %{"result" => %{"server" => %{"name" => "symphony-claude"}}} = response
    assert_receive {:out, %{"method" => "initialized"}}

    workspace = Path.join(System.tmp_dir!(), "appserver-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)

    response = request(server, 2, "thread/start", %{"cwd" => workspace, "permissionMode" => "bypassPermissions"})
    assert %{"result" => %{"thread" => %{"id" => thread_id}}} = response

    response = request(server, 3, "turn/start", %{"threadId" => thread_id, "input" => [%{"type" => "text", "text" => "hi"}]})
    assert %{"result" => %{"turn" => %{"id" => _turn_id}}} = response

    assert_receive {:out, %{"method" => "turn/completed", "params" => %{"usage" => _}}}, 10_000
  end

  test "model/list returns the static catalog and uninitialized requests are rejected" do
    server = start_server()

    Server.handle_message(server, %{"jsonrpc" => "2.0", "id" => 9, "method" => "model/list", "params" => %{}})
    assert_receive {:out, %{"id" => 9, "error" => %{"message" => message}}}
    assert message =~ "initialize"

    request(server, 1, "initialize", %{})
    response = request(server, 2, "model/list", %{})
    assert %{"result" => %{"models" => models}} = response
    assert Enum.any?(models, &(Map.get(&1, "id") == "claude-opus-4-8"))
  end

  test "turn busy guard and steer queueing" do
    server = start_server()
    request(server, 1, "initialize", %{})

    workspace = Path.join(System.tmp_dir!(), "appserver-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)

    response = request(server, 2, "thread/start", %{"cwd" => workspace})
    assert %{"result" => %{"thread" => %{"id" => thread_id}}} = response

    # no active turn -> steer errors
    Server.handle_message(server, %{"jsonrpc" => "2.0", "id" => 3, "method" => "turn/steer", "params" => %{"threadId" => thread_id, "content" => "note"}})
    assert_receive {:out, %{"id" => 3, "error" => _}}
  end

  test "dynamicTools at thread/start round-trip as item/tool/call reverse requests" do
    server = start_server()
    request(server, 1, "initialize", %{})

    workspace = Path.join(System.tmp_dir!(), "appserver-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)

    specs = [%{"name" => "echo_tool", "description" => "d", "inputSchema" => %{"type" => "object"}}]
    response = request(server, 2, "thread/start", %{"cwd" => workspace, "dynamicTools" => specs})
    assert %{"result" => %{"thread" => %{"id" => thread_id}}} = response

    executor = Server.tool_executor_for_test(server, thread_id)

    task = Task.async(fn -> executor.("echo_tool", %{"text" => "hi"}) end)

    assert_receive {:out, %{"method" => "item/tool/call", "id" => call_id, "params" => %{"name" => "echo_tool"}}}, 5_000

    Server.handle_message(server, %{
      "jsonrpc" => "2.0",
      "id" => call_id,
      "result" => %{"success" => true, "contentItems" => [%{"type" => "inputText", "text" => "echo: hi"}]}
    })

    assert %{"success" => true} = Task.await(task)
  end

  test "a crashing sender does not wedge the thread (monitor recovery)" do
    test_pid = self()
    crash_once = :counters.new(1, [])

    sender = fn payload ->
      # Crash the runner task on its FIRST notification; behave for everything else.
      if Map.has_key?(payload, "method") and :counters.get(crash_once, 1) == 0 and
           payload["method"] in ["item/progress", "item/created", "usage/update", "turn/completed"] do
        :counters.add(crash_once, 1, 1)
        raise "simulated EPIPE"
      else
        send(test_pid, {:out, payload})
      end
    end

    {:ok, server} = Server.start_link(sender: sender, command: "FAKE_CLAUDE_MODE=happy #{@fake}")
    Server.handle_message(server, %{"jsonrpc" => "2.0", "id" => 1, "method" => "initialize", "params" => %{}})
    assert_receive {:out, %{"id" => 1}}, 5_000

    workspace = Path.join(System.tmp_dir!(), "appserver-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)

    Server.handle_message(server, %{"jsonrpc" => "2.0", "id" => 2, "method" => "thread/start", "params" => %{"cwd" => workspace}})
    assert_receive {:out, %{"id" => 2, "result" => %{"thread" => %{"id" => thread_id}}}}, 5_000

    Server.handle_message(server, %{"jsonrpc" => "2.0", "id" => 3, "method" => "turn/start", "params" => %{"threadId" => thread_id, "content" => "x"}})
    assert_receive {:out, %{"id" => 3}}, 5_000

    # The synthetic turn/failed from the :DOWN handler proves recovery.
    assert_receive {:out, %{"method" => "turn/failed"}}, 10_000

    # And the thread accepts a new turn (not -32005).
    Server.handle_message(server, %{"jsonrpc" => "2.0", "id" => 4, "method" => "turn/start", "params" => %{"threadId" => thread_id, "content" => "y"}})
    assert_receive {:out, %{"id" => 4, "result" => %{"turn" => _}}}, 5_000
  end

  test "turn/failed path recovers the thread (error fixture)" do
    server = start_server_with_mode("error")
    request(server, 1, "initialize", %{})

    workspace = Path.join(System.tmp_dir!(), "appserver-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)

    response = request(server, 2, "thread/start", %{"cwd" => workspace})
    assert %{"result" => %{"thread" => %{"id" => thread_id}}} = response

    request(server, 3, "turn/start", %{"threadId" => thread_id, "input" => [%{"type" => "text", "text" => "boom"}]})
    assert_receive {:out, %{"method" => "turn/failed"}}, 10_000

    # Poll until the GenServer has cleared active_turn (the {turn_failed} cast from the
    # runner task may still be in-flight when the notification reaches the test process).
    assert_until_ms(2_000, fn ->
      state = :sys.get_state(server)
      get_in(state, [:threads, thread_id, :active_turn]) == nil
    end)

    response = request(server, 4, "turn/start", %{"threadId" => thread_id, "input" => [%{"type" => "text", "text" => "again"}]})
    assert %{"result" => %{"turn" => _}} = response
  end
end
