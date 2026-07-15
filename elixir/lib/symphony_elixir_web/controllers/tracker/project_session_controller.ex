defmodule SymphonyElixirWeb.Tracker.ProjectSessionController do
  @moduledoc "Returns cursor-paginated lightweight session rows for a tracker project."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Tracker.ProjectSessions
  alias SymphonyElixirWeb.TrackerErrors

  @default_limit 20
  @max_limit 50

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug} = params) do
    opts = [
      limit: parse_limit(params["limit"]),
      cursor: params["cursor"],
      include_archived: include_archived?(params["include_archived"])
    ]

    case ProjectSessions.list(project_slug, opts) do
      {:ok, %{data: data, meta: meta}} ->
        json(conn, %{data: data, meta: meta})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  defp parse_limit(nil), do: @default_limit

  defp parse_limit(value) when is_binary(value) do
    case Integer.parse(value) do
      {n, _} when n > 0 -> min(n, @max_limit)
      _ -> @default_limit
    end
  end

  defp parse_limit(n) when is_integer(n) and n > 0, do: min(n, @max_limit)
  defp parse_limit(_), do: @default_limit

  defp include_archived?(value), do: value in [true, "true"]
end
