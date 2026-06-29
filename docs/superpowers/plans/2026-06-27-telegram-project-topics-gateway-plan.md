# Telegram Project Topics Gateway Implementation Plan

**Goal:** Build a Telegram gateway for Symphony with a generic gateway adapter layer, project-topic maestro sessions, direct 1:1 freeform chats, setup/pairing, commands, and settings UI.

**Architecture:** Add provider-neutral gateway schemas, settings, routing, command parsing, and session resolution under `SymphonyElixir.Gateways`, then implement Telegram as the first concrete adapter through `SymphonyElixir.TelegramGateway`. The backend owns polling, access control, pairing, commands, and assistant turn dispatch; the tracker UI exposes global `/settings/gateways` setup and per-project `/projects/:slug/settings/integrations` topic configuration.

**Tech Stack:** Elixir 1.19, Phoenix controllers, Ecto/SQLite, Req, ExUnit, React 19, TypeScript, Vitest, React Testing Library, TanStack-free existing service patterns.

---

## Reference Documents

- Spec: `docs/superpowers/specs/2026-06-27-telegram-project-topics-design.md`
- Existing assistant thread backend: `elixir/lib/symphony_elixir/assistant/history.ex`
- Existing assistant turn backend: `elixir/lib/symphony_elixir/assistant/codex_session.ex`
- Existing channel turn manager: `elixir/lib/symphony_elixir/assistant/turn_manager.ex`
- Existing settings backend: `elixir/lib/symphony_elixir/settings.ex`
- Existing credentials backend: `elixir/lib/symphony_elixir/settings/credentials.ex`
- Existing settings UI: `tracker/src/pages/SettingsPage.tsx`
- Existing project settings UI: `tracker/src/components/projects/ProjectConfigEditor.tsx`

---

## File Structure

### Backend Create

- `elixir/priv/repo/migrations/20260627193000_create_gateway_bindings.exs` — persistent provider conversation bindings.
- `elixir/priv/repo/migrations/20260627193100_create_gateway_pairing_codes.exs` — short-lived one-time setup and project pairing codes.
- `elixir/lib/symphony_elixir/settings/gateways.ex` — generic non-secret gateway settings group.
- `elixir/lib/symphony_elixir/gateways/binding.ex` — Ecto schema and validation for `gateway_bindings`.
- `elixir/lib/symphony_elixir/gateways/pairing_code.ex` — Ecto schema and validation for `gateway_pairing_codes`.
- `elixir/lib/symphony_elixir/gateways.ex` — context for bindings, pairing codes, settings-presented gateway status.
- `elixir/lib/symphony_elixir/gateways/inbound_message.ex` — normalized provider inbound message struct.
- `elixir/lib/symphony_elixir/gateways/adapter.ex` — provider adapter behaviour.
- `elixir/lib/symphony_elixir/gateways/command_parser.ex` — provider-neutral command parser with Telegram slash aliases.
- `elixir/lib/symphony_elixir/gateways/session_resolver.ex` — resolves binding mode to assistant thread and assistant call.
- `elixir/lib/symphony_elixir/gateways/router.ex` — access control, command execution, assistant dispatch.
- `elixir/lib/symphony_elixir/gateways/telegram_adapter.ex` — adapter implementation that delegates Telegram-specific operations.
- `elixir/lib/symphony_elixir/telegram_gateway/client.ex` — Req-backed Telegram Bot API client.
- `elixir/lib/symphony_elixir/telegram_gateway/normalizer.ex` — Telegram update to `GatewayInboundMessage`.
- `elixir/lib/symphony_elixir/telegram_gateway/sender.ex` — Telegram outbound message and typing delivery.
- `elixir/lib/symphony_elixir/telegram_gateway/poller.ex` — supervised long-polling worker.
- `elixir/lib/symphony_elixir_web/controllers/tracker/gateway_controller.ex` — global gateway settings and setup endpoints.
- `elixir/lib/symphony_elixir_web/controllers/tracker/project_gateway_controller.ex` — per-project Telegram topic endpoints.

### Backend Modify

- `elixir/lib/symphony_elixir/settings.ex` — register `"gateways"` settings group.
- `elixir/lib/symphony_elixir/settings/credentials.ex` — add Telegram bot token credential.
- `elixir/lib/symphony_elixir/application.ex` — supervise Telegram poller.
- `elixir/lib/symphony_elixir_web/router.ex` — add gateway API routes.
- `elixir/lib/symphony_elixir/assistant/history.ex` — add gateway-friendly project/project-explore/freeform thread constructors that can create a fresh thread after reset.
- `elixir/lib/symphony_elixir/assistant/codex_session.ex` — add gateway dispatch wrappers that call the existing public assistant functions without Phoenix channel coupling.
- `elixir/lib/symphony_elixir_web/tracker_presenter.ex` — present gateway binding DTOs if the project endpoint embeds them.

### Frontend Create

- `tracker/src/types/gateways.ts` — gateway DTO and view models.
- `tracker/src/services/gateways.ts` — global and project gateway API functions.
- `tracker/src/pages/GatewaysSettingsPage.tsx` — global gateway settings route.
- `tracker/src/components/settings/TelegramGatewaySettingsCard.tsx` — bot setup, token status, group pairing, DM allowlist.
- `tracker/src/components/projects/ProjectTelegramIntegrationCard.tsx` — per-project topic pairing and defaults.

### Frontend Modify

- `tracker/src/lib/settingsRoutes.ts` — add `settingsGatewaysPath()`.
- `tracker/src/components/settings/SettingsLayout.tsx` — add Gateways nav item.
- `tracker/src/App.tsx` — add `/settings/gateways` route.
- `tracker/src/lib/workspaceRoutes.ts` — add `integrations` to `PROJECT_SETTINGS_TABS`.
- `tracker/src/components/projects/ProjectConfigEditor.tsx` — add integrations tab and render project Telegram card.
- `tracker/src/services/settings.ts` — include `gateways` group in `AllSettings`.
- `tracker/locales/en/tracker.json` and `tracker/locales/pt-BR/tracker.json` — labels, commands, errors, settings copy.

---

## Task 1: Gateway Settings and Telegram Credential

**Files:**
- Create: `elixir/lib/symphony_elixir/settings/gateways.ex`
- Modify: `elixir/lib/symphony_elixir/settings.ex`
- Modify: `elixir/lib/symphony_elixir/settings/credentials.ex`
- Test: `elixir/test/symphony_elixir/settings/gateways_test.exs`
- Test: `elixir/test/symphony_elixir/settings/credentials_test.exs`

- [ ] **Step 1: Write failing settings tests**

Create `elixir/test/symphony_elixir/settings/gateways_test.exs`:

```elixir
defmodule SymphonyElixir.Settings.GatewaysTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Gateways

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
```

Add to `elixir/test/symphony_elixir/settings/credentials_test.exs`:

```elixir
test "telegram bot token is a known encrypted credential" do
  assert Credentials.field?("telegram", "bot_token")
  assert Credentials.secret_field?("telegram", "bot_token")

  assert {:ok, :stored} = Credentials.put("telegram", "bot_token", "123:abc")
  assert Credentials.get("telegram", "bot_token") == "123:abc"
end
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd elixir && mix test test/symphony_elixir/settings/gateways_test.exs test/symphony_elixir/settings/credentials_test.exs`

