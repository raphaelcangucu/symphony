# Jean → Symphony Feature Analysis

> Analysis of [coollabsio/jean](https://github.com/coollabsio/jean) (a Tauri v2 desktop
> app: React 19 + Rust) and what we can adopt into Symphony's orchestrator
> (Elixir backend + React `tracker/` frontend). Source clone analyzed at
> `/tmp/jean-analysis` (Jean v0.1.59).

## 0. The core architectural difference

| | Jean | Symphony |
| --- | --- | --- |
| Shape | Single-user **desktop app** (Tauri) | **Server orchestrator** (Elixir) + web tracker |
| Agent CLIs | claude, codex, cursor, opencode, pi, commandcode, grok (7) | codex, claude, cursor (3) |
| CLI install | App **downloads & manages** binaries in app-data dir | **Detect-only** probe (`--version`), no install |
| Unit of work | Chat **session** inside a **worktree** inside a **project** | Agent **run** keyed by **issue** inside a project |
| Worktrees | First-class, user-facing, full lifecycle UI | Internal child-run detail, no UI, orphans accrue |
| Mode | Plan / Build / Yolo per session (CLI permission flag) | Codex `approval_policy`/sandbox YAML, hardcoded Claude `bypassPermissions` |

**Implication:** We mirror Jean's *UX ideas and data models*, re-homed onto
Symphony's Elixir+Phoenix+React stack. We do **not** copy Tauri/Rust code. Jean's
patterns are exceptionally clean and map well to our `AssistantComposer`,
`CodingAgent` facade, and `AgentExecution` projection.

---

## 1. CLI setup & install (incl. OpenCode) — *what's cool*

**Jean's per-CLI module pattern** (e.g. `src-tauri/src/opencode_cli/commands.rs`,
`src/services/opencode-cli.ts`, `src/types/opencode-cli.ts`):

- Uniform command surface per CLI: `detect_*_in_path`, `check_*_installed`,
  `check_*_auth`, `get_available_*_versions`, `install_*`, `uninstall_*`,
  `list_*_models`.
- **Install flow** = fetch GitHub releases list → pick version (latest default,
  manual entry fallback on rate-limit) → download platform asset → extract binary
  → chmod / de-quarantine → verify → emit staged **progress events**
  (`starting/downloading/extracting/verifying/complete` with percent).
- **Shared onboarding UI** (`src/components/onboarding/CliSetupComponents.tsx`):
  `CliPathSelector` (use system PATH **vs** app-managed), `SetupState` (version
  select + install), `InstallingState` (progress bar), `AuthCheckingState`,
  `AuthLoginState` (embedded terminal running `<cli> auth login`, auto-advances on
  exit 0), `ErrorState`.
- **Versions cached** to disk with a hardcoded fallback so the UI degrades
  gracefully when GitHub is rate-limited.
- OpenCode specifics: releases from `anomalyco/opencode`; assets like
  `opencode-linux-x64.tar.gz`; auth via `opencode auth list` / `opencode auth login`;
  models via `opencode models [--refresh]` (parsed as `provider/model` ids).

**Symphony today:** `SymphonyElixir.AgentAvailability.probe/0`
(`elixir/lib/symphony_elixir/agent_availability.ex`) only does
`System.find_executable` + `--version`. No OpenCode adapter; agents routed via
`CodingAgent.adapter_for/1` (`elixir/lib/symphony_elixir/coding_agent.ex:17-20`).

**Adopt:** A guided per-agent **setup/health panel** in tracker settings driven by
an extended availability probe (installed? version? auth? app-server handshake?),
**plus** a 4th `OpenCode` adapter mirroring the Claude/Cursor `CliRunner` pattern
(`claude/app_server/cli_runner.ex`, `cursor/cli_runner.ex`). Because Symphony runs
server-side, "install" is best surfaced as **copy-paste install commands + a
re-probe button** (and optionally a `mix symphony.agents.install` helper) rather
than downloading binaries the way the sandboxed desktop app does.

---

## 2. Execution control — *what's cool*

This is Jean's strongest UX area and maps directly onto our `AssistantComposer`.

### 2a. Model picker with fast search (`src/components/chat/toolbar/BackendModelPickerContent.tsx`)
- A `cmdk` `Command` list with an **always-focused search input** filtering across
  every backend's models (`label + id` substring match).
