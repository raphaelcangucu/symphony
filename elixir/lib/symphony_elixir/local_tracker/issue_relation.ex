defmodule SymphonyElixir.LocalTracker.IssueRelation do
  @moduledoc "Directed relationship between two local tracker issues."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.IssueRecord

  @type t :: %__MODULE__{}

  schema "local_tracker_issue_relations" do
    field(:type, :string)

    belongs_to(:source_issue, IssueRecord)
    belongs_to(:target_issue, IssueRecord)

    timestamps(updated_at: false, type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(relation, attrs) do
    relation
    |> cast(attrs, [:source_issue_id, :target_issue_id, :type])
    |> validate_required([:source_issue_id, :target_issue_id, :type])
    |> unique_constraint([:source_issue_id, :target_issue_id, :type])
  end
end
