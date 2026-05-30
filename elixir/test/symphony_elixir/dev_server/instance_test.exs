defmodule SymphonyElixir.DevServer.InstanceTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.DevServer.Instance
  alias SymphonyElixir.LocalTracker.{Context, DevServerRecord}
  alias SymphonyElixir.Repo

  @test_process __MODULE__.TestProcess
  @identifier "#1"

  defmodule FakeTmux do
    def open_dev_session(project_slug, identifier, slug, cwd, _opts \\ []) do
      send(test_pid(), {:opened_dev_session, project_slug, identifier, slug, cwd})
      {:ok, %{session_name: "sym-dev-x"}}
    end

    def kill_dev_session(project_slug, identifier, slug, _opts \\ []) do
      send(test_pid(), {:killed_dev_session, project_slug, identifier, slug})
      :ok
    end

    def send_keys(session_name, data) do
      send(test_pid(), {:sent_keys, session_name, data})
      :ok
    end

    defp test_pid do
      Process.whereis(SymphonyElixir.DevServer.InstanceTest.TestProcess)
    end
  end

  setup do
    migrate_repo()
    clean_repo()
    register_test_process!()

    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "P",
        "slug" => "p",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [],
        "setup" => %{}
      })

    {:ok, project: project}
  end

  test "ready transition persists URL, port, status, and primary flag", %{project: project} do
    {:ok, pid} =
      Instance.start_link(
        instance_opts(project,
          port_allocator: fn _range, _claimed -> {:ok, 4123} end,
          probe: fn "127.0.0.1", 4123, "tcp", "/" -> :ok end,
          probe_interval_ms: 5
        )
      )

    assert_eventually(fn -> Instance.status(pid) == :ready end)

    assert [row] = DevServerRecord.list_for_issue(project.id, @identifier)
    assert row.status == "ready"
    assert row.url == "http://127.0.0.1:4123/"
    assert row.port == 4123
    assert row.primary == true
    assert row.session_name == "sym-dev-x"
    assert row.working_dir == "front"
    assert %DateTime{} = row.started_at

    assert :ok = Instance.stop(pid)
  end

  test "probe timeout marks instance crashed", %{project: project} do
    {:ok, pid} =
      Instance.start_link(
        instance_opts(project,
          port_allocator: fn _range, _claimed -> {:ok, 4123} end,
          probe: fn "127.0.0.1", 4123, "tcp", "/" -> {:error, :timeout} end,
          probe_interval_ms: 5,
          max_probe_attempts: 2
        )
      )

    assert_eventually(fn -> Instance.status(pid) == :crashed end)

    assert [row] = DevServerRecord.list_for_issue(project.id, @identifier)
    assert row.status == "crashed"

    assert :ok = Instance.stop(pid)
  end

  test "allocation failure marks instance crashed without launching tmux", %{project: project} do
    {:ok, pid} =
      Instance.start_link(
        instance_opts(project,
          port_allocator: fn _range, _claimed -> {:error, :no_free_port} end,
          probe_interval_ms: 5
        )
      )

    assert_eventually(fn -> Instance.status(pid) == :crashed end)

    assert [row] = DevServerRecord.list_for_issue(project.id, @identifier)
    assert row.status == "crashed"
    refute_received {:opened_dev_session, _, _, _, _}
    refute_received {:sent_keys, _, _}

    assert :ok = Instance.stop(pid)
  end

  test "stop persists stopped and kills the dev session", %{project: project} do
    {:ok, pid} =
      Instance.start_link(
        instance_opts(project,
          port_allocator: fn _range, _claimed -> {:ok, 4123} end,
          probe: fn "127.0.0.1", 4123, "tcp", "/" -> :ok end,
          probe_interval_ms: 5
        )
      )

    assert_eventually(fn -> Instance.status(pid) == :ready end)
    assert :ok = Instance.stop(pid)

    assert_receive {:killed_dev_session, "p", @identifier, "front"}, 1_000
    assert [row] = DevServerRecord.list_for_issue(project.id, @identifier)
    assert row.status == "stopped"
  end

  test "launch command contains allocated port env prefix", %{project: project} do
    {:ok, pid} =
      Instance.start_link(
        instance_opts(project,
          port_allocator: fn _range, _claimed -> {:ok, 4123} end,
          probe: fn "127.0.0.1", 4123, "tcp", "/" -> :ok end,
          probe_interval_ms: 5
        )
      )

    assert_receive {:sent_keys, "sym-dev-x", "PORT=4123 npm run dev\n"}, 1_000

    assert :ok = Instance.stop(pid)
  end

  defp instance_opts(project, overrides) do
    Keyword.merge(
      [
        project_id: project.id,
        project_slug: project.slug,
        identifier: @identifier,
        workspace_path: "/tmp/symphony-instance-test",
        step: step(),
        idle_timeout_ms: 60_000,
        tmux: FakeTmux
      ],
      overrides
    )
  end

  defp step do
    %{
      slug: "front",
      command: "npm run dev",
      working_dir: "front",
      port_env: "PORT",
      url_path: "/",
      ready_probe: "tcp",
      ready_path: "/",
      primary: true
    }
  end

  defp register_test_process! do
    case Process.whereis(@test_process) do
      nil -> :ok
      pid -> Process.unregister(@test_process) || Process.exit(pid, :kill)
    end

    true = Process.register(self(), @test_process)
    :ok
  end

  defp assert_eventually(fun, attempts \\ 20)

  defp assert_eventually(fun, attempts) when attempts > 0 do
    if fun.() do
      assert true
    else
      Process.sleep(25)
      assert_eventually(fun, attempts - 1)
    end
  end

  defp assert_eventually(_fun, 0), do: flunk("condition not met in time")

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_dev_servers",
          "local_tracker_dev_env_step_runs",
          "local_tracker_dev_env_runs",
          "local_tracker_dev_env_steps",
          "local_tracker_repositories",
          "local_tracker_workflow_statuses",
          "local_tracker_project_setups",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end
end
