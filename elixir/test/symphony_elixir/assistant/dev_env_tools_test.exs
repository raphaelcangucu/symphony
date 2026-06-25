defmodule SymphonyElixir.Assistant.DevEnvToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.DevEnvTools
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()

    {:ok, _} =
      Context.create_workspace_project(%{
        "name" => "Dev Env",
        "slug" => "dev-env-test",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [],
        "setup" => %{}
      })

    :ok
  end

  test "list_steps on empty project returns empty list" do
    assert {:ok, result} = DevEnvTools.execute("dev-env-test", %{"action" => "list_steps"})

    assert result.tool == "manage_dev_env"
    assert result.data.steps == []
  end

  test "save_steps and list_steps round-trip" do
    assert {:ok, saved} =
             DevEnvTools.execute("dev-env-test", %{
               "action" => "save_steps",
               "steps" => [%{"description" => "Install", "command" => "mix deps.get", "source" => "manual"}]
             })

    assert [%{command: "mix deps.get"}] = saved.data.steps

    assert {:ok, listed} = DevEnvTools.execute("dev-env-test", %{"action" => "list_steps"})
    assert [%{description: "Install"}] = listed.data.steps
  end

  test "propose_steps returns proposals" do
    assert {:ok, result} = DevEnvTools.execute("dev-env-test", %{"action" => "propose_steps"})

    assert result.tool == "manage_dev_env"
    assert is_list(result.data.proposals)
  end

  test "run_step with invalid id returns error" do
    assert {:error, :step_not_found} =
             DevEnvTools.execute("dev-env-test", %{"action" => "run_step", "step_id" => "999"})
  end

  test "coding agent rejects save_steps and propose_steps" do
    assert {:error, :action_not_allowed} =
             DevEnvTools.execute("dev-env-test", %{"action" => "save_steps", "steps" => []}, coding_agent: true)

    assert {:error, :action_not_allowed} =
             DevEnvTools.execute("dev-env-test", %{"action" => "propose_steps"}, coding_agent: true)
  end

  test "coding agent allows list_steps" do
    assert {:ok, result} =
             DevEnvTools.execute("dev-env-test", %{"action" => "list_steps"}, coding_agent: true)

    assert result.data.steps == []
  end

  test "assistant can run warm_up via injected fun" do
    warm = fn _slug, _opts ->
      {:ok, %{run_id: 1, status: "succeeded", failure_class: nil, port: 4399, output: "ok"}}
    end

    assert {:ok, result} =
             DevEnvTools.execute("dev-env-test", %{"action" => "warm_up"}, warm_up: warm)

    assert result.tool == "manage_dev_env"
    assert result.message == "Dev environment warm-up succeeded."
    assert result.data.status == "succeeded"
  end

  test "warm_up surfaces a failure_class in the message" do
    warm = fn _slug, _opts ->
      {:ok, %{run_id: 2, status: "failed", failure_class: "image_pull_auth", port: nil, output: "403"}}
    end

    assert {:ok, result} =
             DevEnvTools.execute("dev-env-test", %{"action" => "warm_up"}, warm_up: warm)

    assert result.message =~ "image_pull_auth"
  end

  test "warm_up tells the agent to ASK the user when remediation needs user input" do
    warm = fn _slug, _opts ->
      {:ok,
       %{
         run_id: 3,
         status: "failed",
         failure_class: "image_pull_auth",
         port: nil,
         output: "403",
         remediation: %{needs_user_input: true, summary: "creds", ask: ["AWS_ACCESS_KEY_ID?"], apply: "…"}
       }}
    end

    assert {:ok, result} =
             DevEnvTools.execute("dev-env-test", %{"action" => "warm_up"}, warm_up: warm)

    assert result.message =~ "ASK the user"
    assert result.data.remediation.needs_user_input == true
  end

  test "coding agents are denied warm_up" do
    assert {:error, :action_not_allowed} =
             DevEnvTools.execute("dev-env-test", %{"action" => "warm_up"}, coding_agent: true)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_dev_env_step_runs",
          "local_tracker_dev_env_runs",
          "local_tracker_dev_env_steps",
          "local_tracker_projects"
        ] do
      Ecto.Adapters.SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end
end
