defmodule SymphonyElixirWeb.RootRedirectTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  @endpoint SymphonyElixirWeb.Endpoint

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    :ok
  end

  test "GET / redirects to /tracker" do
    conn = get(build_conn(), "/")

    assert redirected_to(conn, 302) == "/tracker"
  end
end
