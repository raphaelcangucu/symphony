defmodule SymphonyElixir.PushNotifications.Sender do
  @moduledoc "Delivers encrypted Web Push payloads to all stored subscriptions."

  alias SymphonyElixir.PushNotifications.{Config, Subscription, Subscriptions}

  require Logger

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
    web_subscription =
      Jason.encode!(%{
        "endpoint" => subscription.endpoint,
        "keys" => %{
          "p256dh" => subscription.p256dh,
          "auth" => subscription.auth
        }
      })

    case WebPushElixir.send_notification(web_subscription, body) do
      {:ok, _response} ->
        :ok

      {:error, :expired} ->
        Logger.info("Removing expired push subscription endpoint=#{subscription.endpoint}")
        Subscriptions.delete(subscription)

      {:error, reason} ->
        Logger.warning("Push notification failed endpoint=#{subscription.endpoint}: #{inspect(reason)}")
        :ok
    end
  end

  @doc false
  @spec configured?() :: boolean()
  def configured?, do: Config.enabled?()
end
