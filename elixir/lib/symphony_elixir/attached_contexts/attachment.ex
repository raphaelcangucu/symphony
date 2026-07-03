defmodule SymphonyElixir.AttachedContexts.Attachment do
  @moduledoc "Persistent context attachment for a composer runtime scope."

  use Ecto.Schema

  import Ecto.Changeset

  @type t :: %__MODULE__{}

  @scopes ~w(execution assistant)
  @kinds ~w(saved session github_issue pr security_alert advisory board_issue)

  @cast_fields ~w(
    scope
    project_slug
    issue_identifier
    thread_id
    kind
    ref_key
    title
    content_md
    metadata
    position
  )a

  @required_fields ~w(scope project_slug kind ref_key title content_md)a

  schema "attached_contexts" do
    field(:scope, :string)
    field(:project_slug, :string)
    field(:issue_identifier, :string)
    field(:thread_id, :integer)
    field(:kind, :string)
    field(:ref_key, :string)
    field(:title, :string)
    field(:content_md, :string)
    field(:metadata, :map, default: %{})
    field(:position, :integer, default: 0)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(attachment, attrs) when is_map(attrs) do
    attachment
    |> cast(attrs, @cast_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:scope, @scopes)
    |> validate_inclusion(:kind, @kinds)
    |> validate_scope_binding()
    |> unique_constraint(:ref_key, name: :attached_contexts_execution_unique_ref)
    |> unique_constraint(:ref_key, name: :attached_contexts_assistant_unique_ref)
    |> unique_constraint(:ref_key, name: :attached_contexts_project_slug_issue_identifier_kind_ref_key_index)
    |> unique_constraint(:ref_key, name: :attached_contexts_thread_id_kind_ref_key_index)
  end

  defp validate_scope_binding(changeset) do
    case get_field(changeset, :scope) do
      "execution" -> validate_required(changeset, [:issue_identifier])
      "assistant" -> validate_required(changeset, [:thread_id])
      _ -> changeset
    end
  end
end
