defmodule SymphonyElixirWeb.HealthController do
  @moduledoc "Public health endpoint."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, _params) do
    identity = SymphonyElixir.Daemon.BuildInfo.snapshot()
    json(conn, Map.put(identity, :status, "ok"))
  end
end
