defmodule SymphonyElixirWeb.Tracker.SettingsControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.AgentUsage
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Setting

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    AgentUsage.reset()
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
               "lab" => %{"bundle_child_orchestration" => false},
               "orchestrator" => %{
                 "require_symphony_label" => true,
                 "require_assignee_match" => true,
                 "agent_token_budget_enabled" => false,
                 "agent_token_budget" => 4_000_000
               },
               "ui" => %{"locale" => "auto"}
             }
           } = json_response(conn, 200)
  end

  test "PUT /api/tracker/v1/settings/lab toggles bundle_child_orchestration" do
    conn = put(authed_conn(), "/api/tracker/v1/settings/lab", %{"bundle_child_orchestration" => true})
    assert %{"data" => %{"bundle_child_orchestration" => true}} = json_response(conn, 200)

    conn = get(authed_conn(), "/api/tracker/v1/settings")
    assert %{"data" => %{"lab" => %{"bundle_child_orchestration" => true}}} = json_response(conn, 200)
  end

  test "PUT /api/tracker/v1/settings/orchestrator toggles a boolean rule" do
    conn = put(authed_conn(), "/api/tracker/v1/settings/orchestrator", %{"require_symphony_label" => false})
    assert %{"data" => %{"require_symphony_label" => false}} = json_response(conn, 200)

    conn = get(authed_conn(), "/api/tracker/v1/settings")
    assert %{"data" => %{"orchestrator" => %{"require_symphony_label" => false}}} = json_response(conn, 200)
  end

  test "PUT /api/tracker/v1/settings/orchestrator updates token budget settings" do
    conn =
      put(authed_conn(), "/api/tracker/v1/settings/orchestrator", %{
        "agent_token_budget_enabled" => true,
        "agent_token_budget" => 8_000_000
      })

    assert %{
             "data" => %{
               "agent_token_budget_enabled" => true,
               "agent_token_budget" => 8_000_000
             }
           } = json_response(conn, 200)
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

  test "GET /api/tracker/v1/settings/agents/tools returns status, source, and model per agent" do
    conn = get(authed_conn(), "/api/tracker/v1/settings/agents/tools")

    assert %{"data" => %{"tools" => tools}} = json_response(conn, 200)
    assert length(tools) == 4

    ids = tools |> Enum.map(& &1["id"]) |> Enum.sort()
    assert ids == ["claude", "codex", "cursor", "opencode"]

    codex = Enum.find(tools, &(&1["id"] == "codex"))
    assert is_boolean(codex["status"]["installed"])
    assert Map.has_key?(codex["status"], "version")
    assert Map.has_key?(codex["status"], "path")
    assert codex["source"]["value"] in ["path", "none"]
    assert is_list(codex["model"]["options"])
    assert Map.has_key?(codex["model"], "selected")
    assert Map.has_key?(codex["install"], "available")
  end

  test "PUT /api/tracker/v1/settings/agent_models persists a catalog model" do
    conn = put(authed_conn(), "/api/tracker/v1/settings/agent_models", %{"codex" => "gpt-5-codex"})
    assert %{"data" => %{"codex" => "gpt-5-codex"}} = json_response(conn, 200)

    conn = get(authed_conn(), "/api/tracker/v1/settings")
    assert %{"data" => %{"agent_models" => %{"codex" => "gpt-5-codex"}}} = json_response(conn, 200)
  end

  test "PUT /api/tracker/v1/settings/agent_models rejects models outside the catalog" do
    conn = put(authed_conn(), "/api/tracker/v1/settings/agent_models", %{"codex" => "gpt-9-imaginary"})
    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "GET /api/tracker/v1/settings/agents/usage returns per-agent usage snapshots" do
    snap =
      AgentUsage.Window.normalize("claude", %{
        "limit_name" => "max",
        "primary" => %{"usedPercent" => 60, "windowDurationMins" => 300, "resets_at" => 1_900_000_000},
        "secondary" => %{"usedPercent" => 12, "windowDurationMins" => 10_080, "resets_at" => 1_900_500_000},
        "credits" => %{"has_credits" => true, "balance" => 5.0}
      })

    :ok = AgentUsage.put("claude", snap)

    conn = get(authed_conn(), "/api/tracker/v1/settings/agents/usage")
    assert %{"data" => data} = json_response(conn, 200)

    claude = data["claude"]
    assert claude["plan"] == "max"
    assert claude["stale"] == false
    assert claude["credits_remaining"] == 5.0
    assert is_integer(claude["fetched_at"])

    session = Enum.find(claude["windows"], &(&1["kind"] == "session"))
    assert session["used_percent"] == 60.0
    assert session["resets_at"] == 1_900_000_000
    assert session["window_minutes"] == 300

    assert data["codex"] == nil
    assert data["cursor"] == nil
  end
end
