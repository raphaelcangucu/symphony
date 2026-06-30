# Magic Commands — Command Palette of One-Shot AI Workflows

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. One focused subagent per task with review between tasks. Replace example commands with this repo's real tools.

**Goal:** Mirror Jean's **Magic Commands** — a fast, searchable palette of one-shot AI workflows ("Review this PR", "Write commit message", "Summarize discussion", "Resolve conflicts"). Each entry is a **Magic Prompt** template; selecting it renders the template against the current issue/context and dispatches it to the chosen agent with the template's backend/model/effort/mode — no manual prompt typing.

**Depends on:**
- `2026-06-27-magic-prompts-templates-plan.md` (template store + `render/2` + per-template model/effort/mode).
- `2026-06-26-execution-control-model-mode-plan.md` (Plan 2a — `dispatchIssueAgent` already carries `model`/`effort`/`mode`).
- `2026-06-26-execution-control-mentions-shortcuts-plan.md` (Plan 2b — `cmdk` palette + keybinding registry).

**Why (verified state):** Symphony already has a `cmdk` palette pattern (`tracker/src/components/board/BoardPaletteShortcuts.tsx`, global `⌘K`) and assistant slash commands (`tracker/src/components/assistant/slashCommands.ts`: `/goal`, `/infer`, `/btw`). What's missing is a **curated palette that runs a prompt template** as a one-shot dispatch. Because Plan 2a threads `model/effort/mode` through `dispatchIssueAgent` and Magic Prompts exposes `render/2` + per-template knobs, a Magic Command is just: *render template → dispatch with template defaults*. Minimal new backend.

