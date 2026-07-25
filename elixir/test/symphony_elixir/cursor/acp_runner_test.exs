defmodule SymphonyElixir.Cursor.AcpRunnerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Claude.ApprovalBroker
  alias SymphonyElixir.Cursor.AcpClient
  alias SymphonyElixir.Cursor.AcpRunner

  test "interactive permission request is approved via ApprovalBroker" do
    parent = self()

    writer = fn line ->
      send(parent, {:written, line})
    end

    task =
      Task.async(fn ->
        AcpRunner.run_turn(
          %{
            command: "unused",
            workspace: System.tmp_dir!(),
            prompt: "hello",
            session_uuid: "sess",
            cli_session_id: nil,
            model: nil,
            mcp_config_path: nil,
            timeout_ms: 5_000,
            writer: writer,
            on_client: fn client -> send(parent, {:client, client}) end,
            on_approval_required: fn req -> send(parent, {:approval_ui, req}) end
          },
          fn _event -> :ok end
        )
      end)

    assert_receive {:client, client}, 500

    # Handshake
    assert_receive {:written, init_line}, 500
    assert %{"id" => init_id, "method" => "initialize"} = Jason.decode!(init_line)
    AcpClient.inject_line(client, Jason.encode!(%{"jsonrpc" => "2.0", "id" => init_id, "result" => %{}}))

    assert_receive {:written, auth_line}, 500
    assert %{"id" => auth_id, "method" => "authenticate"} = Jason.decode!(auth_line)
    AcpClient.inject_line(client, Jason.encode!(%{"jsonrpc" => "2.0", "id" => auth_id, "result" => %{}}))

    assert_receive {:written, new_line}, 500
    assert %{"id" => new_id, "method" => "session/new"} = Jason.decode!(new_line)

    AcpClient.inject_line(
      client,
      Jason.encode!(%{
        "jsonrpc" => "2.0",
        "id" => new_id,
        "result" => %{"sessionId" => "acp-session-1"}
      })
    )

    assert_receive {:written, prompt_line}, 500
    assert %{"id" => prompt_id, "method" => "session/prompt"} = Jason.decode!(prompt_line)

    AcpClient.inject_line(
      client,
      Jason.encode!(%{
        "jsonrpc" => "2.0",
        "id" => 9001,
        "method" => "session/request_permission",
        "params" => %{"toolName" => "shell"}
      })
    )

    assert_receive {:approval_ui, req}, 2_000
    assert :ok = ApprovalBroker.resolve(req.request_id, :approve)

    assert_receive {:written, perm_line}, 2_000

    assert %{"id" => 9001, "result" => %{"outcome" => %{"optionId" => "allow-once"}}} =
             Jason.decode!(perm_line)

    AcpClient.inject_line(
      client,
      Jason.encode!(%{
        "jsonrpc" => "2.0",
        "id" => prompt_id,
        "result" => %{"stopReason" => "end_turn"}
      })
    )

    assert {:ok, result} = Task.await(task, 5_000)
    assert result.status == :completed
    assert result.cli_session_id == "acp-session-1"
  end

  @tag :tmp_dir
  test "workspace MCP config is loaded by Cursor instead of reshaped as ACP session servers",
       %{tmp_dir: tmp_dir} do
    parent = self()
    workspace = Path.expand(tmp_dir)
    mcp_path = Path.join(workspace, "mcp.json")

    File.write!(
      mcp_path,
      Jason.encode!(%{
        "mcpServers" => %{
          "symphony" => %{"url" => "http://127.0.0.1:9999"}
        }
      })
    )

    writer = fn line ->
      send(parent, {:written, line})
    end

    task =
      Task.async(fn ->
        AcpRunner.run_turn(
          %{
            command: "unused",
            workspace: workspace,
            prompt: "hello",
            session_uuid: "sess",
            cli_session_id: nil,
            model: nil,
            mcp_config_path: mcp_path,
            timeout_ms: 5_000,
            writer: writer,
            on_client: fn client -> send(parent, {:client, client}) end
          },
          fn _event -> :ok end
        )
      end)

    assert_receive {:client, client}, 500

    assert_receive {:written, init_line}, 500
    assert %{"id" => init_id, "method" => "initialize"} = Jason.decode!(init_line)
    AcpClient.inject_line(client, Jason.encode!(%{"jsonrpc" => "2.0", "id" => init_id, "result" => %{}}))

    assert_receive {:written, auth_line}, 500
    assert %{"id" => auth_id, "method" => "authenticate"} = Jason.decode!(auth_line)
    AcpClient.inject_line(client, Jason.encode!(%{"jsonrpc" => "2.0", "id" => auth_id, "result" => %{}}))

    assert_receive {:written, new_line}, 500

    assert %{
             "id" => new_id,
             "method" => "session/new",
             "params" => %{"cwd" => ^workspace, "mcpServers" => []}
           } = Jason.decode!(new_line)

    AcpClient.inject_line(
      client,
      Jason.encode!(%{
        "jsonrpc" => "2.0",
        "id" => new_id,
        "result" => %{"sessionId" => "acp-session-1"}
      })
    )

    assert_receive {:written, prompt_line}, 500
    assert %{"id" => prompt_id, "method" => "session/prompt"} = Jason.decode!(prompt_line)

    AcpClient.inject_line(
      client,
      Jason.encode!(%{
        "jsonrpc" => "2.0",
        "id" => prompt_id,
        "result" => %{"stopReason" => "end_turn"}
      })
    )

    assert {:ok, %{status: :completed}} = Task.await(task, 5_000)
  end
end
