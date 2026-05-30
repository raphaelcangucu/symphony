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

  test "start_for_issue returns disabled when dev server config is off", %{project: project} do
    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Front", command: "npm run dev", role: "serve", working_dir: "front"}
      ])

    assert Manager.start_for_issue(project.slug, "#1") == {:error, :disabled}
  end

  test "list_for_issue returns persisted record maps ordered primary first", %{project: project} do
    {:ok, primary} =
      DevServerRecord.upsert(project.id, "#1", "front", %{
        working_dir: "front",
        port: 4101,
        url: "http://127.0.0.1:4101/",
        status: "ready",
        primary: true,
        session_name: "sym-dev-front"
      })

    {:ok, secondary} =
      DevServerRecord.upsert(project.id, "#1", "api", %{
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
