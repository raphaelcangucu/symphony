# Load Context — Composer Integration (Jean parity)

**Date:** 2026-07-03  
**Worktree:** `combined-preview`  
**Status:** Approved (brainstorm)

## Summary

Bring Jean's **Load Context** experience into Symphony's single shared composer: a tabbed, searchable sheet to attach persistent context (saved recaps, sessions, GitHub issues, PRs, security alerts, and **local board issues**) that is automatically injected into every steer/dispatch/message. The UI is one configurable composer component, while context persistence remains separated by runtime scope (`execution` vs `assistant`) so each conversation channel gets the right briefing.

## Decisions (locked)

| Question | Choice |
| --- | --- |
| Composer model | **One shared composer** — `SymphonyComposer` with feature flags and presets |
| Store model | **Separate** — `execution` scope (per issue) vs `assistant` scope (per `thread_id`) |
| Hard reset | **Persist** — attached contexts survive `hard_reset` |
| Linear tab | **Replaced** with **Board** — local tracker issues (`listIssues` / `getIssue` / comments) |
| Security tab | **In scope** — Dependabot alerts + repository advisories (GitHub API) |
| Save Context | **In scope** — AI session recap via built-in `context-summary` prompt template |

## Jean reference

Analyzed at `/tmp/jean-analysis` (Jean v0.1.x):

- `LoadContextModal.tsx` — 5 tabs, unified search, keyboard nav (`Ctrl+1..5`)
- `useLoadContextData.ts` / `useLoadContextHandlers.ts` — attach/detach/preview
- Persistent injection via `get_session_context_content()` on every agent turn
- Toolbar dropdown in `DesktopToolbarControls.tsx` — loaded items + "Manage Contexts…"
- `generate_context_from_session` — AI recap → `saved_contexts` library

Symphony re-homes this onto Elixir + React tracker (no Tauri).

## Architecture

### Single Composer Contract

Symphony should have **one composer component** responsible for the visual and interaction model: textarea, attachments, agent/model/effort controls, slash commands, `@` / `#` context picks, Load Context, execution mode, queue controls, goal pill, and submit buttons. Different surfaces configure that component instead of manually composing toolbar fragments.

Current implementation reality in `combined-preview`:

```text
Execution surface
  ExecutionControlComposer
    AssistantComposer

Project Assistant surface
  ProjectAssistantPanel
    AssistantComposer
```

Target implementation:

```text
Execution surface
  ExecutionControlComposer (thin runtime adapter)
    SymphonyComposer preset="execution"

Project Assistant surface
  ProjectAssistantPanel (thin runtime adapter)
    SymphonyComposer preset="assistant" | "assistantIssue"
```

The existing `AssistantComposer` should evolve into `SymphonyComposer` (or be renamed only after the behavior lands). It receives a `features` object and a `contextBinding`, not ad-hoc toolbar fragments for core product features.

```ts
type ComposerPreset = "execution" | "assistant" | "assistantIssue";

interface ComposerFeatures {
  mentions?: boolean;
  contextChips?: boolean;
  loadContext?: boolean;
  attachments?: boolean;
  voice?: boolean;
  slashCommands?: boolean;
  agentPicker?: boolean;
  modelPicker?: boolean;
  effortPicker?: boolean;
  executionMode?: boolean;
  magicCommands?: boolean;
  queue?: boolean;
  runControls?: boolean;
  goalPill?: boolean;
}

interface ComposerContextBinding {
  scope: "execution" | "assistant";
  projectSlug: string;
  issueIdentifier?: string | null;
  threadId?: number | null;
}
```

Presets define defaults; callers can override individual features when a surface needs a slimmer composer:

| Preset | Binding | Default features |
| --- | --- | --- |
| `execution` | `scope=execution`, `projectSlug`, `issueIdentifier` | mentions, contextChips, loadContext, attachments, slashCommands, agent/model/effort picker, executionMode, magicCommands, queue, runControls, goalPill |
| `assistant` | `scope=assistant`, `projectSlug`, `threadId` | mentions, contextChips, loadContext, attachments, voice, slashCommands, agent/model/effort picker |
| `assistantIssue` | `scope=assistant`, `projectSlug`, `threadId`, `issueIdentifier` | assistant preset + executionMode |

