defmodule SymphonyElixir.Gateways.RouterDispatchTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.Thread
  alias SymphonyElixir.Gateways
  alias SymphonyElixir.Gateways.{Binding, InboundMessage, PairingCode, Router}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Setting

  setup do
    cleanup()
    on_exit(&cleanup/0)
    :ok
  end

  test "dispatches allowed direct plain text to freeform assistant" do
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_dm_allowed_user_ids", ["777"])

    runner = fn _workspace, prompt, _issue, _opts ->
      assert prompt =~ "Current user message:"
      assert prompt =~ "hello freeform"

      {:ok,
       %{
         assistant_message: "freeform reply",
         conversation_id: "freeform-conversation",
         run_id: "freeform-run",
         tool_calls: []
       }}
    end

    assert {:ok, :sent} =
             Router.handle_message(direct_message("777", "hello freeform"),
               adapter: __MODULE__.FakeAdapter,
               runner: runner
             )
  end

  test "serializes concurrent direct messages and resumes the first Codex thread" do
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_dm_allowed_user_ids", ["777"])

    test_pid = self()

    runner = fn _workspace, prompt, _issue, opts ->
      if prompt =~ "Current user message:\nfirst" do
        send(test_pid, {:first_turn_started, self()})
        receive do: (:release_first_turn -> :ok)

        {:ok,
         %{
           assistant_message: "first reply",
           conversation_id: "shared-codex-thread",
           run_id: "turn-1",
           tool_calls: []
         }}
      else
        send(test_pid, {:second_turn_started, opts})

        {:ok,
         %{
           assistant_message: "second reply",
           conversation_id: "shared-codex-thread",
           run_id: "turn-2",
           tool_calls: []
         }}
      end
    end

    first =
      Task.async(fn ->
        Router.handle_message(direct_message("777", "first"),
          adapter: __MODULE__.FakeAdapter,
          runner: runner
        )
      end)

    assert_receive {:first_turn_started, first_worker}, 1_000

    second =
      Task.async(fn ->
        Router.handle_message(direct_message("777", "second"),
          adapter: __MODULE__.FakeAdapter,
          runner: runner
        )
      end)

    refute_receive {:second_turn_started, _opts}, 100
    send(first_worker, :release_first_turn)

    assert {:ok, :sent} = Task.await(first, 1_000)
    assert_receive {:second_turn_started, second_opts}, 1_000

    assert Keyword.fetch!(second_opts, :conversation_ref) ==
             %SymphonyElixir.Agent.ConversationRef{
               provider: "codex",
               conversation_id: "shared-codex-thread"
             }

    assert {:ok, :sent} = Task.await(second, 1_000)
  end

  test "dispatches topic plain text to project explore assistant" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_group_chat_id", "-100123")
    Settings.put("gateways", "telegram_allowed_user_ids", ["777"])

    {:ok, _binding} =
      Gateways.upsert_project_topic_binding(%{
        provider: "telegram",
        account_id: "default",
        project_slug: "macro-markets",
        conversation_id: "-100123:topic:42",
        parent_conversation_id: "-100123",
        thread_id: "42",
        default_agent_kind: "codex",
        default_mode: "explore"
      })

    runner = fn _workspace, prompt, _issue, _opts ->
      assert prompt =~ "project explore assistant"
      assert prompt =~ "inspect repo"

      {:ok,
       %{
         assistant_message: "project reply",
         conversation_id: "project-conversation",
         run_id: "project-run",
         tool_calls: []
       }}
    end

    assert {:ok, :sent} = Router.handle_message(topic_message("inspect repo"), adapter: __MODULE__.FakeAdapter, runner: runner)
  end

  test "replies when a freeform turn fails instead of staying silent" do
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_dm_allowed_user_ids", ["777"])

    runner = fn _workspace, _prompt, _issue, _opts ->
      {:error, {:invalid_workspace_cwd, :outside_workspace_root, "/tmp/stale", "/home/code/workspaces"}}
    end

    assert {:error, {:invalid_workspace_cwd, :outside_workspace_root, _, _}} =
             Router.handle_message(direct_message("777", "are you online?"),
               adapter: __MODULE__.FakeAdapter,
               runner: runner
             )

    assert_received {:sent_text, text}
    assert text =~ "could not complete"
    assert text =~ "/new"
  end

  test "dispatches General group plain text to a shared freeform session" do
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_group_chat_id", "-100123")
    Settings.put("gateways", "telegram_allowed_user_ids", ["777", "888"])

    runner = fn _workspace, prompt, _issue, _opts ->
      assert prompt =~ "Current user message:"
      assert prompt =~ "hello from general"

      {:ok,
       %{
         assistant_message: "general reply",
         conversation_id: "general-conversation",
         run_id: "general-run",
         tool_calls: []
       }}
    end

    assert {:ok, :sent} =
             Router.handle_message(group_message("777", "hello from general"),
               adapter: __MODULE__.FakeAdapter,
               runner: runner
             )

    assert {:ok, binding} = Gateways.get_active_binding("telegram", "default", "-100123")
    assert binding.binding_kind == "group_freeform"
    first_thread_id = binding.active_thread_id

    assert {:ok, :sent} =
             Router.handle_message(group_message("888", "second speaker"),
               adapter: __MODULE__.FakeAdapter,
               runner: fn _workspace, prompt, _issue, _opts ->
                 assert prompt =~ "second speaker"

                 {:ok,
                  %{
                    assistant_message: "shared reply",
                    conversation_id: "general-conversation",
                    run_id: "general-run-2",
                    tool_calls: []
                  }}
               end
             )

    assert {:ok, same_binding} = Gateways.get_active_binding("telegram", "default", "-100123")
    assert same_binding.active_thread_id == first_thread_id
  end

  test "dispatches Telegram General topic (thread_id 1) to the shared freeform session" do
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_group_chat_id", "-100123")
    Settings.put("gateways", "telegram_allowed_user_ids", ["777"])

    runner = fn _workspace, prompt, _issue, _opts ->
      assert prompt =~ "general topic"

      {:ok,
       %{
         assistant_message: "ok",
         conversation_id: "general-topic-conversation",
         run_id: "general-topic-run",
         tool_calls: []
       }}
    end

    assert {:ok, :sent} =
             Router.handle_message(general_topic_message("general topic"),
               adapter: __MODULE__.FakeAdapter,
               runner: runner
             )

    assert {:ok, binding} = Gateways.get_active_binding("telegram", "default", "-100123")
    assert binding.binding_kind == "group_freeform"
  end

  defp direct_message(sender_id, text) do
    %InboundMessage{
      provider: "telegram",
      account_id: "default",
      conversation_kind: "direct",
      conversation_id: "dm:" <> sender_id,
      sender_id: sender_id,
      raw_text: text
    }
  end

  defp topic_message(text) do
    %InboundMessage{
      provider: "telegram",
      account_id: "default",
      conversation_kind: "topic",
      conversation_id: "-100123:topic:42",
      parent_conversation_id: "-100123",
      thread_id: "42",
      sender_id: "777",
      raw_text: text
    }
  end

  defp general_topic_message(text) do
    %InboundMessage{
      provider: "telegram",
      account_id: "default",
      conversation_kind: "topic",
      conversation_id: "-100123:topic:1",
      parent_conversation_id: "-100123",
      thread_id: "1",
      sender_id: "777",
      raw_text: text
    }
  end

  defp group_message(sender_id, text) do
    %InboundMessage{
      provider: "telegram",
      account_id: "default",
      conversation_kind: "group",
      conversation_id: "-100123",
      sender_id: sender_id,
      raw_text: text
    }
  end

  defp cleanup do
    Repo.delete_all(PairingCode)
    Repo.delete_all(Binding)
    Repo.delete_all(Thread)
    Repo.delete_all(Setting)
  end

  defmodule FakeAdapter do
    def send_text(_message, text, _opts) do
      send(self(), {:sent_text, text})
      :ok
    end

    def send_typing(_message, _opts), do: :ok
  end
end
