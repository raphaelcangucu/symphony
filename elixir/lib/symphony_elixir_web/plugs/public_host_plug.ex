defmodule SymphonyElixirWeb.PublicHostPlug do
  @moduledoc """
  Routes incoming requests by `Host`: preview hosts under the configured
  namespace are reverse-proxied to the matching dev-server loopback port;
  the tracker host and loopback fall through to the app; anything else under
  the namespace that is unknown returns 404.
  """

  @behaviour Plug

  import Plug.Conn

  alias SymphonyElixir.Config
  alias SymphonyElixir.PublicRouting

  @loopback_hosts ~w(127.0.0.1 localhost ::1)

  @impl true
  def init(opts), do: opts

  @impl true
  def call(conn, _opts) do
    if tunnel_enabled?() do
      route(conn, conn.host)
    else
      conn
    end
  end

  defp route(conn, host) when host in @loopback_hosts, do: conn

  defp route(conn, host) do
    case PublicRouting.resolve_namespace() do
      {:ok, namespace} -> route_in_namespace(conn, host, namespace)
      {:error, :no_namespace} -> conn
    end
  end

  defp route_in_namespace(conn, host, namespace) do
    opts = [namespace: namespace, base_domain: Config.public_tunnel_base_domain()]

    cond do
      host == PublicRouting.tracker_host(opts) ->
        conn

      not String.ends_with?(host, PublicRouting.namespace_suffix(opts)) ->
        conn

      true ->
        proxy_or_404(conn, host)
    end
  end

  defp proxy_or_404(conn, host) do
    with {:ok, port} <- PublicRouting.lookup(host),
         true <- port_in_range?(port) do
      proxy(conn, port)
    else
      _ -> conn |> send_resp(404, "Unknown preview host") |> halt()
    end
  end

  defp proxy(conn, port) do
    if websocket_upgrade?(conn) do
      conn
      |> ReverseProxyPlugWebsocket.call(
        ReverseProxyPlugWebsocket.init(
          upstream_uri: ws_upstream_uri(port, conn),
          path: conn.request_path
        )
      )
      |> halt()
    else
      conn
      |> ReverseProxyPlug.call(ReverseProxyPlug.init(upstream: "http://127.0.0.1:#{port}"))
      |> halt()
    end
  end

  defp ws_upstream_uri(port, %{query_string: query} = conn) when is_binary(query) and query != "" do
    "ws://127.0.0.1:#{port}#{conn.request_path}?#{query}"
  end

  defp ws_upstream_uri(port, conn) do
    "ws://127.0.0.1:#{port}#{conn.request_path}"
  end

  defp websocket_upgrade?(conn) do
    conn
    |> get_req_header("upgrade")
    |> Enum.any?(&(String.downcase(&1) == "websocket"))
  end

  defp port_in_range?(port) do
    case Config.dev_server_port_range() do
      [low, high] when is_integer(low) and is_integer(high) -> port >= low and port <= high
      _ -> false
    end
  end

  defp tunnel_enabled? do
    Config.public_tunnel_enabled?()
  rescue
    _ -> false
  end
end
