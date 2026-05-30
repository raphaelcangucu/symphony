defmodule SymphonyElixir.Editor.ServerTest do
  use SymphonyElixir.TestSupport, async: false

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

  test "probes 127.0.0.1 when the configured host is 0.0.0.0" do
    test_pid = self()

    load_workflow_with_front_matter("""
    github:
      repo: acme/app
    editor:
      enabled: true
      host: 0.0.0.0
      port: 4002
    """)

    Application.put_env(:symphony_elixir, :editor_executable_finder, fn _binary -> "/usr/bin/code-server" end)
    Application.put_env(:symphony_elixir, :editor_spawner, fn _args -> {:ok, make_ref()} end)

    Application.put_env(:symphony_elixir, :editor_probe, fn {host, _port} ->
      send(test_pid, {:probe_host, host})
      :ok
    end)

    pid = start_supervised!({Server, name: :editor_server_probe_host})
    send(pid, :probe)
    assert_receive {:probe_host, "127.0.0.1"}, 1_000
  end

  test "stays alive and degraded when the code-server process exits" do
    fake = make_ref()
    Application.put_env(:symphony_elixir, :editor_executable_finder, fn _binary -> "/usr/bin/code-server" end)
    Application.put_env(:symphony_elixir, :editor_spawner, fn _args -> {:ok, fake} end)
    Application.put_env(:symphony_elixir, :editor_probe, fn _hp -> {:error, :econnrefused} end)

    pid = start_supervised!({Server, name: :editor_server_exited})
    send(pid, {fake, {:exit_status, 1}})

    assert Server.status(pid) == :unavailable
    assert Process.alive?(pid)
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

  defp load_workflow_with_front_matter(front_matter) do
    content = "---\n" <> front_matter <> "---\n"
    File.write!(Workflow.workflow_file_path(), content)

    if Process.whereis(SymphonyElixir.WorkflowStore) do
      SymphonyElixir.WorkflowStore.force_reload()
    end

    :ok
  end
end
