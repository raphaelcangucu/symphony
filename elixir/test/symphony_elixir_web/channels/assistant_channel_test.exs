defmodule SymphonyElixirWeb.AssistantChannelTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL
  alias SymphonyElixir.Assistant.{History, Thread, TurnManager}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Setting
  alias SymphonyElixir.TestSupport
  alias SymphonyElixir.Workflow
  alias SymphonyElixir.Workspace

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @fake_codex_app_server Path.expand("../../support/fixtures/fake_codex_app_server.py", __DIR__)

  defmodule PushDispatcher do
    def assistant_input_needed(metadata) do
      if pid = Application.get_env(:symphony_elixir, :push_test_pid) do
        send(pid, {:assistant_input_push, metadata})
      end

      :ok
    end

    def assistant_turn_completed(thread, status) do
      if pid = Application.get_env(:symphony_elixir, :push_test_pid) do
        send(pid, {:assistant_turn_push, thread, status})
      end

      :ok
    end
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()
    Repo.delete_all(Setting)

    previous_token = System.get_env(@token_env)
    previous_runner = Application.get_env(:symphony_elixir, :assistant_runner)
    previous_push_dispatcher = Application.get_env(:symphony_elixir, :push_dispatcher)
    previous_push_test_pid = Application.get_env(:symphony_elixir, :push_test_pid)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      restore_app_env(:assistant_runner, previous_runner)
      restore_app_env(:push_dispatcher, previous_push_dispatcher)
      restore_app_env(:push_test_pid, previous_push_test_pid)
    end)

    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    issue_workspace = Workspace.path_for_issue("MAC-1")
    File.mkdir_p!(issue_workspace)
    on_exit(fn -> File.rm_rf!(issue_workspace) end)

    {:ok, _issue_thread} =
      History.ensure_issue_thread("macro-markets", "MAC-1", %{
        workspace_path: issue_workspace,
        agent_kind: "codex"
      })

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

  test "runs the turn asynchronously and rejects a concurrent send while running" do
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      send(test_pid, {:runner_started, self()})

      receive do
        :finish -> :ok
      after
        2_000 -> :ok
      end

      Keyword.fetch!(opts, :on_assistant_delta).("hi")
      {:ok, %{assistant_message: "done", codex_thread_id: "t1", turn_id: "turn-1", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)

    {:ok, %{messages: []}, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

    assert_push("history_loaded", %{messages: []})

    ref = push(socket, "send_message", %{"message" => "first", "context" => %{"view" => "board"}})
    assert_reply(ref, :ok, %{})

    assert_receive {:runner_started, runner_pid}, 2_000

    ref2 = push(socket, "send_message", %{"message" => "second", "context" => %{"view" => "board"}})
    assert_reply(ref2, :error, %{reason: "assistant is busy"})

    send(runner_pid, :finish)
    assert_push("assistant_delta", %{delta: "hi"})
    assert_push("assistant_completed", %{message: %{role: "assistant", content: "done"}})
  end

  test "issue thread completion pushes history_synced for transcript reconciliation" do
    runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_assistant_delta).("synced reply")
      {:ok, %{assistant_message: "synced reply", codex_thread_id: "ct-sync", turn_id: "turn-sync", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)

    {:ok, _payload, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:issue:macro-markets:MAC-SYNC")

    assert_push("history_loaded", %{})

    ref = push(socket, "send_message", %{"message" => "go", "context" => %{"view" => "board"}})
    assert_reply(ref, :ok, %{})

    assert_push("assistant_completed", %{message: %{role: "assistant", content: "synced reply"}})
    assert_push("history_synced", %{messages: messages})
    assert Enum.map(messages, & &1.content) == ["go", "synced reply"]
  end

  test "sync_history replies ok and pushes history_synced for durable threads" do
    {:ok, %{thread_id: thread_id}, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:issue:macro-markets:MAC-SYNC2")

    assert_push("history_loaded", %{})

    {:ok, thread} = History.get_thread(thread_id)
    {:ok, _message} = History.append_message(thread, %{role: "user", content: "hello"})

    ref = push(socket, "sync_history", %{})
    assert_reply(ref, :ok, %{})

    assert_push("history_synced", %{messages: [%{role: "user", content: "hello"}]})
  end

  test "steer_turn persists a steer message and forwards to the running turn" do
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_turn_started).("turn-xyz")
      send(test_pid, {:runner, self()})

      receive do
        {:codex_steer, input, reply_to} ->
          send(test_pid, {:steered, input})
          send(reply_to, {:steer_ok, %{"turnId" => "turn-xyz"}})
      after
        2_000 -> :ok
      end

      {:ok, %{assistant_message: "done", turn_id: "turn-xyz", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)

    {:ok, _join, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:issue:macro-markets:MAC-1")

    assert_push("history_loaded", %{})

    ref = push(socket, "send_message", %{"message" => "go", "context" => %{"view" => "board"}})
    assert_reply(ref, :ok, %{})
    assert_receive {:runner, _pid}, 2_000

    sref = push(socket, "steer_turn", %{"message" => "use the simpler approach"})
    assert_reply(sref, :ok, %{})

    assert_push("message_created", %{message: %{role: "user", content: "use the simpler approach"}})
    assert_receive {:steered, [%{"type" => "text", "text" => "use the simpler approach"}]}, 2_000
    assert_push("assistant_completed", %{message: %{role: "assistant", content: "done"}})
  end

  test "steer_turn works from a different channel than the one that started the turn" do
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_turn_started).("turn-steer")
      send(test_pid, {:runner, self()})

      receive do
        {:codex_steer, input, reply_to} ->
          send(test_pid, {:steered, input})
          send(reply_to, {:steer_ok, %{}})
      after
        2_000 -> :ok
      end

      {:ok, %{assistant_message: "ok", codex_thread_id: "ct-steer", turn_id: "turn-steer", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)
    topic = "assistant:issue:macro-markets:DIS-2"

    {:ok, _join, socket_a} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    ref = push(socket_a, "send_message", %{"message" => "go", "context" => %{}})
    assert_reply(ref, :ok, %{})
    assert_receive {:runner, _runner_pid}, 2_000

    {:ok, _join, socket_b} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    ref2 = push(socket_b, "steer_turn", %{"message" => "actually do Y"})
    assert_reply(ref2, :ok, %{})
    assert_receive {:steered, [%{"type" => "text", "text" => "actually do Y"}]}, 2_000
  end

  test "second subscriber receives tool_call_started for a non-goal durable turn" do
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      tool_call = %{
        id: "tool-pubsub",
        name: "Bash",
        arguments: %{"command" => "mix test test/symphony_elixir_web/channels/assistant_channel_test.exs"}
      }

      Keyword.fetch!(opts, :on_tool_call_started).(tool_call)
      send(test_pid, {:runner_started, self()})

      receive do
        :finish -> :ok
      after
        2_000 -> :ok
      end

      Keyword.fetch!(opts, :on_tool_call_completed).(Map.put(tool_call, :status, "completed"))
      {:ok, %{assistant_message: "ok", codex_thread_id: "ct-pubsub", turn_id: "turn-pubsub", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)
    topic = "assistant:issue:macro-markets:DIS-PUBSUB"

    {:ok, %{thread_id: thread_id}, socket_a} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    {:ok, _join, _socket_b} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    ref = push(socket_a, "send_message", %{"message" => "go", "context" => %{}})
    assert_reply(ref, :ok, %{})
    assert_receive {:runner_started, runner_pid}, 2_000

    assert_push("tool_call_started", %{tool_call: %{name: "Bash"}})
    assert_push("tool_call_started", %{tool_call: %{name: "Bash"}})

    {:ok, running_thread} = History.get_thread(thread_id)

    assert [
             %{
               "id" => "tool-pubsub",
               "name" => "Bash",
               "arguments_summary" => "mix test test/symphony_elixir_web/channels/assistant_channel_test.exs"
             }
           ] = History.current_turn(running_thread)["active_tools"]

    send(runner_pid, :finish)

    assert_push("tool_call_completed", %{tool_call: %{name: "Bash", status: "completed"}})
    assert_push("tool_call_completed", %{tool_call: %{name: "Bash", status: "completed"}})

    {:ok, completed_thread} = History.get_thread(thread_id)
    assert History.current_turn(completed_thread)["active_tools"] == []
  end

  test "stop_turn interrupts the running turn and pushes interrupted status" do
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      tool_call = %{
        id: "tool-stop",
        name: "Bash",
        arguments: %{"command" => "sleep 30"}
      }

      Keyword.fetch!(opts, :on_tool_call_started).(tool_call)
      send(test_pid, {:runner_started, self()})

      receive do
        {:agent_interrupt} ->
          send(test_pid, {:agent_interrupted, self()})

          receive do
            {:codex_interrupt} -> send(test_pid, {:codex_interrupted, self()})
          after
            50 -> :ok
          end
      after
        2_000 ->
          send(test_pid, {:runner_timeout, self()})
      end

      {:error, :interrupted}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)
    topic = "assistant:issue:macro-markets:DIS-STOP"

    {:ok, %{thread_id: thread_id}, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    ref = push(socket, "send_message", %{"message" => "go", "context" => %{}})
    assert_reply(ref, :ok, %{})
    assert_receive {:runner_started, runner_pid}, 2_000
    assert_push("tool_call_started", %{tool_call: %{name: "Bash"}})

    stop_ref = push(socket, "stop_turn", %{})
    assert_reply(stop_ref, :ok, %{})
    assert_receive {:agent_interrupted, ^runner_pid}, 1_000
    refute_receive {:codex_interrupted, ^runner_pid}, 100

    assert_push("turn_status", %{status: "interrupted", can_resume: true, active_tools: []})

    {:ok, interrupted_thread} = History.get_thread(thread_id)
    turn = History.current_turn(interrupted_thread)
    assert turn["status"] == "interrupted"
    assert turn["interrupted_reason"] == "user_stop"
    assert turn["active_tools"] == []
  end

  test "kill_tool cancels an active tool and leaves the turn running" do
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      tool_call = %{
        id: "tool-kill",
        name: "Bash",
        arguments: %{"command" => "sleep 30"}
      }

      Keyword.fetch!(opts, :on_tool_call_started).(tool_call)
      send(test_pid, {:runner_started, self()})

      receive do
        {:kill_tool, "tool-kill"} ->
          send(test_pid, {:tool_killed, self()})
      after
        2_000 ->
          send(test_pid, {:runner_timeout, self()})
      end

      receive do
        :finish -> :ok
      after
        2_000 -> :ok
      end

      {:ok, %{assistant_message: "ok", codex_thread_id: "ct-kill", turn_id: "turn-kill", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)

    {:ok, %{thread_id: thread_id}, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:issue:macro-markets:DIS-KILL")

    ref = push(socket, "send_message", %{"message" => "go", "context" => %{}})
    assert_reply(ref, :ok, %{})
    assert_receive {:runner_started, runner_pid}, 2_000
    assert_push("tool_call_started", %{tool_call: %{id: "tool-kill", name: "Bash"}})

    kill_ref = push(socket, "kill_tool", %{"tool_call_id" => "tool-kill"})
    assert_reply(kill_ref, :ok, %{})
    assert_receive {:tool_killed, ^runner_pid}, 1_000
    assert_push("tool_call_completed", %{tool_call: %{id: "tool-kill", name: "Bash", status: "canceled"}})

    {:ok, updated_thread} = History.get_thread(thread_id)
    assert History.current_turn(updated_thread)["status"] == "running"
    assert History.current_turn(updated_thread)["active_tools"] == []

    send(runner_pid, :finish)
    assert_push("assistant_completed", %{message: %{role: "assistant", content: "ok"}})
  end

  test "kill_tool returns a stoppable error when the tool is not running" do
    {:ok, %{thread_id: _thread_id}, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:issue:macro-markets:DIS-KILL-MISSING")

    kill_ref = push(socket, "kill_tool", %{"tool_call_id" => "missing"})

    assert_reply(kill_ref, :error, %{reason: "tool_not_running", can_stop_turn: true})
  end

  test "kill_tool returns a stoppable error when no worker owns the active tool" do
    {:ok, %{thread_id: thread_id}, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:issue:macro-markets:DIS-KILL-ORPHAN")

    {:ok, thread} = History.get_thread(thread_id)

    {:ok, running_thread} =
      History.start_turn_state(thread, %{trigger: "user", prompt: "orphan tool", agent_kind: "codex"})

    {:ok, _with_tool} =
      History.upsert_active_tool(running_thread, %{
        "id" => "tool-orphan",
        "name" => "Bash",
        "arguments_summary" => "sleep 30",
        "started_at" => "2026-07-09T12:00:00Z"
      })

    kill_ref = push(socket, "kill_tool", %{"tool_call_id" => "tool-orphan"})

    assert_reply(kill_ref, :error, %{reason: "no_worker", can_stop_turn: true})
  end

  test "a send while running steers the live turn instead of starting a second one" do
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_turn_started).("turn-busy")
      send(test_pid, {:runner, self()})

      receive do
        {:codex_steer, input, reply_to} ->
          send(test_pid, {:steered, input})
          send(reply_to, {:steer_ok, %{}})
      after
        2_000 -> :ok
      end

      {:ok, %{assistant_message: "ok", codex_thread_id: "ct-busy", turn_id: "turn-busy", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)
    topic = "assistant:issue:macro-markets:DIS-3"

    {:ok, _join, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    ref = push(socket, "send_message", %{"message" => "first", "context" => %{}})
    assert_reply(ref, :ok, %{})
    assert_receive {:runner, _pid}, 2_000

    ref2 = push(socket, "send_message", %{"message" => "second", "context" => %{}})
    assert_reply(ref2, :ok, %{})
    assert_receive {:steered, [%{"type" => "text", "text" => "second"}]}, 2_000
  end

  test "btw runs an ephemeral side query and streams answer without persisting" do
    side_runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_assistant_delta).("Yes")
      {:ok, %{assistant_message: "Yes, useMemo memoizes values.", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_side_runner, side_runner)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :assistant_side_runner) end)

    {:ok, %{messages: []}, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

    assert_push("history_loaded", %{messages: []})

    ref = push(socket, "btw", %{"message" => "what does useMemo do?"})
    assert_reply(ref, :ok, %{btw_id: btw_id})
    assert is_binary(btw_id)

    assert_push("btw_delta", %{btw_id: ^btw_id, delta: "Yes"})
    assert_push("btw_completed", %{btw_id: ^btw_id, message: "Yes, useMemo memoizes values."})

    {:ok, %{messages: messages}, _socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

    assert messages == []
  end

  test "steer_turn replies error when no turn is running" do
    {:ok, %{messages: []}, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

    assert_push("history_loaded", %{messages: []})

    ref = push(socket, "steer_turn", %{"message" => "hi"})
    assert_reply(ref, :error, %{reason: "ActiveTurnNotSteerable"})
  end

  test "submit_user_input forwards normalized answers to the running turn and persists the Q&A" do
    test_pid = self()
    Application.put_env(:symphony_elixir, :push_dispatcher, PushDispatcher)
    Application.put_env(:symphony_elixir, :push_test_pid, test_pid)

    runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_turn_started).("turn-q")

      Keyword.fetch!(opts, :on_user_input_required).(%{
        request_id: 112,
        item_id: "call-q",
        questions: [
          %{
            "id" => "q1",
            "header" => "Pick one",
            "question" => "How should I proceed?",
            "isOther" => false,
            "isSecret" => false,
            "options" => [%{"label" => "Use default", "description" => "default"}]
          }
        ]
      })

      send(test_pid, {:runner, self()})

      receive do
        {:codex_user_input, request_id, answers, reply_to} ->
          send(test_pid, {:answered, request_id, answers})
          send(reply_to, {:user_input_ok, request_id})
      after
        2_000 -> :ok
      end

      {:ok, %{assistant_message: "done", turn_id: "turn-q", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)

    {:ok, _join, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:issue:macro-markets:MAC-1")

    assert_push("history_loaded", %{})

    ref = push(socket, "send_message", %{"message" => "go", "context" => %{"view" => "board"}})
    assert_reply(ref, :ok, %{})
    assert_receive {:runner, _pid}, 2_000

    assert_push("user_input_required", %{request_id: 112, questions: [%{"id" => "q1"}]})
    assert_receive {:assistant_input_push, %{project_slug: "macro-markets", issue_identifier: "MAC-1", request_kind: :question}}, 2_000

    sref = push(socket, "submit_user_input", %{"request_id" => 112, "answers" => %{"q1" => "Use default"}})
    assert_reply(sref, :ok, %{})

    assert_receive {:answered, 112, %{"q1" => %{"answers" => ["Use default"]}}}, 2_000
    assert_push("message_created", %{message: %{metadata: %{"kind" => "user_questions"}}})
    assert_push("assistant_completed", %{message: %{role: "assistant", content: "done"}})
  end

  test "submit_approval forwards command approval to the running turn" do
    test_pid = self()
    Application.put_env(:symphony_elixir, :push_dispatcher, PushDispatcher)
    Application.put_env(:symphony_elixir, :push_test_pid, test_pid)

    runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_turn_started).("turn-approval")

      Keyword.fetch!(opts, :on_approval_required).(%{
        request_id: "cmd-1",
        decision: "acceptForSession",
        command: "npm test",
        cwd: "/workspace/app",
        reason: "unknown"
      })

      send(test_pid, {:runner, self()})

      receive do
        {:codex_approval, request_id, decision, reply_to} ->
          send(test_pid, {:approved, request_id, decision})
          send(reply_to, {:approval_ok, request_id})
      after
        2_000 -> :ok
      end

      {:ok, %{assistant_message: "done", turn_id: "turn-approval", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)

    {:ok, _join, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:issue:macro-markets:MAC-1")

    assert_push("history_loaded", %{})

    ref = push(socket, "send_message", %{"message" => "go", "context" => %{"view" => "board"}})
    assert_reply(ref, :ok, %{})
    assert_receive {:runner, _pid}, 2_000

    assert_push("approval_required", %{request_id: "cmd-1", command: "npm test"})
    assert_receive {:assistant_input_push, %{project_slug: "macro-markets", issue_identifier: "MAC-1", request_kind: :approval}}, 2_000

    sref = push(socket, "submit_approval", %{"request_id" => "cmd-1", "action" => "approve"})
    assert_reply(sref, :ok, %{})

    assert_receive {:approved, "cmd-1", "acceptForSession"}, 2_000
    assert_push("assistant_completed", %{message: %{role: "assistant", content: "done"}})
  end

  test "submit_approval routes a claude approval to the ApprovalBroker and pushes tool metadata" do
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_turn_started).("turn-claude-approval")

      Keyword.fetch!(opts, :on_approval_required).(%{
        request_id: "claude-1",
        agent: "claude",
        tool_name: "Bash",
        command: "ls -la",
        cwd: "/workspace/app",
        reason: "Claude requested approval to run Bash"
      })

      send(test_pid, {:runner, self()})

      # Keep the turn alive until the operator's decision has propagated.
      receive do
        :finish -> :ok
      after
        3_000 -> :ok
      end

      {:ok, %{assistant_message: "done", turn_id: "turn-claude-approval", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)

    {:ok, _join, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:issue:macro-markets:MAC-1")

    assert_push("history_loaded", %{})

    ref = push(socket, "send_message", %{"message" => "go", "context" => %{"view" => "board"}})
    assert_reply(ref, :ok, %{})
    assert_receive {:runner, runner_pid}, 2_000

    assert_push("approval_required", %{request_id: "claude-1", command: "ls -la", tool_name: "Bash", agent: "claude"})

    # Stand in for the blocking Claude MCP handler that waits on the broker.
    awaiter =
      spawn(fn ->
        send(test_pid, {:decision, SymphonyElixir.Claude.ApprovalBroker.await("claude-1", 3_000)})
      end)

    # Let the awaiter register with the broker before the decision is delivered.
    _ = awaiter
    Process.sleep(50)

    sref = push(socket, "submit_approval", %{"request_id" => "claude-1", "action" => "approve"})
    assert_reply(sref, :ok, %{})

    assert_receive {:decision, :approve}, 3_000

    send(runner_pid, :finish)
    assert_push("assistant_completed", %{message: %{role: "assistant", content: "done"}})
  end

  test "submit_user_input replies error when no turn is running" do
    {:ok, _join, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

    assert_push("history_loaded", %{messages: []})

    ref = push(socket, "submit_user_input", %{"request_id" => 1, "answers" => %{"q1" => "A"}})
    assert_reply(ref, :error, %{reason: "ActiveTurnNotAwaitingInput"})
  end

  test "submit_user_input for Claude resolves through UserInputBroker without codex_user_input" do
    alias SymphonyElixir.Assistant.UserInputBroker

    test_pid = self()
    request_id = "claude-q-#{System.unique_integer([:positive])}"
    UserInputBroker.ensure_started()

    runner = fn _workspace, _prompt, _issue, opts ->
      send(test_pid, {:runner_opts, opts})
      Keyword.fetch!(opts, :on_turn_started).("turn-claude-q")

      Keyword.fetch!(opts, :on_user_input_required).(%{
        request_id: request_id,
        questions: [
          %{
            "id" => "q1",
            "header" => "Target",
            "question" => "Which target?",
            "isOther" => false,
            "options" => [%{"label" => "Default", "description" => ""}]
          }
        ]
      })

      send(test_pid, {:runner, self()})

      receive do
        {:codex_user_input, _request_id, _answers, _reply_to} ->
          send(test_pid, :unexpected_codex_user_input)

        :finish ->
          :ok
      after
        3_000 -> :ok
      end

      {:ok, %{assistant_message: "done", turn_id: "turn-claude-q", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)

    {:ok, _join, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:issue:macro-markets:MAC-1")

    assert_push("history_loaded", %{})

    awaiter =
      Task.async(fn ->
        UserInputBroker.await(request_id, 5_000)
      end)

    Process.sleep(30)

    ref =
      push(socket, "send_message", %{
        "message" => "clarify",
        "context" => %{"view" => "board", "agent" => "claude"}
      })

    assert_reply(ref, :ok, %{})
    assert_receive {:runner_opts, opts}, 2_000
    assert %{token: token, channel_pid: channel_pid} = Keyword.get(opts, :ask_user_session)
    assert is_binary(token) and token != ""
    assert is_pid(channel_pid)

    assert_receive {:runner, runner_pid}, 2_000
    assert_push("user_input_required", %{request_id: ^request_id, questions: [%{"id" => "q1"}]})

    sref =
      push(socket, "submit_user_input", %{
        "request_id" => request_id,
        "answers" => %{"q1" => "Default"}
      })

    assert_reply(sref, :ok, %{})
    assert {:ok, %{"q1" => %{"answers" => ["Default"]}}} = Task.await(awaiter, 5_000)
    refute_receive :unexpected_codex_user_input, 200

    send(runner_pid, :finish)
    assert_push("assistant_completed", %{message: %{role: "assistant", content: "done"}})
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

  test "join assistant:explore:<project> creates a project explore thread", %{socket: socket} do
    Application.put_env(:symphony_elixir, :assistant_runner, fn _workspace, _prompt, _issue, _opts ->
      {:ok, %{assistant_message: "explore reply", tool_calls: []}}
    end)

    {:ok, payload, _socket} = subscribe_and_join(socket, "assistant:explore:macro-markets", %{})

    assert %{messages: [], thread_id: thread_id} = payload
    assert {:ok, thread} = History.get_thread(thread_id)
    assert thread.scope == "project_explore"
    assert thread.project_slug == "macro-markets"
    assert is_binary(thread.workspace_path)
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

  test "issue join returns goal_mode defaults when none is persisted", %{socket: socket} do
    {:ok, payload, _socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    assert payload.goal_mode == false
    assert payload.goal_objective == nil
  end

  test "set_goal_mode persists the flag and the join rehydrates it", %{socket: socket} do
    {:ok, %{thread_id: thread_id}, socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(socket, "set_goal_mode", %{"goal_mode" => true})
    assert_reply(ref, :ok, %{enabled: true})

    assert {:ok, thread} = History.get_thread(thread_id)
    assert thread.metadata["goal_mode"] == true

    {:ok, payload, _rejoined} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join("assistant:issue:macro-markets:MAC-1", %{})

    assert payload.goal_mode == true
  end

  test "set_goal_mode persists the authoring objective and the join rehydrates it", %{socket: socket} do
    {:ok, %{thread_id: thread_id}, socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(socket, "set_goal_mode", %{"goal_mode" => true, "objective" => "Audit the auth module"})
    assert_reply(ref, :ok, %{goal_mode: true, goal_objective: "Audit the auth module"})

    assert {:ok, thread} = History.get_thread(thread_id)
    assert thread.metadata["goal_objective"] == "Audit the auth module"

    {:ok, payload, _rejoined} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join("assistant:issue:macro-markets:MAC-1", %{})

    assert payload.goal_mode == true
    assert payload.goal_objective == "Audit the auth module"
  end

  test "set_goal_mode targets the exact socket thread for every persistent scope", %{socket: _socket} do
    enable_codex_goals!()

    for scope <- ~w(project project_session project_explore freeform issue issue_session kb) do
      workspace =
        Path.join(System.tmp_dir!(), "channel-goal-#{scope}-#{System.unique_integer([:positive])}")

      File.mkdir_p!(workspace)
      on_exit(fn -> File.rm_rf!(workspace) end)

      attrs = %{
        scope: scope,
        status: "active",
        workspace_path: workspace,
        agent_kind: "codex",
        project_slug: if(scope == "freeform", do: nil, else: "macro-markets"),
        issue_identifier: if(scope in ["issue", "issue_session"], do: "SCOPE-#{scope}", else: nil)
      }

      {:ok, thread} = %Thread{} |> Thread.changeset(attrs) |> Repo.insert()

      topic =
        if scope == "project",
          do: "assistant:macro-markets",
          else: "assistant:thread:#{thread.id}"

      {:ok, _payload, scope_socket} =
        socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
        |> subscribe_and_join(topic, %{})

      objective = "Objective for #{scope}"
      expected_thread_id = thread.id
      ref = push(scope_socket, "set_goal_mode", %{"goal_mode" => true, "objective" => objective})

      assert_reply(ref, :ok, %{
        enabled: true,
        objective: ^objective,
        thread_id: ^expected_thread_id
      })

      assert {:ok, reloaded} = History.get_thread(thread.id)
      assert History.thread_goal_objective(reloaded) == objective

      ref = push(scope_socket, "goal_status", %{})
      assert_reply(ref, :ok)
      assert_push("goal_status", %{enabled: true, objective: ^objective})

      updated_objective = "Updated objective for #{scope}"
      ref = push(scope_socket, "goal_set_objective", %{"objective" => updated_objective})

      assert_reply(ref, :ok, %{
        enabled: true,
        objective: ^updated_objective,
        thread_id: ^expected_thread_id
      })

      assert {:ok, updated} = History.get_thread(thread.id)
      assert History.thread_goal_objective(updated) == updated_objective

      ref = push(scope_socket, "goal_pause", %{})
      assert_reply(ref, :error, %{reason: pause_reason})
      assert pause_reason =~ "Codex thread"

      ref = push(scope_socket, "goal_clear", %{})
      assert_reply(ref, :ok, %{enabled: false})
      assert {:ok, cleared} = History.get_thread(thread.id)
      refute History.thread_goal_mode(cleared)
    end
  end

  test "set_goal_mode rejects a missing persisted workspace without creating it", %{socket: socket} do
    workspace =
      Path.join(System.tmp_dir!(), "missing-channel-goal-#{System.unique_integer([:positive])}")

    File.rm_rf!(workspace)

    {:ok, thread} =
      History.create_freeform_thread(%{
        workspace_path: workspace,
        agent_kind: "codex"
      })

    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:thread:#{thread.id}", %{})

    ref =
      push(socket, "set_goal_mode", %{
        "goal_mode" => true,
        "objective" => "Must not activate"
      })

    assert_reply(ref, :error, %{reason: reason})
    assert reason =~ "workspace"
    refute File.exists?(workspace)
    assert {:ok, unchanged} = History.get_thread(thread.id)
    refute History.thread_goal_mode(unchanged)
  end

  test "set_goal_mode rejects a thread without a persisted provider", %{socket: socket} do
    workspace =
      Path.join(System.tmp_dir!(), "missing-provider-goal-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    {:ok, thread} = History.create_freeform_thread(%{workspace_path: workspace})
    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:thread:#{thread.id}", %{})

    ref = push(socket, "set_goal_mode", %{"goal_mode" => true, "objective" => "Must fail"})
    assert_reply(ref, :error, %{reason: reason})
    assert reason =~ "provider"
    assert {:ok, unchanged} = History.get_thread(thread.id)
    refute History.thread_goal_mode(unchanged)
  end

  test "idle set_goal_mode native failure leaves metadata disabled", %{socket: socket} do
    custom_root =
      Path.join(System.tmp_dir!(), "native-failure-workspaces-#{System.unique_integer([:positive])}")

    workspace = Path.join(custom_root, "MAC-8003")
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(custom_root) end)

    {:ok, _setup} =
      Context.upsert_project_setup("macro-markets", %{
        workflow_markdown:
          Workflow.to_markdown(
            %{
              "workspace" => %{"root" => custom_root},
              "codex" => %{
                "command" => "env FAKE_CODEX_GOAL_SET_ERROR=1 python3 #{@fake_codex_app_server}",
                "goals_enabled" => true
              }
            },
            ""
          )
      })

    {:ok, thread} =
      %Thread{}
      |> Thread.changeset(%{
        scope: "issue_session",
        status: "active",
        project_slug: "macro-markets",
        issue_identifier: "MAC-8003",
        workspace_path: workspace,
        agent_kind: "codex",
        agent_thread_ids: %{"codex" => "thread-8003"}
      })
      |> Repo.insert()

    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:thread:#{thread.id}", %{})

    ref =
      push(socket, "set_goal_mode", %{
        "goal_mode" => true,
        "objective" => "Must remain disabled"
      })

    assert_reply(ref, :error, %{reason: reason})
    assert reason =~ "goal set failed"

    assert {:ok, unchanged} = History.get_thread(thread.id)
    refute History.thread_goal_mode(unchanged)
    assert History.thread_goal_objective(unchanged) == nil
  end

  test "project send never switches to a replacement thread after join", %{socket: socket} do
    workspace =
      Path.join(System.tmp_dir!(), "exact-project-thread-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    {:ok, original} =
      History.ensure_thread("macro-markets", %{workspace_path: workspace, agent_kind: "codex"})

    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:macro-markets", %{})
    {:ok, _archived} = History.archive_thread(original.id)

    replacement_workspace = workspace <> "-replacement"
    File.mkdir_p!(replacement_workspace)
    on_exit(fn -> File.rm_rf!(replacement_workspace) end)

    {:ok, replacement} =
      History.ensure_thread("macro-markets", %{
        workspace_path: replacement_workspace,
        agent_kind: "codex"
      })

    ref = push(socket, "send_message", %{"message" => "stay exact", "context" => %{}})
    assert_reply(ref, :error, %{reason: reason})
    assert reason =~ "active"
    assert History.list_messages_for_thread(replacement.id) == []
  end

  test "goal_set_objective validates the socket thread provider before updating metadata", %{
    socket: socket
  } do
    workspace =
      Path.join(System.tmp_dir!(), "unsupported-channel-goal-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    {:ok, thread} =
      History.create_freeform_thread(%{
        workspace_path: workspace,
        agent_kind: "cursor"
      })

    {:ok, enabled} = History.set_goal_mode(thread, true, "Original")
    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:thread:#{enabled.id}", %{})

    ref = push(socket, "goal_set_objective", %{"objective" => "Must not persist"})
    assert_reply(ref, :error, %{reason: reason})
    assert reason =~ "Codex or Claude"
    assert {:ok, unchanged} = History.get_thread(enabled.id)
    assert History.thread_goal_objective(unchanged) == "Original"
  end

  test "goal_clear removes the authoring goal", %{socket: socket} do
    {:ok, %{thread_id: thread_id}, socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(socket, "set_goal_mode", %{"goal_mode" => true, "objective" => "Audit"})
    assert_reply(ref, :ok, %{enabled: true, objective: "Audit", thread_id: ^thread_id})

    ref = push(socket, "goal_clear", %{})
    assert_reply(ref, :ok, %{enabled: false})

    assert {:ok, thread} = History.get_thread(thread_id)
    assert thread.metadata["goal_mode"] == false
    refute Map.has_key?(thread.metadata, "goal_objective")
  end

  test "goal_set_objective updates the authoring objective", %{socket: socket} do
    enable_codex_goals!()
    {:ok, %{thread_id: thread_id}, socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(socket, "set_goal_mode", %{"goal_mode" => true})
    assert_reply(ref, :ok, %{enabled: true})

    {:ok, before_edit} = History.get_thread(thread_id)
    revision_before_edit = History.thread_goal_revision(before_edit)

    ref = push(socket, "goal_set_objective", %{"objective" => "Audit the admin UI"})
    assert_reply(ref, :ok, %{enabled: true, objective: "Audit the admin UI"})

    assert {:ok, thread} = History.get_thread(thread_id)
    assert thread.metadata["goal_objective"] == "Audit the admin UI"
    assert String.to_integer(History.thread_goal_revision(thread)) > String.to_integer(revision_before_edit)
  end

  test "goal_set_objective rejects edits while a turn is running without changing metadata", %{
    socket: socket
  } do
    enable_codex_goals!()
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, _opts ->
      send(test_pid, {:objective_runner_started, self()})

      receive do
        :finish -> {:ok, %{assistant_message: "done", codex_thread_id: "ct", turn_id: "t", tool_calls: []}}
      end
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :assistant_runner) end)

    {:ok, %{thread_id: thread_id}, socket} =
      subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(socket, "set_goal_mode", %{"goal_mode" => true, "objective" => "Original"})
    assert_reply(ref, :ok)

    ref = push(socket, "send_message", %{"message" => "work", "context" => %{}})
    assert_reply(ref, :ok)
    assert_receive {:objective_runner_started, runner_pid}

    ref = push(socket, "goal_set_objective", %{"objective" => "Unsafe edit"})
    assert_reply(ref, :error, %{reason: "assistant is busy"})

    {:ok, unchanged} = History.get_thread(thread_id)
    assert History.thread_goal_objective(unchanged) == "Original"

    send(runner_pid, :finish)
    assert_push("assistant_completed", %{})
  end

  test "goal mutations from another socket are rejected while the thread turn is active", %{socket: socket} do
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, _opts ->
      send(test_pid, {:cross_socket_runner, self()})

      receive do
        :finish ->
          {:ok, %{assistant_message: "done", codex_thread_id: "ct", turn_id: "t", tool_calls: []}}
      end
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :assistant_runner) end)

    {:ok, %{thread_id: thread_id}, first} =
      subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    {:ok, _payload, second} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join("assistant:thread:#{thread_id}", %{})

    ref = push(first, "set_goal_mode", %{"goal_mode" => true, "objective" => "Audit"})
    assert_reply(ref, :ok)
    ref = push(first, "send_message", %{"message" => "work", "context" => %{}})
    assert_reply(ref, :ok)
    assert_receive {:cross_socket_runner, pid}

    ref = push(second, "goal_clear", %{})
    assert_reply(ref, :error, %{reason: "assistant is busy"})

    send(pid, :finish)
    assert_push("assistant_completed", %{})
  end

  test "cross-tab pause preflight fails before interrupting the running turn", %{socket: socket} do
    enable_codex_goals!()
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, _opts ->
      send(test_pid, {:pause_preflight_runner, self()})

      receive do
        {:agent_interrupt} ->
          send(test_pid, :unexpected_pause_interrupt)
          {:error, :interrupted}

        :finish ->
          {:ok, %{assistant_message: "done", codex_thread_id: "ct", turn_id: "t", tool_calls: []}}
      end
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :assistant_runner) end)

    {:ok, %{thread_id: thread_id}, first} =
      subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(first, "set_goal_mode", %{"goal_mode" => true, "objective" => "Audit"})
    assert_reply(ref, :ok)

    {:ok, _payload, second} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join("assistant:thread:#{thread_id}", %{})

    ref = push(first, "send_message", %{"message" => "work", "context" => %{}})
    assert_reply(ref, :ok)
    assert_receive {:pause_preflight_runner, runner_pid}

    ref = push(second, "goal_pause", %{})
    assert_reply(ref, :error, %{reason: reason})
    assert reason =~ "Codex thread"
    refute_receive :unexpected_pause_interrupt, 100

    assert {:ok, running_thread} = History.get_thread(thread_id)
    assert History.current_turn(running_thread)["status"] == "running"

    send(runner_pid, :finish)
    assert_push("assistant_completed", %{})
  end

  test "goal controls require an enabled authoring goal", %{socket: socket} do
    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(socket, "goal_clear", %{})
    assert_reply(ref, :error, %{})
  end

  test "goal_resume kicks an autonomous continuation batch that streams into the chat", %{socket: socket} do
    runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_assistant_delta).("Continuing the goal")

      {:ok,
       %{
         assistant_message: "Continued the authoring goal.",
         codex_thread_id: "thread-goal",
         turn_id: "turn-goal",
         tool_calls: []
       }}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :assistant_runner) end)

    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(socket, "set_goal_mode", %{"goal_mode" => true, "objective" => "Audit"})
    assert_reply(ref, :ok, %{goal_mode: true})

    ref = push(socket, "goal_resume", %{})
    assert_reply(ref, :ok)

    assert_push("assistant_delta", %{delta: "Continuing the goal"})
    assert_push("assistant_completed", %{message: %{role: "assistant", content: "Continued the authoring goal."}})
  end

  test "goal_resume continues an issue session on the exact socket thread", %{socket: socket} do
    runner = fn _workspace, _prompt, _issue, _opts ->
      {:ok,
       %{
         assistant_message: "Continued the issue session goal.",
         codex_thread_id: "thread-session-goal",
         turn_id: "turn-session-goal",
         tool_calls: []
       }}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :assistant_runner) end)

    workspace = Workspace.path_for_issue("MAC-SESSION")
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    {:ok, thread} =
      History.create_issue_session_thread("macro-markets", "MAC-SESSION", %{
        workspace_path: workspace,
        agent_kind: "codex"
      })

    File.mkdir_p!(thread.workspace_path)
    {:ok, enabled} = History.set_goal_mode(thread, true, "Audit")

    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:thread:#{enabled.id}", %{})

    ref = push(socket, "goal_resume", %{})
    assert_reply(ref, :ok)

    assert_push("assistant_completed", %{
      message: %{role: "assistant", content: "Continued the issue session goal."}
    })
  end

  test "goal_resume continues every non-issue scope on its exact thread", %{socket: _socket} do
    on_exit(fn -> Application.delete_env(:symphony_elixir, :assistant_runner) end)

    for scope <- ~w(project project_session project_explore freeform kb) do
      workspace =
        Path.join(System.tmp_dir!(), "resume-goal-#{scope}-#{System.unique_integer([:positive])}")

      File.mkdir_p!(workspace)
      on_exit(fn -> File.rm_rf!(workspace) end)

      attrs = %{
        scope: scope,
        status: "active",
        workspace_path: workspace,
        agent_kind: "codex",
        project_slug: if(scope == "freeform", do: nil, else: "macro-markets")
      }

      {:ok, thread} = %Thread{} |> Thread.changeset(attrs) |> Repo.insert()
      {:ok, enabled} = History.set_goal_mode(thread, true, "Continue #{scope}")
      test_pid = self()

      runner = fn runner_workspace, prompt, _issue, opts ->
        send(
          test_pid,
          {:continued_scope, scope, runner_workspace, prompt, Keyword.get(opts, :assistant_thread_id)}
        )

        {:ok,
         %{
           assistant_message: "Continued #{scope}",
           codex_thread_id: "thread-#{scope}",
           turn_id: "turn-#{scope}",
           tool_calls: []
         }}
      end

      Application.put_env(:symphony_elixir, :assistant_runner, runner)

      {:ok, _payload, scope_socket} =
        socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
        |> subscribe_and_join("assistant:thread:#{enabled.id}", %{})

      ref = push(scope_socket, "goal_resume", %{})
      assert_reply(ref, :ok)

      assert_receive {:continued_scope, ^scope, ^workspace, prompt, thread_id}
      assert thread_id == enabled.id
      assert prompt =~ "Continue pursuing the authoring goal"
      refute prompt =~ "dispatch the orchestrator"
      assert_push("assistant_completed", %{message: %{role: "assistant", content: content}})
      assert content == "Continued #{scope}"
      assert History.list_messages_for_thread(enabled.id) |> Enum.map(& &1.role) == ["assistant"]
    end
  end

  test "goal turn pushes native goal updates and fans streaming to observer tabs", %{socket: socket} do
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      send(test_pid, {:runner_started, self()})

      receive do
        :stream -> Keyword.fetch!(opts, :on_assistant_delta).("Live goal output")
        :finish -> :ok
      end

      Keyword.fetch!(opts, :on_goal_updated).(%{
        "objective" => "Audit",
        "status" => "active",
        "timeUsedSeconds" => 42,
        "tokensUsed" => 1000
      })

      {:ok,
       %{
         assistant_message: "Done",
         codex_thread_id: "thread-goal",
         turn_id: "turn-goal",
         tool_calls: [],
         assistant_chat_message: %{role: "assistant", content: "Done", tool_calls: []}
       }}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :assistant_runner) end)

    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(socket, "set_goal_mode", %{"goal_mode" => true, "objective" => "Audit"})
    assert_reply(ref, :ok, %{goal_mode: true})

    ref = push(socket, "send_message", %{"message" => "Start audit", "context" => %{}})
    assert_reply(ref, :ok, %{})

    assert_receive {:runner_started, runner_pid}, 2_000

    {:ok, _join_payload, _observer} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:issue:macro-markets:MAC-1")

    send(runner_pid, :stream)
    assert_push("assistant_delta", %{delta: "Live goal output"})
    assert_push("assistant_delta", %{delta: "Live goal output"})

    send(runner_pid, :finish)

    assert_push("goal_status", %{running: true, goal: %{timeUsedSeconds: 42, tokensUsed: 1000}})
    assert_push("assistant_completed", %{message: %{role: "assistant", content: "Done"}})
    assert_push("history_synced", %{messages: _})

    assert_push("assistant_completed", %{message: %{role: "assistant", content: "Done"}})
    assert_push("history_synced", %{messages: _})
  end

  test "mid-turn Goal activation persists, publishes exact-thread change, and auto-continues", %{
    socket: socket
  } do
    test_pid = self()
    Application.put_env(:symphony_elixir, :claude_goal_supported_override, true)
    Application.put_env(:symphony_elixir, :claude_goal_preflight_override, :ok)

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :claude_goal_supported_override)
      Application.delete_env(:symphony_elixir, :claude_goal_preflight_override)
    end)

    {:ok, thread} = History.ensure_issue_thread("macro-markets", "MAC-1")
    {:ok, thread} = History.update_thread(thread, %{agent_kind: "claude"})

    {:ok, calls} = Agent.start_link(fn -> 0 end)

    runner = fn _workspace, _prompt, _issue, opts ->
      call = Agent.get_and_update(calls, fn count -> {count + 1, count + 1} end)
      send(test_pid, {:goal_runner_call, call, self(), opts})

      if call == 1 do
        receive do
          :finish -> :ok
        end
      end

      {:ok,
       %{
         assistant_message: "turn #{call}",
         codex_thread_id: nil,
         turn_id: "turn-#{call}",
         tool_calls: [],
         assistant_chat_message: %{role: "assistant", content: "turn #{call}", tool_calls: []}
       }}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)

    {:ok, _payload, socket} =
      subscribe_and_join(socket, "assistant:thread:#{thread.id}", %{})

    ref = push(socket, "send_message", %{"message" => "ordinary turn", "context" => %{"agent" => "claude"}})
    assert_reply(ref, :ok)
    assert_receive {:goal_runner_call, 1, first_pid, first_opts}, 2_000
    refute Keyword.has_key?(first_opts, :goal_role)

    changed_ref =
      push(socket, "set_goal_mode", %{
        "goal_mode" => true,
        "objective" => "Finish the audit"
      })

    expected_thread_id = thread.id

    assert_reply(changed_ref, :ok, %{
      enabled: true,
      objective: "Finish the audit",
      thread_id: ^expected_thread_id
    })

    assert {:ok, changed} = History.get_thread(thread.id)
    assert History.thread_goal_objective(changed) == "Finish the audit"
    assert is_binary(History.thread_goal_revision(changed))

    {:ok, rejoined_payload, _rejoined_socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join("assistant:thread:#{thread.id}", %{})

    assert rejoined_payload.goal_mode == true
    assert rejoined_payload.goal_objective == "Finish the audit"
    assert rejoined_payload.goal_status.revision == History.thread_goal_revision(changed)
    assert is_integer(rejoined_payload.goal_status.request_order)

    send(first_pid, :finish)

    assert_push("authoring_goal_changed", %{thread_id: thread_id})
    assert thread_id == thread.id
    assert_receive {:goal_runner_call, 2, _second_pid, second_opts}, 2_000
    assert Keyword.get(second_opts, :goal_role) == :authoring
  end

  test "goal status ordering rejects stale revisions and uses request order for ties", %{socket: socket} do
    {:ok, thread} = History.ensure_issue_thread("macro-markets", "MAC-1")
    assert {:ok, _enabled} = History.set_goal_mode(thread, true, "Initial")

    {:ok, %{thread_id: thread_id}, socket} =
      subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    send(socket.channel_pid, {
      :goal_status_updated,
      %{
        thread_id: thread_id,
        enabled: true,
        objective: "Newest",
        revision: "2",
        request_order: 10,
        status: "running"
      }
    })

    assert_push("goal_status", %{objective: "Newest", revision: "2", request_order: 10})

    send(socket.channel_pid, {
      :goal_status_updated,
      %{
        thread_id: thread_id,
        enabled: true,
        objective: "Stale",
        revision: "1",
        request_order: 99,
        status: "paused"
      }
    })

    refute_push("goal_status", %{objective: "Stale"}, 100)

    send(socket.channel_pid, {
      :goal_status_updated,
      %{
        thread_id: thread_id,
        enabled: true,
        objective: "Same revision, newer request",
        revision: "2",
        request_order: 11,
        status: "blocked"
      }
    })

    assert_push("goal_status", %{
      thread_id: ^thread_id,
      objective: "Same revision, newer request",
      revision: "2",
      request_order: 11
    })
  end

  test "authoritative error snapshot retains the thread provider", %{socket: socket} do
    workspace =
      Path.join(System.tmp_dir!(), "provider-error-goal-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    {:ok, thread} =
      History.create_freeform_thread(%{
        workspace_path: workspace,
        agent_kind: "codex"
      })

    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:thread:#{thread.id}", %{})
    Repo.delete!(thread)

    ref = push(socket, "goal_status", %{})

    assert_reply(ref, :ok, %{
      thread_id: thread_id,
      provider: "codex",
      enabled: false,
      error: error
    })

    assert thread_id == thread.id
    assert is_binary(error)
  end

  test "goal_resume requires an enabled authoring goal", %{socket: socket} do
    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(socket, "goal_resume", %{})
    assert_reply(ref, :error, %{})
  end

  test "join reattaches to a persisted turn already in flight for the thread", %{socket: socket} do
    {:ok, %{thread_id: thread_id}, _socket} =
      subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    assert {:ok, thread} = History.get_thread(thread_id)
    assert {:ok, _enabled} = History.set_goal_mode(thread, true, "Audit")

    test_pid = self()

    run = fn ->
      send(test_pid, {:rejoin_worker, self()})
      receive do: (:finish -> {:ok, %{assistant_message: "done"}})
    end

    assert {:ok, %{pid: worker}} =
             TurnManager.start_turn(thread_id, "continue goal", run: run, reply_to: self())

    assert_receive {:rejoin_worker, ^worker}

    {:ok, payload, _socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join("assistant:issue:macro-markets:MAC-1", %{})

    assert payload.turn_running == true
    assert payload.last_turn.status == "running"
    assert is_integer(payload.turn_elapsed_seconds)
    assert payload.turn_elapsed_seconds >= 0

    send(worker, :finish)
    assert_receive {:assistant_turn_finished, _generation, {:ok, _result}}
  end

  test "join reports no goal run when the thread is idle", %{socket: socket} do
    {:ok, payload, _socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    assert payload.turn_running == false
    assert payload.turn_elapsed_seconds == nil
  end

  test "join exposes last_turn and a reloaded tab re-attaches a running turn" do
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_turn_started).("turn-attach")
      send(test_pid, {:runner_started, self()})
      receive do: (:finish -> :ok)
      {:ok, %{assistant_message: "ok", codex_thread_id: "ct-attach", turn_id: "turn-attach", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)
    topic = "assistant:issue:macro-markets:DIS-1"

    {:ok, _join, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    ref = push(socket, "send_message", %{"message" => "go", "context" => %{}})
    assert_reply(ref, :ok, %{})
    assert_receive {:runner_started, runner_pid}, 2_000

    {:ok, join_payload, _socket2} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    assert %{last_turn: %{status: "running"}} = join_payload
    assert join_payload.turn_running == true

    send(runner_pid, :finish)
    assert_push("assistant_completed", %{message: %{role: "assistant"}})
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

  test "dispatch_codex forwards the selected execution mode", %{socket: socket} do
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Dispatch me", "status" => "Todo"})
    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    ref = push(socket, "dispatch_codex", %{"mode" => "yolo"})
    assert_reply(ref, :ok, %{goal_mode: false})

    assert {:ok, settings} = Context.get_agent_settings("macro-markets", "MAC-1")
    assert settings.mode == "yolo"
  end

  test "dispatch_codex does not carry an execution goal just because the authoring goal is enabled",
       %{socket: socket} do
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Dispatch me", "status" => "Todo"})
    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:issue:macro-markets:MAC-1", %{})

    # Enabling the Authoring (chat) goal must NOT auto-promote into an orchestrator execution goal.
    ref = push(socket, "set_goal_mode", %{"goal_mode" => true, "objective" => "Audit only"})
    assert_reply(ref, :ok, %{goal_mode: true})

    # A plain dispatch (no explicit goal_mode) stays decoupled from the authoring goal.
    ref = push(socket, "dispatch_codex", %{})
    assert_reply(ref, :ok, %{goal_mode: false})

    assert {:ok, issue} = Context.get_issue("macro-markets", "MAC-1")
    assert issue.status.name == "In Progress"
    assert issue.agent_goal in [nil, ""]
  end

  test "dispatch_codex rejects non-issue assistant threads", %{socket: socket} do
    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:macro-markets", %{})

    ref = push(socket, "dispatch_codex", %{})
    assert_reply(ref, :error, %{reason: "this action is only supported for issue assistant threads"})
  end

  test "freeform send_message routes through send_message_to_thread", %{socket: socket} do
    Application.put_env(:symphony_elixir, :assistant_runner, fn _w, _p, _i, _o ->
      {:ok, %{assistant_message: "freeform reply", tool_calls: []}}
    end)

    # Scope the freeform workspace to a unique empty dir. Passing the shared
    # `System.tmp_dir!()` root makes ThreadDocuments fingerprint the entire /tmp
    # tree, which stalls the turn and the assistant_completed push never lands.
    workspace_path = Path.join(System.tmp_dir!(), "symphony-assistant-freeform-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace_path)
    on_exit(fn -> File.rm_rf!(workspace_path) end)

    {:ok, thread} = History.create_freeform_thread(%{title: "F", workspace_path: workspace_path})
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

  test "resume_turn re-dispatches the interrupted current turn as a resume turn" do
    test_pid = self()

    runner = fn _workspace, prompt, _issue, opts ->
      send(test_pid, {:resumed_prompt, prompt})
      Keyword.fetch!(opts, :on_turn_started).("turn-resumed")
      {:ok, %{assistant_message: "resumed ok", codex_thread_id: "ct-r", turn_id: "turn-resumed", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)
    topic = "assistant:issue:macro-markets:DIS-4"

    {:ok, join_payload, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    thread_id = join_payload.thread_id
    {:ok, thread} = History.get_thread(thread_id)
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "original work"})
    {:ok, _interrupted} = History.interrupt_turn_state(thread, "serve_restart")

    ref = push(socket, "resume_turn", %{})
    assert_reply(ref, :ok, %{})

    assert_receive {:resumed_prompt, prompt}, 2_000
    assert prompt =~ "original work"
    assert_push("assistant_completed", %{message: %{role: "assistant", content: "resumed ok"}})

    {:ok, after_thread} = History.get_thread(thread_id)
    assert History.current_turn(after_thread)["trigger"] == "resume"
  end

  test "resume_turn rejects when the current turn is not interrupted" do
    topic = "assistant:issue:macro-markets:DIS-5"

    {:ok, join_payload, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, topic)

    {:ok, thread} = History.get_thread(join_payload.thread_id)
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "done"})
    {:ok, _completed} = History.complete_turn_state(thread, %{})

    ref = push(socket, "resume_turn", %{})
    assert_reply(ref, :error, %{reason: _})
  end

  test "join caps oversized tool output and fetch_tool_output returns the full value" do
    {:ok, thread} =
      History.ensure_issue_thread("macro-markets", "MAC-1", %{
        workspace_path: Workspace.path_for_issue("MAC-1")
      })

    big_output = String.duplicate("z", 20_000)

    {:ok, message} =
      History.append_message(thread, %{
        role: "assistant",
        content: "ran shell",
        tool_calls: [
          %{"id" => "call-big", "name" => "shell", "output" => big_output, "status" => "complete"}
        ]
      })

    {:ok, join_payload, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:thread:#{thread.id}")

    [joined_call] = List.last(join_payload.messages).tool_calls
    assert joined_call["output_truncated"] == true
    assert joined_call["output_byte_size"] == 20_000
    assert byte_size(joined_call["output"]) < 20_000

    ref = push(socket, "fetch_tool_output", %{"message_id" => message.id, "tool_call_id" => "call-big"})
    assert_reply(ref, :ok, %{output: ^big_output, output_byte_size: 20_000})

    ref = push(socket, "fetch_tool_output", %{"message_id" => message.id, "tool_call_id" => "missing"})
    assert_reply(ref, :error, %{reason: _})
  end

  test "load_older_messages returns an older page with pagination metadata" do
    {:ok, thread} =
      History.ensure_issue_thread("macro-markets", "MAC-1", %{
        workspace_path: Workspace.path_for_issue("MAC-1")
      })

    for n <- 1..3 do
      {:ok, _} = History.append_message(thread, %{role: "user", content: "m#{n}"})
    end

    {:ok, join_payload, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:thread:#{thread.id}")

    assert join_payload.has_more_before == false
    assert join_payload.oldest_sequence == 1

    ref = push(socket, "load_older_messages", %{"before_sequence" => 2})
    assert_reply(ref, :ok, %{messages: older, has_more_before: false, oldest_sequence: 1})
    assert Enum.map(older, & &1.content) == ["m1"]

    ref = push(socket, "load_older_messages", %{})
    assert_reply(ref, :error, %{reason: _})
  end

  defp enable_codex_goals! do
    root =
      Path.join(
        System.tmp_dir!(),
        "assistant-channel-goals-#{System.unique_integer([:positive])}"
      )

    workflow_file = Path.join(root, "WORKFLOW.md")
    File.mkdir_p!(root)

    TestSupport.write_workflow_file!(workflow_file,
      tracker_kind: "local",
      workspace_root: root
    )

    workflow_file
    |> File.read!()
    |> String.replace("codex:\n", "codex:\n  goals_enabled: true\n", global: false)
    |> then(&File.write!(workflow_file, &1))

    Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      File.rm_rf!(root)
    end)

    :ok
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
      SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)

  defp restore_app_env(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore_app_env(key, value), do: Application.put_env(:symphony_elixir, key, value)
end
