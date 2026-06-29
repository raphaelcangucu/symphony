# Telegram Project Topics Gateway - Design

> Add a Telegram gateway to Symphony so operators can talk to the maestro from
> Telegram. Each project can be paired with one topic in a shared Telegram group,
> and 1:1 direct messages with the bot act as a general freeform chat. Project
> topic messages talk to an independent maestro session scoped to that
> project/topic; direct messages talk to an independent freeform session scoped
> to that Telegram user/chat. The first implementation is Telegram-only, but the
> routing surface is a generic gateway adapter so future providers such as
> WhatsApp, Discord, or Slack can plug into the same session and command flow.

## 1. Problem

Symphony's project assistant already has the right backend primitives for a
project-scoped maestro:

- `assistant_threads` persists durable conversations with scopes such as
  `project`, `project_explore`, `issue`, `freeform`, and `kb`.
- `AssistantChannel` exposes `assistant:explore:<project_slug>` for the project
  explore assistant and routes turns through `CodexSession.send_message_to_project_explore_thread/4`.
- `TurnManager` owns durable turn lifecycle, steering, interruption, and
  re-attach after refresh.
- `ProjectExploreWorkspace` prepares a project-level workspace with the
  project's repositories checked out on integration branches.

What Symphony does not have is an external chat gateway that can receive a
Telegram group-topic or direct-message update, identify the owning project or
direct freeform session, choose the active maestro mode and agent, run the
correct assistant session, and deliver the reply back to the same Telegram
conversation.

The desired v1 product shape is intentionally focused:

- One Telegram group per Symphony instance.
- Each project can be associated with exactly one Telegram forum topic inside
  that group.
- Each topic has its own independent maestro session.
- A direct 1:1 chat with the bot works as a general freeform assistant session,
  independent from project topics.
- Commands inside the topic or direct chat can choose the agent, choose the
  maestro module where applicable, reset/start a new session, stop an active
  turn, and inspect status.
- Settings UI must support bot setup/pairing, DM access, and project-topic
  configuration.

## 2. OpenClaw Reference

OpenClaw's Telegram implementation provides the useful reference pattern:

- It uses Telegram Bot API via `grammY`.
- Long polling is the default transport; webhook mode is optional.
- A group/forum topic is identified by `chat_id` plus `message_thread_id`.
- Topic-scoped conversation ids are canonicalized as
  `<chat_id>:topic:<message_thread_id>`.
- Session keys include the topic id so different topics in the same group do
  not share memory or in-flight work.
- Telegram sends back into the same topic by passing `message_thread_id`.
- Group/topic config can override activation, allowed senders, mention rules,
  skills/system prompt, and agent routing.
- Processing is serialized by chat/topic so two user messages in the same topic
  do not race the same session.
- Commands such as status, setup, routing, and session controls are handled as
  native channel commands before the message is sent to the agent.

Symphony should copy those concepts, not the full OpenClaw surface. The
implementation should stay idiomatic to the existing Elixir/Phoenix assistant
architecture.

## 3. Goals

1. Add a Telegram gateway that can receive messages from a configured group
   topic and respond in the same topic.
2. Pair each Symphony project with one Telegram topic in a single configured
   group.
3. Support direct 1:1 Telegram messages with the bot as freeform assistant
   chats, scoped by Telegram direct chat/sender.
4. Run every topic message against a session scoped by the topic id, not by the
   whole Telegram group.
5. Reuse existing Symphony assistant/session primitives instead of introducing
   a second agent runtime.
6. Provide Telegram commands for agent selection, maestro module selection,
   session reset/new-session, stop, status, help, and setup/pairing.
7. Add a generic gateway adapter boundary so future gateways can reuse the same
   routing, command handling, and session lifecycle.
8. Add settings UI for global Telegram bot setup, DM access policy, and
   per-project topic binding.
9. Fail closed: no unpaired topic, unknown user, unauthorized DM, or unknown
   group should reach an agent turn.

## 4. Non-Goals

- No WhatsApp, Discord, Slack, or other provider implementation in this phase.
  The generic adapter exists so those providers can be added later.
- No multi-group Telegram support in v1. The data model should not make it
  impossible, but the UI and validation target one group.
- No automatic Telegram topic creation in v1. Users can create topics in
  Telegram and pair them with Symphony. Topic creation can come later.
