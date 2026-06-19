defmodule SymphonyElixir.LocalTracker.DevEnv.WarmUpTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, DevEnv}
  alias SymphonyElixir.Repo

  setup do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)

    for t <- [
          "local_tracker_dev_env_step_runs",
          "local_tracker_dev_env_runs",
          "local_tracker_dev_env_steps",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{t}")
    end

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Adv",
        "slug" => "adv",
        "workflow_statuses" => [
          %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}
        ],
        "repositories" => [],
        "setup" => %{}
      })

    :ok
  end

  describe "start_run/2 + update_warm_up_state/2" do
    test "start_run records the run kind" do
      {:ok, run} = DevEnv.start_run("adv", "warm_up")
      assert run.kind == "warm_up"
    end

    test "start_run defaults to kind=run" do
      {:ok, run} = DevEnv.start_run("adv")
      assert run.kind == "run"
    end

    test "update_warm_up_state persists readiness" do
      {:ok, run} = DevEnv.start_run("adv", "warm_up")
      {:ok, updated} = Context.update_warm_up_state("adv", %{status: "succeeded", run_id: run.id})
      assert updated.warm_up_status == "succeeded"
      assert updated.last_warm_up_run_id == run.id
      assert updated.warmed_at != nil
    end

    test "update_warm_up_state on failure does not stamp warmed_at" do
      {:ok, run} = DevEnv.start_run("adv", "warm_up")
      {:ok, updated} = Context.update_warm_up_state("adv", %{status: "failed", run_id: run.id})
      assert updated.warm_up_status == "failed"
      assert updated.warmed_at == nil
    end
  end

  describe "warm_up/2" do
    test "succeeds when the dry-run exits 0" do
      base = tmp_repo(with_serve: true)
      exec = fn _dir, _cmd, _opts -> {"booted; Preview is healthy", 0} end

      {:ok, result} = DevEnv.warm_up("adv", base: base, exec: exec)

      assert result.status == "succeeded"
      assert result.failure_class == nil
      assert {:ok, project} = Context.get_project("adv")
      assert project.warm_up_status == "succeeded"
    end

    test "classifies an ECR 403 as image_pull_auth" do
      base = tmp_repo(with_serve: true)
      exec = fn _dir, _cmd, _opts -> {"pull access denied: 403 Forbidden", 1} end

      {:ok, result} = DevEnv.warm_up("adv", base: base, exec: exec)

      assert result.status == "failed"
      assert result.failure_class == "image_pull_auth"
      assert {:ok, project} = Context.get_project("adv")
      assert project.warm_up_status == "failed"
    end

    test "reports needs_scaffold when .symphony/serve.sh is missing" do
      base = tmp_repo(with_serve: false)
      {:ok, result} = DevEnv.warm_up("adv", base: base, exec: fn _, _, _ -> {"", 0} end)

      assert result.failure_class == "needs_scaffold"
      assert result.status == "failed"
    end
  end

  defp tmp_repo(with_serve: with_serve) do
    base = Path.join(System.tmp_dir!(), "warmup-test-#{System.unique_integer([:positive])}")
    File.rm_rf!(base)

    if with_serve do
      File.mkdir_p!(Path.join(base, ".symphony"))
      File.write!(Path.join([base, ".symphony", "serve.sh"]), "#!/usr/bin/env bash\n")
    else
      File.mkdir_p!(base)
    end

    on_exit(fn -> File.rm_rf!(base) end)
    base
  end
end
