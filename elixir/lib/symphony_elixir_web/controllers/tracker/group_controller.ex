defmodule SymphonyElixirWeb.Tracker.GroupController do
  @moduledoc "Issue group membership endpoints for the local tracker JSON API."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.{Context, IssueAdapter}
  alias SymphonyElixirWeb.TrackerErrors
  alias SymphonyElixirWeb.TrackerPresenter

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{
        "project_slug" => project_slug,
        "identifier" => member_identifier,
        "lead_identifier" => lead_identifier
      })
      when is_binary(lead_identifier) and lead_identifier != "" do
    case Context.set_issue_group(project_slug, member_identifier, lead_identifier) do
      {:ok, issue} ->
        conn
        |> put_status(:created)
        |> json(%{data: issue |> IssueAdapter.to_dto() |> TrackerPresenter.issue()})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  def create(conn, _params), do: TrackerErrors.validation_msg(conn, "lead_identifier is required")

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    case Context.remove_from_group(project_slug, identifier) do
      {:ok, _issue} -> send_resp(conn, :no_content, "")
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
end
