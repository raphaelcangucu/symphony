defmodule SymphonyElixirWeb.Tracker.SecurityAdvisoryController do
  @moduledoc "GitHub security source endpoint for Load Context."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.{IssueRepo, ReadCache, SecurityAdvisories}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug} = params) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        repos = IssueRepo.candidate_repos(project, "")

        if repos == [] do
          json(conn, %{dependabot: [], advisories: [], supported: false})
        else
          state = if Map.get(params, "include_closed") in ["1", "true", true], do: "all", else: "open"
          advisory_state = if state == "all", do: "all", else: "published"

          case ReadCache.fetch({:project_security_advisories, project.slug, state}, fn ->
                 {:ok, SecurityAdvisories.list_for_project(repos, state: state, advisory_state: advisory_state)}
               end) do
            {:ok, data} -> json(conn, present(data))
            {:error, _reason} -> json(conn, %{dependabot: [], advisories: [], supported: true})
          end
        end

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  defp present(data) do
    %{
      supported: data.supported,
      dependabot: Enum.map(data.dependabot, &present_alert/1),
      advisories: Enum.map(data.advisories, &present_advisory/1)
    }
  end

  defp present_alert(alert) do
    %{
      number: alert.number,
      repo: alert.repo,
      state: alert.state,
      url: alert.url,
      package: alert.package,
      ghsa_id: alert.ghsa_id,
      summary: alert.summary,
      severity: alert.severity,
      updated_at: alert.updated_at
    }
  end

  defp present_advisory(advisory) do
    %{
      ghsa_id: advisory.ghsa_id,
      repo: advisory.repo,
      state: advisory.state,
      url: advisory.url,
      summary: advisory.summary,
      severity: advisory.severity,
      updated_at: advisory.updated_at
    }
  end
end
