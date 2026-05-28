defmodule SymphonyElixirWeb.StaticAssetController do
  @moduledoc """
  Serves the dashboard's embedded CSS and JavaScript assets.
  """

  use Phoenix.Controller, formats: []

  alias Plug.Conn
  alias SymphonyElixirWeb.StaticAssets

  @spec dashboard_css(Conn.t(), map()) :: Conn.t()
  def dashboard_css(conn, _params), do: serve(conn, "/dashboard.css")

  @spec phoenix_html_js(Conn.t(), map()) :: Conn.t()
  def phoenix_html_js(conn, _params), do: serve(conn, "/vendor/phoenix_html/phoenix_html.js")

  @spec phoenix_js(Conn.t(), map()) :: Conn.t()
  def phoenix_js(conn, _params), do: serve(conn, "/vendor/phoenix/phoenix.js")

  @spec phoenix_live_view_js(Conn.t(), map()) :: Conn.t()
  def phoenix_live_view_js(conn, _params), do: serve(conn, "/vendor/phoenix_live_view/phoenix_live_view.js")

  @spec tracker_index(Conn.t(), map()) :: Conn.t()
  def tracker_index(conn, _params), do: serve_tracker_index(conn)

  @spec tracker_asset_or_index(Conn.t(), map()) :: Conn.t()
  def tracker_asset_or_index(conn, %{"path" => path}) when is_list(path) do
    case StaticAssets.fetch_tracker_asset(path) do
      {:ok, content_type, body} ->
        serve_body(conn, content_type, "public, max-age=31536000", body)

      :error ->
        serve_tracker_index(conn)
    end
  end

  defp serve(conn, path) do
    case StaticAssets.fetch(path) do
      {:ok, content_type, body} ->
        serve_body(conn, content_type, "public, max-age=31536000", body)

      :error ->
        send_resp(conn, 404, "Not Found")
    end
  end

  defp serve_tracker_index(conn) do
    case StaticAssets.fetch_tracker_index() do
      {:ok, content_type, body} ->
        serve_body(conn, content_type, "no-cache", body)

      :error ->
        send_resp(conn, 404, "Not Found")
    end
  end

  defp serve_body(conn, content_type, cache_control, body) do
    conn
    |> put_resp_content_type(content_type)
    |> put_resp_header("cache-control", cache_control)
    |> send_resp(200, body)
  end
end
