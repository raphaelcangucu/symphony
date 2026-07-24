defmodule SymphonyElixir.Assistant.Thread do
  @moduledoc """
  Persistent provider-neutral assistant conversation.

  A thread is Symphony's stable aggregate across provider changes. Native
  conversation identifiers live exclusively in `provider_bindings`.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.Assistant.Message

  @type t :: %__MODULE__{}

  @providers SymphonyElixir.Settings.Agents.agent_kinds()
  @scopes ["project", "project_session", "project_explore", "freeform", "issue", "issue_session", "issue_execution", "kb"]
  @cast_fields [
    :scope,
    :project_slug,
    :issue_identifier,
    :title,
    :workspace_path,
    :status,
    :metadata,
    :agent_kind,
    :provider_bindings
  ]

  schema "assistant_threads" do
    field(:scope, :string, default: "project")
    field(:project_slug, :string)
    field(:issue_identifier, :string)
    field(:title, :string)
    field(:workspace_path, :string)
    field(:status, :string, default: "active")
    field(:metadata, :map, default: %{})
    field(:agent_kind, :string)
    field(:provider_bindings, :map, default: %{})

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
    |> validate_agent_kind()
    |> validate_provider_bindings()
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
      "issue_session" -> validate_required(changeset, [:project_slug, :issue_identifier])
      "issue_execution" -> validate_required(changeset, [:project_slug, :issue_identifier])
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

  defp validate_provider_bindings(changeset) do
    if canonical_provider_bindings?(get_field(changeset, :provider_bindings)) do
      changeset
    else
      add_error(
        changeset,
        :provider_bindings,
        "must map supported providers to non-empty conversation ids"
      )
    end
  end

  defp validate_agent_kind(changeset) do
    case get_field(changeset, :agent_kind) do
      nil -> changeset
      provider when provider in @providers -> changeset
      _provider -> add_error(changeset, :agent_kind, "is not a supported provider")
    end
  end

  defp canonical_provider_bindings?(bindings) when is_map(bindings) do
    Enum.all?(bindings, fn
      {provider, conversation_id} when provider in @providers and is_binary(conversation_id) ->
        String.trim(conversation_id) != ""

      _binding ->
        false
    end)
  end

  defp canonical_provider_bindings?(_bindings), do: false
end
