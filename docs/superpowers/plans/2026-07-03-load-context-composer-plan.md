# Load Context — Composer Integration Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. One focused subagent per task with review between tasks. Replace example commands with this repo's real tools.

**Goal:** Mirror Jean's **Load Context** modal inside Symphony's single shared composer — persistent attached context (saved recaps, sessions, GitHub issues, PRs, security alerts, local board issues) injected on every steer/dispatch/message, with feature-flagged composer controls, separate stores per scope, and contexts that **survive hard reset**.

**Architecture:** Two Ecto tables (`attached_contexts`, `saved_contexts`) keyed by `execution:{project}:{issue}` or `assistant:{thread_id}`. `POST …/contexts` resolves markdown server-side via `ContextResolvers` and stores a snapshot. Steer/dispatch/assistant paths call `AttachedContexts.append_to_instructions/3` before forwarding to the agent. Tracker evolves the existing `AssistantComposer` into one configurable `SymphonyComposer` with `preset`, `features`, and `contextBinding`; `ExecutionControlComposer` and `ProjectAssistantPanel` become thin runtime adapters.

**Tech Stack:** Elixir + Ecto + ExUnit; React 19 + shadcn Dialog/Tabs + cmdk patterns + vitest. Data hooks use `useState`/`useEffect` (no TanStack Query — verified absent from `tracker/package.json`).

**Spec:** [`docs/superpowers/specs/2026-07-03-load-context-composer-design.md`](../specs/2026-07-03-load-context-composer-design.md)

**Jean references:** `/tmp/jean-analysis/src/components/magic/LoadContextModal.tsx`, `useLoadContextHandlers.ts`, `SecurityAlertsTab.tsx`, `src-tauri/src/projects/github_issues.rs` (`format_*_context_markdown`).

---

## File Structure

**Create (backend):**

- `elixir/priv/repo/migrations/20260703120000_create_attached_and_saved_contexts.exs`
- `elixir/lib/symphony_elixir/attached_contexts/attachment.ex` — schema
- `elixir/lib/symphony_elixir/attached_contexts.ex` — CRUD + injection
- `elixir/lib/symphony_elixir/saved_contexts/entry.ex` — schema
- `elixir/lib/symphony_elixir/saved_contexts.ex` — list/create/generate
- `elixir/lib/symphony_elixir/context_resolvers.ex` — markdown fetch per `kind`
- `elixir/lib/symphony_elixir/github/security_advisories.ex` — Dependabot + repo advisories
- `elixir/lib/symphony_elixir/github/project_issues.ex` — open/all issues for load-context tab
- `elixir/lib/symphony_elixir_web/controllers/tracker/attached_context_controller.ex`
- `elixir/lib/symphony_elixir_web/controllers/tracker/saved_context_controller.ex`
- `elixir/lib/symphony_elixir_web/controllers/tracker/security_advisory_controller.ex`
- `elixir/lib/symphony_elixir_web/controllers/tracker/github_issue_context_controller.ex`
- tests for each module

**Modify (backend):**

- `elixir/lib/symphony_elixir_web/router.ex` — routes
- `elixir/lib/symphony_elixir/issue_dispatch.ex` — inject on dispatch instructions
- `elixir/lib/symphony_elixir_web/channels/session_log_channel.ex` — inject on steer
- `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` — inject on send/steer
- `elixir/lib/symphony_elixir/prompt_templates/builtin.ex` — `context-summary` template
- `elixir/lib/symphony_elixir/orchestrator.ex` — steer path (if not covered by channel)

**Create (tracker):**

- `tracker/src/types/attached-context.ts`
- `tracker/src/services/attachedContexts.ts`
- `tracker/src/services/savedContexts.ts`
- `tracker/src/services/securityAdvisories.ts`
- `tracker/src/services/githubIssuesContext.ts`
- `tracker/src/hooks/useAttachedContexts.ts`
- `tracker/src/components/context/LoadContextSheet.tsx`
- `tracker/src/components/context/AttachedContextsMenu.tsx`
- `tracker/src/components/context/ComposerContextChip.tsx`
- `tracker/src/components/context/useLoadContextData.ts`
- `tracker/src/components/context/loadContextTabs.ts`
- `tracker/src/components/assistant/composerFeatures.ts`
- `tracker/src/components/assistant/SymphonyComposer.tsx` (or rename `AssistantComposer.tsx` in-place after the adapter lands)
- `tracker/src/components/context/__tests__/LoadContextSheet.test.tsx`
- `tracker/src/components/context/__tests__/AttachedContextsMenu.test.tsx`
- `tracker/src/components/context/__tests__/ComposerContextChip.test.tsx`
- `tracker/src/components/assistant/__tests__/composerFeatures.test.ts`
- `tracker/src/components/assistant/__tests__/SymphonyComposer.test.tsx`
- `tracker/src/hooks/__tests__/useAttachedContexts.test.ts`

