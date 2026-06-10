defmodule SymphonyElixir.Evidence.RemoteAsset do
  @moduledoc """
  Cache of evidence artifacts already uploaded to a remote tracker, keyed by
  `(provider, content_sha256)`. Lets repeated in-place evidence-comment updates
  reuse a tracker-hosted asset instead of re-uploading the same bytes.
  """

  use Ecto.Schema

  import Ecto.Changeset

  @type t :: %__MODULE__{}

  schema "evidence_remote_assets" do
    field(:provider, :string)
    field(:content_sha256, :string)
    field(:asset_ref, :string)
    field(:filename, :string)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, [:provider, :content_sha256, :asset_ref, :filename])
    |> validate_required([:provider, :content_sha256, :asset_ref])
    |> unique_constraint([:provider, :content_sha256])
  end
end
