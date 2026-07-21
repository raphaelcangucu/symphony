defmodule SymphonyElixir.LocalTracker.DevServerRecord do
  @moduledoc "Last-known persisted state for an issue- or workspace-scoped dev server."

  use Ecto.Schema
  import Ecto.Changeset
  import Ecto.Query

  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Repo

  @type t :: %__MODULE__{}
  @statuses ~w(pending provisioning starting stalled ready crashed stopped)
  @non_terminal_statuses ~w(pending provisioning starting stalled ready)
  @identity_fields ~w(project_id issue_identifier slug)a
  @workspace_identity_fields ~w(project_id workspace_path slug)a
  @updatable_fields ~w(working_dir port url status primary session_name started_at)a
  @known_fields Enum.uniq(@identity_fields ++ @workspace_identity_fields ++ @updatable_fields)

  schema "local_tracker_dev_servers" do
    field(:issue_identifier, :string)
    field(:workspace_path, :string)
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
      :workspace_path,
      :working_dir,
      :slug,
      :port,
      :url,
      :status,
      :primary,
      :session_name,
      :started_at
    ])
    |> validate_required([:project_id, :slug, :status])
    |> validate_exactly_one_scope()
    |> validate_inclusion(:status, @statuses)
    |> unique_constraint([:project_id, :issue_identifier, :slug],
      name: :local_tracker_dev_servers_issue_scope_index
    )
    |> unique_constraint([:project_id, :workspace_path, :slug],
      name: :local_tracker_dev_servers_workspace_scope_index
    )
    |> check_constraint(:issue_identifier,
      name: :local_tracker_dev_servers_exactly_one_scope,
      message: "exactly one of issue_identifier or workspace_path must be set"
    )
  end

  @spec upsert(integer(), String.t(), String.t(), map()) :: {:ok, t()} | {:error, Ecto.Changeset.t()}
  def upsert(project_id, issue_identifier, slug, attrs) when is_integer(project_id) and is_binary(issue_identifier) and is_binary(slug) and is_map(attrs) do
    attrs =
      attrs
      |> atomize_known_keys()
      |> Map.merge(%{project_id: project_id, issue_identifier: issue_identifier, slug: slug})

    changeset = changeset(%__MODULE__{}, attrs)

    if changeset.valid? do
      case Repo.insert(changeset,
             on_conflict: [set: conflict_updates(attrs, changeset)],
             conflict_target: {:unsafe_fragment, "(project_id, issue_identifier, slug) WHERE issue_identifier IS NOT NULL"}
           ) do
        {:ok, _inserted_or_updated} -> {:ok, Repo.one!(query_one(project_id, issue_identifier, slug))}
        {:error, changeset} -> {:error, changeset}
      end
    else
      {:error, changeset}
    end
  end

  @spec upsert_workspace(integer(), Path.t(), String.t(), map()) ::
          {:ok, t()} | {:error, Ecto.Changeset.t()}
  def upsert_workspace(project_id, workspace_path, slug, attrs)
      when is_integer(project_id) and is_binary(workspace_path) and is_binary(slug) and
             is_map(attrs) do
    workspace_path = Path.expand(workspace_path)

    attrs =
      attrs
      |> atomize_known_keys()
      |> Map.merge(%{
        project_id: project_id,
        issue_identifier: nil,
        workspace_path: workspace_path,
        slug: slug
      })

    changeset = changeset(%__MODULE__{}, attrs)

    if changeset.valid? do
      case Repo.insert(changeset,
             on_conflict: [set: conflict_updates(attrs, changeset)],
             conflict_target: {:unsafe_fragment, "(project_id, workspace_path, slug) WHERE workspace_path IS NOT NULL"}
           ) do
        {:ok, _inserted_or_updated} ->
          {:ok, Repo.one!(query_one_workspace(project_id, workspace_path, slug))}

        {:error, changeset} ->
          {:error, changeset}
      end
    else
      {:error, changeset}
    end
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

  @spec list_for_workspace(integer(), Path.t()) :: [t()]
  def list_for_workspace(project_id, workspace_path)
      when is_integer(project_id) and is_binary(workspace_path) do
    workspace_path = Path.expand(workspace_path)

    Repo.all(
      from(record in __MODULE__,
        where: record.project_id == ^project_id and record.workspace_path == ^workspace_path,
        order_by: [desc: record.primary, asc: record.slug]
      )
    )
  end

  @doc "Distinct {project_id, issue_identifier} pairs with a record in a non-terminal status."
  @spec live_issue_keys() :: [{integer(), String.t()}]
  def live_issue_keys do
    Repo.all(
      from(record in __MODULE__,
        where:
          record.status in ^@non_terminal_statuses and
            not is_nil(record.issue_identifier),
        distinct: true,
        select: {record.project_id, record.issue_identifier}
      )
    )
  end

  @spec get_for_workspace(integer(), Path.t(), integer()) :: t() | nil
  def get_for_workspace(project_id, workspace_path, id)
      when is_integer(project_id) and is_binary(workspace_path) and is_integer(id) do
    workspace_path = Path.expand(workspace_path)

    Repo.one(
      from(record in __MODULE__,
        where:
          record.project_id == ^project_id and record.workspace_path == ^workspace_path and
            record.id == ^id
      )
    )
  end

  @spec get_for_issue(integer(), String.t(), integer()) :: t() | nil
  def get_for_issue(project_id, issue_identifier, id)
      when is_integer(project_id) and is_binary(issue_identifier) and is_integer(id) do
    Repo.one(
      from(record in __MODULE__,
        where:
          record.project_id == ^project_id and record.issue_identifier == ^issue_identifier and
            record.id == ^id
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

  defp validate_exactly_one_scope(changeset) do
    issue_identifier = get_field(changeset, :issue_identifier)
    workspace_path = get_field(changeset, :workspace_path)

    if present?(issue_identifier) != present?(workspace_path) do
      changeset
    else
      add_error(
        changeset,
        :issue_identifier,
        "exactly one of issue_identifier or workspace_path must be set"
      )
    end
  end

  defp present?(value) when is_binary(value), do: String.trim(value) != ""
  defp present?(_value), do: false

  defp atomize_known_keys(attrs) do
    Enum.reduce(attrs, %{}, fn
      {key, value}, acc when is_binary(key) ->
        case known_field_atom(key) do
          nil -> acc
          field -> Map.put(acc, field, value)
        end

      {key, value}, acc when is_atom(key) ->
        Map.put(acc, key, value)

      _pair, acc ->
        acc
    end)
  end

  defp conflict_updates(attrs, changeset) do
    updates =
      @updatable_fields
      |> Enum.filter(&Map.has_key?(attrs, &1))
      |> Enum.map(fn field -> {field, Ecto.Changeset.get_field(changeset, field)} end)

    Keyword.put(updates, :updated_at, DateTime.utc_now())
  end

  defp known_field_atom(key) do
    Enum.find(@known_fields, &(Atom.to_string(&1) == key))
  end

  defp query_one(project_id, issue_identifier, slug) do
    from(record in __MODULE__,
      where:
        record.project_id == ^project_id and record.issue_identifier == ^issue_identifier and
          record.slug == ^slug
    )
  end

  defp query_one_workspace(project_id, workspace_path, slug) do
    from(record in __MODULE__,
      where:
        record.project_id == ^project_id and record.workspace_path == ^workspace_path and
          record.slug == ^slug
    )
  end
end
