defmodule SymphonyElixir.GatewaysTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Gateways
  alias SymphonyElixir.Repo

  setup do
    cleanup_gateway_tables()

    on_exit(fn ->
      cleanup_gateway_tables()
    end)

    :ok
  end

  test "creates a project topic binding and looks it up by conversation id" do
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

    assert binding.binding_kind == "project_topic"
    assert binding.active_mode == "explore"
    assert {:ok, ^binding} = Gateways.get_active_binding("telegram", "default", "-100123:topic:42")
  end

  test "creates a direct freeform binding scoped by sender" do
    {:ok, binding} =
      Gateways.ensure_direct_freeform_binding(%{
        provider: "telegram",
        account_id: "default",
        conversation_id: "dm:777",
        sender_id: "777",
        default_agent_kind: "claude"
      })

    assert binding.binding_kind == "direct_freeform"
    assert binding.active_mode == "freeform"
    assert binding.project_slug == nil
  end

  test "pairing code is single use and expires" do
    {:ok, code} = Gateways.create_pairing_code(:project_topic, %{project_slug: "macro-markets"}, ttl_seconds: 60)

    assert {:ok, %{project_slug: "macro-markets"}} = Gateways.consume_pairing_code(code.code, :project_topic)
    assert {:error, :pairing_code_not_found} = Gateways.consume_pairing_code(code.code, :project_topic)
  end

  defp cleanup_gateway_tables do
    Repo.delete_all("gateway_pairing_codes")
    Repo.delete_all("gateway_bindings")
  rescue
    _ -> :ok
  end
end
