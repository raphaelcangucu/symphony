defmodule SymphonyElixirWeb.DevServerOutputEventStream do
  @moduledoc false

  import Plug.Conn

  alias SymphonyElixir.DevServer.Manager
  alias SymphonyElixir.LocalTracker.{Context, DevServerRecord}

  @default_poll_ms 1_500
  @stream_statuses ~w(pending provisioning starting)

  @spec stream(Plug.Conn.t(), String.t(), String.t(), pos_integer()) :: Plug.Conn.t()
  def stream(conn, project_slug, identifier, server_id)
      when is_binary(project_slug) and is_binary(identifier) and is_integer(server_id) and server_id > 0 do
    conn =
      conn
      |> put_resp_header("content-type", "text/event-stream; charset=utf-8")
      |> put_resp_header("cache-control", "no-cache")
      |> put_resp_header("connection", "keep-alive")
      |> send_chunked(200)

    identifier = canonical_identifier(identifier)

    case Context.get_project(project_slug) do
      {:ok, project} ->
        case DevServerRecord.get_for_issue(project.id, identifier, server_id) do
          %DevServerRecord{} ->
            loop(conn, project_slug, identifier, server_id, nil)

          nil ->
            conn
            |> send_event("failure", %{message: "dev_server_not_found"})
            |> halt()
        end

      {:error, _reason} ->
        conn
        |> send_event("failure", %{message: "project_not_found"})
        |> halt()
    end
  end

  defp loop(conn, project_slug, identifier, server_id, last_output) do
    receive do
    after
      poll_interval_ms() ->
        case poll_output(project_slug, identifier, server_id) do
          {:ok, payload} ->
            conn =
              conn
              |> maybe_send_snapshot(last_output, payload)
              |> maybe_send_update(last_output, payload)

            if streamable?(payload.status) do
              loop(conn, project_slug, identifier, server_id, payload.output)
            else
              conn
              |> send_event("done", %{status: payload.status})
              |> halt()
            end

          {:error, :not_found} ->
            conn
            |> send_event("failure", %{message: "dev_server_not_found"})
            |> halt()

          {:error, message} when is_binary(message) ->
            conn
            |> send_event("failure", %{message: message})
            |> halt()
        end
    end
  end

  defp poll_output(project_slug, identifier, server_id) do
    with {:ok, project} <- Context.get_project(project_slug),
         %DevServerRecord{status: status} <- DevServerRecord.get_for_issue(project.id, identifier, server_id),
         {:ok, payload} <- Manager.capture_server_output(project_slug, identifier, server_id) do
      {:ok, Map.merge(payload, %{status: status})}
    else
      nil -> {:error, :not_found}
      {:error, :not_found} -> {:error, :not_found}
      {:error, reason} -> {:error, inspect(reason)}
    end
  end

  defp maybe_send_snapshot(conn, nil, payload) do
    send_event(conn, "snapshot", payload)
  end

  defp maybe_send_snapshot(conn, _last_output, _payload), do: conn

  defp maybe_send_update(conn, last_output, payload) do
    if last_output == payload.output do
      conn
    else
      send_event(conn, "update", payload)
    end
  end

  defp streamable?(status) when status in @stream_statuses, do: true
  defp streamable?(_status), do: false

  defp send_event(conn, event, payload) when is_binary(event) and is_map(payload) do
    case chunk(conn, encode_event(event, payload)) do
      {:ok, conn} -> conn
      _ -> conn
    end
  end

  defp encode_event(event, payload) when is_binary(event) and is_map(payload) do
    "event: #{event}\ndata: #{Jason.encode!(%{data: payload})}\n\n"
  end

  defp canonical_identifier(identifier) when is_binary(identifier) do
    String.trim_leading(identifier, "#")
  end

  defp poll_interval_ms do
    Application.get_env(:symphony_elixir, :dev_server_output_poll_ms, @default_poll_ms)
  end
end
