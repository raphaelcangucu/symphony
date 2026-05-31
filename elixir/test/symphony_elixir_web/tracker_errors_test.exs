defmodule SymphonyElixirWeb.TrackerErrorsTest do
  use ExUnit.Case, async: true

  import Phoenix.ConnTest
  alias SymphonyElixirWeb.TrackerErrors

  test "maps missing_credentials to 503" do
    conn = TrackerErrors.render(build_conn(), :missing_credentials)
    assert json_response(conn, 503)["error"]["code"] == "tracker_credentials_missing"
  end

  test "maps remote_unauthorized to 502" do
    conn = TrackerErrors.render(build_conn(), :remote_unauthorized)
    assert json_response(conn, 502)["error"]["code"] == "tracker_unauthorized"
  end

  test "maps remote_rate_limited to 429" do
    conn = TrackerErrors.render(build_conn(), :remote_rate_limited)
    assert json_response(conn, 429)["error"]["code"] == "tracker_rate_limited"
  end

  test "maps not_supported_on_remote to 501" do
    conn = TrackerErrors.render(build_conn(), :not_supported_on_remote)
    assert json_response(conn, 501)["error"]["code"] == "tracker_not_supported"
  end

  test "maps github rate_limited to 429 with reset time" do
    reset_at = ~U[2026-05-30 23:13:13Z]
    conn = TrackerErrors.render(build_conn(), {:rate_limited, %{reset_at: reset_at}})
    body = json_response(conn, 429)

    assert body["error"]["code"] == "github_rate_limited"
    assert body["error"]["message"] =~ "23:13 UTC"
    assert body["error"]["reset_at"] == "2026-05-30T23:13:13Z"
  end

  test "maps github rate_limited without reset time to a generic 429" do
    conn = TrackerErrors.render(build_conn(), {:rate_limited, %{}})
    body = json_response(conn, 429)

    assert body["error"]["code"] == "github_rate_limited"
    assert body["error"]["message"] =~ "Try again shortly"
    refute Map.has_key?(body["error"], "reset_at")
  end
end
