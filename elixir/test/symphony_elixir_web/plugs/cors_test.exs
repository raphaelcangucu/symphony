defmodule SymphonyElixirWeb.Plugs.CorsTest do
  use ExUnit.Case, async: true

  import Plug.Conn
  import Plug.Test

  alias SymphonyElixirWeb.Plugs.Cors

  @opts Cors.init([])

  test "allows loopback origins on tracker API responses" do
    conn =
      :get
      |> conn("/api/tracker/v1/projects/gam/issues/GAM-1")
      |> put_req_header("origin", "http://localhost:4000")
      |> Cors.call(@opts)

    assert ["http://localhost:4000"] = get_resp_header(conn, "access-control-allow-origin")
    assert ["true"] = get_resp_header(conn, "access-control-allow-credentials")
    refute conn.halted
  end

  test "does not add CORS headers for non-tracker paths" do
    conn =
      :get
      |> conn("/tracker")
      |> put_req_header("origin", "http://localhost:4000")
      |> Cors.call(@opts)

    assert get_resp_header(conn, "access-control-allow-origin") == []
  end

  test "does not add CORS headers for external origins" do
    conn =
      :get
      |> conn("/api/tracker/v1/projects/gam/issues/GAM-1")
      |> put_req_header("origin", "https://example.com")
      |> Cors.call(@opts)

    assert get_resp_header(conn, "access-control-allow-origin") == []
  end

  test "handles OPTIONS preflight for loopback origins" do
    conn =
      :options
      |> conn("/api/tracker/v1/projects/gam/issues/GAM-1/evidence/run/artifacts/x.png")
      |> put_req_header("origin", "http://localhost:4000")
      |> put_req_header("access-control-request-method", "GET")
      |> put_req_header("access-control-request-headers", "authorization")
      |> Cors.call(@opts)

    assert conn.status == 204
    assert conn.halted
    assert ["http://localhost:4000"] = get_resp_header(conn, "access-control-allow-origin")
    assert ["GET, POST, PUT, PATCH, DELETE, OPTIONS"] = get_resp_header(conn, "access-control-allow-methods")
    assert ["authorization, content-type, x-symphony-locale, accept"] = get_resp_header(conn, "access-control-allow-headers")
  end

  test "allows 127.0.0.1 origin for localhost UI clients" do
    conn =
      :get
      |> conn("/api/tracker/v1/projects/gam/issues/GAM-1")
      |> put_req_header("origin", "http://127.0.0.1:4000")
      |> Cors.call(@opts)

    assert ["http://127.0.0.1:4000"] = get_resp_header(conn, "access-control-allow-origin")
  end
end