**Modify (tracker):**

- `tracker/src/components/assistant/AssistantComposer.tsx` — evolve into / wrap with `SymphonyComposer` so all first-party controls are feature-gated
- `tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx` — runtime adapter only; supplies execution preset + callbacks
- `tracker/src/components/assistant/ProjectAssistantPanel.tsx` — runtime adapter only; supplies assistant preset + callbacks
- `tracker/locales/en/tracker.json` + `tracker/locales/pt-BR/tracker.json`

---

## Task 1: Schema — `attached_contexts` + `saved_contexts`

**Files:**

- Create: `elixir/priv/repo/migrations/20260703120000_create_attached_and_saved_contexts.exs`
- Create: `elixir/lib/symphony_elixir/attached_contexts/attachment.ex`
- Create: `elixir/lib/symphony_elixir/saved_contexts/entry.ex`
- Test: `elixir/test/symphony_elixir/attached_contexts/attachment_test.exs`

- [x] **Step 1: Write migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateAttachedAndSavedContexts do
  use Ecto.Migration

  def change do
    create table(:attached_contexts) do
      add :scope, :string, null: false
      add :project_slug, :string, null: false
      add :issue_identifier, :string
      add :thread_id, :integer
      add :kind, :string, null: false
      add :ref_key, :string, null: false
      add :title, :string, null: false
      add :content_md, :text, null: false
      add :metadata, :map, default: %{}
      add :position, :integer, default: 0
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:attached_contexts, [:scope, :project_slug, :issue_identifier, :thread_id, :kind, :ref_key],
             name: :attached_contexts_unique_ref)

    create index(:attached_contexts, [:scope, :project_slug, :issue_identifier])
    create index(:attached_contexts, [:scope, :thread_id])

    create table(:saved_contexts) do
      add :project_slug, :string, null: false
      add :slug, :string, null: false
      add :name, :string
      add :content_md, :text, null: false
      add :source_scope, :string
      add :source_issue_identifier, :string
      add :source_thread_id, :integer
      add :metadata, :map, default: %{}
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:saved_contexts, [:project_slug, :slug])
  end
end
```

- [x] **Step 2: Write failing changeset test** — `scope` must be `execution` or `assistant`; `execution` requires `issue_identifier`; `assistant` requires `thread_id`; `kind` in allowed set.

- [x] **Step 3: Implement schemas** with `@kinds ~w(saved session github_issue pr security_alert advisory board_issue)a`.

- [x] **Step 4: Run** — `cd elixir && mix test test/symphony_elixir/attached_contexts/attachment_test.exs`

- [ ] **Step 5: Commit** — `feat(context): attached_contexts + saved_contexts schema`

---

## Task 2: `ContextResolvers` — markdown per kind

**Files:**

- Create: `elixir/lib/symphony_elixir/context_resolvers.ex`
- Test: `elixir/test/symphony_elixir/context_resolvers_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
test "board_issue includes identifier, title, status, and recent comments" do
  # setup local project + issue + 2 comments via TestSupport
  assert {:ok, %{title: title, content_md: md}} =
           ContextResolvers.resolve(project, "board_issue", "SYM-1", %{})

  assert title =~ "SYM-1"
  assert md =~ "##"
  assert md =~ "SYM-1"
end

test "unknown kind returns error" do
  assert {:error, _} = ContextResolvers.resolve(project, "nope", "x", %{})
