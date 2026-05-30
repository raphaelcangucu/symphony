defmodule SymphonyElixirWeb.Tracker.DevServerController do
  @moduledoc "Dev-server endpoints for local tracker issues."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.DevServer
  alias SymphonyElixir.DevServer.Manager
  alias SymphonyElixirWeb.{DevServerPresenter, TrackerErrors}

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    render_targets(conn, project_slug, identifier)
  end

  @spec start(Conn.t(), map()) :: Conn.t()
  def start(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    project_slug
    |> Manager.start_for_issue(identifier)
    |> action_error_reason()
    |> then(&render_targets(conn, project_slug, identifier, &1))
  end

  @spec stop(Conn.t(), map()) :: Conn.t()
  def stop(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    Manager.stop_for_issue(project_slug, identifier)
    render_targets(conn, project_slug, identifier)
  end

  @spec restart(Conn.t(), map()) :: Conn.t()
  def restart(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    project_slug
    |> Manager.restart_for_issue(identifier)
    |> action_error_reason()
    |> then(&render_targets(conn, project_slug, identifier, &1))
  end

  defp render_targets(conn, project_slug, identifier, action_error_reason \\ nil) do
    case DevServer.issue_targets(project_slug, identifier) do
      {:ok, view} -> json(conn, %{data: DevServerPresenter.view(apply_action_error(view, action_error_reason))})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp action_error_reason({:error, reason}) when is_atom(reason), do: reason
  defp action_error_reason(_result), do: nil

  defp apply_action_error(view, nil), do: view
  defp apply_action_error(%{reason: reason} = view, _action_error_reason) when not is_nil(reason), do: view

  defp apply_action_error(%{available: true} = view, action_error_reason) do
    %{view | available: false, reason: action_error_reason}
  end

  defp apply_action_error(view, action_error_reason), do: Map.put_new(view, :reason, action_error_reason)
end