**Architecture:** A reusable `<MagicCommandPalette>` (cmdk) lists enabled prompt templates (built-in + user) from the Magic Prompts service, grouped by category and fuzzy-searchable. On select, it calls a thin backend endpoint `POST /issues/:id/run-prompt-template` that (a) loads the template, (b) `PromptTemplates.render/2` with the issue + git/discussion context, (c) dispatches via the existing `IssueDispatch` path using the template's `agent_kind/model/effort/mode` (falling back to the issue's current execution settings). The palette opens from the Execution Control toolbar button and a keybinding (`⌘P` / registered in Plan 2b's registry).

**Tech Stack:** React 19 + cmdk + vitest; Phoenix controller + ExUnit. Frontend data flows through the repo's established `useState`/`useEffect` + service hook pattern (e.g. `useAgentExecutions`) — **this repo has no TanStack Query; do not introduce it.**

---

## File Structure

**Create (tracker):**
- `tracker/src/components/commands/MagicCommandPalette.tsx`
- `tracker/src/components/commands/useMagicCommands.ts` (`useState`/`useEffect` data hook: load enabled templates + an async `run` action; no query cache)
- `tracker/src/services/magicCommands.ts` (`runPromptTemplate(issueId, slug, overrides?)`)
- tests for palette + hook + service.

**Modify (tracker):**
- `tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx` — add a "Magic" button + mount palette.
- Plan 2b keybinding registry — register `magic.open` (default `⌘P`).
- locales `en` + `pt-BR`.

**Create (backend):**
- `elixir/lib/symphony_elixir_web/controllers/tracker/run_prompt_template_controller.ex` (or add `run_prompt_template/2` action to the issue controller).
- controller test.

**Modify (backend):**
- `elixir/lib/symphony_elixir_web/controllers/tracker/router.ex` — `POST /issues/:id/run-prompt-template`.

---

## Task 1: Backend — run-prompt-template endpoint

**Files:** Create controller (or action) + test; route.

The endpoint renders a template against the issue and dispatches via the same code path the UI dispatch button uses (so it inherits Plan 2a's persistence of model/effort/mode and the `IssueDispatch` lifecycle). Body: `{ "slug": "code-review", "model": null, "effort": null, "mode": null }` (overrides optional; template defaults win when overrides are null; issue's current settings win when both are null).

- [ ] **Step 1: Write failing controller test**

```elixir
test "runs a template: renders body + dispatches with template's effort", %{conn: conn} do
  PromptTemplates.ensure_builtins()
  issue = insert_issue!(identifier: "DEMO-1", title: "Fix login")

  conn = post(conn, ~p"/tracker/issues/#{issue.id}/run-prompt-template", %{"slug" => "code-review"})

  assert %{"ok" => true} = json_response(conn, 200)
  # assert IssueDispatch was called with instructions containing "DEMO-1"
  # and effort "high" (the template default), via a stub/telemetry on the dispatch boundary
end

test "unknown slug -> 404" do ... end
test "disabled template -> 422" do ... end
```

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/.../run_prompt_template_controller_test.exs -o`

- [ ] **Step 3: Implement**
- Resolve template by slug within the issue's project scope (project-scoped shadows global; reject if not enabled).
- Build render context from the issue (reuse what `PromptBuilder` already gathers: issue fields, recent discussion). For a one-shot command, keep it lean — the issue map is enough for v1.
- `instructions = PromptTemplates.render(template, %{issue: issue_map})`.
- Resolve dispatch opts: `model = body.model || template.model || issue_setting.model`, same for `effort`/`mode`/`agent_kind`.
- Call the **existing** dispatch path (`IssueDispatch.dispatch_agent/…` as wired by `issue_controller.ex` `dispatch_agent`, now accepting model/effort/mode from Plan 2a). Return `{ ok: true, runId? }`.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(commands): run-prompt-template endpoint`.

---

## Task 2: Tracker service + data hook

**Files:** `services/magicCommands.ts`, `components/commands/useMagicCommands.ts` + tests.

- [ ] **Step 1: Write failing service test** — `runPromptTemplate(issueId, slug, overrides)` POSTs to the route with the body; returns parsed result.

- [ ] **Step 2: Write failing hook test** — `useMagicCommands({ issueId, projectSlug, onRan? })` returns `{ commands, isLoading, error, run, isRunning }`. `commands` are the enabled prompt templates loaded via Magic Prompts `listPromptTemplates(projectSlug)` with `useState`/`useEffect` (filtered `enabled !== false`, sorted by `position`/category). `run(slug, overrides?)` is an async action that calls `runPromptTemplate`, sets `isRunning`, and invokes the provided `onRan` callback on success — the caller refreshes execution state via its existing `useAgentExecutions` `refetch` (no query cache to invalidate).

- [ ] **Step 3: Run (expect fail)** — `cd tracker && npx vitest run src/components/commands/__tests__/useMagicCommands.test.ts`

- [ ] **Step 4: Implement** service + hook.

- [ ] **Step 5: Run (expect pass).**

- [ ] **Step 6: Commit** — `feat(commands): magic-commands service + hook`.

---

## Task 3: MagicCommandPalette (cmdk)

**Files:** `MagicCommandPalette.tsx` + test.

- [ ] **Step 1: Write failing test**
- Renders a `cmdk` dialog grouped by template `category`; typing filters fuzzily.
- Each item shows name + a small badge for its backend/effort/mode (so the operator sees how it will run).
- `Enter` on an item calls `run(slug)` and closes; shows a pending state while dispatching; surfaces errors via toast.
- Closes on `Esc`; opens via the `open` prop.

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/components/commands/__tests__/MagicCommandPalette.test.tsx`

- [ ] **Step 3: Implement** using the same `cmdk` primitives as `BoardPaletteShortcuts.tsx`. Reuse the effort/mode icon set from Plan 2a so the badges match the toolbar.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(commands): MagicCommandPalette UI`.

---

## Task 4: Wire into Execution Control + keybinding

**Files:** Modify `ExecutionControlComposer.tsx`; register keybinding (Plan 2b); locales.

- [ ] **Step 1: Write failing integration test** — a "Magic" (sparkle) button in the composer toolbar opens the palette; `⌘P` toggles it; running a command shows a pending state and, on success, a confirmation referencing the dispatched run.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement**
- Add the toolbar button next to the model/mode pickers.
- Register `magic.open` in Plan 2b's keybinding registry (default `mod+p`), guard so it doesn't fire inside text inputs (reuse Plan 2b's input-focus guard).
- Add i18n keys `commands.magic.*`.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(commands): wire Magic palette into Execution Control + ⌘P`.

---

## Task 5: Full gates

- [ ] **Step 1: Backend gate** — `cd elixir && mix specs.check && make all`.
- [ ] **Step 2: Tracker gate** — `cd tracker && npm run lint && npx vitest run && npm run build`.
- [ ] **Step 3: Commit** — any cleanup as `chore(commands): gates green`.

---

## Self-Review (spec coverage)

| Requirement (Jean Magic Commands) | Task(s) |
| --- | --- |
| Searchable palette of one-shot AI workflows | 3 |
| Each command runs a prompt template (no manual typing) | 1, 2 |
| Per-command backend/model/effort/mode | 1 (reuses Magic Prompts defaults + Plan 2a dispatch) |
| Keyboard-first (open via shortcut) | 4 |
| Visible "how it will run" affordance | 3 (badges) |

**Notes / decisions:**
- A Magic Command is intentionally **thin**: render a Magic Prompt template + dispatch through the existing path. No new execution machinery — it composes Plan 2a (dispatch knobs) + Magic Prompts (templates).
- v1 render context is the issue map only; richer context (git diff summary, selected `@`-mentions from Plan 2b) is a follow-up — note it but don't block.
- "Authoring vs execution" target: v1 dispatches as a normal agent run. A later toggle could instead inject the rendered prompt as an assistant chat turn for non-mutating commands (e.g. "summarize discussion"); leave as a noted extension.
