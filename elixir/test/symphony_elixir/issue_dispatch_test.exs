defmodule SymphonyElixir.IssueDispatchTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.IssueDispatch
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    previous_sync = Application.get_env(:symphony_elixir, :tracker, []) |> Keyword.get(:sync_enabled)
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)

    on_exit(fn ->
      tracker_config = Application.get_env(:symphony_elixir, :tracker, [])

      tracker_config =
        case previous_sync do
          nil -> Keyword.delete(tracker_config, :sync_enabled)
          value -> Keyword.put(tracker_config, :sync_enabled, value)
        end

      Application.put_env(:symphony_elixir, :tracker, tracker_config)
    end)

    {:ok, _project} = Context.ensure_project(%{name: "Pref", slug: "pref"})
    {:ok, issue} = Context.create_issue("pref", %{"title" => "Dispatchable", "status" => "Todo"})
    {:ok, issue} = Context.update_issue("pref", issue.identifier, %{"labels" => ["symphony"]})
    {:ok, issue: issue}
  end

  test "resume nudges the orchestrator for active issues", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "In Progress"})
    {:ok, project} = Context.get_project("pref")

    assert {:ok, result} =
             IssueDispatch.resume(project, issue.identifier, %{"instructions" => "pick up tests"})

    assert result.action == "resume"
    assert result.message =~ issue.identifier

    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert updated.status.name == "In Progress"
  end

  test "restart keeps active issues in place", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "In Progress"})
    {:ok, project} = Context.get_project("pref")

    assert {:ok, result} = IssueDispatch.restart(project, issue.identifier, %{})
    assert result.action == "restart"

    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert updated.status.name == "In Progress"
  end

  test "resume moves non-active issues into a dispatchable status", %{issue: issue} do
    {:ok, _} = Context.move_issue("pref", issue.identifier, %{"status" => "Done"})
    {:ok, project} = Context.get_project("pref")

    assert {:ok, result} = IssueDispatch.resume(project, issue.identifier, %{})
    assert result.action == "resume"

    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    refute updated.status.is_terminal
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_comments",
          "local_tracker_issue_labels",
          "local_tracker_issues",
          "local_tracker_labels",
          "local_tracker_workflow_statuses",
          "local_tracker_project_setups",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Ecto.Adapters.SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end
end
