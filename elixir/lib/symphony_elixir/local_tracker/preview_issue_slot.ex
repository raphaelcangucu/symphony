defmodule SymphonyElixir.LocalTracker.PreviewIssueSlot do
  @moduledoc "Per-issue lease of one slot index inside a project's preview band."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}

  schema "local_tracker_preview_issue_slots" do
    field(:issue_identifier, :string)
    field(:slot_index, :integer)
    belongs_to(:project, Project)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, [:project_id, :issue_identifier, :slot_index])
    |> validate_required([:project_id, :issue_identifier, :slot_index])
    |> validate_number(:slot_index, greater_than_or_equal_to: 0)
    |> unique_constraint([:project_id, :issue_identifier])
    |> unique_constraint([:project_id, :slot_index])
  end
end
