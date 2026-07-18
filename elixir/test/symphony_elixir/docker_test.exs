defmodule SymphonyElixir.DockerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Docker

  @full_id "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc12345"

  @ps_line ~s({"ID":"#{@full_id}","Names":"betting-app","Image":"sail-8.5/app","State":"running","Status":"Up 38 minutes","Ports":"0.0.0.0:80->80/tcp","CreatedAt":"2026-07-17 23:00:00 -0300 -03","Labels":"com.docker.compose.project=backend,com.docker.compose.project.working_dir=/home/user/backend,desktop.docker.io/x=y"})

  @stats_line ~s({"ID":"#{@full_id}","Container":"abc123abc123","Name":"betting-app","CPUPerc":"0.57%","MemUsage":"512MiB / 45.94GiB"})

  setup do
    on_exit(fn -> Application.delete_env(:symphony_elixir, :docker_runner) end)
  end

  defp put_runner(fun), do: Application.put_env(:symphony_elixir, :docker_runner, fun)

  test "list_containers merges ps and stats and extracts compose labels" do
    put_runner(fn
      ["ps" | _rest] -> {@ps_line <> "\n", 0}
      ["stats" | _rest] -> {@stats_line <> "\n", 0}
    end)

    assert {:ok, [container]} = Docker.list_containers()
    assert container.id == @full_id
    assert container.name == "betting-app"
    assert container.image == "sail-8.5/app"
    assert container.state == "running"
    assert container.status == "Up 38 minutes"
    assert container.ports == "0.0.0.0:80->80/tcp"
    assert container.compose_project == "backend"
    assert container.compose_working_dir == "/home/user/backend"
    assert container.cpu_percent == "0.57%"
    assert container.memory_usage == "512MiB / 45.94GiB"
  end

  test "container without stats row keeps nil cpu and memory" do
    put_runner(fn
      ["ps" | _rest] -> {@ps_line <> "\n", 0}
      ["stats" | _rest] -> {"", 0}
    end)

    assert {:ok, [container]} = Docker.list_containers()
    assert container.cpu_percent == nil
    assert container.memory_usage == nil
  end

  test "malformed json lines and empty labels are tolerated" do
    ps =
      ~s({"ID":"#{@full_id}","Names":"a","Image":"b","State":"exited","Status":"Exited (0\)","Ports":"","CreatedAt":"","Labels":""})

    put_runner(fn
      ["ps" | _rest] -> {"not-json\n" <> ps <> "\n", 0}
      ["stats" | _rest] -> {"also-not-json\n", 0}
    end)

    assert {:ok, [container]} = Docker.list_containers()
    assert container.compose_project == nil
    assert container.compose_working_dir == nil
  end

  test "list_containers returns error when the daemon is unreachable" do
    put_runner(fn _args -> {"Cannot connect to the Docker daemon\n", 1} end)

    assert {:error, "Cannot connect to the Docker daemon"} = Docker.list_containers()
  end

  test "container_action rejects a non-hex container id" do
    assert {:error, :invalid_container_id} = Docker.container_action("betting-app", "stop")
    assert {:error, :invalid_container_id} = Docker.container_action("abc; rm -rf /", "stop")
  end

  test "container_action rejects an unknown action" do
    assert {:error, :invalid_action} = Docker.container_action(@full_id, "kill")
  end

  test "container_action runs the expected docker arguments" do
    parent = self()

    put_runner(fn args ->
      send(parent, {:docker_args, args})
      {"", 0}
    end)

    assert :ok = Docker.container_action(@full_id, "restart")
    assert_received {:docker_args, ["restart", @full_id]}

    assert :ok = Docker.container_action(@full_id, "remove", force: true)
    assert_received {:docker_args, ["rm", "--force", @full_id]}
  end

  test "container_action returns trimmed CLI output on failure" do
    put_runner(fn _args -> {"Error response from daemon: boom\n", 1} end)

    assert {:error, "Error response from daemon: boom"} = Docker.container_action(@full_id, "stop")
  end
end
