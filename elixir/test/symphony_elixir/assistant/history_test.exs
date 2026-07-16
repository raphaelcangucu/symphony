defmodule SymphonyElixir.Assistant.HistoryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{History, Message, Thread}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow

  defmodule GitStub do
    @behaviour SymphonyElixir.LocalTracker.Git

    @impl true
    def clone(_url, destination, _opts) do
      File.mkdir_p!(destination)
      {:ok, "history-test-sha"}
    end
  end

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

  test "creates an explicit issue workspace session with trusted metadata" do
    {:ok, _project} = Context.ensure_project(%{name: "Explicit History", slug: "explicit-history"})

    {:ok, issue} =
      Context.create_issue("explicit-history", %{"title" => "Explicit issue", "status" => "Todo"})

    workspace_path = Path.join(System.tmp_dir!(), "explicit-history/#{issue.identifier}__p1")

    assert {:ok, %Thread{} = thread} =
             History.create_issue_workspace_session_thread(
               "explicit-history",
               issue.identifier,
               workspace_path,
               %{
                 title: "Pinned parallel session",
                 agent_kind: "claude",
                 execution_mode: "plan",
                 workspace_kind: "isolated",
                 metadata: %{"custom" => "preserved"}
               }
             )

    assert thread.scope == "issue_session"
    assert thread.project_slug == "explicit-history"
    assert thread.issue_identifier == issue.identifier
    assert thread.workspace_path == workspace_path
    assert thread.title == "Pinned parallel session"
    assert thread.agent_kind == "claude"
    assert thread.status == "active"
    assert thread.metadata["execution_mode"] == "plan"
    assert thread.metadata["workspace_kind"] == "isolated"
    assert thread.metadata["custom"] == "preserved"
  end

  test "explicit issue workspace constructor validates path, kind, project, and issue" do
    {:ok, _project} = Context.ensure_project(%{name: "Defensive History", slug: "defensive-history"})

    {:ok, issue} =
      Context.create_issue("defensive-history", %{"title" => "Defensive issue", "status" => "Todo"})

    attrs = %{workspace_kind: "shared"}

    assert {:error, {:missing_required_field, :workspace_path}} =
             History.create_issue_workspace_session_thread(
               "defensive-history",
               issue.identifier,
               "   ",
               attrs
             )

    assert {:error, {:invalid_field, :workspace_kind}} =
             History.create_issue_workspace_session_thread(
               "defensive-history",
               issue.identifier,
               "/tmp/defensive-history",
               %{workspace_kind: "client-supplied"}
             )

    assert {:error, :project_not_found} =
             History.create_issue_workspace_session_thread(
               "missing-project",
               issue.identifier,
               "/tmp/missing-project",
               attrs
             )

    assert {:error, :issue_not_found} =
             History.create_issue_workspace_session_thread(
               "defensive-history",
               "DEF-404",
               "/tmp/missing-issue",
               attrs
             )
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

          receive do
            :release_write_lock -> :ok
          end

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

  test "message payload exposes valid persisted content blocks and safely handles legacy metadata" do
    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "Ordered blocks",
        workspace_path: "/tmp/assistant/ordered-blocks"
      })

    content_blocks = [
      %{"type" => "text", "text" => "Before"},
      %{"type" => "tool", "tool_call_id" => "tool-1"},
      %{"type" => "text", "text" => "After"}
    ]

    tool_calls = [%{"id" => "tool-1", "name" => "list_issues", "status" => "complete"}]

    assert {:ok, persisted} =
             History.append_message(thread, %{
               role: "assistant",
               content: "BeforeAfter",
               tool_calls: tool_calls,
               metadata: %{"content_blocks" => content_blocks, "source" => "test"}
             })

    payload = History.message_payload(persisted)
    assert payload.content_blocks == content_blocks
    assert payload.metadata == %{"content_blocks" => content_blocks, "source" => "test"}

    mismatch_cases = [
      [
        %{"type" => "text", "text" => "Wrong"},
        %{"type" => "tool", "tool_call_id" => "tool-1"}
      ],
      [
        %{"type" => "text", "text" => "Before"},
        %{"type" => "tool", "tool_call_id" => "missing-tool"},
        %{"type" => "text", "text" => "After"}
      ],
      [
        %{"type" => "text", "text" => "Before"},
        %{"type" => "tool", "tool_call_id" => "tool-1"},
        %{"type" => "tool", "tool_call_id" => "tool-1"},
        %{"type" => "text", "text" => "After"}
      ],
      [%{"type" => "text", "text" => "BeforeAfter"}]
    ]

    Enum.each(mismatch_cases, fn mismatched_blocks ->
      assert {:ok, mismatched} =
               History.append_message(thread, %{
                 role: "assistant",
                 content: "BeforeAfter",
                 tool_calls: tool_calls,
                 metadata: %{"content_blocks" => mismatched_blocks}
               })

      assert History.message_payload(mismatched).content_blocks == []
    end)

    assert {:ok, legacy} =
             History.append_message(thread, %{role: "assistant", content: "Legacy response"})

    assert History.message_payload(legacy).content_blocks == []

    assert {:ok, malformed} =
             History.append_message(thread, %{
               role: "assistant",
               content: "Malformed metadata",
               metadata: %{"content_blocks" => [%{"type" => "text", "text" => ""}]}
             })

    malformed_payload = History.message_payload(malformed)
    assert malformed_payload.content_blocks == []
    assert malformed_payload.metadata == %{"content_blocks" => [%{"type" => "text", "text" => ""}]}
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
               git: GitStub
             })

    assert thread.scope == "project_explore"
    assert thread.project_slug == "explore-demo"
    assert is_binary(thread.workspace_path)
    assert thread.workspace_path != ""

    assert {:ok, same} =
             History.ensure_project_explore_thread("explore-demo", %{
               git: GitStub
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

  test "update_thread_sidebar_metadata normalizes title labels and review state" do
    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "Ideas",
        workspace_path: "/tmp/sidebar",
        metadata: %{"unrelated" => "preserved"}
      })

    assert {:ok, updated} =
             History.update_thread_sidebar_metadata(thread.id, %{
               title: "  New title  ",
               labels: [" idea ", "idea", "wip"],
               needs_review: true
             })

    assert updated.title == "New title"
    assert updated.metadata["sidebar_labels"] == ["idea", "wip"]
    assert updated.metadata["sidebar_needs_review"] == true
    assert updated.metadata["unrelated"] == "preserved"
  end

  test "update_thread_sidebar_metadata enforces title grapheme boundaries" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Ideas", workspace_path: "/tmp/title-limits"})

    title_at_limit = String.duplicate("é", 160)
    title_over_limit = title_at_limit <> "é"

    assert {:ok, updated} = History.update_thread_sidebar_metadata(thread.id, %{title: title_at_limit})
    assert updated.title == title_at_limit
    assert {:error, :invalid_title} = History.update_thread_sidebar_metadata(thread.id, %{title: title_over_limit})
  end

  test "update_thread_sidebar_metadata enforces label grapheme boundaries" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Ideas", workspace_path: "/tmp/label-limits"})

    label_at_limit = String.duplicate("é", 40)
    label_over_limit = label_at_limit <> "é"

    assert {:ok, updated} = History.update_thread_sidebar_metadata(thread.id, %{labels: [label_at_limit]})
    assert updated.metadata["sidebar_labels"] == [label_at_limit]
    assert {:error, :invalid_labels} = History.update_thread_sidebar_metadata(thread.id, %{labels: [label_over_limit]})
  end

  test "update_thread_sidebar_metadata enforces normalized label count boundaries" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Ideas", workspace_path: "/tmp/label-count"})
    labels_at_limit = Enum.map(1..12, &"label-#{&1}")

    assert {:ok, updated} = History.update_thread_sidebar_metadata(thread.id, %{labels: labels_at_limit})
    assert updated.metadata["sidebar_labels"] == labels_at_limit

    assert {:error, :invalid_labels} =
             History.update_thread_sidebar_metadata(thread.id, %{labels: labels_at_limit ++ ["label-13"]})
  end

  test "update_thread_sidebar_metadata rejects malformed labels and review state" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Ideas", workspace_path: "/tmp/sidebar-invalid"})

    assert {:error, :invalid_labels} = History.update_thread_sidebar_metadata(thread.id, %{labels: "idea"})
    assert {:error, :invalid_labels} = History.update_thread_sidebar_metadata(thread.id, %{labels: ["idea", 7]})
    assert {:error, :invalid_needs_review} = History.update_thread_sidebar_metadata(thread.id, %{needs_review: "true"})
  end

  test "update_thread_sidebar_metadata preserves omitted sidebar fields and unrelated metadata" do
    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "Original",
        workspace_path: "/tmp/sidebar-partial",
        metadata: %{
          "sidebar_labels" => ["idea"],
          "sidebar_needs_review" => true,
          "unrelated" => %{"keep" => true}
        }
      })

    assert {:ok, updated} = History.update_thread_sidebar_metadata(thread.id, %{title: "Renamed"})
    assert updated.title == "Renamed"
    assert updated.metadata["sidebar_labels"] == ["idea"]
    assert updated.metadata["sidebar_needs_review"] == true
    assert updated.metadata["unrelated"] == %{"keep" => true}
  end

  test "update_thread_sidebar_metadata atomically preserves metadata written after an initial read" do
    {:ok, initially_read} =
      History.create_freeform_thread(%{
        title: "Original",
        workspace_path: "/tmp/sidebar-atomic",
        metadata: %{"existing" => true}
      })

    concurrent_turn = %{"status" => "running", "generation" => "later"}

    assert {:ok, _concurrent_update} =
             History.update_thread(initially_read, %{
               metadata: %{"existing" => true, "current_turn" => concurrent_turn}
             })

    handler_id = {__MODULE__, self(), :sidebar_atomic_update}

    :ok =
      :telemetry.attach(
        handler_id,
        [:symphony_elixir, :repo, :query],
        fn _event, _measurements, metadata, test_pid ->
          send(test_pid, {:sidebar_repo_query, metadata.query})
        end,
        self()
      )

    on_exit(fn -> :telemetry.detach(handler_id) end)

    assert {:ok, updated} =
             History.update_thread_sidebar_metadata(initially_read.id, %{
               title: "Renamed",
               labels: ["atomic"],
               needs_review: true
             })

    assert_receive {:sidebar_repo_query, update_query}
    assert update_query =~ "UPDATE"
    assert update_query =~ "json_patch"
    assert updated.metadata["existing"] == true
    assert updated.metadata["current_turn"] == concurrent_turn
    assert updated.metadata["sidebar_labels"] == ["atomic"]
    assert updated.metadata["sidebar_needs_review"] == true
  end

  test "delete_thread deletes active threads and archived threads" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Delete me", workspace_path: "/tmp/delete"})

    assert {:ok, deleted} = History.delete_thread(thread.id)
    assert deleted.id == thread.id
    assert {:error, :not_found} = History.get_thread(thread.id)

    {:ok, archived_thread} =
      History.create_freeform_thread(%{title: "Archived", workspace_path: "/tmp/delete-archived"})

    {:ok, archived} = History.archive_thread(archived_thread.id)
    assert {:ok, deleted_archived} = History.delete_thread(archived.id)
    assert deleted_archived.id == archived.id
    assert {:error, :not_found} = History.get_thread(archived_thread.id)
  end

  test "delete_thread rejects unsupported scopes and deletes errored threads" do
    {:ok, _project} = Context.ensure_project(%{name: "Delete Scope", slug: "delete-scope"})
    {:ok, project_thread} = History.ensure_thread("delete-scope", %{workspace_path: "/tmp/delete-scope"})
    {:ok, archived_project_thread} = History.archive_thread(project_thread.id)

    assert {:error, :unsupported_scope} = History.delete_thread(archived_project_thread.id)

    {:ok, freeform_thread} =
      History.create_freeform_thread(%{title: "Errored", workspace_path: "/tmp/delete-status"})

    {:ok, errored_thread} = History.update_thread(freeform_thread, %{status: "error"})
    assert {:ok, deleted_errored} = History.delete_thread(errored_thread.id)
    assert deleted_errored.id == errored_thread.id
    assert {:error, :not_found} = History.get_thread(errored_thread.id)
  end

  test "delete_thread deletes project_explore threads" do
    {:ok, _project} = Context.ensure_project(%{name: "Delete Explore", slug: "delete-explore"})
    {:ok, thread} = History.ensure_project_explore_thread("delete-explore", %{workspace_path: "/tmp/delete-explore"})

    assert {:ok, deleted} = History.delete_thread(thread.id)
    assert deleted.id == thread.id
    assert deleted.scope == "project_explore"
    assert {:error, :not_found} = History.get_thread(thread.id)
  end

  test "delete_thread deletes kb threads" do
    {:ok, _project} = Context.ensure_project(%{name: "Delete KB", slug: "delete-kb"})
    {:ok, thread} = History.ensure_kb_thread("delete-kb", "delete-kb", "SETTINGS.md", %{})

    assert {:ok, deleted} = History.delete_thread(thread.id)
    assert deleted.id == thread.id
    assert deleted.scope == "kb"
    assert {:error, :not_found} = History.get_thread(thread.id)
  end

  test "delete_thread returns not_found" do
    assert {:error, :not_found} = History.delete_thread(2_147_483_647)
  end

  test "delete_thread treats a concurrent stale delete as successful" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Stale", workspace_path: "/tmp/delete-stale"})
    {:ok, archived} = History.archive_thread(thread.id)

    Ecto.Adapters.SQL.query!(
      Repo,
      """
      CREATE TEMP TRIGGER simulate_concurrent_thread_delete
      BEFORE DELETE ON assistant_threads
      WHEN OLD.id = #{archived.id}
      BEGIN
        DELETE FROM assistant_threads WHERE id = OLD.id;
      END
      """,
      []
    )

    on_exit(fn ->
      Ecto.Adapters.SQL.query!(Repo, "DROP TRIGGER IF EXISTS simulate_concurrent_thread_delete", [])
    end)

    assert {:ok, deleted} = History.delete_thread(archived.id)
    assert deleted.id == archived.id
    assert {:error, :not_found} = History.get_thread(archived.id)
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

  describe "ensure_kb_thread/4" do
    test "creates a kb thread for the personal (@user) scope without a tracker project" do
      assert {:ok, thread} =
               History.ensure_kb_thread("@user", "@user~symphony-kb", "index.md", %{
                 workspace_path: "/tmp/kb/user"
               })

      assert thread.scope == "kb"
      assert thread.project_slug == "@user"
      assert thread.metadata["kb_page_path"] == "index.md"

      assert {:ok, same} =
               History.ensure_kb_thread("@user", "@user~symphony-kb", "index.md", %{
                 workspace_path: "/tmp/ignored"
               })

      assert same.id == thread.id
    end

    test "creates a kb thread for an existing tracker project" do
      {:ok, _project} = Context.ensure_project(%{name: "Macro", slug: "macro"})

      assert {:ok, thread} =
               History.ensure_kb_thread("macro", "web", "guides/x.md", %{
                 workspace_path: "/tmp/kb/macro"
               })

      assert thread.scope == "kb"
      assert thread.project_slug == "macro"
    end

    test "rejects a kb thread for an unknown non-@user project" do
      assert {:error, :project_not_found} =
               History.ensure_kb_thread("ghost", "web", "x.md", %{workspace_path: "/tmp/kb/ghost"})
    end
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

  describe "transcript payload guards" do
    test "message_payload/2 caps oversized tool output and annotates truncation" do
      {:ok, thread} = History.create_freeform_thread(%{title: "Cap", workspace_path: "/tmp/cap"})
      big_output = String.duplicate("x", 20_000)

      {:ok, message} =
        History.append_message(thread, %{
          role: "assistant",
          content: "ran a shell command",
          tool_calls: [
            %{"id" => "call-1", "name" => "shell", "output" => big_output, "status" => "complete"}
          ]
        })

      [uncapped_call] = History.message_payload(message).tool_calls
      assert uncapped_call["output"] == big_output
      refute Map.has_key?(uncapped_call, "output_truncated")

      [capped_call] = History.message_payload(message, cap_tool_output_bytes: 8_192).tool_calls
      assert capped_call["output_truncated"] == true
      assert capped_call["output_byte_size"] == 20_000
      assert byte_size(capped_call["output"]) < 20_000
      assert String.starts_with?(capped_call["output"], String.duplicate("x", 8_192))
    end

    test "message_payload/2 leaves small tool output untouched" do
      {:ok, thread} = History.create_freeform_thread(%{title: "Small", workspace_path: "/tmp/small"})

      {:ok, message} =
        History.append_message(thread, %{
          role: "assistant",
          content: "quick",
          tool_calls: [%{"id" => "c", "name" => "shell", "output" => "tiny", "status" => "complete"}]
        })

      [call] = History.message_payload(message, cap_tool_output_bytes: 8_192).tool_calls
      assert call["output"] == "tiny"
      refute Map.has_key?(call, "output_truncated")
    end

    test "tool_call_output/3 returns the full output and errors for unknown ids" do
      {:ok, thread} = History.create_freeform_thread(%{title: "Fetch", workspace_path: "/tmp/fetch"})
      big_output = String.duplicate("y", 12_000)

      {:ok, message} =
        History.append_message(thread, %{
          role: "assistant",
          content: "x",
          tool_calls: [
            %{"id" => "call-9", "name" => "shell", "output" => big_output, "status" => "complete"}
          ]
        })

      assert {:ok, %{output: ^big_output, output_byte_size: 12_000}} =
               History.tool_call_output(thread.id, message.id, "call-9")

      assert {:error, :not_found} = History.tool_call_output(thread.id, message.id, "missing")
      assert {:error, :not_found} = History.tool_call_output(thread.id, message.id + 999, "call-9")
    end

    test "list_messages_for_thread/2 limits to newest messages in ascending order" do
      {:ok, thread} = History.create_freeform_thread(%{title: "Page", workspace_path: "/tmp/page"})

      for n <- 1..5 do
        {:ok, _} = History.append_message(thread, %{role: "user", content: "m#{n}"})
      end

      newest_two = History.list_messages_for_thread(thread.id, limit: 2)
      assert Enum.map(newest_two, & &1.content) == ["m4", "m5"]

      older =
        History.list_messages_for_thread(thread.id, limit: 2, before_sequence: hd(newest_two).sequence)

      assert Enum.map(older, & &1.content) == ["m2", "m3"]
    end

    test "has_messages_before?/2 reflects older messages" do
      {:ok, thread} = History.create_freeform_thread(%{title: "Before", workspace_path: "/tmp/before"})
      {:ok, first} = History.append_message(thread, %{role: "user", content: "first"})
      {:ok, second} = History.append_message(thread, %{role: "user", content: "second"})

      assert History.has_messages_before?(thread.id, second.sequence)
      refute History.has_messages_before?(thread.id, first.sequence)
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
