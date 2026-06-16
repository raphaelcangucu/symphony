defmodule SymphonyElixir.DevServerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.DevServer
  alias SymphonyElixir.LocalTracker.{Context, DevEnv, DevServerRecord}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.TestSupport
  alias SymphonyElixir.Workflow
  alias SymphonyElixir.Workspace

  @workflow_statuses [
    %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}
  ]

  setup do
    workflow_root = Path.join(System.tmp_dir!(), "symphony-dev-server-workflow-#{System.unique_integer([:positive])}")
    workspace_root = Path.join(System.tmp_dir!(), "symphony-dev-server-workspaces-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workflow_root)
    File.mkdir_p!(workspace_root)

    workflow_file = Path.join(workflow_root, "WORKFLOW.md")
    TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: workspace_root)
    Workflow.set_workflow_file_path(workflow_file)

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
      File.rm_rf(workspace_root)
    end)

    {:ok, project: project}
  end

  test "issue_targets returns disabled with persisted server views when dev server config is off", %{project: project} do
    {:ok, row} =
      DevServerRecord.upsert(project.id, "1", "front", %{
        working_dir: "front",
        port: 4101,
        url: "http://127.0.0.1:4101/",
        status: "ready",
        primary: true,
        session_name: "sym-dev-front"
      })

    assert {:ok,
            %{
              available: false,
              reason: :disabled,
              servers: [
                %{
                  id: row_id,
                  slug: "front",
                  working_dir: "front",
                  port: 4101,
                  url: "http://127.0.0.1:4101/",
                  status: "ready",
                  primary: true,
                  session_name: "sym-dev-front"
                }
              ]
            }} = DevServer.issue_targets(project.slug, "#1")

    assert row_id == row.id
  end

  test "issue_targets returns project_not_found for an unknown project" do
    assert DevServer.issue_targets("missing", "#1") == {:error, :project_not_found}
  end

  test "issue_targets returns workspace_missing when enabled and issue workspace does not exist", %{project: project} do
    enable_dev_server!(project)
    File.rm_rf!(Workspace.path_for_issue(%{identifier: "1", project_slug: project.slug}))

    assert {:ok, %{available: false, reason: :workspace_missing, servers: []}} =
             DevServer.issue_targets(project.slug, "#1")
  end

  test "issue_targets returns no_serve_step when enabled workspace exists without serve steps", %{project: project} do
    enable_dev_server!(project)
    create_issue_workspace!(project.slug, "1")

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Install", command: "npm ci", role: "setup"}
      ])

    assert {:ok, %{available: false, reason: :no_serve_step, servers: []}} =
             DevServer.issue_targets(project.slug, "#1")
  end

  test "issue_targets is available from per-project dev_server config when global dev_server is off", %{project: project} do
    enable_project_dev_server!(project)
    create_issue_workspace!(project.slug, "1")

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Front", command: "npm run dev", role: "serve", working_dir: "front"}
      ])

    assert {:ok, %{available: true, reason: nil, servers: [%{slug: "front", status: "stopped"}]}} =
             DevServer.issue_targets(project.slug, "#1")
  end

  test "issue_targets returns a stopped placeholder for each configured serve step", %{project: project} do
    enable_dev_server!(project)
    create_issue_workspace!(project.slug, "1")

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Back", command: "docker compose up", role: "serve", working_dir: "backend"},
        %{description: "Go", command: "go run .", role: "serve", working_dir: "goapi"},
        %{description: "Front", command: "npm run dev", role: "serve", working_dir: "frontend", primary: true}
      ])

    assert {:ok, %{available: true, reason: nil, servers: servers}} =
             DevServer.issue_targets(project.slug, "#1")

    assert length(servers) == 3

    assert %{slug: "backend", working_dir: "backend", status: "stopped", primary: false} =
             Enum.find(servers, &(&1.slug == "backend"))

    assert %{slug: "goapi", working_dir: "goapi", status: "stopped", primary: false} =
             Enum.find(servers, &(&1.slug == "goapi"))

    assert %{slug: "frontend", working_dir: "frontend", status: "stopped", primary: true} =
             Enum.find(servers, &(&1.slug == "frontend"))
  end

  test "issue_targets is available when enabled workspace exists and serve steps are configured", %{project: project} do
    enable_dev_server!(project)
    create_issue_workspace!(project.slug, "1")

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Front", command: "npm run dev", role: "serve", working_dir: "front"}
      ])

    assert {:ok, %{available: true, reason: nil, servers: [%{slug: "front", status: "stopped"}]}} =
             DevServer.issue_targets(project.slug, "#1")
  end

  test "issue_targets self-heals a stale 'stopped' record when the instance is live and serving",
       %{project: project} do
    enable_dev_server!(project)
    create_issue_workspace!(project.slug, "1")

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Front", command: "npm run dev", role: "serve", working_dir: "front"}
      ])

    {:ok, listen} = :gen_tcp.listen(0, [:binary, active: false, reuseaddr: true, ip: {127, 0, 0, 1}])
    {:ok, port} = :inet.port(listen)

    {:ok, _row} =
      DevServerRecord.upsert(project.id, "1", "front", %{
        working_dir: "front",
        port: port,
        url: "http://127.0.0.1:#{port}/",
        status: "stopped",
        primary: true,
        session_name: "sym-dev-front"
      })

    registry = Module.concat(SymphonyElixir.DevServer.Manager, Registry)
    fake = start_fake_instance!(registry, {project.slug, "1", "front"}, :ready)

    on_exit(fn ->
      if Process.alive?(fake), do: send(fake, :stop)
      :gen_tcp.close(listen)
    end)

    assert {:ok, %{servers: [%{slug: "front", status: "ready"}]}} =
             DevServer.issue_targets(project.slug, "#1")

    assert [%DevServerRecord{status: "ready"}] = DevServerRecord.list_for_issue(project.id, "1")
  end

  test "issue_targets keeps a live serving instance 'ready' even when its status call would time out",
       %{project: project} do
    enable_dev_server!(project)
    create_issue_workspace!(project.slug, "1")

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Front", command: "npm run dev", role: "serve", working_dir: "front"}
      ])

    {:ok, listen} = :gen_tcp.listen(0, [:binary, active: false, reuseaddr: true, ip: {127, 0, 0, 1}])
    {:ok, port} = :inet.port(listen)

    {:ok, _row} =
      DevServerRecord.upsert(project.id, "1", "front", %{
        working_dir: "front",
        port: port,
        url: "http://127.0.0.1:#{port}/",
        status: "stopped",
        primary: true,
        session_name: "sym-dev-front"
      })

    registry = Module.concat(SymphonyElixir.DevServer.Manager, Registry)
    # Alive but never answers :status. The listening port is the source of truth,
    # so reconcile must report "ready" without downgrading to "stopped".
    fake = start_fake_instance!(registry, {project.slug, "1", "front"}, :never_reply)

    on_exit(fn ->
      if Process.alive?(fake), do: send(fake, :stop)
      :gen_tcp.close(listen)
    end)

    assert {:ok, %{servers: [%{slug: "front", status: "ready"}]}} =
             DevServer.issue_targets(project.slug, "#1")
  end

  defp start_fake_instance!(registry, key, mode) do
    test_pid = self()

    pid =
      spawn_link(fn ->
        {:ok, _} = Registry.register(registry, key, nil)
        send(test_pid, {:registered, self()})
        fake_instance_loop(mode)
      end)

    receive do
      {:registered, ^pid} -> :ok
    after
      2_000 -> flunk("fake instance did not register")
    end

    pid
  end

  defp fake_instance_loop(mode) do
    receive do
      {:"$gen_call", from, :status} ->
        unless mode == :never_reply, do: GenServer.reply(from, mode)
        fake_instance_loop(mode)

      :stop ->
        :ok
    end
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

  defp enable_dev_server!(project) do
    enable_project_dev_server!(project)
  end

  defp enable_project_dev_server!(project) do
    workflow_markdown =
      Workflow.to_markdown(%{"dev_server" => %{"enabled" => true, "port_range" => [4100, 4199]}}, "")

    {:ok, _setup} =
      Context.upsert_project_setup(project.slug, %{"workflow_markdown" => workflow_markdown})

    :ok
  end

  defp create_issue_workspace!(project_slug, identifier) do
    %{identifier: identifier, project_slug: project_slug}
    |> SymphonyElixir.Workspace.path_for_issue()
    |> File.mkdir_p!()
  end
end
