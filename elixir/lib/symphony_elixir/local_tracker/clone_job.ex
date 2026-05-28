defmodule SymphonyElixir.LocalTracker.CloneJob do
  @moduledoc "Per-repository clone job tracked for a project instantiated from a template."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.{Project, Repository}

  @type t :: %__MODULE__{}
  @statuses ~w(pending running succeeded failed skipped)

  schema "local_tracker_clone_jobs" do
    field(:status, :string, default: "pending")
    field(:error, :string)
    field(:started_at, :utc_datetime_usec)
    field(:completed_at, :utc_datetime_usec)
    field(:commit_sha, :string)

    belongs_to(:project, Project)
    belongs_to(:repository, Repository)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(job, attrs) do
    job
    |> cast(attrs, [:project_id, :repository_id, :status, :error, :started_at, :completed_at, :commit_sha])
    |> validate_required([:project_id, :repository_id, :status])
    |> validate_inclusion(:status, @statuses)
    |> unique_constraint([:project_id, :repository_id])
  end

  @spec statuses() :: [String.t()]
  def statuses, do: @statuses
end
