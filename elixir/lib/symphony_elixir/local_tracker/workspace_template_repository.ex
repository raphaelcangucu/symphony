defmodule SymphonyElixir.LocalTracker.WorkspaceTemplateRepository do
  @moduledoc "A repository entry inside a workspace template."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.WorkspaceTemplate

  @type t :: %__MODULE__{}

  schema "local_tracker_workspace_template_repositories" do
    field(:github_full_name, :string)
    field(:clone_url, :string)
    field(:default_branch, :string)
    field(:workspace_path, :string)
    field(:role, :string)

    belongs_to(:template, WorkspaceTemplate)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(repository, attrs) do
    repository
    |> cast(attrs, [:github_full_name, :clone_url, :default_branch, :workspace_path, :role, :template_id])
    |> validate_required([:github_full_name, :clone_url, :workspace_path])
  end
end
