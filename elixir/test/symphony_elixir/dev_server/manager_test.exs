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

  test "list_for_issue returns persisted record maps ordered primary first", %{project: project} do
    {:ok, primary} =
      DevServerRecord.upsert(project.id, "1", "front", %{
        working_dir: "front",
        port: 4101,
        url: "http://127.0.0.1:4101/",
        status: "ready",
        primary: true,
        session_name: "sym-dev-front"
      })

    {:ok, secondary} =
      DevServerRecord.upsert(project.id, "1", "api", %{
        working_dir: "api",
        port: 4102,
        url: "http://127.0.0.1:4102/",
        status: "starting",
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
               status: "ready",
               primary: true,
               session_name: "sym-dev-front"
             },
             %{
               id: secondary_id,
               slug: "api",
               working_dir: "api",
               port: 4102,
               url: "http://127.0.0.1:4102/",
               status: "starting",
               primary: false,
               session_name: "sym-dev-api"
             }
           ] = Manager.list_for_issue(project.slug, "#1")

    assert primary_id == primary.id
    assert secondary_id == secondary.id
  end

  test "list_for_issue canonicalizes identifiers", %{project: project} do
    {:ok, row} =
      DevServerRecord.upsert(project.id, "1", "front", %{
        working_dir: "front",
        port: 4101,
        url: "http://127.0.0.1:4101/",
        status: "ready",
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
end
