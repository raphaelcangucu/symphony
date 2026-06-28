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
      {:ok, %{assistant_message: "freeform reply", tool_calls: []}}
    end

    assert {:ok, :sent} =
             Router.handle_message(direct_message("777", "hello freeform"),
               adapter: __MODULE__.FakeAdapter,
               runner: runner
             )
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
      {:ok, %{assistant_message: "project reply", tool_calls: []}}
    end

    assert {:ok, :sent} = Router.handle_message(topic_message("inspect repo"), adapter: __MODULE__.FakeAdapter, runner: runner)
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

  defp cleanup do
    Repo.delete_all(PairingCode)
    Repo.delete_all(Binding)
    Repo.delete_all(Thread)
    Repo.delete_all(Setting)
  end

  defmodule FakeAdapter do
    def send_text(_message, _text, _opts), do: :ok
    def send_typing(_message, _opts), do: :ok
  end
end
