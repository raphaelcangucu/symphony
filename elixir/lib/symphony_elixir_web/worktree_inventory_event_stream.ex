defmodule SymphonyElixirWeb.WorktreeInventoryEventStream do
  @moduledoc false

  import Plug.Conn

  alias SymphonyElixir.Workspace.{DisplayName, Inventory}
  alias SymphonyElixirWeb.WorktreeInventoryPresenter

  @spec stream(Plug.Conn.t(), String.t()) :: Plug.Conn.t()
  def stream(conn, project_slug) when is_binary(project_slug), do: stream(conn, project_slug, DisplayName)

  @spec stream(Plug.Conn.t(), String.t(), module()) :: Plug.Conn.t()
  def stream(conn, project_slug, display_name_module)
      when is_binary(project_slug) and is_atom(display_name_module) do
    conn = prepare_sse_headers(conn)

    with {:ok, aliases} <- fetch_aliases(display_name_module, project_slug),
         {:ok, %{workspaces: workspaces, totals: totals}} <- Inventory.scan(project_slug) do
      conn =
        Enum.reduce_while(workspaces, conn, fn entry, acc ->
          payload = %{data: WorktreeInventoryPresenter.entry_json(entry, aliases)}

          case chunk(acc, encode_event("entry", payload)) do
            {:ok, next} -> {:cont, next}
            _ -> {:halt, acc}
          end
        end)

      with {:ok, conn} <-
             chunk(conn, encode_event("totals", %{totals: WorktreeInventoryPresenter.totals_json(totals)})),
           {:ok, conn} <- chunk(conn, encode_event("done", %{})) do
        conn
      else
        _ -> conn
      end
    else
      {:error, reason} -> chunk_failure(conn, reason)
    end
  end

  defp prepare_sse_headers(conn) do
    conn
    |> put_resp_header("content-type", "text/event-stream; charset=utf-8")
    |> put_resp_header("cache-control", "no-cache")
    |> put_resp_header("connection", "keep-alive")
    |> send_chunked(200)
  end

  defp fetch_aliases(display_name_module, project_slug) do
    display_name_module.map_for_project(project_slug)
  end

  defp chunk_failure(conn, reason) do
    case chunk(conn, encode_event("failure", %{error: format_error(reason)})) do
      {:ok, conn} -> conn
      _ -> conn
    end
  end

  defp encode_event(event, payload) when is_binary(event) and is_map(payload) do
    "event: #{event}\ndata: #{Jason.encode!(payload)}\n\n"
  end

  defp format_error(reason) when is_binary(reason), do: reason
  defp format_error(reason), do: inspect(reason)
end