Expected: FAIL because `SymphonyElixir.Settings.Gateways` does not exist and `telegram.bot_token` is unknown.

- [ ] **Step 3: Implement settings group**

Create `elixir/lib/symphony_elixir/settings/gateways.ex`:

```elixir
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
```

Modify `elixir/lib/symphony_elixir/settings.ex`:

```elixir
@groups %{
  "agents" => SymphonyElixir.Settings.Agents,
  "gateways" => SymphonyElixir.Settings.Gateways,
  "orchestrator" => SymphonyElixir.Settings.Orchestration,
  "ui" => SymphonyElixir.Settings.Ui
}
```

Modify `elixir/lib/symphony_elixir/settings/credentials.ex`:

```elixir
@fields %{
  "github" => [
    %{key: "token", label: "Personal access token", secret: true}
  ],
  "jira" => [
    %{key: "base_url", label: "Base URL", secret: false},
    %{key: "email", label: "Account email", secret: false},
    %{key: "api_token", label: "API token", secret: true}
  ],
  "linear" => [
    %{key: "api_key", label: "API key", secret: true}
  ],
  "telegram" => [
    %{key: "bot_token", label: "Bot token", secret: true}
  ]
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `cd elixir && mix test test/symphony_elixir/settings/gateways_test.exs test/symphony_elixir/settings/credentials_test.exs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/settings.ex \
        elixir/lib/symphony_elixir/settings/gateways.ex \
        elixir/lib/symphony_elixir/settings/credentials.ex \
        elixir/test/symphony_elixir/settings/gateways_test.exs \
        elixir/test/symphony_elixir/settings/credentials_test.exs
git commit -m "feat(gateways): add telegram settings and credential"
```

---

## Task 2: Gateway Binding and Pairing Code Persistence

**Files:**
- Create: `elixir/priv/repo/migrations/20260627193000_create_gateway_bindings.exs`
- Create: `elixir/priv/repo/migrations/20260627193100_create_gateway_pairing_codes.exs`
- Create: `elixir/lib/symphony_elixir/gateways/binding.ex`
- Create: `elixir/lib/symphony_elixir/gateways/pairing_code.ex`
- Create: `elixir/lib/symphony_elixir/gateways.ex`
- Test: `elixir/test/symphony_elixir/gateways_test.exs`

- [ ] **Step 1: Write failing persistence tests**

Create `elixir/test/symphony_elixir/gateways_test.exs`:

```elixir
defmodule SymphonyElixir.GatewaysTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Gateways
  alias SymphonyElixir.Gateways.Binding

  test "creates a project topic binding and looks it up by conversation id" do
    {:ok, binding} =
      Gateways.upsert_project_topic_binding(%{
        provider: "telegram",
        account_id: "default",
        project_slug: "macro-markets",
        conversation_id: "-100123:topic:42",
        parent_conversation_id: "-100123",
        thread_id: "42",
        default_agent_kind: "codex",
        default_mode: "explore"
      })

    assert %Binding{binding_kind: "project_topic", active_mode: "explore"} = binding
    assert {:ok, ^binding} = Gateways.get_active_binding("telegram", "default", "-100123:topic:42")
  end

  test "creates a direct freeform binding scoped by sender" do
    {:ok, binding} =
      Gateways.ensure_direct_freeform_binding(%{
        provider: "telegram",
        account_id: "default",
        conversation_id: "dm:777",
        sender_id: "777",
        default_agent_kind: "claude"
      })

    assert binding.binding_kind == "direct_freeform"
    assert binding.active_mode == "freeform"
    assert binding.project_slug == nil
  end

  test "pairing code is single use and expires" do
    {:ok, code} = Gateways.create_pairing_code(:project_topic, %{project_slug: "macro-markets"}, ttl_seconds: 60)

    assert {:ok, %{project_slug: "macro-markets"}} = Gateways.consume_pairing_code(code.code, :project_topic)
    assert {:error, :pairing_code_not_found} = Gateways.consume_pairing_code(code.code, :project_topic)
  end
end
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd elixir && mix test test/symphony_elixir/gateways_test.exs`

Expected: FAIL because gateway schemas/context do not exist.

- [ ] **Step 3: Add migrations**

Create `elixir/priv/repo/migrations/20260627193000_create_gateway_bindings.exs`:

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateGatewayBindings do
  use Ecto.Migration

  def change do
    create table(:gateway_bindings) do
      add(:provider, :string, null: false)
      add(:account_id, :string, null: false, default: "default")
      add(:binding_kind, :string, null: false)
      add(:project_slug, :string)
      add(:conversation_id, :string, null: false)
      add(:parent_conversation_id, :string)
      add(:thread_id, :string)
      add(:sender_id, :string)
      add(:status, :string, null: false, default: "active")
      add(:default_agent_kind, :string)
      add(:default_mode, :string, null: false)
      add(:active_mode, :string, null: false)
      add(:active_issue_identifier, :string)
      add(:active_kb_repo_slug, :string)
      add(:active_kb_page_path, :string)
      add(:active_thread_id, references(:assistant_threads, on_delete: :nilify_all))
      add(:metadata, :map, null: false, default: %{})

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:gateway_bindings, [:provider, :account_id, :conversation_id],
             where: "status = 'active'",
             name: :gateway_bindings_active_conversation_index
           ))

    create(unique_index(:gateway_bindings, [:provider, :project_slug],
             where: "status = 'active' AND binding_kind = 'project_topic'",
             name: :gateway_bindings_active_project_topic_index
           ))

    create(unique_index(:gateway_bindings, [:provider, :account_id, :sender_id],
             where: "status = 'active' AND binding_kind = 'direct_freeform'",
             name: :gateway_bindings_active_direct_sender_index
           ))

    create(index(:gateway_bindings, [:provider, :account_id, :parent_conversation_id, :thread_id],
             name: :gateway_bindings_parent_thread_index
           ))
  end
end
```

Create `elixir/priv/repo/migrations/20260627193100_create_gateway_pairing_codes.exs`:

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateGatewayPairingCodes do
  use Ecto.Migration

  def change do
    create table(:gateway_pairing_codes) do
      add(:code, :string, null: false)
      add(:purpose, :string, null: false)
      add(:payload, :map, null: false, default: %{})
      add(:expires_at, :utc_datetime_usec, null: false)
      add(:consumed_at, :utc_datetime_usec)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:gateway_pairing_codes, [:code], name: :gateway_pairing_codes_code_index))
    create(index(:gateway_pairing_codes, [:purpose, :expires_at], name: :gateway_pairing_codes_purpose_expiry_index))
  end
