# Preview panel layout + assistant preview tools

**Date:** 2026-07-09  
**Status:** Approved for planning  
**Surfaces:** Session Preview dock (`IssuePreviewDock` / `PreviewPanel`), issue Preview tab, assistant tools  
**Related:** `docs/superpowers/specs/2026-05-30-issue-dev-server-preview-design.md`, `2026-05-31-public-preview-tunnel-design.md`, `2026-06-17-tracker-agent-tools-design.md`

## Problem

1. **UI density** — In the narrow session Preview dock, `PreviewPanel` stacks a tunnel essay, three equal issue-level buttons, per-server Start/Stop/Restart + Ask Assistant, duplicated URLs, and auto-open logs. Crashed states (e.g. `front` with “Could not load server output”) are hard to scan and act on.

2. **Agent tooling gaps** — `manage_preview` already supports issue-level `status` / `start` / `stop` / `restart`, but agents cannot:
   - target a single server (`front` / `back`)
   - read command output to self-diagnose crashes
   - list previews across a project
   - control the Cloudflare tunnel

3. **Self-heal loop** — When preview fails, tools must return **structured errors** (reason, servers, log tail, next steps) so the agent can fix code / `manage_dev_env` / restart without a human pasting logs.

## Goals

1. Redesign Preview management UI for the dock and shared panel: status-first, one primary CTA, compact server rows, logs on demand.
2. Extend `manage_preview` with per-server control and bounded `output`.
3. Add `list_previews` and `manage_tunnel` as dedicated tools.
4. Enforce an actionable error contract on every unhealthy/failed tool result.

## Non-goals

- Live SSE log streaming through assistant tools (bounded snapshot / tail only).
- Changing port leasing or serve-step authoring (still `manage_dev_env`).
- Replacing the iframe preview when a URL is ready.
- Stopping the OS-level Symphony daemon.

## Decisions

| Decision | Choice |
| --- | --- |
| UI approach | **A** — Compact status-first panel (same component for dock + issue tab) |
| Tool approach | **A + C** — Extend `manage_preview` **and** add `list_previews` + `manage_tunnel` |
| Errors | Structured payloads with `reason`, servers, `output_tail`, `next_steps` so agents self-fix |

## UI design

### Hierarchy

1. **Status strip** — Availability + tunnel state on one line (not a large dashed callout).
2. **Primary action** — One dominant control: Start preview / Open preview / Ask assistant to fix. Stop/Restart live in a secondary control or overflow.
3. **Server list** — Compact rows: `slug · status · port · principal`; Start/Stop/Restart as icon buttons; “Ask assistant” in overflow.
4. **Logs** — Collapsed by default; auto-open only for `crashed` / `starting` / `pending` / `provisioning`. On load failure, show a clear error without an empty dark `<pre>` underneath.

### Density rules

- Do not duplicate primary/public/local URLs at both card and row level; show the primary ready URL once, per-server URLs on the row when useful.
- Issue-level Start/Stop/Restart must not compete as three equal filled buttons in the dock.
- Metadata prefers a single line (`front · :4101 · principal`) over a tall stack.

### Surfaces

- `PreviewPanel` remains shared by `IssuePreviewDock` and the issue drawer Preview tab.
- Dock chrome (tabs, iframe, fullscreen) stays; the management body follows the hierarchy above when details are shown or no URL is ready.

## Assistant tools

### Extend `manage_preview`

| Action | Behavior |
| --- | --- |
| `status` / `start` / `stop` / `restart` | Unchanged for whole-issue scope |
| + optional `server` | Per-server start/stop/restart/status by slug (`front`) or server id |
| + `output` | Bounded command-log tail for one server (requires `server`) |

Keep existing non-blocking start timeout (~30s) and recoverable-start structured results. Enrich server entries with local **and** public tunnel URLs when present.

### New: `list_previews`

- **Scope:** project (and issue-bound variant may omit project slug).
- **Returns:** inventory of issues with preview activity: identifier, availability, per-server status/ports/URLs, tunnel summary.
- Agents use this to discover, then `manage_preview` to act.

### New: `manage_tunnel`

| Action | Behavior |
| --- | --- |
| `status` | Tunnel enabled/running for the issue/project context |
| `start` | Start Cloudflare tunnel (same backend as UI `POST /tunnel/start`) |
| `stop` | Only if backend already supports stop; otherwise return a clear unsupported reason |

### Registration

- Expose on both **chat assistant** (`ToolExecutor`) and **coding-agent** dynamic tools (`DynamicTool`), matching `manage_preview` / `manage_dev_env` today.
- Update agent session tool blurbs / prompts to mention `list_previews`, per-server `manage_preview`, `output`, and `manage_tunnel`.

## Error contract (required)

Every failed or unhealthy tool result must be **actionable for self-fix**:

| Field | Purpose |
| --- | --- |
| Failure signal | `{:error, …}` **or** `ok: false` / explicit unhealthy outcome — never silent empty success |
| `reason` | Machine-readable (`crashed`, `start_failed`, `no_serve_step`, `tunnel_failed`, `output_unavailable`, …) |
| `message` | Short human summary |
| `server` / `servers` | Which process(es) failed + status |
| `output_tail` | Last N lines of command log when available (especially crash / start failure) |
| `next_steps` | Concrete follow-ups (`manage_dev_env`, fix code, `restart`, poll `status`) |

Also:

- `status` and `list_previews` surface crashed/unavailable servers as actionable data, not “all good”.
- Recoverable start failures keep structured payloads **and** attach `output_tail` when possible.
- Config errors (`no_serve_step`, workspace missing, disabled) remain hard errors with setup hints.

## Architecture

```
UI: PreviewPanel (status strip → primary CTA → server rows → logs)
      └─ useIssueDevServers (REST + SSE) — unchanged contracts preferred

Tools:
  manage_preview  → DevServer.Manager (+ per-server + output snapshot)
  list_previews   → project inventory over Manager / DevServer views
  manage_tunnel   → Cloudflare.Tunnel (+ existing tunnel HTTP)
```

## Testing

- Tracker: PreviewPanel layout tests (primary CTA, collapsed logs, crashed row); dock still opens management when no URL.
- Elixir: `PreviewTools` per-server + `output` + error payload with `output_tail`; `list_previews` inventory; `manage_tunnel` status/start (+ stop if supported).
- Manual: session dock on a crashed `front` server; agent turn that reads `output` and restarts.

## Implementation notes

- Prefer extending `SymphonyElixir.Assistant.PreviewTools` and thin new modules for list/tunnel rather than a parallel REST client.
- Cap `output_tail` size (e.g. last ~80–120 lines or byte budget) so tool results stay model-friendly.
- UI i18n: reuse `issue.preview.*` / `issue.devServer.*`; add keys only where copy changes.
