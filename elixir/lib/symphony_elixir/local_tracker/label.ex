defmodule SymphonyElixir.LocalTracker.Label do
  @moduledoc "Label scoped to a local tracker project."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.{IssueLabel, IssueRecord, Project}

  @type t :: %__MODULE__{}

  schema "local_tracker_labels" do
    field(:name, :string)
    field(:color, :string)
    field(:remote_id, :string)

    belongs_to(:project, Project)
    many_to_many(:issues, IssueRecord, join_through: IssueLabel, join_keys: [label_id: :id, issue_id: :id])

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(label, attrs) do
    label
    |> cast(attrs, [:project_id, :name, :color, :remote_id])
    |> validate_required([:project_id, :name])
    |> unique_constraint([:project_id, :name])
    |> unique_constraint([:project_id, :remote_id], name: :local_tracker_labels_project_id_remote_id_index)
  end
end
