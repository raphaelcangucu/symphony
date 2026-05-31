defmodule SymphonyElixir.RecentsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Recents
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    :ok
  end

  test "includes freeform chat rows under nil project" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Ideas", workspace_path: System.tmp_dir!()})
    {:ok, _} = History.append_message(thread, %{role: "user", content: "what's up"})

    items = Recents.list(limit: 20, executions: [], issue_lister: fn _slug -> [] end, projects: [])
    assert Enum.any?(items, &(&1.kind == :chat and &1.scope == :freeform and &1.project_slug == nil))
  end

  test "codex rows derive from branch-name issues with live overlay" do
    issue = %{identifier: "ABC-12", title: "Fix bug", status: "In Progress", branch_name: "abc-12", updated_at: DateTime.utc_now()}
    exec = %{issue_identifier: "ABC-12", status: :live, last_event_at: DateTime.utc_now()}

    items =
      Recents.list(
        limit: 20,
        executions: [exec],
        issue_lister: fn "demo" -> [issue] end,
        projects: [%{slug: "demo", name: "Demo"}]
      )

    codex = Enum.find(items, &(&1.kind == :codex))
    assert codex.identifier == "ABC-12"
    assert codex.status_kind == :running
    assert codex.project_slug == "demo"
  end

  test "respects limit" do
    {:ok, _} = History.create_freeform_thread(%{title: "old", workspace_path: System.tmp_dir!()})
    items = Recents.list(limit: 1, executions: [], issue_lister: fn _ -> [] end, projects: [])
    assert length(items) <= 1
  end

  test "non-branch issue without active execution is excluded" do
    issue = %{identifier: "NOPE-1", title: "No branch", status: "Todo", branch_name: nil, updated_at: DateTime.utc_now()}
    items = Recents.list(limit: 20, executions: [], issue_lister: fn "demo" -> [issue] end, projects: [%{slug: "demo", name: "Demo"}])
    refute Enum.any?(items, &(&1.identifier == "NOPE-1"))
  end

  test "degrades gracefully when issue lister raises" do
    items = Recents.list(limit: 20, executions: [], projects: [%{slug: "demo", name: "Demo"}], issue_lister: fn _ -> raise "boom" end)
    assert is_list(items)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- [
          "assistant_messages",
          "assistant_threads",
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
