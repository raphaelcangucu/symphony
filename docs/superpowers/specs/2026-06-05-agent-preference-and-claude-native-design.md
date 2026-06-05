# Agent Preference Hierarchy & Native Claude Code Backend

**Date:** 2026-06-05
**Status:** Approved design, pending implementation plan

## Motivation

Symphony was built Codex-first. Claude Code exists as an execution backend but is a
second-class citizen: it depends on an external TypeScript bridge (`symphony-claude`),
has no tools (`github_graphql`, `set_issue_status`), cannot power the assistant chat,
and there is no way to choose it from the UI. This design makes the coding agent a
first-class, user-selectable preference at three levels and replaces the external
bridge with a native Elixir implementation.

## Requirements

1. The operator picks a **default coding agent** (`codex` | `claude`) in a new
   **Settings** menu in the tracker sidebar.
2. The agent can be overridden **per project** and **per task**, and chosen in the
   **assistant** (both for issue dispatch and for the assistant chat itself).
3. Resolution priority: **task > project > user default**.
4. Inheritance is **live** (tri-state): a project without an explicit choice follows
   the user default at dispatch time. New projects are created inheriting.
5. The assistant chat engine itself is switchable between Codex and Claude Code.

## Decision summary

| Decision | Choice |
|---|---|
| Cascade semantics | Live inheritance (tri-state), resolved at dispatch time |
| User default storage | Server-side, generic settings table (spatie/laravel-settings model) |
| Project-level storage | `agent.kind` key in `workflow_markdown` front matter; absence = inherit |
| Task-level storage | Existing `symphony:codex` / `symphony:claude` labels |
| Assistant scope | Dispatch **and** chat engine are agent-switchable |
| Settings page scope | Coding agent preference only (theme/reset-token stay in the sidebar footer) |
| Claude integration | Native Elixir port of the app-server bridge; no external binary |
| Claude tools | MCP gateway owned by the component (loopback HTTP, per-session token) |
| Packaging | Embedded in Symphony **and** standalone `bin/symphony-claude` escript |
| Unavailable agent | Immediate visible failure; never a silent fallback or silent admission drop |

## 1. Data model & resolution

### 1.1 Generic settings store (spatie/laravel-settings model)

New SQLite table `settings`:

| column | type | notes |
|---|---|---|
| `group` | string | e.g. `"agents"` |
| `name` | string | e.g. `"default_agent_kind"` |
| `payload` | JSON | typed value, serialized |
| timestamps | | |

Unique index on `(group, name)`.

- `SymphonyElixir.Settings` context plays the role of spatie settings classes: each
  group declares **schema + defaults + casts in code** (first group:
  `Settings.Agents` with `default_agent_kind: "codex"`). Reads merge stored rows
  over defaults (missing row = default; no migration seeding). Writes upsert by
  `(group, name)`. Invalid payloads fall back to defaults with a warning.
- API (bearer auth, existing tracker token):
  - `GET /api/tracker/v1/settings` — all groups, resolved (defaults merged)
  - `PUT /api/tracker/v1/settings/agents` — update keys within the group
- Future settings (theme defaults, feature flags, dispatch defaults) join without
  new migrations.
- Single-operator instance today: no per-login keying (YAGNI).

### 1.2 Project level — `workflow_markdown` front matter

The project's `workflow_markdown` (DB-owned source of truth,
`local_tracker_project_setups`) carries the choice:

```yaml
agent:
  kind: claude   # explicit project choice; absent key = inherit
```

`Config.agent_kind_from_config` (`elixir/lib/symphony_elixir/config.ex:509`)
changes precedence:

1. explicit `agent.kind` → use it;
2. exactly one of `codex:` / `claude:` sections present → infer that kind
   (compatibility with existing WORKFLOWs);
3. otherwise → `nil` (= inherit; today it falls back to the instance default).

### 1.3 Task level — labels (existing mechanism)

`symphony:codex` / `symphony:claude` labels remain the per-task override, already
working for the local tracker and GitHub with bidirectional sync
(`AgentRouting`, `elixir/lib/symphony_elixir/agent_routing.ex:35`;
`replace_agent_routing_label`, `local_tracker/context.ex`).

### 1.4 Resolution — `SymphonyElixir.AgentPreference`

