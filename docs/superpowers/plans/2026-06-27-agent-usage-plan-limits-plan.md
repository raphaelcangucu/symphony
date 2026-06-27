# Agent Plan Usage & Rate-Limit Windows (Jean `UsagePane` parity)

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. One focused subagent per task with review between tasks. Replace example commands with this repo's real tools (Elixir `mix`, tracker `npm`/`vitest`).

**Goal:** Show the operator how much of each agent's **plan quota** is consumed and when it resets — the rolling **session window** (e.g. Claude Max's ~5h best-model window), the **weekly** window, and any per-model limits — exactly like Jean's `UsagePane` (each window = a progress bar `usedPercent` + a `Resets: <time>` line, plus plan type / credits). This is **plan rate-limit / consumption**, NOT per-run elapsed time (that already exists in `AgentTab`/`GoalPill`/`ObservabilityPage`).

**Why (verified state):**
- The Claude runner **already emits** the rate-limit data and it is currently dropped: `claude/app_server/cli_runner.ex:344-348` turns the CLI's `rate_limit_event` into an `on_event` `%{"method" => "rate_limit", "params" => payload}`, and `claude/coding_agent.ex:232-234` `normalize_rate_limits/1` passes `rate_limits` through on normalized events — but **nothing aggregates it into a usage snapshot or surfaces it**. Token usage/cost is tracked (`usage/update`, `cost_usd`) but only shown as totals in Observability.
- There is **no plan-usage UI**. `github/rate_limit.ex` is GitHub-API only (unrelated).
- Jean's source pattern (reference): a backend `get_codex_usage` returns `{ planType, creditsRemaining, session, weekly, reviews, modelLimits[] }` where each window is `{ usedPercent, resetsAt }`, plus a live `codex-cli:usage-updated` listener and a 5-min refetch (`UsagePane.tsx`, `services/codex-cli.ts:159-205`).

**Architecture:** A normalized `UsageWindow{ kind, used_percent, resets_at }` + `AgentUsageSnapshot{ agent_kind, plan, credits_remaining, windows[], model_limits[], fetched_at }`. An `AgentUsage` store (process-global, TTL'd, like `AgentAvailability`) keyed by `agent_kind`, updated two ways: (1) **passively** — a consumer of the existing Claude `rate_limit` event writes the latest snapshot; (2) **actively** — a periodic/triggered probe for agents that expose a usage query (Codex app-server). A `GET /settings/agents/usage` endpoint returns the per-agent snapshots; a tracker `AgentUsagePanel` renders progress bars + resets in Settings, with an optional compact "nearest reset / % used" pill near the Execution-Control model picker.

**Tech Stack:** Elixir (GenServer/`:persistent_term`, JSON-RPC parsing), Phoenix controller, React 19 + TanStack Query + shadcn/ui, vitest, ExUnit.

---

## File Structure

**Create (backend):**
- `elixir/lib/symphony_elixir/agent_usage.ex` — store + `snapshot/0`, `put/2`, `get/1`, TTL.
- `elixir/lib/symphony_elixir/agent_usage/window.ex` — `UsageWindow`/`Snapshot` structs + `normalize/2` (per-agent payload → normalized).
- `elixir/lib/symphony_elixir_web/controllers/tracker/agent_usage_controller.ex` + route.
- tests: `agent_usage/window_test.exs`, `agent_usage_test.exs`, `agent_usage_controller_test.exs`.

**Modify (backend):**
- The Claude turn-event consumer (where runner `on_event` `"method"` messages are handled downstream — confirm in Task 1; candidates around `claude/coding_agent.ex` run loop / the agent runner event sink) — branch on `"rate_limit"` → `AgentUsage.put("claude", Window.normalize("claude", params))`.
- `elixir/lib/symphony_elixir/codex/coding_agent.ex` — capture the Codex app-server rate-limit/usage message (Task 5) → `AgentUsage.put("codex", ...)`.
- `elixir/lib/symphony_elixir_web/controllers/tracker/router.ex` — `GET /settings/agents/usage`.

**Create (tracker):**
- `tracker/src/types/agent-usage.ts`, `tracker/src/services/agentUsage.ts`.
- `tracker/src/components/settings/AgentUsagePanel.tsx` + `UsageWindowBar.tsx`.
- `tracker/src/hooks/useAgentUsage.ts`.
- tests for service, panel, bar.

**Modify (tracker):**
- `tracker/src/pages/SettingsPage.tsx` — mount `AgentUsagePanel` (next to the Agent Setup panel).
- (optional) `ExecutionControlComposer.tsx` — compact usage pill.
- locales `en` + `pt-BR`.

---

## Task 1: Spike — record the real usage/rate-limit payloads (recorded)

**Files:** Create `docs/superpowers/notes/agent-usage-payloads.md` (scratch).

- [ ] **Step 1: Capture Claude's `rate_limit_event` shape** — run a Claude turn through Symphony with debug logging at `claude/app_server/cli_runner.ex:344` and record the raw `params` (field names: which carry used/limit/percent and reset timestamps; whether there are separate 5h vs weekly entries; units of `resets_at`).
- [ ] **Step 2: Find the downstream `on_event` sink** — trace where the runner's `on_event` callback is provided for Claude turns (the agent runner / session loop) so Task 4 hooks the **single** place that already receives `usage/update`. Record the module + function.
- [ ] **Step 3: Capture Codex usage** — determine how Codex surfaces plan usage in Symphony's app-server stream (token-count / rate-limit messages on the JSON-RPC thread) vs a CLI query. Record the message type/fields (mirror Jean's `get_codex_usage` snapshot: plan, credits, session, weekly, reviews, modelLimits).
- [ ] **Step 4: Record cursor/opencode** — note whether they expose any plan-usage signal (likely none → these agents render "usage unavailable").
- [ ] **Step 5: Commit the note** (no production code yet).

