defmodule SymphonyElixir.Assistant.Thread do
  @moduledoc "Persistent Codex-backed assistant thread (project, freeform, or issue scoped)."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.Assistant.Message

  @type t :: %__MODULE__{}

  @scopes ["project", "project_session", "project_explore", "freeform", "issue", "kb"]
  @cast_fields [
    :scope,
    :project_slug,
    :issue_identifier,
    :title,
    :codex_thread_id,
    :workspace_path,
    :status,
    :metadata,
    :agent_kind,
    :agent_thread_ids
  ]

  schema "assistant_threads" do
    field(:scope, :string, default: "project")
    field(:project_slug, :string)
    field(:issue_identifier, :string)
    field(:title, :string)
    field(:codex_thread_id, :string)
    field(:workspace_path, :string)
    field(:status, :string, default: "active")
    field(:metadata, :map, default: %{})
    field(:agent_kind, :string)
    field(:agent_thread_ids, :map, default: %{})

    has_many(:messages, Message, foreign_key: :thread_id)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(thread, attrs) when is_map(attrs) do
    thread
    |> cast(attrs, @cast_fields)
    |> validate_required([:scope])
    |> validate_required([:workspace_path, :status])
    |> validate_inclusion(:scope, @scopes)
    |> validate_inclusion(:status, ["active", "closed", "error", "archived"])
    |> normalize_project_slug()
    |> validate_scope_fields()
    |> unique_constraint(:project_slug, name: :assistant_threads_active_project_index)
    |> unique_constraint(:project_slug, name: :assistant_threads_active_project_explore_index)
    |> unique_constraint(:issue_identifier, name: :assistant_threads_active_issue_index)
  end

  defp validate_scope_fields(changeset) do
    case get_field(changeset, :scope) do
      "project" -> validate_required(changeset, [:project_slug])
      "project_session" -> validate_required(changeset, [:project_slug])
      "project_explore" -> validate_required(changeset, [:project_slug])
      "kb" -> validate_required(changeset, [:project_slug])
      "issue" -> validate_required(changeset, [:project_slug, :issue_identifier])
      "freeform" -> reject_project(changeset)
      _ -> changeset
    end
  end

  defp reject_project(changeset) do
    if get_field(changeset, :project_slug) in [nil, ""] do
      put_change(changeset, :project_slug, nil)
    else
      add_error(changeset, :project_slug, "must be empty for freeform chats")
    end
  end

  defp normalize_project_slug(changeset) do
    case get_change(changeset, :project_slug) do
      slug when is_binary(slug) -> put_change(changeset, :project_slug, String.trim(slug))
      _ -> changeset
    end
  end
end
