defmodule SymphonyElixir.LocalTracker.IssueRecord do
  @moduledoc "Persistent issue record for the local tracker."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.{
    Comment,
    IssueLabel,
    IssueRelation,
    Label,
    Project,
    WorkflowStatus
  }

  @type t :: %__MODULE__{}

  schema "local_tracker_issues" do
    field(:identifier, :string)
    field(:title, :string)
    field(:description, :string)
    field(:priority, :integer)
    field(:position, :integer)
    field(:assignee_id, :string)
    field(:worker_id, :string)
    field(:branch_name, :string)
    field(:url, :string)
    field(:started_at, :utc_datetime_usec)
    field(:completed_at, :utc_datetime_usec)

    belongs_to(:project, Project)
    belongs_to(:status, WorkflowStatus)
    has_many(:comments, Comment, foreign_key: :issue_id)
    has_many(:source_relations, IssueRelation, foreign_key: :source_issue_id)
    has_many(:target_relations, IssueRelation, foreign_key: :target_issue_id)
    many_to_many(:labels, Label, join_through: IssueLabel, join_keys: [issue_id: :id, label_id: :id])

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(issue, attrs) do
    issue
    |> cast(attrs, [
      :project_id,
      :status_id,
      :identifier,
      :title,
      :description,
      :priority,
      :position,
      :assignee_id,
      :worker_id,
      :branch_name,
      :url,
      :started_at,
      :completed_at
    ])
    |> validate_required([:project_id, :status_id, :identifier, :title, :position])
    |> validate_number(:priority, greater_than_or_equal_to: 0, less_than_or_equal_to: 4)
    |> unique_constraint([:project_id, :identifier])
  end
end
