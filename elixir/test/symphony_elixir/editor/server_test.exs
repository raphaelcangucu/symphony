defmodule SymphonyElixir.Editor.ServerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Editor.Server

  setup do
    previous = %{
      finder: Application.get_env(:symphony_elixir, :editor_executable_finder),
      spawner: Application.get_env(:symphony_elixir, :editor_spawner),
      probe: Application.get_env(:symphony_elixir, :editor_probe),
      killer: Application.get_env(:symphony_elixir, :editor_killer)
    }

    on_exit(fn ->
      restore(:editor_executable_finder, previous.finder)
      restore(:editor_spawner, previous.spawner)
      restore(:editor_probe, previous.probe)
      restore(:editor_killer, previous.killer)
    end)

    :ok
  end

  test "marks unavailable when binary is not found" do
    Application.put_env(:symphony_elixir, :editor_executable_finder, fn _binary -> nil end)
    Application.put_env(:symphony_elixir, :editor_spawner, fn _args -> flunk("should not spawn") end)

    pid = start_supervised!({Server, name: :editor_server_missing})
    assert Server.status(pid) == :unavailable
  end

  test "transitions starting -> ready once the probe succeeds" do
    test_pid = self()
    Application.put_env(:symphony_elixir, :editor_executable_finder, fn _binary -> "/usr/bin/code-server" end)
    Application.put_env(:symphony_elixir, :editor_spawner, fn _args -> {:ok, make_ref()} end)

    Application.put_env(:symphony_elixir, :editor_probe, fn _hp ->
      send(test_pid, :probed)
      :ok
    end)

    pid = start_supervised!({Server, name: :editor_server_ready})
    send(pid, :probe)
    assert_receive :probed, 1_000
    assert Server.status(pid) == :ready
  end

  test "stays starting while the probe keeps failing" do
    Application.put_env(:symphony_elixir, :editor_executable_finder, fn _binary -> "/usr/bin/code-server" end)
    Application.put_env(:symphony_elixir, :editor_spawner, fn _args -> {:ok, make_ref()} end)
    Application.put_env(:symphony_elixir, :editor_probe, fn _hp -> {:error, :econnrefused} end)

    pid = start_supervised!({Server, name: :editor_server_starting})
    send(pid, :probe)
    assert Server.status(pid) == :starting
  end

  test "kills the code-server process on shutdown" do
    test_pid = self()
    Application.put_env(:symphony_elixir, :editor_executable_finder, fn _binary -> "/usr/bin/code-server" end)
    Application.put_env(:symphony_elixir, :editor_spawner, fn _args -> {:ok, :fake_port} end)
    Application.put_env(:symphony_elixir, :editor_probe, fn _hp -> {:error, :econnrefused} end)

    Application.put_env(:symphony_elixir, :editor_killer, fn port ->
      send(test_pid, {:killed, port})
      :ok
    end)

    start_supervised!({Server, name: :editor_server_shutdown})
    stop_supervised!(Server)

    assert_receive {:killed, :fake_port}, 1_000
  end

  defp restore(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore(key, value), do: Application.put_env(:symphony_elixir, key, value)
end
