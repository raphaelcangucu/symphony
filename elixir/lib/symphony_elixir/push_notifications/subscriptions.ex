defmodule SymphonyElixir.PushNotifications.Subscriptions do
  @moduledoc "CRUD for browser push subscriptions."

  import Ecto.Query

  alias SymphonyElixir.PushNotifications.Subscription
  alias SymphonyElixir.Repo

  @spec list() :: [Subscription.t()]
  def list do
    Repo.all(from(s in Subscription, order_by: [asc: s.inserted_at]))
  end

  @spec count() :: non_neg_integer()
  def count do
    Repo.aggregate(Subscription, :count)
  end

  @spec upsert(map()) :: {:ok, Subscription.t()} | {:error, Ecto.Changeset.t()}
  def upsert(attrs) when is_map(attrs) do
    endpoint = Map.get(attrs, :endpoint) || Map.get(attrs, "endpoint")

    case endpoint && Repo.get_by(Subscription, endpoint: endpoint) do
      %Subscription{} = existing ->
        existing
        |> Subscription.changeset(attrs)
        |> Repo.update()

      nil ->
        %Subscription{}
        |> Subscription.changeset(attrs)
        |> Repo.insert()

      _ ->
        %Subscription{}
        |> Subscription.changeset(attrs)
        |> Repo.insert()
    end
  end

  @spec delete_by_endpoint(String.t()) :: :ok
  def delete_by_endpoint(endpoint) when is_binary(endpoint) do
    from(s in Subscription, where: s.endpoint == ^endpoint)
    |> Repo.delete_all()

    :ok
  end

  @spec delete(Subscription.t()) :: :ok
  def delete(%Subscription{} = subscription) do
    Repo.delete(subscription)
    :ok
  end

  @spec list_for_identities([String.t()]) :: [Subscription.t()]
  def list_for_identities(keys) when is_list(keys) do
    wanted = normalized_keys(keys)

    if wanted == [] do
      []
    else
      wanted_set = MapSet.new(wanted)

      list()
      |> Enum.filter(fn subscription ->
        subscription.identity_keys
        |> normalized_keys()
        |> Enum.any?(fn key -> MapSet.member?(wanted_set, key) end)
      end)
    end
  end

  defp normalized_keys(keys) when is_list(keys) do
    keys
    |> Enum.map(fn
      key when is_binary(key) ->
        trimmed = String.trim(key)
        if trimmed == "", do: nil, else: String.downcase(trimmed)

      _ ->
        nil
    end)
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end
end
