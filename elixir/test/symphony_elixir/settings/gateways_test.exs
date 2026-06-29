defmodule SymphonyElixir.Settings.GatewaysTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Setting
  alias SymphonyElixir.Settings.Gateways

  setup do
    Repo.delete_all(Setting)
    on_exit(fn -> Repo.delete_all(Setting) end)
    :ok
  end

  test "defaults are fail-closed for telegram" do
    assert Gateways.defaults() == %{
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

  test "casts telegram fields explicitly" do
    assert {:ok, true} = Gateways.cast("telegram_enabled", true)
    assert {:ok, false} = Gateways.cast("telegram_enabled", "false")
    assert {:ok, "-100123"} = Gateways.cast("telegram_group_chat_id", " -100123 ")
    assert {:ok, ["123", "456"]} = Gateways.cast("telegram_allowed_user_ids", [" 123 ", 456, ""])
    assert {:ok, "allowlist"} = Gateways.cast("telegram_dm_policy", "allowlist")
    assert :error = Gateways.cast("telegram_dm_policy", "open")
  end

  test "settings registry exposes gateways group" do
    assert Settings.get_group("gateways")["telegram_enabled"] == false
    assert {:ok, true} = Settings.put("gateways", "telegram_enabled", true)
    assert Settings.get("gateways", "telegram_enabled") == true
  end
end
