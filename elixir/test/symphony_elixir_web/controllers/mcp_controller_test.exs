defmodule SymphonyElixirWeb.McpControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    {:ok, _project} =
      SymphonyElixir.LocalTracker.Context.ensure_project(%{
        name: "Macro Markets",
        slug: "macro-markets"
      })

    on_exit(fn -> restore_env(@token_env, previous_token) end)
    :ok
  end

  test "rejects unauthenticated MCP requests" do
    conn = post(build_conn(), "/api/mcp", rpc_request(1, "initialize"))

    assert %{"error" => %{"code" => "unauthorized"}} = json_response(conn, 401)
  end

  test "rejects browser requests from a foreign origin" do
    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> put_req_header("origin", "https://attacker.example")
      |> post("/api/mcp", rpc_request(1, "initialize"))

    assert %{"error" => %{"code" => "invalid_origin"}} = json_response(conn, 403)
  end

  test "rejects unsupported MCP protocol versions" do
    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> put_req_header("mcp-protocol-version", "2024-11-05")
      |> post("/api/mcp", rpc_request(1, "tools/list"))

    assert %{"error" => %{"code" => "unsupported_protocol_version"}} = json_response(conn, 400)
  end

  test "initializes an authenticated Streamable HTTP MCP session" do
    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> put_req_header("accept", "application/json, text/event-stream")
      |> post("/api/mcp", rpc_request(1, "initialize"))

    assert %{
             "jsonrpc" => "2.0",
             "id" => 1,
             "result" => %{
               "protocolVersion" => "2025-06-18",
               "capabilities" => %{"tools" => %{}},
               "serverInfo" => %{"name" => "symphony"}
             }
           } = json_response(conn, 200)

    assert get_resp_header(conn, "mcp-session-id") == []
  end

  test "lists project tools with an explicit project_slug argument" do
    conn = authenticated_post("tools/list", %{})

    assert %{"result" => %{"tools" => tools}} = json_response(conn, 200)

    assert %{"name" => "list_tracker_projects"} = Enum.find(tools, &(&1["name"] == "list_tracker_projects"))

    assert %{"inputSchema" => %{"required" => required}} =
             Enum.find(tools, &(&1["name"] == "list_issues"))

    assert "project_slug" in required
  end

  test "executes a discovery tool without a project slug" do
    conn = authenticated_post("tools/call", %{"name" => "list_tracker_projects", "arguments" => %{}})

    assert %{
             "result" => %{
               "isError" => false,
               "content" => [%{"type" => "text", "text" => text}]
             }
           } = json_response(conn, 200)

    assert text =~ "macro-markets"
  end

  test "accepts MCP notifications without a JSON-RPC id" do
    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> post("/api/mcp", %{"jsonrpc" => "2.0", "method" => "notifications/initialized"})

    assert response(conn, 202) == ""
  end

  test "does not offer an SSE stream in v1" do
    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> get("/api/mcp")

    assert response(conn, 405)
    assert ["POST"] = get_resp_header(conn, "allow")
  end

  defp authenticated_post(method, params) do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
    |> post("/api/mcp", rpc_request(1, method, params))
  end

  defp rpc_request(id, method, params \\ %{}) do
    %{"jsonrpc" => "2.0", "id" => id, "method" => method, "params" => params}
  end

  defp migrate_repo do
    alias SymphonyElixir.Repo

    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp restore_env(key, value) do
    case value do
      nil -> System.delete_env(key)
      val -> System.put_env(key, val)
    end
  end
end
