defmodule SymphonyElixir.SavedContexts.Entry do
  @moduledoc "Persisted saved context recap that can be attached to composer scopes."

  use Ecto.Schema

  import Ecto.Changeset

  @type t :: %__MODULE__{}

  @source_scopes ~w(execution assistant)

  @cast_fields ~w(
    project_slug
    slug
    name
    content_md
    source_scope
    source_issue_identifier
    source_thread_id
    metadata
  )a

  @required_fields ~w(project_slug slug content_md)a

  schema "saved_contexts" do
    field(:project_slug, :string)
    field(:slug, :string)
    field(:name, :string)
    field(:content_md, :string)
    field(:source_scope, :string)
    field(:source_issue_identifier, :string)
    field(:source_thread_id, :integer)
    field(:metadata, :map, default: %{})

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(entry, attrs) when is_map(attrs) do
    entry
    |> cast(attrs, @cast_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:source_scope, @source_scopes)
    |> unique_constraint([:project_slug, :slug])
  end
end
