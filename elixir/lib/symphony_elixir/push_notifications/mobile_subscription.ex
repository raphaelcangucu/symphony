defmodule SymphonyElixir.PushNotifications.MobileSubscription do
  @moduledoc "Encrypted Expo push token registered by one mobile connection profile."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.Settings.Vault

  @type t :: %__MODULE__{}
  @token_pattern ~r/^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/

  schema "mobile_push_subscriptions" do
    field(:profile_id, :string)
    field(:device_id, :string)
    field(:platform, :string)
    field(:token, :string, virtual: true, redact: true)
    field(:token_ciphertext, :string, redact: true)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t() | Ecto.Changeset.t(), map()) :: Ecto.Changeset.t()
  def changeset(subscription, attrs) do
    subscription
    |> cast(attrs, [:profile_id, :device_id, :platform, :token])
    |> update_change(:profile_id, &String.trim/1)
    |> update_change(:device_id, &String.trim/1)
    |> validate_required([:profile_id, :device_id, :platform, :token])
    |> validate_inclusion(:platform, ["android", "ios"])
    |> validate_format(:token, @token_pattern)
    |> encrypt_token()
    |> unique_constraint([:profile_id, :device_id])
  end

  defp encrypt_token(%Ecto.Changeset{valid?: true} = changeset) do
    case get_change(changeset, :token) do
      token when is_binary(token) -> put_change(changeset, :token_ciphertext, Vault.encrypt(token))
      _ -> changeset
    end
  end

  defp encrypt_token(changeset), do: changeset
end
