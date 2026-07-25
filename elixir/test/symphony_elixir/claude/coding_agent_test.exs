defmodule SymphonyElixir.Claude.CodingAgentTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Claude.{CodingAgent, GoalStore}

  @fake Path.expand("../../support/fixtures/fake_claude.sh", __DIR__)
  @issue %{id: "1", identifier: "PREF-1", title: "Test issue"}

  defp workspace do
    suffix = 10 |> :crypto.strong_rand_bytes() |> Base.url_encode64(padding: false)
    root = Path.join(System.tmp_dir!(), "claude-adapter-#{suffix}")
    ws = Path.join(root, "issue-1")
    File.mkdir_p!(ws)
    on_exit(fn -> File.rm_rf(root) end)
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
    assert result.provider == "claude"
    assert result.conversation_id == "sess-123"
    assert is_binary(result.run_id)

    events = collector |> Agent.get(&Enum.reverse/1) |> Enum.map(& &1.event)
    assert :session_started in events
    assert :turn_completed in events
    Agent.stop(collector)
  end

  test "completing an injected set does not erase a newer queued clear" do
    {root, ws} = workspace()
    thread_id = 8003

    assert :ok =
             GoalStore.put(
               ws,
               :authoring,
               %{"objective" => "Audit", "pending_command" => "set"},
               thread_id
             )

    {:ok, session} =
      CodingAgent.start_session(ws,
        workspace_root: root,
        claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}"
      )

    on_message = fn
      %{event: :session_started} ->
        assert :ok =
                 GoalStore.put(
                   ws,
                   :authoring,
                   %{"objective" => "Audit", "pending_command" => "clear"},
                   thread_id
                 )

      _message ->
        :ok
    end

    assert {:ok, _result} =
             CodingAgent.run_turn(session, "continue", @issue,
               goal_role: :authoring,
               assistant_thread_id: thread_id,
               on_message: on_message
             )

    assert {:ok, %{"pending_command" => "clear"}} =
             GoalStore.read(ws, :authoring, thread_id)
  end

  test "completing an injected set does not erase a newer queued set" do
    {root, ws} = workspace()
    thread_id = 8004

    assert :ok =
             GoalStore.put(
               ws,
               :authoring,
               %{"objective" => "First", "pending_command" => "set"},
               thread_id
             )

    {:ok, session} =
      CodingAgent.start_session(ws,
        workspace_root: root,
        claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}"
      )

    on_message = fn
      %{event: :session_started} ->
        GoalStore.put(
          ws,
          :authoring,
          %{"objective" => "Second", "pending_command" => "set"},
          thread_id
        )

      _message ->
        :ok
    end

    assert {:ok, _result} =
             CodingAgent.run_turn(session, "continue", @issue,
               goal_role: :authoring,
               assistant_thread_id: thread_id,
               on_message: on_message
             )

    assert {:ok, %{"objective" => "Second", "pending_command" => "set"}} =
             GoalStore.read(ws, :authoring, thread_id)
  end

  test "malformed scoped goal fails before launching Claude" do
    {root, ws} = workspace()
    thread_id = 8005
    path = GoalStore.path(ws, :authoring, thread_id)
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, "{broken")

    {:ok, session} =
      CodingAgent.start_session(ws,
        workspace_root: root,
        claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}"
      )

    assert {:error, {:goal_state_read_failed, :invalid_goal_store}} =
             CodingAgent.run_turn(session, "continue", @issue,
               goal_role: :authoring,
               assistant_thread_id: thread_id
             )
  end

  test "successful headless turn completes an active native authoring goal" do
    {root, ws} = workspace()
    thread_id = 8010

    assert :ok =
             GoalStore.put(
               ws,
               :authoring,
               %{"objective" => "Audit", "status" => "running", "pending_command" => "set"},
               thread_id
             )

    {:ok, session} =
      CodingAgent.start_session(ws,
        workspace_root: root,
        claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}"
      )

    assert {:ok, _result} =
             CodingAgent.run_turn(session, "continue", @issue,
               goal_role: :authoring,
               assistant_thread_id: thread_id
             )

    assert {:ok, %{"status" => "completed", "pending_command" => nil}} =
             GoalStore.read(ws, :authoring, thread_id)
  end

  test "interrupted headless turn preserves an active resumable authoring goal" do
    {root, ws} = workspace()
    thread_id = 8011

    assert :ok =
             GoalStore.put(
               ws,
               :authoring,
               %{"objective" => "Audit", "status" => "running", "pending_command" => "set"},
               thread_id
             )

    {:ok, session} =
      CodingAgent.start_session(ws,
        workspace_root: root,
        claude_command: "FAKE_CLAUDE_MODE=hang #{@fake}"
      )

    task =
      Task.async(fn ->
        CodingAgent.run_turn(session, "continue", @issue,
          goal_role: :authoring,
          assistant_thread_id: thread_id
        )
      end)

    Process.sleep(100)
    send(task.pid, {:agent_interrupt})

    assert {:error, :interrupted} = Task.await(task, 5_000)

    assert {:ok, %{"status" => "paused", "objective" => "Audit", "pending_command" => "set"}} =
             GoalStore.read(ws, :authoring, thread_id)
  end

  test "revisionless pending set and clear fail before launching Claude" do
    for {thread_id, command} <- [{8006, "set"}, {8007, "clear"}] do
      {root, ws} = workspace()
      path = GoalStore.path(ws, :authoring, thread_id)
      File.mkdir_p!(Path.dirname(path))

      File.write!(
        path,
        Jason.encode!(%{
          "goal" => %{
            "status" => "active",
            "objective" => "Audit",
            "pending_command" => command
          }
        })
      )

      {:ok, session} =
        CodingAgent.start_session(ws,
          workspace_root: root,
          claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}"
        )

      assert {:error, {:goal_state_read_failed, :invalid_goal_store}} =
               CodingAgent.run_turn(session, "continue", @issue,
                 goal_role: :authoring,
                 assistant_thread_id: thread_id
               )
    end
  end

  test "goal preflight uses the exact command later stored on the session" do
    {root, ws} = workspace()
    wrapper = Path.join(root, "claude-wrapper")
    marker = Path.join(root, "preflight-command")

    File.write!(
      wrapper,
      """
      #!/usr/bin/env bash
      if [ "$1" = "--version" ]; then
        printf '%s\n' "$GOAL_COMMAND_MARKER" > "#{marker}"
        echo "2.1.139"
        exit 0
      fi
      exec #{@fake} "$@"
      """
    )

    File.chmod!(wrapper, 0o755)
    command = "GOAL_COMMAND_MARKER=exact #{wrapper}"

    assert {:ok, session} =
             CodingAgent.start_session(ws,
               workspace_root: root,
               claude_command: command,
               goal_role: :authoring
             )

    assert session.command == command
    assert File.read!(marker) == "exact\n"
  end

  test "goal acknowledgement failure fails the completed turn visibly" do
    {root, ws} = workspace()

    assert :ok =
             GoalStore.put(ws, :execution, %{
               "status" => "completed",
               "objective" => "Audit",
               "pending_command" => "set"
             })

    {:ok, session} =
      CodingAgent.start_session(ws,
        workspace_root: root,
        claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}"
      )

    on_message = fn
      %{event: :session_started} ->
        path = GoalStore.path(ws, :execution)
        File.rm!(path)
        File.mkdir_p!(path)

      _message ->
        :ok
    end

    assert {:error, {:goal_acknowledgement_failed, {:goal_store_read_failed, :eisdir}}} =
             CodingAgent.run_turn(session, "continue", @issue, on_message: on_message)
  end

  test "goal lifecycle finalization failure fails the completed turn visibly" do
    {root, ws} = workspace()

    assert :ok =
             GoalStore.put(ws, :execution, %{
               "status" => "running",
               "objective" => "Audit",
               "pending_command" => nil
             })

    {:ok, session} =
      CodingAgent.start_session(ws,
        workspace_root: root,
        claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}"
      )

    on_message = fn
      %{event: :session_started} ->
        path = GoalStore.path(ws, :execution)
        File.rm!(path)
        File.mkdir_p!(path)

      _message ->
        :ok
    end

    assert {:error, {:goal_lifecycle_transition_failed, {:goal_store_read_failed, :eisdir}}} =
             CodingAgent.run_turn(session, "continue", @issue, on_message: on_message)
  end

  test "second turn resumes with the captured cli session id" do
    {root, ws} = workspace()

    {:ok, session} =
      CodingAgent.start_session(ws, workspace_root: root, claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}")

    {:ok, result} = CodingAgent.run_turn(session, "turn 1", @issue, [])
    session = Map.put(session, :cli_session_id, result.conversation_id)

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
