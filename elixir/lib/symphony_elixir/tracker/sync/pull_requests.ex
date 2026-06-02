defmodule SymphonyElixir.Tracker.Sync.PullRequests do
  @moduledoc """
  Reads locally-mirrored pull requests (`tracker_pull_requests`) for display.

  This is the local-first counterpart to `GitHub.PullRequests.for_issue/2`, but it
  serves only the cached fields (number/url/title/state). Flows that need live CI
  rollups (e.g. the merge reconciler) must keep using the GitHub reader.
  """

  import Ecto.Query

  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.PullRequestRecord

  @type pr :: %{
          remote_id: String.t(),
          number: integer() | nil,
          url: String.t() | nil,
          title: String.t() | nil,
          state: String.t(),
          repo: String.t() | nil,
          origin: String.t()
        }

  @spec for_issue(String.t(), String.t()) :: {:ok, [pr()]}
  def for_issue(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    prs =
      from(pr in PullRequestRecord,
        join: issue in IssueRecord,
        on: pr.issue_id == issue.id,
        join: project in Project,
        on: issue.project_id == project.id,
        where: project.slug == ^project_slug and issue.identifier == ^identifier,
        order_by: [asc: pr.number, asc: pr.id]
      )
      |> Repo.all()
      |> Enum.map(&to_map/1)

    {:ok, prs}
  end

  defp to_map(%PullRequestRecord{} = pr) do
    %{
      remote_id: pr.remote_id,
      number: pr.number,
      url: pr.url,
      title: pr.title,
      state: pr.state,
      repo: pr.repo,
      origin: pr.origin
    }
  end
end
