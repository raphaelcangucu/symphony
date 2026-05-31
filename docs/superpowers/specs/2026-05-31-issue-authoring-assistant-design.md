# Issue Authoring Assistant — Design

> Replaces the **create-issue modal** with an **AI assistant chat mapped to an
> issue**. The chat collects title + quick description, creates a **draft issue**
> early (mapping the thread to it), then operates in **simple** or **complex**
> mode (chosen via an explicit toggle, with the assistant inferring/suggesting a
> default). Simple mode searches the project repos and writes a fuller, formal
> description. Complex mode turns the assistant **into the superpowers agent**
> (brainstorming → spec → writing-plans) interactively in-chat, writing
> `docs/superpowers/specs|plans/*.md` into the **issue's working tree**. Generated
> documents are viewable (read-only) in both the assistant and the issue detail;
> adjustments happen via chat. The description is finally enriched with an
> executive summary + links to the documents. The **same working tree is reused**
> by the later orchestrator Codex run, which continues from the spec/plan/handoff.
> A Codex-only **Goal mode** (opt-in checkbox at dispatch) drives long/large tasks.

## 0. Context (current state of the code)

- The assistant already runs over a **Phoenix channel + Codex** path:
  `ProjectAssistantPanel` (frontend) ↔ `AssistantChannel` ↔
  `Assistant.CodexSession.send_message/4` ↔ `Codex.CodingAgent` (JSON-RPC over
  the Codex app-server). Tools are exposed via `Assistant.ToolExecutor`
  (`create_issue`, `update_issue`, `move_issue`, `add_comment`, `dispatch_codex`,
  `list_issues`, `get_agent_executions`).
- Today the assistant's Codex turns run in an **empty** workspace
  (`CodexSession.assistant_workspace/2` → `{workspace_root}/assistant/<slug>-<hash>`,
  just `mkdir`). It has **no project repos**.
- The thread schema **already supports** `scope: "issue"` + `issue_identifier`
  (migration `20260531120000_extend_assistant_threads_scope.exs`), but
  `History.ensure_issue_thread` does **not** exist and the frontend uses only the
  `assistant:<project_slug>` topic. The channel **already** accepts
  `assistant:thread:<id>` on the backend.
- Per-issue workspaces (with cloned repos) are created by
  `Workspace.create_for_issue/1` (populated via `WORKFLOW.md`
  `hooks.after_create`). The orchestrator dispatch (`Orchestrator` →
  `AgentRunner` → `Workspace.create_for_issue` → `PromptBuilder.build_prompt` →
  `CodingAgent.run_turn`) reuses an existing workspace dir if present.
- The **superpowers skills** live in the Cursor plugin cache, **not** in the repo
  and **not** in `.codex/skills`. A Codex agent running in a project working tree
  does not have them unless we provide them.
- Issue detail (`IssueDrawer.tsx`) has tabs incl. **Agent** (`AgentTab` — run
  metadata only). There is **no** document/spec/plan viewer anywhere today.
- The create-issue modal (`IssueCreateDialog`) is triggered from the header
  (`ProjectHeader`), board columns (`BoardColumn`), and `/new-issue` routes.

This feature is the §10 "future" item of
`docs/superpowers/specs/2026-05-30-recents-sidebar-sessions-design.md`
("Assistant creates the issue replacing the create-issue modal using skills").

## 1. Goals

1. Replace the primary "New issue" entry with an **issue-mapped assistant chat**;
   keep the existing modal as a **quick-create fallback**.
2. Create a **draft issue early** (after title + quick description) in a
   **non-actionable status**, mapping the thread to it (`scope: "issue"`).
3. **Simple vs complex** mode chosen by an explicit **toggle** the user controls;
   the assistant **infers + suggests** a default and **confirms** before
   proceeding; the user can flip it any time.
4. **Simple mode**: search the issue's working-tree repos and write a fuller,
   formal description (no spec/plan).
5. **Complex mode**: the assistant **is** the superpowers agent, interactively
   running brainstorming → spec → writing-plans in-chat (section-by-section
   approval), writing `docs/superpowers/specs|plans/*.md` into the issue working
   tree (possibly multiple specs/plans).