`toolbarAfterAttach` remains available only as an extension slot for exceptional add-ons. First-party controls such as Load Context, execution mode, magic commands, and run controls should be toggled by `features`.

### Scopes

```text
execution:{project_slug}:{issue_identifier}
  → SymphonyComposer preset="execution" / SessionLogChannel steer / IssueDispatch

assistant:{thread_id}
  → SymphonyComposer preset="assistant" / AssistantChannel send_message + steer_turn
```

### Data model

**`attached_contexts`** — persistent attachments per scope:

| Column | Notes |
| --- | --- |
| `scope` | `"execution"` \| `"assistant"` |
| `project_slug` | Always set |
| `issue_identifier` | Required when `scope=execution` |
| `thread_id` | Required when `scope=assistant` |
| `kind` | See kinds below |
| `ref_key` | Stable id within kind |
| `title` | Display label |
| `content_md` | Snapshot at attach time |
| `metadata` | JSON (url, repo, status, …) |
| `position` | Injection order |

**Kinds:**

| Kind | Tab source | `ref_key` example |
| --- | --- | --- |
| `saved` | Contexts | `implement-auth-flow` |
| `session` | Contexts | `SYM-4` (source issue run) |
| `github_issue` | GitHub Issues | `gamba/backend#42` |
| `pr` | PRs | `gamba/backend#17` |
| `security_alert` | Security | `gamba/backend#3` (alert number) |
| `advisory` | Security | `GHSA-xxxx-xxxx` |
| `board_issue` | Board | `SYM-12` |

**`saved_contexts`** — global/project library (Jean `session-context/`):

| Column | Notes |
| --- | --- |
| `project_slug` | Originating project |
| `slug` | AI-generated slug |
| `name` | Optional display name (first `#` heading) |
| `content_md` | Recap markdown |
| `source_scope` | `execution` \| `assistant` |
| `source_issue_identifier` | Nullable |
| `source_thread_id` | Nullable |
| `metadata` | Model, effort, size, … |

### Tabs (5 — Jean keyboard slots)

| # | Shortcut | Tab | Data source |
| --- | --- | --- | --- |
| 1 | `Ctrl+1` | **Contexts** | `saved_contexts` + project sessions (`AgentExecution`) |
| 2 | `Ctrl+2` | **GitHub Issues** | GitHub REST/GraphQL per configured repo (`supported: false` when no token/repos) |
| 3 | `Ctrl+3` | **PRs** | `GET /projects/:slug/pull_requests` (existing launcher endpoint) |
| 4 | `Ctrl+4` | **Security** | New `GET /projects/:slug/security_advisories` (Dependabot + repo advisories) |
| 5 | `Ctrl+5` | **Board** | Local tracker `listIssues` + `getIssue` + `listComments` (replaces Jean Linear) |

### Context resolution (server-side on attach)

Each `POST …/contexts` carries `{ kind, ref_key, … }`. Server fetches markdown once and stores snapshot:

- **`board_issue`** — issue fields + recent comments from local tracker
- **`github_issue`** — title, body, labels, comments via GitHub API
- **`pr`** — title, body, review comments (reuse `GitHub.PullRequests` / conversation)
- **`security_alert`** / **`advisory`** — formatted alert/advisory markdown (mirror Jean `format_security_context_markdown`)
- **`session`** — `SessionLog` tail + goal/turn summary for the source issue's latest run
- **`saved`** — copy from `saved_contexts` row

### Injection

On every outbound message:

1. Load `attached_contexts` for the active scope (ordered by `position`, `inserted_at`)
2. Resolve any draft `context_refs` sent by `@` / `#` quick chips for this turn only
3. Concatenate persistent and draft context into a `## Loaded Context` block (sections per kind)
4. Append after operator text (legacy manually typed `@type:id` tokens still expand as fallback)

**Injection sites:**

| Path | Module |
| --- | --- |
| Execution steer | `SessionLogChannel` → `Orchestrator.steer/4` |
| Execution dispatch | `IssueDispatch` instructions builder |
| Assistant message | `AssistantChannel` `send_message` |
| Assistant steer | `AssistantChannel` `steer_turn` |

