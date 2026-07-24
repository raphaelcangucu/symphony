defmodule SymphonyElixir.Daemon.LifecycleTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Lifecycle

  test "start is idempotent when already healthy" do
    deps = %{
      status: fn -> {:ok, %{state: :healthy}} end,
      systemd_start: fn -> flunk("must not start an already healthy service") end,
      wait_healthy: fn -> flunk("must not wait") end
    }

    assert {:ok, :already_healthy} = Lifecycle.start(deps: deps)
  end

  test "forced restart kills the cgroup and waits for health" do
    test_pid = self()

    deps = %{
      force_restart: fn ->
        send(test_pid, :killed)
        :ok
      end,
      restart: fn -> flunk("ordinary restart must not run") end,
      wait_healthy: fn ->
        send(test_pid, :healthy)
        {:ok, %{state: :healthy}}
      end
    }

    assert {:ok, %{state: :healthy}} = Lifecycle.restart(force: true, deps: deps)
    assert_received :killed
    assert_received :healthy
  end

  test "uninstall removes service pointers but preserves persistent data" do
    root = Path.join(System.tmp_dir!(), "daemon-uninstall-#{System.unique_integer([:positive])}")
    unit = Path.join(root, "symphony.service")
    launcher = Path.join(root, "bin/symphony")
    current = Path.join(root, "current")
    persistent = ~w(symphony.env install.json tracker.sqlite3 backups logs releases)

    Enum.each([unit, launcher, current | Enum.map(persistent, &Path.join(root, &1))], fn path ->
      File.mkdir_p!(Path.dirname(path))
      File.write!(path, "keep")
    end)

    on_exit(fn -> File.rm_rf!(root) end)

    deps = %{
      disable_now: fn -> :ok end,
      daemon_reload: fn -> :ok end,
      unit_file: unit,
      launcher: launcher,
      current_link: current
    }

    assert :ok = Lifecycle.uninstall(deps: deps)
    refute File.exists?(unit)
    refute File.exists?(launcher)
    refute File.exists?(current)
    assert Enum.all?(persistent, &File.exists?(Path.join(root, &1)))
  end

  test "uninstall is idempotent when the unit and pointers are already absent" do
    root = Path.join(System.tmp_dir!(), "daemon-uninstall-absent-#{System.unique_integer([:positive])}")
    on_exit(fn -> File.rm_rf!(root) end)

    deps = %{
      disable_now: fn ->
        {:error, {:command_failed, 5, "Unit symphony.service does not exist"}}
      end,
      daemon_reload: fn -> :ok end,
      unit_file: Path.join(root, "symphony.service"),
      launcher: Path.join(root, "symphony"),
      current_link: Path.join(root, "current")
    }

    assert :ok = Lifecycle.uninstall(deps: deps)
  end
end
