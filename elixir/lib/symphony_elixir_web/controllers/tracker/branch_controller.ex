defmodule SymphonyElixirWeb.Tracker.BranchController do
  @moduledoc "Project-scoped repo branch list for the Quick-Open launcher."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.{Branches, IssueRepo, ReadCache}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug}) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        repos = IssueRepo.candidate_repos(project, "")

        if repos == [] do
          json(conn, %{data: [], supported: false})
        else
          case ReadCache.fetch({:project_branches, project.slug}, fn ->
                 {:ok, Branches.list_for_project(repos)}
               end) do
            {:ok, data} ->
              json(conn, %{data: Enum.map(data, &present/1), supported: true})

            {:error, _reason} ->
              json(conn, %{data: [], supported: true})
          end
        end

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  defp present(branch) do
    %{name: branch.name, repo: branch.repo, protected: branch.protected, commit_sha: branch.commit_sha}
  end
end
