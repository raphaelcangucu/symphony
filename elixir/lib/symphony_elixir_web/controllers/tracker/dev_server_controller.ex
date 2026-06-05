defmodule SymphonyElixirWeb.Tracker.DevServerController do
  @moduledoc "Dev-server endpoints for local tracker issues."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Cloudflare.Tunnel
  alias SymphonyElixir.DevServer
  alias SymphonyElixir.DevServer.Manager
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixirWeb.{DevServerPresenter, TrackerErrors}

  @availability_action_error_reasons ~w(disabled workspace_missing no_serve_step no_free_port lock_unavailable crashed)a

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with_valid_issue(conn, project_slug, identifier, fn ->
      render_targets(conn, project_slug, identifier)
    end)
  end

  @spec start(Conn.t(), map()) :: Conn.t()
  def start(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with_valid_issue(conn, project_slug, identifier, fn ->
      project_slug
      |> Manager.start_for_issue(identifier)
      |> action_error_reason("start_failed")
      |> then(&render_targets(conn, project_slug, identifier, &1))
    end)
  end

  @spec stop(Conn.t(), map()) :: Conn.t()
  def stop(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with_valid_issue(conn, project_slug, identifier, fn ->
      Manager.stop_for_issue(project_slug, identifier)
      render_targets(conn, project_slug, identifier)
    end)
  end

  @spec restart(Conn.t(), map()) :: Conn.t()
  def restart(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with_valid_issue(conn, project_slug, identifier, fn ->
      project_slug
      |> Manager.restart_for_issue(identifier)
      |> action_error_reason("restart_failed")
      |> then(&render_targets(conn, project_slug, identifier, &1))
    end)
  end

  defp with_valid_issue(conn, project_slug, identifier, render) when is_function(render, 0) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, _issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      render.()
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp render_targets(conn, project_slug, identifier, action_error_reason \\ nil) do
    case DevServer.issue_targets(project_slug, identifier) do
      {:ok, view} ->
        data =
          view
          |> apply_action_error(action_error_reason)
          |> DevServerPresenter.view()
          |> Map.put(:tunnel, Tunnel.summary())

        json(conn, %{data: data})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  defp action_error_reason({:error, reason}, _fallback_reason) when reason in @availability_action_error_reasons,
    do: reason

  defp action_error_reason({:error, _reason}, fallback_reason), do: fallback_reason
  defp action_error_reason(_result, _fallback_reason), do: nil

  defp apply_action_error(view, nil), do: view
  defp apply_action_error(%{reason: reason} = view, _action_error_reason) when not is_nil(reason), do: view

  defp apply_action_error(%{reason: nil} = view, action_error_reason) do
    %{view | available: false, reason: action_error_reason}
  end

  defp apply_action_error(view, action_error_reason) do
    view
    |> Map.put(:available, false)
    |> Map.put(:reason, action_error_reason)
  end
end
