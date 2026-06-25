defmodule SymphonyElixir.LocalTracker.PreviewBand do
  @moduledoc "Per-project reservation of one preview port band index."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}

  schema "local_tracker_preview_bands" do
    field(:band_index, :integer)
    belongs_to(:project, Project)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, [:project_id, :band_index])
    |> validate_required([:project_id, :band_index])
    |> validate_number(:band_index, greater_than_or_equal_to: 0)
    |> unique_constraint(:project_id)
    |> unique_constraint(:band_index)
  end
end