6. **Documents** are listed + rendered **read-only** in both the assistant and
   the issue detail; adjustments happen **via chat** (assistant rewrites files,
   viewer refreshes).
7. Final **enrichment**: the description gets an executive summary + links to the
   documents (lean description).
8. The **same working tree is reused** by the later orchestrator run, which
   **continues** from the spec/plan/handoff (no rework).
9. **Goal mode** (Codex-only, opt-in checkbox at dispatch) for long/large tasks,
   with the goal text auto-derived from artifacts and user-reviewed.

## 2. Non-goals

- Inline/manual editing of documents in the UI (review is read-only + chat).
- Anchored/threaded comments on documents.
- Embedding the full spec/plan markdown into the issue description (summary +
  links only).
- Removing the quick-create modal (kept as a fallback).
- Goal mode for non-Codex agents (hidden when the agent isn't Codex).
- A sync pipeline for vendored skills (static vendor now; sync is future).
- Freeform (project-less) issue authoring — authoring is always project-scoped.

## 3. Decisions (resolved during brainstorming)

| ID | Decision |
|----|----------|
| D1 | **Issue created early as a draft** in a non-actionable status; thread upgraded to `scope:"issue"` and mapped to `issue_identifier`. |
| D2 | **Complex mode runs superpowers interactively in-chat** — the assistant *is* the agent; Codex turns run in the issue working tree. |
| D3 | **Working tree = per-issue** (`Workspace.create_for_issue`), and is **reused** by the later orchestrator run. |
| D4 | **Mode control = explicit toggle** (Simple/Complex) the user owns; assistant infers + suggests default and confirms. |
| D5 | **Document review = read-only viewer in both places + chat-driven edits** (assistant rewrites files). |
| D6 | **Enrichment = executive summary + links** to the documents (lean description). |
| D7 | **Modal = assistant primary + quick-create fallback** (split-button). |
| D8 | **Routing** = `/projects/:slug/assistant/new-issue` and `/projects/:slug/assistant/issue/:issueId`; also reachable from the issue detail. |
| D9 | **Skills = vendored statically** into Symphony in a reusable folder; injected into the issue-scoped prompt for complex mode. |
| D10 | **Docs committed** to the issue branch in the working tree (persistent + reviewable). |
| D11 | **Handoff = a versioned file** `docs/superpowers/handoff.md`, visible in the viewer, consumed by the orchestrator prompt. |
| D12 | **Agent tab split** into **Authoring** (thread + documents) and **Execution** (orchestrator run). |
| D13 | **Goal mode = opt-in checkbox at dispatch (Codex-only)**; goal text auto-derived from spec/plan/handoff and user-reviewed; falls back to single-turn if unsupported. |

## 4. End-to-end flow

```
"New issue" (header / board / route)
   │  split-button ▾ → "Quick create" opens IssueCreateDialog (fallback, unchanged)
   ▼
/projects/:slug/assistant/new-issue        (new thread, no issue yet)
   │  1. assistant collects title + quick description
   ▼
create DRAFT issue (non-actionable status, e.g. "Triage")
   + Workspace.create_for_issue (clone repos via WORKFLOW.md hooks)
   + upgrade thread → scope:"issue", bound to issue_identifier
   │  (redirect to /projects/:slug/assistant/issue/:issueId)
   ▼
mode toggle:  [ Simple ] [ Complex ]   (assistant infers/suggests + confirms)
   ├── SIMPLE  → agent searches working-tree repos → update_issue (formal description)
   └── COMPLEX → assistant = superpowers agent (vendored skills injected)
                 brainstorming → spec → writing-plans, section-by-section approval
                 writes docs/superpowers/specs|plans/*.md in the working tree
                 (each write → channel event assistant_document_changed)
   ▼
final enrichment → executive summary + links → update_issue (lean description)
   + write docs/superpowers/handoff.md
   ▼
dispatch (optional, user-initiated): agent picker + [x] Goal mode (Codex-only)
   → orchestrator REUSES the same working tree; PromptBuilder injects
     spec/plan/handoff; continues from authoring (no rework)
```

## 5. Backend design (Elixir)

### 5.1 Issue-scoped threads — `Assistant.History`

- Add `ensure_issue_thread(project_slug, issue_identifier, attrs)`:
  - finds/creates the active `scope:"issue"` thread for `(project_slug,
    issue_identifier)`, respecting the existing partial unique index
    `assistant_threads_active_issue_index`.
  - sets `workspace_path` to `Workspace.path_for_issue(issue_identifier)`.
- A `/assistant/new-issue` thread starts lightweight; once the draft issue is
  created, **upgrade** it to `scope:"issue"` + `issue_identifier` (or create the
  issue thread and migrate messages). The UI then redirects to
  `/assistant/issue/:issueId`.
- Thread `mode` (`triage` | `simple` | `complex`) is stored in the thread
  `metadata` map (no new migration). Default `triage`.

### 5.2 Issue-scoped turns — `Assistant.CodexSession`

- Branch on thread `scope`:
  - `project` → existing `send_message/4` (unchanged).
  - `freeform` → existing `send_message_to_thread/4` (unchanged).
  - `issue` → new path that runs Codex turns in
    `Workspace.path_for_issue(issue_identifier)` (calling
    `Workspace.create_for_issue/1` if the dir is absent), with `ToolExecutor`
    tools bound to that single issue.
- **Prompt assembly** for issue-scoped turns:
  - includes the current `mode` and its instructions;
  - in **complex** mode, injects the vendored superpowers skill content
    (`SymphonyElixir.Skills`) and instructs the agent to follow the methodology,
    write docs under `docs/superpowers/specs|plans/`, get section-by-section
    approval in chat, and **not** start coding;
  - in **simple** mode, instructs the agent to search the working-tree repos and
    produce a fuller, formal description via `update_issue`.
- **Document-change signal**: after a turn that wrote/updated files under
  `docs/superpowers/`, broadcast `assistant_document_changed` on the thread topic
  (`assistant:thread:<id>`) with `{ identifier }` (detect via git status / mtime
  in the workspace).

### 5.3 Tools — `Assistant.ToolExecutor`

- `create_issue` (draft): create in a **non-actionable** status (outside the set
  the orchestrator dispatches — e.g. "Triage"/"Backlog") so a draft is never
  auto-dispatched mid-conversation.
- Issue-scoped sessions **bind** mutating tools (`update_issue`, `add_comment`,
  `move_issue`, `dispatch_codex`) to the thread's `issue_identifier` (the agent
  cannot act on other issues).

