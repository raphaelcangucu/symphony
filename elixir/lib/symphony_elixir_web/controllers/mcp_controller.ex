defmodule SymphonyElixirWeb.McpController do
  @moduledoc """
  Streamable HTTP MCP endpoint for remote, bearer-authenticated LLM clients.

  This endpoint is deliberately stateless: MCP clients authenticate each
  request with the tracker token and no session identifier is issued or stored.
  The v1 implementation returns JSON responses and does not offer an SSE
  stream.
  """

  use Phoenix.Controller, formats: [:json]

  import Plug.Conn

  alias SymphonyElixir.Mcp.Tools

  @protocol_version "2025-06-18"

  @spec handle(Conn.t(), map()) :: Conn.t()
  def handle(conn, params) do
    cond do
      not valid_origin?(conn) ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: %{code: "invalid_origin", message: "MCP browser origin is not allowed"}})

      not supported_protocol_version?(conn) ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: %{code: "unsupported_protocol_version", message: "Unsupported MCP protocol version"}})

      true ->
        dispatch(conn, params)
    end
  end

  @spec stream(Conn.t(), map()) :: Conn.t()
  def stream(conn, _params) do
    conn
    |> put_resp_header("allow", "POST")
    |> send_resp(:method_not_allowed, "")
  end

  defp dispatch(conn, params) when is_map(params) and not is_map_key(params, "id") do
    send_resp(conn, :accepted, "")
  end

  defp dispatch(conn, %{"id" => nil}) do
    send_resp(conn, :accepted, "")
  end

  defp dispatch(conn, %{"method" => method, "id" => id} = params) do
    case method do
      "initialize" -> json(conn, rpc_result(id, initialize_result()))
      "ping" -> json(conn, rpc_result(id, %{}))
      "tools/list" -> json(conn, rpc_result(id, %{"tools" => Tools.tool_specs()}))
      "tools/call" -> json(conn, rpc_result(id, call_tool(Map.get(params, "params", %{}))))
      _ -> json(conn, rpc_error(id, -32_601, "Method not found"))
    end
  end

  defp dispatch(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: %{code: "invalid_request", message: "Expected a JSON-RPC request"}})
  end

  defp initialize_result do
    version = Application.spec(:symphony_elixir, :vsn) |> to_string()

    %{
      "protocolVersion" => @protocol_version,
      "capabilities" => %{"tools" => %{}},
      "serverInfo" => %{"name" => "symphony", "version" => version}
    }
  end

  defp call_tool(%{"name" => name} = params) when is_binary(name) do
    arguments = Map.get(params, "arguments", %{})

    case Tools.execute(name, arguments) do
      {:ok, result} -> mcp_tool_result(result, false)
      {:error, reason} -> mcp_tool_error(reason)
    end
  end

  defp call_tool(_params), do: mcp_tool_error(:tool_name_required)

  defp mcp_tool_result(result, is_error) do
    text = Jason.encode!(%{message: result.message, data: result.data})

    %{
      "content" => [%{"type" => "text", "text" => text}],
      "isError" => is_error
    }
  end

  defp mcp_tool_error(reason) do
    %{
      "content" => [%{"type" => "text", "text" => tool_error_message(reason)}],
      "isError" => true
    }
  end

  defp tool_error_message({:missing_required_field, field}), do: "#{field} is required"
  defp tool_error_message(:tool_name_required), do: "Tool name is required"
  defp tool_error_message(reason), do: inspect(reason)

  defp rpc_result(id, result), do: %{"jsonrpc" => "2.0", "id" => id, "result" => result}

  defp rpc_error(id, code, message) do
    %{"jsonrpc" => "2.0", "id" => id, "error" => %{"code" => code, "message" => message}}
  end

  # Origin is absent for normal server-to-server MCP clients. When a browser
  # supplies one, accept only the origin that addressed this tracker instance.
  defp valid_origin?(conn) do
    case get_req_header(conn, "origin") do
      [] -> true
      [origin] -> origin_matches_request_host?(origin, conn.host)
      _ -> false
    end
  end

  defp origin_matches_request_host?(origin, request_host) do
    case URI.parse(origin) do
      %URI{scheme: scheme, host: host, path: nil, query: nil, fragment: nil}
      when scheme in ["http", "https"] and is_binary(host) ->
        host == request_host

      _ ->
        false
    end
  end

  # Clients may omit the header for backwards compatibility. If supplied, it
  # must be the version this endpoint negotiated and implements.
  defp supported_protocol_version?(conn) do
    case get_req_header(conn, "mcp-protocol-version") do
      [] -> true
      [@protocol_version] -> true
      _ -> false
    end
  end
end
