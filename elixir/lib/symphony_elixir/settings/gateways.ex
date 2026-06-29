defmodule SymphonyElixir.Settings.Gateways do
  @moduledoc "Gateway-related operator settings (group \"gateways\")."

  @behaviour SymphonyElixir.Settings.Group

  @boolean_fields ~w(telegram_enabled telegram_require_mention telegram_polling_enabled)
  @list_fields ~w(telegram_allowed_user_ids telegram_dm_allowed_user_ids)

  @impl true
  def group, do: "gateways"

  @impl true
  def defaults do
    %{
      "telegram_enabled" => false,
      "telegram_bot_username" => nil,
      "telegram_group_chat_id" => nil,
      "telegram_allowed_user_ids" => [],
      "telegram_dm_policy" => "allowlist",
      "telegram_dm_allowed_user_ids" => [],
      "telegram_require_mention" => true,
      "telegram_polling_enabled" => false,
      "telegram_last_setup_at" => nil
    }
  end

  @impl true
  def cast(name, value) when name in @boolean_fields, do: cast_boolean(value)
  def cast(name, value) when name in @list_fields, do: cast_string_list(value)
  def cast("telegram_dm_policy", "allowlist"), do: {:ok, "allowlist"}
  def cast("telegram_bot_username", value), do: cast_optional_trimmed(value)
  def cast("telegram_group_chat_id", value), do: cast_optional_trimmed(value)
  def cast("telegram_last_setup_at", value), do: cast_optional_trimmed(value)
  def cast(_name, _value), do: :error

  @spec telegram_enabled?() :: boolean()
  def telegram_enabled?, do: SymphonyElixir.Settings.get(group(), "telegram_enabled") == true

  @spec telegram_polling_enabled?() :: boolean()
  def telegram_polling_enabled?, do: SymphonyElixir.Settings.get(group(), "telegram_polling_enabled") == true

  @spec telegram_group_chat_id() :: String.t() | nil
  def telegram_group_chat_id, do: SymphonyElixir.Settings.get(group(), "telegram_group_chat_id")

  @spec telegram_allowed_user_ids() :: [String.t()]
  def telegram_allowed_user_ids, do: SymphonyElixir.Settings.get(group(), "telegram_allowed_user_ids") || []

  @spec telegram_dm_allowed_user_ids() :: [String.t()]
  def telegram_dm_allowed_user_ids, do: SymphonyElixir.Settings.get(group(), "telegram_dm_allowed_user_ids") || []

  defp cast_boolean(value) when is_boolean(value), do: {:ok, value}
  defp cast_boolean("true"), do: {:ok, true}
  defp cast_boolean("false"), do: {:ok, false}
  defp cast_boolean(_value), do: :error

  defp cast_string_list(values) when is_list(values) do
    normalized =
      values
      |> Enum.map(&to_string/1)
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.uniq()

    {:ok, normalized}
  end

  defp cast_string_list(_value), do: :error

  defp cast_optional_trimmed(nil), do: {:ok, nil}

  defp cast_optional_trimmed(value) when is_binary(value) do
    case String.trim(value) do
      "" -> {:ok, nil}
      trimmed -> {:ok, trimmed}
    end
  end

  defp cast_optional_trimmed(_value), do: :error
end
