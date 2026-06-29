defmodule SymphonyElixirWeb.Tracker.ProjectGatewayControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Assistant.Thread
  alias SymphonyElixir.Gateways
  alias SymphonyElixir.Gateways.{Binding, PairingCode}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Setting

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    cleanup()
    previous = System.get_env(@token_env)
    System.put_env(@token_env, "test-token")
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    on_exit(fn ->
      cleanup()
      restore_env(previous)
    end)
    :ok
  end

  test "GET /projects/:slug/gateways/telegram returns null binding when unpaired" do
    conn = get(authed_conn(), "/api/tracker/v1/projects/macro-markets/gateways/telegram")

    assert %{"data" => %{"binding" => nil, "globalConfigured" => false}} = json_response(conn, 200)
  end

  test "POST /projects/:slug/gateways/telegram/pairing_code returns pair command" do
    conn = post(authed_conn(), "/api/tracker/v1/projects/macro-markets/gateways/telegram/pairing_code")

    assert %{"data" => %{"command" => command, "code" => code}} = json_response(conn, 200)
    assert command == "/symphony_pair #{code}"
  end

  test "reset and delete operate on the project topic binding" do
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_group_chat_id", "-100123")

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

    {:ok, thread} =
      %Thread{}
      |> Thread.changeset(%{
        scope: "project_explore",
        project_slug: "macro-markets",
        workspace_path: "/tmp/macro-markets",
        status: "active"
      })
      |> Repo.insert()

    {:ok, _binding} = Gateways.update_binding(binding, %{active_thread_id: thread.id})

    conn = post(authed_conn(), "/api/tracker/v1/projects/macro-markets/gateways/telegram/reset")
    assert %{"data" => %{"binding" => %{"activeThreadId" => nil}}} = json_response(conn, 200)

    conn = delete(authed_conn(), "/api/tracker/v1/projects/macro-markets/gateways/telegram")
    assert %{"data" => %{"binding" => %{"status" => "archived"}}} = json_response(conn, 200)
  end

  defp authed_conn do
    build_conn() |> put_req_header("authorization", "Bearer test-token")
  end

  defp restore_env(nil), do: System.delete_env(@token_env)
  defp restore_env(value), do: System.put_env(@token_env, value)

  defp cleanup do
    Repo.delete_all(PairingCode)
    Repo.delete_all(Binding)
    Repo.delete_all(Thread)
    Repo.delete_all(Setting)
  end
end
