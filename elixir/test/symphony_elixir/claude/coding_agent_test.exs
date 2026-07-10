defmodule SymphonyElixir.Claude.CodingAgentTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Claude.CodingAgent

  @fake Path.expand("../../support/fixtures/fake_claude.sh", __DIR__)
  @issue %{id: "1", identifier: "PREF-1", title: "Test issue"}

  defp workspace do
    root = Path.join(System.tmp_dir!(), "claude-adapter-#{System.unique_integer([:positive])}")
    ws = Path.join(root, "issue-1")
    File.mkdir_p!(ws)
    {root, ws}
  end

  defp mcp_url(config_path) when is_binary(config_path) do
    config_path
    |> File.read!()
    |> Jason.decode!()
    |> get_in(["mcpServers", "symphony", "url"])
  end

  test "start_session is portless and run_turn completes via the CLI runner" do
    {root, ws} = workspace()

    assert {:ok, session} =
             CodingAgent.start_session(ws,
               workspace_root: root,
               claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}"
             )

    assert session.cli_session_id == nil
    assert is_binary(session.session_uuid)

    {:ok, collector} = Agent.start_link(fn -> [] end)
    on_message = fn message -> Agent.update(collector, &[message | &1]) end

    assert {:ok, result} = CodingAgent.run_turn(session, "do it", @issue, on_message: on_message)
    assert result.session_id =~ session.session_uuid
    assert result.cli_session_id == "sess-123"

    events = collector |> Agent.get(&Enum.reverse/1) |> Enum.map(& &1.event)
    assert :session_started in events
    assert :turn_completed in events
    Agent.stop(collector)
  end

  test "second turn resumes with the captured cli session id" do
    {root, ws} = workspace()

    {:ok, session} =
      CodingAgent.start_session(ws, workspace_root: root, claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}")

    {:ok, result} = CodingAgent.run_turn(session, "turn 1", @issue, [])
    session = Map.put(session, :cli_session_id, result.cli_session_id)

    args =
      SymphonyElixir.Claude.AppServer.CliRunner.build_args(%{
        session_uuid: session.session_uuid,
        cli_session_id: session.cli_session_id,
        model: nil,
        mcp_config_path: nil,
        permission_mode: "bypassPermissions"
      })

    assert args =~ "--resume sess-123"
  end

  test "dynamic tools register a gateway session and pass --mcp-config" do
    {root, ws} = workspace()

    specs = [%{"name" => "echo_tool", "description" => "d", "inputSchema" => %{"type" => "object"}}]
    executor = fn _name, _args -> %{"success" => true, "contentItems" => []} end

    {:ok, session} =
      CodingAgent.start_session(ws,
        workspace_root: root,
        claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}",
        dynamic_tools: specs,
        tool_executor: executor
      )

    assert is_binary(session.mcp_config_path)
    assert File.exists?(session.mcp_config_path)
    assert {:ok, _} = CodingAgent.run_turn(session, "with tools", @issue, [])
    assert :ok = CodingAgent.stop_session(session)
    refute File.exists?(session.mcp_config_path)
  end

  test "execution_mode maps onto the claude permission mode" do
    for {mode, expected} <- [{"plan", "plan"}, {"build", "bypassPermissions"}, {"yolo", "bypassPermissions"}] do
      {root, ws} = workspace()

      assert {:ok, session} =
               CodingAgent.start_session(ws,
                 workspace_root: root,
                 claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}",
                 execution_mode: mode
               )

      assert session.permission_mode == expected
    end
  end

  test "missing execution_mode defaults to bypassPermissions (headless has no approver)" do
    {root, ws} = workspace()

    assert {:ok, session} =
             CodingAgent.start_session(ws,
               workspace_root: root,
               claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}"
             )

    assert session.permission_mode == "bypassPermissions"
  end

  test "autonomous build (no interactive flag) stays bypassPermissions with no approval tool" do
    {root, ws} = workspace()

    assert {:ok, session} =
             CodingAgent.start_session(ws,
               workspace_root: root,
               claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}",
               execution_mode: "build"
             )

    assert session.permission_mode == "bypassPermissions"
    assert session.permission_prompt_tool == nil
    assert session.mcp_config_path == nil
  end

  test "interactive build wires --permission-mode default and the approval prompt tool" do
    {root, ws} = workspace()

    assert {:ok, session} =
             CodingAgent.start_session(ws,
               workspace_root: root,
               claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}",
               execution_mode: "build",
               interactive_user_input: true,
               on_approval_required: fn _ -> :ok end
             )

    assert session.permission_mode == "default"
    assert session.permission_prompt_tool == "mcp__symphony__symphony_approve"
    assert is_binary(session.mcp_config_path)
    assert File.exists?(session.mcp_config_path)

    assert :ok = CodingAgent.stop_session(session)
  end

  test "interactive session installs AskUserQuestion settings when ask_user_session is set" do
    alias SymphonyElixir.Assistant.UserInputBroker
    alias SymphonyElixir.Claude.AppServer.ToolGateway

    {root, ws} = workspace()
    UserInputBroker.ensure_started()
    # Ensure ToolGateway has a bound port for loopback URL discovery.
    {:ok, mcp_token, _url} = ToolGateway.register_session([], fn _, _ -> %{} end)
    on_exit(fn -> ToolGateway.unregister_session(mcp_token) end)

    token = "ask-#{System.unique_integer([:positive])}"

    assert {:ok, session} =
             CodingAgent.start_session(ws,
               workspace_root: root,
               claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}",
               interactive_user_input: true,
               ask_user_session: %{
                 token: token,
                 channel_pid: self(),
                 thread_id: 42
               }
             )

    assert is_binary(session.settings_path)
    assert File.exists?(session.settings_path)
    assert session.ask_user_token == token
    assert {:ok, %{channel_pid: pid, thread_id: 42, agent: "claude"}} = UserInputBroker.lookup_session(token)
    assert pid == self()

    args =
      SymphonyElixir.Claude.AppServer.CliRunner.build_args(%{
        session_uuid: session.session_uuid,
        cli_session_id: nil,
        model: nil,
        mcp_config_path: nil,
        permission_mode: "bypassPermissions",
        settings_path: session.settings_path
      })

    assert args =~ "--settings #{session.settings_path}"

    assert :ok = CodingAgent.stop_session(session)
    refute File.exists?(session.settings_path)
    assert :error = UserInputBroker.lookup_session(token)
  end

  test "non-interactive session has no AskUserQuestion settings" do
    {root, ws} = workspace()

    assert {:ok, session} =
             CodingAgent.start_session(ws,
               workspace_root: root,
               claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}"
             )

    assert session.settings_path == nil
    assert session.ask_user_token == nil
  end

  test "interactive build approval tool blocks until the operator approves, then allows" do
    {root, ws} = workspace()
    test_pid = self()

    {:ok, session} =
      CodingAgent.start_session(ws,
        workspace_root: root,
        claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}",
        execution_mode: "build",
        interactive_user_input: true,
        approval_timeout_ms: 5_000,
        on_approval_required: fn request -> send(test_pid, {:approval_request, request}) end
      )

    url = mcp_url(session.mcp_config_path)

    caller =
      Task.async(fn ->
        Req.post!(url,
          json: %{
            "jsonrpc" => "2.0",
            "id" => 1,
            "method" => "tools/call",
            "params" => %{
              "name" => "symphony_approve",
              "arguments" => %{"tool_name" => "Bash", "input" => %{"command" => "ls -la"}}
            }
          },
          retry: false
        )
      end)

    assert_receive {:approval_request, %{request_id: request_id, command: "ls -la", tool_name: "Bash", agent: "claude"}}, 2_000

    SymphonyElixir.Claude.ApprovalBroker.resolve(request_id, :approve)

    response = Task.await(caller, 5_000)
    assert %{"result" => %{"content" => [%{"text" => text}], "isError" => false}} = response.body
    assert %{"behavior" => "allow", "updatedInput" => %{"command" => "ls -la"}} = Jason.decode!(text)

    CodingAgent.stop_session(session)
  end

  test "interactive build approval tool denies when the operator declines" do
    {root, ws} = workspace()
    test_pid = self()

    {:ok, session} =
      CodingAgent.start_session(ws,
        workspace_root: root,
        claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}",
        execution_mode: "build",
        interactive_user_input: true,
        approval_timeout_ms: 5_000,
        on_approval_required: fn request -> send(test_pid, {:approval_request, request}) end
      )

    url = mcp_url(session.mcp_config_path)

    caller =
      Task.async(fn ->
        Req.post!(url,
          json: %{
            "jsonrpc" => "2.0",
            "id" => 1,
            "method" => "tools/call",
            "params" => %{
              "name" => "symphony_approve",
              "arguments" => %{"tool_name" => "Bash", "input" => %{"command" => "rm -rf /"}}
            }
          },
          retry: false
        )
      end)

    assert_receive {:approval_request, %{request_id: request_id}}, 2_000
    SymphonyElixir.Claude.ApprovalBroker.resolve(request_id, :deny)

    response = Task.await(caller, 5_000)
    assert %{"result" => %{"content" => [%{"text" => text}]}} = response.body
    assert %{"behavior" => "deny", "message" => _} = Jason.decode!(text)

    CodingAgent.stop_session(session)
  end

  test "workspace guard still rejects the workspace root itself" do
    {root, _ws} = workspace()
    assert {:error, {:invalid_workspace_cwd, :workspace_root, _}} = CodingAgent.start_session(root, workspace_root: root)
  end

  test "missing binary fails the turn visibly" do
    {root, ws} = workspace()

    {:ok, session} =
      CodingAgent.start_session(ws, workspace_root: root, claude_command: "definitely-not-a-binary-xyz")

    assert {:error, _reason} = CodingAgent.run_turn(session, "x", @issue, [])
  end
end
