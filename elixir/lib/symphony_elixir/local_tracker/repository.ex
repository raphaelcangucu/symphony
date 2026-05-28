defmodule SymphonyElixir.LocalTracker.Repository do
  @moduledoc "Repository that composes a local tracker workspace project."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}

  schema "local_tracker_repositories" do
    field(:github_full_name, :string)
    field(:clone_url, :string)
    field(:default_branch, :string)
    field(:selected_branch, :string)
    field(:local_path, :string)
    field(:workspace_path, :string)
    field(:role, :string)
    field(:scan_summary, :map, default: %{})

    belongs_to(:project, Project)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(repository, attrs) do
    repository
    |> cast(attrs, [
      :project_id,
      :github_full_name,
      :clone_url,
      :default_branch,
      :selected_branch,
      :local_path,
      :workspace_path,
      :role,
      :scan_summary
    ])
    |> validate_required([:project_id, :github_full_name, :workspace_path, :role])
    |> validate_format(:workspace_path, ~r/^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/,
      message: "must be a relative workspace path"
    )
    |> validate_no_parent_traversal(:workspace_path)
    |> unique_constraint([:project_id, :workspace_path])
  end

  defp validate_no_parent_traversal(changeset, field) do
    validate_change(changeset, field, fn ^field, value ->
      if String.split(value, "/") |> Enum.any?(&(&1 == "..")) do
        [{field, "must not contain parent traversal"}]
      else
        []
      end
    end)
  end
end
