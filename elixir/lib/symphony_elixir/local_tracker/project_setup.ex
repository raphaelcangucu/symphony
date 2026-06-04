defmodule SymphonyElixir.LocalTracker.ProjectSetup do
  @moduledoc "Generated setup metadata for a local tracker workspace project."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}

  schema "local_tracker_project_setups" do
    field(:workflow_markdown, :string)
    field(:after_create_hook, :string)
    field(:validation_commands, :map, default: %{"commands" => []})
    field(:scan_summary, :map, default: %{})

    belongs_to(:project, Project)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(setup, attrs) do
    setup
    |> cast(attrs, [
      :project_id,
      :workflow_markdown,
      :after_create_hook,
      :validation_commands,
      :scan_summary
    ])
    |> validate_required([:project_id, :validation_commands, :scan_summary])
    |> unique_constraint(:project_id)
  end
end
