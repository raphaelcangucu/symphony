# Preview layout + agent preview tools

**Date:** 2026-07-09  
**Status:** Approved for planning  
**Related:** `2026-05-30-issue-dev-server-preview-design.md`, `2026-05-31-public-preview-tunnel-design.md`, `2026-06-17-tracker-agent-tools-design.md`  
**Surfaces:** session Preview dock (`IssuePreviewDock` + `PreviewPanel`), issue Preview tab, assistant tools

## Problem

1. **UI density** — In the session Preview dock (and the shared `PreviewPanel`), issue-level Start/Stop/Restart, per-server Start/Stop/Restart, Ask Assistant, stacked metadata, duplicate URLs, and auto-open logs compete in a narrow panel. Crashed states feel unreadable (e.g. “Não foi possível carregar a saída” above an empty dark pre).

2. **Agent self-heal gap** — `manage_preview` already supports issue-level `status` / `start` / `stop` / `restart`, but agents cannot:
   - target a single server (`front` / `back`)
   - read command output after a crash
   - list previews across the project
   - control the Cloudflare tunnel  
   Failures must return **structured, actionable errors** (reason + output tail + next steps) so the agent can fix itself without a human pasting logs.

## Goals

1. Redesign Preview management UI for scanability in the dock and the issue tab (same component, status-first).
2. Extend `manage_preview` with per-server control and bounded `output`.
3. Add `list_previews` and `manage_tunnel` as dedicated tools.
4. Every unhealthy/failed tool result includes machine-readable `reason`, optional `output_tail`, and `next_steps` the agent can follow.

## Non-goals

- Live SSE log streaming through tools (bounded snapshot/tail only).
- Changing port leasing, serve-step schema, or `manage_dev_env` (still the setup path).
- Replacing the iframe preview experience when a URL is ready.
- Stopping the OS-level Symphony daemon.

## Approach

**A (UI) + C (tools):** compact status-first `PreviewPanel`, extend `manage_preview`, and add `list_previews` + `manage_tunnel`.

---

## 1. UI — Preview panel / dock

Shared component: `PreviewPanel` (issue tab + session dock). Dock chrome (`IssuePreviewDock` header/iframe) stays; the management body is what we densify.

### Hierarchy

1. **Status strip** — availability + tunnel state on one line (not a large dashed essay card). Tunnel CTA is a compact text/button when stopped.
2. **Primary action** — one dominant control based on state:
   - unavailable / stopped → **Start preview**
   - ready → **Open preview** (primary URL)
   - crashed / start_failed → **Fix with assistant** (or Restart as secondary)
3. **Secondary issue actions** — Stop / Restart in a quiet overflow or icon group (not three equal outline buttons).
4. **Server list** — one row per server:
   - Line 1: `slug` · status badge · `principal` · port
   - Line 2 (optional): local / public URL as truncated links
   - Trailing: icon Start / Stop / Restart; overflow for Ask assistant
5. **Logs** — `DevServerOutputPanel` collapsed by default; auto-open only for `starting` | `provisioning` | `crashed`. On load failure: single error callout, **no** empty dark `<pre>` underneath.

### Density rules

- Do not duplicate the ready URL block and per-row URLs; prefer row links + one primary Open when ready.
- Prefer one-line metadata (`front · :4101 · principal`) over vertical label stacks.
- Keep Ask Assistant available, but not as a full-width fourth button beside Start/Stop/Restart.

### Surfaces

| Surface | Behavior |
| --- | --- |
| Session dock | Same panel; when URL ready and details hidden → iframe (unchanged) |
| Issue Preview tab | Same panel, wider — same hierarchy, more breathing room |

---

## 2. Tools

### 2.1 Extend `manage_preview`

| Action | Args | Behavior |
| --- | --- | --- |
| `status` | `identifier` | Enriched view (as today) + public URLs when tunnel is up |
| `start` / `stop` / `restart` | `identifier`, optional `server` | Whole issue, or one server by slug/id |
| `output` | `identifier`, `server` | Bounded command-log tail for that server |