- No arbitrary public bot mode. Access must be configured or paired.
- No external-channel replacement for the tracker UI. Telegram is a companion
  surface; tracker remains the canonical management UI.
- No broad rework of `ProjectAssistantPanel` or Phoenix channel streaming.
  Gateway delivery should use backend callbacks into the same assistant logic.

## 5. Confirmed Decisions

The user-confirmed decisions for v1 are:

- **Provider scope:** implement Telegram first.
- **Gateway architecture:** add a generic gateway adapter/router layer now,
  even though Telegram is the only concrete gateway in this phase.
- **Telegram topology:** one group per Symphony instance.
- **Project binding:** each project maps to exactly one topic in that group.
- **Session isolation:** the active session is scoped by topic id.
- **Direct messages:** 1:1 Telegram chats with the bot are supported as
  freeform assistant sessions scoped by the Telegram direct chat/sender.
- **Module meaning:** "module" means maestro mode, such as project exploration,
  project/tracker assistant, issue assistant, or KB assistant.
- **Setup:** include bot setup/pairing flow, not just raw config fields.
- **Settings:** expose both global bot setup and per-project topic binding in
  the UI.

## 6. Architecture

The design has three layers.

### 6.1 Generic Gateway Layer

Create a provider-neutral gateway boundary under `SymphonyElixir.Gateways`.

Core modules:

- `SymphonyElixir.Gateways.Adapter`
  - Behaviour implemented by each provider adapter.
  - Normalizes provider-specific updates into common inbound events.
  - Sends outbound replies, typing/progress cues, and command responses through
    the provider.
- `SymphonyElixir.Gateways.Router`
  - Receives normalized inbound messages from any adapter.
  - Resolves the gateway binding.
  - Applies access control.
  - Dispatches native commands.
  - Starts, steers, queues, interrupts, or resets the selected assistant session.
- `SymphonyElixir.Gateways.CommandParser`
  - Parses command text independently of Telegram-specific syntax where
    possible.
  - Returns typed commands such as `{:set_agent, "claude"}` or
    `{:set_mode, %{mode: "issue", issue_identifier: "MAC-1"}}`.
- `SymphonyElixir.Gateways.SessionResolver`
  - Maps a binding and selected module to an assistant thread.
  - Starts the correct `CodexSession` function.
  - Maintains the active thread id for the topic/mode.
- `SymphonyElixir.Gateways.Binding`
  - Ecto schema for provider conversation bindings.

The generic adapter should not know Telegram concepts such as
`message_thread_id`. It should operate on normalized conversation fields:

- `provider`: `"telegram"` for v1.
- `account_id`: `"default"` for v1.
- `conversation_id`: canonical provider conversation id. For Telegram topics,
  this is `<chat_id>:topic:<message_thread_id>`. For Telegram direct chats, this
  is `dm:<chat_id>`.
- `parent_conversation_id`: the parent group id for topic-capable providers.
- `thread_id`: provider thread/topic id when present.
- `conversation_kind`: `"direct" | "group" | "topic"`.
- `sender_id`, `sender_name`, `raw_text`, `message_id`, `reply_to_message_id`.
- `metadata`: provider-specific facts retained for diagnostics.

### 6.2 Telegram Adapter and TelegramGateway

Implement Telegram in two modules:

- `SymphonyElixir.TelegramGateway`
  - Provider-specific Telegram Bot API client and update normalizer.
  - Handles long polling in v1.
  - Verifies token with `getMe`.
  - Sends `sendMessage`, `sendChatAction`, and optional message edits later.
  - Canonicalizes topic ids using `chat_id` and `message_thread_id`.
  - Canonicalizes direct-message ids as `dm:<chat_id>`.
- `SymphonyElixir.Gateways.TelegramAdapter`
  - Implements `SymphonyElixir.Gateways.Adapter`.
  - Delegates provider-specific work to `TelegramGateway`.
  - Keeps the generic gateway router free of Telegram Bot API details.

Use the existing `req` dependency for Telegram HTTP calls. Avoid adding a bot
framework dependency in v1 unless long polling complexity becomes excessive.
The v1 update loop can be an OTP worker supervised by the application:

- `TelegramGateway.Poller` calls `getUpdates` with an offset.
- Accepted updates are normalized and handed to `Gateways.Router`.
- Offset is persisted after the router has accepted the message or decided to
  drop it.
- Only one poller may run for a configured token.

Webhook mode should be a documented future extension. The adapter API should
not assume polling; it should accept normalized updates from either polling or
webhook delivery.

### 6.3 Assistant Session Layer

Telegram should not create a separate agent runtime. It should reuse existing
assistant flows:

- `mode = "explore"` uses the project explore prompt and project explore
  workspace.
- `mode = "project"` uses the project assistant prompt/tools.
- `mode = "issue"` uses an issue assistant thread for a selected issue
  identifier.
- `mode = "kb"` uses a KB assistant thread for a selected repository/page.
- `mode = "freeform"` uses a freeform assistant thread and is the only default
  module for direct 1:1 bot chats.

The default mode for a new project-topic binding is `explore`, matching the
requested "maestro in exploration mode per project".

The default mode for a new direct-message binding is `freeform`, matching the
requested "general chat" behavior.

To support reset/new-session scoped by topic id, add a gateway-aware thread
association instead of relying only on the existing single active
`project_explore` thread per project. The binding stores the active assistant
thread for the selected module. Reset archives or detaches that thread and
creates a new one for the same binding/topic or direct chat.

The session resolver should reuse existing prompt builders/runners where
possible. If existing functions are too tightly coupled to Phoenix channels,
extract shared helpers rather than duplicating prompt text.

## 7. Data Model

### 7.1 Global Gateway Settings

Add a settings group for gateway-level configuration. For Telegram v1:

- `gateways.telegram.enabled`
- `gateways.telegram.bot_token` or encrypted credential reference
- `gateways.telegram.bot_username`
- `gateways.telegram.group_chat_id`
- `gateways.telegram.allowed_user_ids`
- `gateways.telegram.dm_policy`
- `gateways.telegram.dm_allowed_user_ids`
- `gateways.telegram.require_mention`
- `gateways.telegram.polling_enabled`
- `gateways.telegram.last_setup_at`

Token storage must follow the existing provider credential pattern. Do not
store bot tokens in project workflow markdown.

### 7.2 Gateway Bindings

Create a persisted `gateway_bindings` table.

Fields:

- `provider`: string, e.g. `"telegram"`.
- `account_id`: string, default `"default"`.
- `project_slug`: string, required for project-bound bindings.
- `binding_kind`: `"project_topic" | "direct_freeform"`.
- `conversation_id`: canonical provider conversation id.
- `parent_conversation_id`: group id for Telegram topics.
- `thread_id`: topic/thread id, e.g. Telegram `message_thread_id`.
- `sender_id`: direct-chat Telegram user id for `direct_freeform` bindings.
- `status`: `"active" | "disabled" | "archived"`.
- `default_agent_kind`: optional `"codex" | "claude" | "cursor"`.
- `default_mode`: `"explore" | "project" | "issue" | "kb" | "freeform"`.
- `active_mode`: same enum; mutable via `/mode`.
- `active_issue_identifier`: nullable, used by issue mode.
- `active_kb_repo_slug`: nullable, used by KB mode.
- `active_kb_page_path`: nullable, used by KB mode.
- `active_thread_id`: nullable FK to `assistant_threads`.
- `metadata`: map for provider-specific data such as topic name and paired user.

Indexes:

- Unique active binding on `(provider, account_id, conversation_id)` where
  `status = 'active'`.
- Unique active Telegram topic per project on `(provider, project_slug)` where
  `status = 'active'` and `binding_kind = 'project_topic'` for v1.
- Unique active direct binding on `(provider, account_id, sender_id)` where
  `status = 'active'` and `binding_kind = 'direct_freeform'`.
- Lookup index on `(provider, account_id, parent_conversation_id, thread_id)`.

This model supports the v1 rule of one topic per project and one freeform direct
session per Telegram sender while still giving future providers a
provider-neutral binding table.

### 7.3 Assistant Threads

Reuse existing assistant thread scopes (`project_explore`, `project`, `issue`,
`kb`, `freeform`) and store the active thread id on `gateway_bindings`.

This is enough for v1 because each project has exactly one Telegram topic. If a
future release allows one project to have multiple external conversations,
introduce a gateway-specific thread scope or `gateway_binding_id` column before
enabling that product shape.

