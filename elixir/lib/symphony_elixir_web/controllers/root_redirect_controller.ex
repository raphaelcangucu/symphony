defmodule SymphonyElixirWeb.RootRedirectController do
  @moduledoc "Redirects the root path to the tracker SPA."

  use Phoenix.Controller, formats: [:html]

  alias Plug.Conn

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, _params) do
    redirect(conn, to: "/tracker")
  end
end
