defmodule SymphonyElixirWeb.Tracker.TunnelController do
  @moduledoc "Process-wide controls for the Cloudflare public preview tunnel."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Cloudflare.Tunnel
  alias SymphonyElixirWeb.TrackerErrors

  @spec start(Conn.t(), map()) :: Conn.t()
  def start(conn, _params) do
    case Tunnel.start_tunnel() do
      {:ok, status} -> json(conn, %{data: %{enabled: true, running: status == :running}})
      {:error, :disabled} -> TrackerErrors.render(conn, :public_tunnel_disabled)
      {:error, _reason} -> TrackerErrors.render(conn, :public_tunnel_start_failed)
    end
  end
end
