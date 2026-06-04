defmodule SymphonyElixirWeb.Tracker.RemoteDiscoveryController do
  @moduledoc "Discovers GitHub Project v2 boards and Linear projects for the wizard."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.Discovery
  alias SymphonyElixir.Linear.Discovery, as: LinearDiscovery
  alias SymphonyElixirWeb.TrackerErrors

  @spec github_discover(Conn.t(), map()) :: Conn.t()
  def github_discover(conn, _params) do
    case Discovery.list_projects() do
      {:ok, projects} ->
        json(conn, %{data: projects})

      {:error, reason} ->
        TrackerErrors.render(conn, github_error(reason))
    end
  end

  @spec linear_discover(Conn.t(), map()) :: Conn.t()
  def linear_discover(conn, _params) do
    case LinearDiscovery.list_projects() do
      {:ok, projects} ->
        json(conn, %{data: projects})

      {:error, reason} ->
        TrackerErrors.render(conn, linear_error(reason))
    end
  end

  defp github_error(:missing_github_token), do: :missing_credentials
  defp github_error({:rate_limited, _info} = reason), do: reason
  defp github_error({:github_api_status, 401}), do: :remote_unauthorized
  defp github_error({:github_api_status, 403}), do: :remote_forbidden
  defp github_error(_), do: :remote_unavailable

  defp linear_error({:rate_limited, _info} = reason), do: reason
  defp linear_error({:linear_api_status, 401}), do: :remote_unauthorized
  defp linear_error(_), do: :remote_unavailable
end
