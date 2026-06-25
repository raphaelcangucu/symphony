defmodule SymphonyElixir.Assistant.DispatchToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.DispatchTools
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!()
    :ok
  end

  defp issue_in(status) do
    {:ok, _} = Context.ensure_project(%{name: "Macro", slug: "macro"})
    {:ok, issue} = Context.create_issue("macro", %{"title" => "T", "status" => status})
    issue
  end

  defp config(overrides \\ []) do
    struct!(
      ProjectConfig,
      Keyword.merge(
        [
          project_id: "p",
          project_slug: "macro",
          tracker_kind: "local",
          dispatch_states: ["Todo"],
          wait_states: ["Human Review"],
          terminal_states: ["Done"]
        ],
        overrides
      )
    )
  end

  test "eligible when status is in dispatch_states and label gate off" do
    issue = issue_in("Todo")

    assert {:ok, result} =
             DispatchTools.execute("macro", %{"identifier" => issue.identifier},
               project_config: config(),
               dispatch_states: ["Todo"],
               require_symphony_label: false,
               require_assignee_match: false
             )

    assert result.data.eligible == true
    assert result.data.reasons == []
  end

  test "not eligible when status outside dispatch_states" do
    issue = issue_in("Backlog")

    assert {:ok, result} =
             DispatchTools.execute("macro", %{"identifier" => issue.identifier},
               project_config: config(),
               dispatch_states: ["Todo"],
               require_symphony_label: false
             )

    assert result.data.eligible == false
    assert "status_not_in_dispatch_states" in result.data.reasons
  end

  test "missing symphony label is a reason when required" do
    issue = issue_in("Todo")

    assert {:ok, result} =
             DispatchTools.execute("macro", %{"identifier" => issue.identifier},
               project_config: config(),
               dispatch_states: ["Todo"],
               require_symphony_label: true
             )

    assert "missing_symphony_label" in result.data.reasons
    assert result.data.gates.require_symphony_label == true
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
