defmodule SymphonyElixir.Tracker.Sync.DismissedPullRequestRecord do
  @moduledoc "A pull request URL explicitly unlinked from a tracker issue by the user."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}

  schema "tracker_dismissed_pull_requests" do
    field(:issue_identifier, :string)
    field(:url, :string)

    belongs_to(:project, Project)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, [:project_id, :issue_identifier, :url])
    |> validate_required([:project_id, :issue_identifier, :url])
    |> unique_constraint([:project_id, :issue_identifier, :url],
      name: :tracker_dismissed_pull_requests_project_issue_url_index
    )
  end
end
