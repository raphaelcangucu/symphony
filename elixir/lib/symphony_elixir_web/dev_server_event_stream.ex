defmodule SymphonyElixirWeb.DevServerEventStream do
  @moduledoc false

  import Plug.Conn

  alias SymphonyElixir.DevServer.Broadcaster

  @heartbeat_ms 15_000

  @spec stream(Plug.Conn.t(), String.t(), String.t()) :: Plug.Conn.t()
  def stream(conn, project_slug, identifier) do
    conn =
      conn
      |> put_resp_header("content-type", "text/event-stream; charset=utf-8")
      |> put_resp_header("cache-control", "no-cache")
      |> put_resp_header("connection", "keep-alive")
      |> send_chunked(200)

    :ok = Phoenix.PubSub.subscribe(SymphonyElixir.PubSub, Broadcaster.topic(project_slug, identifier))

    conn
    |> send_snapshot(project_slug, identifier)
    |> loop()
  end

  defp loop(conn) do
    receive do
      {:dev_server_update, payload} ->
        case chunk(conn, encode_event("update", payload)) do
          {:ok, conn} -> loop(conn)
          _ -> conn
        end
    after
      @heartbeat_ms ->
        case chunk(conn, ": heartbeat\n\n") do
          {:ok, conn} -> loop(conn)
          _ -> conn
        end
    end
  end

  defp send_snapshot(conn, project_slug, identifier) do
    case Broadcaster.build_payload(project_slug, identifier) do
      {:ok, payload} ->
        case chunk(conn, encode_event("snapshot", payload)) do
          {:ok, conn} -> conn
          _ -> conn
        end

      :error ->
        conn
    end
  end

  defp encode_event(event, payload) when is_binary(event) and is_map(payload) do
    "event: #{event}\ndata: #{Jason.encode!(payload)}\n\n"
  end
end
