defmodule SymphonyElixir.Assistant.HistoryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{History, Message, Thread}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    :ok
  end

  test "ensures one active assistant thread per project and reuses it" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    assert {:ok, %Thread{} = thread} =
             History.ensure_thread("macro-markets", %{
               codex_thread_id: "thread-1",
               workspace_path: "/tmp/assistant/macro-markets"
             })

    assert {:ok, %Thread{} = same_thread} =
             History.ensure_thread("macro-markets", %{
               codex_thread_id: "thread-ignored",
               workspace_path: "/tmp/assistant/ignored"
             })

    assert same_thread.id == thread.id
    assert same_thread.codex_thread_id == "thread-1"
    assert same_thread.workspace_path == "/tmp/assistant/macro-markets"
  end

  test "appends messages with stable sequence and returns project history in order" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, thread} = History.ensure_thread("macro-markets", %{workspace_path: "/tmp/assistant/macro-markets"})

    assert {:ok, %Message{} = user_message} =
             History.append_message(thread, %{
               role: "user",
               content: "Oi",
               metadata: %{"view" => "board"}
             })

    assert {:ok, %Message{} = assistant_message} =
             History.append_message(thread, %{
               role: "assistant",
               content: "Oi! Como posso ajudar?",
               turn_id: "turn-1",
               tool_calls: [%{"name" => "list_issues", "status" => "complete"}]
             })

    assert user_message.sequence == 1
    assert assistant_message.sequence == 2

    assert {:ok, messages} = History.list_messages("macro-markets")
    assert Enum.map(messages, & &1.role) == ["user", "assistant"]
    assert Enum.map(messages, & &1.content) == ["Oi", "Oi! Como posso ajudar?"]
    assert List.last(messages).tool_calls == [%{"name" => "list_issues", "status" => "complete"}]
  end

  test "rejects messages without role or content" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, thread} = History.ensure_thread("macro-markets", %{workspace_path: "/tmp/assistant/macro-markets"})

    assert {:error, changeset} = History.append_message(thread, %{role: "user", content: "   "})
    refute changeset.valid?
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