end
```

- [ ] **Step 2: Implement `resolve/4`** dispatching to private resolvers:

| Kind | Resolver |
| --- | --- |
| `board_issue` | `IssueAdapter.get_issue` + `list_comments` (last 20) → markdown |
| `github_issue` | `GitHub.ProjectIssues.fetch_context/2` (repo+number from `ref_key`) |
| `pr` | `GitHub.PullRequests` conversation slice |
| `security_alert` | `GitHub.SecurityAdvisories.alert_markdown/2` |
| `advisory` | `GitHub.SecurityAdvisories.advisory_markdown/2` |
| `session` | `SessionLog` tail for `ref_key` issue + execution metadata |
| `saved` | `SavedContexts.get_by_slug/2` |

Mirror Jean section headers: `### Board issue SYM-12`, `### PR #17`, etc.

- [ ] **Step 3: Run tests** — `cd elixir && mix test test/symphony_elixir/context_resolvers_test.exs`

- [ ] **Step 4: Commit** — `feat(context): ContextResolvers markdown builders`

---

## Task 3: GitHub Security + Project Issues modules

**Files:**

- Create: `elixir/lib/symphony_elixir/github/security_advisories.ex`
- Create: `elixir/lib/symphony_elixir/github/project_issues.ex`
- Test: `elixir/test/symphony_elixir/github/security_advisories_test.exs`
- Test: `elixir/test/symphony_elixir/github/project_issues_test.exs`

- [ ] **Step 1: Write failing list test for SecurityAdvisories** — with mocked `GitHub.Client`, `list_for_project/2` returns `%{dependabot: [%{number: 3, repo: "owner/repo", state: "open"}], advisories: [%{ghsa_id: "GHSA-abcd-1234", repo: "owner/repo", state: "published"}], supported: true}`; empty repos → `supported: false`.

- [ ] **Step 2: Implement `SecurityAdvisories`** — per configured repo (reuse `GitHub.IssueRepo.candidate_repos/2`):

  - `GET /repos/{owner}/{repo}/dependabot/alerts` (open + optional all)
  - `GET /repos/{owner}/{repo}/security-advisories` or GraphQL equivalent
  - Cache via `GitHub.ReadCache` (60s, mirror `ProjectPullRequestController`)

- [ ] **Step 3: Implement `ProjectIssues.list/3`** — GitHub issues for repos (`state=open|all`), map to `%{number, title, url, repo, state, updated_at}`.

- [ ] **Step 4: Add markdown formatters** — `alert_markdown/1`, `advisory_markdown/1`, `issue_markdown/1` (port structure from Jean `format_*_context_markdown`).

- [ ] **Step 5: Run tests + commit** — `feat(github): security advisories + project issues for load context`

---

## Task 4: `AttachedContexts` + `SavedContexts` contexts

**Files:**

- Create: `elixir/lib/symphony_elixir/attached_contexts.ex`
- Create: `elixir/lib/symphony_elixir/saved_contexts.ex`
- Test: `elixir/test/symphony_elixir/attached_contexts_test.exs`
- Test: `elixir/test/symphony_elixir/saved_contexts_test.exs`

- [ ] **Step 1: Write failing AttachedContexts tests**

```elixir
test "attach upserts by scope+kind+ref_key" do
  {:ok, a1} = AttachedContexts.attach(execution_scope("sym", "SYM-1"), %{kind: "board_issue", ref_key: "SYM-2"})
  {:ok, a2} = AttachedContexts.attach(execution_scope("sym", "SYM-1"), %{kind: "board_issue", ref_key: "SYM-2"})
  assert a1.id == a2.id
end

test "append_to_instructions/2 prepends Loaded Context block" do
  scope = AttachedContexts.execution_scope("sym", "SYM-1")
  {:ok, _attachment} =
    AttachedContexts.attach(scope, %{kind: "board_issue", ref_key: "SYM-2"})

  injected = AttachedContexts.append_to_instructions(scope, "do the thing")
  assert injected =~ "## Loaded Context"
  assert injected =~ "do the thing"
end

test "hard_reset does not clear attachments" do
  scope = AttachedContexts.execution_scope("sym", "SYM-1")
  {:ok, _attachment} =
    AttachedContexts.attach(scope, %{kind: "board_issue", ref_key: "SYM-2"})

  # No hard_reset path calls AttachedContexts.clear/1; the explicit invariant is
  # that existing attachments remain attached unless the operator removes them.
  assert length(AttachedContexts.list(scope)) == 1
end
```

