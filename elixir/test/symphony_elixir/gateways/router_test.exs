defmodule SymphonyElixir.Gateways.RouterTest do
  use ExUnit.Case, async: false

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

  test "blocks unauthorized direct messages" do
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_dm_allowed_user_ids", ["999"])

    message = direct_message("777", "hello")
    assert {:dropped, :unauthorized_direct_sender} = Router.handle_message(message, adapter: __MODULE__.FakeAdapter)
    refute_received {:sent_text, _}
  end

  test "creates a shared group_freeform binding for General group messages" do
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_group_chat_id", "-100123")
    Settings.put("gateways", "telegram_allowed_user_ids", ["777"])

    assert {:ok, :command} =
             Router.handle_message(group_message("/status"), adapter: __MODULE__.FakeAdapter)

    assert {:ok, binding} = Gateways.get_active_binding("telegram", "default", "-100123")
    assert binding.binding_kind == "group_freeform"
    assert binding.active_mode == "freeform"
    assert_received {:sent_text, text}
    assert text =~ "group_freeform"
  end

  test "replies when an unpaired project topic has no binding" do
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_group_chat_id", "-100123")
    Settings.put("gateways", "telegram_allowed_user_ids", ["777"])

    assert {:error, :binding_not_found} =
             Router.handle_message(topic_message("hello unpaired"), adapter: __MODULE__.FakeAdapter)

    assert_received {:sent_text, text}
    assert text =~ "not paired"
    assert text =~ "/symphony_pair"
  end

  test "allows direct status and creates direct binding" do
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_dm_allowed_user_ids", ["777"])

    message = direct_message("777", "/status")
    assert {:ok, :command} = Router.handle_message(message, adapter: __MODULE__.FakeAdapter)
    assert {:ok, binding} = Gateways.get_active_binding("telegram", "default", "dm:777")
    assert binding.binding_kind == "direct_freeform"
  end

  test "sets agent on project topic binding" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_group_chat_id", "-100123")
    Settings.put("gateways", "telegram_allowed_user_ids", ["777"])

    {:ok, binding} =
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

    assert {:ok, :command} = Router.handle_message(topic_message("/agent claude"), adapter: __MODULE__.FakeAdapter)
    assert {:ok, updated} = Gateways.get_active_binding("telegram", "default", binding.conversation_id)
    assert updated.default_agent_kind == "claude"
  end

  test "setup pairing command stores telegram group before a binding exists" do
    {:ok, code} = Gateways.create_pairing_code(:setup, %{}, ttl_seconds: 60)

    assert {:ok, :command} =
             Router.handle_message(group_message("/symphony_setup #{code.code}"), adapter: __MODULE__.FakeAdapter)

    assert Settings.get("gateways", "telegram_group_chat_id") == "-100123"
  end

  test "project pairing command creates topic binding before a binding exists" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_group_chat_id", "-100123")
    {:ok, code} = Gateways.create_pairing_code(:project_topic, %{project_slug: "macro-markets"}, ttl_seconds: 60)

    assert {:ok, :command} =
             Router.handle_message(topic_message("/symphony_pair #{code.code}"), adapter: __MODULE__.FakeAdapter)

    assert {:ok, binding} = Gateways.get_active_binding("telegram", "default", "-100123:topic:42")
    assert binding.project_slug == "macro-markets"
    assert binding.active_mode == "explore"
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

  defp group_message(text) do
    %InboundMessage{
      provider: "telegram",
      account_id: "default",
      conversation_kind: "group",
      conversation_id: "-100123",
      sender_id: "777",
      raw_text: text
    }
  end

  defp cleanup do
    Repo.delete_all(PairingCode)
    Repo.delete_all(Binding)
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
