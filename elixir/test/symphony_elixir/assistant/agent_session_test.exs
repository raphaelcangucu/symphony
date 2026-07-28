defmodule SymphonyElixir.Assistant.AgentSessionPathOwnershipInventory do
  @moduledoc false

  alias SymphonyElixir.Assistant.History

  @spec scan(String.t()) :: {:ok, map()} | {:error, term()}
  def scan(project_slug) do
    case Application.get_env(:symphony_elixir, :agent_session_path_ownership_scan_result) do
      nil -> {:ok, %{workspaces: inventory_entries(project_slug)}}
      result -> result
    end
  end

  defp inventory_entries(project_slug) do
    History.list_threads(project_slug: project_slug, include_archived: true, limit: 100)
    |> Enum.flat_map(fn
      %{scope: "project_session", workspace_path: path} ->
        [entry(path, :project, nil)]

      %{scope: "issue_session", workspace_path: path, issue_identifier: identifier} = thread ->
        kind = if thread.metadata["workspace_kind"] == "isolated", do: :issue_parallel, else: :issue
        [entry(path, kind, identifier)]

      _thread ->
        []
    end)
  end

  defp entry(path, kind, issue_identifier) do
    %{path: path, kind: kind, issue_identifier: issue_identifier, child_worktrees: []}
  end
end