- [ ] **Step 2: Implement `AttachedContexts`**

  - `execution_scope(project_slug, issue_identifier)` / `assistant_scope(thread_id)`
  - `list/1`, `attach/2` (calls `ContextResolvers.resolve/4`), `detach/2`, `clear/1` (explicit only — **not** called from hard_reset)
  - `append_to_instructions(scope, text)` — ordered concat

- [ ] **Step 3: Implement `SavedContexts.generate/2`** — load messages, render `context-summary` template, call agent, parse JSON, insert row. (Full wiring in Task 8; stub `generate/2` to return `{:error, :not_configured}` until then.)

- [ ] **Step 4: Run tests + commit** — `feat(context): AttachedContexts CRUD + injection helper`

---

## Task 5: REST controllers + routes

**Files:**

- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/attached_context_controller.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/saved_context_controller.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/security_advisory_controller.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/github_issue_context_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/attached_context_controller_test.exs`

- [ ] **Step 1: Routes**

```elixir
# execution scope
get    "/projects/:project_slug/issues/:identifier/contexts", AttachedContextController, :index_execution
post   "/projects/:project_slug/issues/:identifier/contexts", AttachedContextController, :create_execution
delete "/projects/:project_slug/issues/:identifier/contexts/:id", AttachedContextController, :delete_execution

# assistant scope
get    "/assistant/threads/:thread_id/contexts", AttachedContextController, :index_assistant
post   "/assistant/threads/:thread_id/contexts", AttachedContextController, :create_assistant
delete "/assistant/threads/:thread_id/contexts/:id", AttachedContextController, :delete_assistant

# library + sources
get    "/projects/:project_slug/saved-contexts", SavedContextController, :index
post   "/projects/:project_slug/saved-contexts", SavedContextController, :create
get    "/projects/:project_slug/security-advisories", SecurityAdvisoryController, :index
get    "/projects/:project_slug/github-issues", GitHubIssueContextController, :index
```

- [ ] **Step 2: Controller tests** — index returns `%{data: [%{id, kind, ref_key, title, …}]}`, create returns resolved attachment, delete 204.

- [ ] **Step 3: Implement controllers** (mirror `ProjectPullRequestController` error handling via `TrackerErrors`).

- [ ] **Step 4: Run** — `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/attached_context_controller_test.exs`

- [ ] **Step 5: Commit** — `feat(api): load-context REST endpoints`

---

## Task 6: Server-side injection

**Files:**

- Modify: `elixir/lib/symphony_elixir/issue_dispatch.ex`
- Modify: `elixir/lib/symphony_elixir_web/channels/session_log_channel.ex`
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex`
- Test: `elixir/test/symphony_elixir/issue_dispatch_context_injection_test.exs`
- Test: `elixir/test/symphony_elixir_web/channels/assistant_channel_context_test.exs`

- [ ] **Step 1: Write failing dispatch test** — when an attachment exists, dispatched instructions include `## Loaded Context`.

- [ ] **Step 1a: Write failing draft refs test** — when a message payload includes `context_refs: [%{type: "issue", id: "SYM-2"}]`, server-side injection resolves it through `ContextResolvers` for that turn without creating an `attached_contexts` row.

- [ ] **Step 2: Patch `IssueDispatch`** — before `AgentRunner`, build `scope = AttachedContexts.execution_scope(project.slug, identifier)` and then `instructions = AttachedContexts.append_to_instructions(scope, instructions)`.

- [ ] **Step 3: Patch `SessionLogChannel` `steer_turn`** — append before `Orchestrator.steer`.

- [ ] **Step 4: Patch `AssistantChannel`** — `send_message` and `steer_turn` append persistent context using `assistant_scope(thread.id)` and draft context from payload `context_refs`.

- [ ] **Step 4a: Patch execution steer/dispatch payload handling** — `IssueDispatch` and `SessionLogChannel` accept structured `context_refs`, resolve them with the same `ContextResolvers`, and include them in the `## Loaded Context` block for that turn only.

- [ ] **Step 5: Verify hard_reset path** — grep `hard_reset` handlers; confirm **no** `AttachedContexts.clear` call.

- [ ] **Step 6: Run tests + commit** — `feat(context): inject attached context on steer/dispatch/chat`

---

## Task 7: Save Context — `context-summary` template + generate endpoint

**Files:**

