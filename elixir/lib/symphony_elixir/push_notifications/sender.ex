defmodule SymphonyElixir.PushNotifications.Sender do
  @moduledoc "Delivers encrypted Web Push payloads to all stored subscriptions."

  alias ExNudge.Subscription, as: ExSubscription
  alias SymphonyElixir.PushNotifications.{Config, Subscription, Subscriptions}

  require Logger

  @send_opts [urgency: :high, ttl: 300]

  @spec deliver_all(String.t(), map()) :: :ok
  def deliver_all(kind, payload) when is_binary(kind) and is_map(payload) do
    body =
      payload
      |> Map.put("kind", kind)
      |> Jason.encode!()

    Subscriptions.list()
    |> Enum.each(&deliver_one(&1, body))

    :ok
  end

  @spec deliver_one(Subscription.t(), String.t()) :: :ok
  def deliver_one(%Subscription{} = subscription, body) when is_binary(body) do
    ex_subscription = %ExSubscription{
      endpoint: subscription.endpoint,
      keys: %{p256dh: subscription.p256dh, auth: subscription.auth}
    }

    case ExNudge.send_notification(ex_subscription, body, @send_opts) do
      {:ok, %HTTPoison.Response{status_code: status}} ->
        Logger.info("Push notification sent endpoint=#{subscription.endpoint} status=#{status}")
        :ok

      {:error, :subscription_expired} ->
        Logger.info("Removing expired push subscription endpoint=#{subscription.endpoint}")
        Subscriptions.delete(subscription)

      {:error, reason} ->
        Logger.warning("Push notification failed endpoint=#{subscription.endpoint}: #{inspect(reason)}")
        :ok
    end
  rescue
    error ->
      Logger.warning(
        "Push notification encryption failed endpoint=#{subscription.endpoint}: #{Exception.message(error)}"
      )

      :ok
  end

  @doc false
  @spec configured?() :: boolean()
  def configured?, do: Config.enabled?()
end
