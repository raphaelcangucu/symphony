defmodule SymphonyElixirWeb.Tracker.GatewayController do
  @moduledoc "Global gateway settings and setup endpoints."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Gateways
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Credentials
  alias SymphonyElixirWeb.TrackerErrors

  @gateway_group "gateways"
  @telegram_setting_map %{
    "enabled" => "telegram_enabled",
    "botUsername" => "telegram_bot_username",
    "groupChatId" => "telegram_group_chat_id",
    "allowedUserIds" => "telegram_allowed_user_ids",
    "dmPolicy" => "telegram_dm_policy",
    "dmAllowedUserIds" => "telegram_dm_allowed_user_ids",
    "requireMention" => "telegram_require_mention",
    "pollingEnabled" => "telegram_polling_enabled"
  }

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, _params), do: json(conn, %{data: gateway_payload()})

  @spec update_telegram(Conn.t(), map()) :: Conn.t()
  def update_telegram(conn, params) do
    case put_telegram_settings(params) do
      :ok -> json(conn, %{data: gateway_payload()})
      {:error, name, reason} -> TrackerErrors.validation_msg(conn, "invalid setting %{name}: %{reason}", %{name: name, reason: inspect(reason)})
    end
  end

  @spec telegram_pairing_code(Conn.t(), map()) :: Conn.t()
  def telegram_pairing_code(conn, _params) do
    with {:ok, pairing_code} <- Gateways.create_pairing_code(:setup, %{}) do
      json(conn, %{data: %{code: pairing_code.code, command: "/symphony_setup #{pairing_code.code}"}})
    end
  end

  defp gateway_payload do
    %{
      telegram: %{
        enabled: Settings.get(@gateway_group, "telegram_enabled"),
        botUsername: Settings.get(@gateway_group, "telegram_bot_username"),
        botTokenConfigured: Credentials.configured?("telegram", "bot_token"),
        groupChatId: Settings.get(@gateway_group, "telegram_group_chat_id"),
        allowedUserIds: Settings.get(@gateway_group, "telegram_allowed_user_ids"),
        dmPolicy: Settings.get(@gateway_group, "telegram_dm_policy"),
        dmAllowedUserIds: Settings.get(@gateway_group, "telegram_dm_allowed_user_ids"),
        requireMention: Settings.get(@gateway_group, "telegram_require_mention"),
        pollingEnabled: Settings.get(@gateway_group, "telegram_polling_enabled")
      }
    }
  end

  defp put_telegram_settings(params) do
    params
    |> Enum.reduce_while(:ok, fn {input_name, value}, :ok ->
      case Map.fetch(@telegram_setting_map, input_name) do
        {:ok, setting_name} ->
          case Settings.put(@gateway_group, setting_name, value) do
            {:ok, _value} -> {:cont, :ok}
            {:error, reason} -> {:halt, {:error, setting_name, reason}}
          end

        :error ->
          {:cont, :ok}
      end
    end)
  end
end
