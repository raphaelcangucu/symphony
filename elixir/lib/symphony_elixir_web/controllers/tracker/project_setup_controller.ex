defmodule SymphonyElixirWeb.Tracker.ProjectSetupController do
  @moduledoc "Workspace project setup endpoints for scan and deterministic suggestions."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.{RepositoryScanner, WorkflowSuggester}
  alias SymphonyElixirWeb.TrackerErrors

  @spec scan(Conn.t(), map()) :: Conn.t()
  def scan(conn, %{"repositories" => repositories}) when is_list(repositories) do
    scans =
      Enum.map(repositories, fn repository ->
        case RepositoryScanner.scan(repository) do
          {:ok, scan} -> scan
          {:error, reason} -> %{workspace_path: Map.get(repository, "workspace_path"), error: reason}
        end
      end)

    json(conn, %{data: %{scans: scans}})
  end

  def scan(conn, _params), do: TrackerErrors.validation(conn, "repositories is required")

  @spec suggest(Conn.t(), map()) :: Conn.t()
  def suggest(conn, params) do
    {:ok, suggestion} = WorkflowSuggester.suggest(params)
    json(conn, %{data: suggestion})
  end
end