## 8. Setup and Pairing Flow

### 8.1 Global Bot Setup

Add a "Gateways" or "Telegram" section in global Settings.

The Telegram setup card should guide the operator through:

1. Paste bot token from BotFather.
2. Click "Test bot" to call Telegram `getMe`.
3. Store bot username and token source on success.
4. Start or restart polling.
5. Generate a one-time group pairing code.
6. In Telegram, send `/symphony_setup <code>` in the target group.
7. Symphony captures `chat.id`, validates the code, and stores it as the global
   Telegram group.

Until the global group is paired, the gateway should ignore all normal messages
and only accept setup commands carrying a valid pairing code.

Direct-message access is configured in the same global setup card. V1 supports a
fail-closed allowlist policy for DMs: a direct message can start or continue a
freeform chat only when the sender id is present in `dm_allowed_user_ids`.
Pairing-code based DM approval can be added later, but v1 keeps DM access
durable and explicit in settings.

### 8.2 Project Topic Pairing

Add a Telegram card in project settings.

The project pairing flow:

1. User opens `/projects/:slug/settings/integrations`.
2. User clicks "Pair Telegram topic".
3. Symphony creates a short-lived pairing code bound to the project slug.
4. User sends `/symphony_pair <code>` inside the desired Telegram forum topic.
5. TelegramGateway normalizes the update and passes it to the generic router.
6. The router validates:
   - Telegram is globally configured.
   - `chat.id` matches the configured group.
   - `message_thread_id` is present.
   - Pairing code is valid and unexpired.
   - The topic is not already bound to another active project.
7. The router creates or updates the active `gateway_bindings` row.
8. Symphony replies in-topic with project name, active mode, selected agent, and
   useful commands.

If a message arrives in the general topic or a non-topic group message, the
gateway should reject pairing with a clear response: project binding requires a
forum topic.

### 8.3 Direct Freeform Chat

Direct 1:1 messages with the bot do not require project-topic pairing. They use
the global Telegram bot setup and the DM allowlist.

The direct-message flow:

1. User sends a direct message to the bot.
2. `TelegramGateway` normalizes the update with `conversation_kind = "direct"`
   and `conversation_id = "dm:<chat_id>"`.
3. The router validates Telegram is enabled and the sender is allowed by
   `dm_allowed_user_ids`.
4. The router finds or creates a `gateway_bindings` row with
   `binding_kind = "direct_freeform"` and `active_mode = "freeform"`.
5. The router resolves or creates a freeform assistant thread.
6. The message is sent to the freeform assistant.
7. The response is delivered back to the direct chat.

Direct freeform chats support `/help`, `/status`, `/agent`, `/new`, `/reset`,
`/stop`, and their Portuguese aliases. Project-only modes are not available in
DM by default. If a user tries `/mode explore`, `/mode issue`, or `/mode kb` in
DM, the bot responds that those modes require a paired project topic.

## 9. Commands

Commands are handled before sending content to the assistant. Command names are
provider-neutral after parsing, but Telegram accepts slash-style commands.

Supported v1 commands:

- `/help`
  - Lists commands available in the current topic.
- `/ajuda`
  - Portuguese alias for `/help`.
- `/status`
  - Shows project, topic id, active mode, selected agent, current thread id,
    active turn status, and whether the topic is paired.
- `/estado`
  - Portuguese alias for `/status`.
- `/agent`
  - Shows the current agent and valid values.
- `/agente`
  - Portuguese alias for `/agent`.
- `/agent codex`
  - Sets topic default/active agent to `codex`.
- `/agent claude`
  - Sets topic default/active agent to `claude`.
- `/agent cursor`
  - Sets topic default/active agent to `cursor`.
- `/mode`
  - Shows the current maestro mode and examples.
- `/modo`
  - Portuguese alias for `/mode`.
- `/mode explore`
  - Uses the project exploration maestro.
- `/mode project`
  - Uses the project/tracker assistant.
- `/mode issue <identifier>`
  - Uses the issue assistant for the given issue.
- `/mode kb <repo> <path>`
  - Uses the KB assistant for a specific page.
- `/mode freeform`
  - Uses the general freeform assistant. This is the default and only mode for
    direct 1:1 bot chats in v1.
