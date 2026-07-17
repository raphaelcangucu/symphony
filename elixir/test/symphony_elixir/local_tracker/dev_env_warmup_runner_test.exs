defmodule SymphonyElixir.LocalTracker.DevEnvWarmupRunnerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, DevEnv}
  alias SymphonyElixir.Repo

  setup do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)

    for table <- [
          "local_tracker_dev_env_step_runs",
          "local_tracker_dev_env_runs",
          "local_tracker_dev_env_steps",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Runner Warm-up",
        "slug" => "runner-warmup",
        "workflow_statuses" => [
          %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}
        ],
        "repositories" => [],
        "setup" => %{}
      })

    :ok
  end

  test "uses the preview runner for a primary serve step with run_spec" do
    run_spec = %{
      "prepare" => [["bash", "-lc", "prepare"]],
      "start" => [["python3", "-m", "http.server", "${PORT}"]],
      "health" => %{"path" => "/health"}
    }

    assert {:ok, _steps} =
             DevEnv.save_steps("runner-warmup", [
               %{
                 description: "Serve",
                 command: "bash .symphony/serve.sh",
                 role: "serve",
                 primary: true,
                 run_spec: run_spec
               }
             ])

    base = tmp_repo(with_serve: false)
    test_pid = self()

    exec = fn directory, command, options ->
      send(test_pid, {:exec, directory, command, options})
      {"Preview is healthy", 0}
    end

    assert {:ok, result} =
             DevEnv.warm_up("runner-warmup",
               base: base,
               exec: exec,
               port: 4390,
               tenant: "acme"
             )

    assert result.status == "succeeded"
    assert_received {:exec, ^base, command, []}

    assert command =~ Application.app_dir(:symphony_elixir, "priv/preview/run.sh")
    assert command =~ "SYMPHONY_PREVIEW_WARMUP='1'"
    assert command =~ "SYMPHONY_PREVIEW_RUN_SPEC="
    assert command =~ "SYMPHONY_PREVIEW_CONTRACT_ID='warmup-runner-warmup'"
    assert command =~ "SYMPHONY_PREVIEW_CONTRACT_REVISION='1'"
    assert command =~ "SYMPHONY_PREVIEW_PREFERRED_PORT='4390'"
    assert command =~ "SYMPHONY_PREVIEW_ALLOWED_PORTS='4390'"
    assert command =~ "PORT='4390'"
    assert command =~ "SYMPHONY_PREVIEW_TENANT='acme'"
    refute command =~ "bash .symphony/setup.sh"
    refute command =~ "bash .symphony/serve.sh"

    written_spec =
      [base, ".symphony", "run-spec.json"]
      |> Path.join()
      |> File.read!()
      |> Jason.decode!()

    assert written_spec["warmup"] == true
    assert written_spec["prepare"] == [%{"argv" => ["bash", "-lc", "prepare"]}]
    assert written_spec["start"] == [%{"argv" => ["python3", "-m", "http.server", "4390"]}]
  end

  test "keeps the legacy setup and serve command when run_spec is absent" do
    assert {:ok, _steps} =
             DevEnv.save_steps("runner-warmup", [
               %{
                 description: "Serve",
                 command: "bash .symphony/serve.sh",
                 role: "serve",
                 primary: true
               }
             ])

    base = tmp_repo(with_serve: true)
    test_pid = self()

    exec = fn _directory, command, _options ->
      send(test_pid, {:exec, command})
      {"Preview is healthy", 0}
    end

    assert {:ok, result} =
             DevEnv.warm_up("runner-warmup", base: base, exec: exec, port: 4390)

    assert result.status == "succeeded"
    assert_received {:exec, command}
    assert command =~ "bash .symphony/setup.sh"
    assert command =~ "bash .symphony/serve.sh"
    refute command =~ "priv/preview/run.sh"
  end

  test "an empty run_spec keeps the legacy serve.sh requirement" do
    assert {:ok, _steps} =
             DevEnv.save_steps("runner-warmup", [
               %{
                 description: "Serve",
                 command: "bash .symphony/serve.sh",
                 role: "serve",
                 primary: true,
                 run_spec: %{}
               }
             ])

    base = tmp_repo(with_serve: false)

    assert {:ok, result} =
             DevEnv.warm_up("runner-warmup",
               base: base,
               exec: fn _, _, _ -> flunk("legacy warm-up must not execute without serve.sh") end
             )

    assert result.status == "failed"
    assert result.failure_class == "needs_scaffold"
  end

  defp tmp_repo(with_serve: with_serve) do
    base =
      Path.join(System.tmp_dir!(), "warmup-runner-test-#{System.unique_integer([:positive])}")

    File.rm_rf!(base)
    File.mkdir_p!(base)

    if with_serve do
      File.mkdir_p!(Path.join(base, ".symphony"))
      File.write!(Path.join([base, ".symphony", "serve.sh"]), "#!/usr/bin/env bash\n")
    end

    on_exit(fn -> File.rm_rf!(base) end)
    base
  end
end