---

## Task 2: UsageWindow / Snapshot structs + normalizer

**Files:** Create `agent_usage/window.ex` + test.

- [ ] **Step 1: Write failing test**

```elixir
test "normalize/2 maps a claude rate-limit payload into session + weekly windows" do
  payload = %{ # shape pinned in Task 1
    "five_hour" => %{"used_percent" => 42.0, "resets_at" => 1_900_000_000},
    "weekly"    => %{"used_percent" => 7.5,  "resets_at" => 1_900_500_000}
  }
  snap = SymphonyElixir.AgentUsage.Window.normalize("claude", payload)
  assert snap.agent_kind == "claude"
  assert Enum.find(snap.windows, &(&1.kind == :session)).used_percent == 42.0
  assert Enum.find(snap.windows, &(&1.kind == :weekly)).resets_at == 1_900_500_000
end

test "normalize clamps used_percent to 0..100 and tolerates missing fields" do
  snap = SymphonyElixir.AgentUsage.Window.normalize("claude", %{"five_hour" => %{"used_percent" => 130}})
  assert Enum.find(snap.windows, &(&1.kind == :session)).used_percent == 100.0
end
```

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/agent_usage/window_test.exs -o`

- [ ] **Step 3: Implement** — `UsageWindow{ kind :: :session | :weekly | :reviews | {:model, String.t()}, used_percent :: float, resets_at :: integer | nil }`, `Snapshot{ agent_kind, plan, credits_remaining, windows, model_limits, fetched_at }`, and `normalize/2` with a per-agent clause (`"claude"`, `"codex"`) using the field names pinned in Task 1; clamp `used_percent` to `0.0..100.0`; missing windows simply omitted.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(usage): UsageWindow/Snapshot structs + normalizer`.

---

## Task 3: AgentUsage store

**Files:** Create `agent_usage.ex` + test.

