defmodule SymphonyElixir.Cursor.CodingAgentTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Cursor.CodingAgent

  @fake Path.expand("../../support/fixtures/fake_cursor.sh", __DIR__)
  @issue %{id: "1", identifier: "PREF-1", title: "Test issue"}

  defp workspace do
    root = Path.join(System.tmp_dir!(), "cursor-adapter-#{System.unique_integer([:positive])}")
    ws = Path.join(root, "issue-1")
    File.mkdir_p!(ws)
    {root, ws}
  end

  test "start_session is portless and run_turn completes via the CLI runner" do
    {root, ws} = workspace()

    assert {:ok, session} =
             CodingAgent.start_session(ws,
               workspace_root: root,
               cursor_command: "FAKE_CURSOR_MODE=happy #{@fake}"
             )

    assert session.cli_session_id == nil
    assert is_binary(session.session_uuid)

    {:ok, collector} = Agent.start_link(fn -> [] end)
    on_message = fn message -> Agent.update(collector, &[message | &1]) end

    assert {:ok, result} = CodingAgent.run_turn(session, "do it", @issue, on_message: on_message)
    assert result.session_id =~ session.session_uuid
    assert result.cli_session_id == "chat-123"

    events = collector |> Agent.get(&Enum.reverse/1) |> Enum.map(& &1.event)
    assert :session_started in events
    assert :turn_completed in events
    Agent.stop(collector)
  end

  test "second turn resumes with the captured chat id" do
    {root, ws} = workspace()

    {:ok, session} =
      CodingAgent.start_session(ws, workspace_root: root, cursor_command: "FAKE_CURSOR_MODE=happy #{@fake}")

    {:ok, result} = CodingAgent.run_turn(session, "turn 1", @issue, [])
    session = Map.put(session, :cli_session_id, result.cli_session_id)

    args =
      SymphonyElixir.Cursor.CliRunner.build_args(%{
        cli_session_id: session.cli_session_id,
        model: nil,
        mcp_config_path: nil
      })

    assert args =~ "--resume chat-123"
  end

  test "dynamic tools register a gateway session and write .cursor/mcp.json" do
    {root, ws} = workspace()

    specs = [%{"name" => "echo_tool", "description" => "d", "inputSchema" => %{"type" => "object"}}]
    executor = fn _name, _args -> %{"success" => true, "contentItems" => []} end

    {:ok, session} =
      CodingAgent.start_session(ws,
        workspace_root: root,
        cursor_command: "FAKE_CURSOR_MODE=happy #{@fake}",
        dynamic_tools: specs,
        tool_executor: executor
      )

    assert session.mcp_config_path == Path.join([ws, ".cursor", "mcp.json"])
    assert File.exists?(session.mcp_config_path)

    config = session.mcp_config_path |> File.read!() |> Jason.decode!()
    assert %{"mcpServers" => %{"symphony" => %{"url" => "http://127.0.0.1:" <> _}}} = config

    assert {:ok, _} = CodingAgent.run_turn(session, "with tools", @issue, [])
    assert :ok = CodingAgent.stop_session(session)
    refute File.exists?(session.mcp_config_path)
  end

  test "an existing .cursor/mcp.json is merged and restored on stop" do
    {root, ws} = workspace()

    dir = Path.join(ws, ".cursor")
    File.mkdir_p!(dir)
    path = Path.join(dir, "mcp.json")
    original = Jason.encode!(%{"mcpServers" => %{"existing" => %{"url" => "http://example.test"}}})
    File.write!(path, original)

    specs = [%{"name" => "echo_tool", "description" => "d", "inputSchema" => %{"type" => "object"}}]
    executor = fn _name, _args -> %{"success" => true, "contentItems" => []} end

    {:ok, session} =
      CodingAgent.start_session(ws,
        workspace_root: root,
        cursor_command: "FAKE_CURSOR_MODE=happy #{@fake}",
        dynamic_tools: specs,
        tool_executor: executor
      )

    merged = path |> File.read!() |> Jason.decode!()
    assert Map.has_key?(merged["mcpServers"], "existing")
    assert Map.has_key?(merged["mcpServers"], "symphony")

    assert :ok = CodingAgent.stop_session(session)
    assert File.read!(path) == original
  end

  test "normalize_event canonicalizes cursor turn usage payloads" do
    event =
      CodingAgent.normalize_event(%{
        event: :turn_completed,
        payload: %{
          "method" => "turn/completed",
          "params" => %{
            "usage" => %{"inputTokens" => 90, "outputTokens" => 10, "totalTokens" => 100}
          }
        },
        timestamp: DateTime.utc_now()
      })

    assert event.usage == %{input_tokens: 90, output_tokens: 10, total_tokens: 100}
  end

  test "implements CodingAgent behaviour and is routed by adapter_for/1" do
    behaviours =
      CodingAgent.__info__(:attributes)
      |> Keyword.get_values(:behaviour)
      |> List.flatten()

    assert SymphonyElixir.CodingAgent in behaviours
    assert SymphonyElixir.CodingAgent.adapter_for("cursor") == CodingAgent
  end

  test "workspace guard still rejects the workspace root itself" do
    {root, _ws} = workspace()
    assert {:error, {:invalid_workspace_cwd, :workspace_root, _}} = CodingAgent.start_session(root, workspace_root: root)
  end

  test "missing binary fails the turn visibly" do
    {root, ws} = workspace()

    {:ok, session} =
      CodingAgent.start_session(ws, workspace_root: root, cursor_command: "definitely-not-a-binary-xyz")

    assert {:error, _reason} = CodingAgent.run_turn(session, "x", @issue, [])
  end
end
