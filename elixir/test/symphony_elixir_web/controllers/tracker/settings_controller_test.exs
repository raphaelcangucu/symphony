defmodule SymphonyElixirWeb.Tracker.SettingsControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Setting

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    Repo.delete_all(Setting)
    previous = System.get_env(@token_env)
    System.put_env(@token_env, "test-token")
    on_exit(fn -> restore_env(previous) end)
    :ok
  end

  defp restore_env(nil), do: System.delete_env(@token_env)
  defp restore_env(value), do: System.put_env(@token_env, value)

  defp authed_conn do
    build_conn() |> put_req_header("authorization", "Bearer test-token")
  end

  test "GET /api/tracker/v1/settings returns all groups with defaults" do
    conn = get(authed_conn(), "/api/tracker/v1/settings")

    assert %{
             "data" => %{
               "agents" => %{"default_agent_kind" => "codex"},
               "orchestrator" => %{
                 "require_symphony_label" => true,
                 "require_assignee_match" => true
               },
               "ui" => %{"locale" => "auto"}
             }
           } = json_response(conn, 200)
  end

  test "PUT /api/tracker/v1/settings/orchestrator toggles a boolean rule" do
    conn = put(authed_conn(), "/api/tracker/v1/settings/orchestrator", %{"require_symphony_label" => false})
    assert %{"data" => %{"require_symphony_label" => false}} = json_response(conn, 200)

    conn = get(authed_conn(), "/api/tracker/v1/settings")
    assert %{"data" => %{"orchestrator" => %{"require_symphony_label" => false}}} = json_response(conn, 200)
  end

  test "GET /api/tracker/v1/settings/identities lists every provider's connection state" do
    conn = get(authed_conn(), "/api/tracker/v1/settings/identities")

    assert %{"data" => statuses} = json_response(conn, 200)
    providers = statuses |> Enum.map(& &1["provider"]) |> Enum.sort()
    assert providers == ["github", "jira", "linear"]

    Enum.each(statuses, fn status ->
      assert is_boolean(status["configured"])
      assert is_boolean(status["connected"])
    end)
  end

  test "PUT /api/tracker/v1/settings/agents updates and echoes the group" do
    conn = put(authed_conn(), "/api/tracker/v1/settings/agents", %{"default_agent_kind" => "claude"})

    assert %{"data" => %{"default_agent_kind" => "claude"}} = json_response(conn, 200)

    conn = get(authed_conn(), "/api/tracker/v1/settings")
    assert %{"data" => %{"agents" => %{"default_agent_kind" => "claude"}}} = json_response(conn, 200)
  end

  test "PUT /api/tracker/v1/settings/ui updates locale" do
    conn = put(authed_conn(), "/api/tracker/v1/settings/ui", %{"locale" => "pt-BR"})
    assert %{"data" => %{"locale" => "pt-BR"}} = json_response(conn, 200)
  end

  test "PUT rejects invalid values with 422 and unknown groups with 404" do
    conn = put(authed_conn(), "/api/tracker/v1/settings/agents", %{"default_agent_kind" => "gemini"})
    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)

    conn = put(authed_conn(), "/api/tracker/v1/settings/nope", %{"x" => 1})
    assert json_response(conn, 404)
  end

  test "requests without the bearer token are unauthorized" do
    conn = get(build_conn(), "/api/tracker/v1/settings")
    assert json_response(conn, 401)
  end

  test "GET /api/tracker/v1/settings/agents/availability reports both agents" do
    conn = get(authed_conn(), "/api/tracker/v1/settings/agents/availability")

    assert %{"data" => %{"codex" => codex, "claude" => claude, "cursor" => cursor}} = json_response(conn, 200)
    assert is_boolean(codex["available"]) and is_boolean(claude["available"]) and is_boolean(cursor["available"])
    assert Map.has_key?(codex, "version") and Map.has_key?(codex, "command")
  end
end