- `/new`
  - Archives/detaches the current active session for this topic and immediately
    starts a new one with the same project, mode, and agent.
- `/novo`
  - Portuguese alias for `/new`.
- `/reset`
  - Alias for `/new`, with wording that makes the destructive session reset
    clear.
- `/stop`
  - Interrupts the active turn for this topic if one is running.
- `/parar`
  - Portuguese alias for `/stop`.
- `/setup`
  - Returns setup help. In unconfigured mode, explains how to pair the group.
- `/configurar`
  - Portuguese alias for `/setup`.
- `/symphony_setup <code>`
  - Completes global group pairing.
- `/symphony_pair <code>`
  - Completes project-topic pairing.
- `/symphony_parear <code>`
  - Portuguese alias for `/symphony_pair <code>`.

Invalid commands should never be sent to the agent. They return a short help
message.

Plain text messages in paired topics are sent to the active maestro mode. If a
turn is already running for the topic, the router should use the same policy as
the UI assistant: steer when possible, otherwise queue.

Plain text messages in allowed direct chats are sent to the active freeform
assistant session. Direct chats use the same running-turn policy: steer when
possible, otherwise queue.

## 10. Access Control

Access control must fail closed.

Global checks:

- Telegram gateway must be enabled.
- Bot token must be configured and verified.
- Incoming `chat.id` must match the configured group id, except during
  one-time setup pairing and direct-message freeform chats.
- Sender id must be allowed by global `allowed_user_ids`, unless the command is
  a setup command carrying a valid one-time pairing code.
- Direct-message sender id must be allowed by `dm_allowed_user_ids`.

Topic checks:

- The topic must be paired to a project before normal commands or messages run.
- The binding must be active.
- If `require_mention` is enabled, non-command group messages must mention the
  bot or reply to a bot message. For v1, commands always bypass mention gating.

Agent safety checks:

- `/agent` only accepts values in Symphony's `AgentPreference`/settings agent
  list.
- `/mode issue <identifier>` must verify the issue belongs to the paired
  project.
- `/mode kb <repo> <path>` must verify the KB page belongs to the paired
  project/repository.
- Reset only affects the active session for the current topic binding.
- In direct chats, reset only affects that direct sender's freeform session.

## 11. Settings UI

### 11.1 Global Settings

Add a global settings navigation item at `/settings/gateways`.

The global Telegram card should show:

- Enabled toggle.
- Bot token input / credential status.
- "Test bot" action with bot username result.
- Polling status: running, stopped, error, last update time.
- Configured group id and pairing status.
- "Generate group pairing code" action.
- Allowed Telegram user ids.
- DM access policy and allowed direct-message user ids.
- Require mention toggle.
- Last error / troubleshooting hint.

### 11.2 Project Settings

Add a project settings tab at `/projects/:slug/settings/integrations`.

The project Telegram card should show:

- Whether global Telegram is configured.
- Current paired topic id and topic name, if paired.
- "Pair this project to a Telegram topic" action.
- Generated pairing command to paste into Telegram.
- Default agent selector.
- Default maestro mode selector.
- Active mode and active agent, if different from defaults.
- "Reset topic session" action, with confirmation.
- "Unpair topic" action, with confirmation.

The project settings form should call regular JSON APIs. Avoid storing this in
workflow markdown; workflow markdown remains orchestrator configuration.

## 12. Runtime Flow

### 12.1 Normal Message

1. Telegram poller receives update.
2. `TelegramGateway` extracts message, chat id, sender id, text, and
   `message_thread_id`.
3. `TelegramAdapter` returns a normalized `GatewayInboundMessage`.
4. `Gateways.Router` resolves active binding by provider/account/conversation.
5. Router applies access control.
6. Router sees plain text, not command.
7. Router resolves active mode and assistant thread.
8. Router starts a tracked turn with Telegram-specific stream callbacks.
9. During the turn, Telegram receives typing/progress cues where practical.
10. Final assistant response is sent to the same `chat_id` and
    `message_thread_id`.

### 12.2 Direct Freeform Message

