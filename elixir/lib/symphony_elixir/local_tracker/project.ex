defmodule SymphonyElixir.LocalTracker.Project do
  @moduledoc "Persistent project record for the local tracker."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.{IssueRecord, Label, WorkflowStatus}

  @type t :: %__MODULE__{}

  schema "local_tracker_projects" do
    field(:name, :string)
    field(:slug, :string)
    field(:description, :string)

    has_many(:repositories, SymphonyElixir.LocalTracker.Repository)
    has_many(:statuses, WorkflowStatus)
    has_many(:issues, IssueRecord)
    has_many(:labels, Label)
    has_one(:setup, SymphonyElixir.LocalTracker.ProjectSetup)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(project, attrs) do
    project
    |> cast(attrs, [:name, :slug, :description])
    |> validate_required([:name, :slug])
    |> unique_constraint(:slug)
  end
end
