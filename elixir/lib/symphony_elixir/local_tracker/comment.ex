defmodule SymphonyElixir.LocalTracker.Comment do
  @moduledoc "Comment or workpad entry attached to a local tracker issue."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.IssueRecord

  @type t :: %__MODULE__{}

  schema "local_tracker_comments" do
    field(:kind, :string, default: "comment")
    field(:body, :string)
    field(:author, :string, default: "local")

    belongs_to(:issue, IssueRecord)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(comment, attrs) do
    comment
    |> cast(attrs, [:issue_id, :kind, :body, :author])
    |> validate_required([:issue_id, :kind, :body, :author])
  end
end