- [ ] **Step 1: Write failing test** — `put("claude", snapshot)` then `get("claude")` returns it with a `fetched_at`; `snapshot/0` returns a `%{claude: ..., codex: ..., cursor: nil, opencode: nil}` map; entries older than the TTL are reported as stale (`stale: true`) but still returned.

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/agent_usage_test.exs -o`

- [ ] **Step 3: Implement** — back it with `:persistent_term` (mirror `AgentAvailability`) or a small GenServer if you prefer mutation safety; `put/2` stamps `fetched_at = now`; `get/1`/`snapshot/0`; `stale?` against a configurable TTL (default ~10 min). No DB needed for v1 (usage is ephemeral); note a `agent_usage_snapshots` table as a later option if history is wanted.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(usage): AgentUsage in-memory store`.

---

## Task 4: Capture the Claude `rate_limit` event (passive)

**Files:** Modify the Claude `on_event` sink found in Task 1 + test.

- [ ] **Step 1: Write failing test** — feeding a `%{"method" => "rate_limit", "params" => <task-1 payload>}` event through the sink results in `AgentUsage.get("claude")` returning a snapshot with the expected windows. (Drive it at the sink boundary with a captured event, like the existing `usage/update` handling.)

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — in the same place that already consumes `"usage/update"` (so we reuse the live stream, no new transport), add a branch: on `"rate_limit"`, `AgentUsage.put("claude", AgentUsage.Window.normalize("claude", params))`. Keep it best-effort (rescue/log; never break a turn).

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(usage): capture Claude rate-limit windows into AgentUsage`.

---

## Task 5: Capture Codex usage

**Files:** Modify `codex/coding_agent.ex` (or a small `Codex.Usage` helper) + test.

Per Task 1: if the Codex app-server stream carries rate-limit/usage messages, capture them the same passive way as Claude; if it requires a query, add a guarded `Codex.Usage.fetch/0` (parse `codex`'s usage output) called on a 5-min interval / on demand.

- [ ] **Step 1: Write failing test** — given the Task-1 Codex message/output, `AgentUsage.get("codex")` returns a snapshot with `plan`, `credits_remaining`, `session`, `weekly` (+ `model_limits` if present).

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** the captured/queried path → `AgentUsage.put("codex", Window.normalize("codex", payload))`. Guard all `System.cmd`/parsing (missing/uninstalled → no snapshot, not a crash).

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(usage): capture Codex plan usage`.

---

## Task 6: GET /settings/agents/usage endpoint

**Files:** Create `agent_usage_controller.ex` + route + test.

- [ ] **Step 1: Write failing test** — after `AgentUsage.put`, `GET /settings/agents/usage` returns JSON `{ claude: { plan, creditsRemaining, fetchedAt, stale, windows: [{ kind, usedPercent, resetsAt }], modelLimits: [...] }, codex: {...}, cursor: null, opencode: null }`.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — `usage/2` calls `AgentUsage.snapshot/0`, presents snake→camel (reuse the settings presenter). Route next to `GET /settings/agents/availability` and `GET /settings/tooling/availability`.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(usage): GET /settings/agents/usage`.

---

## Task 7: Tracker types + service + hook

**Files:** `types/agent-usage.ts`, `services/agentUsage.ts`, `hooks/useAgentUsage.ts` + tests.

- [ ] **Step 1: Write failing tests** — `getAgentUsage()` maps the DTO (snake→camel, windows array); `useAgentUsage()` is a `useQuery` with a 5-minute `refetchInterval` (mirror Jean's `USAGE_REFRESH_MS`) exposing `{ usage, isFetching, refetch }`.

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/services/__tests__/agentUsage.test.ts`

