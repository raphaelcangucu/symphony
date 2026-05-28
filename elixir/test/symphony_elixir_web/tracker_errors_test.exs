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
end
