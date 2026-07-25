defmodule SymphonyElixir.PushNotifications.MobileSubscriptions do
  @moduledoc "CRUD for encrypted Expo mobile push registrations."

  import Ecto.Query

  alias SymphonyElixir.PushNotifications.MobileSubscription
  alias SymphonyElixir.Repo

  @spec list() :: [MobileSubscription.t()]
  def list do
    Repo.all(from(s in MobileSubscription, order_by: [asc: s.inserted_at]))
  end

  @spec count() :: non_neg_integer()
  def count, do: Repo.aggregate(MobileSubscription, :count)

  @spec upsert(map()) :: {:ok, MobileSubscription.t()} | {:error, Ecto.Changeset.t()}
  def upsert(attrs) when is_map(attrs) do
    profile_id = Map.get(attrs, :profile_id) || Map.get(attrs, "profile_id")
    device_id = Map.get(attrs, :device_id) || Map.get(attrs, "device_id")

    case Repo.get_by(MobileSubscription, profile_id: profile_id, device_id: device_id) do
      %MobileSubscription{} = existing ->
        existing
        |> MobileSubscription.changeset(attrs)
        |> Repo.update()

      nil ->
        %MobileSubscription{}
        |> MobileSubscription.changeset(attrs)
        |> Repo.insert()
    end
  end

  @spec delete(String.t(), String.t()) :: :ok
  def delete(profile_id, device_id) when is_binary(profile_id) and is_binary(device_id) do
    from(s in MobileSubscription,
      where: s.profile_id == ^profile_id and s.device_id == ^device_id
    )
    |> Repo.delete_all()

    :ok
  end
end