### 5.4 Vendored skills — `SymphonyElixir.Skills` + `skills/`

- New repo folder `skills/superpowers/<skill>/SKILL.md` — agent-agnostic plain
  files, versioned, reusable by other agents/CLIs. Vendored statically (manual
  updates; a sync script is future work).
- `SymphonyElixir.Skills`: `load(names)` reads the relevant `SKILL.md` files and
  returns their content for injection into the complex-mode prompt. The folder
  path is also exposable so other CLIs can consume the same skills.

### 5.5 Document API — `IssueDocumentController` (tracker_api)

- `GET /api/tracker/v1/projects/:slug/issues/:identifier/documents` →
  `{ data: { available: bool, reason?: string, documents: [ { id, kind:
  "spec"|"plan"|"handoff", path, title, updated_at } ] } }`. Lists files under
  `docs/superpowers/specs/`, `docs/superpowers/plans/`, and `handoff.md` in the
  issue working tree. `reason: "workspace_missing"` when the dir is absent.
- `GET .../documents/*path` → markdown content of a single doc.
- **Sandbox**: resolve via `Workspace.path_for_issue/1`; restrict to
  `docs/superpowers/`; guard against path traversal; enforce a max size.
- `title` derived from the first `#` heading (fallback: filename).
- `TrackerPresenter.issue_document/1` → snake_case JSON.

### 5.6 Orchestrator continuity — `PromptBuilder` / `AgentRunner`

