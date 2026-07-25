defmodule SymphonyElixir.PushNotifications.NativeSender do
  @moduledoc "Delivers best-effort Expo notifications without logging device tokens."

  alias SymphonyElixir.PushNotifications.MobileSubscriptions
  alias SymphonyElixir.Settings.Vault

  require Logger

  @expo_endpoint "https://exp.host/--/api/v2/push/send"

  @spec deliver_all(String.t(), map()) :: :ok
  def deliver_all(kind, payload) when is_binary(kind) and is_map(payload) do
    messages =
      MobileSubscriptions.list()
      |> Enum.flat_map(fn subscription ->
        case Vault.decrypt(subscription.token_ciphertext) do
          {:ok, token} ->
            [
              %{
                to: token,
                title: Map.get(payload, :title) || Map.get(payload, "title") || "Symphony",
                body: Map.get(payload, :body) || Map.get(payload, "body") || "",
                data:
                  payload
                  |> Map.new(fn {key, value} -> {to_string(key), value} end)
                  |> Map.put("kind", kind),
                sound: "default"
              }
            ]

          :error ->
            []
        end
      end)

    deliver(messages)
  end

  defp deliver([]), do: :ok

  defp deliver(messages) do
    case request_fun().(@expo_endpoint, messages) do
      {:ok, _response} ->
        :ok

      {:error, reason} ->
        Logger.warning("Native push delivery failed for #{length(messages)} device(s): #{inspect(reason)}")
        :ok
    end
  rescue
    error ->
      Logger.warning("Native push delivery failed for #{length(messages)} device(s): #{Exception.message(error)}")
      :ok
  end

  defp request_fun do
    case Application.get_env(:symphony_elixir, :native_push_request) do
      fun when is_function(fun, 2) ->
        fun

      _ ->
        fn endpoint, messages ->
          Req.post(endpoint,
            json: messages,
            headers: [{"accept", "application/json"}],
            receive_timeout: 15_000,
            retry: false
          )
        end
    end
  end
end
