defmodule SymphonyElixir.DevServer.ManagerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.DevServer.Manager
  alias SymphonyElixir.LocalTracker.{Context, DevEnv, DevServerRecord}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.TestSupport
  alias SymphonyElixir.Workflow

  @workflow_statuses [
    %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}
  ]

  setup do
    workflow_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-manager-workflow-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(workflow_root)
    workflow_file = Path.join(workflow_root, "WORKFLOW.md")
    TestSupport.write_workflow_file!(workflow_file)
    Workflow.set_workflow_file_path(workflow_file)

    clear_reservation_table()
    migrate_repo()
    clean_repo()

    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "P",
        "slug" => "p",
        "workflow_statuses" => @workflow_statuses,
        "repositories" => [],
        "setup" => %{}
      })

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :workflow_file_path)
      File.rm_rf(workflow_root)
    end)

    {:ok, project: project}
  end

  test "live_ports uses the reservation table created by Manager startup" do
    ensure_manager_started!()

    assert :ets.whereis(reservation_table()) != :undefined
    assert Manager.live_ports() == []
  end

  test "start_for_issue returns disabled when dev server config is off", %{project: project} do
    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Front", command: "npm run dev", role: "serve", working_dir: "front"}
      ])

    assert Manager.start_for_issue(project.slug, "#1") == {:error, :disabled}
  end

  test "start_for_issue reads dev server enablement from project setup", %{project: project} do
    enable_project_dev_server!(project, port_range: [4100, 4101], max_concurrent: 1)

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Front", command: "npm run dev", role: "serve", working_dir: "front"}
      ])

    assert Manager.start_for_issue(project.slug, "#missing-workspace") == {:error, :workspace_missing}
  end

  test "list_for_issue ensures stopped placeholders for configured serve steps", %{project: project} do
    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Back", command: "docker compose up", role: "serve", working_dir: "backend"},
        %{description: "Front", command: "npm run dev", role: "serve", working_dir: "frontend", primary: true}
      ])

    assert DevServerRecord.list_for_issue(project.id, "1") == []

    servers = Manager.list_for_issue(project.slug, "#1")

    assert length(servers) == 2
    assert length(DevServerRecord.list_for_issue(project.id, "1")) == 2

    assert %{slug: "frontend", status: "stopped", primary: true} =
             Enum.find(servers, &(&1.slug == "frontend"))

    assert %{slug: "backend", status: "stopped", primary: false} =
             Enum.find(servers, &(&1.slug == "backend"))
  end

  test "list_for_issue returns persisted record maps ordered primary first", %{project: project} do
    {:ok, primary} =
      DevServerRecord.upsert(project.id, "1", "front", %{
        working_dir: "front",
        port: 4101,
        url: "http://127.0.0.1:4101/",
        status: "stopped",
        primary: true,
        session_name: "sym-dev-front"
      })

    {:ok, secondary} =
      DevServerRecord.upsert(project.id, "1", "api", %{
        working_dir: "api",
        port: 4102,
        url: "http://127.0.0.1:4102/",
        status: "stopped",
        primary: false,
        session_name: "sym-dev-api"
      })

    assert [
             %{
               id: primary_id,
               slug: "front",
               working_dir: "front",
               port: 4101,
               url: "http://127.0.0.1:4101/",
               status: "stopped",
               primary: true,
               session_name: "sym-dev-front"
             },
             %{
               id: secondary_id,
               slug: "api",
               working_dir: "api",
               port: 4102,
               url: "http://127.0.0.1:4102/",
               status: "stopped",
               primary: false,
               session_name: "sym-dev-api"
             }
           ] = Manager.list_for_issue(project.slug, "#1")

    assert primary_id == primary.id
    assert secondary_id == secondary.id
  end

  test "list_for_issue promotes stopped servers back to ready when the port is healthy", %{project: project} do
    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "Back",
          command: "docker compose up",
          role: "serve",
          working_dir: "backend",
          ready_probe: "http",
          ready_path: "/health"
        }
      ])

    {:ok, record} =
      DevServerRecord.upsert(project.id, "1878", "backend", %{
        working_dir: "backend",
        port: 4100,
        url: "http://127.0.0.1:4100/graphiql",
        status: "stopped",
        primary: false,
        session_name: "sym-dev-backend"
      })

    case Manager.list_for_issue(project.slug, "1878") do
      [%{id: id, status: "ready"}] ->
        assert id == record.id
        assert %DevServerRecord{status: "ready"} = DevServerRecord.get_for_issue(project.id, "1878", record.id)

      [%{id: id, status: "stopped"}] ->
        assert id == record.id
    end
  end

  test "list_for_issue marks stale ready servers as crashed when the port is down", %{project: project} do
    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "Front",
          command: "npm run dev",
          role: "serve",
          working_dir: "front",
          ready_probe: "http",
          ready_path: "/"
        }
      ])

    {:ok, record} =
      DevServerRecord.upsert(project.id, "1878", "front", %{
        working_dir: "front",
        port: 41_099,
        url: "http://127.0.0.1:41099/",
        status: "ready",
        primary: true,
        session_name: "sym-dev-front"
      })

    assert [%{id: id, status: "crashed"}] = Manager.list_for_issue(project.slug, "1878")
    assert id == record.id
    assert %DevServerRecord{status: "crashed"} = DevServerRecord.get_for_issue(project.id, "1878", record.id)
  end

  test "list_for_issue canonicalizes identifiers", %{project: project} do
    {:ok, row} =
      DevServerRecord.upsert(project.id, "1", "front", %{
        working_dir: "front",
        port: 4101,
        url: "http://127.0.0.1:4101/",
        status: "stopped",
        primary: true,
        session_name: "sym-dev-front"
      })

    assert [%{id: row_id, slug: "front"}] = Manager.list_for_issue(project.slug, "#1")
    assert Manager.list_for_issue(project.slug, "#1") == Manager.list_for_issue(project.slug, "1")
    assert row_id == row.id
  end

  test "instance child specs are temporary so manual stops do not restart" do
    child_spec = Manager.instance_child_spec({:project, "1", "front"}, [])

    assert %{
             id: {SymphonyElixir.DevServer.Instance, {:project, "1", "front"}},
             start: {SymphonyElixir.DevServer.Instance, :start_link, [[]]},
             restart: :temporary,
             type: :worker
           } = child_spec
  end

  test "setup command skips working directories outside the workspace" do
    workspace = Path.join(System.tmp_dir!(), "symphony-manager-workspace-#{System.unique_integer([:positive])}")
    outside = Path.join(System.tmp_dir!(), "symphony-manager-outside-#{System.unique_integer([:positive])}")

    File.mkdir_p!(Path.join(workspace, "app"))
    File.mkdir_p!(outside)

    on_exit(fn ->
      File.rm_rf(workspace)
      File.rm_rf(outside)
    end)

    assert "cd #{shell_quote(Path.join(workspace, "app"))} && npm ci\n" ==
             Manager.setup_command_for_workspace(workspace, %{
               command: "npm ci",
               working_dir: "app"
             })

    assert is_nil(
             Manager.setup_command_for_workspace(workspace, %{
               command: "npm ci",
               working_dir: "../#{Path.basename(outside)}"
             })
           )
  end

  test "setup command skips symlinked working directories that escape the workspace" do
    workspace = Path.join(System.tmp_dir!(), "symphony-manager-workspace-#{System.unique_integer([:positive])}")
    outside = Path.join(System.tmp_dir!(), "symphony-manager-outside-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workspace)
    File.mkdir_p!(outside)

    on_exit(fn ->
      File.rm_rf(workspace)
      File.rm_rf(outside)
    end)

    case File.ln_s(outside, Path.join(workspace, "linked-outside")) do
      :ok ->
        assert is_nil(
                 Manager.setup_command_for_workspace(workspace, %{
                   command: "npm ci",
                   working_dir: "linked-outside"
                 })
               )

      {:error, reason} ->
        assert reason in [:eacces, :eperm, :enotsup]
    end
  end

  test "unique_serve_steps avoids tmux session name collisions after sanitization" do
    steps =
      Manager.unique_serve_steps("p", "1", [
        %{command: "npm run dev", working_dir: "apps/web", primary: true},
        %{command: "npm run dev", working_dir: "apps_web", primary: false}
      ])

    session_names =
      Enum.map(steps, fn step ->
        SymphonyElixir.Terminal.Registry.dev_session_name("p", "1", step.slug)
      end)

    assert Enum.map(steps, & &1.slug) == ["apps/web", "apps_web-2"]
    assert Enum.uniq(session_names) == session_names
  end

  test "reserved ports are visible before an instance reports its boot state" do
    key = {"p", "1", "front"}

    ensure_manager_started!()
    Manager.reserve_port_for_key(key, 4100)
    on_exit(fn -> Manager.release_reservations([key]) end)

    assert 4100 in Manager.live_ports()
  end

  test "start_for_issue releases all reserved ports when the first instance crashes", %{project: project} do
    enable_project_dev_server!(project, port_range: [4100, 4101], max_concurrent: 2)

    workspace = SymphonyElixir.Workspace.path_for_issue("1")
    File.rm_rf!(workspace)
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf(workspace) end)

    ensure_manager_started!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "Broken",
          command: "npm run dev",
          role: "serve",
          working_dir: "missing"
        },
        %{
          description: "Unstarted",
          command: "npm run dev",
          role: "serve",
          working_dir: "."
        }
      ])

    assert Manager.start_for_issue(project.slug, "#1") == {:error, :crashed}
    assert Manager.live_ports() == []
  end

  test "start_for_issue does not block on max concurrent capacity", %{project: project} do
    enable_project_dev_server!(project, port_range: [4100, 4101], max_concurrent: 1)

    workspace = SymphonyElixir.Workspace.path_for_issue("1")
    File.rm_rf!(workspace)
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf(workspace) end)

    ensure_manager_started!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "Broken front",
          command: "npm run dev",
          role: "serve",
          working_dir: "missing-front"
        },
        %{
          description: "Broken api",
          command: "mix phx.server",
          role: "serve",
          working_dir: "missing-api"
        }
      ])

    assert Manager.start_for_issue(project.slug, "#1") == {:error, :crashed}
    assert Manager.live_ports() == []
  end

  test "auto-mode start leases a band and a per-issue slot", %{project: project} do
    alias SymphonyElixir.DevServer.LeaseStore

    enable_project_dev_server_auto!(project)
    prepare_workspace!("1")
    ensure_manager_started!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Broken", command: "npm run dev", role: "serve", working_dir: "missing"}
      ])

    assert Manager.start_for_issue(project.slug, "#1") == {:error, :crashed}
    assert {:ok, 0} = LeaseStore.ensure_band(project.id, 78)
    assert {:ok, 0} = LeaseStore.slot_for_issue(project.id, "1")
    assert Manager.live_ports() == []
  end

  test "auto-mode gives distinct slots to distinct issues", %{project: project} do
    alias SymphonyElixir.DevServer.LeaseStore

    enable_project_dev_server_auto!(project)
    prepare_workspace!("1")
    prepare_workspace!("2")
    ensure_manager_started!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Broken", command: "npm run dev", role: "serve", working_dir: "missing"}
      ])

    assert Manager.start_for_issue(project.slug, "#1") == {:error, :crashed}
    assert Manager.start_for_issue(project.slug, "#2") == {:error, :crashed}

    assert {:ok, 0} = LeaseStore.slot_for_issue(project.id, "1")
    assert {:ok, 1} = LeaseStore.slot_for_issue(project.id, "2")
  end

  test "pinned port_range still leases a slot inside the pinned band", %{project: project} do
    alias SymphonyElixir.DevServer.LeaseStore

    enable_project_dev_server!(project, port_range: [4100, 4199], max_concurrent: 2)
    prepare_workspace!("1")
    ensure_manager_started!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Broken", command: "npm run dev", role: "serve", working_dir: "missing"}
      ])

    assert Manager.start_for_issue(project.slug, "#1") == {:error, :crashed}
    assert [] = SymphonyElixir.Repo.all(SymphonyElixir.LocalTracker.PreviewBand)
    assert {:ok, 0} = LeaseStore.slot_for_issue(project.id, "1")
  end

  test "stop_instance_for_server returns not_found for an unknown server id", %{project: project} do
    assert Manager.stop_instance_for_server(project.slug, "#1", 999) == {:error, :not_found}
  end

  test "start_instance_for_server returns not_found for an unknown server id", %{project: project} do
    assert Manager.start_instance_for_server(project.slug, "#1", 999) == {:error, :not_found}
  end

  test "restart_instance_for_server returns not_found for an unknown server id", %{project: project} do
    assert Manager.restart_instance_for_server(project.slug, "#1", 999) == {:error, :not_found}
  end

  test "stop_instance_for_server stops a persisted server by id", %{project: project} do
    {:ok, record} =
      DevServerRecord.upsert(project.id, "1", "front", %{
        working_dir: "front",
        port: 4101,
        url: "http://127.0.0.1:4101/",
        status: "ready",
        primary: true,
        session_name: "sym-dev-front"
      })

    ensure_manager_started!()

    assert :ok = Manager.stop_instance_for_server(project.slug, "#1", record.id)
  end

  test "normalizes aborted global lock results" do
    assert Manager.normalize_lock_result(:aborted) == {:error, :lock_unavailable}
    assert Manager.normalize_lock_result({:ok, []}) == {:ok, []}
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end

  defp shell_quote(value) do
    "'" <> String.replace(value, "'", "'\"'\"'") <> "'"
  end

  defp reservation_table do
    Module.concat(Manager, PortReservations)
  end

  defp ensure_manager_started! do
    case Process.whereis(Manager) do
      nil -> start_supervised!(Manager)
      pid when is_pid(pid) -> pid
    end
  end

  defp clear_reservation_table do
    case :ets.whereis(reservation_table()) do
      :undefined -> :ok
      table -> :ets.delete_all_objects(table)
    end
  rescue
    ArgumentError -> :ok
  end

  test "serve_step_with_setup chains matching setup commands in the dev-server session", %{project: project} do
    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Install", command: "npm ci", role: "setup", working_dir: "front"},
        %{description: "API deps", command: "composer install", role: "setup", working_dir: "back"},
        %{description: "Front", command: "npm run dev", role: "serve", working_dir: "front"},
        %{description: "Back", command: "docker compose up", role: "serve", working_dir: "back"}
      ])

    assert Manager.serve_step_with_setup(project.slug, %{command: "npm run dev", working_dir: "front"})[:command] ==
             ~s(bash -lc 'export PATH="$PWD/node_modules/.bin:$PATH" && npm ci && npm run dev')

    assert Manager.serve_step_with_setup(project.slug, %{command: "docker compose up", working_dir: "back"})[:command] ==
             ~s(bash -lc 'export PATH="$PWD/node_modules/.bin:$PATH" && composer install && docker compose up')

    assert Manager.serve_step_with_setup(project.slug, %{command: "echo ok", working_dir: "api"})[:command] == "echo ok"
  end

  defp enable_project_dev_server!(project, opts) do
    port_range = Keyword.fetch!(opts, :port_range)
    max_concurrent = Keyword.fetch!(opts, :max_concurrent)

    workflow_markdown =
      SymphonyElixir.Workflow.to_markdown(
        %{
          "dev_server" => %{
            "enabled" => true,
            "port_range" => port_range,
            "max_concurrent" => max_concurrent,
            "idle_timeout_ms" => 60_000
          }
        },
        ""
      )

    {:ok, _setup} =
      Context.upsert_project_setup(project.slug, %{"workflow_markdown" => workflow_markdown})

    :ok
  end

  defp enable_project_dev_server_auto!(project) do
    workflow_markdown =
      SymphonyElixir.Workflow.to_markdown(
        %{"dev_server" => %{"enabled" => true, "idle_timeout_ms" => 60_000}},
        ""
      )

    {:ok, _setup} =
      Context.upsert_project_setup(project.slug, %{"workflow_markdown" => workflow_markdown})

    :ok
  end

  defp prepare_workspace!(identifier) do
    workspace = SymphonyElixir.Workspace.path_for_issue(identifier)
    File.rm_rf!(workspace)
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf(workspace) end)
    workspace
  end
end
