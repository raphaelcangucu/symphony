defmodule SymphonyElixirWeb.HealthControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  @endpoint SymphonyElixirWeb.Endpoint

  setup do
    previous = Application.get_env(:symphony_elixir, :build_info)
    start_supervised!(SymphonyElixirWeb.Endpoint)

    on_exit(fn ->
      if is_nil(previous) do
        Application.delete_env(:symphony_elixir, :build_info)
      else
        Application.put_env(:symphony_elixir, :build_info, previous)
      end
    end)

    :ok
  end

  test "GET /api/health returns build identity without authentication" do
    Application.put_env(:symphony_elixir, :build_info, %{
      version: "0.3.0",
      git_commit: "test-commit",
      mode: "development"
    })

    SymphonyElixir.Daemon.BuildInfo.mark_started(~U[2026-07-24 12:00:00Z])
    conn = get(build_conn(), "/api/health")

    assert json_response(conn, 200) == %{
             "status" => "ok",
             "version" => "0.3.0",
             "git_commit" => "test-commit",
             "started_at" => "2026-07-24T12:00:00Z",
             "mode" => "development",
             "tracker_host" => "127.0.0.1",
             "tracker_port" => 4000
           }
  end
end