end
```

- [ ] **Step 4: Add schemas and context**

Create `Binding`, `PairingCode`, and `Gateways` context with these public APIs:

```elixir
@spec upsert_project_topic_binding(map()) :: {:ok, Binding.t()} | {:error, Ecto.Changeset.t()}
@spec ensure_direct_freeform_binding(map()) :: {:ok, Binding.t()} | {:error, Ecto.Changeset.t()}
@spec get_active_binding(String.t(), String.t(), String.t()) :: {:ok, Binding.t()} | {:error, :binding_not_found}
@spec update_binding(Binding.t(), map()) :: {:ok, Binding.t()} | {:error, Ecto.Changeset.t()}
@spec clear_active_thread(Binding.t()) :: {:ok, Binding.t()} | {:error, Ecto.Changeset.t()}
@spec create_pairing_code(atom(), map(), keyword()) :: {:ok, PairingCode.t()} | {:error, Ecto.Changeset.t()}
@spec consume_pairing_code(String.t(), atom()) :: {:ok, map()} | {:error, :pairing_code_not_found | :pairing_code_expired}
```

Validation rules:

- `provider`, `account_id`, `binding_kind`, `conversation_id`, `status`, `default_mode`, and `active_mode` are required.
- `binding_kind` is only `"project_topic"` or `"direct_freeform"`.
- `status` is only `"active"`, `"disabled"`, or `"archived"`.
- agent kinds are `nil`, `"codex"`, `"claude"`, or `"cursor"`.
- modes are `"explore"`, `"project"`, `"issue"`, `"kb"`, or `"freeform"`.
- `project_topic` requires `project_slug`, `parent_conversation_id`, and `thread_id`.
- `direct_freeform` requires `sender_id`, forbids `project_slug`, and forces `default_mode`/`active_mode` to `"freeform"`.

- [ ] **Step 5: Run migration and tests**

Run: `cd elixir && mix ecto.migrate && mix test test/symphony_elixir/gateways_test.exs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/priv/repo/migrations/20260627193000_create_gateway_bindings.exs \
        elixir/priv/repo/migrations/20260627193100_create_gateway_pairing_codes.exs \
        elixir/lib/symphony_elixir/gateways \
        elixir/lib/symphony_elixir/gateways.ex \
        elixir/test/symphony_elixir/gateways_test.exs
git commit -m "feat(gateways): persist gateway bindings and pairing codes"
```

---

## Task 3: Generic Inbound Message, Adapter Behaviour, and Command Parser

**Files:**
- Create: `elixir/lib/symphony_elixir/gateways/inbound_message.ex`
- Create: `elixir/lib/symphony_elixir/gateways/adapter.ex`
- Create: `elixir/lib/symphony_elixir/gateways/command_parser.ex`
- Test: `elixir/test/symphony_elixir/gateways/command_parser_test.exs`

- [ ] **Step 1: Write failing command parser tests**

Create `elixir/test/symphony_elixir/gateways/command_parser_test.exs`:

```elixir
defmodule SymphonyElixir.Gateways.CommandParserTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Gateways.CommandParser

  test "parses canonical and portuguese aliases" do
    assert {:command, {:help, %{}}} = CommandParser.parse("/help")
    assert {:command, {:help, %{}}} = CommandParser.parse("/ajuda")
    assert {:command, {:set_agent, %{agent_kind: "claude"}}} = CommandParser.parse("/agente claude")
    assert {:command, {:set_mode, %{mode: "explore"}}} = CommandParser.parse("/modo explore")
    assert {:command, {:new_session, %{}}} = CommandParser.parse("/novo")
    assert {:command, {:stop, %{}}} = CommandParser.parse("/parar")
  end

  test "parses setup and pairing commands" do
    assert {:command, {:setup_pair, %{code: "ABC123"}}} = CommandParser.parse("/symphony_setup ABC123")
    assert {:command, {:project_pair, %{code: "XYZ987"}}} = CommandParser.parse("/symphony_parear XYZ987")
  end

  test "returns plain text for normal messages" do
    assert :plain_text = CommandParser.parse("please inspect the project")
  end

  test "rejects invalid commands without treating them as plain text" do
    assert {:error, :unknown_command} = CommandParser.parse("/doesnotexist")
    assert {:error, :invalid_agent} = CommandParser.parse("/agent gpt4")
    assert {:error, :missing_mode} = CommandParser.parse("/mode")
  end
end
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd elixir && mix test test/symphony_elixir/gateways/command_parser_test.exs`

Expected: FAIL because parser modules do not exist.

- [ ] **Step 3: Implement inbound struct and adapter behaviour**

Create `elixir/lib/symphony_elixir/gateways/inbound_message.ex`:

```elixir
defmodule SymphonyElixir.Gateways.InboundMessage do
  @moduledoc "Provider-neutral inbound gateway message."

  @enforce_keys [:provider, :account_id, :conversation_kind, :conversation_id, :sender_id, :raw_text]
  defstruct [
    :provider,
    :account_id,
    :conversation_kind,
    :conversation_id,
    :parent_conversation_id,
    :thread_id,
    :sender_id,
    :sender_name,
    :message_id,
    :reply_to_message_id,
    :raw_text,
    metadata: %{}
  ]

  @type t :: %__MODULE__{
          provider: String.t(),
          account_id: String.t(),
          conversation_kind: String.t(),
          conversation_id: String.t(),
          parent_conversation_id: String.t() | nil,
          thread_id: String.t() | nil,
          sender_id: String.t(),
          sender_name: String.t() | nil,
          message_id: String.t() | nil,
          reply_to_message_id: String.t() | nil,
          raw_text: String.t(),
          metadata: map()
        }
end
```

Create `elixir/lib/symphony_elixir/gateways/adapter.ex`:

```elixir
defmodule SymphonyElixir.Gateways.Adapter do
  @moduledoc "Behaviour for external chat gateway adapters."

  alias SymphonyElixir.Gateways.InboundMessage

  @callback normalize_update(term()) :: {:ok, InboundMessage.t()} | {:ignore, term()} | {:error, term()}
  @callback send_text(InboundMessage.t(), String.t(), keyword()) :: :ok | {:error, term()}
  @callback send_typing(InboundMessage.t(), keyword()) :: :ok | {:error, term()}
end
```

- [ ] **Step 4: Implement command parser**

Create `elixir/lib/symphony_elixir/gateways/command_parser.ex` with exact command atoms:

```elixir
@help ~w(/help /ajuda)
@status ~w(/status /estado)
@agent ~w(/agent /agente)
@mode ~w(/mode /modo)
@new ~w(/new /novo /reset)
@stop ~w(/stop /parar)
@setup ~w(/setup /configurar)
@setup_pair ~w(/symphony_setup)
@project_pair ~w(/symphony_pair /symphony_parear)
@agents ~w(codex claude cursor)
@modes ~w(explore project issue kb freeform)
```

Return values:

- `:plain_text`
- `{:command, {:help, %{}}}`
- `{:command, {:status, %{}}}`
- `{:command, {:show_agent, %{}}}`
- `{:command, {:set_agent, %{agent_kind: kind}}}`
- `{:command, {:show_mode, %{}}}`
- `{:command, {:set_mode, %{mode: mode, args: args}}}`
- `{:command, {:new_session, %{}}}`
- `{:command, {:stop, %{}}}`
- `{:command, {:setup, %{}}}`
- `{:command, {:setup_pair, %{code: code}}}`
- `{:command, {:project_pair, %{code: code}}}`
- `{:error, reason}`

- [ ] **Step 5: Run parser tests**

Run: `cd elixir && mix test test/symphony_elixir/gateways/command_parser_test.exs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/gateways/inbound_message.ex \
        elixir/lib/symphony_elixir/gateways/adapter.ex \
        elixir/lib/symphony_elixir/gateways/command_parser.ex \
        elixir/test/symphony_elixir/gateways/command_parser_test.exs