- **Backend sidebar** (vertical tabs) with `⌘1`–`⌘9` to jump backends; per-backend
  beta dot.
- **Favorites** (★) pinned to the top, persisted in preferences.
- **Per-model "Fast" toggle** (⚡, `⌘F` on the highlighted row) for priority/fast
  tiers, remembered per base model.
- **Refresh** button re-fetches a remote **model catalog** (`src/services/model-catalog.ts`):
  versioned JSON from a CDN, localStorage-cached, with a bundled fallback;
  per-model metadata: `recommended`, `deprecated`, `hidden`, `supports_thinking`,
  `supports_images`, `fast_id`.

### 2b. Thinking / effort with icons (`src/components/chat/toolbar/toolbar-options.ts`, `src/types/chat.ts`)
- `ThinkingLevel`: `off / think(4K) / megathink(10K) / ultrathink(32K)` (Claude
  token budgets) → maps to `MAX_THINKING_TOKENS`.
- `EffortLevel`: `low / medium / high / xhigh / max / ultracode` (Opus/Codex) with
  human descriptions; per-backend filtered (Codex drops max/ultracode, etc.).

### 2c. Execution mode (`src/components/chat/toolbar/ExecutionModeDropdown.tsx`)
- **Plan** (📋 ClipboardList, yellow, "Read-only"), **Build** (🔨 Hammer,
  "Auto-edits"), **Yolo** (⚡ Zap, red, "No limits!").
- `Shift+Tab` cycles modes; per-backend support (`getSupportedExecutionModes`);
  maps to CLI permission flags (`--permission-mode plan|acceptEdits|bypassPermissions`).

### 2d. Keyboard shortcuts (`src/types/keybindings.ts`)
- A **central, user-editable keybinding registry** (`DEFAULT_KEYBINDINGS` +
  `KEYBINDING_DEFINITIONS` with label/description/category) and helpers
  (`eventToShortcutString`, `eventMatchesShortcut`, `formatShortcutDisplay`).
- ~40 actions: focus input (`⌘L`), open model dropdown (`⌘⇧M`), thinking dropdown
  (`⌘⇧E`), cycle mode (`⇧Tab`), execute run (`⌘R`), next/prev session, etc.

### 2e. Mentions & slash commands
- **Context mentions** (`@`) — `ContextMentionPopover.tsx` + `useContextMentionData.ts`:
  cite **GitHub issues / PRs / security alerts / advisories / Linear issues** with
  live search + exact-number lookup + "include closed/merged" toggle, grouped with
  per-type icons and badges.
- **File mentions** — `FileMentionPopover.tsx` / `FileMentionBadge.tsx`.
- **Slash commands** (`/`) — `SlashPopover.tsx`: fuzzy search across backend
  **commands + skills**, grouped by backend/plugin, icons (Terminal vs Wand2),
  keyboard nav. (Backed by `useAllBackendSkills`.)

**Symphony today:** `AssistantComposer.tsx` already has an `AgentMenu`, a
**searchable** `ModelMenu`, an `EffortMenu`, attachments, voice, and a 3-item slash
palette (`/goal /infer /btw`). **Gaps:** model/effort are **dropped** on the
execution path (`ExecutionControlComposer` → REST `dispatchIssueAgent` only sends
`action/agent/goal/instructions`); **no Plan/Build/Yolo**; **no `@` issue/file
mentions** in the composer (only assignee `@` in comments via
`useCommentMentions.ts`); **no central shortcut registry** (ad-hoc Enter/Tab +
board-only `⌘K`); model picker is a simple dropdown, not the multi-backend
favorites/fast `cmdk` picker.

**Adopt:** (a) thread `model`/`effort`/`mode` through the **orchestrator dispatch**
path (`issueDispatch.ts` → `IssueController.dispatch_agent` → `AgentRunner` →
`CodingAgent.run_turn` opts); (b) add a **Plan/Build/Yolo** mode mapped per agent
(Codex `approval_policy`+sandbox, Claude `--permission-mode`, Cursor `--force`);
(c) upgrade `ModelMenu` to a `cmdk` picker with favorites + search; (d) add a
central keybinding registry + assistant command palette; (e) add `@`
issue/file/doc mentions and a richer slash menu in `AssistantComposer`.

---

## 3. Hierarchical project / worktree organization — *what's cool*

