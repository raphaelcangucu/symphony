defmodule SymphonyElixir.LocalTracker.ActivityEvent do
  @moduledoc "Append-only activity event for a local tracker issue."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.IssueRecord

  @type t :: %__MODULE__{}

  schema "local_tracker_activity_events" do
    field(:event_type, :string)
    field(:metadata, :map, default: %{})

    belongs_to(:issue, IssueRecord)

    timestamps(updated_at: false, type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(event, attrs) do
    event
    |> cast(attrs, [:issue_id, :event_type, :metadata])
    |> validate_required([:issue_id, :event_type, :metadata])
  end
end
