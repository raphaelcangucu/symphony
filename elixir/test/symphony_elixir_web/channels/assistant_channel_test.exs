defmodule SymphonyElixirWeb.AssistantChannelTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.TestSupport
  alias SymphonyElixir.Workflow
  alias SymphonyElixir.Workspace

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous_token = System.get_env(@token_env)
    previous_runner = Application.get_env(:symphony_elixir, :assistant_runner)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      restore_app_env(:assistant_runner, previous_runner)
    end)

    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    socket = socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
    {:ok, socket: socket}
  end

  test "joins assistant topic, streams a turn, and replays persisted history" do
    runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_assistant_delta).("Oi")

      {:ok,
       %{
         assistant_message: "Oi! Sou o assistant do projeto.",
         codex_thread_id: "thread-1",
         turn_id: "turn-1",
         tool_calls: []
       }}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)

    {:ok, %{messages: []}, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

    assert_push("history_loaded", %{messages: []})

    ref = push(socket, "send_message", %{"message" => "Oi", "context" => %{"view" => "board"}})
    assert_reply(ref, :ok, %{})

    assert_push("message_created", %{message: %{role: "user", content: "Oi"}})
    assert_push("assistant_delta", %{delta: "Oi"})
    assert_push("assistant_completed", %{message: %{role: "assistant", content: "Oi! Sou o assistant do projeto."}})

    {:ok, %{messages: messages}, _socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

    assert Enum.map(messages, & &1.role) == ["user", "assistant"]
  end

  test "project draft issue turn promotes the chat in place to the issue thread without leaving an orphan" do
    Application.put_env(:symphony_elixir, :assistant_runner, fn _workspace, _prompt, _issue, _opts ->
      {:ok,
       %{
         assistant_message: "Drafted MAC-7 for billing work.",
         turn_id: "turn-draft-7",
         tool_calls: [
           %{
             name: "create_draft_issue",
             status: "complete",
             result: %{
               tool: "create_draft_issue",
               data: %{identifier: "MAC-7", title: "Billing work"}
             }
           }
         ]
       }}
    end)

    {:ok, %{messages: []}, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

    assert_push("history_loaded", %{messages: []})

    ref = push(socket, "send_message", %{"message" => "Draft a billing issue", "context" => %{"view" => "board"}})
    assert_reply(ref, :ok, %{})

    assert_push("message_created", %{message: %{role: "user", content: "Draft a billing issue"}})
    assert_push("assistant_completed", %{message: %{role: "assistant", content: "Drafted MAC-7 for billing work."}})
    assert_push("assistant_issue_created", %{identifier: "MAC-7", thread_id: issue_thread_id})

    copied_messages = History.list_messages_for_thread(issue_thread_id)
    assert Enum.map(copied_messages, & &1.role) == ["user", "assistant"]
    assert Enum.map(copied_messages, & &1.content) == ["Draft a billing issue", "Drafted MAC-7 for billing work."]
    assert List.last(copied_messages).turn_id == "turn-draft-7"

    {:ok, %{messages: issue_history, thread_id: ^issue_thread_id}, _socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:issue:macro-markets:MAC-7")

    assert Enum.map(issue_history, & &1.content) == ["Draft a billing issue", "Drafted MAC-7 for billing work."]

    assert {:ok, %{scope: "issue", issue_identifier: "MAC-7"}} = History.get_thread(issue_thread_id)

    {:ok, %{messages: project_history}, _socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

    assert project_history == []
  end

  test "project chat that creates a regular issue also binds the chat to that issue" do
    Application.put_env(:symphony_elixir, :assistant_runner, fn _workspace, _prompt, _issue, _opts ->
      {:ok,
       %{
         assistant_message: "Created MAC-8.",
         turn_id: "turn-create-8",
         tool_calls: [
           %{
             name: "create_issue",
             status: "complete",
             result: %{
               tool: "create_issue",
               data: %{identifier: "MAC-8", title: "Regular issue"}
             }
           }
         ]
       }}
    end)

    {:ok, %{messages: []}, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

    ref = push(socket, "send_message", %{"message" => "Create the issue", "context" => %{"view" => "board"}})
    assert_reply(ref, :ok, %{})

    assert_push("assistant_issue_created", %{identifier: "MAC-8", thread_id: issue_thread_id})

    assert {:ok, %{scope: "issue", issue_identifier: "MAC-8"}} = History.get_thread(issue_thread_id)
  end

  test "rejects assistant topic without valid token" do
    assert {:error, %{reason: "unauthorized"}} =
             socket(SymphonyElixirWeb.UserSocket, nil, %{token: "wrong"})
             |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")
  end

  test "join assistant:thread:<id> loads that thread's history", %{socket: socket} do
    {:ok, thread} = History.create_freeform_thread(%{title: "F", workspace_path: System.tmp_dir!()})
    {:ok, _} = History.append_message(thread, %{role: "user", content: "hello freeform"})

    {:ok, payload, _socket} = subscribe_and_join(socket, "assistant:thread:#{thread.id}", %{})
    assert [%{content: "hello freeform"}] = payload.messages
  end

  test "join assistant:issue:<project>:<identifier> creates and loads an issue thread", %{socket: socket} do
    {:ok, payload, _socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    assert %{messages: [], thread_id: thread_id} = payload
    assert {:ok, thread} = History.get_thread(thread_id)
    assert thread.scope == "issue"
    assert thread.project_slug == "macro-markets"
    assert thread.issue_identifier == "MAC-1"
    assert thread.workspace_path == Workspace.path_for_issue("MAC-1")
  end

  test "join assistant:issue:<project>:<identifier> decodes encoded topic segments", %{socket: socket} do
    {:ok, _project} = Context.ensure_project(%{name: "Encoded Project", slug: "encoded/project"})

    {:ok, payload, _socket} = subscribe_and_join(socket, "assistant:issue:encoded%2Fproject:%23508", %{})

    assert %{thread_id: thread_id} = payload
    assert {:ok, thread} = History.get_thread(thread_id)
    assert thread.project_slug == "encoded/project"
    assert thread.issue_identifier == "#508"
  end

  test "set_mode persists an allowed mode for issue threads", %{socket: socket} do
    {:ok, %{thread_id: thread_id}, socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(socket, "set_mode", %{"mode" => "complex"})
    assert_reply(ref, :ok, %{mode: "complex"})

    assert {:ok, thread} = History.get_thread(thread_id)
    assert thread.metadata["mode"] == "complex"
  end

  test "issue join returns the persisted mode so the UI can rehydrate it", %{socket: socket} do
    {:ok, %{thread_id: thread_id}, socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(socket, "set_mode", %{"mode" => "complex"})
    assert_reply(ref, :ok, %{mode: "complex"})

    {:ok, payload, _rejoined} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join("assistant:issue:macro-markets:MAC-1", %{})

    assert payload.thread_id == thread_id
    assert payload.mode == "complex"
  end

  test "issue join defaults to triage mode when none is persisted", %{socket: socket} do
    {:ok, payload, _socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    assert payload.mode == "triage"
    assert payload.goal_mode == false
  end

  test "set_goal_mode persists the flag and the join rehydrates it", %{socket: socket} do
    {:ok, %{thread_id: thread_id}, socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(socket, "set_goal_mode", %{"goal_mode" => true})
    assert_reply(ref, :ok, %{goal_mode: true})

    assert {:ok, thread} = History.get_thread(thread_id)
    assert thread.metadata["goal_mode"] == true

    {:ok, payload, _rejoined} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join("assistant:issue:macro-markets:MAC-1", %{})

    assert payload.goal_mode == true
  end

  test "set_goal_mode rejects non-issue assistant threads", %{socket: socket} do
    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:macro-markets", %{})

    ref = push(socket, "set_goal_mode", %{"goal_mode" => true})
    assert_reply(ref, :error, %{reason: "this action is only supported for issue assistant threads"})
  end

  test "dispatch_codex moves the bound issue to In Progress without a goal by default", %{socket: socket} do
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Dispatch me", "status" => "Todo"})
    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(socket, "dispatch_codex", %{"goal_mode" => false})
    assert_reply(ref, :ok, %{goal_mode: false})

    assert {:ok, issue} = Context.get_issue("macro-markets", "MAC-1")
    assert issue.status.name == "In Progress"
    assert issue.agent_goal in [nil, ""]
  end

  test "dispatch_codex persists a goal when goal mode is enabled", %{socket: socket} do
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Dispatch me", "status" => "Todo"})
    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(socket, "dispatch_codex", %{"goal_mode" => true})
    assert_reply(ref, :ok, %{goal_mode: true})

    assert {:ok, issue} = Context.get_issue("macro-markets", "MAC-1")
    assert issue.status.name == "In Progress"
    assert is_binary(issue.agent_goal)
    assert issue.agent_goal =~ "MAC-1"
  end

  test "dispatch_codex rejects non-issue assistant threads", %{socket: socket} do
    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:macro-markets", %{})

    ref = push(socket, "dispatch_codex", %{})
    assert_reply(ref, :error, %{reason: "this action is only supported for issue assistant threads"})
  end

  test "set_mode rejects unsupported modes for issue threads", %{socket: socket} do
    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(socket, "set_mode", %{"mode" => "expert"})
    assert_reply(ref, :error, %{reason: "unsupported mode: expert. Expected one of: triage, simple, complex"})
  end

  test "set_mode rejects project assistant threads", %{socket: socket} do
    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:macro-markets", %{})

    ref = push(socket, "set_mode", %{"mode" => "simple"})
    assert_reply(ref, :error, %{reason: "this action is only supported for issue assistant threads"})
  end

  test "freeform send_message routes through send_message_to_thread", %{socket: socket} do
    Application.put_env(:symphony_elixir, :assistant_runner, fn _w, _p, _i, _o ->
      {:ok, %{assistant_message: "freeform reply", tool_calls: []}}
    end)

    {:ok, thread} = History.create_freeform_thread(%{title: "F", workspace_path: System.tmp_dir!()})
    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:thread:#{thread.id}", %{})

    ref = push(socket, "send_message", %{"message" => "hi"})
    assert_reply(ref, :ok)
    assert_push("assistant_completed", %{message: %{content: "freeform reply"}})
  after
    Application.delete_env(:symphony_elixir, :assistant_runner)
  end

  test "issue thread send_message routes to the issue working tree", %{socket: socket} do
    workspace_root =
      Path.join(System.tmp_dir!(), "symphony-assistant-channel-workspaces-#{System.unique_integer([:positive])}")

    workflow_root =
      Path.join(System.tmp_dir!(), "symphony-assistant-channel-workflow-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workspace_root)
    File.mkdir_p!(workflow_root)

    workflow_file = Path.join(workflow_root, "WORKFLOW.md")
    TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: workspace_root)
    Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :workflow_file_path)
      File.rm_rf!(workspace_root)
      File.rm_rf!(workflow_root)
    end)

    {:ok, _project} = Context.ensure_project(%{name: "Macro", slug: "macro"})

    {:ok, thread} =
      History.ensure_issue_thread("macro", "MAC-1", %{workspace_path: Workspace.path_for_issue("MAC-1")})

    test_pid = self()

    Application.put_env(:symphony_elixir, :assistant_runner, fn workspace, _prompt, _issue, _opts ->
      send(test_pid, {:workspace, workspace})
      {:ok, %{assistant_message: "issue reply", codex_thread_id: "codex-thread", turn_id: "turn-1", tool_calls: []}}
    end)

    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:thread:#{thread.id}", %{})

    ref = push(socket, "send_message", %{"message" => "build X"})
    assert_reply(ref, :ok)

    expected_workspace = Workspace.path_for_issue("MAC-1")
    assert_receive {:workspace, ^expected_workspace}
  end

  test "issue topic send_message routes to the issue working tree", %{socket: socket} do
    workspace_root =
      Path.join(System.tmp_dir!(), "symphony-assistant-channel-workspaces-#{System.unique_integer([:positive])}")

    workflow_root =
      Path.join(System.tmp_dir!(), "symphony-assistant-channel-workflow-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workspace_root)
    File.mkdir_p!(workflow_root)

    workflow_file = Path.join(workflow_root, "WORKFLOW.md")
    TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: workspace_root)
    Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :workflow_file_path)
      File.rm_rf!(workspace_root)
      File.rm_rf!(workflow_root)
    end)

    {:ok, _project} = Context.ensure_project(%{name: "Macro", slug: "macro"})
    test_pid = self()

    Application.put_env(:symphony_elixir, :assistant_runner, fn workspace, _prompt, _issue, _opts ->
      send(test_pid, {:workspace, workspace})
      {:ok, %{assistant_message: "issue reply", codex_thread_id: "codex-thread", turn_id: "turn-1", tool_calls: []}}
    end)

    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:issue:macro:MAC-1", %{})

    ref = push(socket, "send_message", %{"message" => "build X"})
    assert_reply(ref, :ok)

    expected_workspace = Workspace.path_for_issue("MAC-1")
    assert_receive {:workspace, ^expected_workspace}
  end

  test "documents_changed pushes assistant_document_changed for issue doc-writing turn", %{socket: socket} do
    workspace_root =
      Path.join(System.tmp_dir!(), "symphony-assistant-channel-workspaces-#{System.unique_integer([:positive])}")

    workflow_root =
      Path.join(System.tmp_dir!(), "symphony-assistant-channel-workflow-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workspace_root)
    File.mkdir_p!(workflow_root)

    workflow_file = Path.join(workflow_root, "WORKFLOW.md")
    TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: workspace_root)
    Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :workflow_file_path)
      File.rm_rf!(workspace_root)
      File.rm_rf!(workflow_root)
    end)

    {:ok, _project} = Context.ensure_project(%{name: "Macro", slug: "macro"})

    {:ok, thread} =
      History.ensure_issue_thread("macro", "MAC-1", %{workspace_path: Workspace.path_for_issue("MAC-1")})

    Application.put_env(:symphony_elixir, :assistant_runner, fn workspace, _prompt, _issue, _opts ->
      File.mkdir_p!(Path.join([workspace, "docs", "superpowers", "specs"]))
      File.write!(Path.join([workspace, "docs", "superpowers", "specs", "new.md"]), "# New")
      {:ok, %{assistant_message: "wrote spec", codex_thread_id: "codex-thread", turn_id: "turn-1", tool_calls: []}}
    end)

    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:thread:#{thread.id}", %{})

    ref = push(socket, "send_message", %{"message" => "write doc"})
    assert_reply(ref, :ok)
    assert_push("assistant_document_changed", %{identifier: "MAC-1"})
  end

  test "join assistant:thread:<id> with unknown id is rejected", %{socket: socket} do
    assert {:error, %{reason: _}} = subscribe_and_join(socket, "assistant:thread:999999999", %{})
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

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)

  defp restore_app_env(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore_app_env(key, value), do: Application.put_env(:symphony_elixir, key, value)
end
