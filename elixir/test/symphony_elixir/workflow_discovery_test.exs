defmodule SymphonyElixir.WorkflowDiscoveryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.WorkflowDiscovery

  @tmp Path.expand("../tmp/workflow_discovery_test", __DIR__)

  setup do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)

    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    File.rm_rf!(@tmp)
    File.mkdir_p!(@tmp)

    File.write!(Path.join(@tmp, "WORKFLOW.alpha.md"), """
    ---
    tracker:
      active_states:
        - Todo
    ---
    Alpha prompt body.
    """)

    on_exit(fn ->
      File.rm_rf!(@tmp)
      SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    end)

    :ok
  end

  test "creates a missing project and imports its workflow into setup" do
    summary = WorkflowDiscovery.discover(@tmp)

    assert "alpha" in summary.discovered
    assert {:ok, _project} = Context.get_project("alpha")

    setup = Context.get_project_setup("alpha")
    assert setup.prompt_template =~ "Alpha prompt body."
    assert get_in(setup.workflow_config, ["tracker", "active_states"]) == ["Todo"]
  end

  test "never overwrites an existing project (DB-owned config wins)" do
    {:ok, _} = Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "local"})
    {:ok, _} = Context.upsert_project_setup("alpha", %{prompt_template: "KEEP"})

    summary = WorkflowDiscovery.discover(@tmp)

    assert "alpha" in summary.skipped
    refute "alpha" in summary.discovered
    assert Context.get_project_setup("alpha").prompt_template == "KEEP"
  end

  test "skips example workflow files" do
    File.write!(Path.join(@tmp, "WORKFLOW.beta.example.md"), """
    ---
    tracker:
      active_states:
        - Todo
    ---
    Example body.
    """)

    WorkflowDiscovery.discover(@tmp)

    assert {:error, :project_not_found} = Context.get_project("beta")
  end

  test "is idempotent across repeated runs" do
    first = WorkflowDiscovery.discover(@tmp)
    second = WorkflowDiscovery.discover(@tmp)

    assert "alpha" in first.discovered
    assert "alpha" in second.skipped
    refute "alpha" in second.discovered
  end

  test "logs and skips a file whose project creation fails, still discovering siblings" do
    File.write!(Path.join(@tmp, "WORKFLOW.broken.md"), """
    ---
    github:
      base: foo
    ---
    Broken project body.
    """)

    summary = WorkflowDiscovery.discover(@tmp)

    assert "alpha" in summary.discovered
    assert "broken" in summary.skipped
    assert {:error, :project_not_found} = Context.get_project("broken")
  end
end
