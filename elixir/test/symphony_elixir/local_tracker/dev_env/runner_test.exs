defmodule SymphonyElixir.LocalTracker.DevEnv.RunnerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, DevEnv}
  alias SymphonyElixir.LocalTracker.DevEnv.Runner
  alias SymphonyElixir.Repo

  defmodule TmuxStub do
    def available?, do: true
    def has_session?(_), do: true
    def new_session(_, _), do: :ok
    def send_keys(_, _), do: :ok
    def capture_pane(_), do: {:ok, "$ mix deps.get\nResolving...\n"}
    def resize(_, _, _), do: :ok
  end

  setup do
    {:ok, _r, _a} = Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
    for t <- ["local_tracker_dev_env_step_runs", "local_tracker_dev_env_runs", "local_tracker_dev_env_steps", "local_tracker_projects"], do: Repo.query!("delete from #{t}")

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "P",
        "slug" => "p",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [],
        "setup" => %{}
      })

    {:ok, [step]} = DevEnv.save_steps("p", [%{"description" => "Install", "command" => "mix deps.get", "working_dir" => "api", "source" => "manual"}])
    %{step: step}
  end

  test "run_step sends the command and records a step run", %{step: step} do
    {:ok, run} = DevEnv.start_run("p")

    assert {:ok, step_run} = Runner.run_step("p", run, step, tmux: TmuxStub)
    assert step_run.status == "running" or step_run.status == "succeeded"
    assert step_run.command == "mix deps.get"
    assert is_binary(step_run.output)
  end
end