- [ ] **Step 3: Implement** types (`UsageWindow { kind: "session"|"weekly"|"reviews"|string; usedPercent: number; resetsAt: number | null }`, `AgentUsageSnapshot`, `AgentUsageMap`), service, hook.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(usage): tracker usage types + service + hook`.

---

## Task 8: AgentUsagePanel + UsageWindowBar (Settings)

**Files:** `AgentUsagePanel.tsx`, `UsageWindowBar.tsx` + tests; mount; locales.

- [ ] **Step 1: Write failing bar test** — `UsageWindowBar({ label, window })` renders a labeled progress bar at `usedPercent` (clamped 0–100) and a `Resets: <localized time>` line when `resetsAt` is set; renders nothing when `window` is null.

- [ ] **Step 2: Write failing panel test** — for each agent with a snapshot, renders a section (plan + credits when present) and a `UsageWindowBar` per window (Session / Weekly / Reviews / per-model); agents with `null` usage show "Usage unavailable for this agent"; a "Last updated" line + a manual refresh button calling `refetch`. (Model the layout on Jean's `UsagePane.tsx`.)

- [ ] **Step 3: Run (expect fail)** — `cd tracker && npx vitest run src/components/settings/__tests__/AgentUsagePanel.test.tsx`

- [ ] **Step 4: Implement** — `useAgentUsage()`; render per-agent sections with shadcn `Progress`/`Card`; localized reset times; auto-refresh badge ("Refreshing…/Up to date"). Mount `<AgentUsagePanel>` under the Agent Setup panel in `SettingsPage.tsx`. i18n keys under `settings.usage.*` (en + pt-BR).

- [ ] **Step 5: Run (expect pass).**

- [ ] **Step 6: Commit** — `feat(usage): Agent Plan Usage panel`.

---

## Task 9 (OPTIONAL): Compact usage pill in Execution Control

**Files:** Modify `ExecutionControlComposer.tsx` (+ a small `UsagePill.tsx`) + test.

- [ ] **Step 1: Write failing test** — near the model picker, a compact pill shows the **selected agent's** nearest-reset window: `42% · resets 3h` with a tooltip listing all windows; hidden when usage is unavailable; clicking deep-links to the Settings usage panel.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — derive the tightest window (highest `usedPercent`) for the composer's current `agentKind` from `useAgentUsage()`; render compactly; reuse the relative-time util.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(usage): compact plan-usage pill in Execution Control`.

---

## Task 10: Full gates + docs

- [ ] **Step 1: Backend gate** — `cd elixir && mix specs.check && make all` → pass.
- [ ] **Step 2: Tracker gate** — `cd tracker && npm run lint && npx vitest run && npm run build` → pass.
- [ ] **Step 3: Docs** — document the Agent Plan Usage panel + the data sources (Claude `rate_limit` event capture, Codex usage) in `elixir/README.md` / `../SPEC.md`. Remove the Task 1 scratch note if not keeping it.
- [ ] **Step 4: Commit** — `docs(usage): document agent plan-usage windows`.

---

## Self-Review (spec coverage)

| Requirement (from user) | Task(s) |
| --- | --- |
| Show plan window like "5h/day best model" (rolling session) | 2, 4, 8 |
| Weekly limit | 2, 4/5, 8 |
| Per-agent consumption % shown to the user | 6, 8 (+ 9 pill) |
| Reset times | 2, 8 |
| Codex + Claude (others where available) | 4 (Claude), 5 (Codex), 8 (cursor/opencode → "unavailable") |

**Notes / decisions:**
- **Claude is the concrete first win** — the `rate_limit` event already flows through Symphony's bridge and is currently dropped; Task 4 just consumes it. Codex (Task 5) depends on the Task-1 spike for its exact source (app-server message vs query).
- v1 keeps usage **ephemeral** (in-memory, TTL'd) like `AgentAvailability` — no DB. A durable `agent_usage_snapshots` table (for trends/history) is a deliberate follow-up, not in scope.
- Exact payload field names are pinned in the Task-1 spike rather than guessed, because the CLIs' rate-limit schemas change; the normalizer (`Window.normalize/2`) is the single place that absorbs schema differences.
- This composes with the existing Setup surface: it sits beside the Agent Setup + Supporting Tools panels from `2026-06-26-agent-cli-setup-opencode-plan.md`.
