# Symphony Tool CLI Implementation Plan

**Goal:** Ship `mix symphony.tool` (list / schema / call) over `Tracker.Cli` + agent skill docs.

**Architecture:** One Mix task parses argv; list/schema read local specs; call uses `:erpc` to `Tracker.Cli`. Extend Cli for DynamicTool GraphQL names. Fix PreviewTools identifier resolve for IssueRecord (CLI/chat without bound `%Issue{}`).

**Tech Stack:** Elixir Mix tasks, ToolExecutor, DiscoveryTools, DynamicTool, ExUnit.

**Status:** Implemented 2026-07-17

---

### Task 1: Failing tests for argv builder — done
### Task 2: Implement `Mix.Tasks.Symphony.Tool` — done
### Task 3: Extend `Tracker.Cli` for graphql tools — done
### Task 4: Skill + mark spec Accepted — done
### Task 5: Targeted test + smoke `list`/`schema`/`call manage_preview` — done
