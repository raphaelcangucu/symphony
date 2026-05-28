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

  test "start_run + record_step_result tracks status", %{project: _project} do
    {:ok, [step]} = DevEnv.save_steps("p", [%{"description" => "A", "command" => "a", "source" => "manual"}])
    {:ok, run} = DevEnv.start_run("p")
    {:ok, step_run} = DevEnv.record_step_result(run, step, %{status: "succeeded", exit_code: 0, output: "ok"})
    assert step_run.status == "succeeded"

    {:ok, finished} = DevEnv.finish_run(run)
    assert finished.status in ["succeeded", "failed"]
  end
end
