defmodule SymphonyElixir.DevServer.InstanceTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.DevServer.Instance
  alias SymphonyElixir.LocalTracker.{Context, DevServerRecord}
  alias SymphonyElixir.Repo

  @test_process __MODULE__.TestProcess
  @identifier "#1"
  @workspace_path "/tmp/symphony-instance-test"

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

  defmodule KillFailTmux do
    def open_dev_session(project_slug, identifier, slug, cwd, _opts \\ []) do
      send(test_pid(), {:opened_dev_session, project_slug, identifier, slug, cwd})
      {:ok, %{session_name: "sym-dev-x"}}
    end

    def kill_dev_session(project_slug, identifier, slug, _opts \\ []) do
      send(test_pid(), {:kill_failed, project_slug, identifier, slug})
      {:error, :kill_failed}
    end

    defp test_pid do
      Process.whereis(SymphonyElixir.DevServer.InstanceTest.TestProcess)
    end
  end

  setup do
    migrate_repo()
    clean_repo()
    prepare_workspace!()
    register_test_process!()

    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "P",
        "slug" => "p",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [],
        "setup" => %{}
      })

    on_exit(fn -> File.rm_rf!(@workspace_path) end)

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
    assert_receive {:killed_dev_session, "p", @identifier, "front"}, 1_000

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
        workspace_path: @workspace_path,
        step: step(),
        idle_timeout_ms: 60_000,
        tmux: FakeTmux,
        command_sender: &FakeTmux.send_keys/2
      ],
      overrides
    )
  end

  test "send failure after session open kills session and persists crashed", %{project: project} do
    {:ok, pid} =
      Instance.start_link(
        instance_opts(project,
          port_allocator: fn _range, _claimed -> {:ok, 4123} end,
          command_sender: fn "sym-dev-x", "PORT=4123 npm run dev\n" -> {:error, :send_failed} end,
          probe_interval_ms: 5
        )
      )

    assert_eventually(fn -> Instance.status(pid) == :crashed end)

    assert_receive {:killed_dev_session, "p", @identifier, "front"}, 1_000
    assert [row] = DevServerRecord.list_for_issue(project.id, @identifier)
    assert row.status == "crashed"
  end

  test "kill failure on stop persists crashed instead of stopped", %{project: project} do
    {:ok, pid} =
      Instance.start_link(
        instance_opts(project,
          tmux: KillFailTmux,
          port_allocator: fn _range, _claimed -> {:ok, 4123} end,
          probe: fn "127.0.0.1", 4123, "tcp", "/" -> :ok end,
          probe_interval_ms: 5
        )
      )

    assert_eventually(fn -> Instance.status(pid) == :ready end)
    assert :ok = Instance.stop(pid)

    assert_receive {:kill_failed, "p", @identifier, "front"}, 1_000
    assert [row] = DevServerRecord.list_for_issue(project.id, @identifier)
    assert row.status == "crashed"
  end

  test "unsafe working dir persists crashed without opening tmux", %{project: project} do
    {:ok, pid} =
      Instance.start_link(
        instance_opts(project,
          step: %{step() | working_dir: "../outside"},
          port_allocator: fn _range, _claimed -> {:ok, 4123} end,
          probe_interval_ms: 5
        )
      )

    assert_eventually(fn -> Instance.status(pid) == :crashed end)

    assert [row] = DevServerRecord.list_for_issue(project.id, @identifier)
    assert row.status == "crashed"
    refute_received {:opened_dev_session, _, _, _, _}
  end

  test "symlinked working dir escaping workspace persists crashed without opening tmux", %{project: project} do
    outside = Path.join(System.tmp_dir!(), "symphony-instance-outside-#{System.unique_integer([:positive])}")
    File.mkdir_p!(outside)
    on_exit(fn -> File.rm_rf!(outside) end)

    link_path = Path.join(@workspace_path, "linked-outside")

    case File.ln_s(outside, link_path) do
      :ok ->
        {:ok, pid} =
          Instance.start_link(
            instance_opts(project,
              step: %{step() | working_dir: "linked-outside"},
              port_allocator: fn _range, _claimed -> {:ok, 4123} end,
              probe_interval_ms: 5
            )
          )

        assert_eventually(fn -> Instance.status(pid) == :crashed end)

        assert [row] = DevServerRecord.list_for_issue(project.id, @identifier)
        assert row.status == "crashed"
        refute_received {:opened_dev_session, _, _, _, _}

      {:error, reason} ->
        assert reason in [:eacces, :eperm, :enotsup]
    end
  end

  test "post-ready probe failures use max attempts threshold", %{project: project} do
    {:ok, probe_agent} = Agent.start_link(fn -> :ok end)

    {:ok, pid} =
      Instance.start_link(
        instance_opts(project,
          port_allocator: fn _range, _claimed -> {:ok, 4123} end,
          max_probe_attempts: 2,
          probe: fn "127.0.0.1", 4123, "tcp", "/" ->
            Agent.get(probe_agent, fn status ->
              if status == :ok, do: :ok, else: {:error, :closed}
            end)
          end,
          probe_interval_ms: 60_000
        )
      )

    assert_receive {:sent_keys, "sym-dev-x", "PORT=4123 npm run dev\n"}, 1_000
    send(pid, :probe)
    assert_eventually(fn -> Instance.status(pid) == :ready end)

    Agent.update(probe_agent, fn _status -> :fail end)
    send(pid, :probe)
    Process.sleep(25)
    assert Instance.status(pid) == :ready

    send(pid, :probe)
    assert_eventually(fn -> Instance.status(pid) == :crashed end)

    assert [row] = DevServerRecord.list_for_issue(project.id, @identifier)
    assert row.status == "crashed"
    assert_receive {:killed_dev_session, "p", @identifier, "front"}, 1_000

    assert :ok = Instance.stop(pid)
  end

  test "successful health confirmations reset idle timeout", %{project: project} do
    {:ok, pid} =
      Instance.start_link(
        instance_opts(project,
          port_allocator: fn _range, _claimed -> {:ok, 4123} end,
          idle_timeout_ms: 80,
          probe: fn "127.0.0.1", 4123, "tcp", "/" -> :ok end,
          probe_interval_ms: 60_000
        )
      )

    assert_receive {:sent_keys, "sym-dev-x", "PORT=4123 npm run dev\n"}, 1_000
    send(pid, :probe)
    assert_eventually(fn -> Instance.status(pid) == :ready end)

    Process.sleep(50)
    send(pid, :probe)
    Process.sleep(50)

    assert Process.alive?(pid)
    assert Instance.status(pid) == :ready

    assert :ok = Instance.stop(pid)
  end

  test "shutdown termination persists stopped when cleanup succeeds", %{project: project} do
    previous_trap_exit = Process.flag(:trap_exit, true)
    on_exit(fn -> Process.flag(:trap_exit, previous_trap_exit) end)

    {:ok, pid} =
      Instance.start_link(
        instance_opts(project,
          port_allocator: fn _range, _claimed -> {:ok, 4123} end,
          probe: fn "127.0.0.1", 4123, "tcp", "/" -> :ok end,
          probe_interval_ms: 5
        )
      )

    assert_eventually(fn -> Instance.status(pid) == :ready end)
    :ok = GenServer.stop(pid, :shutdown)

    assert_receive {:EXIT, ^pid, :shutdown}, 1_000
    assert_receive {:killed_dev_session, "p", @identifier, "front"}, 1_000
    assert [row] = DevServerRecord.list_for_issue(project.id, @identifier)
    assert row.status == "stopped"
  end

  test "registers public host on ready and unregisters on stop", %{project: project} do
    enable_public_tunnel!(namespace: "octocat", base_domain: "tracker.cods.dev")
    ensure_public_routing_started!()

    pid = start_ready_instance!(project, port: 4123, project_slug: "previsions", identifier: "mm-42", step_slug: "front")

    host = "previsions-mm-42-front.octocat.tracker.cods.dev"
    assert {:ok, 4123} = SymphonyElixir.PublicRouting.lookup(host)

    assert [row] = DevServerRecord.list_for_issue(project.id, "mm-42")
    assert row.url == "https://previsions-mm-42-front.octocat.tracker.cods.dev/"

    :ok = SymphonyElixir.DevServer.Instance.stop(pid)
    assert_eventually(fn -> SymphonyElixir.PublicRouting.lookup(host) == :error end)
  end

  test "ready transition uses configured base_url when set", %{project: project} do
    {:ok, pid} =
      Instance.start_link(
        instance_opts(project,
          base_url: "http://example.test/",
          port_allocator: fn _range, _claimed -> {:ok, 4123} end,
          probe: fn "127.0.0.1", 4123, "tcp", "/" -> :ok end,
          probe_interval_ms: 5
        )
      )

    assert_eventually(fn -> Instance.status(pid) == :ready end)

    assert [row] = DevServerRecord.list_for_issue(project.id, @identifier)
    assert row.url == "http://example.test/"

    assert :ok = Instance.stop(pid)
  end

  defp enable_public_tunnel!(opts) do
    namespace = Keyword.fetch!(opts, :namespace)
    base_domain = Keyword.fetch!(opts, :base_domain)

    front_matter =
      "github:\n  repo: acme/app\npublic_tunnel:\n  enabled: true\n" <>
        "  base_domain: #{base_domain}\n  namespace: #{namespace}\n"

    content = "---\n" <> front_matter <> "---\n"

    workflow_root =
      Path.join(System.tmp_dir!(), "symphony-instance-tunnel-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workflow_root)
    workflow_file = Path.join(workflow_root, "WORKFLOW.md")
    File.write!(workflow_file, content)

    previous_path = Application.get_env(:symphony_elixir, :workflow_file_path)
    SymphonyElixir.Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      if previous_path do
        SymphonyElixir.Workflow.set_workflow_file_path(previous_path)
      else
        SymphonyElixir.Workflow.clear_workflow_file_path()
      end

      File.rm_rf!(workflow_root)
    end)

    :ok
  end

  defp ensure_public_routing_started! do
    case Process.whereis(SymphonyElixir.PublicRouting) do
      nil -> start_supervised!(SymphonyElixir.PublicRouting)
      _ -> :ok
    end
  end

  defp start_ready_instance!(project, opts) do
    port = Keyword.fetch!(opts, :port)
    step = %{step() | slug: Keyword.fetch!(opts, :step_slug)}

    {:ok, pid} =
      Instance.start_link(
        instance_opts(project,
          project_slug: Keyword.fetch!(opts, :project_slug),
          identifier: Keyword.fetch!(opts, :identifier),
          step: step,
          port_allocator: fn _range, _claimed -> {:ok, port} end,
          probe: fn "127.0.0.1", ^port, "tcp", "/" -> :ok end,
          probe_interval_ms: 5
        )
      )

    assert_eventually(fn -> Instance.status(pid) == :ready end)
    pid
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

  defp prepare_workspace! do
    File.rm_rf!(@workspace_path)
    File.mkdir_p!(Path.join(@workspace_path, "front"))
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
