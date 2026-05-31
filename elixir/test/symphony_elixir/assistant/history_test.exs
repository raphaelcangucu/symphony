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

  test "project history ignores issue-scoped threads for the same project" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, project_thread} = History.ensure_thread("macro-markets", %{workspace_path: "/tmp/assistant/macro-markets"})
    {:ok, issue_thread} = History.ensure_issue_thread("macro-markets", "MAC-1", %{workspace_path: "/tmp/issue/MAC-1"})
    {:ok, other_issue_thread} = History.ensure_issue_thread("macro-markets", "MAC-2", %{workspace_path: "/tmp/issue/MAC-2"})

    {:ok, _} = History.append_message(project_thread, %{role: "user", content: "project question"})
    {:ok, _} = History.append_message(issue_thread, %{role: "user", content: "issue one question"})
    {:ok, _} = History.append_message(other_issue_thread, %{role: "user", content: "issue two question"})

    assert {:ok, messages} = History.list_messages("macro-markets")
    assert Enum.map(messages, & &1.content) == ["project question"]

    assert {:ok, same_project_thread} = History.ensure_thread("macro-markets", %{workspace_path: "/tmp/ignored"})
    assert same_project_thread.id == project_thread.id
    assert same_project_thread.scope == "project"
  end

  test "ensure_thread creates a project thread when only issue threads exist for the project" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue_thread} = History.ensure_issue_thread("macro-markets", "MAC-1", %{workspace_path: "/tmp/issue/MAC-1"})
    {:ok, _other_issue_thread} = History.ensure_issue_thread("macro-markets", "MAC-2", %{workspace_path: "/tmp/issue/MAC-2"})

    assert {:ok, project_thread} =
             History.ensure_thread("macro-markets", %{
               codex_thread_id: "project-thread",
               workspace_path: "/tmp/assistant/macro-markets"
             })

    assert project_thread.scope == "project"
    assert project_thread.issue_identifier == nil
    assert project_thread.codex_thread_id == "project-thread"

    assert {:ok, []} = History.list_messages("macro-markets")
  end

  test "rejects messages without role or content" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, thread} = History.ensure_thread("macro-markets", %{workspace_path: "/tmp/assistant/macro-markets"})

    assert {:error, changeset} = History.append_message(thread, %{role: "user", content: "   "})
    refute changeset.valid?
  end

  test "create_freeform_thread/1 persists a project-less thread" do
    assert {:ok, thread} = History.create_freeform_thread(%{title: "Ideas", workspace_path: "/tmp/f"})
    assert thread.scope == "freeform"
    assert thread.project_slug == nil
  end

  test "list_threads/1 returns freeform threads newest first" do
    {:ok, t1} = History.create_freeform_thread(%{title: "A", workspace_path: "/tmp/a"})
    {:ok, t2} = History.create_freeform_thread(%{title: "B", workspace_path: "/tmp/b"})
    ids = History.list_threads(scope: "freeform", limit: 10) |> Enum.map(& &1.id)
    assert ids == [t2.id, t1.id]
  end

  test "latest_message/1 returns the most recent message map" do
    {:ok, thread} = History.create_freeform_thread(%{title: "A", workspace_path: "/tmp/a"})
    {:ok, _} = History.append_message(thread, %{role: "user", content: "hello"})
    {:ok, _} = History.append_message(thread, %{role: "assistant", content: "hi there"})
    assert %{content: "hi there"} = History.latest_message(thread.id)
  end

  test "list_messages_for_thread/1 returns Message structs in sequence order" do
    {:ok, thread} = History.create_freeform_thread(%{title: "A", workspace_path: "/tmp/a"})
    {:ok, _} = History.append_message(thread, %{role: "user", content: "one"})
    {:ok, _} = History.append_message(thread, %{role: "assistant", content: "two"})
    messages = History.list_messages_for_thread(thread.id)
    assert Enum.all?(messages, &match?(%Message{}, &1))
    contents = Enum.map(messages, & &1.content)
    assert contents == ["one", "two"]
  end

  test "get_thread/1 returns {:ok, thread} or {:error, :not_found}" do
    {:ok, thread} = History.create_freeform_thread(%{title: "A", workspace_path: "/tmp/a"})
    assert {:ok, %{id: id}} = History.get_thread(thread.id)
    assert id == thread.id
    assert {:error, :not_found} = History.get_thread(thread.id + 999_999)
  end

  test "copy_messages_to_empty_thread/2 preserves authoring messages and skips non-empty targets" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, project_thread} = History.ensure_thread("macro-markets", %{workspace_path: "/tmp/assistant/macro-markets"})
    {:ok, issue_thread} = History.ensure_issue_thread("macro-markets", "MAC-7", %{workspace_path: "/tmp/issue/MAC-7"})

    {:ok, _user_message} =
      History.append_message(project_thread, %{
        role: "user",
        content: "Draft the billing issue",
        metadata: %{"view" => "board"}
      })

    {:ok, _assistant_message} =
      History.append_message(project_thread, %{
        role: "assistant",
        content: "Drafted MAC-7",
        turn_id: "turn-7",
        tool_calls: [%{"name" => "create_draft_issue", "status" => "complete"}]
      })

    project_messages = History.list_messages_for_thread(project_thread.id)

    assert {:ok, ^issue_thread} = History.copy_messages_to_empty_thread(issue_thread, project_messages)

    copied_messages = History.list_messages_for_thread(issue_thread.id)
    assert Enum.map(copied_messages, & &1.role) == ["user", "assistant"]
    assert Enum.map(copied_messages, & &1.content) == ["Draft the billing issue", "Drafted MAC-7"]
    assert hd(copied_messages).metadata == %{"view" => "board"}
    assert List.last(copied_messages).turn_id == "turn-7"

    assert History.message_payload(List.last(copied_messages)).tool_calls == [
             %{"name" => "create_draft_issue", "status" => "complete"}
           ]

    assert {:ok, ^issue_thread} = History.copy_messages_to_empty_thread(issue_thread, project_messages)
    assert length(History.list_messages_for_thread(issue_thread.id)) == 2
  end

  describe "ensure_issue_thread/3" do
    setup do
      {:ok, _project} = Context.ensure_project(%{name: "Macro", slug: "macro"})
      :ok
    end

    test "creates an issue-scoped thread bound to the identifier" do
      assert {:ok, thread} =
               History.ensure_issue_thread("macro", "MAC-1", %{workspace_path: "/tmp/ws"})

      assert thread.scope == "issue"
      assert thread.project_slug == "macro"
      assert thread.issue_identifier == "MAC-1"
      assert thread.status == "active"
    end

    test "returns the same active thread on repeat calls" do
      {:ok, a} = History.ensure_issue_thread("macro", "MAC-1", %{workspace_path: "/tmp/ws"})
      {:ok, b} = History.ensure_issue_thread("macro", "MAC-1", %{workspace_path: "/tmp/ws"})
      assert a.id == b.id
    end

    test "set_mode/2 persists the mode in metadata" do
      {:ok, thread} = History.ensure_issue_thread("macro", "MAC-1", %{workspace_path: "/tmp/ws"})
      assert {:ok, updated} = History.set_mode(thread, "complex")
      assert updated.metadata["mode"] == "complex"
    end
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