- `PromptBuilder.build_prompt/2` detects `docs/superpowers/specs|plans/*` and
  `handoff.md` in the workspace; when present, injects a section instructing the
  orchestrator agent to **follow the existing spec/plan** (already in the working
  tree) and reads the handoff for continuity context — plus the enriched
  description. Without this, dispatch would start "from scratch".
- The workspace is already reused (same per-issue dir), so the committed docs and
  cloned repos are present.

### 5.7 Goal mode — `Codex.CodingAgent` / `Codex.Config`

- New dispatch option `goal` (Codex-only). When set:
  - after `thread/start`, send JSON-RPC `thread/goal/set` with the composed goal
    (objective + constraints + verification + stopping condition);
  - require `[features] goals = true` in the Codex config used by Symphony
    (`SymphonyElixir.Codex.Config`);
  - the run loop **keeps the session alive across auto-continued turns** while the
    goal is active and within budget, instead of ending after one turn;
  - expose **pause / resume / clear** (mapped to the corresponding JSON-RPC
    methods) and surface goal status.
- **Goal text** is auto-derived from the spec/plan/handoff (executive summary →
  objective; plan verification → checks; constraints from the spec) and presented
  for user review/edit before confirmation.
- **Fallback**: if goals are unsupported (flag missing / `thread/goal/set` errors)
  → normal single-turn dispatch with a clear warning. Non-Codex agents never see
  the option.

## 6. Frontend design (React)

### 6.1 Routes & navigation (`App.tsx`, `workspaceRoutes.ts`)

- `/projects/:slug/assistant/new-issue` → `IssueAssistantRoute` (no issue yet).
- `/projects/:slug/assistant/issue/:issueId` → issue-scoped thread (redirected to
  after the draft is created).
- `/projects/:slug/assistant` (project assistant) unchanged.
- Register `"assistant"` in `ISSUE_TABS` for `.../issues/:id/assistant` deep-link.

### 6.2 Reusable assistant surface

- Extract the chat core from `ProjectAssistantPanel` into a surface that accepts
  an optional `threadId`; when present, join `assistant:thread:<id>` (backend
  already supports it), else keep `assistant:<slug>` (back-compat).
- Issue-scoped surface adds the **documents panel** (chat left, documents right).
- `services/phoenix/assistantChannel.ts`: add `assistantThreadTopic(id)` next to
  `assistantTopic(slug)`; bind the `assistant_document_changed` event.

### 6.3 Document viewer

- `types/issueDocument.ts`, `services/issueDocuments.ts` (list/read +
  snake/camel normalizers), `hooks/useIssueDocuments.ts` (fetch on open,
  subscribe to `assistant_document_changed`, focus-aware refetch, keep-last on
  failure).
- `components/assistant/DocumentViewer.tsx`: document list (spec/plan/handoff) +
  read-only markdown render (same renderer as the chat). Reused in the assistant
  surface and the issue detail.

### 6.4 Entry points & fallback

- `ProjectHeader.tsx` / `BoardColumn.tsx` / `/new-issue`: primary **"New issue"**
  navigates to `/projects/:slug/assistant/new-issue`; a secondary **split-button
  ▾ → "Quick create"** opens the existing `IssueCreateDialog` (unchanged).

### 6.5 Issue detail (`IssueDrawer.tsx`)

- Split the **Agent** tab into:
  - **Authoring** — the issue-scoped thread (`assistant:thread:<id>`) + the
    `DocumentViewer`.
  - **Execution** — the existing `AgentTab` (orchestrator run metadata) + Goal
    status and pause/resume/clear controls when a goal is active.

### 6.6 Dispatch UI

- The dispatch control (agent picker) gains a **checkbox "Goal mode
  (long-running)"** shown **only when the selected agent is Codex**. Toggling it
  opens the auto-derived goal text for review/edit before confirming.

## 7. Error handling & edge cases

- Working tree missing (draft created but clone pending/failed) → documents API
  returns `available:false, reason:"workspace_missing"`; viewer shows a hint.
