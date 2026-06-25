defmodule SymphonyElixir.Assistant.HistoryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{History, Message, Thread}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow

  setup do
    migrate_repo()
    clean_repo()

    tmp_dir = Path.join(System.tmp_dir!(), "symphony-history-test-#{System.unique_integer([:positive])}")
    File.rm_rf!(tmp_dir)
    File.mkdir_p!(tmp_dir)

    workflow_file = Path.join(tmp_dir, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: tmp_dir)
    Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      File.rm_rf!(tmp_dir)
    end)

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

  test "append_message survives sqlite write lock contention" do
    {:ok, _project} = Context.ensure_project(%{name: "Gamba", slug: "gamba"})
    {:ok, thread} = History.ensure_thread("gamba", %{workspace_path: "/tmp/assistant/gamba"})
    parent = self()

    lock_holder =
      spawn(fn ->
        Repo.checkout(fn ->
          Ecto.Adapters.SQL.query!(Repo, "BEGIN IMMEDIATE", [])
          send(parent, :write_lock_held)
          receive do :release_write_lock -> :ok end
          Ecto.Adapters.SQL.query!(Repo, "COMMIT", [])
        end)
      end)

    assert_receive :write_lock_held

    append_task =
      Task.async(fn ->
        History.append_message(thread, %{role: "user", content: "queued while sync writes"})
      end)

    Process.sleep(50)
    send(lock_holder, :release_write_lock)

    assert {:ok, %Message{} = message} = Task.await(append_task, 10_000)
    assert message.content == "queued while sync writes"
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

  test "ensure_project_explore_thread/1 creates an explore thread with workspace path" do
    {:ok, project} =
      Context.create_workspace_project(%{
        name: "Explore",
        slug: "explore-demo",
        repositories: [
          %{
            github_full_name: "org/api",
            clone_url: "https://github.com/org/api.git",
            default_branch: "main",
            workspace_path: "api",
            role: "backend"
          }
        ]
      })

    assert {:ok, thread} =
             History.ensure_project_explore_thread(project.slug, %{
               git: SymphonyElixir.Assistant.ProjectExploreWorkspaceTest.GitStub
             })

    assert thread.scope == "project_explore"
    assert thread.project_slug == "explore-demo"
    assert is_binary(thread.workspace_path)
    assert thread.workspace_path != ""

    assert {:ok, same} =
             History.ensure_project_explore_thread("explore-demo", %{
               git: SymphonyElixir.Assistant.ProjectExploreWorkspaceTest.GitStub
             })

    assert same.id == thread.id
  end

  test "create_freeform_thread/1 persists a project-less thread" do
    assert {:ok, thread} = History.create_freeform_thread(%{title: "Ideas", workspace_path: "/tmp/f"})
    assert thread.scope == "freeform"
    assert thread.project_slug == nil
  end

  test "archive_thread/1 removes thread from default list_threads" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Archive me", workspace_path: "/tmp/a"})
    assert {:ok, archived} = History.archive_thread(thread.id)
    assert archived.status == "archived"
    refute Enum.any?(History.list_threads(scope: "freeform"), &(&1.id == thread.id))
    assert Enum.any?(History.list_threads(scope: "freeform", include_archived: true), &(&1.id == thread.id))
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

    test "set_goal_mode/3 persists the authoring goal flag and objective" do
      {:ok, thread} = History.ensure_issue_thread("macro", "MAC-1", %{workspace_path: "/tmp/ws"})

      assert {:ok, updated} = History.set_goal_mode(thread, true, "Audit the auth module")
      assert History.thread_goal_mode(updated) == true
      assert History.thread_goal_objective(updated) == "Audit the auth module"

      # A blank objective clears the stored objective without disabling the flag.
      assert {:ok, cleared} = History.set_goal_mode(updated, true, "   ")
      assert History.thread_goal_mode(cleared) == true
      assert History.thread_goal_objective(cleared) == nil
    end

    test "set_goal_mode/2 leaves the objective untouched and defaults to nil" do
      {:ok, thread} = History.ensure_issue_thread("macro", "MAC-1", %{workspace_path: "/tmp/ws"})

      assert {:ok, enabled} = History.set_goal_mode(thread, true)
      assert History.thread_goal_objective(enabled) == nil
    end
  end

  describe "promote_project_thread_to_issue/3" do
    setup do
      {:ok, _project} = Context.ensure_project(%{name: "Macro", slug: "macro"})
      :ok
    end

    test "upgrades the active project thread in place and leaves no orphan" do
      {:ok, project_thread} = History.ensure_thread("macro", %{workspace_path: "/tmp/project-ws"})
      {:ok, _} = History.append_message(project_thread, %{role: "user", content: "draft this"})

      assert {:ok, issue_thread} =
               History.promote_project_thread_to_issue("macro", "MAC-9", %{workspace_path: "/tmp/issue-ws"})

      assert issue_thread.id == project_thread.id
      assert issue_thread.scope == "issue"
      assert issue_thread.issue_identifier == "MAC-9"
      assert issue_thread.workspace_path == "/tmp/issue-ws"

      assert Enum.map(History.list_messages_for_thread(issue_thread.id), & &1.content) == ["draft this"]
      refute Repo.get_by(Thread, project_slug: "macro", scope: "project", status: "active")
    end

    test "folds the project chat into an existing issue thread and closes the orphan" do
      {:ok, issue_thread} = History.ensure_issue_thread("macro", "MAC-9", %{workspace_path: "/tmp/issue-ws"})
      {:ok, project_thread} = History.ensure_thread("macro", %{workspace_path: "/tmp/project-ws"})
      {:ok, _} = History.append_message(project_thread, %{role: "user", content: "draft this"})

      assert {:ok, returned} =
               History.promote_project_thread_to_issue("macro", "MAC-9", %{workspace_path: "/tmp/issue-ws"})

      assert returned.id == issue_thread.id
      assert Enum.map(History.list_messages_for_thread(issue_thread.id), & &1.content) == ["draft this"]
      refute Repo.get_by(Thread, project_slug: "macro", scope: "project", status: "active")
    end
  end

  describe "repair_lingering_issue_drafts/0" do
    setup do
      {:ok, _project} = Context.ensure_project(%{name: "Macro", slug: "macro"})
      :ok
    end

    test "promotes a legacy project thread that produced a draft issue" do
      {:ok, project_thread} = History.ensure_thread("macro", %{workspace_path: "/tmp/project-ws"})
      {:ok, _} = History.append_message(project_thread, %{role: "user", content: "draft this"})

      {:ok, _} =
        History.append_message(project_thread, %{
          role: "assistant",
          content: "Drafted MAC-9",
          tool_calls: [
            %{
              "name" => "create_draft_issue",
              "status" => "complete",
              "result" => %{"tool" => "create_draft_issue", "data" => %{"identifier" => "MAC-9"}}
            }
          ]
        })

      assert :ok = History.repair_lingering_issue_drafts()

      assert {:ok, upgraded} = History.get_thread(project_thread.id)
      assert upgraded.scope == "issue"
      assert upgraded.issue_identifier == "MAC-9"
      refute Repo.get_by(Thread, project_slug: "macro", scope: "project", status: "active")
    end

    test "promotes a legacy project thread that created a regular issue" do
      {:ok, project_thread} = History.ensure_thread("macro", %{workspace_path: "/tmp/project-ws"})
      {:ok, _} = History.append_message(project_thread, %{role: "user", content: "create the task"})

      {:ok, _} =
        History.append_message(project_thread, %{
          role: "assistant",
          content: "Created MAC-510",
          tool_calls: [
            %{
              "name" => "create_issue",
              "status" => "complete",
              "result" => %{"tool" => "create_issue", "data" => %{"identifier" => "MAC-510"}}
            }
          ]
        })

      assert :ok = History.repair_lingering_issue_drafts()

      assert {:ok, %Thread{scope: "issue", issue_identifier: "MAC-510"}} =
               History.get_thread(project_thread.id)
    end

    test "extracts the identifier from the nested codex app-server tool result shape" do
      {:ok, project_thread} = History.ensure_thread("macro", %{workspace_path: "/tmp/project-ws"})
      {:ok, _} = History.append_message(project_thread, %{role: "user", content: "create the task"})

      {:ok, _} =
        History.append_message(project_thread, %{
          role: "assistant",
          content: "Created 510",
          tool_calls: [
            %{
              "name" => "create_issue",
              "status" => "complete",
              "result" => %{
                "success" => true,
                "contentItems" => [%{"type" => "inputText", "text" => "{\"data\":{\"identifier\":\"510\"}}"}],
                "toolResult" => %{"data" => %{"identifier" => "510", "title" => "Multitenant"}}
              }
            }
          ]
        })

      assert :ok = History.repair_lingering_issue_drafts()

      assert {:ok, %Thread{scope: "issue", issue_identifier: "510"}} =
               History.get_thread(project_thread.id)
    end

    test "ignores a failed create_draft_issue and leaves plain project chats untouched" do
      {:ok, project_thread} = History.ensure_thread("macro", %{workspace_path: "/tmp/project-ws"})
      {:ok, _} = History.append_message(project_thread, %{role: "user", content: "just chatting"})

      {:ok, _} =
        History.append_message(project_thread, %{
          role: "assistant",
          content: "draft failed",
          tool_calls: [
            %{
              "name" => "create_draft_issue",
              "status" => "error",
              "result" => %{"success" => false}
            }
          ]
        })

      assert :ok = History.repair_lingering_issue_drafts()

      assert {:ok, %Thread{scope: "project"}} = History.get_thread(project_thread.id)
    end
  end

  describe "issue_workspace_path/1" do
    test "returns the workspace path persisted on the active issue thread" do
      {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

      {:ok, _thread} =
        History.ensure_issue_thread("macro-markets", "MAC-77", %{workspace_path: "/tmp/issue/MAC-77"})

      assert History.issue_workspace_path("MAC-77") == "/tmp/issue/MAC-77"
    end

    test "returns nil when no active issue thread exists for the identifier" do
      assert History.issue_workspace_path("MAC-NONE") == nil
    end

    test "returns nil for blank identifiers" do
      assert History.issue_workspace_path("") == nil
      assert History.issue_workspace_path("   ") == nil
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
