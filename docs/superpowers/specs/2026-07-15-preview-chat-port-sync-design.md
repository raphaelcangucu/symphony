# Preview ↔ chat port sync + optional GraphQL serve

**Date:** 2026-07-15  
**Status:** Draft for review  
**Surfaces:** Issue Preview dock / Preview tab, `manage_preview` / `list_previews`, coding-agent prompt (`PromptBuilder`), DevEnv serve steps  
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
3. **Optional GraphQL** — Some project branches ship a GraphQL binary/API;
   others do not. A hard-coded second serve step crashes preview on branches
   where the path is missing. Symphony already stores `optional` on DevEnv
   steps but **does not skip** optional serve steps at start.

Observed shape (Advising CDE-1131): chat finished GraphQL reload on `:4301`
after `vibe` recreate; Preview dock still showed `:4300 · crashed`.

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
4. Support an **optional GraphQL (or any) serve step** gated by workspace path
   presence (`exists:`), so missing-on-branch does not crash the primary app
   preview.

## Non-goals

- Pushing DevServer PubSub/SSE into the LLM context mid-token.
- Auto-rewriting `DevServerRecord.port` from Docker publish / `INSPIRE_PORT`
  when the agent bypasses Symphony.
- Hard-coding Advising `graphql-reload` or Inspire Compose into Symphony core.
- Changing the smart port lease formula (bands/slots/offsets).
- Making warm-up (`DevEnv.warm_up` / `*-warmup` Compose) the issue preview
  path (warm-up stays separate).

## Decisions

| Decision | Choice |
| --- | --- |
| Sync approach | **1 + light 2** — prompt/policy + light `manage_preview` enrichment |
| Port priority | Prefer `DevServerRecord` / `manage_preview` (same as Preview dock SSE); **not sole** — fallback allowed after preview failure |
| Bring-up path | Try `manage_preview start` first when `available: true`; on failure, agent may choose another convenient path |
| Mid-turn freshness (B) | Prefer re-calling `manage_preview status` before citing ports/HTTP checks while using Preview; after fallback, cite the ports actually in use and note dock may be stale |
| GraphQL / optional services | Serve step with `optional: true` + new `exists` path gate (**detection A**) |
| Field name | `exists` (relative path under the issue workspace root) |

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
| `skipped` optional servers (see §3) | So agents do not invent GraphQL reload when gated out |
| Unhealthy `next_steps` | Point at `output` / `restart` / `manage_dev_env`, then **allow fallback** if still failing |

**Out of light-2 scope:** scanning Docker for a different published port and
updating the record; live push into chat; forcing fallback ports into
`DevServerRecord`.

### 2. “Preview available → bring the project up”

Availability gate (evaluated with the issue workspace root when present):

`dev_server.enabled` ∧ workspace exists ∧ at least one **effective** serve
step after the same optional/`exists` / missing-`working_dir` filter used at
start.

Today `issue_targets/2` only checks `DevEnv.list_serve_steps/1 != []`. This
spec **changes** that check to use effective steps so a workspace whose only
serve steps are optional-and-missing is not advertised as available.

When `available: true`:

- Prompt and `status` tell the agent to **prefer** `manage_preview start`,
  with fallback allowed after failure.
- Primary UI CTA remains Start preview (existing dock behavior).
- Skipped optionals (if any configured siblings failed `exists`) are listed
  in the status enrichment, not as live servers.

When `available: false`, surface `reason`
(`disabled` | `workspace_missing` | `no_serve_step`) with actionable
`next_steps` (existing pattern). Reuse `:no_serve_step` when configured steps
exist but **none** are effective after the presence filter (no new reason atom
in v1).

### 3. Optional serve steps + `exists` gate

#### Schema

Add `exists` to DevEnv serve/setup steps:

| Layer | Change |
| --- | --- |
| YAML (`.symphony/devenv.yaml`) | Optional string `exists: relative/path` |
| `DevEnv.Step` + changeset | `field(:exists, :string)` nullable |
| Convention reader / proposed step / project YAML export | Round-trip `exists` |
| Migration | Nullable string column on `local_tracker_dev_env_steps` |
| Tracker DevEnv UI | Optional path field when editing a step |
| Presenter / types | Expose `exists` to the UI |

Semantics:

- Path is relative to the **issue workspace root** (same root used for
  `working_dir` resolution).
- Presence = file **or** directory exists (`File.exists?/1` equivalent).
- Empty / nil `exists` → no path gate (only `optional` + cwd rules apply).

#### Start-time filtering (`DevServer.Manager`)

Before port reservation / instance start:

```
for each serve step:
  if optional and missing?(exists_path or working_dir as configured):
    skip (do not allocate port, do not start, do not mark crashed)
  else:
    start as today
```

