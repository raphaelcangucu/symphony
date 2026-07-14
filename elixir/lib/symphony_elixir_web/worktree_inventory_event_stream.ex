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
    conn =
      conn
      |> put_resp_header("content-type", "text/event-stream; charset=utf-8")
      |> put_resp_header("cache-control", "no-cache")
      |> put_resp_header("connection", "keep-alive")
      |> send_chunked(200)

    {:ok, conn_agent} = Agent.start_link(fn -> conn end)

    result =
      case display_name_module.map_for_project(project_slug) do
        {:ok, aliases} ->
          Inventory.scan_stream(project_slug, fn event ->
            Agent.get_and_update(conn_agent, fn current_conn ->
              case push_event(current_conn, event, aliases) do
                {:ok, updated_conn} -> {:ok, updated_conn}
                _ -> {:halt, current_conn}
              end
            end)
          end)

        {:error, reason} ->
          {:error, reason}
      end

    conn = Agent.get(conn_agent, & &1)
    Agent.stop(conn_agent)

    case result do
      {:ok, _scan} ->
        case chunk(conn, encode_event("done", %{})) do
          {:ok, conn} -> conn
          _ -> conn
        end

      {:error, reason} ->
        case chunk(conn, encode_event("failure", %{error: format_error(reason)})) do
          {:ok, conn} -> conn
          _ -> conn
        end
    end
  end

  defp push_event(conn, {:entry, entry}, aliases) do
    payload = %{data: WorktreeInventoryPresenter.entry_json(entry, aliases)}
    chunk(conn, encode_event("entry", payload))
  end

  defp push_event(conn, {:totals, totals}, _aliases) do
    payload = %{totals: WorktreeInventoryPresenter.totals_json(totals)}
    chunk(conn, encode_event("totals", payload))
  end

  defp encode_event(event, payload) when is_binary(event) and is_map(payload) do
    "event: #{event}\ndata: #{Jason.encode!(payload)}\n\n"
  end

  defp format_error(reason) when is_binary(reason), do: reason
  defp format_error(reason), do: inspect(reason)
end