git commit -m "feat(gateways): parse gateway commands"
```

---

## Task 4: Telegram Normalizer, Client, and Sender

**Files:**
- Create: `elixir/lib/symphony_elixir/telegram_gateway/client.ex`
- Create: `elixir/lib/symphony_elixir/telegram_gateway/normalizer.ex`
- Create: `elixir/lib/symphony_elixir/telegram_gateway/sender.ex`
- Create: `elixir/lib/symphony_elixir/gateways/telegram_adapter.ex`
- Test: `elixir/test/symphony_elixir/telegram_gateway/normalizer_test.exs`
- Test: `elixir/test/symphony_elixir/telegram_gateway/sender_test.exs`

- [ ] **Step 1: Write failing normalizer tests**

Create `elixir/test/symphony_elixir/telegram_gateway/normalizer_test.exs`:

```elixir
defmodule SymphonyElixir.TelegramGateway.NormalizerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Gateways.InboundMessage
  alias SymphonyElixir.TelegramGateway.Normalizer

  test "normalizes forum topic messages" do
    update = %{
      "message" => %{
        "message_id" => 10,
        "message_thread_id" => 42,
        "text" => "hello",
        "chat" => %{"id" => -100123, "type" => "supergroup", "is_forum" => true},
        "from" => %{"id" => 777, "first_name" => "Raphael"}
      }
    }

    assert {:ok, %InboundMessage{} = message} = Normalizer.normalize_update(update)
    assert message.conversation_kind == "topic"
    assert message.conversation_id == "-100123:topic:42"
    assert message.parent_conversation_id == "-100123"
    assert message.thread_id == "42"
    assert message.sender_id == "777"
  end

  test "normalizes direct messages as freeform conversations" do
    update = %{
      "message" => %{
        "message_id" => 11,
        "text" => "free chat",
        "chat" => %{"id" => 777, "type" => "private"},
        "from" => %{"id" => 777, "username" => "rc"}
      }
    }

    assert {:ok, message} = Normalizer.normalize_update(update)
    assert message.conversation_kind == "direct"
    assert message.conversation_id == "dm:777"
    assert message.thread_id == nil
  end

  test "ignores messages without usable text" do
    assert {:ignore, :unsupported_update} = Normalizer.normalize_update(%{"message" => %{"photo" => []}})
  end
end
```

- [ ] **Step 2: Run normalizer tests and verify failure**

Run: `cd elixir && mix test test/symphony_elixir/telegram_gateway/normalizer_test.exs`

Expected: FAIL because Telegram normalizer does not exist.

- [ ] **Step 3: Implement normalizer**

Implement `Normalizer.normalize_update/1` with:

- supports `"message"` and `"edited_message"` text/caption
- rejects missing text with `{:ignore, :unsupported_update}`
- direct private chat conversation id: `"dm:" <> chat_id`
- forum topic conversation id: `"#{chat_id}:topic:#{message_thread_id}"`
- non-topic group conversation id: `to_string(chat_id)` and `conversation_kind = "group"` for setup command support only
- metadata includes `"telegram_chat_type"`, `"telegram_raw_chat_id"`, and `"telegram_message_thread_id"` when present

- [ ] **Step 4: Write sender tests**

Create `elixir/test/symphony_elixir/telegram_gateway/sender_test.exs`:

```elixir
defmodule SymphonyElixir.TelegramGateway.SenderTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Gateways.InboundMessage
  alias SymphonyElixir.TelegramGateway.Sender

  test "sends topic replies with message_thread_id" do
    message = %InboundMessage{
      provider: "telegram",
      account_id: "default",
      conversation_kind: "topic",
      conversation_id: "-100123:topic:42",
      parent_conversation_id: "-100123",
      thread_id: "42",
      sender_id: "777",
      raw_text: "hello"
    }

    send_fun = fn method, payload ->
      assert method == "sendMessage"
      assert payload["chat_id"] == "-100123"
      assert payload["message_thread_id"] == 42
      assert payload["text"] == "reply"
      {:ok, %{"ok" => true}}
    end

    assert :ok = Sender.send_text(message, "reply", send_fun: send_fun)
  end

  test "sends direct replies without message_thread_id" do
    message = %InboundMessage{
      provider: "telegram",
      account_id: "default",
      conversation_kind: "direct",
      conversation_id: "dm:777",
      sender_id: "777",
      raw_text: "hello"
    }

    send_fun = fn _method, payload ->
      refute Map.has_key?(payload, "message_thread_id")
      assert payload["chat_id"] == "777"
      {:ok, %{"ok" => true}}
    end

    assert :ok = Sender.send_text(message, "reply", send_fun: send_fun)
  end
end
```

- [ ] **Step 5: Implement client, sender, and adapter**

Implement:

- `TelegramGateway.Client.call(method, payload, opts)` using `Req.post/2` to `https://api.telegram.org/bot<TOKEN>/<method>`.
- `TelegramGateway.Sender.send_text/3` and `send_typing/2`.
- `Gateways.TelegramAdapter.normalize_update/1`, `send_text/3`, and `send_typing/2` delegating to normalizer/sender.

Do not log tokens. Token resolution reads `Settings.Credentials.get("telegram", "bot_token")`.

- [ ] **Step 6: Run tests**

Run: `cd elixir && mix test test/symphony_elixir/telegram_gateway/normalizer_test.exs test/symphony_elixir/telegram_gateway/sender_test.exs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add elixir/lib/symphony_elixir/telegram_gateway \
        elixir/lib/symphony_elixir/gateways/telegram_adapter.ex \
        elixir/test/symphony_elixir/telegram_gateway
git commit -m "feat(telegram): normalize and send telegram messages"
```

---

## Task 5: Gateway Session Resolver

**Files:**
- Create: `elixir/lib/symphony_elixir/gateways/session_resolver.ex`
- Modify: `elixir/lib/symphony_elixir/assistant/history.ex`
- Test: `elixir/test/symphony_elixir/gateways/session_resolver_test.exs`

- [ ] **Step 1: Write failing resolver tests**

Create `elixir/test/symphony_elixir/gateways/session_resolver_test.exs`:

```elixir
defmodule SymphonyElixir.Gateways.SessionResolverTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Gateways
  alias SymphonyElixir.Gateways.SessionResolver
  alias SymphonyElixir.LocalTracker.Context

  test "direct bindings create freeform threads" do
    {:ok, binding} =
      Gateways.ensure_direct_freeform_binding(%{
        provider: "telegram",
        account_id: "default",
        conversation_id: "dm:777",
        sender_id: "777",
        default_agent_kind: "codex"
      })

    assert {:ok, thread, updated_binding} = SessionResolver.ensure_thread(binding)
    assert thread.scope == "freeform"
    assert updated_binding.active_thread_id == thread.id
  end

  test "project topic bindings create project explore threads" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    {:ok, binding} =
      Gateways.upsert_project_topic_binding(%{
        provider: "telegram",
        account_id: "default",
        project_slug: "macro-markets",
        conversation_id: "-100123:topic:42",
        parent_conversation_id: "-100123",
        thread_id: "42",
        default_agent_kind: "codex",
        default_mode: "explore"
      })

    assert {:ok, thread, updated_binding} = SessionResolver.ensure_thread(binding)
    assert thread.scope == "project_explore"
    assert thread.project_slug == "macro-markets"
    assert updated_binding.active_thread_id == thread.id
  end
end
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd elixir && mix test test/symphony_elixir/gateways/session_resolver_test.exs`

Expected: FAIL because resolver does not exist and History lacks gateway-specific constructors.

- [ ] **Step 3: Add History constructors**

Modify `elixir/lib/symphony_elixir/assistant/history.ex` with public functions:

