defmodule SymphonyElixir.Assistant.SideQueryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{History, SideQuery}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, thread} = History.ensure_thread("macro-markets", %{workspace_path: System.tmp_dir!()})
    {:ok, thread: thread}
  end

  test "streams deltas, returns the answer, and never persists", %{thread: thread} do
    test_pid = self()

    runner = fn _workspace, prompt, _issue, opts ->
      send(test_pid, {:prompt, prompt})
      Keyword.fetch!(opts, :on_assistant_delta).("42")
      {:ok, %{assistant_message: "The answer is 42.", tool_calls: []}}
    end

    assert {:ok, "The answer is 42."} =
             SideQuery.run(thread, "what is the answer",
               runner: runner,
               on_delta: fn delta -> send(test_pid, {:delta, delta}) end
             )

    assert_receive {:delta, "42"}
    assert_receive {:prompt, prompt}
    assert prompt =~ "side question"
    assert prompt =~ "what is the answer"

    assert History.list_messages_for_thread(thread.id) == []
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