Rules:

| `optional` | `exists` / cwd | Result |
| --- | --- | --- |
| `true` | path missing | **Skip** — no crash |
| `true` | path present | Start; use normal ready probe |
| `false` | path missing | Current failure behavior (do not silently skip) |
| `false` | path present | Start |

Also: if `optional: true` and `working_dir` is set but that directory is
absent (even without `exists`), skip rather than crash — same spirit as the
path gate. Prefer documenting that authors set `exists` explicitly for
GraphQL markers.

Skipped steps appear in tool/prompt views as:

```text
graphql: status=skipped, reason=missing_exists, exists=path/to/marker
```

No `DevServerRecord` row required for a skipped start (or a terminal
`skipped` row if the UI needs a stable slot — prefer **no row** in v1 to
avoid fake ports; list skipped only in the enriched status payload from
configured steps).

#### GraphQL (project config, not Symphony hardcode)

Projects that have a branch-conditional GraphQL service declare a second serve
step in their own `.symphony/devenv.yaml`, for example:

```yaml
- role: serve
  description: GraphQL API
  command: <project-specific start>
  working_dir: <dir-or-empty>
  optional: true
  exists: <path that only exists on GraphQL branches>
  port_env: PORT   # or project-specific env if already supported
  ready_probe: http
  ready_path: /graphql/health   # project-chosen
  primary: false
```

Symphony core only honors `optional` + `exists` + ready probes. Reload helpers
(`graphql-reload`) stay in the project repo / serve command.

### 4. Data flow (target)

```
DevEnv serve steps (+ optional/exists)
        │
        ▼
Manager.start_for_issue ── filter skips ──► PortPlan / Instance
        │                                        │
        │                                        ▼
        │                               DevServerRecord + SSE ──► Preview dock
        │                                        │
        └──────── manage_preview status ◄────────┘
                        │
                        ▼
              Agent cites ports / HTTP checks
```

Chat and Preview stay in sync when the agent uses the preferred side of this
diagram. Fallback (left of Symphony Preview) is allowed after failure; the
dock may lag until a later best-effort `manage_preview restart`.

### 5. Surfaces / file map (implementation guidance)

| Area | Likely touchpoints |
| --- | --- |
| Prompt | `elixir/lib/symphony_elixir/prompt_builder.ex` |
| Tools | `assistant/preview_tools.ex`, `list_preview_tools.ex` |
| Start filter | `dev_server/manager.ex` (+ small helper for presence) |
| Schema | `dev_env/step.ex`, convention_reader, proposed_step, migration |
| API/UI | DevEnv presenter, tracker DevEnv types/forms |
| Tests | Manager skip tests; PreviewTools status skipped; PromptBuilder section |

### 6. Success criteria

1. With preview available, an agent following the prompt **tries**
   `manage_preview start` first and, when that works, cites the same port the
   dock shows.
2. After mid-turn `restart` / drift on the Preview path, a fresh
   `manage_preview status` matches the dock; the prompt tells the agent to
   re-query.
3. When Preview fails after self-heal attempts, the agent may fall back to a
   convenient project path and continue (dock staleness is acceptable).
4. Branch **without** the GraphQL `exists` path: GraphQL step skipped; primary
   app preview still starts.
5. Branch **with** the path: GraphQL starts, becomes `ready` via `ready_path`,
   and appears in status + dock.
6. No live SSE→LLM; no Symphony hardcode of Advising GraphQL scripts.

### 7. Risks / open follow-ups

| Risk | Mitigation |
| --- | --- |
| Agents skip Preview and go straight to `vibe` | Prompt: try Preview first; fallback only after failure |
| Agents never fall back and block forever | Unhealthy `next_steps` explicitly allow fallback |
| Wrong `exists` path | Project authoring; document in README / DevEnv UI help |
| Availability when all steps skipped | Reuse `:no_serve_step`; do not claim available |
| UI wants a row for skipped GraphQL | v1: tool/prompt only; optional later dock “skipped” chip |

**Out of scope follow-up (not this spec):** binding-process rediscovery that
updates `DevServerRecord` when Compose republishes a different host port.

## Spec self-review

- No TBD placeholders for core behavior; GraphQL command/path remain
  **project-authored** by design.
- Does not contradict 2026-07-09 (extends tools lightly; no new SSE-to-agent).
- Does not change port lease math from 2026-06-15.
- Preferred ≠ sole: Preview is priority; fallback after failure is first-class
  (warm-up / project scripts remain valid escape hatches).
- Availability vs start filter: same presence rules; `:no_serve_step` reused
  when every step is skipped (no new reason atom in v1).
- Skipped servers: tool/prompt only in v1 (no fake `DevServerRecord` port).
