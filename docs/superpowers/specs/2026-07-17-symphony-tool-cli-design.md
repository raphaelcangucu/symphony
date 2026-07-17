# Generic Symphony tool CLI (`mix symphony.tool`)

**Date:** 2026-07-17  
**Status:** Accepted / implemented — 2026-07-17  
**Surfaces:** Mix CLI, `SymphonyElixir.Tracker.Cli`, `ToolExecutor` / discovery tools, agent skills  
**Related:**  
`mix symphony.tracker` (friendly subset; remains supported),  
issue-bound tool exposure work (2026-07-17),  
preview / Runtime Contract tooling (`manage_preview`, `manage_dev_env`)

## 1. Problem

Assistant project tools (`manage_preview`, board tools, KB, handoff, etc.) are
implemented once in `ToolExecutor` and advertised to chat / coding agents as MCP
dynamic tools. When a session does not expose a tool, or an operator wants the
same action from a shell, there is no **canonical, schema-driven** CLI that covers
**all** tools with arbitrary parameters.

`mix symphony.tracker` already covers a **friendly subset** (preview, handoff,
dispatch, …) over `:erpc` → `Tracker.Cli`. It does not scale to every tool and
every `inputSchema` property without endless per-command Mix tasks.

## 2. Goals

1. Ship **`mix symphony.tool`** — a generic CLI that can **list**, **show schema
   for**, and **call** any project/assistant tool by name, passing parameters.
2. Reuse the same in-daemon execution path as chat (`Tracker.Cli` →
   `ToolExecutor` / discovery), so behavior and DB ownership stay identical.
3. Document the CLI for agents via a **skill** + this spec, with `@moduledoc` as
   the flag source of truth (`mix help symphony.tool`).
4. Keep **`mix symphony.tracker`** as a compatibility / ergonomic subset; point
   agents at `symphony.tool` as the canonical path.

## 3. Non-goals

- Removing or rewriting every `symphony.tracker` subcommand in this change.
- HTTP/token CLI alternative to distributed Erlang (`:erpc`).
- Interactive approval UI for mutating tools in the CLI (daemon executes as
  `ToolExecutor` does today).
- Shell wrappers outside Mix / mise.
- Auto-generating one Mix task file per tool name.

## 4. Architecture

```text
mix symphony.tool list|schema|call
        │
        ├─ list / schema ──► ToolExecutor.tool_specs() (+ discovery specs)
        │                      (local BEAM; no daemon required)
        │
        └─ call ──► :erpc ──► Tracker.Cli.call(tool, slug, args)
                                  │
                                  ├─ DiscoveryTools / RunningAgentsTools
                                  └─ ToolExecutor.execute(slug, tool, args)
```

### 4.1 Commands

| Subcommand | Daemon? | Behavior |
| --- | --- | --- |
| `list [--json]` | No | Print tool names + short descriptions (and required arg names from schema). |
| `schema <tool_name> [--json]` | No | Print full `inputSchema` + description for one tool. |
| `call <tool_name> …` | **Yes** (`make serve`) | Build argument map, validate required keys lightly, `:erpc` to daemon, print result. |

### 4.2 Invocation shape

```bash
# List
mix symphony.tool list [--json]

# Schema
mix symphony.tool schema manage_preview --json

# Call — universal args
mix symphony.tool call manage_preview --project advising \
  --arg identifier=CDE-1180 \
  --arg action=status \
  [--json]

# Call — common flag aliases (same keys as schema properties)
mix symphony.tool call manage_preview -p advising \
  --identifier CDE-1180 --action start [--server advising] [--json]
```

**Rules**

- `--project` / `-p`: required for tools that need a project slug; omitted for
  discovery tools that are project-agnostic (e.g. `list_tracker_projects`) and
  for `list_running_agents` when listing all projects (same semantics as
  `Tracker.Cli` today).
- `--arg key=value`: sets any `inputSchema` property. Values are strings by
  default. If the value parses as JSON (`true` / `false` / `null` / number /
  `{…}` / `[…]`), decode to the corresponding Elixir term before call.
- Flag aliases: a fixed allowlist of frequent keys mapped to the same property
  names (`identifier`, `action`, `status`, `body`, `server`, `title`,
  `instructions`, `message`, `url`, `query`, `path`, `repository`, `step_id`,
  `category` → `category_filter` for `manage_dev_env` parity with
  `symphony.tracker`). Aliases are optional sugar over `--arg`.
