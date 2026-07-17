defmodule SymphonyElixir.LocalTracker.DevEnv.StepTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, DevEnv}
  alias SymphonyElixir.LocalTracker.DevEnv.{ProposedStep, Step}
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
        "name" => "RunSpec",
        "slug" => "run-spec",
        "workflow_statuses" => [
          %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}
        ],
        "repositories" => [],
        "setup" => %{}
      })

    :ok
  end

  test "requires description and command" do
    refute Step.changeset(%Step{}, %{project_id: 1}).valid?
  end

  test "validates source inclusion" do
    refute Step.changeset(%Step{}, %{project_id: 1, description: "d", command: "c", source: "bogus"}).valid?
    assert Step.changeset(%Step{}, %{project_id: 1, description: "d", command: "c", source: "convention"}).valid?
  end

  test "sources lists the allowed step sources" do
    assert Step.sources() == ~w(convention readme heuristic manual)
  end

  test "changeset accepts serve fields" do
    cs =
      Step.changeset(%Step{}, %{
        project_id: 1,
        description: "Front dev",
        command: "npm run dev",
        role: "serve",
        port_env: "PORT",
        url_path: "/",
        ready_probe: "http",
        ready_path: "/health",
        primary: true
      })

    assert cs.valid?
    assert Ecto.Changeset.get_field(cs, :role) == "serve"
    assert Ecto.Changeset.get_field(cs, :primary) == true
  end

  test "changeset rejects nil non-null serve fields" do
    cs =
      Step.changeset(%Step{}, %{
        project_id: 1,
        description: "Front dev",
        command: "npm run dev",
        role: nil,
        url_path: nil,
        ready_probe: nil,
        ready_path: nil,
        primary: nil
      })

    refute cs.valid?
  end

  test "changeset rejects unknown role" do
    cs = Step.changeset(%Step{}, %{project_id: 1, description: "x", command: "y", role: "bogus"})
    refute cs.valid?
  end

  test "changeset rejects unknown ready_probe" do
    cs = Step.changeset(%Step{}, %{project_id: 1, description: "x", command: "y", ready_probe: "bogus"})
    refute cs.valid?
  end

  test "ProposedStep carries serve fields with defaults" do
    s = ProposedStep.new(%{description: "d", command: "npm run dev", source: "heuristic", role: "serve"})
    assert s.role == "serve"
    assert s.port_env == nil
    assert s.url_path == "/"
    assert s.ready_probe == "tcp"
    assert s.ready_path == "/"
    refute s.primary
  end

  test "changeset accepts optional run_spec without requiring it" do
    cs =
      Step.changeset(%Step{}, %{
        project_id: 1,
        description: "Preview",
        command: "symphony-preview-runner",
        role: "serve",
        run_spec: %{
          "start" => [["nuxi", "dev", "--port", "${PORT}"]],
          "health" => %{"path" => "/api/health"}
        }
      })

    assert cs.valid?
    assert Ecto.Changeset.get_field(cs, :run_spec)["health"]["path"] == "/api/health"
  end

  test "run_spec round-trips through insert and reload" do
    run_spec = %{
      "cwd" => "frontend",
      "start" => [["nuxi", "dev", "--port", "${PORT}"]],
      "health" => %{"path" => "/api/health", "timeout_ms" => 1_000}
    }

    assert {:ok, [step]} =
             DevEnv.save_steps("run-spec", [
               %{
                 "description" => "Front dev",
                 "command" => "symphony-preview-runner",
                 "role" => "serve",
                 "run_spec" => run_spec,
                 "primary" => true
               }
             ])

    assert step.run_spec == run_spec

    reloaded = DevEnv.list_serve_steps("run-spec") |> hd()
    assert reloaded.run_spec == run_spec
  end

  test "ProposedStep accepts string-keyed serve fields" do
    s =
      ProposedStep.new(%{
        "description" => "d",
        "command" => "npm run dev",
        "source" => "convention",
        "role" => "serve",
        "primary" => true
      })

    assert s.role == "serve"
    assert s.primary
  end
end
