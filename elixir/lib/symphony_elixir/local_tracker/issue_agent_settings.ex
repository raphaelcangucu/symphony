defmodule SymphonyElixir.LocalTracker.IssueAgentSettings do
  @moduledoc """
  Per-issue operator overrides for the coding agent: which `agent_kind`, `model`,
  reasoning `effort`, and execution `mode` (plan/build/yolo) to use for autonomous
  orchestrator runs.

  Keyed by `project_slug` + `identifier` (both strings) so the overrides apply
  uniformly across GitHub / Jira / Linear / local issues, independent of whether a
  local issue row exists, and survive orchestrator retries.
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias SymphonyElixir.ExecutionMode

  @type t :: %__MODULE__{}

  @castable_fields ~w(project_slug identifier agent_kind model effort mode)a
  @required_fields ~w(project_slug identifier)a

  schema "local_tracker_issue_agent_settings" do
    field(:project_slug, :string)
    field(:identifier, :string)
    field(:agent_kind, :string)
    field(:model, :string)
    field(:effort, :string)
    field(:mode, :string)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, @castable_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:mode, ExecutionMode.all())
    |> unique_constraint([:project_slug, :identifier])
  end
end