```elixir
@spec create_gateway_project_explore_thread(String.t(), attrs()) :: {:ok, Thread.t()} | {:error, term()}
def create_gateway_project_explore_thread(project_slug, attrs \\ %{}) when is_binary(project_slug) and is_map(attrs) do
  with {:ok, normalized_slug} <- normalize_required_string(project_slug, :project_slug),
       {:ok, _project} <- Context.get_project(normalized_slug),
       {:ok, workspace} <- ProjectExploreWorkspace.ensure(normalized_slug, explore_workspace_opts(attrs)) do
    attrs
    |> Map.put(:scope, "project_explore")
    |> Map.put(:project_slug, normalized_slug)
    |> Map.put_new(:workspace_path, workspace)
    |> Map.put_new(:status, "active")
    |> Thread.changeset(%Thread{})
    |> Repo.insert()
  end
end
```

If Elixir pipeline order makes the snippet invalid in implementation, use:

```elixir
attrs
|> Map.put(:scope, "project_explore")
|> Map.put(:project_slug, normalized_slug)
|> Map.put_new(:workspace_path, workspace)
|> Map.put_new(:status, "active")
|> then(&Thread.changeset(%Thread{}, &1))
|> Repo.insert()
```

Add:

```elixir
@spec create_gateway_project_thread(String.t(), attrs()) :: {:ok, Thread.t()} | {:error, term()}
@spec create_gateway_freeform_thread(attrs()) :: {:ok, Thread.t()} | {:error, term()}
```

`create_gateway_freeform_thread/1` wraps `create_freeform_thread/1` and sets a title such as `"Telegram freeform chat"` when absent.

- [ ] **Step 4: Implement SessionResolver**

`SessionResolver.ensure_thread/1` behavior:

- If `binding.active_thread_id` points to an active thread, return it.
- If `binding.binding_kind == "direct_freeform"`, create freeform thread with workspace from `CodexSession.freeform_workspace(binding.id)`, title `"Telegram DM #{sender_id}"`, and `agent_kind` from binding.
- If `binding.active_mode == "explore"`, create gateway project explore thread.
- If `binding.active_mode == "project"`, create gateway project thread.
- If `binding.active_mode == "issue"`, call `History.ensure_issue_thread/3` with `active_issue_identifier`.
- If `binding.active_mode == "kb"`, call `History.ensure_kb_thread/4`.
- Persist `active_thread_id` on binding.

- [ ] **Step 5: Run tests**

Run: `cd elixir && mix test test/symphony_elixir/gateways/session_resolver_test.exs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/gateways/session_resolver.ex \
        elixir/lib/symphony_elixir/assistant/history.ex \
        elixir/test/symphony_elixir/gateways/session_resolver_test.exs
git commit -m "feat(gateways): resolve gateway sessions to assistant threads"
```

---

## Task 6: Gateway Router Commands and Access Control

**Files:**
- Create: `elixir/lib/symphony_elixir/gateways/router.ex`
- Test: `elixir/test/symphony_elixir/gateways/router_test.exs`

- [ ] **Step 1: Write failing router command tests**

Create `elixir/test/symphony_elixir/gateways/router_test.exs`:

```elixir
defmodule SymphonyElixir.Gateways.RouterTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Gateways
  alias SymphonyElixir.Gateways.InboundMessage
  alias SymphonyElixir.Gateways.Router
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Settings

  test "blocks unauthorized direct messages" do
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_dm_allowed_user_ids", ["999"])

    message = direct_message("777", "hello")
    assert {:dropped, :unauthorized_direct_sender} = Router.handle_message(message, adapter: FakeAdapter)
  end

  test "allows direct status and creates direct binding" do
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_dm_allowed_user_ids", ["777"])

    message = direct_message("777", "/status")
    assert {:ok, :command} = Router.handle_message(message, adapter: FakeAdapter)
    assert {:ok, binding} = Gateways.get_active_binding("telegram", "default", "dm:777")
    assert binding.binding_kind == "direct_freeform"
  end

  test "sets agent on project topic binding" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_group_chat_id", "-100123")
    Settings.put("gateways", "telegram_allowed_user_ids", ["777"])

    {:ok, binding} =
      Gateways.upsert_project_topic_binding(%{
        provider: "telegram",
        account_id: "default",
        project_slug: "macro-markets",
        conversation_id: "-100123:topic:42",
        parent_conversation_id: "-100123",
        thread_id: "42",
        default_agent_kind: "codex",
        default_mode: "explore"
      })

    assert {:ok, :command} = Router.handle_message(topic_message("/agent claude"), adapter: FakeAdapter)
    assert {:ok, updated} = Gateways.get_active_binding("telegram", "default", binding.conversation_id)
    assert updated.default_agent_kind == "claude"
  end

  defp direct_message(sender_id, text) do
    %InboundMessage{
      provider: "telegram",
      account_id: "default",
      conversation_kind: "direct",
      conversation_id: "dm:" <> sender_id,
      sender_id: sender_id,
      raw_text: text
    }
  end

  defp topic_message(text) do
    %InboundMessage{
      provider: "telegram",
      account_id: "default",
      conversation_kind: "topic",
      conversation_id: "-100123:topic:42",
      parent_conversation_id: "-100123",
      thread_id: "42",
      sender_id: "777",
      raw_text: text
    }
  end

  defmodule FakeAdapter do
    def send_text(_message, _text, _opts), do: :ok
    def send_typing(_message, _opts), do: :ok
  end
end
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd elixir && mix test test/symphony_elixir/gateways/router_test.exs`

Expected: FAIL because router does not exist.

- [ ] **Step 3: Implement router access control and commands**

Implement `Router.handle_message/2`:

```elixir
@spec handle_message(InboundMessage.t(), keyword()) ::
        {:ok, :command | :queued | :sent} | {:dropped, atom()} | {:error, term()}
```

Access control:

- Telegram must be enabled except `setup_pair`.
- Direct messages require sender in `telegram_dm_allowed_user_ids`.
- Topic messages require `parent_conversation_id == telegram_group_chat_id`.
- Topic normal messages require an active binding.
- `setup_pair` and `project_pair` may run before binding if pairing code is valid.

Commands:

- `/help` sends help text.
- `/status` sends status text and creates direct binding for authorized DMs.
- `/agent` sets `default_agent_kind` and active thread agent if a thread exists.
- `/mode freeform` allowed only for direct; project modes allowed only for project topic.
- `/new` archives current active thread if present, clears binding, creates a fresh thread via `SessionResolver.ensure_thread/1`, sends new session id.
- `/stop` uses `TurnManager.interrupt/2` or the available interrupt function in `TurnManager`; if no running turn, reply `"No active turn."`.
- invalid command sends concise help and returns `{:ok, :command}`.

- [ ] **Step 4: Run router tests**

Run: `cd elixir && mix test test/symphony_elixir/gateways/router_test.exs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/gateways/router.ex \
        elixir/test/symphony_elixir/gateways/router_test.exs
git commit -m "feat(gateways): route gateway commands with access control"
```

---

## Task 7: Assistant Dispatch from Gateway Plain Text

**Files:**
- Modify: `elixir/lib/symphony_elixir/gateways/router.ex`
- Modify: `elixir/lib/symphony_elixir/gateways/session_resolver.ex`
- Test: `elixir/test/symphony_elixir/gateways/router_dispatch_test.exs`

