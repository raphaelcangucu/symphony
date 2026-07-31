defmodule SymphonyElixir.Cursor.AcpClientTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Cursor.AcpClient

  test "command_args pins the requested model before entering ACP mode" do
    assert AcpClient.command_args(nil) == ["acp"]
    assert AcpClient.command_args("composer-2.5") == ["--model", "composer-2.5", "acp"]
  end

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

  test "stopping the client reaps the whole ACP process group" do
    test_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-cursor-acp-reaper-#{System.unique_integer([:positive])}"
      )

    fake_cursor = Path.join(test_root, "fake-cursor")
    grandchild_file = Path.join(test_root, "grandchild.pid")
    File.mkdir_p!(test_root)

    File.write!(fake_cursor, """
    #!/bin/sh
    sleep 300 &
    echo "$!" > "#{grandchild_file}"
    while IFS= read -r _line; do :; done
    """)

    File.chmod!(fake_cursor, 0o755)

    try do
      assert {:ok, client} =
               AcpClient.start_link(
                 command: fake_cursor,
                 workspace: test_root,
                 on_server_request: fn _method, _id, _params -> :ok end
               )

      grandchild_pid = wait_for_pid_file!(grandchild_file)
      assert os_process_alive?(grandchild_pid)
      port = :sys.get_state(client).port
      {:os_pid, port_pid} = Port.info(port, :os_pid)

      {process_tree, 0} =
        System.cmd(
          "ps",
          ["-o", "pid=,ppid=,pgid=,state=,args=", "-p", "#{port_pid},#{grandchild_pid}"],
          stderr_to_stdout: true
        )

      GenServer.stop(client, :normal, 5_000)

      assert eventually_dead?(grandchild_pid),
             "Cursor ACP grandchild #{grandchild_pid} survived client shutdown:\n#{process_tree}"
    after
      case File.read(grandchild_file) do
        {:ok, raw} -> System.cmd("kill", ["-9", String.trim(raw)], stderr_to_stdout: true)
        _ -> :ok
      end

      File.rm_rf!(test_root)
    end
  end

  defp wait_for_pid_file!(path, attempts \\ 50)
  defp wait_for_pid_file!(_path, 0), do: flunk("fake Cursor never wrote its grandchild pid")

  defp wait_for_pid_file!(path, attempts) do
    case File.read(path) do
      {:ok, raw} ->
        String.to_integer(String.trim(raw))

      _ ->
        Process.sleep(20)
        wait_for_pid_file!(path, attempts - 1)
    end
  end

  defp eventually_dead?(pid, attempts \\ 50)
  defp eventually_dead?(_pid, 0), do: false

  defp eventually_dead?(pid, attempts) do
    if os_process_alive?(pid) do
      Process.sleep(20)
      eventually_dead?(pid, attempts - 1)
    else
      true
    end
  end

  defp os_process_alive?(pid) do
    case File.read("/proc/#{pid}/stat") do
      {:ok, stat} ->
        case Regex.run(~r/^\d+ \(.*\) ([A-Z]) /, stat) do
          [_, "Z"] -> false
          [_, _state] -> true
          _ -> match?({_, 0}, System.cmd("kill", ["-0", Integer.to_string(pid)], stderr_to_stdout: true))
        end

      _ ->
        match?({_, 0}, System.cmd("kill", ["-0", Integer.to_string(pid)], stderr_to_stdout: true))
    end
  end
end
