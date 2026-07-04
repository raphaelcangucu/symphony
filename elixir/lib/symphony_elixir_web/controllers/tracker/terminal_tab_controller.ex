defmodule SymphonyElixirWeb.Tracker.TerminalTabController do
  @moduledoc "Dynamic terminal tab CRUD for local tracker issues."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Terminal.Registry
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    case Registry.list_tabs(project_slug, identifier) do
      {:ok, tabs} -> json(conn, %{data: tabs})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    attrs = Map.take(params, ["title", "cwd", "command"])

    case Registry.create_tab(project_slug, identifier, attrs) do
      {:ok, tab} -> json(conn, %{data: tab})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec update(Conn.t(), map()) :: Conn.t()
  def update(conn, %{"project_slug" => project_slug, "identifier" => identifier, "tab_id" => tab_id} = params) do
    title = Map.get(params, "title")

    if is_binary(title) do
      case Registry.rename_tab(project_slug, identifier, tab_id, title) do
        {:ok, tab} -> json(conn, %{data: tab})
        {:error, reason} -> TrackerErrors.render(conn, reason)
      end
    else
      TrackerErrors.validation_msg(conn, "title is required")
    end
  end

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{"project_slug" => project_slug, "identifier" => identifier, "tab_id" => tab_id}) do
    case Registry.close_tab(project_slug, identifier, tab_id) do
      :ok -> send_resp(conn, 204, "")
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
end