Client may also prepend for immediate UX, but **server injection is authoritative** (Jean model).

### Save Context

- Toolbar action + magic command `save-context`
- `POST /projects/:slug/saved-contexts` with `{ source_scope, source_issue_identifier?, source_thread_id? }`
- Server loads conversation (session log or assistant message history), renders built-in `context-summary` prompt template, calls coding agent (no tools), parses JSON `{ slug, summary }`, persists `saved_contexts` row
- Optional attach-to-current-scope in same request

### UI

**Shared components:**

- `LoadContextSheet` — dialog, tab bar, search, list, preview pane
- `AttachedContextsMenu` — composer toolbar badge + dropdown (view/remove/manage)
- `ComposerContextChip` — visual chip shown above the textarea for any context associated with the draft (Jean/Cursor-style file chip)
- `useAttachedContexts(scopeKey)` — CRUD hook (`useState`/`useEffect`, no TanStack Query)
- `useLoadContextData({ scope, projectSlug, … })` — per-tab fetching

**Composer integration:**

- `SymphonyComposer` — owns the Load Context toolbar button, badge, sheet, and feature toggles
- `ExecutionControlComposer` — thin runtime adapter: supplies `preset="execution"`, `contextBinding={ scope: "execution", projectSlug, issueIdentifier }`, execution callbacks, and run state
- `ProjectAssistantPanel` — thin runtime adapter: supplies `preset="assistant"` or `preset="assistantIssue"`, `contextBinding={ scope: "assistant", projectSlug, threadId, issueIdentifier }`, channel callbacks, and assistant state
- Feature flags decide which buttons/components render; caller-provided slots are not used for core features

**Interactions:**

- Enter / click → attach (persist + badge +1)
- Shift+Enter / View → markdown preview
- Delete on selected attached row → detach
- `includeClosed` toggle on GitHub Issues / PRs / Security tabs (Jean parity)
- `@` and `#` inside the composer open the same context picker (issues / files / PRs / docs / saved contexts as enabled by the current preset)
- Selecting an `@` / `#` item removes the trigger text and adds a **context chip** above the message, like Jean's file chip in the composer
- Context chips are sent as structured `context_refs` with the message; server-side injection is still authoritative
- Quick-picked `@` / `#` chips are **draft-scoped** by default: they apply to the next message only and clear after send, unless the operator chooses a "keep loaded" action from the chip menu
- Contexts loaded through `LoadContextSheet` render in the same chip rail with a persistent/loaded visual state and remain attached to the scope until removed

### Hard reset behavior

**Persist (choice B):** `hard_reset` does **not** delete `attached_contexts` for the issue. Operator explicitly removes items or attaches fresh context.

### Error handling

- GitHub tabs degrade gracefully: `supported: false` → empty state with setup hint (token / repo config)
- Attach resolver failures return `422` with clear reason; no partial row
- Duplicate attach (same `scope + kind + ref_key`) → idempotent upsert (refresh `content_md`, keep position)

### Testing

- ExUnit: schema, resolvers, controllers, injection in steer/dispatch/channel
- Vitest: composer presets/features, sheet tabs, attach/detach, toolbar badge, execution adapter, assistant adapter
- Preview stack: `symphony-tracker` project, `SYM-*` issues

### Out of scope

- Cross-project saved context search (v2 follow-up)
- Auto-save context on run complete (preference toggle — Jean has it, defer)
- KB / freeform assistant scopes (only `execution` + `assistant` project/issue threads)

## Related plans

- [`2026-06-26-execution-control-mentions-shortcuts-plan.md`](../plans/2026-06-26-execution-control-mentions-shortcuts-plan.md) — existing `@` mention foundation that this work evolves into `@` / `#` context chips
- [`2026-06-29-session-quick-open-launcher-plan.md`](../plans/2026-06-29-session-quick-open-launcher-plan.md) — project PRs endpoint, security deferred note
- [`2026-06-27-magic-prompts-templates-plan.md`](../plans/2026-06-27-magic-prompts-templates-plan.md) — `PromptTemplates` store for `context-summary`
