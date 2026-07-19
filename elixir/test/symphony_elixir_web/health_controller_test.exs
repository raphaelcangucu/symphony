defmodule SymphonyElixirWeb.HealthControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  @endpoint SymphonyElixirWeb.Endpoint

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    :ok
  end

  test "GET /api/health returns unauthenticated JSON" do
    conn = get(build_conn(), "/api/health")

    assert json_response(conn, 200) == %{"status" => "ok"}
  end
end