- Draft never auto-dispatched: non-actionable status keeps the orchestrator off.
- Path traversal / oversized docs → rejected by the sandboxed document API.
- Multiple specs/plans → all listed (per-issue workspace isolation scopes them).
- Channel/runtime: `assistant:<slug>` stays intact; `assistant:thread:<id>` added
  alongside; both covered by tests before switching the UI.
- Goal unsupported → single-turn fallback + warning; non-Codex hides the option.
- Document fetch failure → keep last known list; never blank the viewer.
- Mode flip mid-flow → assistant acknowledges and switches behavior on next turn.

## 8. Testing

**Backend**
- `history`: `ensure_issue_thread` create/find, unique-active-issue index, thread
  `mode` in metadata; new-issue→issue upgrade.
- `codex_session`: issue-scoped turn runs in the issue working tree, injects
  skills in complex mode, simple-mode searches repos + `update_issue`, doc-change
  broadcast.
- `tool_executor`: draft created in non-actionable status; tools bound to the
  issue.
- `skills`: loads vendored `SKILL.md` content.
- `issue_document_controller`: list/read shape, `workspace_missing`, sandbox /
  path-traversal guard, size limit, auth.
- `prompt_builder`: injects spec/plan/handoff when present; unchanged otherwise.
- `coding_agent`/`config`: `thread/goal/set`, auto-continuation loop,
  pause/resume/clear, fallback when goals unsupported.

**Frontend**
- `issueDocuments` normalizers; `useIssueDocuments` (channel + keep-last);
  `DocumentViewer` rendering/list.
- routing for `new-issue` / `issue/:issueId`; `assistant` issue tab parsing.
- split-button (assistant primary + quick-create fallback).
- Agent tab split (Authoring/Execution).
- Goal-mode checkbox visible only for Codex; review/edit before confirm.

## 9. Files

**Backend — new**
- `skills/superpowers/<skill>/SKILL.md`
- `elixir/lib/symphony_elixir/skills.ex`
- `elixir/lib/symphony_elixir_web/controllers/tracker/issue_document_controller.ex`

**Backend — modified**
- `elixir/lib/symphony_elixir/assistant/history.ex`
- `elixir/lib/symphony_elixir/assistant/codex_session.ex`
- `elixir/lib/symphony_elixir/assistant/tool_executor.ex`
- `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex`
- `elixir/lib/symphony_elixir/codex/coding_agent.ex`
- `elixir/lib/symphony_elixir/codex/config.ex`
- `elixir/lib/symphony_elixir/codex/prompt_builder.ex`
- `elixir/lib/symphony_elixir_web/router.ex`
- `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`

**Frontend — new**
- `tracker/src/types/issueDocument.ts`
- `tracker/src/services/issueDocuments.ts`
- `tracker/src/hooks/useIssueDocuments.ts`
- `tracker/src/components/assistant/DocumentViewer.tsx`
- `tracker/src/components/workspace/IssueAssistantRoute.tsx`
- reusable assistant surface extracted from `ProjectAssistantPanel.tsx`

**Frontend — modified**
- `tracker/src/App.tsx`
- `tracker/src/components/layout/ProjectHeader.tsx`
- `tracker/src/components/board/BoardColumn.tsx`
- `tracker/src/components/issues/IssueDrawer.tsx`
- `tracker/src/lib/workspaceRoutes.ts`
- `tracker/src/services/phoenix/assistantChannel.ts`
- the dispatch control component (Goal-mode checkbox)

## 10. Docs to update (same change)

- `elixir/README.md` — issue authoring assistant + Goal mode + run notes.
- `WORKFLOW.md` / `WORKFLOW.*.example.md` — non-actionable draft status note and
  any `goals`/feature config.
- `SPEC.md` — issue-scoped assistant + Goal-mode dispatch as a superset.
- `docs/logging.md` — any new issue/session context fields.

## 11. Future (not in v1)

- Sync pipeline pulling vendored skills from `obra/superpowers`.
- Inline/manual document editing and anchored review comments.
- Goal mode for non-Codex agents (if/when supported).
- Freeform (project-less) authoring with an opt-in project target.
