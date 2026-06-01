defmodule SymphonyElixir.Tracker.Sync.StateRecord do
  @moduledoc "Per-project sync bookkeeping (cursor, timestamps, status)."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}

  @statuses ~w(idle syncing error)

  schema "tracker_sync_state" do
    field(:last_full_sync_at, :utc_datetime_usec)
    field(:last_incremental_cursor, :string)
    field(:last_pull_at, :utc_datetime_usec)
    field(:last_push_at, :utc_datetime_usec)
    field(:status, :string, default: "idle")
    field(:last_error, :string)

    belongs_to(:project, Project)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(state, attrs) do
    state
    |> cast(attrs, [
      :project_id,
      :last_full_sync_at,
      :last_incremental_cursor,
      :last_pull_at,
      :last_push_at,
      :status,
      :last_error
    ])
    |> validate_required([:project_id, :status])
    |> validate_inclusion(:status, @statuses)
    |> unique_constraint(:project_id)
  end
end
