defmodule SymphonyElixir.LocalTracker.ContextSetupTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()

    :ok
  end

  test "upsert_project_setup creates then updates a project's setup" do
    {:ok, _project} =
      Context.ensure_project(%{
        name: "alpha",
        slug: "alpha",
        tracker_kind: "github",
        tracker_config: %{"repo" => "o/r", "project_id" => "PVT_1"}
      })

    {:ok, setup} =
      Context.upsert_project_setup("alpha", %{
        workflow_config: %{"tracker" => %{"active_states" => ["Todo"]}},
        prompt_template: "P1",
        after_create_hook: "echo hi",
        validation_commands: ["npm test"]
      })

    assert setup.prompt_template == "P1"

    {:ok, updated} = Context.upsert_project_setup("alpha", %{prompt_template: "P2"})
    assert updated.prompt_template == "P2"
    assert updated.workflow_config == %{"tracker" => %{"active_states" => ["Todo"]}}
  end

  test "returns error for unknown project" do
    assert {:error, :project_not_found} = Context.upsert_project_setup("nope", %{})
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
