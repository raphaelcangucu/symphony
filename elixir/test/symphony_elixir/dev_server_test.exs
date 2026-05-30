defmodule SymphonyElixir.DevServerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.DevServer
  alias SymphonyElixir.LocalTracker.{Context, DevEnv, DevServerRecord}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.TestSupport
  alias SymphonyElixir.Workflow

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
    enable_dev_server!()
    File.rm_rf!(SymphonyElixir.Workspace.path_for_issue("1"))

    assert {:ok, %{available: false, reason: :workspace_missing, servers: []}} =
             DevServer.issue_targets(project.slug, "#1")
  end

  test "issue_targets returns no_serve_step when enabled workspace exists without serve steps", %{project: project} do
    enable_dev_server!()
    create_issue_workspace!("1")

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Install", command: "npm ci", role: "setup"}
      ])

    assert {:ok, %{available: false, reason: :no_serve_step, servers: []}} =
             DevServer.issue_targets(project.slug, "#1")
  end

  test "issue_targets is available when enabled workspace exists and serve steps are configured", %{project: project} do
    enable_dev_server!()
    create_issue_workspace!("1")

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Front", command: "npm run dev", role: "serve", working_dir: "front"}
      ])

    assert {:ok, %{available: true, reason: nil, servers: []}} =
             DevServer.issue_targets(project.slug, "#1")
  end

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

  defp enable_dev_server! do
    dev_server_yaml =
      [
        "",
        "dev_server:",
        "  enabled: true",
        "---",
        ""
      ]
      |> Enum.join("\n")

    updated =
      Workflow.workflow_file_path()
      |> File.read!()
      |> String.replace(~r/\n---\n/, dev_server_yaml, global: false)

    File.write!(Workflow.workflow_file_path(), updated)
    assert :ok = SymphonyElixir.WorkflowStore.force_reload()
  end

  defp create_issue_workspace!(identifier) do
    identifier
    |> SymphonyElixir.Workspace.path_for_issue()
    |> File.mkdir_p!()
  end
end
