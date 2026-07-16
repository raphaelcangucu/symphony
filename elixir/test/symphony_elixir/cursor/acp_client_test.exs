defmodule SymphonyElixir.Cursor.AcpClientTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Cursor.AcpClient

  test "request/3 correlates json-rpc responses by id" do
    parent = self()

    {:ok, client} =
      AcpClient.start_link(
        writer: fn line -> send(parent, {:written, line}) end,
        on_server_request: fn _m, _id, _p -> :ok end
      )

    task =
      Task.async(fn ->
        AcpClient.request(client, "initialize", %{"protocolVersion" => 1})
      end)

    assert_receive {:written, written}, 500
    assert %{"id" => id, "method" => "initialize"} = Jason.decode!(written)

    :ok =
      AcpClient.inject_line(
        client,
        Jason.encode!(%{"jsonrpc" => "2.0", "id" => id, "result" => %{"ok" => true}})
      )

    assert {:ok, %{"ok" => true}} = Task.await(task)
  end

  test "server request invokes on_server_request with method id and params" do
    parent = self()

    {:ok, client} =
      AcpClient.start_link(
        writer: fn _ -> :ok end,
        on_server_request: fn method, id, params ->
          send(parent, {:server_req, method, id, params})
          :ok
        end
      )

    :ok =
      AcpClient.inject_line(
        client,
        Jason.encode!(%{
          "jsonrpc" => "2.0",
          "id" => 9,
          "method" => "session/request_permission",
          "params" => %{"toolName" => "shell"}
        })
      )

    assert_receive {:server_req, "session/request_permission", 9, %{"toolName" => "shell"}}, 500
  end
end
