---
name: symphony-tool-cli
description: >
  Call any Symphony assistant/project tool from the shell via mix symphony.tool
  (list, schema, call with --arg / flags). Use when MCP dynamic tools are not
  exposed in the session, when operating against a running daemon from a
  terminal, or when debugging preview/board/KB/handoff tools. Prefer the MCP
  tool when it is already in the session tool set.
---

# Symphony tool CLI (`mix symphony.tool`)

## When to use

| Situation | Action |
| --- | --- |
| Session exposes the tool (e.g. `manage_preview`) | Call the MCP / dynamic tool |
| Tool missing from the session, or you need a shell one-liner | `mix symphony.tool call … --json` |
| Need the argument schema | `mix symphony.tool schema <name> --json` |
| Discover available names | `mix symphony.tool list` |

Friendly aliases still work: `mix symphony.tracker preview …` (subset only).
Canonical path for **any** tool: `mix symphony.tool`.

## Prerequisites

- Symphony daemon running: `cd elixir && make serve`
- Run Mix from `elixir/` (or with the app as Mix project root)
- `mise exec --` if the environment uses mise

## Commands

```bash
# Catalog (no daemon)
mix symphony.tool list [--json]
mix symphony.tool schema manage_preview [--json]

# Execute (daemon required)
mix symphony.tool call <tool_name> [--project SLUG|-p SLUG] \
  [--arg key=value ...] \
  [--identifier ID] [--action ACTION] [--status STATUS] [--body TEXT] \
  [--server NAME] [--title TEXT] [--instructions TEXT] [--message TEXT] \
  [--url URL] [--query TEXT] [--path PATH] [--repository REPO] \
  [--step-id ID] [--category CAT] \
  [--json]
```

- `--project` / `-p` required for project-scoped tools; omit for discovery tools
  (`list_tracker_projects`, …) and for `list_running_agents` (all projects).
- `--arg key=value` sets any `inputSchema` property. JSON literals decode
  (`true`, `false`, `null`, numbers, `{…}`, `[…]`).
- `--category` maps to `category_filter` (same as `symphony.tracker dev-env`).
- `--json` prints one JSON object `{tool, message, data}`.

## Examples

```bash
# Preview status (leased ports)
mix symphony.tool call manage_preview -p advising \
  --identifier CDE-1180 --action status --json

# Preview start
mix symphony.tool call manage_preview -p advising \
  --identifier CDE-1180 --action start --json

# DevEnv serve steps
mix symphony.tool call manage_dev_env -p advising \
  --action list_steps --category serve --json

# Board
mix symphony.tool call get_issue -p advising --identifier CDE-1180 --json
mix symphony.tool call list_issues -p advising --arg search=preview --json

# Handoff / evidence
mix symphony.tool call check_handoff_gate -p advising --identifier CDE-1180 --json
mix symphony.tool call get_evidence_status -p advising --identifier CDE-1180 --json

# Discovery (no project)
mix symphony.tool call list_tracker_projects --json
```

## Agent policy

1. Prefer the in-session tool when available.
2. If missing, use `mix symphony.tool call <name> -p <slug> … --json` and parse
   the JSON `data` field — do not invent ports or bypass `manage_preview`.
3. On `Could not connect to Symphony daemon`, tell the operator to run
   `make serve` — do not fall back to unmanaged `./vibe` / fixed ports for preview.
4. Spec: `docs/superpowers/specs/2026-07-17-symphony-tool-cli-design.md`.