- [ ] **Step 1: Write failing dispatch tests with injected runner**

Create `elixir/test/symphony_elixir/gateways/router_dispatch_test.exs`:

```elixir
defmodule SymphonyElixir.Gateways.RouterDispatchTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Gateways
  alias SymphonyElixir.Gateways.InboundMessage
  alias SymphonyElixir.Gateways.Router
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Settings

  test "dispatches allowed direct plain text to freeform assistant" do
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_dm_allowed_user_ids", ["777"])

    runner = fn _workspace, prompt, _issue, _opts ->
      assert prompt =~ "Current user message:"
      assert prompt =~ "hello freeform"
      {:ok, %{assistant_message: "freeform reply", tool_calls: []}}
    end

    assert {:ok, :sent} =
             Router.handle_message(direct_message("777", "hello freeform"),
               adapter: FakeAdapter,
               runner: runner
             )
  end

  test "dispatches topic plain text to project explore assistant" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    Settings.put("gateways", "telegram_enabled", true)
    Settings.put("gateways", "telegram_group_chat_id", "-100123")
    Settings.put("gateways", "telegram_allowed_user_ids", ["777"])

    {:ok, _binding} =
      Gateways.upsert_project_topic_binding(%{
        provider: "telegram",
        account_id: "default",
        project_slug: "macro-markets",
        conversation_id: "-100123:topic:42",
        parent_conversation_id: "-100123",
        thread_id: "42",
        default_agent_kind: "codex",
        default_mode: "explore"
      })

    runner = fn _workspace, prompt, _issue, _opts ->
      assert prompt =~ "project explore assistant"
      assert prompt =~ "inspect repo"
      {:ok, %{assistant_message: "project reply", tool_calls: []}}
    end

    assert {:ok, :sent} = Router.handle_message(topic_message("inspect repo"), adapter: FakeAdapter, runner: runner)
  end

  defp direct_message(sender_id, text) do
    %InboundMessage{provider: "telegram", account_id: "default", conversation_kind: "direct", conversation_id: "dm:" <> sender_id, sender_id: sender_id, raw_text: text}
  end

  defp topic_message(text) do
    %InboundMessage{provider: "telegram", account_id: "default", conversation_kind: "topic", conversation_id: "-100123:topic:42", parent_conversation_id: "-100123", thread_id: "42", sender_id: "777", raw_text: text}
  end

  defmodule FakeAdapter do
    def send_text(_message, _text, _opts), do: :ok
    def send_typing(_message, _opts), do: :ok
  end
end
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd elixir && mix test test/symphony_elixir/gateways/router_dispatch_test.exs`

Expected: FAIL because plain text dispatch is not implemented.

- [ ] **Step 3: Implement plain text assistant dispatch**

In `Router.handle_message/2`, when parser returns `:plain_text`:

- Resolve or create binding for direct freeform.
- Resolve existing binding for topic.
- Use `SessionResolver.ensure_thread/1`.
- Send typing through adapter before starting.
- Build context:

```elixir
%{
  "source" => "telegram",
  "provider" => message.provider,
  "conversation_id" => message.conversation_id,
  "conversation_kind" => message.conversation_kind,
  "sender_id" => message.sender_id,
  "message_id" => message.message_id
}
```

- Call the matching `CodexSession` function with `runner: opts[:runner]` for tests, `agent_kind` from binding, and stream callbacks that buffer final response for Telegram.
- Send final response via adapter.

Implement minimal synchronous dispatch first; polling integration can run it in a task in Task 9 if needed.

- [ ] **Step 4: Run dispatch tests**

Run: `cd elixir && mix test test/symphony_elixir/gateways/router_dispatch_test.exs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/gateways/router.ex \
        elixir/lib/symphony_elixir/gateways/session_resolver.ex \
        elixir/test/symphony_elixir/gateways/router_dispatch_test.exs
git commit -m "feat(gateways): dispatch telegram messages to assistant sessions"
```

---

## Task 8: Telegram Poller Supervision

**Files:**
- Create: `elixir/lib/symphony_elixir/telegram_gateway/poller.ex`
- Modify: `elixir/lib/symphony_elixir/application.ex`
- Test: `elixir/test/symphony_elixir/telegram_gateway/poller_test.exs`

- [ ] **Step 1: Write failing poller tests**

Create `elixir/test/symphony_elixir/telegram_gateway/poller_test.exs`:

```elixir
defmodule SymphonyElixir.TelegramGateway.PollerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.TelegramGateway.Poller

  test "poll_once fetches updates, routes them, and advances offset" do
    updates = [%{"update_id" => 100, "message" => %{"text" => "/help", "chat" => %{"id" => 1, "type" => "private"}, "from" => %{"id" => 1}}}]

    fetch = fn offset ->
      assert offset == 0
      {:ok, updates}
    end

    routed = Agent.start_link(fn -> [] end) |> elem(1)

    route = fn update ->
      Agent.update(routed, &[update | &1])
      {:ok, :command}
    end

    assert {:ok, 101} = Poller.poll_once(0, fetch_updates: fetch, route_update: route)
    assert Agent.get(routed, &length/1) == 1
  end
end
```

- [ ] **Step 2: Run poller tests and verify failure**

Run: `cd elixir && mix test test/symphony_elixir/telegram_gateway/poller_test.exs`

Expected: FAIL because poller does not exist.

- [ ] **Step 3: Implement poller**

Implement:

- `start_link/1`
- `init/1`
- periodic polling only when `Settings.Gateways.telegram_enabled?()` and `telegram_polling_enabled?()` are true
- `poll_once/2` pure helper for tests
- `getUpdates` call with timeout and offset
- route each update through `Gateways.TelegramAdapter.normalize_update/1` and `Gateways.Router.handle_message/2`
- advance offset to `max(update_id) + 1` after accepted or dropped updates

- [ ] **Step 4: Add supervision**

Modify `elixir/lib/symphony_elixir/application.ex` children:

```elixir
{SymphonyElixir.TelegramGateway.Poller, []}
```

Place it after `Repo` and settings-dependent infrastructure.

- [ ] **Step 5: Run tests**

Run: `cd elixir && mix test test/symphony_elixir/telegram_gateway/poller_test.exs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/telegram_gateway/poller.ex \
        elixir/lib/symphony_elixir/application.ex \
        elixir/test/symphony_elixir/telegram_gateway/poller_test.exs
git commit -m "feat(telegram): poll telegram updates"
```

---

## Task 9: Gateway API Controllers

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/gateway_controller.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/project_gateway_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/gateway_controller_test.exs`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/project_gateway_controller_test.exs`

- [ ] **Step 1: Write failing controller tests**

Create controller tests that assert:

- `GET /settings/gateways` returns Telegram settings without bot token plaintext.
- `PUT /settings/gateways/telegram` updates enabled, polling, allowlists, and mention settings.
- `POST /settings/gateways/telegram/test_bot` calls injected Telegram client and stores bot username.
- `POST /settings/gateways/telegram/pairing_code` returns `/symphony_setup <code>`.
- `GET /projects/:project_slug/gateways/telegram` returns active project binding or null.
- `POST /projects/:project_slug/gateways/telegram/pairing_code` returns `/symphony_pair <code>`.
- `POST /projects/:project_slug/gateways/telegram/reset` resets current project topic session.
- `DELETE /projects/:project_slug/gateways/telegram` archives the active project topic binding.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd elixir && mix test \
  test/symphony_elixir_web/controllers/tracker/gateway_controller_test.exs \
  test/symphony_elixir_web/controllers/tracker/project_gateway_controller_test.exs
