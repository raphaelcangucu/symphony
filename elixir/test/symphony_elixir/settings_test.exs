defmodule SymphonyElixir.SettingsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Setting

  setup do
    Repo.delete_all(Setting)
    on_exit(fn -> Repo.delete_all(Setting) end)
    :ok
  end

  test "get returns the in-code default when no row exists" do
    assert Settings.get("agents", "default_agent_kind") == "codex"
  end

  test "put upserts by (group, name) and get returns the stored value" do
    assert {:ok, "claude"} = Settings.put("agents", "default_agent_kind", "claude")
    assert Settings.get("agents", "default_agent_kind") == "claude"

    assert {:ok, "codex"} = Settings.put("agents", "default_agent_kind", "codex")
    assert Settings.get("agents", "default_agent_kind") == "codex"
    assert Repo.aggregate(Setting, :count) == 1
  end

  test "put rejects unknown groups, unknown names, and invalid values" do
    assert {:error, :unknown_group} = Settings.put("nope", "default_agent_kind", "codex")
    assert {:error, :unknown_setting} = Settings.put("agents", "nope", "codex")
    assert {:error, :invalid_value} = Settings.put("agents", "default_agent_kind", "gemini")
  end

  test "get_group and all merge stored rows over defaults" do
    assert Settings.get_group("agents") == %{"default_agent_kind" => "codex"}

    {:ok, _} = Settings.put("agents", "default_agent_kind", "claude")

    assert Settings.get_group("agents") == %{"default_agent_kind" => "claude"}

    assert Settings.all() == %{
             "agents" => %{"default_agent_kind" => "claude"},
             "gateways" => %{
               "telegram_allowed_user_ids" => [],
               "telegram_bot_username" => nil,
               "telegram_dm_allowed_user_ids" => [],
               "telegram_dm_policy" => "allowlist",
               "telegram_enabled" => false,
               "telegram_group_chat_id" => nil,
               "telegram_last_setup_at" => nil,
               "telegram_polling_enabled" => false,
               "telegram_require_mention" => true
             },
             "lab" => %{"bundle_child_orchestration" => false},
             "orchestrator" => %{
               "require_symphony_label" => true,
               "require_assignee_match" => true,
               "agent_token_budget_enabled" => false,
               "agent_token_budget" => 4_000_000
             },
             "ui" => %{"locale" => "auto"}
           }
  end

  test "orchestrator group defaults to conservative gating" do
    assert Settings.get_group("orchestrator") == %{
             "require_symphony_label" => true,
             "require_assignee_match" => true,
             "agent_token_budget_enabled" => false,
             "agent_token_budget" => 4_000_000
           }

    assert Settings.Orchestration.require_symphony_label?() == true
    assert Settings.Orchestration.require_assignee_match?() == true
    refute Settings.Orchestration.agent_token_budget_enabled?()
    assert Settings.Orchestration.agent_token_budget() == 0
    assert Settings.Orchestration.configured_agent_token_budget() == 4_000_000
  end

  test "orchestrator toggles persist and round-trip as booleans" do
    assert {:ok, false} = Settings.put("orchestrator", "require_symphony_label", false)
    assert Settings.get("orchestrator", "require_symphony_label") == false
    assert Settings.Orchestration.require_symphony_label?() == false

    assert {:ok, true} = Settings.put("orchestrator", "require_assignee_match", "true")
    assert Settings.get("orchestrator", "require_assignee_match") == true
  end

  test "orchestrator group rejects non-boolean values" do
    assert {:error, :invalid_value} = Settings.put("orchestrator", "require_symphony_label", "maybe")
    assert {:error, :unknown_setting} = Settings.put("orchestrator", "nope", true)
  end

  test "orchestrator token budget toggles and amount persist" do
    assert {:ok, true} = Settings.put("orchestrator", "agent_token_budget_enabled", true)
    assert Settings.Orchestration.agent_token_budget_enabled?()
    assert Settings.Orchestration.agent_token_budget() == 4_000_000

    assert {:ok, 8_000_000} = Settings.put("orchestrator", "agent_token_budget", 8_000_000)
    assert Settings.Orchestration.agent_token_budget() == 8_000_000

    assert {:ok, false} = Settings.put("orchestrator", "agent_token_budget_enabled", false)
    refute Settings.Orchestration.agent_token_budget_enabled?()
    assert Settings.Orchestration.agent_token_budget() == 0
  end

  test "orchestrator token budget rejects invalid amounts" do
    assert {:error, :invalid_value} = Settings.put("orchestrator", "agent_token_budget", 0)
    assert {:error, :invalid_value} = Settings.put("orchestrator", "agent_token_budget", "nope")
  end

  test "a corrupt payload falls back to the default" do
    Repo.insert!(%Setting{group: "agents", name: "default_agent_kind", payload: %{"bogus" => true}})
    assert Settings.get("agents", "default_agent_kind") == "codex"
  end

  test "a stale stored value that no longer casts falls back to the default" do
    Repo.insert!(%Setting{group: "agents", name: "default_agent_kind", payload: %{"value" => "gemini"}})
    assert Settings.get("agents", "default_agent_kind") == "codex"
  end

  test "Settings.Agents.default_agent_kind/0 convenience reads the chain" do
    assert Settings.Agents.default_agent_kind() == "codex"
    {:ok, _} = Settings.put("agents", "default_agent_kind", "claude")
    assert Settings.Agents.default_agent_kind() == "claude"
  end

  test "ui group defaults to auto locale" do
    assert Settings.get_group("ui") == %{"locale" => "auto"}
  end

  test "ui locale persists and casts valid values" do
    assert {:ok, "pt-BR"} = Settings.put("ui", "locale", "pt-BR")
    assert Settings.get("ui", "locale") == "pt-BR"
    assert Settings.Ui.locale() == "pt-BR"
    assert Settings.Ui.effective_gettext_locale() == "pt_BR"
  end

  test "ui auto locale resolves to en for async/push" do
    assert Settings.Ui.effective_gettext_locale() == "en"
  end

  test "ui group rejects invalid locale values" do
    assert {:error, :invalid_value} = Settings.put("ui", "locale", "fr")
  end

  test "lab defaults bundle_child_orchestration to false" do
    assert Settings.Lab.defaults() == %{"bundle_child_orchestration" => false}
    refute Settings.Lab.bundle_child_orchestration?()
  end

  test "lab casts bundle_child_orchestration boolean" do
    assert {:ok, true} = Settings.Lab.cast("bundle_child_orchestration", true)
    assert {:ok, false} = Settings.Lab.cast("bundle_child_orchestration", "false")
    assert :error = Settings.Lab.cast("bundle_child_orchestration", "maybe")
  end

  test "lab toggles persist and round-trip as booleans" do
    assert {:ok, true} = Settings.put("lab", "bundle_child_orchestration", true)
    assert Settings.Lab.bundle_child_orchestration?()
    assert {:ok, false} = Settings.put("lab", "bundle_child_orchestration", "false")
    refute Settings.Lab.bundle_child_orchestration?()
  end
end
