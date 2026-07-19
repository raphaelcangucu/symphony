defmodule SymphonyElixirWeb.HealthController do
  @moduledoc "Public health endpoint."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, _params) do
    json(conn, %{status: "ok"})
  end
end
