# Preview ↔ chat port sync

**Date:** 2026-07-15  
**Status:** Superseded in part by **Runtime Contract v1** (2026-07-16) — see
[§8](#8-superseded-by-runtime-contract-v1-2026-07-16). The "fallback may desync
the dock" acceptance below is no longer the contract: a leased serve process now
reports its actual port and Symphony never embeds an out-of-lease preview.  
**Surfaces:** Issue Preview dock / Preview tab, `manage_preview` / `list_previews`, coding-agent prompt (`PromptBuilder`)  
**Related:**  
`2026-05-30-issue-dev-server-preview-design.md`,  
`2026-06-15-smart-preview-port-scheme-design.md`,  
`2026-07-09-preview-layout-and-assistant-tools-design.md`,  
`2026-06-19-project-dev-env-warmup-design.md`

## Problem

Chat and Preview already share one persistence source (`local_tracker_dev_servers` /
`DevServerRecord`), exposed to the UI via REST+SSE and to agents via
`manage_preview`. They still diverge in practice:

1. **Desync (failure A)** — Agents bring the app up with project scripts
   (`vibe`, Compose, `INSPIRE_PORT=4301`) **instead of trying** `manage_preview`
   first, or stay on fallback without noting dock lag. The dock keeps showing
   the leased record (e.g. `advising · :4300 · crashed` for
   `sym-dev-advising-CDE-1131-advising`) while chat cites a different published
   port. Fallback after Preview failure is fine; skipping Preview entirely is
   the avoidable case.
2. **Stale mid-turn (failure B)** — Coding-agent prompts get a one-shot
   `preview_context_section` at build time. After `start` / `restart` / port
   drift, the model may keep quoting the snapshot instead of re-calling
   `manage_preview status`.

Observed shape (Advising CDE-1131): chat finished bring-up / health checks on
`:4301` after `vibe` recreate; Preview dock still showed `:4300 · crashed`.

## Goals

1. Make **`manage_preview` + `DevServerRecord` the preferred port/URL source**
   for agents (prompt policy + light tool enrichment) — not exclusive: if
   preview fails or stays unavailable, the agent may use whatever bring-up
   path is convenient (project scripts, Compose, etc.).
2. Teach agents that when preview is **available**, they should **try
   `manage_preview` first** to bring the issue app up and stay aligned with
   the dock; fallback is allowed after clear failure.
3. Keep chat and Preview aligned on ports when the preferred path works,
   without a live SSE→LLM channel (v1).

## Non-goals

- Pushing DevServer PubSub/SSE into the LLM context mid-token.
- Auto-rewriting `DevServerRecord.port` from Docker publish / `INSPIRE_PORT`
  when the agent bypasses Symphony.
- General Symphony features for optional/branch-conditional serve steps
  (`exists:` gates, skipping optional serves, GraphQL serve discovery).
- Hard-coding Advising GraphQL / `graphql-reload` / Inspire Compose into
  Symphony core — any GraphQL or branch-specific serve behavior belongs in
  **Advising’s own serve scripts** (e.g. `.symphony` / `vibe` / project
  `serve` helpers), not in Symphony.
- Changing the smart port lease formula (bands/slots/offsets).
- Making warm-up (`DevEnv.warm_up` / `*-warmup` Compose) the issue preview
  path (warm-up stays separate).
- Changing DevEnv schema, migrations, or Tracker DevEnv UI for this work.

## Decisions

| Decision | Choice |
| --- | --- |
| Sync approach | **1 + light 2** — prompt/policy + light `manage_preview` enrichment |
| Port priority | Prefer `DevServerRecord` / `manage_preview` (same as Preview dock SSE); **not sole** — fallback allowed after preview failure |
| Bring-up path | Try `manage_preview start` first when `available: true`; on failure, agent may choose another convenient path |
| Mid-turn freshness (B) | Prefer re-calling `manage_preview status` before citing ports/HTTP checks while using Preview; after fallback, cite the ports actually in use and note dock may be stale |
| Advising GraphQL / branch-specific serve | **Out of Symphony** — adjust only Advising project serve scripts; do not generalize in core |

## Design

### 1. Preferred-path contract (prompt + tools)

Preview is the **priority** path for ports/URLs and bring-up — not a
proprietary monopoly. Agents should try it first when available; if it fails
or cannot reach `ready`, they may fall back to project-native bring-up
(`vibe`, Compose, `INSPIRE_PORT`, etc.) and keep making progress.

#### Prompt (`PromptBuilder.preview_context_section/1`)

When building coding-agent (and equivalent) prompts, the preview section must
state explicitly:

1. Preview is **available** or not (`available` / `reason` from
   `DevServer.issue_targets/2`).
2. If available: **prefer `manage_preview start`** to bring up this issue’s
   app so chat and the Preview dock stay aligned. Do not invent ports while
   still on the Preview path.
3. If `manage_preview` fails, stays crashed, or never becomes ready after
   reasonable `status`/`restart`/`output` self-heal: **fallback is allowed** —
   use whatever convenient project path works, record the blocker, and cite
   the ports actually serving traffic. Expect the dock may be stale until a
   later `manage_preview restart` (best-effort, not required to unblock).
4. Port/URL lines come from the live issue view at prompt build time, with:
   **while using Preview, before citing a port or running HTTP checks
   mid-turn, call `manage_preview status` again** (or trust the latest
   `start`/`restart` tool result).
5. Prefer each serve step’s `url_path` / `ready_path` when rendering local
   health URLs — do not hardcode `/api/health` for every non-admin slug.

#### Tool blurbs (`manage_preview` / `list_previews`)

Extend descriptions to say:

- `status` returns the **preferred** ports/URLs for the Preview dock (what
  the UI shows).
- Prefer mutating preview lifecycle via `start` | `stop` | `restart`.
- If Preview cannot be healed, fallback bring-up is OK; note that
  shell/Compose outside Preview can desync the dock until a later
  `manage_preview restart`.

#### Light `manage_preview status` enrichment

On every successful status/start/restart view payload:

| Field / behavior | Purpose |
| --- | --- |
| Per-server port, status, local/public URLs | Unchanged contract |
| Preferred-path copy | Document in `message` / `next_steps` that these ports match Preview when healthy |
| Unhealthy `next_steps` | Point at `output` / `restart` / `manage_dev_env`, then **allow fallback** if still failing |

**Out of light-2 scope:** scanning Docker for a different published port and
updating the record; live push into chat; forcing fallback ports into
`DevServerRecord`.

### 2. “Preview available → bring the project up”

Availability gate stays as today:

`dev_server.enabled` ∧ workspace exists ∧ `DevEnv.list_serve_steps != []`.

When `available: true`:

- Prompt and `status` tell the agent to **prefer** `manage_preview start`,
  with fallback allowed after failure.
- Primary UI CTA remains Start preview (existing dock behavior).

When `available: false`, surface `reason`
(`disabled` | `workspace_missing` | `no_serve_step`) with actionable
`next_steps` (existing pattern).

No change to how serve steps are filtered or started for this spec.

### 3. Advising-only note (not Symphony)

Branch-conditional GraphQL (or any Advising-specific sidecar) must be handled
**inside Advising’s serve scripts** — e.g. the command(s) already used by that
project’s DevEnv serve step / `vibe` helpers — so missing GraphQL on a branch
does not break bring-up. That work is **project-local** and is **not** part of
this Symphony design (no core `exists:` field, no Manager skip logic, no
tracker DevEnv UI for optional GraphQL).

### 4. Data flow (target)

```
DevEnv serve steps (unchanged)
        │
        ▼
Manager.start_for_issue ──► PortPlan / Instance
        │                        │
        │                        ▼
        │               DevServerRecord + SSE ──► Preview dock
        │                        │
        └──── manage_preview status ◄────────────┘
                        │
                        ▼
          Agent prefers these ports / HTTP checks
          (fallback → project scripts if Preview fails)
```

Chat and Preview stay in sync when the agent uses the preferred side of this
diagram. Fallback is allowed after failure; the dock may lag until a later
best-effort `manage_preview restart`.

### 5. Surfaces / file map (implementation guidance)

| Area | Likely touchpoints |
| --- | --- |
| Prompt | `elixir/lib/symphony_elixir/prompt_builder.ex` |
| Tools | `assistant/preview_tools.ex`, `list_preview_tools.ex` |
| Tests | PromptBuilder section; PreviewTools preferred-path / fallback `next_steps` |
| Advising GraphQL / serve scripts | **Advising repo only** — out of Symphony PR scope |

### 6. Success criteria

1. With preview available, an agent following the prompt **tries**
   `manage_preview start` first and, when that works, cites the same port the
   dock shows.
2. After mid-turn `restart` / drift on the Preview path, a fresh
   `manage_preview status` matches the dock; the prompt tells the agent to
   re-query.
3. When Preview fails after self-heal attempts, the agent may fall back to a
   convenient project path and continue (dock staleness is acceptable).
4. No live SSE→LLM; no Symphony hardcode or general optional-GraphQL serve
   machinery.

### 7. Risks / open follow-ups

| Risk | Mitigation |
| --- | --- |
| Agents skip Preview and go straight to `vibe` | Prompt: try Preview first; fallback only after failure |
| Agents never fall back and block forever | Unhealthy `next_steps` explicitly allow fallback |

**Out of scope follow-up (not this spec):** binding-process rediscovery that
updates `DevServerRecord` when Compose republishes a different host port;
general optional serve-step gates in Symphony.

## Spec self-review

- No GraphQL / `exists` / optional-serve generalization in Symphony core.
- Advising-specific GraphQL/serve script tweaks called out as project-local only.
- Does not contradict 2026-07-09 (extends tools lightly; no new SSE-to-agent).
- Does not change port lease math from 2026-06-15.
- Preferred ≠ sole: Preview is priority; fallback after failure is first-class.
- Availability gate unchanged from current `issue_targets/2` behavior.

## 8. Superseded by Runtime Contract v1 (2026-07-16)

The v1 design above deliberately left one hole open: **"fallback may desync the
dock."** When an agent (or a human) brought the app up outside Symphony — `vibe`,
Compose, `INSPIRE_PORT=4301` — the dock kept showing the leased record while chat
cited a different published port, and that drift was declared *acceptable until a
later best-effort `manage_preview restart`* (see §1.3 / §4 / Success criteria 3).

The **Unified Preview Runtime Contract** closes that hole. It is implemented and
gated behind the `preview_runtime_contract_v1` project flag; enable it per project
via `dev_server.runtime_contract_v1: true` in `workflow_markdown`.

### What changes

- **Allocation is authoritative and bounded.** `LeaseStore` + `PortPlan` remain
  the only port authority. A serve step receives a `RuntimeContract` (v1): a
  `contract_id`, monotonic `revision`, a `preferred_port`, and a *disjoint*
  `allowed_ports` fallback set inside the issue slot. A process may bind **only**
  a port in that set — never an arbitrary one.
- **Two launch sources, one contract.** `managed` launches are started by the
  Manager; `contracted_manual` launches are minted by `manage_preview prepare`,
  which reserves the lease and returns the exact env + command a human/agent/`vibe`
  must run. Both carry the same `SYMPHONY_PREVIEW_*` env and report back the same
  way.
- **Processes report the truth.** A serve process writes a `RuntimeReport` (v1
  JSON) atomically to `SYMPHONY_PREVIEW_REPORT_PATH` at each transition, echoing
  the contract id/revision and its `actual_port`. Symphony accepts it only when
  id/revision/server match, the port is in the lease, and its own readiness probe
  passes.
- **One authoritative snapshot.** REST, SSE, the Preview dock, `manage_preview`,
  `list_previews`, and the coding-agent prompt all render the same
  `DevServer.Snapshot` (same port, URL, and `snapshot_id`). Preview URLs are
  constructed in exactly one place (`Snapshot.local_url/2`).

### Sync-state contract (replaces "dock may be stale")

The snapshot now carries an explicit `sync_state` per server; the dock/chat show
truth instead of a guessed port:

| `sync_state` | Meaning | Dock/agent behavior |
| --- | --- | --- |
| `in_sync` | `ready` + actual port ∈ lease | Embed / cite this port |
| `awaiting_report` | Contract exists, no accepted report yet | Show "waiting to report"; do not embed |
| `conflict` | `ready` but bound a port outside the lease (e.g. Docker republished `59595`) | Show a concrete conflict; **never** embed or cite |
| `not_ready` | Process crashed | Surface crash; do not embed |
| `stale` | Contract superseded / expired | Prompt a fresh `restart` |

An out-of-lease or stale report is a **`conflict`** — it never rewrites the record
port or the iframe URL. This is the direct reversal of the old "desync is OK"
acceptance.

### Advising adapter (project-local, unchanged boundary)

Per §3, the project-specific work stays in the Advising repo's `.symphony`
scripts: `serve.sh` selects a leased port (preferred → bounded fallback), verifies
Docker's *published* port against the lease (tearing down on mismatch instead of
publishing a split-brain preview), and writes the `RuntimeReport`; `stop.sh` is
declared as the serve step's `stop_command` and writes a final `stopped` report.
When no contract env is present, the scripts keep their legacy `INSPIRE_PORT` +
`preview-port` behavior.

### Rollout

1. Ship behind `preview_runtime_contract_v1` (default **off**).
2. Enable for Advising (`dev_server.runtime_contract_v1: true`).
3. Smoke on CDE-1131 (stop the unmanaged `59595` stack → `manage_preview
   prepare/start` → verify Docker + report use a leased port → verify dock, tools,
   prompt, and REST show one identical snapshot → verify tenant URL + stop/restart
   cleanup).
4. Make it default only after the smoke passes.
