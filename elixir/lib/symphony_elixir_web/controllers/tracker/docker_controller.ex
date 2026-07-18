defmodule SymphonyElixirWeb.Tracker.DockerController do
  @moduledoc "JSON API for the local Docker dashboard (list containers, run lifecycle commands)."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Docker

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, _params) do
    case Docker.list_containers() do
      {:ok, containers} ->
        json(conn, %{data: %{available: true, error: nil, containers: containers}})

      {:error, reason} ->
        json(conn, %{data: %{available: false, error: reason, containers: []}})
    end
  end

  @spec command(Conn.t(), map()) :: Conn.t()
  def command(conn, %{"id" => id, "command" => command} = params) do
    case Docker.container_action(id, command, force: params["force"] == true) do
      :ok ->
        json(conn, %{data: %{ok: true}})

      {:error, :invalid_container_id} ->
        render_error(
          conn,
          422,
          "invalid_container_id",
          "Container id must be a 12-64 character hex string."
        )

      {:error, :invalid_action} ->
        render_error(
          conn,
          422,
          "invalid_action",
          "Command must be one of: start, stop, restart, remove."
        )

      {:error, reason} when is_binary(reason) ->
        render_error(conn, 502, "docker_action_failed", reason)
    end
  end

  defp render_error(conn, status, code, message) do
    conn
    |> Conn.put_status(status)
    |> json(%{error: %{code: code, message: message}})
  end
end
