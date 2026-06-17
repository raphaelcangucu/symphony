defmodule SymphonyElixirWeb.Tracker.BlockerController do
  @moduledoc "Blocker relation endpoints for the local tracker JSON API."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors
  alias SymphonyElixirWeb.TrackerPresenter

  @default_type "blocked_by"

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    case Context.list_blockers(project_slug, identifier) do
      {:ok, blockers} ->
        json(conn, %{data: Enum.map(blockers, &TrackerPresenter.blocker/1)})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(
        conn,
        %{"project_slug" => project_slug, "identifier" => source_identifier, "target_identifier" => target_identifier} =
          params
      )
      when is_binary(target_identifier) and target_identifier != "" do
    relation_type = Map.get(params, "type", @default_type)

    case Context.add_blocker(project_slug, source_identifier, target_identifier, relation_type) do
      {:ok, relation} ->
        conn
        |> put_status(:created)
        |> json(%{data: TrackerPresenter.blocker(relation)})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  def create(conn, _params), do: TrackerErrors.validation_msg(conn, "target_identifier is required")

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{
        "project_slug" => project_slug,
        "identifier" => source_identifier,
        "blocker_identifier" => target_identifier
      }) do
    case Context.delete_blocker(project_slug, source_identifier, target_identifier) do
      {:ok, _relation} ->
        send_resp(conn, :no_content, "")

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end
end
