defmodule SymphonyElixirWeb.Tracker.BranchController do
  @moduledoc "Project-scoped repo branch list/search for launcher and clone pickers."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.{Branches, IssueRepo, ReadCache}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug} = params) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        repos = IssueRepo.candidate_repos(project, "")

        if repos == [] do
          json(conn, %{data: [], supported: false})
        else
          query = normalize_query(Map.get(params, "q"))
          cache_key = {:project_branches, project.slug, query || :all}

          case ReadCache.fetch(cache_key, fn ->
                 {:ok, fetch_branches(repos, query)}
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

  defp fetch_branches(repos, nil), do: Branches.list_for_project(repos)

  defp fetch_branches(repos, query) do
    case Branches.search_for_project(repos, query) do
      [] ->
        # Prefix too short for matching-refs, or no remote hits — filter the capped list.
        repos
        |> Branches.list_for_project()
        |> filter_local(query)

      matches ->
        matches
    end
  end

  defp filter_local(branches, query) do
    needle = String.downcase(query)

    Enum.filter(branches, fn branch ->
      String.contains?(String.downcase(branch.name), needle)
    end)
  end

  defp normalize_query(query) when is_binary(query) do
    case String.trim(query) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_query(_), do: nil

  defp present(branch) do
    %{name: branch.name, repo: branch.repo, protected: branch.protected, commit_sha: branch.commit_sha}
  end
end
