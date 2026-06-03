defmodule Mix.Tasks.Symphony.Workflows.BackfillTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @tmp Path.expand("../../../tmp/workflows_backfill_test", __DIR__)

  setup do
    migrate_repo()
    clean_repo()

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

    on_exit(fn -> File.rm_rf!(@tmp) end)

    :ok
  end

  test "creates a missing project and imports its workflow into setup" do
    Mix.Tasks.Symphony.Workflows.Backfill.run(["--dir", @tmp])

    assert {:ok, _project} = Context.get_project("alpha")
    setup = Context.get_project_setup("alpha")
    assert setup.prompt_template =~ "Alpha prompt body."
    assert get_in(setup.workflow_config, ["tracker", "active_states"]) == ["Todo"]
  end

  test "logs and skips a file whose project creation fails, still importing siblings" do
    # github config missing repo/project_id => Context.ensure_project/1 returns
    # {:error, changeset}; the per-file import must log and skip instead of raising.
    File.write!(Path.join(@tmp, "WORKFLOW.aaa.md"), """
    ---
    github:
      base: foo
    ---
    Broken project body.
    """)

    Mix.Tasks.Symphony.Workflows.Backfill.run(["--dir", @tmp])

    assert {:error, :project_not_found} = Context.get_project("aaa")
    assert {:ok, _project} = Context.get_project("alpha")
    assert Context.get_project_setup("alpha").prompt_template =~ "Alpha prompt body."
  end

  test "does not overwrite an existing project's DB-owned setup" do
    {:ok, _} = Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "local"})
    {:ok, _} = Context.upsert_project_setup("alpha", %{prompt_template: "KEEP"})

    Mix.Tasks.Symphony.Workflows.Backfill.run(["--dir", @tmp])

    assert Context.get_project_setup("alpha").prompt_template == "KEEP"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