```elixir
AgentPreference.resolve(issue_labels, project_agent_kind, user_default)
# 1. task label        (symphony:claude → "claude")
# 2. project explicit  (agent.kind from workflow_markdown)
# 3. user default      (Settings.Agents.default_agent_kind)
# 4. "codex"           (hard fallback = current behavior)
```

Call sites: `AgentRunner` (issue execution), assistant dispatch tool, assistant
thread engine resolution, `LocalTracker.IssueMapper`.

### 1.5 Admission guard change

Today an issue labeled `claude` in a project without a `claude:` section is
**silently dropped** at admission (`AgentRouting.resolve_agent_kind/3` returns
`nil` when the kind is not in `configured_kinds`). Both kinds become always
admissible (instance-level command defaults exist in `InstanceConfig`); binary
unavailability surfaces as a **visible run failure** plus an availability
indicator in Settings — never a silent drop.

## 2. UI surfaces (tracker SPA)

### 2.1 Settings page (user default)

- Sidebar (`tracker/src/components/layout/ProjectSidebar.tsx`): new **Settings**
  nav item (gear icon) below Backups → route `/settings` (`tracker/src/App.tsx`).
- **Coding agent** card: agent chips (reuse the chip pattern + `AGENT_ICONS` from
  `IssueCreateDialog.tsx:95`) for Codex / Claude Code; saves via
  `PUT /api/tracker/v1/settings/agents`.
- Availability per agent: `GET /api/tracker/v1/settings/agents/availability` —
  server probe (`System.find_executable` + `--version`, short cache). Renders
  `✓ claude 2.1.165` / `✗ codex not found`.

### 2.2 Project picker

- `ProjectConfigEditor` gains a **Coding agent** select:
  `Inherit (effective: Codex)` / `Codex` / `Claude`.
- The picker **edits the front-matter text client-side** (inserts/updates/removes
  the `agent.kind` block in the existing markdown editor buffer). The user sees
  the exact change; Save persists the whole markdown as today. No server-side
  YAML rewriting (preserves comments/formatting of the source of truth).
- Creation wizard (`ProjectWorkspaceWizard`): new projects are born **without**
  `agent.kind` (= inherit), with an optional select to pin explicitly at creation.
  Shows the inherited effective agent as a hint.

### 2.3 Task surfaces

- `IssueCreateDialog`: the existing chips gain semantics — "None" becomes
  **"Inherit (effective: X)"**. The issue-options endpoint returns the resolved
  project→user effective agent.
- `IssueDrawer` Agent tab: same chip row to **change the agent of an existing
  issue** (writes the `symphony:<kind>` label through the existing flow).
  Disabled while a run is active.

### 2.4 Assistant

- The composer "CODEX CLI" badge becomes an **agent picker** (Codex CLI /
  Claude Code). Initial value = resolved chain by thread scope (issue thread →
  task; project thread → project; freeform → user default).
- Switching is allowed **between messages**: history is replayed from the DB into
  the prompt, and each agent keeps its own backend session id on the thread —
  the `codex_thread_id` column generalizes to an `agent_thread_ids` map
  (`%{"codex" => ..., "claude" => ...}`).
- Model picker is per-agent: `ModelCatalog` keeps the Codex app-server source;
  a `Claude.ModelCatalog` serves the static list (opus / sonnet / haiku, as in the
  reference bridge). The frontend stores last-used model per agent
  (`tracker/src/lib/assistantSettings.ts` pattern). The reasoning-effort dropdown
  is hidden for Claude (no equivalent; thinking budget is out of scope).
- Dispatch tool: `dispatch_codex`
  (`elixir/lib/symphony_elixir/assistant/tool_executor.ex:952`, hardcoded
  `"agent" => "codex"`) becomes **`dispatch_coding_agent`** with an optional
  `agent` argument; absent → resolve the chain. `dispatch_codex` stays as an
  accepted alias for one release (old prompts/skills). UI strings
  ("Dispatching to Codex…") become dynamic
  (`IssueAuthoringPanel.tsx`, `assistantToolCall.ts`).
- Goal mode remains Codex-only (`codex.goals_enabled`): the checkbox is hidden
  when the resolved agent is Claude.

