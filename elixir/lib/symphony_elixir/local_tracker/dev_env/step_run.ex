defmodule SymphonyElixir.LocalTracker.DevEnv.StepRun do
  @moduledoc "Execution record of a single dev-env step within a run."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.DevEnv.{Run, Step}

  @type t :: %__MODULE__{}
  @statuses ~w(pending running succeeded failed skipped)

  schema "local_tracker_dev_env_step_runs" do
    field(:description, :string)
    field(:command, :string)
    field(:status, :string, default: "pending")
    field(:exit_code, :integer)
    field(:output, :string)
    field(:started_at, :utc_datetime_usec)
    field(:completed_at, :utc_datetime_usec)

    belongs_to(:run, Run)
    belongs_to(:step, Step)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(step_run, attrs) do
    step_run
    |> cast(attrs, [:run_id, :step_id, :description, :command, :status, :exit_code, :output, :started_at, :completed_at])
    |> validate_required([:run_id, :description, :command, :status])
    |> validate_inclusion(:status, @statuses)
  end
end
