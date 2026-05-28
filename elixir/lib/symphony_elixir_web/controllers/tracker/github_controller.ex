defmodule SymphonyElixirWeb.Tracker.GitHubController do
  @moduledoc "GitHub discovery endpoints for the local tracker workspace wizard."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.GitHubDiscovery
  alias SymphonyElixirWeb.TrackerErrors

  @spec owners(Conn.t(), map()) :: Conn.t()
  def owners(conn, _params) do
    case GitHubDiscovery.list_owners(github_opts()) do
      {:ok, owners} -> json(conn, %{data: owners})
      {:error, reason} -> TrackerErrors.render(conn, inspect(reason))
    end
  end

  @spec repositories(Conn.t(), map()) :: Conn.t()
  def repositories(conn, %{"owner" => owner}) do
    case GitHubDiscovery.list_repositories(owner, github_opts()) do
      {:ok, repositories} -> json(conn, %{data: repositories})
      {:error, reason} -> TrackerErrors.render(conn, inspect(reason))
    end
  end

  defp github_opts do
    case Application.get_env(:symphony_elixir, :local_tracker_github_request_fun) do
      fun when is_function(fun, 2) -> [request_fun: fun]
      _ -> []
    end
  end
end
