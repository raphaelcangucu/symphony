defmodule SymphonyElixirWeb.Task1Test do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  @endpoint SymphonyElixirWeb.Endpoint

  setup do
    case Process.whereis(SymphonyElixir.PublicRouting) do
      nil -> start_supervised!(SymphonyElixir.PublicRouting)
      _pid -> :ok
    end

    start_supervised!(SymphonyElixirWeb.Endpoint)
    :ok
  end

  test "GET /api/health returns unauthenticated JSON" do
    conn = get(build_conn(), "/api/health")

    assert json_response(conn, 200) == %{"status" => "ok"}
  end

  test "GET /task1 renders TASK 1 and live health JSON target" do
    conn = get(build_conn(), "/task1")
    body = html_response(conn, 200)

    assert body =~ "TASK 1"
    assert body =~ ~s(data-health-url="/api/health")
    assert body =~ ~s(id="health-json")
    assert body =~ "fetch(healthTarget.dataset.healthUrl)"
  end
end
