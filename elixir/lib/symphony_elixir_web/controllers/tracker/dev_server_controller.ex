defmodule SymphonyElixirWeb.Tracker.DevServerController do
  @moduledoc "Dev-server endpoints for local tracker issues."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Cloudflare.Tunnel
  alias SymphonyElixir.DevServer
  alias SymphonyElixir.DevServer.Manager
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixirWeb.{DevServerEventStream, DevServerPresenter, TrackerErrors}

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

  @spec start_server(Conn.t(), map()) :: Conn.t()
  def start_server(conn, %{"project_slug" => project_slug, "identifier" => identifier, "server_id" => server_id}) do
    with_valid_issue(conn, project_slug, identifier, fn ->
      with {:ok, id} <- parse_server_id(server_id) do
        project_slug
        |> Manager.start_instance_for_server(identifier, id)
        |> instance_action_result(conn, project_slug, identifier, "start_failed")
      else
        {:error, :invalid_server_id} -> TrackerErrors.validation(conn, "server_id must be a positive integer")
        {:error, :not_found} -> TrackerErrors.render(conn, :dev_server_not_found)
      end
    end)
  end

  @spec stop_server(Conn.t(), map()) :: Conn.t()
  def stop_server(conn, %{"project_slug" => project_slug, "identifier" => identifier, "server_id" => server_id}) do
    with_valid_issue(conn, project_slug, identifier, fn ->
      with {:ok, id} <- parse_server_id(server_id) do
        case Manager.stop_instance_for_server(project_slug, identifier, id) do
          :ok -> render_targets(conn, project_slug, identifier)
          {:error, :not_found} -> TrackerErrors.render(conn, :dev_server_not_found)
          {:error, _reason} -> render_targets(conn, project_slug, identifier)
        end
      else
        {:error, :invalid_server_id} -> TrackerErrors.validation(conn, "server_id must be a positive integer")
      end
    end)
  end

  @spec restart_server(Conn.t(), map()) :: Conn.t()
  def restart_server(conn, %{"project_slug" => project_slug, "identifier" => identifier, "server_id" => server_id}) do
    with_valid_issue(conn, project_slug, identifier, fn ->
      with {:ok, id} <- parse_server_id(server_id) do
        project_slug
        |> Manager.restart_instance_for_server(identifier, id)
        |> instance_action_result(conn, project_slug, identifier, "restart_failed")
      else
        {:error, :invalid_server_id} -> TrackerErrors.validation(conn, "server_id must be a positive integer")
        {:error, :not_found} -> TrackerErrors.render(conn, :dev_server_not_found)
      end
    end)
  end

  @spec events(Conn.t(), map()) :: Conn.t()
  def events(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with_valid_issue(conn, project_slug, identifier, fn ->
      DevServerEventStream.stream(conn, project_slug, identifier)
    end)
  end

  @spec output(Conn.t(), map()) :: Conn.t()
  def output(conn, %{"project_slug" => project_slug, "identifier" => identifier, "server_id" => server_id}) do
    with_valid_issue(conn, project_slug, identifier, fn ->
      with {:ok, id} <- parse_server_id(server_id) do
        case Manager.capture_server_output(project_slug, identifier, id) do
          {:ok, payload} ->
            json(conn, %{data: payload})

          {:error, :not_found} ->
            TrackerErrors.render(conn, :dev_server_not_found)

          {:error, message} when is_binary(message) ->
            TrackerErrors.render(conn, message)
        end
      else
        {:error, :invalid_server_id} -> TrackerErrors.validation(conn, "server_id must be a positive integer")
      end
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

  defp instance_action_result({:ok, _pids}, conn, project_slug, identifier, _fallback_reason) do
    render_targets(conn, project_slug, identifier)
  end

  defp instance_action_result({:error, :not_found}, conn, _project_slug, _identifier, _fallback_reason) do
    TrackerErrors.render(conn, :dev_server_not_found)
  end

  defp instance_action_result({:error, reason}, conn, project_slug, identifier, fallback_reason) do
    reason
    |> then(&action_error_reason({:error, &1}, fallback_reason))
    |> then(&render_targets(conn, project_slug, identifier, &1))
  end

  defp parse_server_id(server_id) when is_binary(server_id) do
    case Integer.parse(String.trim(server_id)) do
      {id, ""} when id > 0 -> {:ok, id}
      _ -> {:error, :invalid_server_id}
    end
  end

  defp parse_server_id(_server_id), do: {:error, :invalid_server_id}
end