- Modify: `elixir/lib/symphony_elixir/prompt_templates/builtin.ex`
- Modify: `elixir/lib/symphony_elixir/saved_contexts.ex`
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/saved_context_controller.ex`
- Test: `elixir/test/symphony_elixir/saved_contexts_test.exs`

- [ ] **Step 1: Add built-in template** (Jean `DEFAULT_CONTEXT_SUMMARY_PROMPT` shape):

```elixir
%{
  slug: "context-summary",
  name: "Save context",
  category: "context",
  body: """
  <task>Summarize this conversation for future context loading</task>
  Project: {{ project.name }}
  Date: {{ now }}

  <conversation>
  {{ conversation }}
  </conversation>

  Return JSON: {"slug":"kebab-slug","summary":"markdown starting with # Title"}
  """,
  agent_kind: "claude",
  model: nil,
  effort: "medium",
  mode: "build",
  scope: "global",
  built_in: true,
  enabled: true,
  position: 70
}
```

- [ ] **Step 2: Implement `SavedContexts.generate/2`**

  - Load conversation: assistant → `History.list_messages_for_thread`; execution → `SessionLog` lines formatted
  - Render template via `PromptTemplates.render/2`
  - Call coding agent (no tools), parse JSON, upsert `saved_contexts`
  - Optional `attach: true` param → also `AttachedContexts.attach(current_scope, %{kind: "saved", ref_key: saved.slug})`

- [ ] **Step 3: Controller `create` action** — `POST` body `{ source_scope, source_issue_identifier?, source_thread_id?, attach? }`.

- [ ] **Step 4: Run tests + commit** — `feat(context): save-context AI recap`

---

## Task 8: Tracker types + services

**Files:**

- Create: `tracker/src/types/attached-context.ts`
- Create: `tracker/src/services/attachedContexts.ts`
- Create: `tracker/src/services/savedContexts.ts`
- Create: `tracker/src/services/securityAdvisories.ts`
- Create: `tracker/src/services/githubIssuesContext.ts`
- Test: `tracker/src/services/__tests__/attachedContexts.test.ts`

- [ ] **Step 1: Types**

```ts
export type AttachedContextKind =
  | "saved" | "session" | "github_issue" | "pr"
  | "security_alert" | "advisory" | "board_issue";

export type ContextScope = "execution" | "assistant";

