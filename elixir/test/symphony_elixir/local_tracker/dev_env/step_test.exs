defmodule SymphonyElixir.LocalTracker.DevEnv.StepTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.DevEnv.{ProposedStep, Step}

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

  test "changeset accepts serve fields and defaults role to setup" do
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
end
