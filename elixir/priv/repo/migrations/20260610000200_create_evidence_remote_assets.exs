defmodule SymphonyElixir.Repo.Migrations.CreateEvidenceRemoteAssets do
  use Ecto.Migration

  def change do
    create table(:evidence_remote_assets) do
      add(:provider, :string, null: false)
      add(:content_sha256, :string, null: false)
      add(:asset_ref, :string, null: false)
      add(:filename, :string)

      timestamps(type: :utc_datetime_usec)
    end

    # One upload per (provider, file content): rapid in-place evidence-comment
    # updates reuse the already-uploaded asset instead of re-uploading bytes.
    create(unique_index(:evidence_remote_assets, [:provider, :content_sha256]))
  end
end
