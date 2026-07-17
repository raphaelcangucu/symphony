defmodule SymphonyElixir.DevServer.PreviewRunnerContractTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.DevServer.RuntimeReport

  @report_timeout_ms 10_000

  test "runner writes starting then ready and stops an HTTP server on the leased port" do
    with_runner_tmp(fn tmp ->
      port = available_port()
      report_path = Path.join(tmp, "preview-report.json")

      spec = %{
        "cwd" => tmp,
        "prepare" => [["python3", "-c", "__import__('time').sleep(0.3)"]],
        "start" => [["python3", "-m", "http.server", Integer.to_string(port), "--bind", "127.0.0.1"]],
        "health" => %{"path" => "/", "timeout_ms" => @report_timeout_ms, "interval_ms" => 25},
        "stop" => %{"signal" => "TERM", "grace_ms" => 2_000}
      }

      runner_port = start_runner(tmp, spec, report_path, port, [port])
      runner_pid = port_os_pid(runner_port)

      assert %{__struct__: RuntimeReport, state: "starting", selected_port: ^port} =
               await_report_state(report_path, "starting")

      ready_report = await_report_state(report_path, "ready")
      assert %{__struct__: RuntimeReport, state: "ready", actual_port: ^port} = ready_report
      assert is_integer(ready_report.pid)

      signal_process(runner_pid, "TERM")

      assert %{__struct__: RuntimeReport, state: "stopped", actual_port: ^port} =
               await_report_state(report_path, "stopped")

      assert_port_exit(runner_port, 0)
    end)
  end

  test "runner rejects healthy service when selected port is outside lease" do
    with_runner_tmp(fn tmp ->
      port = available_port()
      allowed_port = if port == 65_535, do: port - 1, else: port + 1
      report_path = Path.join(tmp, "preview-report.json")

      spec = %{
        "cwd" => tmp,
        "prepare" => [],
        "start" => [["python3", "-m", "http.server", Integer.to_string(port), "--bind", "127.0.0.1"]],
        "health" => %{"path" => "/", "timeout_ms" => @report_timeout_ms, "interval_ms" => 25},
        "stop" => %{"signal" => "TERM", "grace_ms" => 2_000}
      }

      runner_port = start_runner(tmp, spec, report_path, port, [allowed_port])

      assert %{
               __struct__: RuntimeReport,
               state: "error",
               actual_port: ^port,
               error: error
             } = await_report_state(report_path, "error")

      assert error =~ "allowed"
      assert_port_exit(runner_port, 1)
    end)
  end

  test "runner skips missing exists-gated start commands and health probes" do
    with_runner_tmp(fn tmp ->
      port = available_port()
      report_path = Path.join(tmp, "preview-report.json")
      marker_path = Path.join(tmp, "must-not-exist")

      spec = %{
        "cwd" => ".",
        "prepare" => [],
        "start" => [
          %{
            "exists" => "missing-start-command",
            "run" => ["python3", "-c", "__import__('pathlib').Path('must-not-exist').touch()"]
          },
          %{
            "argv" => ["python3", "-m", "http.server", Integer.to_string(port), "--bind", "127.0.0.1"]
          }
        ],
        "health" => %{
          "path" => "/",
          "timeout_ms" => @report_timeout_ms,
          "interval_ms" => 25,
          "also" => [
            %{"exists" => "missing-health-feature", "path" => "/definitely-not-found"}
          ]
        },
        "stop" => %{"signal" => "TERM", "grace_ms" => 2_000}
      }

      runner_port = start_runner(tmp, spec, report_path, port, [port])
      runner_pid = port_os_pid(runner_port)

      assert %{__struct__: RuntimeReport, state: "ready", actual_port: ^port} =
               await_report_state(report_path, "ready")

      refute File.exists?(marker_path)

      signal_process(runner_pid, "TERM")
      assert %{__struct__: RuntimeReport, state: "stopped"} = await_report_state(report_path, "stopped")
      assert_port_exit(runner_port, 0)
    end)
  end

  defp with_runner_tmp(test) do
    tmp =
      System.tmp_dir!()
      |> Path.join("preview-runner-#{System.unique_integer([:positive, :monotonic])}")

    File.mkdir_p!(tmp)

    try do
      test.(tmp)
    after
      cleanup_runner(tmp)
      File.rm_rf!(tmp)
    end
  end

  defp start_runner(tmp, spec, report_path, port, allowed_ports) do
    spec_path = Path.join(tmp, "run-spec.json")
    File.write!(spec_path, Jason.encode!(spec))

    env = [
      {"SYMPHONY_PREVIEW_CONTRACT_ID", "contract-#{port}"},
      {"SYMPHONY_PREVIEW_CONTRACT_REVISION", "1"},
      {"SYMPHONY_PREVIEW_PREFERRED_PORT", Integer.to_string(port)},
      {"SYMPHONY_PREVIEW_ALLOWED_PORTS", Enum.join(allowed_ports, ",")},
      {"SYMPHONY_PREVIEW_REPORT_PATH", report_path},
      {"SYMPHONY_PREVIEW_RUN_SPEC", spec_path},
      {"SYMPHONY_PREVIEW_SERVER_SLUG", "test-server"},
      {"PORT", Integer.to_string(port)}
    ]

    bash = System.find_executable("bash") || flunk("bash is required for preview runner tests")
    runner = Path.expand("priv/preview/run.sh", File.cwd!())

    Port.open(
      {:spawn_executable, bash},
      [
        :binary,
        :exit_status,
        :stderr_to_stdout,
        {:args, [String.to_charlist(runner)]},
        {:env, Enum.map(env, fn {key, value} -> {String.to_charlist(key), String.to_charlist(value)} end)},
        {:cd, String.to_charlist(tmp)}
      ]
    )
  end

  defp await_report_state(report_path, state) do
    deadline = System.monotonic_time(:millisecond) + @report_timeout_ms
    do_await_report_state(report_path, state, deadline)
  end

  defp do_await_report_state(report_path, state, deadline) do
    report =
      with {:ok, json} <- File.read(report_path),
           {:ok, parsed} <- RuntimeReport.parse(json) do
        parsed
      else
        _error -> nil
      end

    cond do
      match?(%{__struct__: RuntimeReport, state: ^state}, report) ->
        report

      System.monotonic_time(:millisecond) >= deadline ->
        flunk("report did not reach #{inspect(state)}; last report: #{inspect(report)}")

      true ->
        Process.sleep(20)
        do_await_report_state(report_path, state, deadline)
    end
  end

  defp assert_port_exit(port, expected_status) do
    receive do
      {^port, {:exit_status, ^expected_status}} ->
        :ok

      {^port, {:exit_status, actual_status}} ->
        flunk("runner exited with #{actual_status}, expected #{expected_status}")

      {^port, {:data, _output}} ->
        assert_port_exit(port, expected_status)
    after
      @report_timeout_ms ->
        flunk("runner did not exit")
    end
  end

  defp available_port do
    {:ok, socket} = :gen_tcp.listen(0, [:binary, ip: {127, 0, 0, 1}, active: false, reuseaddr: true])
    {:ok, {_address, port}} = :inet.sockname(socket)
    :ok = :gen_tcp.close(socket)
    port
  end

  defp port_os_pid(port) do
    {:os_pid, pid} = Port.info(port, :os_pid)
    pid
  end

  defp signal_process(pid, signal) when is_integer(pid) do
    System.cmd("kill", ["-#{signal}", Integer.to_string(pid)], stderr_to_stdout: true)
  end

  defp cleanup_runner(tmp) do
    report_path = Path.join(tmp, "preview-report.json")

    case File.read(report_path) do
      {:ok, json} ->
        case RuntimeReport.parse(json) do
          {:ok, %{__struct__: RuntimeReport, pid: pid}} when is_integer(pid) ->
            System.cmd("kill", ["-KILL", "--", "-#{pid}"], stderr_to_stdout: true)

          _other ->
            :ok
        end

      _error ->
        :ok
    end
  end
end
