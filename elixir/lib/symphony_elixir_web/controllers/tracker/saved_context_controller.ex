defmodule SymphonyElixirWeb.Tracker.SavedContextController do
  @moduledoc "Saved context library endpoints for Load Context."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.SavedContexts
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug}) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      json(conn, %{data: Enum.map(SavedContexts.list(project_slug), &present/1)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"project_slug" => project_slug} = params) do
    params =
      params
      |> Map.drop(["project_slug"])
      |> Map.put("project_slug", project_slug)

    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, entry} <- SavedContexts.create(params) do
      conn
      |> put_status(:created)
      |> json(%{data: present(entry)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp present(entry) do
    %{
      id: entry.id,
      project_slug: entry.project_slug,
      slug: entry.slug,
      name: entry.name,
      content_md: entry.content_md,
      source_scope: entry.source_scope,
      source_issue_identifier: entry.source_issue_identifier,
      source_thread_id: entry.source_thread_id,
      metadata: entry.metadata || %{},
      inserted_at: iso8601(entry.inserted_at),
      updated_at: iso8601(entry.updated_at)
    }
  end

  defp iso8601(nil), do: nil
  defp iso8601(%DateTime{} = value), do: DateTime.to_iso8601(value)
  defp iso8601(%NaiveDateTime{} = value), do: value |> DateTime.from_naive!("Etc/UTC") |> DateTime.to_iso8601()
end