defmodule SymphonyElixir.Assistant.AgentSessionTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias SymphonyElixir.Assistant.{AgentSession, History, Thread, ToolExecutor}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workspace
  alias SymphonyElixir.Workflow

  @fake_codex_app_server Path.expand("../../support/fixtures/fake_codex_app_server.py", __DIR__)
  @inventory_module_env :workspace_display_name_inventory_module
  @inventory_result_env :agent_session_path_ownership_scan_result

  setup do
    migrate_repo()
    clean_repo()
    tmp_dir = Path.join(System.tmp_dir!(), "symphony-assistant-test-#{System.unique_integer([:positive])}")
    File.rm_rf!(tmp_dir)
    File.mkdir_p!(tmp_dir)

    workflow_file = Path.join(tmp_dir, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: tmp_dir)
    Workflow.set_workflow_file_path(workflow_file)
    previous_inventory_module = Application.get_env(:symphony_elixir, @inventory_module_env)
    previous_native_name_setter = Application.get_env(:symphony_elixir, :native_thread_name_setter)

    Application.put_env(:symphony_elixir, :native_thread_name_setter, fn _, _, _, _ -> :ok end)

    Application.put_env(
      :symphony_elixir,
      @inventory_module_env,
      SymphonyElixir.Assistant.AgentSessionPathOwnershipInventory
    )

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      restore_inventory_module(previous_inventory_module)
      restore_native_name_setter(previous_native_name_setter)
      Application.delete_env(:symphony_elixir, @inventory_result_env)
      File.rm_rf!(tmp_dir)
    end)

    %{workspace_root: tmp_dir, workflow_file: workflow_file}
  end

  test "runs the exact project thread and persists a runner reply", %{workspace_root: workspace_root} do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    assert {:ok, expected_workspace} = AgentSession.assistant_workspace("macro-markets", workspace_root: workspace_root)
    File.mkdir_p!(expected_workspace)

    {:ok, thread} =
      History.ensure_thread("macro-markets", %{
        workspace_path: expected_workspace,
        agent_kind: "codex"
      })

    parent = self()

    runner = fn workspace, prompt, issue, opts ->
      send(parent, {:runner_called, workspace, prompt, issue, opts})

      {:ok,
       %{
         assistant_message: "Oi! Eu sou o assistant do projeto Macro Markets.",
         conversation_id: "thread-1",
         run_id: "turn-1",
         tool_calls: []
       }}
    end

    assert {:ok, result} =
             AgentSession.send_message_to_project_thread(thread, "Quem e vc?", %{view: "board"}, runner: runner)

    assert result.assistant_message == "Oi! Eu sou o assistant do projeto Macro Markets."
    assert result.tool_calls == []

    assert_receive {:runner_called, workspace, prompt, issue, opts}
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
    {:ok, workspace} = AgentSession.assistant_workspace("macro-markets", workspace_root: workspace_root)
    File.mkdir_p!(workspace)
    {:ok, thread} = History.ensure_thread("macro-markets", %{workspace_path: workspace, agent_kind: "codex"})

    first_runner = fn _workspace, _prompt, _issue, _opts ->
      {:ok, %{assistant_message: "Oi!", conversation_id: "thread-1", run_id: "turn-1", tool_calls: []}}
    end

    assert {:ok, _result} =
             AgentSession.send_message_to_project_thread(thread, "Oi", %{}, runner: first_runner)

    parent = self()

    second_runner = fn _workspace, prompt, _issue, _opts ->
      send(parent, {:second_prompt, prompt})
      {:ok, %{assistant_message: "Eu lembro do seu oi.", conversation_id: "thread-1", run_id: "turn-2", tool_calls: []}}
    end

    assert {:ok, _result} =
             AgentSession.send_message_to_project_thread(thread, "Voce lembra?", %{}, runner: second_runner)

    assert_receive {:second_prompt, prompt}
    assert prompt =~ "Recent conversation:"
    assert prompt =~ "user: Oi"
    assert prompt =~ "assistant: Oi!"
    assert prompt =~ "Current user message:\nVoce lembra?"
  end

  test "legacy project send refuses to resolve or create a thread" do
    {:ok, _project} = Context.ensure_project(%{name: "Exact", slug: "exact-project"})

    assert {:error, :assistant_thread_required} =
             AgentSession.send_message("exact-project", "hello", %{}, runner: fn _, _, _, _ -> flunk() end)

    refute Repo.get_by(Thread, project_slug: "exact-project", scope: "project", status: "active")
  end

  test "send_message_to_thread/4 heals freeform workspace outside the current workspace root" do
    stale = Path.join(System.tmp_dir!(), "stale-freeform-#{System.unique_integer([:positive])}")
    File.mkdir_p!(stale)

    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "Stale freeform",
        workspace_path: stale,
        metadata: %{"gateway_binding_id" => 42}
      })

    runner = fn workspace, _prompt, _issue, _opts ->
      send(self(), {:workspace, workspace})
      {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct-1", run_id: "t-1"}}
    end

    assert {:ok, _result} =
             AgentSession.send_message_to_thread(thread, "hi", %{}, runner: runner)

    expected = AgentSession.freeform_workspace(42)
    assert_received {:workspace, ^expected}

    {:ok, updated} = History.get_thread(thread.id)
    assert updated.workspace_path == expected
  end

  test "send_message_to_thread/4 runs a freeform turn with project-agnostic tools only" do
    {:ok, thread} = History.create_freeform_thread(%{title: "F", workspace_path: tmp_dir()})

    runner = fn _workspace, _prompt, _issue, opts ->
      send(self(), {:opts, opts})
      {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct-1", run_id: "t-1"}}
    end

    assert {:ok, result} =
             AgentSession.send_message_to_thread(thread, "hi", %{}, runner: runner)

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
    assert "goal" in tool_names

    assert is_function(Keyword.get(opts, :tool_executor), 2)
    assert Keyword.get(opts, :assistant_thread_id) == thread.id
    assert Keyword.fetch!(opts, :thread_name) == "F"
  end

  test "each persistent scope binds its exact thread into the goal ToolExecutor", %{
    workspace_root: workspace_root,
    workflow_file: workflow_file
  } do
    workflow_file
    |> File.read!()
    |> String.replace("codex:\n", "codex:\n  goals_enabled: true\n", global: false)
    |> then(&File.write!(workflow_file, &1))

    {:ok, project} = Context.ensure_project(%{name: "Routing", slug: "goal-routing"})
    {:ok, issue_one} = Context.create_issue(project.slug, %{"title" => "One", "status" => "Todo"})
    {:ok, issue_two} = Context.create_issue(project.slug, %{"title" => "Two", "status" => "Todo"})

    create_thread = fn scope, workspace, issue_identifier ->
      File.mkdir_p!(workspace)

      attrs = %{
        scope: scope,
        status: "active",
        workspace_path: workspace,
        agent_kind: "codex",
        project_slug: if(scope == "freeform", do: nil, else: project.slug),
        issue_identifier: issue_identifier
      }

      {:ok, thread} = %Thread{} |> Thread.changeset(attrs) |> Repo.insert()
      thread
    end

    project_workspace = Path.join(workspace_root, "project")
    File.mkdir_p!(project_workspace)
    {:ok, project_thread} = History.ensure_thread(project.slug, %{workspace_path: project_workspace})

    threads = [
      project_thread,
      create_thread.("project_session", Path.join([workspace_root, project.slug, "project-session"]), nil),
      create_thread.("project_explore", Path.join(workspace_root, "project-explore"), nil),
      create_thread.("freeform", Path.join(workspace_root, "freeform"), nil),
      create_thread.("issue", Workspace.path_for_issue(issue_one), issue_one.identifier),
      create_thread.("issue_session", Workspace.path_for_issue(issue_two), issue_two.identifier),
      create_thread.("kb", Path.join(workspace_root, "kb"), nil)
    ]

    Enum.each(threads, fn thread ->
      objective = "Exact objective for #{thread.scope}"
      test_pid = self()

      runner = fn _workspace, _prompt, _issue, opts ->
        executor = Keyword.fetch!(opts, :tool_executor)

        send(
          test_pid,
          {:goal_result, thread.id,
           executor.("goal", %{
             "action" => "set_objective",
             "context" => "authoring",
             "objective" => objective
           })}
        )

        {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct-#{thread.id}", run_id: "turn"}}
      end

      result =
        case thread.scope do
          "project" ->
            AgentSession.send_message_to_project_thread(thread, "route", %{}, runner: runner)

          scope when scope in ["project_session", "project_explore"] ->
            AgentSession.send_message_to_project_explore_thread(thread, "route", %{}, runner: runner)

          "freeform" ->
            AgentSession.send_message_to_thread(thread, "route", %{}, runner: runner)

          scope when scope in ["issue", "issue_session"] ->
            AgentSession.send_message_to_issue_thread(thread, "route", %{}, runner: runner)

          "kb" ->
            AgentSession.send_message_to_kb_thread(thread, "route", %{}, runner: runner)
        end

      assert {:ok, _result} = result
      assert_receive {:goal_result, thread_id, %{"success" => true}}
      assert thread_id == thread.id
      assert {:ok, updated} = History.get_thread(thread.id)
      assert History.thread_goal_objective(updated) == objective
    end)
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

    {:ok, thread} = History.create_freeform_thread(%{title: "F", workspace_path: tmp_dir()})

    runner = fn _workspace, _prompt, _issue, opts ->
      send(self(), {:freeform_opts, opts})
      {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct-1", run_id: "t-1"}}
    end

    assert {:ok, _result} =
             AgentSession.send_message_to_thread(thread, "hi", %{}, runner: runner)

    assert_receive {:freeform_opts, opts}
    assert Keyword.get(opts, :codex_config)["approval_policy"] == "never"
  end

  test "send_message_to_thread/4 forwards the persisted Codex thread for resume" do
    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "Resume Codex",
        workspace_path: tmp_dir(),
        agent_kind: "codex"
      })

    {:ok, ref} =
      SymphonyElixir.Agent.ConversationRef.new("codex", "codex-thread-existing")

    {:ok, thread} = History.put_conversation_ref(thread, ref)
    test_pid = self()

    Application.put_env(:symphony_elixir, :native_thread_name_setter, fn _, thread_id, name, _ ->
      send(test_pid, {:native_name_retried, thread_id, name})
      :ok
    end)

    runner = fn _workspace, _prompt, _issue, opts ->
      assert_receive {:native_name_retried, "codex-thread-existing", "Resume Codex"}
      send(self(), {:resume_opts, opts})
      {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "codex-thread-existing", run_id: "t-2"}}
    end

    assert {:ok, result} =
             AgentSession.send_message_to_thread(thread, "continue", %{}, runner: runner)

    assert_receive {:resume_opts, opts}

    assert opts[:conversation_ref] == %SymphonyElixir.Agent.ConversationRef{
             provider: "codex",
             conversation_id: "codex-thread-existing"
           }

    refute Keyword.has_key?(opts, :resume_thread_id)
    refute Keyword.has_key?(opts, :agent_thread_id)
    refute Keyword.has_key?(opts, :thread_name)
    assert result.provider == "codex"
    assert result.conversation_id == "codex-thread-existing"
    assert result.run_id == "t-2"
    assert_receive {:native_name_retried, "codex-thread-existing", "Resume Codex"}
  end

  test "send_message_to_thread/4 resumes and persists Claude through the generic conversation contract" do
    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "Resume Claude",
        workspace_path: tmp_dir(),
        agent_kind: "claude"
      })

    {:ok, ref} =
      SymphonyElixir.Agent.ConversationRef.new("claude", "claude-session-existing")

    {:ok, thread} = History.put_conversation_ref(thread, ref)

    runner = fn _workspace, _prompt, _issue, opts ->
      send(self(), {:claude_resume_opts, opts})

      {:ok,
       %{
         assistant_message: "ok",
         tool_calls: [],
         conversation_id: "claude-session-updated",
         run_id: "claude-run-2"
       }}
    end

    assert {:ok, result} =
             AgentSession.send_message_to_thread(
               thread,
               "continue",
               %{"agent" => "claude"},
               runner: runner
             )

    assert_receive {:claude_resume_opts, opts}

    assert opts[:conversation_ref] == %SymphonyElixir.Agent.ConversationRef{
             provider: "claude",
             conversation_id: "claude-session-existing"
           }

    refute Keyword.has_key?(opts, :resume_thread_id)
    assert result.provider == "claude"
    assert result.conversation_id == "claude-session-updated"
    assert result.run_id == "claude-run-2"

    assert {:ok, persisted} = History.get_thread(thread.id)
    assert {:ok, ref} = History.conversation_ref(persisted, "claude")
    assert ref.conversation_id == "claude-session-updated"
  end

  test "reconciles the latest canonical title after persisting a fresh Codex thread id" do
    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "Initial title",
        workspace_path: tmp_dir(),
        agent_kind: "codex"
      })

    test_pid = self()

    Application.put_env(:symphony_elixir, :native_thread_name_setter, fn _, thread_id, name, _ ->
      send(test_pid, {:native_name_set, thread_id, name})
      :ok
    end)

    runner = fn _workspace, _prompt, _issue, _opts ->
      assert {:ok, _renamed} =
               History.update_thread_sidebar_metadata(thread.id, %{title: "Latest title"})

      {:ok,
       %{
         assistant_message: "ok",
         tool_calls: [],
         conversation_id: "codex-thread-fresh",
         run_id: "t-1"
       }}
    end

    assert {:ok, _result} =
             AgentSession.send_message_to_thread(thread, "hi", %{}, runner: runner)

    assert_receive {:native_name_set, "codex-thread-fresh", "Latest title"}
  end

  test "reconciles a replacement Codex thread returned after a stale resume id" do
    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "Replacement title",
        workspace_path: tmp_dir(),
        agent_kind: "codex"
      })

    {:ok, ref} =
      SymphonyElixir.Agent.ConversationRef.new("codex", "codex-thread-stale")

    {:ok, thread} = History.put_conversation_ref(thread, ref)
    test_pid = self()

    Application.put_env(:symphony_elixir, :native_thread_name_setter, fn _, thread_id, name, _ ->
      send(test_pid, {:replacement_name_set, thread_id, name})
      :ok
    end)

    runner = fn _workspace, _prompt, _issue, opts ->
      assert opts[:conversation_ref] == %SymphonyElixir.Agent.ConversationRef{
               provider: "codex",
               conversation_id: "codex-thread-stale"
             }

      refute Keyword.has_key?(opts, :resume_thread_id)
      refute Keyword.has_key?(opts, :agent_thread_id)
      refute Keyword.has_key?(opts, :thread_name)
      assert_receive {:replacement_name_set, "codex-thread-stale", "Replacement title"}

      {:ok,
       %{
         assistant_message: "ok",
         tool_calls: [],
         conversation_id: "codex-thread-replacement",
         run_id: "t-replacement"
       }}
    end

    assert {:ok, _result} =
             AgentSession.send_message_to_thread(thread, "continue", %{}, runner: runner)

    assert_receive {:replacement_name_set, "codex-thread-replacement", "Replacement title"}
  end

  test "send_message_to_thread/4 ignores malformed Codex stream payloads without crashing", %{workspace_root: workspace_root} do
    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "F",
        workspace_path: Path.join(workspace_root, "raw-stream")
      })

    assert {:ok, result} =
             AgentSession.send_message_to_thread(
               thread,
               "hi",
               %{"agent" => "codex"},
               codex_config: %{
                 "command" => "python3 #{@fake_codex_app_server}",
                 "approval_policy" => "never",
                 "thread_sandbox" => "danger-full-access"
               },
               dynamic_tools: [],
               workspace_root: workspace_root
             )

    assert result.assistant_message == "ok"
  end

  test "default Codex runner keeps the composed prompt out of the visible user message", %{
    workspace_root: workspace_root
  } do
    trace_file = Path.join(workspace_root, "codex-visible-input.jsonl")

    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "Telegram session",
        workspace_path: Path.join(workspace_root, "telegram-session")
      })

    assert {:ok, result} =
             AgentSession.send_message_to_thread(
               thread,
               "Reinicie o codex remoto por favor",
               %{"agent" => "codex", "source" => "telegram"},
               codex_config: %{
                 "command" => "FAKE_CODEX_TRACE=#{trace_file} python3 #{@fake_codex_app_server}",
                 "approval_policy" => "never",
                 "thread_sandbox" => "danger-full-access"
               },
               dynamic_tools: [],
               workspace_root: workspace_root
             )

    assert result.assistant_message == "ok"

    messages =
      trace_file
      |> File.read!()
      |> String.split("\n", trim: true)
      |> Enum.map(&Jason.decode!/1)

    thread_start = Enum.find(messages, &(&1["method"] == "thread/start"))
    turn_start = Enum.find(messages, &(&1["method"] == "turn/start"))

    assert thread_start["params"]["developerInstructions"] =~
             "You are the Symphony freeform assistant."

    assert turn_start["params"]["input"] == [
             %{"type" => "text", "text" => "Reinicie o codex remoto por favor"}
           ]

    assert {:ok, _result} =
             AgentSession.send_message_to_thread(
               thread,
               "Qual foi o resultado?",
               %{"agent" => "codex", "source" => "telegram"},
               codex_config: %{
                 "command" => "FAKE_CODEX_TRACE=#{trace_file} python3 #{@fake_codex_app_server}",
                 "approval_policy" => "never",
                 "thread_sandbox" => "danger-full-access"
               },
               dynamic_tools: [],
               workspace_root: workspace_root
             )

    resumed_messages =
      trace_file
      |> File.read!()
      |> String.split("\n", trim: true)
      |> Enum.map(&Jason.decode!/1)

    thread_resume = Enum.find(resumed_messages, &(&1["method"] == "thread/resume"))
    resumed_turn = resumed_messages |> Enum.filter(&(&1["method"] == "turn/start")) |> List.last()

    assert thread_resume["params"]["developerInstructions"] =~
             "Recent conversation:\nuser: Reinicie o codex remoto por favor"

    assert resumed_turn["params"]["input"] == [
             %{"type" => "text", "text" => "Qual foi o resultado?"}
           ]
  end

  test "default Codex runner persists and reloads text tool text order", %{workspace_root: workspace_root} do
    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "Ordered timeline",
        workspace_path: Path.join(workspace_root, "ordered-timeline")
      })

    test_pid = self()

    assert {:ok, result} =
             AgentSession.send_message_to_thread(
               thread,
               "show ordered activity",
               %{"agent" => "codex"},
               codex_config: %{
                 "command" => "FAKE_CODEX_ORDERED_TIMELINE=1 python3 #{@fake_codex_app_server}",
                 "approval_policy" => "never",
                 "thread_sandbox" => "danger-full-access"
               },
               dynamic_tools: [],
               workspace_root: workspace_root,
               on_tool_call_started: fn tool_call -> send(test_pid, {:tool_started, tool_call}) end,
               on_tool_call_completed: fn tool_call -> send(test_pid, {:tool_completed, tool_call}) end
             )

    assert result.assistant_message == " \nBefore after"

    assert [
             %{id: "provider-shell-1", name: "shell", status: "complete"},
             %{id: "dynamic-tool-request-1", name: "missing_dynamic_tool", status: "error"}
           ] = result.tool_calls

    assert_received {:tool_started, %{id: "provider-shell-1", status: "running"}}
    assert_received {:tool_completed, %{id: "provider-shell-1", status: "complete"}}
    assert_received {:tool_started, %{id: "dynamic-tool-request-1", status: "running"}}
    assert_received {:tool_completed, %{id: "dynamic-tool-request-1", status: "error"}}

    expected_blocks = [
      %{"type" => "text", "text" => " \nBefore "},
      %{"type" => "tool", "tool_call_id" => "provider-shell-1"},
      %{"type" => "tool", "tool_call_id" => "dynamic-tool-request-1"},
      %{"type" => "text", "text" => "after"}
    ]

    assistant_payload =
      thread.id
      |> History.list_messages_for_thread()
      |> List.last()
      |> History.message_payload()

    assert assistant_payload.content_blocks == expected_blocks
    assert assistant_payload.metadata["content_blocks"] == expected_blocks
  end

  test "does not persist runner content blocks that disagree with content and tool calls", %{
    workspace_root: workspace_root
  } do
    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "Mismatched runner blocks",
        workspace_path: Path.join(workspace_root, "mismatched-runner-blocks")
      })

    runner = fn _workspace, _prompt, _issue, _opts ->
      {:ok,
       %{
         assistant_message: "Actual",
         tool_calls: [%{id: "tool-1", name: "list_issues", status: "complete"}],
         content_blocks: [
           %{"type" => "text", "text" => "Wrong"},
           %{"type" => "tool", "tool_call_id" => "tool-1"}
         ],
         conversation_id: "thread-mismatch",
         run_id: "turn-mismatch"
       }}
    end

    assert {:ok, result} =
             AgentSession.send_message_to_thread(
               thread,
               "persist safely",
               %{"agent" => "codex"},
               runner: runner
             )

    assert result.assistant_chat_message.content_blocks == []
    refute Map.has_key?(result.assistant_chat_message.metadata, "content_blocks")
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
        {:ok, %{assistant_message: "done", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, result} =
               AgentSession.send_message_to_issue_thread(thread, "hi", %{}, runner: runner)

      assert result.assistant_message == "done"
      expected = Workspace.path_for_issue("MAC-1")
      assert_receive {:workspace, ^expected}
    end

    test "normalizes Cursor requested effort to the model slug invariant", %{thread: thread} do
      runner = fn _workspace, _prompt, _issue, _opts ->
        {:ok,
         %{
           assistant_message: "done",
           tool_calls: [],
           conversation_id: "cursor-session",
           run_id: "cursor-turn",
           resolved_model: "cursor-grok-4.5-high"
         }}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(
                 thread,
                 "hi",
                 %{
                   "agent" => "cursor",
                   "model" => "cursor-grok-4.5-high",
                   "effort" => "high"
                 },
                 runner: runner
               )

      persisted = Repo.get!(Thread, thread.id)
      assert persisted.requested_model == "cursor-grok-4.5-high"
      assert persisted.requested_effort == nil
      assert persisted.resolved_model == "cursor-grok-4.5-high"
      assert persisted.resolved_effort == nil
    end

    test "runs the turn for an issue_session-scoped thread" do
      thread_workspace = Workspace.path_for_issue("MAC-1")
      File.mkdir_p!(thread_workspace)

      {:ok, session_thread} =
        History.create_issue_session_thread("macro", "MAC-1", %{
          title: "Build pass",
          execution_mode: "yolo",
          workspace_path: thread_workspace,
          agent_kind: "claude",
          model: "claude-opus-5",
          effort: "high"
        })

      assert session_thread.scope == "issue_session"

      test_pid = self()

      runner = fn workspace, _prompt, _issue, opts ->
        send(test_pid, {:session_workspace, workspace, opts})
        {:ok, %{assistant_message: "ack", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, result} =
               AgentSession.send_message_to_issue_thread(session_thread, "oi", %{}, runner: runner)

      assert result.assistant_message == "ack"
      assert_receive {:session_workspace, ^thread_workspace, opts}
      assert opts[:model] == "claude-opus-5"
      assert opts[:effort] == "high"
    end

    test "revalidates an explicit issue session before every runner invocation", %{
      workspace_root: workspace_root
    } do
      thread_workspace = Workspace.path_for_issue("MAC-1")
      File.mkdir_p!(thread_workspace)

      {:ok, session_thread} =
        History.create_issue_workspace_session_thread(
          "macro",
          "MAC-1",
          thread_workspace,
          %{workspace_kind: "shared", agent_kind: "codex"}
        )

      test_pid = self()

      runner = fn workspace, _prompt, _issue, _opts ->
        send(test_pid, {:explicit_session_runner, workspace})
        {:ok, %{assistant_message: "ack", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(session_thread, "valid", %{}, runner: runner)

      assert_receive {:explicit_session_runner, ^thread_workspace}

      outside = Path.join(workspace_root, "outside-session")
      File.mkdir_p!(outside)
      File.rm_rf!(thread_workspace)
      File.ln_s!(outside, thread_workspace)

      assert {:error, {:authoring_goal_unavailable, :workspace_not_executable}} =
               AgentSession.send_message_to_issue_thread(session_thread, "blocked", %{}, runner: runner)

      refute_receive {:explicit_session_runner, _workspace}
      assert File.lstat!(thread_workspace).type == :symlink
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
        {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, _result} = AgentSession.send_message_to_issue_thread(thread, "hi", %{}, runner: runner)

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
        {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(thread, "hi", %{}, runner: runner)

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
        {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(thread, "hi", %{}, runner: runner)

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
           conversation_id: "ct",
           run_id: "t1",
           resolved_model: "gpt-5.6-sol",
           resolved_effort: "low"
         }}
      end

      callback = fn payload -> send(test_pid, {:message_created, payload}) end

      assert {:ok, result} =
               AgentSession.send_message_to_issue_thread(thread, "hi", %{source: "test"},
                 runner: runner,
                 on_message_created: callback
               )

      assert result.assistant_message == "updated"
      assert result.tool_calls == [%{name: "update_issue", status: "complete"}]
      assert result.provider == "codex"
      assert result.conversation_id == "ct"
      assert result.run_id == "t1"
      assert result.user_message.role == "user"
      assert result.user_message.content == "hi"
      assert result.user_message.metadata == %{"source" => "test"}
      assert result.assistant_chat_message.role == "assistant"
      assert result.assistant_chat_message.content == "updated"

      assert_receive {:message_created, %{role: "user", content: "hi"}}
      assert_receive {:runner_opts, opts}

      tool_names = opts |> Keyword.fetch!(:dynamic_tools) |> Enum.map(& &1["name"])
      assert "create_issue" in tool_names
      assert "create_draft_issue" in tool_names
      assert "update_issue" in tool_names
      assert "manage_preview" in tool_names
      assert "list_previews" in tool_names

      tool_executor = Keyword.fetch!(opts, :tool_executor)

      assert %{"success" => false, "contentItems" => [%{"text" => error_text}]} =
               tool_executor.("update_issue", %{"identifier" => "MAC-2", "title" => "Wrong"})

      assert error_text =~ "issue_identifier_mismatch"

      persisted_thread = Repo.get!(SymphonyElixir.Assistant.Thread, thread.id)
      assert persisted_thread.provider_bindings["codex"] == "ct"
      assert persisted_thread.resolved_model == "gpt-5.6-sol"
      assert persisted_thread.resolved_effort == "low"

      messages = thread.id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1)
      assert Enum.map(messages, & &1.role) == ["user", "assistant"]
      assert Enum.map(messages, & &1.content) == ["hi", "updated"]

      legacy_runner_payload = List.last(messages)
      assert legacy_runner_payload.content_blocks == []
      refute Map.has_key?(legacy_runner_payload.metadata, "content_blocks")
    end

    test "overrides caller-supplied dynamic tools and tool executor for issue safety", %{thread: thread} do
      test_pid = self()
      malicious_executor = fn _tool, _arguments -> %{"success" => true, "toolResult" => %{"tool" => "update_issue"}} end

      runner = fn _workspace, _prompt, _issue, opts ->
        send(test_pid, {:runner_opts, opts})
        {:ok, %{assistant_message: "safe", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(thread, "hi", %{},
                 runner: runner,
                 dynamic_tools: ToolExecutor.tool_specs(),
                 tool_executor: malicious_executor
               )

      assert_receive {:runner_opts, opts}

      tool_names = opts |> Keyword.fetch!(:dynamic_tools) |> Enum.map(& &1["name"])
      assert "create_issue" in tool_names
      assert "create_draft_issue" in tool_names

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
        {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(thread, "hi", %{}, runner: runner)

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
        {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(thread, "explore", %{}, runner: runner)

      assert_receive {:prompt, prompt}
      assert prompt =~ "Do NOT call update_issue during"
      assert prompt =~ "live investigation log"
    end

    test "issue prompt includes planning methodology by default", %{thread: thread} do
      test_pid = self()

      runner = fn _workspace, prompt, _issue, _opts ->
        send(test_pid, {:prompt, prompt})
        {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(thread, "build X", %{}, runner: runner)

      assert_receive {:prompt, prompt}
      assert prompt =~ "MODE: PLAN"
      assert prompt =~ "brainstorming"
      assert prompt =~ "docs/superpowers/specs"
      assert prompt =~ "choose a git repository"
      assert prompt =~ "Never write to the workspace-root"
      assert prompt =~ "choose depth from the conversation"
      refute prompt =~ "MODE: COMPLEX"
      refute prompt =~ "MODE: SIMPLE"
      refute prompt =~ "MODE: TRIAGE"
      refute prompt =~ "<HARD-GATE>"
      refute prompt =~ "Do not start writing feature code"
    end

    test "build mode prompt authorizes real implementation in session", %{thread: thread} do
      test_pid = self()

      runner = fn _workspace, prompt, _issue, _opts ->
        send(test_pid, {:prompt, prompt})
        {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(
                 thread,
                 "implement the plan",
                 %{"execution_mode" => "build"},
                 runner: runner
               )

      assert_receive {:prompt, prompt}
      assert prompt =~ "MODE: BUILD"
      assert prompt =~ "Exit plan mode"
      assert prompt =~ "Implement in this session"
      assert prompt =~ "test-driven-development"
      refute prompt =~ "MODE: PLAN (read-only)"
      refute prompt =~ "authoring only"
    end

    test "pinned debugging toolkit stays independent from yolo mode", %{thread: thread} do
      test_pid = self()

      runner = fn _workspace, prompt, _issue, _opts ->
        send(test_pid, {:prompt, prompt})
        {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(
                 thread,
                 "debug this",
                 %{"execution_mode" => "yolo", "skill_profile" => "debugging"},
                 runner: runner
               )

      assert_receive {:prompt, prompt}
      assert prompt =~ "MODE: YOLO"
      assert prompt =~ "Skill toolkit: `debugging`"
      assert prompt =~ "systematic-debugging"
    end

    test "brainstorm messages load methodology without persisting a mode", %{thread: thread} do
      test_pid = self()

      runner = fn _workspace, prompt, _issue, _opts ->
        send(test_pid, {:prompt, prompt})
        {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(thread, "vamos fazer um brainstorming", %{}, runner: runner)

      assert_receive {:prompt, prompt}
      assert prompt =~ "brainstorming"
      assert prompt =~ "docs/superpowers/specs"
      assert prompt =~ "choose a git repository"
      refute prompt =~ "MODE: COMPLEX"
    end

    test "plain chat includes unified planning guidance", %{thread: thread} do
      test_pid = self()

      runner = fn _workspace, prompt, _issue, _opts ->
        send(test_pid, {:prompt, prompt})
        {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(thread, "what does this issue cover?", %{}, runner: runner)

      assert_receive {:prompt, prompt}
      assert prompt =~ "choose depth from the conversation"
      refute prompt =~ "MODE: TRIAGE"
    end

    test "issue prompt instructs dispatching through chat via dispatch_codex", %{thread: thread} do
      test_pid = self()

      runner = fn _workspace, prompt, _issue, _opts ->
        send(test_pid, {:prompt, prompt})
        {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(thread, "hello", %{}, runner: runner)

      assert_receive {:prompt, prompt}
      assert prompt =~ "dispatch_codex"
      assert prompt =~ "In Progress"
      assert prompt =~ "Never dispatch on your own"
    end

    test "issue prompt instructs writing handoff.md when appropriate", %{thread: thread} do
      test_pid = self()

      runner = fn _workspace, prompt, _issue, _opts ->
        send(test_pid, {:prompt, prompt})
        {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "c", run_id: "t"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(thread, "done", %{}, runner: runner)

      assert_receive {:prompt, prompt}
      prompt_text = String.downcase(prompt)

      assert prompt =~ "docs/superpowers/handoff.md"
      assert prompt =~ "update_issue"
      assert prompt_text =~ "executive summary"
      assert prompt_text =~ "links to spec/plan"
      assert prompt_text =~ "spec/plan"
      assert prompt_text =~ "key decisions"
      assert prompt_text =~ "current state"
    end

    test "authoring goal injects an authoring (not dispatch) goal section with the objective",
         %{thread: thread} do
      {:ok, thread} = History.set_thread_agent(thread, "codex")
      {:ok, thread} = History.set_goal_mode(thread, true, "Audit the auth module")
      test_pid = self()

      runner = fn _workspace, prompt, _issue, opts ->
        send(test_pid, {:prompt, prompt, opts})
        {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(thread, "ship it", %{}, runner: runner)

      assert_receive {:prompt, prompt, opts}
      # Chat goal runs Codex goal mode directly in the conversation...
      assert prompt =~ "CHAT GOAL: ACTIVE"
      assert prompt =~ "Audit the auth module"
      # ...and never frames the turn as an orchestrator dispatch.
      refute prompt =~ "GOAL MODE: ENABLED"
      assert prompt =~ "Do NOT dispatch the orchestrator"

      # Codex sessions receive the objective as the native :goal opt. agent_kind
      # arrives as the string "codex" from AgentPreference.normalize/1, so the
      # injection guard must accept the string form (regression: comparing only
      # against the :codex atom silently skipped injection).
      assert Keyword.get(opts, :agent_kind) in [nil, "codex", :codex]
      assert Keyword.get(opts, :goal) == "Audit the auth module"
    end

    test "authoring goal off omits the authoring goal section and the native goal opt",
         %{thread: thread} do
      test_pid = self()

      runner = fn _workspace, prompt, _issue, opts ->
        send(test_pid, {:prompt, prompt, opts})
        {:ok, %{assistant_message: "ok", tool_calls: [], conversation_id: "ct", run_id: "t1"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(thread, "hi", %{}, runner: runner)

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
        {:ok, %{assistant_message: "wrote spec", tool_calls: [], conversation_id: "c", run_id: "t"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(thread, "spec it", %{},
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
        {:ok, %{assistant_message: "updated spec", tool_calls: [], conversation_id: "c", run_id: "t"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(thread, "revise spec", %{},
                 runner: runner,
                 on_documents_changed: fn id -> send(test_pid, {:docs_changed, id}) end
               )

      assert_receive {:docs_changed, "MAC-1"}
    end

    test "documents_changed does not fire when doc fingerprint is unchanged", %{thread: thread} do
      test_pid = self()

      runner = fn _workspace, _prompt, _issue, _opts ->
        {:ok, %{assistant_message: "no docs", tool_calls: [], conversation_id: "c", run_id: "t"}}
      end

      assert {:ok, _result} =
               AgentSession.send_message_to_issue_thread(thread, "chat only", %{},
                 runner: runner,
                 on_documents_changed: fn id -> send(test_pid, {:docs_changed, id}) end
               )

      refute_receive {:docs_changed, "MAC-1"}, 50
    end
  end

  test "goal continuation rejects a project session absent from current inventory", %{
    workspace_root: workspace_root
  } do
    {:ok, _project} = Context.ensure_project(%{name: "Goal Session", slug: "goal-session"})
    workspace_path = Path.join([workspace_root, "goal-session", "workspace"])
    File.mkdir_p!(workspace_path)

    {:ok, thread} =
      History.create_workspace_session_thread("goal-session", workspace_path, %{
        agent_kind: "codex"
      })

    {:ok, thread} = History.set_goal_mode(thread, true, "Continue safely")
    Application.put_env(:symphony_elixir, @inventory_result_env, {:ok, %{workspaces: []}})

    assert {:error, {:authoring_goal_unavailable, :workspace_not_executable}} =
             AgentSession.continue_thread_goal(
               thread,
               %{},
               runner: fn _workspace, _prompt, _issue, _opts -> flunk("runner must not be called") end
             )
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

  defp restore_inventory_module(nil),
    do: Application.delete_env(:symphony_elixir, @inventory_module_env)

  defp restore_inventory_module(module),
    do: Application.put_env(:symphony_elixir, @inventory_module_env, module)

  defp restore_native_name_setter(nil),
    do: Application.delete_env(:symphony_elixir, :native_thread_name_setter)

  defp restore_native_name_setter(setter),
    do: Application.put_env(:symphony_elixir, :native_thread_name_setter, setter)

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
      SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end
end
