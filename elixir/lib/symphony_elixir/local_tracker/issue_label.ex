defmodule SymphonyElixir.LocalTracker.IssueLabel do
  @moduledoc "Join table between local tracker issues and labels."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.{IssueRecord, Label}

  @primary_key false
  @type t :: %__MODULE__{}

  schema "local_tracker_issue_labels" do
    belongs_to(:issue, IssueRecord)
    belongs_to(:label, Label)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(issue_label, attrs) do
    issue_label
    |> cast(attrs, [:issue_id, :label_id])
    |> validate_required([:issue_id, :label_id])
    |> unique_constraint([:issue_id, :label_id])
  end
end
