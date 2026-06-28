defmodule SymphonyElixir.Repo.Migrations.CreateGatewayBindings do
  use Ecto.Migration

  def change do
    create table(:gateway_bindings) do
      add(:provider, :string, null: false)
      add(:account_id, :string, null: false, default: "default")
      add(:binding_kind, :string, null: false)
      add(:project_slug, :string)
      add(:conversation_id, :string, null: false)
      add(:parent_conversation_id, :string)
      add(:thread_id, :string)
      add(:sender_id, :string)
      add(:status, :string, null: false, default: "active")
      add(:default_agent_kind, :string)
      add(:default_mode, :string, null: false)
      add(:active_mode, :string, null: false)
      add(:active_issue_identifier, :string)
      add(:active_kb_repo_slug, :string)
      add(:active_kb_page_path, :string)
      add(:active_thread_id, references(:assistant_threads, on_delete: :nilify_all))
      add(:metadata, :map, null: false, default: %{})

      timestamps(type: :utc_datetime_usec)
    end

    create(
      unique_index(:gateway_bindings, [:provider, :account_id, :conversation_id],
        where: "status = 'active'",
        name: :gateway_bindings_active_conversation_index
      )
    )

    create(
      unique_index(:gateway_bindings, [:provider, :project_slug],
        where: "status = 'active' AND binding_kind = 'project_topic'",
        name: :gateway_bindings_active_project_topic_index
      )
    )

    create(
      unique_index(:gateway_bindings, [:provider, :account_id, :sender_id],
        where: "status = 'active' AND binding_kind = 'direct_freeform'",
        name: :gateway_bindings_active_direct_sender_index
      )
    )

    create(
      index(:gateway_bindings, [:provider, :account_id, :parent_conversation_id, :thread_id],
        name: :gateway_bindings_parent_thread_index
      )
    )
  end
end
