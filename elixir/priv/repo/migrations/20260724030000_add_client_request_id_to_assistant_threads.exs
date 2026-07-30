defmodule SymphonyElixir.Repo.Migrations.AddClientRequestIdToAssistantThreads do
  use Ecto.Migration

  def change do
    alter table(:assistant_threads) do
      add(:client_request_id, :string)
    end

    create(
      unique_index(:assistant_threads, [:client_request_id],
        where: "client_request_id IS NOT NULL",
        name: :assistant_threads_client_request_id_index
      )
    )
  end
end
