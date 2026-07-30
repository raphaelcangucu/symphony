defmodule SymphonyElixir.Repo.Migrations.AddClientMessageIdToAssistantMessages do
  use Ecto.Migration

  def change do
    alter table(:assistant_messages) do
      add(:client_message_id, :string)
    end

    create(
      unique_index(:assistant_messages, [:thread_id, :client_message_id],
        where: "client_message_id IS NOT NULL",
        name: :assistant_messages_thread_client_message_id_index
      )
    )
  end
end
