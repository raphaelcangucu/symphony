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
    field(:remote_id, :string)
    field(:sync_status, :string, default: "synced")
    field(:remote_updated_at, :utc_datetime_usec)
    field(:last_synced_at, :utc_datetime_usec)
    field(:dirty_fields, :map, default: %{})

    belongs_to(:issue, IssueRecord)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(comment, attrs) do
    comment
    |> cast(attrs, [
      :issue_id,
      :kind,
      :body,
      :author,
      :remote_id,
      :sync_status,
      :remote_updated_at,
      :last_synced_at,
      :dirty_fields
    ])
    |> validate_required([:issue_id, :kind, :body, :author])
    |> validate_inclusion(:sync_status, ~w(synced pending conflict error archived))
    |> unique_constraint([:issue_id, :remote_id], name: :local_tracker_comments_issue_id_remote_id_index)
  end
end
