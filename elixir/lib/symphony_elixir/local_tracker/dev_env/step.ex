defmodule SymphonyElixir.LocalTracker.DevEnv.Step do
  @moduledoc "A persisted dev-environment setup step for a project."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}
  @sources ~w(convention readme heuristic manual)
  @roles ~w(setup serve)
  @probes ~w(tcp http)

  schema "local_tracker_dev_env_steps" do
    field(:description, :string)
    field(:command, :string)
    field(:working_dir, :string)
    field(:position, :integer, default: 0)
    field(:source, :string, default: "manual")
    field(:optional, :boolean, default: false)
    field(:role, :string, default: "setup")
    field(:port_env, :string)
    field(:url_path, :string, default: "/")
    field(:ready_probe, :string, default: "tcp")
    field(:ready_path, :string, default: "/")
    field(:primary, :boolean, default: false)

    belongs_to(:project, Project)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(step, attrs) do
    step
    |> cast(attrs, [
      :project_id,
      :description,
      :command,
      :working_dir,
      :position,
      :source,
      :optional,
      :role,
      :port_env,
      :url_path,
      :ready_probe,
      :ready_path,
      :primary
    ])
    |> validate_required([:project_id, :description, :command])
    |> validate_inclusion(:source, @sources)
    |> validate_inclusion(:role, @roles)
    |> validate_inclusion(:ready_probe, @probes)
  end

  @spec sources() :: [String.t()]
  def sources, do: @sources

  @spec roles() :: [String.t()]
  def roles, do: @roles
end
