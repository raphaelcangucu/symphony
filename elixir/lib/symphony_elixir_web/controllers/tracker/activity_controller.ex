defmodule SymphonyElixirWeb.Tracker.ActivityController do
  @moduledoc """
  Exposes the append-only activity timeline for an issue (local tracker events).

  Remote-backed projects keep their history on the upstream tracker, so this
  endpoint returns an empty list for them rather than an error.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors
  alias SymphonyElixirWeb.TrackerPresenter

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    case Context.list_activity_events(project_slug, identifier) do
      {:ok, events} ->
        json(conn, %{data: Enum.map(events, &TrackerPresenter.activity_event/1)})

      {:error, :issue_not_found} ->
        json(conn, %{data: []})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end
end
