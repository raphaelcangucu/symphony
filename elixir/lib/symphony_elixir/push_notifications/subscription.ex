defmodule SymphonyElixir.PushNotifications.Subscription do
  @moduledoc "Browser Web Push subscription persisted for this Symphony instance."

  use Ecto.Schema
  import Ecto.Changeset

  @type t :: %__MODULE__{}

  schema "push_subscriptions" do
    field(:endpoint, :string)
    field(:p256dh, :string)
    field(:auth, :string)
    field(:user_agent, :string)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t() | Ecto.Changeset.t(), map()) :: Ecto.Changeset.t()
  def changeset(subscription, attrs) do
    subscription
    |> cast(attrs, [:endpoint, :p256dh, :auth, :user_agent])
    |> validate_required([:endpoint, :p256dh, :auth])
    |> unique_constraint(:endpoint)
  end

  @spec from_browser_map(map()) :: map()
  def from_browser_map(%{"endpoint" => endpoint, "keys" => keys} = params)
      when is_binary(endpoint) and is_map(keys) do
    %{
      endpoint: endpoint,
      p256dh: Map.get(keys, "p256dh") || Map.get(keys, :p256dh),
      auth: Map.get(keys, "auth") || Map.get(keys, :auth),
      user_agent: Map.get(params, "user_agent") || Map.get(params, :user_agent)
    }
  end

  def from_browser_map(_params), do: %{}
end
