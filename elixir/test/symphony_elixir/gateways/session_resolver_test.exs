defmodule SymphonyElixir.Gateways.SessionResolverTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.Thread
  alias SymphonyElixir.Gateways
  alias SymphonyElixir.Gateways.{Binding, PairingCode, SessionResolver}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    Repo.delete_all(PairingCode)
    Repo.delete_all(Binding)
    Repo.delete_all(Thread)

    on_exit(fn ->
      Repo.delete_all(PairingCode)
      Repo.delete_all(Binding)
      Repo.delete_all(Thread)
    end)

    :ok
  end

  test "direct bindings create freeform threads" do
    {:ok, binding} =
      Gateways.ensure_direct_freeform_binding(%{
        provider: "telegram",
        account_id: "default",
        conversation_id: "dm:777",
        sender_id: "777",
        default_agent_kind: "codex"
      })

    assert {:ok, thread, updated_binding} = SessionResolver.ensure_thread(binding)
    assert thread.scope == "freeform"
    assert updated_binding.active_thread_id == thread.id
  end

  test "project topic bindings create project explore threads" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

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

    assert {:ok, thread, updated_binding} = SessionResolver.ensure_thread(binding)
    assert thread.scope == "project_explore"
    assert thread.project_slug == "macro-markets"
    assert updated_binding.active_thread_id == thread.id
  end

  test "project topic bindings reuse an existing active project explore thread" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, existing_thread} = SymphonyElixir.Assistant.History.ensure_project_explore_thread("macro-markets")

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

    assert {:ok, thread, updated_binding} = SessionResolver.ensure_thread(binding)
    assert thread.id == existing_thread.id
    assert updated_binding.active_thread_id == existing_thread.id
  end
end