1. Telegram poller receives direct-message update.
2. `TelegramGateway` extracts message, chat id, sender id, and text.
3. `TelegramAdapter` returns a normalized direct `GatewayInboundMessage`.
4. `Gateways.Router` validates the sender is allowed for DM freeform chat.
5. Router finds or creates the sender's direct freeform binding.
6. Router resolves the active freeform assistant thread.
7. Router starts or steers the freeform turn.
8. Final assistant response is sent back to the same direct chat.

### 12.3 Command

1. Router parses command.
2. Router executes the command without invoking the agent.
3. Router persists any binding/session changes.
4. Adapter sends command result back to the same topic.

### 12.4 Reset/New Session

1. User sends `/new` or `/reset`.
2. Router resolves binding for the current topic or direct chat.
3. If a turn is running, router interrupts it first or returns a clear error
   requiring `/stop`.
4. Router archives/detaches the active thread for that binding.
5. Router clears `active_thread_id`.
6. Router immediately creates a fresh session for the same topic/direct chat and
   replies with the new session id.

## 13. Error Handling

- Telegram API errors should be logged with provider, chat id, topic id, and
  operation, but never log bot tokens.
- Unknown or unpaired topics receive a short setup/pairing hint only if the
  sender is authorized; otherwise they are silently dropped.
- Agent turn failures should send a concise topic reply and keep the session
  resumable when possible.
- Command validation errors should include one actionable example.
- Polling errors should surface in global Settings and logs.
- Pairing codes should expire and be single-use.

## 14. Testing Strategy

Backend tests:

- Telegram update normalization: direct group topic message, missing topic id,
  setup command, project pairing command, direct freeform message.
- Canonical conversation id generation:
  `<chat_id>:topic:<message_thread_id>` and `dm:<chat_id>`.
- Generic command parser for all v1 commands.
- Binding lookup and access control fail-closed cases.
- `/agent` updates binding agent.
- `/mode` updates binding mode and validates required arguments.
- `/new` detaches/archives only the current topic session.
- `/new` in a direct chat detaches/archives only that sender's freeform session.
- Router dispatches plain text to the correct assistant mode.
- Router dispatches allowed direct messages to freeform mode.
- Telegram sender sends replies with the original `message_thread_id`.
- Telegram sender sends direct replies without `message_thread_id`.
- Poller offset persistence after accepted/dropped updates.

Frontend tests:

- Global Settings renders Telegram setup card and setup states.
- Global pairing code generation flow.
- Project settings renders Telegram topic card.
- Project pairing code generation flow.
- Agent/mode selectors persist per-project binding defaults.
- Reset/unpair confirmation states.
- Global Settings renders direct-message allowlist configuration.

Integration tests:

- Use a fake Telegram Bot API server for `getMe`, `getUpdates`, and
  `sendMessage`.
- Verify an inbound topic message produces a `sendMessage` call with the same
  `chat_id` and `message_thread_id`.
- Verify an allowed direct message produces a `sendMessage` call to the same
  direct `chat_id` without `message_thread_id`.
- Verify `/symphony_pair <code>` binds the topic to the project.

## 15. Rollout

1. Ship hidden/off-by-default backend settings and fake Telegram API tests.
2. Add global Telegram setup UI.
3. Add project topic pairing UI.
4. Enable long polling only when global settings are complete.
5. Keep gateway disabled by default.
6. Document BotFather setup, group/forum-topic requirements, and the command
   list in `elixir/README.md` or `SPEC.md`.

## 16. Final Decisions

- `/new` immediately creates a fresh assistant thread for the current topic and
  replies with the new session id. In direct chats, it does the same for that
  direct sender's freeform session.
- English slash commands are canonical, and Portuguese aliases are supported in
  v1 for the common operator commands.
- Pairing uses short-lived one-time codes. A bot mention is not required for
  setup or project-topic pairing commands.
- Direct 1:1 Telegram chats are freeform assistant sessions. Project-specific
  modes require a paired project topic in v1.

## 17. Self-Review

- No placeholders or TODOs remain.
- Scope is focused on one Telegram group, one topic per project, and direct
  freeform chats with explicitly allowed Telegram users.
- The design includes setup/pairing, commands, agent selection, module
  selection, direct freeform chat, and session reset scoped by topic/direct chat.
- The generic adapter exists now but only Telegram is implemented in this phase.
- Global bot configuration and per-project topic binding are both represented in
  settings UI.
- The design avoids storing gateway configuration in workflow markdown.
