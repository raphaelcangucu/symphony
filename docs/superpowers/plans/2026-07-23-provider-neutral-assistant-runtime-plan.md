# Provider-Neutral Assistant Runtime Implementation Plan

**Goal:** Replace Codex-shaped assistant lifecycle contracts with one strict provider-neutral conversation, run, capability, error, and durable-queue contract, migrate persisted legacy data, and expose the same operations through one multi-provider CLI.

**Architecture:** The Symphony assistant thread remains the stable internal aggregate. Provider conversation IDs live behind a typed `ConversationRef` and a flat `provider_bindings` persistence map; every adapter emits a strict canonical `RunResult`. `History` owns durable run and queue state, while `TurnManager` owns only live processes and coordinates that durable state. A data migration consumes and then drops legacy identity columns; runtime code has no alias or silent-resume fallback.

**Tech Stack:** Elixir 1.19, OTP 28, Ecto/SQLite, Phoenix Channels, ExUnit, React/TypeScript, Vitest.

---

## File Structure

**Create:**

- `elixir/lib/symphony_elixir/agent/backend_capabilities.ex` — provider capability contract.
- `elixir/lib/symphony_elixir/agent/conversation_ref.ex` — stable provider/conversation-ID value object.
- `elixir/lib/symphony_elixir/agent/run_result.ex` — canonical backend turn result.
- `elixir/lib/symphony_elixir/agent/error.ex` — normalized public and persisted error taxonomy.
- `elixir/priv/repo/migrations/20260717110000_add_provider_bindings_to_assistant_threads.exs` — compatible persistence migration ordered before schema-dependent transcript seeding.
- Unit tests for each new agent contract module.

**Modify:**

- `elixir/lib/symphony_elixir/coding_agent.ex` and four backend adapters — advertise capabilities and normalize provider-specific resume/result data at the adapter boundary.
- `elixir/lib/symphony_elixir/assistant/thread.ex` and `history.ex` — flat provider bindings, generic current-run identity, and durable pending-turn queue.
- `elixir/lib/symphony_elixir/assistant/agent_session.ex` — consume `ConversationRef`/`RunResult`, eliminate Codex-shaped generic normalization, normalize workspace errors.
- `elixir/lib/symphony_elixir/assistant/turn_manager.ex` — generic run identity APIs and durable queue coordination.
- `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` — generic run naming and canonical payloads.
- `tracker/src/services/phoenix/assistantChannel.ts` — expose provider/conversation/run/execution/error/queue data.
- Existing focused ExUnit and Vitest files — regression and compatibility coverage.

## Task 1: Canonical backend contracts

**Files:**

- Create the four `elixir/lib/symphony_elixir/agent/*.ex` modules listed above.
- Create `elixir/test/symphony_elixir/agent/backend_capabilities_test.exs`.
- Create `elixir/test/symphony_elixir/agent/conversation_ref_test.exs`.
- Create `elixir/test/symphony_elixir/agent/run_result_test.exs`.
- Create `elixir/test/symphony_elixir/agent/error_test.exs`.

- [x] **Step 1: Write failing contract tests**

```elixir
assert {:ok, ref} = ConversationRef.new("claude", "session-1")
assert ConversationRef.dump(ref) == %{"provider" => "claude", "conversation_id" => "session-1"}
assert {:ok, result} = RunResult.normalize("cursor", %{conversation_id: "chat", run_id: "run", assistant_message: "done"})
assert result.conversation_id == "chat"
assert Error.normalize({:workspace_symlink_escape, "/bad", "/root"}).code == "workspace_not_executable"
assert BackendCapabilities.for("codex").steer
refute BackendCapabilities.for("opencode").native_goal
```

- [x] **Step 2: Run the four files and verify RED because the modules do not exist.**
- [x] **Step 3: Implement strict constructors, dump/load functions, provider result precedence, and stable error codes.**
- [x] **Step 4: Re-run and verify GREEN.**

## Task 2: Advertise backend capabilities at the adapter boundary

**Files:**

- Modify `elixir/lib/symphony_elixir/coding_agent.ex`.
- Modify `elixir/lib/symphony_elixir/{codex,claude,cursor,opencode}/coding_agent.ex`.
- Modify/create focused coding-agent tests.

- [x] **Step 1: Write failing tests asserting `CodingAgent.capabilities/1` for all four providers.**
- [x] **Step 2: Verify RED because the callback and facade function are absent.**
- [x] **Step 3: Add the `capabilities/0` callback and implementations. Keep capability policy data-only.**
- [x] **Step 4: Verify GREEN.**

## Task 3: Persist canonical provider bindings

**Files:**

- Create `elixir/priv/repo/migrations/20260717110000_add_provider_bindings_to_assistant_threads.exs`.
- Modify `elixir/lib/symphony_elixir/assistant/thread.ex`.
- Modify `elixir/lib/symphony_elixir/assistant/history.ex`.
- Modify `elixir/test/symphony_elixir/assistant/history_test.exs`.

