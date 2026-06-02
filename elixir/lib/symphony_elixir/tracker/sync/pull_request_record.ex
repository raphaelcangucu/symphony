defmodule SymphonyElixir.Tracker.Sync.PullRequestRecord do
  @moduledoc "A GitHub pull request linked to a tracker issue (source-control sync)."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.IssueRecord

  @type t :: %__MODULE__{}

  @states ~w(open closed merged draft unknown)
  @origins ~w(auto manual)

  schema "tracker_pull_requests" do
    field(:remote_id, :string)
    field(:number, :integer)
    field(:url, :string)
    field(:title, :string)
    field(:state, :string)
    field(:repo, :string)
    field(:origin, :string, default: "auto")
    field(:last_synced_at, :utc_datetime_usec)

    belongs_to(:issue, IssueRecord)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, [:issue_id, :remote_id, :number, :url, :title, :state, :repo, :origin, :last_synced_at])
    |> validate_required([:issue_id, :remote_id, :state])
    |> validate_inclusion(:state, @states)
    |> validate_inclusion(:origin, @origins)
    |> unique_constraint([:issue_id, :remote_id])
  end
end
