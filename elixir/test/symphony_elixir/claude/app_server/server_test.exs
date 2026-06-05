defmodule SymphonyElixir.Claude.AppServer.ServerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Claude.AppServer.Server

  @fake Path.expand("../../../support/fixtures/fake_claude.sh", __DIR__)

  defp start_server do
    test_pid = self()
    sender = fn payload -> send(test_pid, {:out, payload}) end
    {:ok, server} = Server.start_link(sender: sender, command: "FAKE_CLAUDE_MODE=happy #{@fake}")
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
    assert %{"result" => %{"models" => [%{"id" => "claude-opus-4-6"} | _]}} = response
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
end
