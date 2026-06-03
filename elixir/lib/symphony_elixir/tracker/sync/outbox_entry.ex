defmodule SymphonyElixir.Tracker.Sync.OutboxEntry do
  @moduledoc "A queued local tracker write awaiting push to the remote source."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}

  @type t :: %__MODULE__{}

  @entity_types ~w(issue comment label state assignee)
  @operations ~w(create update move add remove archive restore delete)
  @statuses ~w(pending in_flight done failed conflict)

  schema "tracker_sync_outbox" do
    field(:entity_type, :string)
    field(:operation, :string)
    field(:payload, :map, default: %{})
    field(:dedup_key, :string)
    field(:status, :string, default: "pending")
    field(:attempts, :integer, default: 0)
    field(:last_error, :string)
    field(:remote_id, :string)

    belongs_to(:project, Project)
    belongs_to(:issue, IssueRecord)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(entry, attrs) do
    entry
    |> cast(attrs, [
      :project_id,
      :issue_id,
      :entity_type,
      :operation,
      :payload,
      :dedup_key,
      :status,
      :attempts,
      :last_error,
      :remote_id
    ])
    |> validate_required([:project_id, :entity_type, :operation, :payload, :status])
    |> validate_inclusion(:entity_type, @entity_types)
    |> validate_inclusion(:operation, @operations)
    |> validate_inclusion(:status, @statuses)
    |> validate_number(:attempts, greater_than_or_equal_to: 0)
  end
end