## 3. Native Claude backend — `SymphonyElixir.Claude.AppServer`

Self-contained component, ported from the MIT reference implementation
[`sapsaldog/claude-app-server`](https://github.com/sapsaldog/claude-app-server)
(~1.4k lines TS). **No tracker/Phoenix/Ecto dependencies** — only `Jason` +
`Bandit` (already deps).

```
elixir/lib/symphony_elixir/claude/app_server/
├── server.ex        # state machine: threads, turns, steer queue (port of server.ts)
├── cli_runner.ex    # spawns the claude CLI + parses stream-json → events
├── protocol.ex      # JSON-RPC: initialize, thread/*, turn/*, model/list
├── tool_gateway.ex  # own MCP listener (Bandit, 127.0.0.1:random-port,
│                    #   per-session token) — generates --mcp-config
└── stdio_main.ex    # escript entrypoint (standalone mode)
```

### 3.1 CLI invocation (per turn, reference model)

```
bash -c 'exec claude --print --output-format stream-json --verbose \
  --include-partial-messages --permission-mode bypassPermissions \
  [--model <m>] [--session-id <uuid> | --resume <cli_session_id>] \
  [--mcp-config <path> --strict-mcp-config] < <prompt-file>'
```

- Prompt via **temp file + redirect** (Erlang ports cannot close stdin
  selectively; the codebase already spawns via `bash -lc`). No argv limits.
- First turn: `--session-id <uuid>`; later turns: `--resume` with the
  `session_id` captured from the `system/init` event. Stateless between turns —
  survives daemon restarts (the CLI persists transcripts on disk).
- Interrupt = SIGTERM on the os_pid. Steer = queued, prepended to the next
  turn's prompt (reference semantics).

### 3.2 Event translation

Raw stream-json is translated into the same notification vocabulary the TS
bridge produced — `item/progress`, `item/created`, `usage/update`,
`turn/completed`, `turn/failed` — which `Codex.EventHumanizer` and the
transcript UI already understand. Mappings:

| stream-json | emitted |
|---|---|
| `system/init` | capture `cli_session_id`; session metadata |
| `assistant` text/thinking deltas | `item/progress` |
| `assistant` final blocks, `tool_use` | `item/created` |
| `user` `tool_result` blocks | `item/created` (tool_result) |
| `stream_event` `message_delta.usage` | `usage/update` |
| `result` | `turn/completed` / `turn/failed` (+usage, +cost, `permission_denials`) |
| `rate_limit_event` | existing rate-limit normalization |

Tool chips strip the `mcp__symphony__` prefix for display so transcripts read
like Codex's.

### 3.3 Tool gateway (MCP)

- Tiny Plug router on a loopback random port, started by the component (not by
  Phoenix): `initialize`, `tools/list`, `tools/call`, `ping` only (no SSE; no
  server→client requests needed).
- Preparing a turn with tools mints a session token (ETS: token → tool specs +
  executor context + TTL) and writes the `--mcp-config` JSON pointing at
  `http://127.0.0.1:<port>/mcp/<token>`. The token **is** the session binding.
- `tools/list` serves the same specs as Codex `dynamicTools`
  (name/description/inputSchema — identical shape to MCP). `tools/call` routes:
  - **embedded mode** → the `tool_executor` closure directly
    (`ToolExecutor` / `DynamicTool`, unchanged);
  - **standalone mode** → forwarded to the stdio client as a reverse JSON-RPC
    request `item/tool/call` (the same contract the Codex app-server uses,
    `elixir/lib/symphony_elixir/codex/coding_agent.ex:790`), response returned
    to the CLI.
- Because the listener is component-owned, Claude tools work even when the
  Phoenix web subtree is down.
- Token lifecycle: minted at session start, invalidated at session stop, TTL
  safety net.

### 3.4 Consumption modes

**Embedded (Symphony internal):** `Claude.CodingAgent` becomes a thin adapter
implementing the `CodingAgent` behaviour by calling `AppServer` functions
in-process — no stdio hop. This gives execution runs and the assistant chat the
full toolset (`github_graphql`, `linear_graphql`, `set_issue_status`, assistant
tools) that today only Codex has.

**Standalone (`bin/symphony-claude`):** a second escript built by `make build`,
main = `stdio_main.ex`, serving the app-server protocol over stdio. A drop-in
replacement for the TS bridge and a **superset** of it (supports
`dynamicTools`). Any orchestrator speaking the Codex app-server protocol can use
it. Caveats: requires Erlang on the host (same as `bin/symphony`); the
standalone main never starts the Repo (the SQLite NIF escript limitation is
irrelevant — the app-server touches no database).

### 3.5 Configuration

- `claude.command` keeps its WORKFLOW/instance semantics; the default changes
  from `symphony-claude` to `claude`
  (`elixir/lib/symphony_elixir/instance_config.ex:40`). The adapter composes CLI
  args on top of it.
- Claude backend keeps `bypassPermissions` (documented behavior).

## 4. Errors & availability

- **Missing binary:** immediate, visible run failure in the Agent tab
  ("claude not found — install it or switch the agent"), following the existing
  retry/backoff flow. Settings page shows the availability probe.
- **Unauthenticated CLI:** stream error mapped to a visible failure with a hint
  ("run `claude` and log in").
- **No silent fallback** to the other agent, ever.

## 5. Testing

- `Settings` context: defaults / upsert / cast; controller GET/PUT + auth.
- `AgentPreference.resolve/3`: case table (label > project > user > codex;
  single-section inference; invalid kinds).
- `AppServer` adapter: fake binary (script emitting NDJSON fixtures) covering
  happy turn, tool round-trip, interrupt, non-zero exit, resume args across
  turns.
- `tool_gateway`: handshake, invalid token → 401, `tools/call` → executor;
  standalone reverse-request path.
- Frontend (vitest): SettingsPage saves via PUT; front-matter manipulation
  (insert/update/remove `agent.kind`); composer hides effort for Claude and
  switches catalogs; dynamic dispatch tool rendering.
- Manual smoke checklist: pick Claude in Settings → new project inherits →
  create issue (inherit chip shows effective) → dispatch from assistant runs
  Claude with tools → switch composer agent mid-thread → standalone escript
  answers `initialize` over stdio.

## 6. Compatibility & migration

- Existing WORKFLOWs with only a `codex:` section keep working (single-section
  inference).
- `dispatch_codex` accepted as alias for one release; tool specs advertise
  `dispatch_coding_agent`.
- The external `symphony-claude` TS bridge is no longer required; READMEs
  updated (`elixir/README.md` Homebrew section, troubleshooting docs, and the
  GitHub label-routing rule "the WORKFLOW must include a `codex:` and/or
  `claude:` section for the targeted agent", which §1.5 retires).
- No data migration: absent settings rows mean defaults; existing projects
  without `agent.kind` resolve exactly as before (codex via instance default).

## Out of scope

- Claude thinking-budget / effort mapping in the composer.
- Goal mode for Claude.
- Fully self-contained binary (Burrito/mix release) for the standalone escript.
- Multi-operator (per-login) settings.
- Moving theme toggle / reset token into the Settings page.

## Reference files

- `elixir/lib/symphony_elixir/config.ex:509` — `agent_kind_from_config/1`
- `elixir/lib/symphony_elixir/agent_routing.ex:35` — label routing + guard
- `elixir/lib/symphony_elixir/coding_agent.ex:14` — backend adapter switch
- `elixir/lib/symphony_elixir/claude/coding_agent.ex` — current bridge client (replaced)
- `elixir/lib/symphony_elixir/codex/coding_agent.ex:417,790` — `dynamicTools` + `item/tool/call`
- `elixir/lib/symphony_elixir/assistant/codex_session.ex` — assistant turns (generalized)
- `elixir/lib/symphony_elixir/assistant/tool_executor.ex:952` — `dispatch_codex_attrs`
- `elixir/lib/symphony_elixir/codex/model_catalog.ex` — catalog shape (agent-aware)
- `tracker/src/components/layout/ProjectSidebar.tsx` — sidebar nav
- `tracker/src/components/issues/IssueCreateDialog.tsx:95,276` — agent chips
- `tracker/src/components/projects/ProjectConfigEditor.tsx` — project settings editor
- `tracker/src/lib/assistantSettings.ts` — composer prefs persistence
- Reference implementation: https://github.com/sapsaldog/claude-app-server (MIT)
