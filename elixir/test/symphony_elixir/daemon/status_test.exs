defmodule SymphonyElixir.Daemon.StatusTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.{Paths, Status}

  test "healthy requires active service, matching pid, probe, version, and unit" do
    paths = Paths.resolve(%{"HOME" => "/home/alice"})

    deps = %{
      manifest: fn _ -> {:ok, %{"version" => "0.3.0", "git_commit" => "abc"}} end,
      unit_contents: fn _ -> {:ok, "expected-unit"} end,
      expected_unit: fn _ -> "expected-unit" end,
      service: fn _ ->
        {:ok,
         %{
           "LoadState" => "loaded",
           "UnitFileState" => "enabled",
           "ActiveState" => "active",
           "SubState" => "running",
           "MainPID" => "42",
           "NRestarts" => "1",
           "Result" => "success"
         }}
      end,
      listener: fn _ -> {:owned, [42]} end,
      health: fn _, _ ->
        {:ok, %{"status" => "ok", "version" => "0.3.0", "git_commit" => "abc"}}
      end,
      linger: fn -> {:ok, false} end
    }

    assert {:ok, status} = Status.inspect(paths, host: "127.0.0.1", port: 4000, deps: deps)
    assert status.state == :healthy
    assert status.healthy?
    assert status.drift == []
    refute status.linger?
  end

  test "reports foreign listener and version drift independently" do
    paths = Paths.resolve(%{"HOME" => "/home/alice"})
    deps = healthy_deps("42")
    deps = %{deps | listener: fn _ -> {:owned, [99]} end}
    deps = %{deps | health: fn _, _ -> {:ok, %{"status" => "ok", "version" => "old"}} end}

    assert {:ok, status} = Status.inspect(paths, host: "127.0.0.1", port: 4000, deps: deps)
    assert status.state == :unhealthy
    assert :foreign_listener in status.drift
    assert :version in status.drift
  end

  defp healthy_deps(pid) do
    %{
      manifest: fn _ -> {:ok, %{"version" => "0.3.0", "git_commit" => "abc"}} end,
      unit_contents: fn _ -> {:ok, "expected-unit"} end,
      expected_unit: fn _ -> "expected-unit" end,
      service: fn _ ->
        {:ok,
         %{
           "LoadState" => "loaded",
           "UnitFileState" => "enabled",
           "ActiveState" => "active",
           "SubState" => "running",
           "MainPID" => pid,
           "NRestarts" => "0",
           "Result" => "success"
         }}
      end,
      listener: fn _ -> {:owned, [String.to_integer(pid)]} end,
      health: fn _, _ ->
        {:ok, %{"status" => "ok", "version" => "0.3.0", "git_commit" => "abc"}}
      end,
      linger: fn -> {:ok, true} end
    }
  end
end
