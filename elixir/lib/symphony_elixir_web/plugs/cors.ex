defmodule SymphonyElixirWeb.Plugs.Cors do
  @moduledoc """
  CORS headers for the tracker API.

  Browser clients often reach the UI at `localhost` while evidence artifact URLs
  are generated with `127.0.0.1`. Those are different origins, so authenticated
  fetches need explicit CORS support.
  """

  import Plug.Conn

  @tracker_api_prefix "/api/tracker/v1"
  @allowed_headers ~w(authorization content-type x-symphony-locale accept)
  @allowed_methods ~w(GET POST PUT PATCH DELETE OPTIONS)

  @spec init(keyword()) :: keyword()
  def init(opts), do: opts

  @spec call(Plug.Conn.t(), keyword()) :: Plug.Conn.t()
  def call(%{request_path: path} = conn, _opts) when is_binary(path) do
    if String.starts_with?(path, @tracker_api_prefix) do
      handle_cors(conn)
    else
      conn
    end
  end

  def call(conn, _opts), do: conn

  defp handle_cors(conn) do
    origin = conn |> get_req_header("origin") |> List.first()

    conn =
      if allowed_origin?(origin) do
        conn
        |> put_resp_header("access-control-allow-origin", origin)
        |> put_resp_header("access-control-allow-credentials", "true")
        |> append_vary("Origin")
      else
        conn
      end

    case conn.method do
      "OPTIONS" ->
        if allowed_origin?(origin) do
          conn
          |> put_resp_header("access-control-allow-methods", Enum.join(@allowed_methods, ", "))
          |> put_resp_header("access-control-allow-headers", Enum.join(@allowed_headers, ", "))
          |> put_resp_header("access-control-max-age", "86400")
        else
          conn
        end
        |> send_resp(204, "")
        |> halt()

      _ ->
        conn
    end
  end

  defp append_vary(conn, value) do
    case get_resp_header(conn, "vary") do
      [] -> put_resp_header(conn, "vary", value)
      existing -> put_resp_header(conn, "vary", Enum.join(existing ++ [value], ", "))
    end
  end

  @spec allowed_origin?(String.t() | nil) :: boolean()
  def allowed_origin?(origin) when is_binary(origin) do
    case URI.parse(origin) do
      %URI{scheme: scheme, host: host} when scheme in ["http", "https"] ->
        loopback_host?(host)

      _ ->
        false
    end
  end

  def allowed_origin?(_origin), do: false

  defp loopback_host?(host) when host in ["localhost", "127.0.0.1", "[::1]", "::1"], do: true
  defp loopback_host?(_host), do: false
end
