defmodule SymphonyElixir.LocalTracker.DevServerRecord do
  @moduledoc "Last-known persisted state for a per-issue dev server."

  use Ecto.Schema
  import Ecto.Changeset
  import Ecto.Query

  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Repo

  @type t :: %__MODULE__{}
  @statuses ~w(pending provisioning starting ready crashed stopped)
  @non_terminal_statuses ~w(pending provisioning starting ready)

  schema "local_tracker_dev_servers" do
    field(:issue_identifier, :string)
    field(:working_dir, :string)
    field(:slug, :string)
    field(:port, :integer)
    field(:url, :string)
    field(:status, :string, default: "stopped")
    field(:primary, :boolean, default: false)
    field(:session_name, :string)
    field(:started_at, :utc_datetime_usec)

    belongs_to(:project, Project)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, [
      :project_id,
      :issue_identifier,
      :working_dir,
      :slug,
      :port,
      :url,
      :status,
      :primary,
      :session_name,
      :started_at
    ])
    |> validate_required([:project_id, :issue_identifier, :slug, :status])
    |> validate_inclusion(:status, @statuses)
    |> unique_constraint([:project_id, :issue_identifier, :slug])
  end

  @spec upsert(integer(), String.t(), String.t(), map()) :: {:ok, t()} | {:error, Ecto.Changeset.t()}
  def upsert(project_id, issue_identifier, slug, attrs) when is_integer(project_id) and is_binary(issue_identifier) and is_binary(slug) and is_map(attrs) do
    existing_record =
      Repo.get_by(__MODULE__,
        project_id: project_id,
        issue_identifier: issue_identifier,
        slug: slug
      ) || %__MODULE__{}

    existing_record
    |> changeset(identity_attrs(attrs, project_id, issue_identifier, slug))
    |> Repo.insert_or_update()
  end

  @spec list_for_issue(integer(), String.t()) :: [t()]
  def list_for_issue(project_id, issue_identifier) when is_integer(project_id) and is_binary(issue_identifier) do
    Repo.all(
      from(record in __MODULE__,
        where: record.project_id == ^project_id and record.issue_identifier == ^issue_identifier,
        order_by: [desc: record.primary, asc: record.slug]
      )
    )
  end

  @spec mark_all_stopped() :: {non_neg_integer(), nil}
  def mark_all_stopped do
    Repo.update_all(
      from(record in __MODULE__, where: record.status in ^@non_terminal_statuses),
      set: [status: "stopped", updated_at: DateTime.utc_now()]
    )
  end

  defp identity_attrs(attrs, project_id, issue_identifier, slug) do
    attrs
    |> Map.new(fn {key, value} -> {to_string(key), value} end)
    |> Map.merge(%{
      "project_id" => project_id,
      "issue_identifier" => issue_identifier,
      "slug" => slug
    })
  end
end
