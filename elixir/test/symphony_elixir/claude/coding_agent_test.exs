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
    for {mode, expected} <- [{"plan", "plan"}, {"build", "acceptEdits"}, {"yolo", "bypassPermissions"}] do
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

  test "missing execution_mode defaults to the build permission mode" do
    {root, ws} = workspace()

    assert {:ok, session} =
             CodingAgent.start_session(ws,
               workspace_root: root,
               claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}"
             )

    assert session.permission_mode == "acceptEdits"
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
