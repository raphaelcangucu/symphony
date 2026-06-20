defmodule SymphonyElixir.Assistant.CodexSessionTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{CodexSession, History, ToolExecutor}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workspace
  alias SymphonyElixir.Workflow

  setup do
    migrate_repo()
    clean_repo()
    tmp_dir = Path.join(System.tmp_dir!(), "symphony-assistant-test-#{System.unique_integer([:positive])}")
    File.rm_rf!(tmp_dir)
    File.mkdir_p!(tmp_dir)

    workflow_file = Path.join(tmp_dir, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: tmp_dir)
    Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      File.rm_rf!(tmp_dir)
    end)

    %{workspace_root: tmp_dir}
  end

  test "creates a safe project assistant workspace and persists a runner reply", %{workspace_root: workspace_root} do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    parent = self()

    runner = fn workspace, prompt, issue, opts ->
      send(parent, {:runner_called, workspace, prompt, issue, opts})

      {:ok,
       %{
         assistant_message: "Oi! Eu sou o assistant do projeto Macro Markets.",
         codex_thread_id: "thread-1",
         turn_id: "turn-1",
         tool_calls: []
       }}
    end

    assert {:ok, result} =
             CodexSession.send_message("macro-markets", "Quem e vc?", %{view: "board"},
               runner: runner,
               workspace_root: workspace_root
             )

    assert result.assistant_message == "Oi! Eu sou o assistant do projeto Macro Markets."
    assert result.tool_calls == []

    assert_receive {:runner_called, workspace, prompt, issue, opts}
    assert {:ok, expected_workspace} = CodexSession.assistant_workspace("macro-markets", workspace_root: workspace_root)
    assert workspace == expected_workspace
    assert File.dir?(workspace)
    assert prompt =~ "Project assistant for `macro-markets`"
    assert prompt =~ "Current user message:\nQuem e vc?"
    assert prompt =~ "Context:\n%{view: \"board\"}"
    assert issue.identifier == "macro-markets"
    assert issue.id == "assistant:macro-markets"
    assert issue.title == "Project assistant chat"
    assert Keyword.fetch!(opts, :project_slug) == "macro-markets"
    tool_names = opts |> Keyword.fetch!(:dynamic_tools) |> Enum.map(& &1["name"])
    assert "list_issues" in tool_names
    assert "github_graphql" in tool_names
    assert "provision_github_project" in tool_names
    assert is_function(Keyword.fetch!(opts, :tool_executor), 2)

    assert {:ok, messages} = History.list_messages("macro-markets")
    assert Enum.map(messages, & &1.role) == ["user", "assistant"]
    assert Enum.map(messages, & &1.content) == ["Quem e vc?", "Oi! Eu sou o assistant do projeto Macro Markets."]
  end

  test "includes recent conversation history in later turns", %{workspace_root: workspace_root} do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    first_runner = fn _workspace, _prompt, _issue, _opts ->
      {:ok, %{assistant_message: "Oi!", codex_thread_id: "thread-1", turn_id: "turn-1", tool_calls: []}}
    end

    assert {:ok, _result} =
             CodexSession.send_message("macro-markets", "Oi", %{}, runner: first_runner, workspace_root: workspace_root)

    parent = self()

    second_runner = fn _workspace, prompt, _issue, _opts ->
      send(parent, {:second_prompt, prompt})
      {:ok, %{assistant_message: "Eu lembro do seu oi.", codex_thread_id: "thread-1", turn_id: "turn-2", tool_calls: []}}
    end

    assert {:ok, _result} =
             CodexSession.send_message("macro-markets", "Voce lembra?", %{},
               runner: second_runner,
               workspace_root: workspace_root
             )

    assert_receive {:second_prompt, prompt}
    assert prompt =~ "Recent conversation:"
    assert prompt =~ "user: Oi"
    assert prompt =~ "assistant: Oi!"
    assert prompt =~ "Current user message:\nVoce lembra?"
  end

  test "send_message_to_thread/4 runs a freeform turn with project-agnostic tools only" do
    {:ok, thread} = SymphonyElixir.Assistant.History.create_freeform_thread(%{title: "F", workspace_path: tmp_dir()})

    runner = fn _workspace, _prompt, _issue, opts ->
      send(self(), {:opts, opts})
      {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "ct-1", turn_id: "t-1"}}
    end

    assert {:ok, result} =
             SymphonyElixir.Assistant.CodexSession.send_message_to_thread(thread, "hi", %{}, runner: runner)

    assert result.assistant_message == "ok"
    assert_received {:opts, opts}

    tool_names = opts |> Keyword.get(:dynamic_tools) |> Enum.map(& &1["name"])

    assert Enum.at(tool_names, 0) == "list_tracker_projects"
    assert "list_issues" in tool_names
    assert "create_tracker_project" in tool_names
    assert "list_pull_requests" in tool_names
    assert "manage_preview" in tool_names
    assert "list_linear_projects" in tool_names
    assert "list_jira_projects" in tool_names
    assert "create_github_tracker_project" in tool_names
    assert "provision_github_project" in tool_names
    assert "list_github_projects" in tool_names
    assert "get_workflow" in tool_names
    assert "get_template" in tool_names

    assert "list_issues" in tool_names
    assert "get_issue" in tool_names
    assert "read_workspace_file" in tool_names

    assert is_function(Keyword.get(opts, :tool_executor), 2)
  end

  test "send_message_to_thread/4 threads instance codex config for freeform chats" do
    previous = Application.get_env(:symphony_elixir, :codex_approval_policy)

    on_exit(fn ->
      if previous == nil do
        Application.delete_env(:symphony_elixir, :codex_approval_policy)
      else
        Application.put_env(:symphony_elixir, :codex_approval_policy, previous)
      end
    end)

    Application.put_env(:symphony_elixir, :codex_approval_policy, "never")

    {:ok, thread} = SymphonyElixir.Assistant.History.create_freeform_thread(%{title: "F", workspace_path: tmp_dir()})

    runner = fn _workspace, _prompt, _issue, opts ->
      send(self(), {:freeform_opts, opts})
      {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "ct-1", turn_id: "t-1"}}
    end

    assert {:ok, _result} =
             SymphonyElixir.Assistant.CodexSession.send_message_to_thread(thread, "hi", %{}, runner: runner)

    assert_receive {:freeform_opts, opts}
    assert Keyword.get(opts, :codex_config)["approval_policy"] == "never"
  end

  describe "send_message_to_issue_thread/4" do
    setup do
      {:ok, _project} = Context.ensure_project(%{name: "Macro", slug: "macro"})
      {:ok, _issue} = Context.create_issue("macro", %{"title" => "Bound issue", "status" => "Todo"})
      {:ok, _other_issue} = Context.create_issue("macro", %{"title" => "Other issue", "status" => "Todo"})

      thread_workspace = Workspace.path_for_issue("MAC-1")
      File.mkdir_p!(thread_workspace)

      {:ok, thread} = History.ensure_issue_thread("macro", "MAC-1", %{workspace_path: thread_workspace})

      %{thread: thread}
    end

    test "runs the turn in the issue working tree", %{thread: thread} do
      test_pid = self()

      runner = fn workspace, _prompt, _issue, _opts ->
        send(test_pid, {:workspace, workspace})
        {:ok, %{assistant_message: "done", tool_calls: [], codex_thread_id: "ct", turn_id: "t1"}}
      end

      assert {:ok, result} =
               CodexSession.send_message_to_issue_thread(thread, "hi", %{}, runner: runner)

      assert result.assistant_message == "done"
      expected = Workspace.path_for_issue("MAC-1")
      assert_receive {:workspace, ^expected}
    end

    test "resolves the per-project workspace root from the thread project, not the bare identifier" do
      # Mirrors a GitHub-backed project: a per-project workspace root distinct from the
      # global root and no local IssueRecord for the identifier, so identifier-only
      # resolution (find_project_slug/1) returns nil and would fall back to the global
      # root, tripping the coding-agent :invalid_workspace_cwd guard.
      custom_root = Path.join(System.tmp_dir!(), "distrib-workspaces-#{System.unique_integer([:positive])}")
      File.mkdir_p!(custom_root)
      on_exit(fn -> File.rm_rf!(custom_root) end)

      {:ok, _project} = Context.ensure_project(%{name: "Distrib", slug: "distrib"})

      {:ok, _setup} =
        Context.upsert_project_setup("distrib", %{
          workflow_markdown: SymphonyElixir.Workflow.to_markdown(%{"workspace" => %{"root" => custom_root}}, "")
        })

      issue_ref = %{id: nil, identifier: "DIS-1", project_slug: "distrib"}
      expected_root = Workspace.workspace_root_for(issue_ref)
      expected_tree = Workspace.path_for_issue(issue_ref)
      File.mkdir_p!(expected_tree)

      assert expected_root == Path.expand(custom_root)
      assert is_nil(Context.find_project_slug("DIS-1"))

      {:ok, thread} = History.ensure_issue_thread("distrib", "DIS-1", %{workspace_path: expected_tree})

      test_pid = self()

      runner = fn workspace, _prompt, _issue, opts ->
        send(test_pid, {:issue_run, workspace, opts})
        {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "ct", turn_id: "t1"}}
      end

      assert {:ok, _result} = CodexSession.send_message_to_issue_thread(thread, "hi", %{}, runner: runner)

      assert_receive {:issue_run, workspace, opts}
      assert Keyword.get(opts, :workspace_root) == expected_root
      assert String.starts_with?(workspace, expected_root <> "/")
    end

    test "runs the turn in the thread's persisted workspace even when it differs from the computed path",
         %{workspace_root: workspace_root} do
      {:ok, _project} = Context.ensure_project(%{name: "Persist", slug: "persist"})

      persisted = Path.join(workspace_root, "persisted-tree")
      File.mkdir_p!(persisted)

      {:ok, thread} = History.ensure_issue_thread("persist", "PER-1", %{workspace_path: persisted})

      refute persisted == Workspace.path_for_issue("PER-1")

      test_pid = self()

      runner = fn workspace, _prompt, _issue, _opts ->
        send(test_pid, {:workspace, workspace})
        {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "ct", turn_id: "t1"}}
      end

      assert {:ok, _result} =
               CodexSession.send_message_to_issue_thread(thread, "hi", %{}, runner: runner)

      assert_receive {:workspace, ^persisted}
    end

    test "heals a stale out-of-root persisted workspace by recomputing and repairing the thread" do
      {:ok, _project} = Context.ensure_project(%{name: "Heal", slug: "heal"})

      stale = Path.join(System.tmp_dir!(), "outside-root-#{System.unique_integer([:positive])}")

      {:ok, thread} = History.ensure_issue_thread("heal", "HEAL-1", %{workspace_path: stale})

      # Healing recomputes the tree using the thread's project, so the canonical path
      # nests under the project segment even when no local issue record exists.
      issue_ref = %{id: nil, identifier: "HEAL-1", project_slug: "heal"}
      refute stale == Workspace.path_for_issue(issue_ref)

      test_pid = self()

      runner = fn workspace, _prompt, _issue, _opts ->
        send(test_pid, {:workspace, workspace})
        {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "ct", turn_id: "t1"}}
      end

      assert {:ok, _result} =
               CodexSession.send_message_to_issue_thread(thread, "hi", %{}, runner: runner)

      expected = Workspace.path_for_issue(issue_ref)
      assert_receive {:workspace, ^expected}
      assert History.issue_workspace_path("HEAL-1") == expected
    end

    test "uses issue-bound tools, persists messages, updates thread id, and emits callback", %{thread: thread} do
      test_pid = self()

      runner = fn _workspace, _prompt, _issue, opts ->
        send(test_pid, {:runner_opts, opts})

        {:ok,
         %{
           assistant_message: "updated",
           tool_calls: [%{name: "update_issue", status: "complete"}],
           codex_thread_id: "ct",
           turn_id: "t1"
         }}
      end

      callback = fn payload -> send(test_pid, {:message_created, payload}) end

      assert {:ok, result} =
               CodexSession.send_message_to_issue_thread(thread, "hi", %{source: "test"},
                 runner: runner,
                 on_message_created: callback
               )

      assert result.assistant_message == "updated"
      assert result.tool_calls == [%{name: "update_issue", status: "complete"}]
      assert result.codex_thread_id == "ct"
      assert result.turn_id == "t1"
      assert result.user_message.role == "user"
      assert result.user_message.content == "hi"
      assert result.user_message.metadata == %{"source" => "test"}
      assert result.assistant_chat_message.role == "assistant"
      assert result.assistant_chat_message.content == "updated"

      assert_receive {:message_created, %{role: "user", content: "hi"}}
      assert_receive {:runner_opts, opts}

      tool_names = opts |> Keyword.fetch!(:dynamic_tools) |> Enum.map(& &1["name"])
      refute "create_issue" in tool_names
      refute "create_draft_issue" in tool_names
      assert "update_issue" in tool_names

      tool_executor = Keyword.fetch!(opts, :tool_executor)

      assert %{"success" => false, "contentItems" => [%{"text" => error_text}]} =
               tool_executor.("update_issue", %{"identifier" => "MAC-2", "title" => "Wrong"})

      assert error_text =~ "issue_identifier_mismatch"

      persisted_thread = Repo.get!(SymphonyElixir.Assistant.Thread, thread.id)
      assert persisted_thread.codex_thread_id == "ct"

      messages = thread.id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1)
      assert Enum.map(messages, & &1.role) == ["user", "assistant"]
      assert Enum.map(messages, & &1.content) == ["hi", "updated"]
    end

    test "overrides caller-supplied dynamic tools and tool executor for issue safety", %{thread: thread} do
      test_pid = self()
      malicious_executor = fn _tool, _arguments -> %{"success" => true, "toolResult" => %{"tool" => "update_issue"}} end

      runner = fn _workspace, _prompt, _issue, opts ->
        send(test_pid, {:runner_opts, opts})
        {:ok, %{assistant_message: "safe", tool_calls: [], codex_thread_id: "ct", turn_id: "t1"}}
      end

      assert {:ok, _result} =
               CodexSession.send_message_to_issue_thread(thread, "hi", %{},
                 runner: runner,
                 dynamic_tools: ToolExecutor.tool_specs(),
                 tool_executor: malicious_executor
               )

      assert_receive {:runner_opts, opts}

      tool_names = opts |> Keyword.fetch!(:dynamic_tools) |> Enum.map(& &1["name"])
      refute "create_issue" in tool_names
      refute "create_draft_issue" in tool_names

      tool_executor = Keyword.fetch!(opts, :tool_executor)

      assert %{"success" => false, "contentItems" => [%{"text" => error_text}]} =
               tool_executor.("update_issue", %{"identifier" => "MAC-2", "title" => "Wrong"})

      assert error_text =~ "issue_identifier_mismatch"

      assert %{"success" => true, "toolResult" => %{"tool" => "update_issue", "message" => "Updated issue MAC-1."}} =
               tool_executor.("update_issue", %{"title" => "Uses injected identifier"})
    end

    test "threads the project's codex config so its approval policy is honored", %{thread: thread} do
      {:ok, _setup} =
        Context.upsert_project_setup("macro", %{
          workflow_markdown:
            SymphonyElixir.Workflow.to_markdown(
              %{"codex" => %{"approval_policy" => "never", "command" => "codex app-server"}},
              "prompt body"
            )
        })

      test_pid = self()

      runner = fn _workspace, _prompt, _issue, opts ->
        send(test_pid, {:runner_opts, opts})
        {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "ct", turn_id: "t1"}}
      end

      assert {:ok, _result} =
               CodexSession.send_message_to_issue_thread(thread, "hi", %{}, runner: runner)

      assert_receive {:runner_opts, opts}

      assert Keyword.get(opts, :codex_config) == %{
               "approval_policy" => "never",
               "command" => "codex app-server",
               "thread_sandbox" => "workspace-write"
             }
    end

    test "issue authoring prompt defers update_issue during exploration", %{thread: thread} do
      test_pid = self()

      runner = fn _workspace, prompt, _issue, _opts ->
        send(test_pid, {:prompt, prompt})
        {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "ct", turn_id: "t1"}}
      end

      assert {:ok, _result} =
               CodexSession.send_message_to_issue_thread(thread, "explore", %{}, runner: runner)

      assert_receive {:prompt, prompt}
      assert prompt =~ "Do NOT call update_issue during"
      assert prompt =~ "live investigation log"
    end

    test "complex mode injects superpowers methodology into the prompt", %{thread: thread} do
      {:ok, thread} = History.set_mode(thread, "complex")
      test_pid = self()

      runner = fn _workspace, prompt, _issue, _opts ->
        send(test_pid, {:prompt, prompt})
        {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "ct", turn_id: "t1"}}
      end

      assert {:ok, _result} =
               CodexSession.send_message_to_issue_thread(thread, "build X", %{}, runner: runner)

      assert_receive {:prompt, prompt}
      assert prompt =~ "brainstorming"
      assert prompt =~ "docs/superpowers/specs"
      assert prompt =~ "Design-first authoring is desired"
      assert prompt =~ "Codex is a coding agent"
      assert prompt =~ "may proceed directly to code"
      refute prompt =~ "<HARD-GATE>"
      refute prompt =~ "Do not start writing feature code"
    end

    test "brainstorm intent upgrades the thread to complex and loads the methodology skills", %{thread: thread} do
      assert History.thread_mode(thread) == "triage"
      test_pid = self()

      runner = fn _workspace, prompt, _issue, _opts ->
        send(test_pid, {:prompt, prompt})
        {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "ct", turn_id: "t1"}}
      end

      assert {:ok, _result} =
               CodexSession.send_message_to_issue_thread(thread, "vamos fazer um brainstorming", %{}, runner: runner)

      assert_receive {:prompt, prompt}
      assert prompt =~ "MODE: COMPLEX"
      assert prompt =~ "brainstorming"
      assert prompt =~ "docs/superpowers/specs"

      persisted = Repo.get!(SymphonyElixir.Assistant.Thread, thread.id)
      assert History.thread_mode(persisted) == "complex"
    end

    test "plain chat without brainstorm/spec intent stays in triage", %{thread: thread} do
      test_pid = self()

      runner = fn _workspace, prompt, _issue, _opts ->
        send(test_pid, {:prompt, prompt})
        {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "ct", turn_id: "t1"}}
      end

      assert {:ok, _result} =
               CodexSession.send_message_to_issue_thread(thread, "what does this issue cover?", %{}, runner: runner)

      assert_receive {:prompt, prompt}
      assert prompt =~ "MODE: TRIAGE"

      persisted = Repo.get!(SymphonyElixir.Assistant.Thread, thread.id)
      assert History.thread_mode(persisted) == "triage"
    end

    test "issue prompt instructs dispatching through chat via dispatch_codex", %{thread: thread} do
      test_pid = self()

      runner = fn _workspace, prompt, _issue, _opts ->
        send(test_pid, {:prompt, prompt})
        {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "ct", turn_id: "t1"}}
      end

      assert {:ok, _result} =
               CodexSession.send_message_to_issue_thread(thread, "hello", %{}, runner: runner)

      assert_receive {:prompt, prompt}
      assert prompt =~ "dispatch_codex"
      assert prompt =~ "In Progress"
      assert prompt =~ "Never dispatch on your own"
    end

    test "complex prompt instructs writing handoff.md", %{thread: thread} do
      {:ok, thread} = History.set_mode(thread, "complex")
      test_pid = self()

      runner = fn _workspace, prompt, _issue, _opts ->
        send(test_pid, {:prompt, prompt})
        {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "c", turn_id: "t"}}
      end

      assert {:ok, _result} =
               CodexSession.send_message_to_issue_thread(thread, "done", %{}, runner: runner)

      assert_receive {:prompt, prompt}
      prompt_text = String.downcase(prompt)

      assert prompt =~ "docs/superpowers/handoff.md"
      assert prompt =~ "update_issue"
      assert prompt_text =~ "executive summary"
      assert prompt_text =~ "links to the spec/plan files"
      assert prompt_text =~ "spec/plan"
      assert prompt_text =~ "key decisions"
      assert prompt_text =~ "current state"
    end

    test "authoring goal injects an authoring (not dispatch) goal section with the objective",
         %{thread: thread} do
      {:ok, thread} = History.set_goal_mode(thread, true, "Audit the auth module")
      test_pid = self()

      runner = fn _workspace, prompt, _issue, opts ->
        send(test_pid, {:prompt, prompt, opts})
        {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "ct", turn_id: "t1"}}
      end

      assert {:ok, _result} =
               CodexSession.send_message_to_issue_thread(thread, "ship it", %{}, runner: runner)

      assert_receive {:prompt, prompt, opts}
      # Authoring goal runs Codex goal mode directly in the conversation...
      assert prompt =~ "AUTHORING GOAL: ACTIVE"
      assert prompt =~ "Audit the auth module"
      # ...and never frames the turn as an orchestrator dispatch.
      refute prompt =~ "GOAL MODE: ENABLED"
      assert prompt =~ "do NOT dispatch the orchestrator"

      # Codex sessions receive the objective as the native :goal opt.
      if Keyword.get(opts, :agent_kind) in [nil, :codex] do
        assert Keyword.get(opts, :goal) == "Audit the auth module"
      end
    end

    test "authoring goal off omits the authoring goal section and the native goal opt",
         %{thread: thread} do
      test_pid = self()

      runner = fn _workspace, prompt, _issue, opts ->
        send(test_pid, {:prompt, prompt, opts})
        {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "ct", turn_id: "t1"}}
      end

      assert {:ok, _result} =
               CodexSession.send_message_to_issue_thread(thread, "hi", %{}, runner: runner)

      assert_receive {:prompt, prompt, opts}
      refute prompt =~ "AUTHORING GOAL: ACTIVE"
      refute Keyword.has_key?(opts, :goal)
    end

    test "documents_changed fires on_documents_changed when a turn writes a doc", %{thread: thread} do
      test_pid = self()
      ws = Workspace.path_for_issue("MAC-1")

      runner = fn _workspace, _prompt, _issue, _opts ->
        File.mkdir_p!(Path.join([ws, "docs", "superpowers", "specs"]))
        File.write!(Path.join([ws, "docs", "superpowers", "specs", "new.md"]), "# New")
        {:ok, %{assistant_message: "wrote spec", tool_calls: [], codex_thread_id: "c", turn_id: "t"}}
      end

      assert {:ok, _result} =
               CodexSession.send_message_to_issue_thread(thread, "spec it", %{},
                 runner: runner,
                 on_documents_changed: fn id -> send(test_pid, {:docs_changed, id}) end
               )

      assert_receive {:docs_changed, "MAC-1"}
    end

    test "documents_changed fires when an existing doc changes without metadata changes", %{thread: thread} do
      test_pid = self()
      ws = Workspace.path_for_issue("MAC-1")
      specs_dir = Path.join([ws, "docs", "superpowers", "specs"])
      existing_path = Path.join(specs_dir, "existing.md")

      File.mkdir_p!(specs_dir)
      File.write!(existing_path, "# Existing\n\nold")
      fixed_mtime = File.stat!(existing_path).mtime

      runner = fn _workspace, _prompt, _issue, _opts ->
        File.write!(existing_path, "# Existing\n\nnew")
        File.touch!(existing_path, fixed_mtime)
        {:ok, %{assistant_message: "updated spec", tool_calls: [], codex_thread_id: "c", turn_id: "t"}}
      end

      assert {:ok, _result} =
               CodexSession.send_message_to_issue_thread(thread, "revise spec", %{},
                 runner: runner,
                 on_documents_changed: fn id -> send(test_pid, {:docs_changed, id}) end
               )

      assert_receive {:docs_changed, "MAC-1"}
    end

    test "documents_changed does not fire when doc fingerprint is unchanged", %{thread: thread} do
      test_pid = self()

      runner = fn _workspace, _prompt, _issue, _opts ->
        {:ok, %{assistant_message: "no docs", tool_calls: [], codex_thread_id: "c", turn_id: "t"}}
      end

      assert {:ok, _result} =
               CodexSession.send_message_to_issue_thread(thread, "chat only", %{},
                 runner: runner,
                 on_documents_changed: fn id -> send(test_pid, {:docs_changed, id}) end
               )

      refute_receive {:docs_changed, "MAC-1"}, 50
    end
  end

  defp tmp_dir do
    dir = Path.join(System.tmp_dir!(), "symphony-assistant-test-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)
    dir
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
