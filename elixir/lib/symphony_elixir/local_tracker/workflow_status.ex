defmodule SymphonyElixir.LocalTracker.WorkflowStatus do
  @moduledoc "Workflow status for a local tracker project."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}

  @type t :: %__MODULE__{}

  schema "local_tracker_workflow_statuses" do
    field(:name, :string)
    field(:category, :string)
    field(:position, :integer)
    field(:is_terminal, :boolean, default: false)

    belongs_to(:project, Project)
    has_many(:issues, IssueRecord, foreign_key: :status_id)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(status, attrs) do
    status
    |> cast(attrs, [:project_id, :name, :category, :position, :is_terminal])
    |> validate_required([:project_id, :name, :category, :position])
    |> unique_constraint([:project_id, :name])
  end
end
