defmodule SymphonyElixir.LocalTracker.DevEnvTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, DevEnv}
  alias SymphonyElixir.Repo

  setup do
    {:ok, _repo, _apps} = Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)

    for t <- ["local_tracker_dev_env_step_runs", "local_tracker_dev_env_runs", "local_tracker_dev_env_steps", "local_tracker_repositories", "local_tracker_projects"] do
      Repo.query!("delete from #{t}")
    end

    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "P",
        "slug" => "p",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [],
        "setup" => %{}
      })

    %{project: project}
  end

  test "save_steps persists ordered steps", %{project: _project} do
    assert {:ok, steps} =
             DevEnv.save_steps("p", [
               %{"description" => "Install", "command" => "mix deps.get", "source" => "manual"},
               %{"description" => "Migrate", "command" => "mix ecto.migrate", "source" => "manual"}
             ])

    assert Enum.map(steps, & &1.position) == [0, 1]
    assert DevEnv.list_steps("p") |> Enum.map(& &1.command) == ["mix deps.get", "mix ecto.migrate"]
  end

  test "save_steps replaces previous steps", %{project: _project} do
    {:ok, _} = DevEnv.save_steps("p", [%{"description" => "A", "command" => "a", "source" => "manual"}])
    {:ok, _} = DevEnv.save_steps("p", [%{"description" => "B", "command" => "b", "source" => "manual"}])
    assert DevEnv.list_steps("p") |> Enum.map(& &1.command) == ["b"]
  end

  test "save_steps then list_serve_steps returns only serve steps and preserves fields", %{project: _project} do
    assert {:ok, _steps} =
             DevEnv.save_steps("p", [
               %{description: "Install", command: "npm ci", role: "setup"},
               %{
                 "description" => "Front",
                 "command" => "npm run dev",
                 "role" => "serve",
                 "port_env" => "PORT",
                 "primary" => true
               }
             ])

    assert [serve] = DevEnv.list_serve_steps("p")
    assert serve.description == "Front"
    assert serve.command == "npm run dev"
    assert serve.role == "serve"
    assert serve.port_env == "PORT"
    assert serve.primary
  end

  test "save_steps persists an optional stop_command for a serve step", %{project: _project} do
    assert {:ok, _steps} =
             DevEnv.save_steps("p", [
               %{
                 "description" => "Front",
                 "command" => "bash .symphony/serve.sh",
                 "stop_command" => "bash .symphony/stop.sh",
                 "role" => "serve",
                 "primary" => true
               }
             ])

    assert [serve] = DevEnv.list_serve_steps("p")
    assert serve.stop_command == "bash .symphony/stop.sh"
  end

  test "save_steps treats a blank stop_command as absent", %{project: _project} do
    assert {:ok, _steps} =
             DevEnv.save_steps("p", [
               %{"description" => "Front", "command" => "npm run dev", "role" => "serve", "stop_command" => ""}
             ])

    assert [serve] = DevEnv.list_serve_steps("p")
    assert serve.stop_command == nil
  end

  test "exactly one primary survives save when several serve steps are marked primary", %{project: _project} do
    assert {:ok, _steps} =
             DevEnv.save_steps("p", [
               %{description: "A", command: "a", role: "serve", primary: true},
               %{description: "B", command: "b", role: "serve", primary: true}
             ])

    assert [first, second] = DevEnv.list_serve_steps("p")
    assert first.primary
    refute second.primary
    assert Enum.count([first, second], & &1.primary) == 1
  end

  test "first serve becomes primary when none are marked", %{project: _project} do
    assert {:ok, _steps} =
             DevEnv.save_steps("p", [
               %{description: "Install", command: "npm ci", role: "setup", primary: true},
               %{description: "A", command: "a", role: "serve"},
               %{description: "B", command: "b", role: "serve"}
             ])

    assert [first, second] = DevEnv.list_serve_steps("p")
    assert first.primary
    refute second.primary
  end

  test "start_run + record_step_result tracks status", %{project: _project} do
    {:ok, [step]} = DevEnv.save_steps("p", [%{"description" => "A", "command" => "a", "source" => "manual"}])
    {:ok, run} = DevEnv.start_run("p")
    {:ok, step_run} = DevEnv.record_step_result(run, step, %{status: "succeeded", exit_code: 0, output: "ok"})
    assert step_run.status == "succeeded"

    {:ok, finished} = DevEnv.finish_run(run)
    assert finished.status in ["succeeded", "failed"]
  end

  test "propose_steps returns a list for a project without repositories", %{project: _project} do
    assert {:ok, steps} = DevEnv.propose_steps("p")
    assert is_list(steps)
  end

  test "propose_steps maps the project's own repositories" do
    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "WithRepo",
        "slug" => "withrepo",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [%{"github_full_name" => "o/r", "workspace_path" => "r", "role" => "service"}],
        "setup" => %{}
      })

    assert {:ok, steps} = DevEnv.propose_steps("withrepo")
    assert is_list(steps)
  end

  test "propose_steps returns project_not_found for an unknown project" do
    assert DevEnv.propose_steps("does-not-exist") == {:error, :project_not_found}
  end

  test "list_steps and list_runs return [] for an unknown project" do
    assert DevEnv.list_steps("does-not-exist") == []
    assert DevEnv.list_runs("does-not-exist") == []
  end

  test "list_runs returns runs with preloaded step_runs", %{project: _project} do
    {:ok, [step]} = DevEnv.save_steps("p", [%{"description" => "A", "command" => "a", "source" => "manual"}])
    {:ok, run} = DevEnv.start_run("p")
    {:ok, _step_run} = DevEnv.record_step_result(run, step, %{status: "succeeded", output: "ok"})

    assert [loaded_run] = DevEnv.list_runs("p")
    assert loaded_run.id == run.id
    assert [%{status: "succeeded"}] = loaded_run.step_runs
  end

  test "save_steps returns a changeset error and rolls back on invalid input", %{project: _project} do
    {:ok, _} = DevEnv.save_steps("p", [%{"description" => "keep", "command" => "keep", "source" => "manual"}])

    assert {:error, %Ecto.Changeset{}} =
             DevEnv.save_steps("p", [%{"description" => "x", "command" => nil, "source" => "manual"}])

    assert DevEnv.list_steps("p") |> Enum.map(& &1.command) == ["keep"]
  end
end