**Jean** (`src/components/projects/ProjectTree.tsx`, `WorktreeItem.tsx`,
`WorktreeList.tsx`):
- Left sidebar is a **nested tree**: **Folders → Projects → Worktrees (base +
  feature) → Sessions**, drag-and-drop reorder, expand/collapse all,
  `MAX_NESTING_DEPTH`.
- Each worktree row shows **git status** (behind / unpushed / uncommitted counts),
  a base-worktree marker (`isBaseSession`), and expands to its sessions
  (`useSessions(worktree.id, worktree.path)`), grouped by run status.
- Full worktree lifecycle: create (`NewWorktreeModal`), archive, restore, delete,
  rename, context menus.

**Symphony today:** Projects live in SQLite + cloned repos under a configurable
workspace root (`Config.workspace_root`, default `/tmp/symphony_workspaces`),
multi-repo first-class. **Git worktrees exist only as an internal child-run
mechanism** (`Workspace.Worktree`, `<repo>/.worktrees/<slug>`) with **no UI, no
lifecycle management** (`Worktree.remove/2` has no production caller → orphans
accumulate). The tracker has no project tree; navigation is Project → Board/List →
issue drawer.

**Adopt:** A **project workspace explorer** in the tracker that visualizes
**Project → repos → worktrees → issue runs** with git-status badges, plus a
first-class worktree registry + lifecycle (create/list/archive/delete/cleanup).
This is the **largest** of the four areas and the biggest divergence from
Symphony's issue-centric model — needs the most scoping.

---

## 4. Easily accessible sessions within a project — *what's cool*

**Jean:** Sessions are always one expand away in the sidebar tree, grouped by
status, with quick switching (`⌘⌥←/→`), "finished/unread sessions" popover
(`⌘⇧F`), recap/digest, archive with retention, auto-naming.

**Symphony today:** A "session" = orchestrator worker keyed by an **issue**,
projected as `AgentExecution` (`agent_execution.ex`); **no first-class session
table**; logs live in `~/.codex` / `~/.claude` / `~/.cursor`. To reach a run you go
Project → Board/List → issue → **Agent tab → Execution**. There's a global
**Observability** page and a cross-project **Recents** (capped at 20). There is
**no project-scoped session index** and **no history of past runs per issue**.

**Adopt:** A **project-scoped "Sessions/Runs" panel** (a left-rail or a project tab)
listing live + recent + saved runs for the project, grouped by status, with
deep-links into the issue Agent tab and quick resume/steer — built on the existing
`AgentExecution` projection + `session_log` facade, optionally backed by a new
lightweight **run-history** store so past runs persist.

---

## 5. Other Jean ideas worth stealing (bonus)

- **Magic Commands** (`src/components/magic/`): one-shot AI flows — investigate
  issue/PR, code review with finding tracking, AI commit msg, PR description,
  release notes, conflict resolution — each with per-prompt model/backend/effort.
  (Symphony has skills like `commit`/`land`/`push`; a UI palette around them would
  echo this.)
- **Saved contexts / session recap** with AI summarization.
- **Remote/headless web access** with token auth (Symphony already has the tracker
  web UI + tunnels, but Jean's `--headless` model is a clean reference).
- **Per-model favorites & "fast tier"** as a general preference primitive.

---

## 6. Proposed plan breakdown (for approval)

1. **Plan 1 — Agent CLI setup & OpenCode integration**: extend `AgentAvailability`
   into a health probe (installed/version/auth), add the OpenCode `CodingAgent`
   adapter + routing + catalog, and a tracker **Agent Setup** settings panel
   (status + install commands + re-probe + auth check).
2. **Plan 2 — Execution control upgrade**: `cmdk` model picker (search + favorites +
   fast), thinking/effort with icons, **Plan/Build/Yolo** mode threaded through
   orchestrator dispatch, central keybinding registry + assistant command palette,
   `@` issue/file mentions + richer slash menu.
3. **Plan 3 — Hierarchical project/worktree organization**: first-class worktree
   registry + lifecycle, and a tracker **workspace explorer** (Project → repos →
   worktrees → runs) with git-status badges.
4. **Plan 4 — Easily accessible sessions**: project-scoped Sessions/Runs panel +
   run-history persistence + deep-links/resume.

> Plan 2 can be split (2a model/thinking/mode picker; 2b mentions/slash/shortcuts)
> if we want smaller shippable units.
