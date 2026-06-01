defmodule SymphonyElixir.Tracker.Sync.LocalFirstTrackerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{LocalFirstTracker, LocalStore, Outbox}

  setup do
    migrate_repo()
    clean_repo()

    {:ok, project} =
      Context.ensure_project(%{
        name: "repo",
        slug: "repo",
        tracker_kind: "github",
        tracker_config: %{"repo" => "owner/repo", "project_id" => "PVT_1"}
      })

    upsert(project, "1", "alice")
    upsert(project, "2", "bob")

    Application.put_env(:symphony_elixir, :tracker_sync_project_slug, "repo")

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :tracker_sync_assignee_fun)
      Application.delete_env(:symphony_elixir, :tracker_sync_project_slug)
    end)

    %{project: project}
  end

  defp upsert(project, identifier, assignee) do
    {:ok, _} =
      LocalStore.upsert_remote_issue(project, %{
        remote_id: "I_#{identifier}",
        remote_number: String.to_integer(identifier),
        identifier: identifier,
        title: "t#{identifier}",
        description: nil,
        state: "Todo",
        priority: nil,
        assignee_id: assignee,
        branch_name: nil,
        remote_url: "u",
        creator: nil,
        position: 0,
        remote_updated_at: DateTime.utc_now(),
        labels: [],
        comments: []
      })
  end

  defp stub_assignee(result), do: Application.put_env(:symphony_elixir, :tracker_sync_assignee_fun, fn _ -> result end)

  test "fetch_issues_by_states returns only the worker's issues with assigned_to_worker true" do
    stub_assignee({:ok, "alice"})

    assert {:ok, [issue]} = LocalFirstTracker.fetch_issues_by_states(["Todo"])
    assert issue.identifier == "1"
    assert issue.assigned_to_worker == true
  end

  test "no assignee configured returns all active issues (remote parity)" do
    stub_assignee({:ok, :any})
    assert {:ok, issues} = LocalFirstTracker.fetch_issues_by_states(["Todo"])
    assert length(issues) == 2
  end

  test "unresolved assignee returns nothing (safe: never grab wrong issues)" do
    stub_assignee({:error, :missing_viewer})
    assert {:ok, []} = LocalFirstTracker.fetch_issues_by_states(["Todo"])
  end

  test "create_comment writes locally and enqueues", %{project: project} do
    stub_assignee({:ok, "alice"})
    assert :ok = LocalFirstTracker.create_comment("1", "hello")
    assert Outbox.pending_count(project.id) == 1
  end

  test "update_issue_state moves locally and enqueues", %{project: project} do
    stub_assignee({:ok, "alice"})
    assert :ok = LocalFirstTracker.update_issue_state("1", "Done")
    assert Outbox.pending_count(project.id) == 1
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    for table <- [
          "tracker_sync_outbox",
          "local_tracker_comments",
          "local_tracker_issues",
          "local_tracker_workflow_statuses",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end
end
