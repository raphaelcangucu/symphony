defmodule SymphonyElixir.Daemon.PreflightTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Preflight

  test "missing acknowledgement is a non-restartable error" do
    assert {:error, message} =
             Preflight.run(
               env: %{"HOME" => "/home/alice"},
               deps: permissive_deps()
             )

    assert message =~ "guardrails"
  end

  test "foreign port ownership fails without killing the process" do
    deps = %{permissive_deps() | listener: fn _ -> {:owned, [999]} end}

    assert {:error, message} =
             Preflight.run(
               env: acknowledged_env(),
               service_pid: nil,
               deps: deps
             )

    assert message =~ "port 4000"
    assert message =~ "999"
  end

  defp acknowledged_env do
    %{
      "HOME" => "/home/alice",
      "SYMPHONY_RUNTIME_MODE" => "installed",
      "SYMPHONY_UNGUARDED_ACKNOWLEDGED" => "true",
      "SYMPHONY_TRACKER_PORT" => "4000"
    }
  end

  defp permissive_deps do
    %{
      os_type: fn -> {:unix, :linux} end,
      systemd_ready: fn -> true end,
      manifest_valid: fn -> true end,
      paths_writable: fn -> true end,
      env_mode: fn -> 0o600 end,
      database_valid: fn -> true end,
      agent_available: fn -> true end,
      listener: fn _port -> :free end,
      optional_warnings: fn -> [] end
    }
  end
end
