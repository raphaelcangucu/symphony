defmodule SymphonyElixir.Daemon.StatusTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.{Paths, Status}

  test "healthy requires active service, matching pid, probe, version, and unit" do
    paths = Paths.resolve(%{"HOME" => "/home/alice"})

    deps = %{
      manifest: fn _ -> {:ok, %{"version" => "0.3.0", "git_commit" => "abc"}} end,
      unit_contents: fn _ -> {:ok, "expected-unit"} end,
      current_link: fn _ -> {:ok, paths.releases_dir <> "/0.3.0"} end,
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

  test "uses the installed host and port when explicit options are absent" do
    paths = Paths.resolve(%{"HOME" => "/home/alice"})
    owner = self()
    deps = healthy_deps("42")

    deps = %{
      deps
      | listener: fn port ->
          send(owner, {:listener_port, port})
          {:owned, [42]}
        end,
        health: fn host, port ->
          send(owner, {:health_endpoint, host, port})
          {:ok, %{"status" => "ok", "version" => "0.3.0", "git_commit" => "abc"}}
        end
    }

    assert {:ok, %{state: :healthy}} =
             Status.inspect(paths,
               env: %{
                 "SYMPHONY_TRACKER_HOST" => "127.0.0.9",
                 "SYMPHONY_TRACKER_PORT" => "43123"
               },
               deps: deps
             )

    assert_received {:listener_port, 43_123}
    assert_received {:health_endpoint, "127.0.0.9", 43_123}
  end

  test "reports active release and configured endpoint drift" do
    paths = Paths.resolve(%{"HOME" => "/home/alice"})
    deps = healthy_deps("42")

    deps = %{
      deps
      | current_link: fn _ -> {:ok, paths.releases_dir <> "/0.2.0"} end,
        health: fn _, _ ->
          {:ok,
           %{
             "status" => "ok",
             "version" => "0.3.0",
             "git_commit" => "abc",
             "tracker_host" => "127.0.0.1",
             "tracker_port" => 9_999
           }}
        end
    }

    assert {:ok, status} = Status.inspect(paths, host: "127.0.0.1", port: 4_000, deps: deps)
    assert :release in status.drift
    assert :configuration in status.drift
    assert status.state == :unhealthy
  end

  test "retained manifest alone is not an installed service" do
    paths = Paths.resolve(%{"HOME" => "/home/alice"})

    deps = %{
      manifest: fn _ -> {:ok, %{"version" => "0.3.0"}} end,
      unit_contents: fn _ -> {:error, :enoent} end,
      current_link: fn _ -> {:error, :enoent} end,
      expected_unit: fn _ -> "expected-unit" end,
      service: fn _ -> {:ok, %{"LoadState" => "not-found", "ActiveState" => "inactive"}} end,
      listener: fn _ -> :free end,
      health: fn _, _ -> {:error, :econnrefused} end,
      linger: fn -> {:ok, false} end
    }

    assert {:ok, status} = Status.inspect(paths, deps: deps)
    assert status.state == :uninstalled
    refute status.installed?
    assert status.retained?
  end

  defp healthy_deps(pid) do
    %{
      manifest: fn _ -> {:ok, %{"version" => "0.3.0", "git_commit" => "abc"}} end,
      unit_contents: fn _ -> {:ok, "expected-unit"} end,
      current_link: fn _ -> {:ok, "/home/alice/.local/lib/symphony/releases/0.3.0"} end,
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