- [x] **Step 1: Write failing tests for `put_conversation_ref/2`, `conversation_ref/2`, flat storage, and rejection of nested compatibility values.**
- [x] **Step 2: Verify RED because the API/field is absent.**
- [x] **Step 3: Add `provider_bindings` (`map`, default `%{}`), backfill it from `agent_thread_ids` and `codex_thread_id`, and implement the new API.**
- [x] **Step 4: Remove `agent_thread_id/2`, `put_agent_thread_id/3`, and legacy schema fields after the data migration.**
- [x] **Step 5: Run migrations and tests; verify GREEN.**

## Task 4: Normalize AgentSession input and output

**Files:**

- Modify `elixir/lib/symphony_elixir/assistant/agent_session.ex`.
- Modify `elixir/lib/symphony_elixir/coding_agent.ex`.
- Modify `elixir/test/symphony_elixir/assistant/agent_session_test.exs`.

- [x] **Step 1: Write failing tests that resume Codex and Claude from the same `ConversationRef` API and return a canonical `RunResult`.**
- [x] **Step 2: Write a failing regression test that maps a symlink escape to `{:authoring_goal_unavailable, :workspace_not_executable}` before it crosses the public session boundary.**
- [x] **Step 3: Verify RED for the new contract and the existing workspace-ordering failure.**
- [x] **Step 4: Route provider-specific resume flags through `CodingAgent` and canonicalize provider results once.**
- [x] **Step 5: Persist only `provider`, `conversation_id`, `run_id`, and `execution_id`.**
- [x] **Step 6: Normalize workspace validation/provisioning errors at the public boundary.**
- [x] **Step 7: Verify GREEN.**

## Task 5: Generic durable current-run identity

**Files:**

- Modify `elixir/lib/symphony_elixir/assistant/history.ex`.
- Modify `elixir/lib/symphony_elixir/assistant/turn_manager.ex`.
- Modify `elixir/test/symphony_elixir/assistant/{history,turn_manager}_test.exs`.

- [x] **Step 1: Write failing tests for current-run keys `provider`, `conversation_id`, `run_id`, and `execution_id`.**
- [x] **Step 2: Verify RED because only Codex-shaped fields exist.**
- [x] **Step 3: Add `note_run_identity/2` and derive `execution_id` independently from provider IDs.**
- [x] **Step 4: Replace and remove Codex-specific turn APIs.**
- [x] **Step 5: Make finish persistence consume canonical `RunResult` identities.**
- [x] **Step 6: Verify GREEN and existing lifecycle compatibility tests.**

## Task 6: Durable pending-turn queue

**Files:**

- Modify `elixir/lib/symphony_elixir/assistant/history.ex`.
- Modify `elixir/lib/symphony_elixir/assistant/turn_manager.ex`.
- Modify `elixir/test/symphony_elixir/assistant/{history,turn_manager}_test.exs`.

- [x] **Step 1: Write failing tests that queue two prompts, reload the thread, preserve FIFO order, and expose `queued_count`.**
- [x] **Step 2: Write a failing test proving a manager process restart does not erase queued intent.**
- [x] **Step 3: Verify RED because queue state currently exists only in the GenServer map.**
- [x] **Step 4: Add atomic `enqueue_pending_turn/2`, `pending_turns/1`, and `take_pending_turn/1` APIs in `History`. Persist only serializable intent fields and a generated queue ID.**
- [x] **Step 5: Make `TurnManager.enqueue/3` persist before accepting, mirror live closures in memory, and remove durable intent only after a turn has been successfully moved into `current_turn`.**
- [x] **Step 6: On boot, preserve pending turns while reconciling orphaned active turns; expose queue state for explicit recovery/reconnect instead of silently losing it.**
- [x] **Step 7: Verify GREEN.**

## Task 7: Stable errors and capability-aware control

**Files:**

- Modify `elixir/lib/symphony_elixir/assistant/history.ex`.
- Modify `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex`.
- Modify relevant assistant channel tests.

- [x] **Step 1: Write failing tests for stable error payloads (`code`, `category`, `retryable`, `message`) and unsupported steer/goal actions.**
- [x] **Step 2: Verify RED.**
- [x] **Step 3: Persist normalized error maps and use backend capabilities before native controls.**
- [x] **Step 4: Return machine-readable errors and fail stale conversation resume explicitly.**
- [x] **Step 5: Verify GREEN.**

## Task 8: Provider-neutral UI lifecycle payload

**Files:**

- Modify `tracker/src/services/phoenix/assistantChannel.ts`.
- Modify `tracker/src/services/phoenix/__tests__/assistantChannel.test.ts`.

- [x] **Step 1: Write a failing Vitest case that normalizes `provider`, `conversation_id`, `run_id`, `execution_id`, `queued_count`, and structured error.**
- [x] **Step 2: Verify RED because the fields are discarded.**
- [x] **Step 3: Extend `AssistantTurnStatus` and its normalizer with only the canonical identity fields.**
- [x] **Step 4: Verify GREEN.**

