defmodule SymphonyElixir.Gateways.Binding do
  @moduledoc "Persistent binding between an external gateway conversation and a Symphony assistant session."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.Assistant.Thread

  @type t :: %__MODULE__{}

  @binding_kinds ~w(project_topic direct_freeform group_freeform)
  @statuses ~w(active disabled archived)
  @agent_kinds SymphonyElixir.Settings.Agents.agent_kinds()
  @modes ~w(explore project issue kb freeform)

  schema "gateway_bindings" do
    field(:provider, :string)
    field(:account_id, :string, default: "default")
    field(:binding_kind, :string)
    field(:project_slug, :string)
    field(:conversation_id, :string)
    field(:parent_conversation_id, :string)
    field(:thread_id, :string)
    field(:sender_id, :string)
    field(:status, :string, default: "active")
    field(:default_agent_kind, :string)
    field(:default_mode, :string)
    field(:active_mode, :string)
    field(:active_issue_identifier, :string)
    field(:active_kb_repo_slug, :string)
    field(:active_kb_page_path, :string)
    field(:metadata, :map, default: %{})

    belongs_to(:active_thread, Thread, foreign_key: :active_thread_id)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(binding, attrs) when is_map(attrs) do
    binding
    |> cast(attrs, [
      :provider,
      :account_id,
      :binding_kind,
      :project_slug,
      :conversation_id,
      :parent_conversation_id,
      :thread_id,
      :sender_id,
      :status,
      :default_agent_kind,
      :default_mode,
      :active_mode,
      :active_issue_identifier,
      :active_kb_repo_slug,
      :active_kb_page_path,
      :active_thread_id,
      :metadata
    ])
    |> normalize_string(:provider)
    |> normalize_string(:account_id)
    |> normalize_string(:binding_kind)
    |> normalize_string(:project_slug)
    |> normalize_string(:conversation_id)
    |> normalize_string(:parent_conversation_id)
    |> normalize_string(:thread_id)
    |> normalize_string(:sender_id)
    |> normalize_string(:status)
    |> normalize_string(:default_agent_kind)
    |> normalize_string(:default_mode)
    |> normalize_string(:active_mode)
    |> normalize_string(:active_issue_identifier)
    |> normalize_string(:active_kb_repo_slug)
    |> normalize_string(:active_kb_page_path)
    |> validate_required([:provider, :account_id, :binding_kind, :conversation_id, :status, :default_mode, :active_mode])
    |> validate_inclusion(:binding_kind, @binding_kinds)
    |> validate_inclusion(:status, @statuses)
    |> validate_inclusion(:default_agent_kind, @agent_kinds)
    |> validate_inclusion(:default_mode, @modes)
    |> validate_inclusion(:active_mode, @modes)
    |> validate_binding_kind_fields()
    |> unique_constraint([:provider, :account_id, :conversation_id], name: :gateway_bindings_active_conversation_index)
    |> unique_constraint([:provider, :project_slug], name: :gateway_bindings_active_project_topic_index)
    |> unique_constraint([:provider, :account_id, :sender_id], name: :gateway_bindings_active_direct_sender_index)
  end

  defp validate_binding_kind_fields(changeset) do
    case get_field(changeset, :binding_kind) do
      "project_topic" ->
        changeset
        |> validate_required([:project_slug, :parent_conversation_id, :thread_id])

      "direct_freeform" ->
        changeset
        |> validate_required([:sender_id])
        |> put_change(:project_slug, nil)
        |> put_change(:default_mode, "freeform")
        |> put_change(:active_mode, "freeform")

      "group_freeform" ->
        changeset
        |> put_change(:project_slug, nil)
        |> put_change(:sender_id, nil)
        |> put_change(:thread_id, nil)
        |> put_change(:parent_conversation_id, nil)
        |> put_change(:default_mode, "freeform")
        |> put_change(:active_mode, "freeform")

      _other ->
        changeset
    end
  end

  defp normalize_string(changeset, field) do
    case get_change(changeset, field) do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> put_change(changeset, field, nil)
          trimmed -> put_change(changeset, field, trimmed)
        end

      _other ->
        changeset
    end
  end
end