- Output: default = human message line + pretty JSON of `data`; `--json` =
  single JSON object `{tool, message, data}` (or the executor’s structured map).
- Unknown tool name → non-zero exit with hint to `list` / `schema`.
- Missing required schema keys → fail **before** `:erpc` with the list of
  missing keys (best-effort from `inputSchema.required`).

### 4.3 Spec sources

v1 catalogs tools from:

1. `ToolExecutor.tool_specs()` — primary project/assistant surface.
2. `DiscoveryTools.tool_specs()` — project-agnostic discovery (same as freeform /
   `Tracker.Cli` discovery path).

Dynamic GraphQL tools from `DynamicTool.tool_specs()` (`github_graphql`,
`linear_graphql`) are **included in `list`/`schema`** and callable when the
daemon supports them via `ToolExecutor` / combined executors — if
`Tracker.Cli` does not yet route them, extend `Tracker.Cli.call/3` to dispatch
those names through the same path chat uses (`DynamicTool` or combined
executor). Prefer one daemon entrypoint, not a second CLI RPC module.

### 4.4 Module layout

| Module | Role |
| --- | --- |
| `Mix.Tasks.Symphony.Tool` | Argv parse; `list` / `schema` / `call`; daemon connect (mirror `Symphony.Tracker` / `Ctl`) |
| `SymphonyElixir.Tracker.Cli` | Extend as needed so every listed tool name is executable |
| Tests | `test/mix/tasks/symphony_tool_test.exs` — `build/1` / argv → tool+args mapping, schema listing, required-arg validation (no live daemon in unit tests) |

### 4.5 Agent documentation

| Artifact | Purpose |
| --- | --- |
| This spec | Design + acceptance |
| `.claude/skills/symphony-tool-cli/SKILL.md` | When to use CLI vs MCP; examples (`manage_preview`, `manage_dev_env`, board, KB); `--json`; daemon prerequisite |
| `@moduledoc` on `Mix.Tasks.Symphony.Tool` | Flags and examples for `mix help symphony.tool` |

**Agent policy (skill):** Prefer the MCP / dynamic tool when it is in the
session’s tool set. If missing or blocked, use
`mix symphony.tool call <name> -p <slug> … --json` from a shell with the Symphony
repo / `elixir/` cwd and a running daemon.

## 5. Error handling

| Case | Behavior |
| --- | --- |
| Unknown subcommand / tool | Exit non-zero; message points to `list` / `mix help` |
| Missing `--project` when required | Exit non-zero before RPC |
| Missing required args | Exit non-zero listing missing keys |
| Daemon unreachable | Same message style as `symphony.tracker` (`make serve` first) |
| Tool `{:error, reason}` | Exit non-zero; print `inspect(reason)` or JSON error when `--json` |

## 6. Testing

- Unit: argv builder maps `call manage_preview -p advising --arg action=status --identifier X` → tool + slug + args map.
- Unit: `list` includes `manage_preview`, `list_issues`, a discovery tool.
- Unit: `schema manage_preview` returns non-empty `inputSchema.properties.action`.
- Unit: JSON value decode for `--arg` (`--arg optional=true` → boolean).
- One targeted Mix test file only under WSL (no full suite).

## 7. Acceptance

1. `mix symphony.tool list` shows every `ToolExecutor` + discovery tool name.
2. `mix symphony.tool schema <any listed tool>` prints a usable schema.
3. `mix symphony.tool call manage_preview -p <slug> --identifier <id> --action status --json` returns structured status against a running daemon (manual smoke).
4. Skill + `mix help symphony.tool` document the agent-facing workflow.
5. `mix symphony.tracker preview …` still works (compat).

## 8. Decisions (resolved)

| Topic | Decision |
| --- | --- |
| Shape | **Generic** `mix symphony.tool` only (not hybrid friendly+generic as primary) |
| Docs | Skill under `.claude/skills/symphony-tool-cli/` + this spec |
| Compat | Keep `symphony.tracker` |
| Arg encoding | `--arg key=value` + common flag aliases |
| Schema/list offline | Local specs; `call` requires daemon |