## Task 9: Codex goal lifecycle regression

**Files:**

- Modify `elixir/test/symphony_elixir/codex/coding_agent_test.exs`.
- Modify `elixir/lib/symphony_elixir/codex/coding_agent.ex` only if the regression proves production behavior is wrong.

- [x] **Step 1: Run the isolated existing goal test and preserve the observed `:epipe` RED evidence.**
- [x] **Step 2: Update the fake provider lifecycle so it remains available for the authoritative post-turn goal read, or make production return a stable provider-disconnected error if the real lifecycle is wrong.**
- [x] **Step 3: Run the full Codex coding-agent test file and verify GREEN.**

## Task 10: Documentation and final verification

**Files:**

- Modify `elixir/README.md`.
- Modify `SPEC.md` if the assistant lifecycle contract is described there.
- Update this plan's checkboxes.

- [x] **Step 1: Document the identity model, compatibility fields, provider capabilities, queue recovery semantics, and error schema.**
- [x] **Step 2: Run `mix format`, focused ExUnit suites, `mix specs.check`, and the relevant tracker Vitest file.**
- [x] **Step 3: Run `make all` from `elixir`; address failures caused by this change and report unrelated pre-existing warnings separately.**
- [x] **Step 4: Review `git diff` to ensure unrelated dirty files were preserved and no generated dependency/build files were added.**

## Task 11: Standalone multi-agent binary client

**Files:**

- Create `elixir/lib/symphony_elixir/agent/client.ex`.
- Create `elixir/lib/symphony_elixir/agent/cli.ex`.
- Create focused client and CLI tests.
- Modify `elixir/lib/symphony_elixir/cli.ex` and assistant standalone runner boundary.

- [x] **Step 1: Write failing tests for provider listing, capabilities, canonical run output, stable errors, resume/model options, and Symphony-owned execution IDs.**
- [x] **Step 2: Verify RED because the client and subcommand do not exist.**
- [x] **Step 3: Implement `symphony agent providers|capabilities|run|steer|goal` on the packaged escript.**
- [x] **Step 4: Reuse `ConversationRef`, `BackendCapabilities`, `RunResult`, and `Agent.Error`; do not introduce parallel contracts.**
- [x] **Step 5: Build the escript and verify real provider/capability commands plus focused tests.**
- [x] **Step 6: Document CLI invocation, continuation, output, errors, and safety modes.**

## Task 12: Remove identity fallbacks and migrate legacy databases

**Files:**

- Create `elixir/priv/repo/migrations/20260717115000_canonicalize_assistant_identity.exs`.
- Modify the shared assistant runtime, provider adapters, channel payloads, frontend DTOs, tests,
  and documentation.

- [x] **Step 1: Make `ConversationRef`, `RunResult`, messages, and lifecycle payloads accept only `provider`, `conversation_id`, `run_id`, and `execution_id`.**
- [x] **Step 2: Remove runtime reads/writes of `agent_thread_ids`, `codex_thread_id`, `turn_id`, and `session_id` aliases.**
- [x] **Step 3: Remove silent fresh-session and cross-provider log fallbacks.**
- [x] **Step 4: Backfill flat provider bindings and current-turn identities, rename message `turn_id` to `run_id`, and drop legacy columns.**
- [x] **Step 5: Validate both a representative legacy-data upgrade and a completely fresh migration.**
- [x] **Step 6: Route CLI `run`, `steer`, and portable `goal` through the single `Client.execute/2` contract.**
- [x] **Step 7: Normalize provider-name casing, prefer canonical duplicate bindings, remove invalid providers, and eliminate `current_turn.agent_kind`.**

## Task 13: Review hardening and single-name enforcement

- [x] **Step 1: Make resume require a matching persisted provider/conversation identity and preserve resume failure instead of opening a fresh conversation.**
- [x] **Step 2: Use the active turn provider for steer capability checks and the queued item provider during recovery.**
- [x] **Step 3: Add optimistic compare-and-swap retries for metadata and provider binding mutations so stale writers preserve unrelated changes.**
- [x] **Step 4: Move durable queue removal into the same transition that creates `current_turn`, preventing duplicate recovery workers.**
- [x] **Step 5: Return one exact channel/client error shape and remove the frontend `reason` fallback.**
- [x] **Step 6: Replace persisted/runtime `generation` and queued `agent_kind` aliases with the sole `execution_id` and `provider` fields.**
- [x] **Step 7: Migrate legacy current and queued turns, then validate representative legacy and fresh SQLite databases.**
- [x] **Step 8: Backfill gateway default providers and enforce the supported-provider set with SQLite insert/update triggers.**
- [x] **Step 9: Make every CLI argument and execution failure use the exact five-field `Agent.Error` payload.**
- [x] **Step 10: Eliminate cross-run temporary-workspace collisions from provider adapter tests.**
- [x] **Step 11: Route preferences and Goal metadata through the same optimistic CAS/retry path so stale writers cannot erase current or queued turns.**
