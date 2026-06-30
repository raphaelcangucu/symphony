defmodule SymphonyElixir.DevServeGuardTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServeGuard

  setup do
    lock_path =
      Path.join(System.tmp_dir!(), "symphony-serve-guard-#{System.unique_integer([:positive])}.lock")

    on_exit(fn -> File.rm_rf!(lock_path) end)

    %{lock_path: lock_path}
  end

  test "acquires the lock and records pid + workflow when none exists", %{lock_path: lock_path} do
    assert :ok =
             DevServeGuard.acquire(
               lock_path: lock_path,
               self_pid: "111",
               workflow_path: "/wf/A.md",
               alive?: fn _ -> true end
             )

    assert {:ok, %{"pid" => "111", "workflow_path" => "/wf/A.md"}} = read_lock(lock_path)
  end

  test "refuses to start when another live serve already holds the lock", %{lock_path: lock_path} do
    write_lock(lock_path, %{"pid" => "222", "workflow_path" => "/wf/A.md"})

    assert {:error, {:already_running, %{"pid" => "222", "workflow_path" => "/wf/A.md"}}} =
             DevServeGuard.acquire(
               lock_path: lock_path,
               self_pid: "999",
               workflow_path: "/wf/B.md",
               alive?: fn "222" -> true end
             )
  end

  test "takes over a stale lock whose process is dead", %{lock_path: lock_path} do
    write_lock(lock_path, %{"pid" => "222", "workflow_path" => "/wf/A.md"})

    assert :ok =
             DevServeGuard.acquire(
               lock_path: lock_path,
               self_pid: "999",
               workflow_path: "/wf/B.md",
               alive?: fn "222" -> false end
             )

    assert {:ok, %{"pid" => "999", "workflow_path" => "/wf/B.md"}} = read_lock(lock_path)
  end

  test "re-acquires its own lock idempotently", %{lock_path: lock_path} do
    write_lock(lock_path, %{"pid" => "777", "workflow_path" => "/wf/A.md"})

    assert :ok =
             DevServeGuard.acquire(
               lock_path: lock_path,
               self_pid: "777",
               workflow_path: "/wf/A.md",
               alive?: fn _ -> true end
             )
  end

  test "acquires when the lock file is corrupt", %{lock_path: lock_path} do
    File.write!(lock_path, "not json{{{")

    assert :ok =
             DevServeGuard.acquire(
               lock_path: lock_path,
               self_pid: "555",
               workflow_path: "/wf/A.md",
               alive?: fn _ -> true end
             )

    assert {:ok, %{"pid" => "555"}} = read_lock(lock_path)
  end

  test "records the node name so ctl can discover the daemon", %{lock_path: lock_path} do
    assert :ok =
             DevServeGuard.acquire(
               lock_path: lock_path,
               self_pid: "111",
               workflow_path: "/wf/A.md",
               node_name: "symphony@127.0.0.1",
               alive?: fn _ -> true end
             )

    assert {:ok, %{"node_name" => "symphony@127.0.0.1"}} = DevServeGuard.read(lock_path)
  end

  test "default_lock_path honors SYMPHONY_SERVE_LOCK_PATH", %{lock_path: lock_path} do
    System.put_env("SYMPHONY_SERVE_LOCK_PATH", lock_path)

    on_exit(fn ->
      System.delete_env("SYMPHONY_SERVE_LOCK_PATH")
    end)

    assert DevServeGuard.default_lock_path() == lock_path
  end

  defp write_lock(path, map), do: File.write!(path, Jason.encode!(map))
  defp read_lock(path), do: path |> File.read!() |> Jason.decode()
end
