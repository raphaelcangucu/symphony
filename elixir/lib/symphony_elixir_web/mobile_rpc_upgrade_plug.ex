defmodule SymphonyElixirWeb.MobileRpcUpgradePlug do
  @moduledoc "Upgrades `/mobile/rpc` to the direct encrypted mobile WebSocket."

  import Plug.Conn

  alias SymphonyElixir.MobileRpc.Socket

  @behaviour Plug
  @path "/mobile/rpc"

  @impl Plug
  def init(opts), do: opts

  @impl Plug
  def call(%Plug.Conn{request_path: @path, query_string: query} = conn, _opts)
      when query != "" do
    conn
    |> send_resp(400, "mobile RPC accepts no query parameters")
    |> halt()
  end

  def call(%Plug.Conn{request_path: @path} = conn, _opts) do
    auth_key = conn.remote_ip |> :inet.ntoa() |> to_string()

    conn
    |> WebSockAdapter.upgrade(Socket, %{auth_key: auth_key},
      timeout: 60_000,
      max_frame_size: 1_048_576,
      compress: false,
      validate_utf8: true
    )
    |> halt()
  rescue
    WebSockAdapter.UpgradeError ->
      conn
      |> send_resp(400, "invalid WebSocket upgrade")
      |> halt()
  end

  def call(conn, _opts), do: conn
end
