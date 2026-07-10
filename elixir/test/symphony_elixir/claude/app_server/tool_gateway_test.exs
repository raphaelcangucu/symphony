defmodule SymphonyElixir.Claude.AppServer.ToolGatewayTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Claude.AppServer.ToolGateway

  @specs [
    %{
      "name" => "echo_tool",
      "description" => "Echoes input.",
      "inputSchema" => %{"type" => "object", "properties" => %{"text" => %{"type" => "string"}}}
    }
  ]

  setup do
    executor = fn "echo_tool", %{"text" => text} ->
      %{"success" => true, "contentItems" => [%{"type" => "inputText", "text" => "echo: " <> text}]}
    end

    {:ok, token, url} = ToolGateway.register_session(@specs, executor)
    on_exit(fn -> ToolGateway.unregister_session(token) end)
    {:ok, url: url, token: token}
  end

  defp rpc(url, body) do
    {:ok, response} = Req.post(url, json: body, retry: false)
    response
  end

  test "initialize / tools/list / tools/call round-trip", %{url: url} do
    response = rpc(url, %{"jsonrpc" => "2.0", "id" => 1, "method" => "initialize", "params" => %{}})
    assert response.status == 200
    assert %{"result" => %{"protocolVersion" => _, "serverInfo" => %{"name" => "symphony"}}} = response.body

    response = rpc(url, %{"jsonrpc" => "2.0", "id" => 2, "method" => "tools/list", "params" => %{}})
    assert %{"result" => %{"tools" => [%{"name" => "echo_tool", "inputSchema" => _}]}} = response.body

    response =
      rpc(url, %{
        "jsonrpc" => "2.0",
        "id" => 3,
        "method" => "tools/call",
        "params" => %{"name" => "echo_tool", "arguments" => %{"text" => "hi"}}
      })

    assert %{"result" => %{"content" => [%{"type" => "text", "text" => "echo: hi"}], "isError" => false}} =
             response.body
  end

  test "failed executor result maps to isError", %{url: _url, token: token} do
    ToolGateway.unregister_session(token)

    failing = fn _name, _args ->
      %{"success" => false, "contentItems" => [%{"type" => "inputText", "text" => "nope"}]}
    end

    {:ok, token2, url2} = ToolGateway.register_session(@specs, failing)
    on_exit(fn -> ToolGateway.unregister_session(token2) end)

    response =
      rpc(url2, %{"jsonrpc" => "2.0", "id" => 1, "method" => "tools/call", "params" => %{"name" => "echo_tool", "arguments" => %{}}})

    assert %{"result" => %{"isError" => true}} = response.body
  end

  test "unknown token is 401, notifications are 202", %{url: url} do
    bad = String.replace(url, ~r/mcp\/.+$/, "mcp/not-a-token")
    {:ok, response} = Req.post(bad, json: %{"jsonrpc" => "2.0", "id" => 1, "method" => "tools/list"}, retry: false)
    assert response.status == 401

    {:ok, response} = Req.post(url, json: %{"jsonrpc" => "2.0", "method" => "notifications/initialized"}, retry: false)
    assert response.status == 202
  end

  test "write_mcp_config! writes the config file" do
    workspace = Path.join(System.tmp_dir!(), "gw-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)

    path = ToolGateway.write_mcp_config!(workspace, "http://127.0.0.1:1234/mcp/tok")
    assert {:ok, body} = File.read(path)
    assert %{"mcpServers" => %{"symphony" => %{"type" => "http", "url" => "http://127.0.0.1:1234/mcp/tok"}}} = Jason.decode!(body)
  end

  test "table survives the registering process exiting" do
    executor = fn _n, _a -> %{"success" => true, "contentItems" => [%{"type" => "inputText", "text" => "ok"}]} end

    task = Task.async(fn -> ToolGateway.register_session(@specs, executor) end)
    {:ok, _token1, _url1} = Task.await(task)
    # task (the registering process) has now exited

    {:ok, token2, url2} = ToolGateway.register_session(@specs, executor)
    on_exit(fn -> ToolGateway.unregister_session(token2) end)

    {:ok, response} =
      Req.post(url2, json: %{"jsonrpc" => "2.0", "id" => 1, "method" => "tools/call", "params" => %{"name" => "echo_tool", "arguments" => %{}}}, retry: false)

    assert response.status == 200
    assert %{"result" => %{"isError" => false}} = response.body
  end

  test "POST /user-input/:token awaits answers from broker" do
    alias SymphonyElixir.Assistant.UserInputBroker

    UserInputBroker.ensure_started()
    session_token = "user-input-#{System.unique_integer([:positive])}"
    channel = self()

    assert :ok =
             UserInputBroker.bind_session(session_token, %{
               channel_pid: channel,
               thread_id: 1,
               agent: "claude"
             })

    on_exit(fn -> UserInputBroker.unbind_session(session_token) end)

    {:ok, mcp_token, mcp_url} = ToolGateway.register_session([], fn _, _ -> %{"ok" => true} end)
    on_exit(fn -> ToolGateway.unregister_session(mcp_token) end)

    base =
      mcp_url
      |> URI.parse()
      |> Map.put(:path, "/user-input/#{session_token}")
      |> URI.to_string()

    request_id = "hook-req-1"

    questions = [
      %{
        "header" => "H",
        "question" => "Q?",
        "options" => [%{"label" => "A", "description" => "d"}]
      }
    ]

    task =
      Task.async(fn ->
        Req.post(base,
          json: %{"request_id" => request_id, "questions" => questions, "timeout_ms" => 5_000},
          receive_timeout: 5_000,
          retry: false
        )
      end)

    assert_receive {:assistant_user_input_required, %{request_id: ^request_id, questions: ui_qs}}, 2_000
    assert hd(ui_qs)["id"] == "q0"

    assert :ok = UserInputBroker.resolve(request_id, %{"q0" => %{"answers" => ["A"]}})

    assert {:ok, %{status: 200, body: body}} = Task.await(task)
    assert body["permissionDecision"] == "allow"
    assert body["updatedInput"]["answers"]["Q?"] == "A"
    assert is_list(body["updatedInput"]["questions"])
  end
end
