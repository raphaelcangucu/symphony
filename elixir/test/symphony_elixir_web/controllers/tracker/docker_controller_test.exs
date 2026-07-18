defmodule SymphonyElixirWeb.Tracker.DockerControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @token "test-token"
  @full_id "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc12345"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, @token)

    on_exit(fn ->
      if previous_token,
        do: System.put_env(@token_env, previous_token),
        else: System.delete_env(@token_env)

      Application.delete_env(:symphony_elixir, :docker_runner)
    end)

    :ok
  end

  defp auth(conn), do: put_req_header(conn, "authorization", "Bearer #{@token}")

  defp put_runner(fun), do: Application.put_env(:symphony_elixir, :docker_runner, fun)

  test "rejects unauthenticated requests" do
    conn = get(build_conn(), "/api/tracker/v1/docker/containers")
    assert json_response(conn, 401)
  end

  test "index returns containers when docker responds" do
    ps =
      ~s({"ID":"#{@full_id}","Names":"web","Image":"nginx","State":"running","Status":"Up","Ports":"","CreatedAt":"","Labels":"com.docker.compose.project=demo"})

    put_runner(fn
      ["ps" | _rest] -> {ps <> "\n", 0}
      ["stats" | _rest] -> {"", 0}
    end)

    conn = build_conn() |> auth() |> get("/api/tracker/v1/docker/containers")
    data = json_response(conn, 200)["data"]

    assert data["available"] == true
    assert [%{"name" => "web", "compose_project" => "demo"}] = data["containers"]
  end

  test "index reports an unavailable daemon without failing" do
    put_runner(fn _args -> {"Cannot connect to the Docker daemon\n", 1} end)

    conn = build_conn() |> auth() |> get("/api/tracker/v1/docker/containers")
    data = json_response(conn, 200)["data"]

    assert data["available"] == false
    assert data["containers"] == []
    assert data["error"] =~ "Cannot connect"
  end

  test "command runs a whitelisted action" do
    put_runner(fn ["stop", @full_id] -> {"", 0} end)

    conn = build_conn() |> auth() |> post("/api/tracker/v1/docker/containers/#{@full_id}/stop")
    assert json_response(conn, 200)["data"]["ok"] == true
  end

  test "command passes force through to remove" do
    parent = self()

    put_runner(fn args ->
      send(parent, {:docker_args, args})
      {"", 0}
    end)

    conn =
      build_conn()
      |> auth()
      |> post("/api/tracker/v1/docker/containers/#{@full_id}/remove", %{"force" => true})

    assert json_response(conn, 200)["data"]["ok"] == true
    assert_received {:docker_args, ["rm", "--force", @full_id]}
  end

  test "command rejects an unknown action with 422" do
    conn = build_conn() |> auth() |> post("/api/tracker/v1/docker/containers/#{@full_id}/kill")
    assert json_response(conn, 422)["error"]["code"] == "invalid_action"
  end

  test "command rejects a malformed container id with 422" do
    conn = build_conn() |> auth() |> post("/api/tracker/v1/docker/containers/not-hex/stop")
    assert json_response(conn, 422)["error"]["code"] == "invalid_container_id"
  end

  test "command surfaces docker failures as 502" do
    put_runner(fn _args -> {"Error response from daemon: boom\n", 1} end)

    conn = build_conn() |> auth() |> post("/api/tracker/v1/docker/containers/#{@full_id}/stop")
    assert json_response(conn, 502)["error"]["code"] == "docker_action_failed"
  end
end
