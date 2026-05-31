defmodule SymphonyElixirWeb.Tracker.RecentsController do
  @moduledoc "Returns a unified, time-ranked list of recent assistant chats and Codex runs."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Recents
  alias SymphonyElixirWeb.TrackerPresenter

  @default_limit 20
  @max_limit 100

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, params) do
    data =
      [limit: clamp_limit(params["limit"])]
      |> Recents.list()
      |> Enum.map(&TrackerPresenter.recent_item/1)

    json(conn, %{data: data})
  end

  defp clamp_limit(nil), do: @default_limit

  defp clamp_limit(value) when is_binary(value) do
    case Integer.parse(value) do
      {n, _} -> n |> min(@max_limit) |> max(1)
      :error -> @default_limit
    end
  end

  defp clamp_limit(_), do: @default_limit
end
