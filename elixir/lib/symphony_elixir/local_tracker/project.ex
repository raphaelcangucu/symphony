defmodule SymphonyElixir.LocalTracker.Project do
  @moduledoc "Persistent project record for the local tracker."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.{IssueRecord, Label, WorkflowStatus}

  @type t :: %__MODULE__{}

  schema "local_tracker_projects" do
    field(:name, :string)
    field(:slug, :string)
    field(:description, :string)
    field(:archived_at, :utc_datetime_usec)
    field(:tracker_kind, :string, default: "local")
    field(:tracker_config, :map, default: %{})

    has_many(:repositories, SymphonyElixir.LocalTracker.Repository)
    has_many(:statuses, WorkflowStatus)
    has_many(:issues, IssueRecord)
    has_many(:labels, Label)
    has_one(:setup, SymphonyElixir.LocalTracker.ProjectSetup)

    timestamps(type: :utc_datetime_usec)
  end

  @valid_tracker_kinds ~w(local github linear jira)

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(project, attrs) do
    project
    |> cast(attrs, [:name, :slug, :description, :tracker_kind, :tracker_config])
    |> validate_required([:name, :slug])
    |> put_default_tracker_kind()
    |> validate_inclusion(:tracker_kind, @valid_tracker_kinds)
    |> validate_tracker_config()
    |> unique_constraint(:slug)
  end

  defp put_default_tracker_kind(changeset) do
    case get_field(changeset, :tracker_kind) do
      nil -> put_change(changeset, :tracker_kind, "local")
      _ -> changeset
    end
  end

  defp validate_tracker_config(changeset) do
    case get_field(changeset, :tracker_kind) do
      "github" -> validate_config_keys(changeset, ["repo", "project_id"])
      "linear" -> validate_config_keys(changeset, ["project_id"])
      "jira" -> validate_config_keys(changeset, ["project_key"])
      _ -> changeset
    end
  end

  defp validate_config_keys(changeset, required_keys) do
    config = get_field(changeset, :tracker_config) || %{}

    missing = Enum.reject(required_keys, &present_key?(config, &1))

    if missing == [] do
      changeset
    else
      add_error(changeset, :tracker_config, "missing keys: #{Enum.join(missing, ", ")}")
    end
  end

  defp present_key?(config, key) do
    case Map.get(config, key) do
      value when is_binary(value) -> String.trim(value) != ""
      value -> not is_nil(value)
    end
  end
end
