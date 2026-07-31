defmodule SymphonyElixir.DevServer.ManagerTest.FakeTmux do
  @moduledoc false
  def open_dev_session(_project_slug, _identifier, _slug, _cwd, _opts \\ []),
    do: {:ok, %{session_name: "sym-dev-test"}}

  def kill_dev_session(_project_slug, _identifier, _slug, _opts \\ []), do: :ok

  def send_keys(_session_name, _data), do: :ok
end

defmodule SymphonyElixir.DevServer.ManagerTest.MissingPaneTmux do
  @moduledoc false
  def capture_pane(session_name), do: {:error, "can't find pane: #{session_name}"}
end

defmodule SymphonyElixir.DevServer.ManagerTest.BrokenTmux do
  @moduledoc false
  def capture_pane(_session_name), do: {:error, "tmux server exited unexpectedly"}
end

defmodule SymphonyElixir.DevServer.ManagerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.DevServer.{Instance, Manager, RuntimeContractStore}
  alias SymphonyElixir.DevServer.ManagerTest.{BrokenTmux, FakeTmux, MissingPaneTmux}
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

  test "list_for_workspace persists path-scoped placeholders without an issue identifier", %{project: project} do
    workspace_path =
      Path.join(
        System.tmp_dir!(),
        "symphony-manager-workspace-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(workspace_path)
    on_exit(fn -> File.rm_rf(workspace_path) end)

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Front", command: "npm run dev", role: "serve", working_dir: "front"}
      ])

    assert [%{slug: "front", status: "stopped"}] =
             Manager.list_for_workspace(project.slug, workspace_path)

    assert [%DevServerRecord{workspace_path: ^workspace_path, issue_identifier: nil}] =
             DevServerRecord.list_for_workspace(project.id, workspace_path)
  end

  test "start_for_workspace keeps failed launch state scoped to the workspace path", %{
    project: project
  } do
    workspace_path =
      Path.join(
        System.tmp_dir!(),
        "symphony-manager-start-workspace-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(workspace_path)
    on_exit(fn -> File.rm_rf(workspace_path) end)

    enable_project_dev_server!(
      project,
      port_range: [41_200, 41_201],
      max_concurrent: 1
    )

    ensure_manager_started!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "Missing",
          command: "npm run dev",
          role: "serve",
          working_dir: "missing"
        }
      ])

    assert Manager.start_for_workspace(project.slug, workspace_path) ==
             {:error, :crashed}

    assert [
             %DevServerRecord{
               workspace_path: ^workspace_path,
               issue_identifier: nil,
               status: "crashed"
             }
           ] = DevServerRecord.list_for_workspace(project.id, workspace_path)
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

  test "list_for_issue keeps stopped servers stopped when the port responds without a live instance", %{
    project: project
  } do
    port = start_probe_server!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "GoAPI",
          command: "bash .symphony/serve.sh",
          role: "serve",
          working_dir: "goapi",
          ready_probe: "http",
          ready_path: "/graphiql"
        }
      ])

    {:ok, record} =
      DevServerRecord.upsert(project.id, "1878", "goapi", %{
        working_dir: "goapi",
        port: port,
        url: "http://127.0.0.1:#{port}/graphiql",
        status: "stopped",
        primary: false,
        session_name: "sym-dev-gamba-1878-goapi"
      })

    assert [%{id: id, status: "stopped"}] = Manager.list_for_issue(project.slug, "1878")
    assert id == record.id
    assert %DevServerRecord{status: "stopped"} = DevServerRecord.get_for_issue(project.id, "1878", record.id)
  end

  test "list_for_issue adopts a stopped server as ready when an unexpired contract allows the responding port", %{
    project: project
  } do
    port = start_probe_server!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "GoAPI",
          command: "bash .symphony/serve.sh",
          role: "serve",
          working_dir: "goapi",
          ready_probe: "http",
          ready_path: "/graphiql"
        }
      ])

    {:ok, _contract} =
      RuntimeContractStore.put(project, %{
        issue_identifier: "1878",
        server_slug: "goapi",
        source: "managed",
        preferred_port: port,
        allowed_ports: [port],
        report_path: "/tmp/preview-report.json",
        port_env: "PORT"
      })

    {:ok, record} =
      DevServerRecord.upsert(project.id, "1878", "goapi", %{
        working_dir: "goapi",
        port: port,
        url: "http://127.0.0.1:#{port}/graphiql",
        status: "stopped",
        primary: false,
        session_name: "sym-dev-gamba-1878-goapi"
      })

    assert [%{id: id, status: "ready"}] = Manager.list_for_issue(project.slug, "1878")
    assert id == record.id
    assert %DevServerRecord{status: "ready"} = DevServerRecord.get_for_issue(project.id, "1878", record.id)
  end

  test "list_for_issue renews an expiring contract while the adopted port keeps serving", %{project: project} do
    port = start_probe_server!()
    soon = DateTime.add(DateTime.utc_now(), 3600, :second)

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "GoAPI",
          command: "bash .symphony/serve.sh",
          role: "serve",
          working_dir: "goapi",
          ready_probe: "http",
          ready_path: "/graphiql"
        }
      ])

    {:ok, contract} =
      RuntimeContractStore.put(project, %{
        issue_identifier: "1878",
        server_slug: "goapi",
        source: "managed",
        preferred_port: port,
        allowed_ports: [port],
        report_path: "/tmp/preview-report.json",
        port_env: "PORT",
        expires_at: soon
      })

    {:ok, _record} =
      DevServerRecord.upsert(project.id, "1878", "goapi", %{
        working_dir: "goapi",
        port: port,
        url: "http://127.0.0.1:#{port}/graphiql",
        status: "stopped",
        primary: false,
        session_name: "sym-dev-gamba-1878-goapi"
      })

    assert [%{status: "ready"}] = Manager.list_for_issue(project.slug, "1878")

    assert {:ok, renewed, _record} = RuntimeContractStore.get_active(project, "1878", "goapi")
    assert DateTime.compare(renewed.expires_at, soon) == :gt
    assert renewed.revision == contract.revision
  end

  test "list_for_issue does not adopt a stopped server when the contract is expired", %{project: project} do
    port = start_probe_server!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "GoAPI",
          command: "bash .symphony/serve.sh",
          role: "serve",
          working_dir: "goapi",
          ready_probe: "http",
          ready_path: "/graphiql"
        }
      ])

    {:ok, _contract} =
      RuntimeContractStore.put(project, %{
        issue_identifier: "1878",
        server_slug: "goapi",
        source: "managed",
        preferred_port: port,
        allowed_ports: [port],
        report_path: "/tmp/preview-report.json",
        port_env: "PORT",
        expires_at: DateTime.add(DateTime.utc_now(), -60, :second)
      })

    {:ok, record} =
      DevServerRecord.upsert(project.id, "1878", "goapi", %{
        working_dir: "goapi",
        port: port,
        url: "http://127.0.0.1:#{port}/graphiql",
        status: "stopped",
        primary: false,
        session_name: "sym-dev-gamba-1878-goapi"
      })

    assert [%{id: id, status: "stopped"}] = Manager.list_for_issue(project.slug, "1878")
    assert id == record.id
  end

  test "list_for_issue does not adopt a stopped server whose port is outside the contract", %{project: project} do
    port = start_probe_server!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "GoAPI",
          command: "bash .symphony/serve.sh",
          role: "serve",
          working_dir: "goapi",
          ready_probe: "http",
          ready_path: "/graphiql"
        }
      ])

    {:ok, _contract} =
      RuntimeContractStore.put(project, %{
        issue_identifier: "1878",
        server_slug: "goapi",
        source: "managed",
        preferred_port: port + 1,
        allowed_ports: [port + 1],
        report_path: "/tmp/preview-report.json",
        port_env: "PORT"
      })

    {:ok, record} =
      DevServerRecord.upsert(project.id, "1878", "goapi", %{
        working_dir: "goapi",
        port: port,
        url: "http://127.0.0.1:#{port}/graphiql",
        status: "stopped",
        primary: false,
        session_name: "sym-dev-gamba-1878-goapi"
      })

    assert [%{id: id, status: "stopped"}] = Manager.list_for_issue(project.slug, "1878")
    assert id == record.id
  end

  test "list_for_issue marks ready servers as crashed when no live instance owns the port", %{project: project} do
    port = start_probe_server!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "GoAPI",
          command: "bash .symphony/serve.sh",
          role: "serve",
          working_dir: "goapi",
          ready_probe: "http",
          ready_path: "/graphiql"
        }
      ])

    {:ok, record} =
      DevServerRecord.upsert(project.id, "1878", "goapi", %{
        working_dir: "goapi",
        port: port,
        url: "http://127.0.0.1:#{port}/graphiql",
        status: "ready",
        primary: false,
        session_name: "sym-dev-gamba-1878-goapi"
      })

    assert [%{id: id, status: "crashed"}] = Manager.list_for_issue(project.slug, "1878")
    assert id == record.id
    assert %DevServerRecord{status: "crashed"} = DevServerRecord.get_for_issue(project.id, "1878", record.id)
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

  test "list_for_issue rejects an out-of-lease preview-port and marks the ready server crashed", %{
    project: project
  } do
    # Simulates the split-brain report (e.g. serve republished on :59595):
    # a live host port that is NOT the leased port must never be blindly adopted.
    out_of_lease_port = start_probe_server!()
    workspace = prepare_workspace!("1131")
    File.mkdir_p!(Path.join([workspace, "advising", ".symphony"]))

    File.write!(
      Path.join([workspace, "advising", ".symphony", "preview-port"]),
      "#{out_of_lease_port}\n"
    )

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "Advising",
          command: "bash .symphony/serve.sh",
          role: "serve",
          working_dir: "advising",
          ready_probe: "http",
          ready_path: "/",
          url_path: "/"
        }
      ])

    {:ok, record} =
      DevServerRecord.upsert(project.id, "1131", "advising", %{
        working_dir: "advising",
        port: 41_097,
        url: "http://127.0.0.1:41097/",
        status: "ready",
        primary: true,
        session_name: "sym-dev-advising-1131-advising"
      })

    assert [%{id: id, status: "crashed", port: 41_097}] = Manager.list_for_issue(project.slug, "1131")
    assert id == record.id

    assert %DevServerRecord{status: "crashed", port: 41_097} =
             DevServerRecord.get_for_issue(project.id, "1131", record.id)
  end

  test "list_for_issue does not heal stopped servers from a preview-port file", %{project: project} do
    live_port = start_probe_server!()
    workspace = prepare_workspace!("1132")
    File.mkdir_p!(Path.join([workspace, "advising", ".symphony"]))
    File.write!(Path.join([workspace, "advising", ".symphony", "preview-port"]), "#{live_port}\n")

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "Advising",
          command: "bash .symphony/serve.sh",
          role: "serve",
          working_dir: "advising",
          ready_probe: "http",
          ready_path: "/"
        }
      ])

    {:ok, record} =
      DevServerRecord.upsert(project.id, "1132", "advising", %{
        working_dir: "advising",
        port: 41_096,
        url: "http://127.0.0.1:41096/",
        status: "stopped",
        primary: true,
        session_name: "sym-dev-advising-1132-advising"
      })

    assert [%{id: id, status: "stopped", port: 41_096}] = Manager.list_for_issue(project.slug, "1132")
    assert id == record.id
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

  describe "capture_server_output/3" do
    setup do
      previous = Application.get_env(:symphony_elixir, :terminal_tmux)

      on_exit(fn ->
        if previous,
          do: Application.put_env(:symphony_elixir, :terminal_tmux, previous),
          else: Application.delete_env(:symphony_elixir, :terminal_tmux)
      end)

      :ok
    end

    test "returns empty output when the tmux pane no longer exists", %{project: project} do
      {:ok, record} =
        DevServerRecord.upsert(project.id, "1878", "goapi", %{
          working_dir: "goapi",
          port: 6363,
          status: "ready",
          primary: false,
          session_name: "sym-dev-gamba-1878-goapi"
        })

      Application.put_env(:symphony_elixir, :terminal_tmux, MissingPaneTmux)

      assert {:ok, %{output: "", session_name: "sym-dev-gamba-1878-goapi"}} =
               Manager.capture_server_output(project.slug, "1878", record.id)
    end

    test "propagates unexpected tmux errors", %{project: project} do
      {:ok, record} =
        DevServerRecord.upsert(project.id, "1878", "goapi", %{
          working_dir: "goapi",
          port: 6363,
          status: "ready",
          primary: false,
          session_name: "sym-dev-gamba-1878-goapi"
        })

      Application.put_env(:symphony_elixir, :terminal_tmux, BrokenTmux)

      assert {:error, "tmux server exited unexpectedly"} =
               Manager.capture_server_output(project.slug, "1878", record.id)
    end
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

    command =
      Manager.setup_command_for_workspace(workspace, %{
        command: "npm ci",
        working_dir: "app"
      })

    assert command =~ "npm ci"
    assert command =~ "#{Path.basename(workspace)}/app"

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

  test "start_for_issue persists a managed runtime contract when the flag is on", %{project: project} do
    Application.put_env(:symphony_elixir, :preview_runtime_contract_v1, true)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :preview_runtime_contract_v1) end)

    enable_project_dev_server!(project, port_range: [4100, 4131], max_concurrent: 2)

    workspace = SymphonyElixir.Workspace.path_for_issue("1")
    File.rm_rf!(workspace)
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf(workspace) end)

    ensure_manager_started!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "Advising",
          command: "bash .symphony/serve.sh",
          role: "serve",
          working_dir: "missing",
          port_env: "INSPIRE_PORT",
          primary: true
        }
      ])

    # The instance crashes (missing working dir), but the contract is created and
    # persisted during reservation, before the launch is attempted.
    assert Manager.start_for_issue(project.slug, "#1") == {:error, :crashed}

    assert {:ok, contract, _record} =
             SymphonyElixir.DevServer.RuntimeContractStore.get_active(project, "1", "missing")

    assert contract.source == :managed
    assert contract.port_env == "INSPIRE_PORT"
    assert contract.preferred_port in 4100..4131
    assert contract.preferred_port in contract.allowed_ports
    assert String.ends_with?(contract.report_path, ".symphony/preview-report.json")
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

  test "stop_for_issue releases the issue slot lease", %{project: project} do
    alias SymphonyElixir.DevServer.LeaseStore

    enable_project_dev_server_auto!(project)
    prepare_workspace!("1")
    ensure_manager_started!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Broken", command: "npm run dev", role: "serve", working_dir: "missing"}
      ])

    assert Manager.start_for_issue(project.slug, "#1") == {:error, :crashed}
    assert {:ok, 0} = LeaseStore.slot_for_issue(project.id, "1")

    assert :ok = Manager.stop_for_issue(project.slug, "#1")
    assert :error = LeaseStore.slot_for_issue(project.id, "1")
  end

  test "running_issue_keys is empty with no live instances" do
    ensure_manager_started!()
    assert Manager.running_issue_keys() == MapSet.new()
  end

  test "stop_instance_for_server returns not_found for an unknown server id", %{project: project} do
    assert Manager.stop_instance_for_server(project.slug, "#1", 999) == {:error, :not_found}
  end

  test "start_instance_for_server restarts a crashed instance instead of no-op", %{project: project} do
    enable_project_dev_server!(project, port_range: [4100, 4199], max_concurrent: 2)
    identifier = "535-start-restart"
    workspace = prepare_workspace!(identifier)
    ensure_manager_started!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "Front",
          command: "npm run dev",
          role: "serve",
          working_dir: "front",
          primary: true
        }
      ])

    slug = "front"
    key = {project.slug, identifier, slug}

    {:ok, old_pid} =
      Instance.start_link(
        registry_name: {:via, Registry, {instance_registry(), key}},
        project_id: project.id,
        project_slug: project.slug,
        identifier: identifier,
        workspace_path: workspace,
        step: %{
          slug: slug,
          command: "npm run dev",
          working_dir: "front",
          port_env: "PORT",
          url_path: "/",
          ready_probe: "tcp",
          ready_path: "/",
          primary: true
        },
        idle_timeout_ms: 60_000,
        tmux: FakeTmux,
        command_sender: &FakeTmux.send_keys/2,
        port_allocator: fn _range, _claimed -> {:ok, 4101} end,
        probe: fn "127.0.0.1", 4101, "tcp", "/" -> {:error, :timeout} end,
        probe_interval_ms: 5,
        max_probe_attempts: 1
      )

    assert_eventually(fn -> Instance.status(old_pid) == :crashed end)
    File.mkdir_p!(Path.join(workspace, "front"))

    {:ok, record} =
      DevServerRecord.upsert(project.id, identifier, slug, %{
        working_dir: "front",
        port: 4101,
        url: "http://127.0.0.1:4101/",
        status: "crashed",
        primary: true,
        session_name: "sym-dev-test"
      })

    result = Manager.start_instance_for_server(project.slug, identifier, record.id, ready_timeout_ms: 0)
    refute match?({:ok, [^old_pid]}, result)

    new_pid =
      case Registry.lookup(instance_registry(), key) do
        [{pid, _}] -> pid
        [] -> nil
      end

    refute Process.alive?(old_pid)

    # A new process is expected when the configured command can be launched.
    # On machines without tmux the replacement fails fast as `:crashed`; both
    # outcomes prove the old crashed instance was not reused as a no-op.
    assert match?({:ok, [_]}, result) or result == {:error, :crashed}

    if is_pid(new_pid), do: refute(new_pid == old_pid)
  end

  test "start_for_issue/3 honors a short ready_timeout_ms instead of blocking on a starting instance", %{
    project: project
  } do
    enable_project_dev_server!(project, port_range: [4100, 4199], max_concurrent: 2)
    identifier = "771-bounded-start"
    workspace = prepare_workspace!(identifier)
    File.mkdir_p!(Path.join(workspace, "front"))
    ensure_manager_started!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Front", command: "npm run dev", role: "serve", working_dir: "front", primary: true}
      ])

    slug = "front"
    key = {project.slug, identifier, slug}

    {:ok, pid} =
      Instance.start_link(
        registry_name: {:via, Registry, {instance_registry(), key}},
        project_id: project.id,
        project_slug: project.slug,
        identifier: identifier,
        workspace_path: workspace,
        step: %{
          slug: slug,
          command: "npm run dev",
          working_dir: "front",
          port_env: "PORT",
          url_path: "/",
          ready_probe: "tcp",
          ready_path: "/",
          primary: true
        },
        idle_timeout_ms: 60_000,
        tmux: FakeTmux,
        command_sender: &FakeTmux.send_keys/2,
        port_allocator: fn _range, _claimed -> {:ok, 4101} end,
        # Never readies; the next probe is far enough out that the instance stays
        # `starting` for the whole test instead of crashing.
        probe: fn _host, _port, _probe, _path -> {:error, :timeout} end,
        probe_interval_ms: 60_000,
        max_probe_attempts: 1_000
      )

    # Detach from the test process so teardown order can't race the instance,
    # then stop it explicitly (the instance traps exits, so it would otherwise
    # outlive the test and leak its port into later tests).
    Process.unlink(pid)

    on_exit(fn ->
      if Process.alive?(pid) do
        try do
          Instance.stop(pid)
        catch
          :exit, _reason -> :ok
        end
      end
    end)

    # A 0ms ready budget must return immediately and reuse the already-running
    # (still starting) instance instead of waiting for readiness — proving the
    # bound is threaded all the way through start_for_issue.
    assert {:ok, [^pid]} = Manager.start_for_issue(project.slug, "##{identifier}", ready_timeout_ms: 0)
    assert Instance.status(pid) in [:provisioning, :starting]
  end

  test "start_instance_for_server returns not_found for an unknown server id", %{project: project} do
    assert Manager.start_instance_for_server(project.slug, "#1", 999) == {:error, :not_found}
  end

  test "restart_instance_for_server returns not_found for an unknown server id", %{project: project} do
    assert Manager.restart_instance_for_server(project.slug, "#1", 999) == {:error, :not_found}
  end

  test "start_instance_for_server resolves the serve step for a configured server (regression: unique_serve_steps arg order)",
       %{project: project} do
    enable_project_dev_server!(project, port_range: [4100, 4199], max_concurrent: 2)
    prepare_workspace!("1")
    ensure_manager_started!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Missing", command: "npm run dev", role: "serve", working_dir: "missing"}
      ])

    {:ok, record} =
      DevServerRecord.upsert(project.id, "1", "missing", %{
        working_dir: "missing",
        port: 4100,
        url: "http://127.0.0.1:4100/",
        status: "stopped",
        primary: true,
        session_name: "sym-dev-missing"
      })

    result = Manager.start_instance_for_server(project.slug, "#1", record.id)

    # Before the fix, serve_step_for_slug piped the step list into
    # unique_serve_steps/3 with swapped args, so the is_binary guards failed
    # and it always returned []. Every per-server Start/Restart control then
    # failed with {:error, :no_serve_step}. The serve step must resolve now;
    # the start only fails because the configured working dir does not exist.
    refute result == {:error, :no_serve_step}
    assert result == {:error, :crashed}
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

  defp instance_registry do
    Module.concat(Manager, Registry)
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

  defp start_probe_server! do
    {:ok, listen_socket} =
      :gen_tcp.listen(0, [:binary, active: false, reuseaddr: true, ip: {127, 0, 0, 1}])

    {:ok, port} = :inet.port(listen_socket)

    Task.start_link(fn ->
      probe_server_loop(listen_socket)
    end)

    on_exit(fn -> :gen_tcp.close(listen_socket) end)
    port
  end

  defp probe_server_loop(listen_socket) do
    case :gen_tcp.accept(listen_socket) do
      {:ok, client} ->
        _ = :gen_tcp.send(client, "HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok")
        :gen_tcp.close(client)
        probe_server_loop(listen_socket)

      {:error, _} ->
        :ok
    end
  end

  defp assert_eventually(fun, attempts \\ 40)

  defp assert_eventually(fun, attempts) when attempts > 0 do
    if fun.() do
      assert true
    else
      Process.sleep(25)
      assert_eventually(fun, attempts - 1)
    end
  end

  defp assert_eventually(_fun, 0), do: flunk("condition not met in time")
end