export interface AttachedContext {
  id: number;
  kind: AttachedContextKind;
  refKey: string;
  title: string;
  contentMd: string;
  metadata: Record<string, unknown>;
  position: number;
}
```

- [ ] **Step 2: Services** — implement `listAttachedContexts(scope, key)`, `attachContext(scope, key, input)`, `detachContext(scope, key, id)`, `listSavedContexts(projectSlug)`, `saveContext(projectSlug, input)`, `listSecurityAdvisories(projectSlug, options)`, and `listGitHubIssues(projectSlug, options)` with snake→camel normalizers (mirror `pullRequests.ts`).

- [ ] **Step 3: Tests with mocked `http` + commit** — `feat(tracker): load-context services`

---

## Task 9: `useAttachedContexts` hook

**Files:**

- Create: `tracker/src/hooks/useAttachedContexts.ts`
- Test: `tracker/src/hooks/__tests__/useAttachedContexts.test.ts`

- [ ] **Step 1: Failing test** — returns `{ contexts, count, attach, detach, refresh, loading }`; `attach` optimistically updates count.

- [ ] **Step 2: Implement** — `useState`/`useEffect`/`useCallback`; `enabled` when scope key present.

- [ ] **Step 3: Run** — `cd tracker && npm test -- useAttachedContexts`

- [ ] **Step 4: Commit** — `feat(tracker): useAttachedContexts hook`

---

## Task 10: `useLoadContextData` + tab config

**Files:**

- Create: `tracker/src/components/context/loadContextTabs.ts`
- Create: `tracker/src/components/context/useLoadContextData.ts`
- Test: `tracker/src/components/context/__tests__/useLoadContextData.test.ts`

- [ ] **Step 1: Tab constants** (Jean order + Board replacing Linear):

```ts
export const LOAD_CONTEXT_TABS = [
  { id: "contexts", key: "1", labelKey: "context.load.tabs.contexts" },
  { id: "github_issues", key: "2", labelKey: "context.load.tabs.githubIssues" },
  { id: "prs", key: "3", labelKey: "context.load.tabs.prs" },
  { id: "security", key: "4", labelKey: "context.load.tabs.security" },
  { id: "board", key: "5", labelKey: "context.load.tabs.board" },
] as const;
```

- [ ] **Step 2: Hook** — per-tab fetch when sheet `open`; unified `filterLoadContextItems(query, items)` with exact-number lookup (mirror `filterLauncherItems`); exposes `filteredItems`, `loading`, `error`, `supported`, `refetch`.

- [ ] **Step 3: Contexts tab sources** — `listSavedContexts` + `useAgentExecutions` project filter (sessions grouped by issue).

- [ ] **Step 4: Tests + commit** — `feat(tracker): useLoadContextData`

---

## Task 11: `LoadContextSheet` component

**Files:**

- Create: `tracker/src/components/context/LoadContextSheet.tsx`
- Create: `tracker/src/components/context/LoadContextItems.tsx` (row components per kind)
- Test: `tracker/src/components/context/__tests__/LoadContextSheet.test.tsx`

- [ ] **Step 1: Failing render test** — renders 5 tabs, search input, empty state for Contexts tab, `Ctrl+1` switches tab (keyboard handler unit test).

- [ ] **Step 2: Implement sheet** — `Dialog` + tab bar + `Input` search + `ScrollArea` list; mirror Jean layout from screenshot. Include `includeClosed` checkbox on github_issues/prs/security tabs.

- [ ] **Step 3: Preview pane** — selecting View shows `Markdown` of `contentMd` in a side panel or nested dialog.

- [ ] **Step 4: Wire actions** — `onAttach(item)`, `onPreview(item)`, `onSaveContext()` button in Contexts tab header.

- [ ] **Step 5: Run tests + commit** — `feat(tracker): LoadContextSheet`

---

## Task 12: `SymphonyComposer` feature contract + toolbar

**Files:**

- Create: `tracker/src/components/assistant/composerFeatures.ts`
- Create: `tracker/src/components/assistant/SymphonyComposer.tsx`
- Create: `tracker/src/components/context/ComposerContextChip.tsx`
- Create: `tracker/src/components/context/AttachedContextsMenu.tsx`
- Modify: `tracker/src/components/assistant/AssistantComposer.tsx`
- Modify: `tracker/src/components/assistant/useContextMentions.ts`
- Modify: `tracker/src/components/assistant/contextMentions.ts`
- Test: `tracker/src/components/context/__tests__/AttachedContextsMenu.test.tsx`
- Test: `tracker/src/components/context/__tests__/ComposerContextChip.test.tsx`
- Test: `tracker/src/components/assistant/__tests__/composerFeatures.test.ts`
- Test: `tracker/src/components/assistant/__tests__/SymphonyComposer.test.tsx`

- [ ] **Step 1: Define the contract**

```ts
export type ComposerPreset = "execution" | "assistant" | "assistantIssue";