Keep existing non-blocking start timeout and recoverable-start structured results. Enrich those with `output_tail` when available.

Register in both project-chat and issue-bound coding-agent tool sets (same as today).

### 2.2 New: `list_previews`

| Arg | Purpose |
| --- | --- |
| optional `status` filter | e.g. only `ready` / `crashed` / running-ish |

Returns project-wide inventory: issue identifier, servers (slug, status, port, local_url, public_url), tunnel summary. Agents use this to discover, then `manage_preview` to act.

### 2.3 New: `manage_tunnel`

| Action | Behavior |
| --- | --- |
| `status` | Tunnel enabled/running + public URLs for the issue |
| `start` | Same as UI `POST /tunnel/start` |
| `stop` | Only if backend already supports stop; otherwise return structured “unsupported” with `next_steps` |

Issue-scoped (`identifier` required for project chat; implied for issue-bound).

### 2.4 Agent guidance (tool descriptions)

- Prefer `list_previews` to discover → `manage_preview` to act.
- On crash: `manage_preview output` → fix code / `manage_dev_env` → `restart`.
- Do not tight-loop start; poll `status` and keep shipping tests (existing `next_steps` tone).

---

## 3. Error contract (required)

Failed or unhealthy results must be **actionable for self-heal**, never silent success.

| Field | Required when | Purpose |
| --- | --- | --- |
| `ok: false` or `{:error, …}` / structured failure payload | failure | Clear failure signal |
| `reason` | always on failure / unhealthy | Machine-readable (`crashed`, `start_failed`, `no_serve_step`, `tunnel_failed`, `output_unavailable`, …) |
| `message` | always | Short human summary |
| `server` / `servers` | when scoped | Which process(es) + status |
| `output_tail` | crash / start failure when logs exist | Last N lines for the agent to diagnose |
| `next_steps` | always on failure / not-ready | Concrete follow-ups |

Also:

- `status` and `list_previews` must surface crashed/unavailable servers as **data**, not “all good”.
- Config errors (`no_serve_step`, workspace missing) stay hard errors with setup hints pointing at `manage_dev_env`.
- Recoverable start failures keep structured non-blocking payloads **and** attach `output_tail` when possible.

---

## 4. Architecture

```
PreviewPanel (UI)
  └─ useIssueDevServers → REST/SSE (unchanged endpoints)

Assistant
  ├─ manage_preview  (+ server, output)
  ├─ list_previews   (project inventory)
  └─ manage_tunnel   (status/start[/stop])
        └─ DevServer.Manager / Tunnel APIs
```

No new Phoenix channel RPC required; tools wrap existing Manager + HTTP-equivalent operations.

---

## 5. Testing

**UI**

- PreviewPanel: primary CTA by state; server row icon actions; logs collapsed vs auto-open on crashed; load-failed output shows callout only.
- IssuePreviewDock: details/iframe toggle still works with redesigned panel.

**Tools**

- `manage_preview` per-server start/stop/restart; `output` returns bounded tail; crash path includes `reason` + `output_tail` + `next_steps`.
- `list_previews` returns multi-issue inventory (fixture/manager stubs).
- `manage_tunnel` start/status; unsupported stop returns structured error if applicable.
- Tool registration: both assistant + issue-bound catalogs include the new tools / extended schema.

**Manual**

- `http://localhost:4000/tracker/projects/macro-markets/workspaces/7999` — open Preview dock, crash/start flows, Ask assistant.
- Agent turn: list → status → output on crash → restart.

## Open implementation notes

- Confirm whether tunnel **stop** exists in backend; if not, `manage_tunnel stop` returns structured unsupported (do not invent a half-stop).
- Bound `output_tail` size (e.g. last 80–120 lines or ~8–16 KiB) so tool results stay model-friendly.
