defmodule SymphonyElixirWeb.Tracker.AgentUsageE2ETest do
  @moduledoc """
  End-to-end chain for plan usage through the real HTTP stack:
  POST /observability/report  →  Registry capture hook  →  AgentUsage store
  →  GET /settings/agents/usage.

  Exercises the production path (controllers + router + the global Registry and
  AgentUsage), substituting a synthetic worker report for a live agent turn.
  """
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.AgentUsage

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    AgentUsage.reset()
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

  test "a Codex worker report surfaces as normalized plan usage at the usage endpoint" do
    report = %{
      "runtime_id" => "e2e-#{System.unique_integer([:positive])}",
      "agent_kind" => "codex",
      "label" => "proj",
      "snapshot" => %{
        "counts" => %{"running" => 1, "retrying" => 0},
        "running" => [],
        "retrying" => [],
        "agent_totals" => %{},
        "rate_limits" => %{
          "limit_name" => "pro",
          "primary" => %{"usedPercent" => 73, "windowDurationMins" => 300, "reset_in_seconds" => 3600},
          "secondary" => %{"usedPercent" => 21, "windowDurationMins" => 10_080, "resets_at" => 1_900_500_000},
          "credits" => %{"has_credits" => true, "balance" => 8.0}
        }
      }
    }

    post_conn = post(authed_conn(), "/api/tracker/v1/observability/report", report)
    assert %{"data" => %{"accepted" => true}} = json_response(post_conn, 202)

    conn = get(authed_conn(), "/api/tracker/v1/settings/agents/usage")
    assert %{"data" => data} = json_response(conn, 200)

    codex = data["codex"]
    assert codex["plan"] == "pro"
    assert codex["stale"] == false
    assert codex["credits_remaining"] == 8.0
    assert is_integer(codex["fetched_at"])

    session = Enum.find(codex["windows"], &(&1["kind"] == "session"))
    weekly = Enum.find(codex["windows"], &(&1["kind"] == "weekly"))
    assert session["used_percent"] == 73.0
    assert is_integer(session["resets_at"])
    assert weekly["used_percent"] == 21.0
    assert weekly["resets_at"] == 1_900_500_000

    # Agents that never reported usage stay unavailable.
    assert data["claude"] == nil
    assert data["cursor"] == nil
  end
end