```

Expected: FAIL because controllers/routes do not exist.

- [ ] **Step 3: Implement controllers**

Routes to add in `elixir/lib/symphony_elixir_web/router.ex` inside tracker API scope:

```elixir
get("/settings/gateways", GatewayController, :show)
put("/settings/gateways/telegram", GatewayController, :update_telegram)
post("/settings/gateways/telegram/test_bot", GatewayController, :test_telegram_bot)
post("/settings/gateways/telegram/pairing_code", GatewayController, :telegram_pairing_code)
get("/projects/:project_slug/gateways/telegram", ProjectGatewayController, :show_telegram)
post("/projects/:project_slug/gateways/telegram/pairing_code", ProjectGatewayController, :telegram_pairing_code)
post("/projects/:project_slug/gateways/telegram/reset", ProjectGatewayController, :reset_telegram)
delete("/projects/:project_slug/gateways/telegram", ProjectGatewayController, :delete_telegram)
```

Response shape:

```json
{
  "data": {
    "telegram": {
      "enabled": false,
      "botUsername": null,
      "botTokenConfigured": false,
      "groupChatId": null,
      "allowedUserIds": [],
      "dmPolicy": "allowlist",
      "dmAllowedUserIds": [],
      "requireMention": true,
      "pollingEnabled": false
    }
  }
}
```

Project response shape:

```json
{
  "data": {
    "binding": null,
    "globalConfigured": false
  }
}
```

- [ ] **Step 4: Run controller tests**

Run the controller test command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/gateway_controller.ex \
        elixir/lib/symphony_elixir_web/controllers/tracker/project_gateway_controller.ex \
        elixir/lib/symphony_elixir_web/router.ex \
        elixir/test/symphony_elixir_web/controllers/tracker/gateway_controller_test.exs \
        elixir/test/symphony_elixir_web/controllers/tracker/project_gateway_controller_test.exs
git commit -m "feat(gateways): expose telegram gateway APIs"
```

---

## Task 10: Frontend Gateway Services and Types

**Files:**
- Create: `tracker/src/types/gateways.ts`
- Create: `tracker/src/services/gateways.ts`
- Test: `tracker/src/services/__tests__/gateways.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `tracker/src/services/__tests__/gateways.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { getGatewaySettings, normalizeGatewaySettings, normalizeProjectTelegramGateway } from "@/services/gateways";

