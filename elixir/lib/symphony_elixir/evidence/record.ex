defmodule SymphonyElixir.Evidence.Record do
  @moduledoc "Persisted evidence run for an issue (manifest snapshot + durable artifact dir)."

  use Ecto.Schema

  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}

  schema "issue_evidence" do
    field(:issue_identifier, :string)
    field(:run_id, :string)
    field(:session_id, :string)
    field(:status, :string, default: "passed")
    field(:ui_change, :boolean, default: false)
    field(:manifest, :map, default: %{})
    field(:artifact_dir, :string)

    belongs_to(:project, Project)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, [
      :project_id,
      :issue_identifier,
      :run_id,
      :session_id,
      :status,
      :ui_change,
      :manifest,
      :artifact_dir
    ])
    |> validate_required([:project_id, :issue_identifier, :run_id, :status, :artifact_dir])
    |> unique_constraint([:project_id, :issue_identifier, :run_id])
  end
end
