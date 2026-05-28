defmodule SymphonyElixirWeb.Tracker.ViewerController do
  @moduledoc "Exposes the resolved Symphony operator identity."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Viewer
  alias SymphonyElixirWeb.TrackerErrors

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, _params) do
    case Viewer.current() do
      {:ok, viewer} ->
        json(conn, %{
          data: %{
            github_login: viewer.login,
            name: viewer.name,
            avatar_url: viewer.avatar_url
          }
        })

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end
end