describe("gateway services", () => {
  it("normalizes global telegram settings", () => {
    const settings = normalizeGatewaySettings({
      telegram: {
        enabled: true,
        bot_username: "sym_bot",
        bot_token_configured: true,
        group_chat_id: "-100123",
        allowed_user_ids: ["777"],
        dm_policy: "allowlist",
        dm_allowed_user_ids: ["777"],
        require_mention: true,
        polling_enabled: true,
      },
    });

    expect(settings.telegram.botUsername).toBe("sym_bot");
    expect(settings.telegram.botTokenConfigured).toBe(true);
    expect(settings.telegram.dmAllowedUserIds).toEqual(["777"]);
  });

  it("normalizes project telegram binding", () => {
    const result = normalizeProjectTelegramGateway({
      global_configured: true,
      binding: {
        id: 1,
        project_slug: "macro-markets",
        conversation_id: "-100123:topic:42",
        thread_id: "42",
        default_agent_kind: "codex",
        default_mode: "explore",
        active_mode: "explore",
      },
    });

    expect(result.globalConfigured).toBe(true);
    expect(result.binding?.threadId).toBe("42");
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd tracker && npx vitest run src/services/__tests__/gateways.test.ts`

Expected: FAIL because service files do not exist.

- [ ] **Step 3: Implement service and types**

Create `tracker/src/types/gateways.ts` with:

```ts
export type GatewayAgentKind = "codex" | "claude" | "cursor";
export type GatewayMode = "explore" | "project" | "issue" | "kb" | "freeform";

export interface TelegramGatewaySettings {
  enabled: boolean;
  botUsername: string | null;
  botTokenConfigured: boolean;
  groupChatId: string | null;
  allowedUserIds: string[];
  dmPolicy: "allowlist";
  dmAllowedUserIds: string[];
  requireMention: boolean;
  pollingEnabled: boolean;
}

export interface GatewaySettings {
  telegram: TelegramGatewaySettings;
}

export interface ProjectTelegramBinding {
  id: number;
  projectSlug: string;
  conversationId: string;
  threadId: string;
  defaultAgentKind: GatewayAgentKind | null;
  defaultMode: GatewayMode;
  activeMode: GatewayMode;
}

export interface ProjectTelegramGateway {
  globalConfigured: boolean;
  binding: ProjectTelegramBinding | null;
}
```

Create services:

- `getGatewaySettings()`
- `updateTelegramGatewaySettings(input)`
- `testTelegramBot()`
- `createTelegramGroupPairingCode()`
- `getProjectTelegramGateway(projectSlug)`
- `createProjectTelegramPairingCode(projectSlug)`
- `resetProjectTelegramSession(projectSlug)`
- `unpairProjectTelegram(projectSlug)`

- [ ] **Step 4: Run tests**

Run: `cd tracker && npx vitest run src/services/__tests__/gateways.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/types/gateways.ts \
        tracker/src/services/gateways.ts \
        tracker/src/services/__tests__/gateways.test.ts
git commit -m "feat(gateways): add tracker gateway services"
```

---

## Task 11: Global Gateways Settings UI

**Files:**
- Create: `tracker/src/pages/GatewaysSettingsPage.tsx`
- Create: `tracker/src/components/settings/TelegramGatewaySettingsCard.tsx`
- Modify: `tracker/src/lib/settingsRoutes.ts`
- Modify: `tracker/src/components/settings/SettingsLayout.tsx`
- Modify: `tracker/src/App.tsx`
- Modify: `tracker/locales/en/tracker.json`
- Modify: `tracker/locales/pt-BR/tracker.json`
- Test: `tracker/src/components/settings/__tests__/TelegramGatewaySettingsCard.test.tsx`
- Test: `tracker/src/components/settings/__tests__/SettingsLayout.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add tests asserting:

- Settings nav includes "Gateways".
- `/settings/gateways` renders Telegram card.
- Card loads settings.
- Saving updates enabled, polling, group chat id, user allowlists, DM allowlist, and mention toggle.
- Generate group pairing code displays `/symphony_setup <code>`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd tracker && npx vitest run \
  src/components/settings/__tests__/TelegramGatewaySettingsCard.test.tsx \
  src/components/settings/__tests__/SettingsLayout.test.tsx
```

Expected: FAIL because route/card do not exist.

- [ ] **Step 3: Implement routes and card**

Implementation details:

- `settingsGatewaysPath()` returns `/settings/gateways`.
- `SettingsLayout` adds nav item with a lucide icon such as `MessagesSquare`.
- `App.tsx` adds `<Route path="gateways" element={<GatewaysSettingsPage />} />`.
- `TelegramGatewaySettingsCard` uses controlled inputs:
  - enabled checkbox
  - polling enabled checkbox
  - bot token configured status and credential input action through existing credential service or `updateCredential("telegram", "bot_token", value)`
  - test bot button
  - group chat id display
  - allowed user ids textarea, one id per line
  - DM allowed user ids textarea, one id per line
  - require mention checkbox
  - generate group pairing code button

- [ ] **Step 4: Run UI tests**

Run the test command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/pages/GatewaysSettingsPage.tsx \
        tracker/src/components/settings/TelegramGatewaySettingsCard.tsx \
        tracker/src/lib/settingsRoutes.ts \
        tracker/src/components/settings/SettingsLayout.tsx \
        tracker/src/App.tsx \
        tracker/locales/en/tracker.json \
        tracker/locales/pt-BR/tracker.json \
        tracker/src/components/settings/__tests__/TelegramGatewaySettingsCard.test.tsx \
        tracker/src/components/settings/__tests__/SettingsLayout.test.tsx
git commit -m "feat(gateways): add telegram settings UI"
```

---

## Task 12: Project Integrations Settings UI

**Files:**
- Create: `tracker/src/components/projects/ProjectTelegramIntegrationCard.tsx`
- Modify: `tracker/src/lib/workspaceRoutes.ts`
- Modify: `tracker/src/components/projects/ProjectConfigEditor.tsx`
- Modify: `tracker/locales/en/tracker.json`
- Modify: `tracker/locales/pt-BR/tracker.json`
- Test: `tracker/src/components/projects/__tests__/ProjectTelegramIntegrationCard.test.tsx`
- Test: `tracker/src/lib/__tests__/workspaceRoutes.test.ts`

- [ ] **Step 1: Write failing tests**

Tests should assert:

- `resolveProjectSettingsTab("integrations")` returns `"integrations"`.
- `projectSettingsPath("demo", "integrations")` returns `/projects/demo/settings/integrations`.
- Project editor shows an Integrations tab.
- Telegram card loads current project binding.
- Pairing code action displays `/symphony_pair <code>`.
- Reset and unpair require confirmation before calling services.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd tracker && npx vitest run \
  src/components/projects/__tests__/ProjectTelegramIntegrationCard.test.tsx \
  src/lib/__tests__/workspaceRoutes.test.ts
```

Expected: FAIL because integrations tab/card do not exist.

- [ ] **Step 3: Implement project integrations UI**

Modify `workspaceRoutes.ts`:

```ts
export const PROJECT_SETTINGS_TABS = ["general", "tracker", "workflow", "dev", "integrations"] as const;
```

Modify `ProjectConfigEditor.tsx`:

- Add `Plug` or `MessagesSquare` icon to `SECTION_DEFS`.
- Add `<TabsContent value="integrations">`.
- Render `<ProjectTelegramIntegrationCard projectSlug={project.slug} />`.

Card behavior:

- Shows global configured state.
- Shows current paired `threadId`/`conversationId`.
- Default agent select with `codex`, `claude`, `cursor`.
- Default mode select with `explore`, `project`, `issue`, `kb`; no `freeform` for project topics.
- Generate pairing code button.
- Reset topic session button with typed confirmation text equal to project slug.
- Unpair button with confirmation.

- [ ] **Step 4: Run tests**

Run the test command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/projects/ProjectTelegramIntegrationCard.tsx \
        tracker/src/lib/workspaceRoutes.ts \
        tracker/src/components/projects/ProjectConfigEditor.tsx \
        tracker/locales/en/tracker.json \
        tracker/locales/pt-BR/tracker.json \
        tracker/src/components/projects/__tests__/ProjectTelegramIntegrationCard.test.tsx \
        tracker/src/lib/__tests__/workspaceRoutes.test.ts
git commit -m "feat(gateways): add project telegram integration settings"
```

---

## Task 13: Documentation and Full Validation

**Files:**
- Modify: `elixir/README.md`
- Modify: `SPEC.md`
- Modify: `.env.example` if Telegram env fallback is introduced

- [ ] **Step 1: Update documentation**

Add to `elixir/README.md`:

- BotFather setup.
- Telegram token storage through Settings > Gateways.
- Group pairing with `/symphony_setup <code>`.
- Project topic pairing with `/symphony_pair <code>`.
- Direct 1:1 DM freeform chat allowlist.
- Commands:
  - `/help`, `/ajuda`
  - `/status`, `/estado`
  - `/agent`, `/agente`
  - `/mode`, `/modo`
  - `/new`, `/novo`, `/reset`
  - `/stop`, `/parar`
  - `/setup`, `/configurar`

- [ ] **Step 2: Run backend targeted tests**

Run:

```bash
cd elixir && mix test \
  test/symphony_elixir/settings/gateways_test.exs \
  test/symphony_elixir/gateways_test.exs \
  test/symphony_elixir/gateways/command_parser_test.exs \
  test/symphony_elixir/gateways/session_resolver_test.exs \
  test/symphony_elixir/gateways/router_test.exs \
  test/symphony_elixir/gateways/router_dispatch_test.exs \
  test/symphony_elixir/telegram_gateway/normalizer_test.exs \
  test/symphony_elixir/telegram_gateway/sender_test.exs \
  test/symphony_elixir/telegram_gateway/poller_test.exs \
  test/symphony_elixir_web/controllers/tracker/gateway_controller_test.exs \
  test/symphony_elixir_web/controllers/tracker/project_gateway_controller_test.exs
```

Expected: PASS.

- [ ] **Step 3: Run frontend targeted tests**

Run:

```bash
cd tracker && npx vitest run \
  src/services/__tests__/gateways.test.ts \
  src/components/settings/__tests__/TelegramGatewaySettingsCard.test.tsx \
  src/components/settings/__tests__/SettingsLayout.test.tsx \
  src/components/projects/__tests__/ProjectTelegramIntegrationCard.test.tsx \
  src/lib/__tests__/workspaceRoutes.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full gates**

Run:

```bash
cd elixir && mix specs.check && make all
```

Expected: PASS.

Run:

```bash
cd tracker && npm run lint && npx vitest run && npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit docs**

```bash
git add elixir/README.md SPEC.md .env.example
git commit -m "docs(gateways): document telegram gateway setup"
```

---

## Self-Review

### Spec Coverage

- Generic gateway adapter: Tasks 3, 4, 6, 7.
- TelegramGateway implementation: Tasks 4, 8.
- One group and one topic per project: Tasks 2, 6, 9, 12.
- Direct 1:1 freeform chat: Tasks 2, 5, 6, 7, 10, 11.
- Setup and pairing: Tasks 2, 6, 9, 11, 12.
- Commands and Portuguese aliases: Tasks 3, 6, 13.
- Agent selection: Tasks 3, 6, 12.
- Module/mode selection: Tasks 3, 5, 6, 12.
- Reset/new session scoped by topic or direct chat: Tasks 5, 6, 9, 12.
- Settings UI: Tasks 11 and 12.
- Documentation and validation: Task 13.

### Placeholder Scan

This plan avoids unresolved placeholders. Any provider beyond Telegram is intentionally outside this implementation plan, while the generic adapter interfaces needed for those providers are included.

### Type Consistency

- Backend mode values are consistently `"explore" | "project" | "issue" | "kb" | "freeform"`.
- Backend binding kinds are consistently `"project_topic" | "direct_freeform"`.
- Frontend gateway mode and binding DTOs mirror backend names through service normalization.
- Telegram topic conversation ids use `<chat_id>:topic:<message_thread_id>`.
- Telegram direct conversation ids use `dm:<chat_id>`.
