defmodule SymphonyElixirWeb.Tracker.ObservabilityControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Observability.Registry

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @token "test-token"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, @token)

    on_exit(fn ->
      if previous_token, do: System.put_env(@token_env, previous_token), else: System.delete_env(@token_env)
    end)

    :ok
  end

  defp auth(conn), do: put_req_header(conn, "authorization", "Bearer #{@token}")

  defp valid_report do
    %{
      "runtime_id" => "r1",
      "label" => "proj",
      "project_slug" => "proj",
      "tracker_kind" => "local",
      "agent_kind" => "codex",
      "source_url" => "http://localhost:4001",
      "snapshot" => %{
        "generated_at" => "2026-05-30T00:00:00Z",
        "counts" => %{"running" => 0, "retrying" => 0},
        "running" => [],
        "retrying" => [],
        "agent_totals" => %{
          "input_tokens" => 0,
          "output_tokens" => 0,
          "total_tokens" => 0,
          "seconds_running" => 0
        },
        "rate_limits" => nil
      }
    }
  end

  test "rejects unauthenticated report" do
    conn = post(build_conn(), "/api/tracker/v1/observability/report", valid_report())
    assert json_response(conn, 401)
  end

  test "accepts a valid report and stores it" do
    conn = build_conn() |> auth() |> post("/api/tracker/v1/observability/report", valid_report())
    assert response(conn, 202)
    assert Enum.any?(Registry.list(), &(&1.runtime_id == "r1"))
  end

  test "rejects a report missing runtime_id with 422" do
    body = Map.delete(valid_report(), "runtime_id")
    conn = build_conn() |> auth() |> post("/api/tracker/v1/observability/report", body)
    assert json_response(conn, 422)["error"]["code"] == "invalid_report"
  end

  test "index returns the aggregate" do
    Registry.put_report(valid_report())
    conn = build_conn() |> auth() |> get("/api/tracker/v1/observability")
    data = json_response(conn, 200)["data"]
    assert Enum.any?(data, &(&1["runtime_id"] == "r1"))
  end

  test "pr_monitor returns the reconciler heartbeat and recent evaluations" do
    conn = build_conn() |> auth() |> get("/api/tracker/v1/observability/pr_monitor")
    data = json_response(conn, 200)["data"]

    assert is_map(data["heartbeat"])
    assert Map.has_key?(data["heartbeat"], "running")
    assert Map.has_key?(data["heartbeat"], "interval_ms")
    assert is_list(data["evaluations"])
  end

  test "pr_monitor rejects unauthenticated requests" do
    conn = get(build_conn(), "/api/tracker/v1/observability/pr_monitor")
    assert json_response(conn, 401)
  end
end
