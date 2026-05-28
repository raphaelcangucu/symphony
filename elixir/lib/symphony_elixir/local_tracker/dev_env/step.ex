defmodule SymphonyElixir.LocalTracker.DevEnv.Step do
  @moduledoc "A persisted dev-environment setup step for a project."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}
  @sources ~w(convention readme heuristic manual)

  schema "local_tracker_dev_env_steps" do
    field(:description, :string)
    field(:command, :string)
    field(:working_dir, :string)
    field(:position, :integer, default: 0)
    field(:source, :string, default: "manual")
    field(:optional, :boolean, default: false)

    belongs_to(:project, Project)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(step, attrs) do
    step
    |> cast(attrs, [:project_id, :description, :command, :working_dir, :position, :source, :optional])
    |> validate_required([:project_id, :description, :command])
    |> validate_inclusion(:source, @sources)
  end

  @spec sources() :: [String.t()]
  def sources, do: @sources
end
