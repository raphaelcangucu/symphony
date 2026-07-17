defmodule SymphonyElixir.DevServer.PreviewRunnerManagerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.DevServer.Manager
  alias SymphonyElixir.LocalTracker.{Context, DevEnv}
  alias SymphonyElixir.TestSupport
  alias SymphonyElixir.Workflow
  alias SymphonyElixir.Workspace

  @workflow_statuses [
    %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}
  ]

  setup do
    workflow_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-preview-runner-manager-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(workflow_root)
    workflow_file = Path.join(workflow_root, "WORKFLOW.md")
    TestSupport.write_workflow_file!(workflow_file)
    Workflow.set_workflow_file_path(workflow_file)

    TestSupport.truncate_tracker!()
    clear_reservation_table()

    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "Preview Runner",
        "slug" => "preview-runner",
        "workflow_statuses" => @workflow_statuses,
        "repositories" => [],
        "setup" => %{}
      })

    enable_project_dev_server!(project)

    previous_contract_flag =
      Application.get_env(:symphony_elixir, :preview_runtime_contract_v1)

    Application.put_env(:symphony_elixir, :preview_runtime_contract_v1, true)

    identifier = "runner-manager-#{System.unique_integer([:positive])}"
    workspace_path = Workspace.path_for_issue(identifier)
    File.rm_rf!(workspace_path)
    File.mkdir_p!(workspace_path)

    ensure_manager_started!()

    on_exit(fn ->
      Manager.stop_for_issue(project.slug, identifier)
      restore_application_env(:preview_runtime_contract_v1, previous_contract_flag)
      Application.delete_env(:symphony_elixir, :workflow_file_path)
      File.rm_rf(workspace_path)
      File.rm_rf(workflow_root)
    end)

    {:ok, project: project, identifier: identifier, workspace_path: workspace_path}
  end

  test "prepare_for_issue builds a preview runner launch from run_spec", %{
    project: project,
    identifier: identifier,
    workspace_path: workspace_path
  } do
    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "Python preview",
          command: "symphony-preview-runner",
          stop_command: "legacy-stop",
          role: "serve",
          working_dir: ".",
          port_env: "INSPIRE_PORT",
          run_spec: %{
            "start" => [["python3", "-m", "http.server", "${PORT}"]],
            "stop" => %{"command" => ["echo", "runner-stop"]}
          }
        }
      ])

    assert {:ok, %{servers: [server]}} =
             Manager.prepare_for_issue(project.slug, identifier)

    runner_path = Application.app_dir(:symphony_elixir, "priv/preview/run.sh")
    spec_path = server.env["SYMPHONY_PREVIEW_RUN_SPEC"]

    assert server.command =~ runner_path
    refute server.command =~ "symphony-preview-runner"
    assert server.command =~ "SYMPHONY_PREVIEW_CONTRACT_ID="
    assert server.command =~ "SYMPHONY_PREVIEW_RUN_SPEC="
    assert server.env["SYMPHONY_PREVIEW_CONTRACT"] == "1"
    assert server.env["INSPIRE_PORT"] == Integer.to_string(server.preferred_port)
    assert server.env["PORT"] == Integer.to_string(server.preferred_port)
    assert spec_path == Path.join([workspace_path, ".symphony", "run-spec.json"])
    assert File.regular?(spec_path)
    assert server.stop_command == "'echo' 'runner-stop'"
  end

  test "start_for_issue launches the runner with run_spec beside the nested serve report", %{
    project: project,
    identifier: identifier,
    workspace_path: workspace_path
  } do
    serve_root = Path.join(workspace_path, "frontend")
    File.mkdir_p!(serve_root)

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{
          description: "Managed frontend preview",
          command: "symphony-preview-runner",
          role: "serve",
          working_dir: "frontend",
          run_spec: %{
            "start" => [["python3", "-m", "http.server", "${PORT}"]]
          }
        }
      ])

    assert {:ok, [pid]} =
             Manager.start_for_issue(project.slug, identifier, ready_timeout_ms: 0)

    runner_path = Application.app_dir(:symphony_elixir, "priv/preview/run.sh")
    launch_command = :sys.get_state(pid).step.command

    assert {:ok, contract, _record} =
             SymphonyElixir.DevServer.RuntimeContractStore.get_active(
               project,
               identifier,
               "frontend"
             )

    spec_path = Path.join([serve_root, ".symphony", "run-spec.json"])

    assert launch_command =~ runner_path
    assert launch_command =~ "SYMPHONY_PREVIEW_RUN_SPEC="
    assert launch_command =~ spec_path
    assert contract.report_path ==
             Path.join([serve_root, ".symphony", "preview-report.json"])

    assert File.regular?(spec_path)
    refute File.exists?(Path.join([workspace_path, ".symphony", "run-spec.json"]))
  end

  defp enable_project_dev_server!(project) do
    workflow_markdown =
      Workflow.to_markdown(
        %{
          "dev_server" => %{
            "enabled" => true,
            "port_range" => [41_000, 41_031],
            "max_concurrent" => 1,
            "idle_timeout_ms" => 60_000
          }
        },
        ""
      )

    {:ok, _setup} =
      Context.upsert_project_setup(project.slug, %{"workflow_markdown" => workflow_markdown})

    :ok
  end

  defp ensure_manager_started! do
    case Process.whereis(Manager) do
      nil -> start_supervised!(Manager)
      pid when is_pid(pid) -> pid
    end
  end

  defp clear_reservation_table do
    case :ets.whereis(Module.concat(Manager, PortReservations)) do
      :undefined -> :ok
      table -> :ets.delete_all_objects(table)
    end
  rescue
    ArgumentError -> :ok
  end

  defp restore_application_env(key, nil),
    do: Application.delete_env(:symphony_elixir, key)

  defp restore_application_env(key, value),
    do: Application.put_env(:symphony_elixir, key, value)
end
