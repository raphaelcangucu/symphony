defmodule SymphonyElixir.LocalTracker.DevEnv.Run do
  @moduledoc "A grouped execution of dev-env steps."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.DevEnv.StepRun
  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}
  @statuses ~w(pending running succeeded failed)

  schema "local_tracker_dev_env_runs" do
    field(:status, :string, default: "pending")
    field(:started_at, :utc_datetime_usec)
    field(:completed_at, :utc_datetime_usec)

    belongs_to(:project, Project)
    has_many(:step_runs, StepRun, foreign_key: :run_id, on_delete: :delete_all)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(run, attrs) do
    run
    |> cast(attrs, [:project_id, :status, :started_at, :completed_at])
    |> validate_required([:project_id, :status])
    |> validate_inclusion(:status, @statuses)
  end
end