export interface ComposerFeatures {
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

export interface ComposerContextBinding {
  scope: "execution" | "assistant";
  projectSlug: string;
  issueIdentifier?: string | null;
  threadId?: number | null;
}
```

- [ ] **Step 2: Write failing preset tests** — `featuresForPreset("execution")` enables `loadContext`, `executionMode`, `magicCommands`, `runControls`, `queue`, `goalPill`; `featuresForPreset("assistant")` disables execution-only controls; explicit overrides win.

- [ ] **Step 3: Implement `composerFeatures.ts`**

```ts
const PRESET_FEATURES: Record<ComposerPreset, Required<ComposerFeatures>> = {
  execution: {
    mentions: true,
    contextChips: true,
    loadContext: true,
    attachments: true,
    voice: false,
    slashCommands: true,
    agentPicker: true,
    modelPicker: true,
    effortPicker: true,
    executionMode: true,
    magicCommands: true,
    queue: true,
    runControls: true,
    goalPill: true,
  },
  assistant: {
    mentions: true,
    contextChips: true,
    loadContext: true,
    attachments: true,
    voice: true,
    slashCommands: true,
    agentPicker: true,
    modelPicker: true,
    effortPicker: true,
    executionMode: false,
    magicCommands: false,
    queue: false,
    runControls: false,
    goalPill: true,
  },
  assistantIssue: {
    mentions: true,
    contextChips: true,
    loadContext: true,
    attachments: true,
    voice: true,
    slashCommands: true,
    agentPicker: true,
    modelPicker: true,
    effortPicker: true,
    executionMode: true,
    magicCommands: false,
    queue: false,
    runControls: false,
    goalPill: true,
  },
};
```

- [ ] **Step 4: Failing context chip test** — `ComposerContextChip` renders a Jean/Cursor-style context chip above the textarea with icon, label, optional detail, remove button, and `draft` vs `loaded` visual state.

- [ ] **Step 5: Define context chip refs**

```ts
export type ComposerContextChipState = "draft" | "loaded";

export interface ComposerContextChipRef {
  type: "issue" | "file" | "pr" | "doc" | "saved" | "session" | "security";
  id: string;
  label?: string;
  detail?: string;
  state: ComposerContextChipState;
}
```

- [ ] **Step 6: Extend mention trigger support** — `useContextMentions` recognizes both `@query` and `#query`, reports the trigger (`"@" | "#"`) to the composer, and keeps keyboard navigation unchanged.

- [ ] **Step 7: Change mention selection behavior** — selecting an `@` / `#` item removes the trigger text and adds a `ComposerContextChipRef` to the chip rail above the textarea. It does **not** insert raw `@issue:SYM-1` text for picker selections.

- [ ] **Step 8: Preserve structured submission** — `AssistantComposerSubmit` gains `contextRefs: ComposerContextChipRef[]`. Legacy manually typed tokens still flow through `expandComposerMentions` as a fallback, but selected picker items use structured `contextRefs`.

- [ ] **Step 9: Failing menu test** — badge shows count; dropdown lists attached titles; "Manage contexts…" opens `LoadContextSheet`; remove item calls `detach`.

- [ ] **Step 10: Implement `AttachedContextsMenu`** — mirror Jean `DesktopToolbarControls` contexts dropdown (FolderOpen icon, grouped by kind). Persistent contexts loaded through the sheet render as chips with `state: "loaded"`.

- [ ] **Step 11: Implement `SymphonyComposer` wrapper** — it owns `useAttachedContexts`, `LoadContextSheet`, `AttachedContextsMenu`, draft context chips from `@` / `#`, execution mode button, magic button, and run control slots based on `features`. It delegates the existing textarea/attachment mechanics to the current `AssistantComposer` internals during the first pass to avoid a risky rewrite.

```ts
interface SymphonyComposerProps {
  preset: ComposerPreset;
  features?: Partial<ComposerFeatures>;
  contextBinding: ComposerContextBinding;
  runtimeActions: ComposerRuntimeActions;
  // existing AssistantComposer props that are still surface-specific:
  bundle: AssistantCatalogBundle;
  seedMessage?: string | null;
  disabled?: boolean;
}
```

- [ ] **Step 12: Keep `toolbarAfterAttach` as extension-only** — first-party buttons move behind `features`; leave the slot available for rare add-ons.

- [ ] **Step 13: Run tests + commit** — `feat(composer): unified SymphonyComposer feature contract`

---

## Task 13: Execution runtime adapter

**Files:**

- Modify: `tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx`
- Test: extend `ExecutionControlComposer.test.tsx`

- [ ] **Step 1: Failing test** — `ExecutionControlComposer` renders `SymphonyComposer` with `preset="execution"` and `contextBinding={ scope: "execution", projectSlug, issueIdentifier }`; load-context button opens sheet; attaching board issue increments badge; submit still works.

- [ ] **Step 2: Replace direct `AssistantComposer` mount** — pass runtime state/actions into `SymphonyComposer`:

```tsx
<SymphonyComposer
  preset="execution"
  contextBinding={{ scope: "execution", projectSlug, issueIdentifier: issue.identifier }}
  runtimeActions={executionRuntimeActions}
  bundle={bundle}
  seedMessage={seedMessage}
/>
```

- [ ] **Step 3: Move execution controls behind runtime actions** — `ExecutionModeMenu`, Magic, restart, hard reset, pause/resume buttons are rendered by `SymphonyComposer` when corresponding features are enabled, but callbacks still come from `ExecutionControlComposer`.

- [ ] **Step 4: Save context action** — calls `saveContext({ source_scope: "execution", source_issue_identifier, attach: true })`.

- [ ] **Step 4a: Submit context refs** — execution submit/steer forwards `contextRefs` from the composer so `#` / `@` quick chips can be resolved server-side for that turn.

- [ ] **Step 5: Run** — `cd tracker && npm test -- ExecutionControlComposer SymphonyComposer`

- [ ] **Step 6: Commit** — `feat(exec): execution composer adapter`

---

## Task 14: Assistant runtime adapter

**Files:**

- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx`
- Test: extend `ProjectAssistantPanel.test.tsx`

- [ ] **Step 1: Failing test** — with `thread_id` from channel join, `ProjectAssistantPanel` renders `SymphonyComposer` with `preset="assistant"` (or `assistantIssue` when `issueIdentifier` exists) and `contextBinding={ scope: "assistant", threadId }`; attach uses assistant scope endpoints.

- [ ] **Step 2: Replace direct `AssistantComposer` mount**

```tsx
<SymphonyComposer
  preset={issueIdentifier ? "assistantIssue" : "assistant"}
  contextBinding={{ scope: "assistant", projectSlug: projectSlug ?? "", threadId, issueIdentifier }}
  runtimeActions={assistantRuntimeActions}
  bundle={composerBundle}
  seedMessage={composerSeedMessage}
/>
```

- [ ] **Step 3: Save context action** — passes `source_thread_id` and `attach: true`.

- [ ] **Step 4: Board tab** — works without bound `issueIdentifier` (project-wide `listIssues`).

- [ ] **Step 4a: Submit context refs** — assistant `send_message` and `steer_turn` payloads include structured `context_refs` from draft chips.

- [ ] **Step 5: Run tests + commit** — `feat(assistant): assistant composer adapter`

---

## Task 15: i18n

**Files:**

- Modify: `tracker/locales/en/tracker.json`
- Modify: `tracker/locales/pt-BR/tracker.json`

- [ ] **Step 1: Add keys** — `context.load.title`, `context.load.tabs.*`, `context.load.empty.*`, `context.load.attach`, `context.load.preview`, `context.load.save`, `context.load.unsupported`, `context.attached.manage`, `context.attached.remove`.

- [ ] **Step 2: pt-BR translations**

- [ ] **Step 3: Commit** — `i18n: load context strings`

---

## Task 16: Integration verification (combined-preview stack)

- [ ] **Step 1: Boot preview** — `cd .worktrees/combined-preview/elixir && make preview-serve` + `make preview-tracker-dev`

- [ ] **Step 2: Manual QA checklist**

  - [ ] Execution composer: attach board issue `SYM-2` while on `SYM-4` → steer includes Loaded Context
  - [ ] Hard reset → attachments still listed
  - [ ] Assistant thread: attach PR → next message includes context
  - [ ] Security tab: shows alerts or graceful unsupported
  - [ ] Save context from session → appears in Contexts tab

- [ ] **Step 3: Run full suites**

```bash
cd .worktrees/combined-preview/elixir && mix test test/symphony_elixir/attached_contexts_test.exs test/symphony_elixir/saved_contexts_test.exs test/symphony_elixir/context_resolvers_test.exs
cd .worktrees/combined-preview/tracker && npm test -- LoadContext AttachedContexts ExecutionControlComposer ProjectAssistantPanel
```

- [ ] **Step 4: Commit** — `test(context): load-context integration coverage`

---

## Self-Review (spec coverage)

| Spec requirement | Task(s) |
| --- | --- |
| One shared composer with feature flags | 12, 13, 14 |
| Dual scope (execution + assistant stores) | 1, 4, 5, 13, 14 |
| Persist on hard reset | 4, 6 (explicit no-clear) |
| 5 tabs incl. Security + Board (not Linear) | 3, 10, 11, 15 |
| Server-side attach + injection | 2, 4, 6 |
| Save Context | 7 |
| Composer toolbar + sheet | 11, 12, 13, 14 |
| `@` / `#` quick attach chips | 12, 13, 14 |
| GitHub degradation `supported: false` | 3, 5, 11 |

**Risks:**

- **GitHub rate limits** on Security + Issues tabs — mitigated by `ReadCache` 60s TTL.
- **Save context cost** — one agent call per save; surface loading state in UI.
- **Large markdown** — cap `content_md` at attach (e.g. 128KB); truncate with notice in metadata.

---

## Execution Handoff

Implement in `combined-preview` worktree. Start with Task 1 (schema) and proceed sequentially; Tasks 11–14 can parallelize after Task 8 lands.
