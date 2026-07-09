defmodule SymphonyElixir.Agent.CliRunner.BaseTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Agent.CliRunner.Base

  @loop_timeout_ms 500
  @assertion_timeout_ms 1_000

  test "receive_loop kills port on {:agent_interrupt}" do
    port = open_bash_port("sleep 30")
    task = start_receive_loop(port)
    on_exit(fn -> cleanup_port_and_task(port, task) end)

    send(task.pid, {:agent_interrupt})

    assert {:ok, {:error, :interrupted}} = Task.yield(task, @assertion_timeout_ms)
    assert :undefined == :erlang.port_info(port)
  end

  test "receive_loop kills tool child on {:kill_tool, id} and keeps the turn running" do
    tmp_dir = make_tmp_dir!()
    on_exit(fn -> File.rm_rf(tmp_dir) end)

    child_pid_file = Path.join(tmp_dir, "child.pid")

    port =
      open_bash_port("""
      sleep 30 &
      child=$!
      echo "$child" > #{Base.shell_escape(child_pid_file)}
      wait "$child" 2>/dev/null
      while true; do sleep 1; done
      """)

    task = start_receive_loop(port)
    on_exit(fn -> cleanup_port_and_task(port, task) end)

    child_pid = wait_for_pid_file!(child_pid_file)

    assert os_process_alive?(child_pid), "expected child process #{child_pid} to be alive before kill_tool"

    send(task.pid, {:kill_tool, "tool-1"})

    assert eventually_dead?(child_pid),
           "expected kill_tool to kill child process #{child_pid} without ending the receive loop"

    refute Task.yield(task, 100), "receive_loop should continue after kill_tool"

    send(task.pid, {:agent_interrupt})
    assert {:ok, {:error, :interrupted}} = Task.yield(task, @assertion_timeout_ms)
  end

  defp start_receive_loop(port) do
    parent = self()

    handlers = [
      on_json: fn payload, state ->
        send(parent, {:json, payload})
        state
      end,
      on_stray_line: fn line, state ->
        send(parent, {:stray_line, line})
        state
      end,
      on_exit: fn status, state -> {:exit_status, status, state} end
    ]

    Task.async(fn ->
      Base.receive_loop(port, @loop_timeout_ms, "", %{}, handlers)
    end)
  end

  defp open_bash_port(command) when is_binary(command) do
    bash = System.find_executable("bash") || raise "bash is required for receive_loop tests"

    Port.open(
      {:spawn_executable, bash},
      [
        :binary,
        :exit_status,
        :stderr_to_stdout,
        args: [~c"-lc", String.to_charlist(command)],
        line: 1024
      ]
    )
  end

  defp make_tmp_dir! do
    tmp_dir =
      Path.join(
        System.tmp_dir!(),
        "symphony-cli-runner-base-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(tmp_dir)
    tmp_dir
  end

  defp wait_for_pid_file!(pid_file), do: wait_for_pid_file!(pid_file, 50)

  defp wait_for_pid_file!(pid_file, 0), do: flunk("child process never wrote pid file #{pid_file}")

  defp wait_for_pid_file!(pid_file, attempts) do
    case File.read(pid_file) do
      {:ok, raw} ->
        raw
        |> String.trim()
        |> case do
          "" -> retry_pid_file(pid_file, attempts)
          pid -> pid
        end

      {:error, _reason} ->
        retry_pid_file(pid_file, attempts)
    end
  end

  defp retry_pid_file(pid_file, attempts) do
    Process.sleep(20)
    wait_for_pid_file!(pid_file, attempts - 1)
  end

  defp eventually_dead?(pid), do: eventually_dead?(pid, 50)

  defp eventually_dead?(_pid, 0), do: false

  defp eventually_dead?(pid, attempts) do
    if os_process_alive?(pid) do
      Process.sleep(20)
      eventually_dead?(pid, attempts - 1)
    else
      true
    end
  end

  defp os_process_alive?(pid) when is_binary(pid) do
    match?({_output, 0}, System.cmd("kill", ["-0", pid], stderr_to_stdout: true))
  end

  defp cleanup_port_and_task(port, task) do
    if is_port(port), do: Base.kill_port(port)

    if match?(%Task{pid: pid} when is_pid(pid), task) and Process.alive?(task.pid) do
      Process.exit(task.pid, :kill)
    end
  end
end
