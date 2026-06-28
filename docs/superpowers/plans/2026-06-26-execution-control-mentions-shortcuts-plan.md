# Execution Control 2b — `@`-Mentions, `/`-Commands, and Keyboard Shortcuts / Command Palette

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. One focused subagent per task with review between tasks. Replace example commands with this repo's real tools.

**Goal:** Bring Jean's in-composer context tooling to Symphony's execution composer: type `@` to cite issues / files / PRs (inserted as a token that expands into the dispatched prompt), expand the `/`-command palette beyond `goal/infer/btw` into a fuzzy skill/command list, and add a small keyboard-shortcut registry + `⌘K`/`Ctrl+K` command palette for execution actions (resume / restart / stop / hard-reset / cycle mode / focus composer).

**Existing foundations to reuse (verified):**
- `@`-mentions already exist for comments: `useCommentMentions.ts` (regex `(^|\s)@([\w-]*)$`, `selectMention`) + `MentionAutocomplete.tsx`. Generalize, don't reinvent.
- `/`-commands already parse + autocomplete: `slashCommands.ts` (`SLASH_COMMAND_SPECS`, `parseSlashCommand`, `matchingSlashCommands`) rendered by the palette in `AssistantComposer.tsx:605-620`.
- `cmdk` command palette + global keydown already exist: `BoardPaletteShortcuts.tsx` (`⌘K` toggles `CommandDialog`). Mirror this for execution.
- Attachment→prompt expansion pattern exists: `enrichGuidanceWithAttachments` (used in `ExecutionControlComposer.tsx:132-141`). Mentions expand the same way.
- Data sources: `listIssues(projectSlug, filters)` (`services/issues.ts:25`). PRs via the pull-request controller. **Files have no list endpoint yet** → Task 1 adds a scoped workspace file-search endpoint.

**Architecture:** A generic `useContextMentions` hook (entity-typed) + `ContextMentionPopover` replace the comment-only mention hook for the composer. Selecting a mention inserts a stable token (e.g. `@issue:DEMO-12`, `@file:path/to/x.ex`) into the textarea; on submit, `expandComposerMentions` turns tokens into a `## Context` block appended to the dispatched instructions. The slash registry becomes data-driven (skills/commands fetched from a new `/assistant/commands` list, with static fallback). A `useExecutionShortcuts` hook + `ExecutionCommandPalette` provide keyboard actions.

**Tech Stack:** React 19 + TanStack Query + `cmdk` + lucide, vitest; Elixir Phoenix controller (file search), ExUnit.

---

## File Structure

**Create (tracker):**
- `tracker/src/components/assistant/useContextMentions.ts` — generic, entity-typed mention state.
- `tracker/src/components/assistant/ContextMentionPopover.tsx` — grouped, searchable popover (issues / files / PRs).
- `tracker/src/components/assistant/contextMentions.ts` — token format + `expandComposerMentions(text, resolved)`.
- `tracker/src/services/workspaceFiles.ts` — `searchWorkspaceFiles(projectSlug, identifier, query)`.
- `tracker/src/components/issues/issue-detail/ExecutionCommandPalette.tsx`
- `tracker/src/hooks/useExecutionShortcuts.ts`
- `tracker/src/lib/executionShortcuts.ts` — shortcut registry (id, keys, labelKey).
- tests for each.

**Modify (tracker):**
- `tracker/src/components/assistant/AssistantComposer.tsx` — wire mention detection into the textarea `onChange`/`onKeyDown`, render `ContextMentionPopover`, expand tokens on submit.
- `tracker/src/components/assistant/slashCommands.ts` — data-driven command list + fallback.
- `tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx` — mount `ExecutionCommandPalette` + `useExecutionShortcuts` bound to its dispatch actions.
- locale files `en` + `pt-BR`.

**Create / Modify (backend):**
- `elixir/lib/symphony_elixir_web/controllers/tracker/workspace_file_controller.ex` — `GET /projects/:slug/issues/:id/files?q=` (scoped, read-only).
- `elixir/lib/symphony_elixir/workspace/file_search.ex` — safe, sandboxed file search within the issue workspace.
- route in `router.ex`; tests for both.

---

## Task 1: Backend — scoped workspace file search (for `@file:`)

**Files:** Create `workspace/file_search.ex` + `workspace_file_controller.ex`, add route, + tests.

Security-critical: results must never escape the issue workspace root (`Workspace.workspace_root_for/1`, `workspace.ex:81`). Reject `..`, absolute paths, and symlinks that resolve outside root. Cap results (e.g. 50) and ignore `.git`, `node_modules`, `_build`, `deps`.

- [ ] **Step 1: Write failing test for FileSearch** — given a temp workspace with `lib/a.ex`, `lib/b.ex`, `node_modules/x.js`: `FileSearch.search(root, "a")` returns `["lib/a.ex"]`; `search(root, "..")` returns `[]`; ignored dirs excluded; a path that resolves (via symlink) outside `root` is excluded.

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/workspace/file_search_test.exs -o`

- [ ] **Step 3: Implement** `FileSearch.search/3` — walk root with a denylist, substring/subsequence match on the relative path, `Path.safe_relative/2`-style guard + `File.lstat` symlink check, return sorted relative paths capped at `limit`.

- [ ] **Step 4: Write failing controller test** — `GET /projects/:slug/issues/:id/files?q=a` returns `%{data: ["lib/a.ex"]}`; missing workspace → empty list (not error).

- [ ] **Step 5: Implement controller + route** (mirror `editor_controller.ex` resolution: `Context.get_project` → `IssueAdapter.dispatch(:get_issue)` → `Workspace.workspace_root_for`). Add route under the existing issue scope in `router.ex`.

- [ ] **Step 6: Run (expect pass).**

- [ ] **Step 7: Commit** — `feat(exec): scoped workspace file-search endpoint`.

---

## Task 2: Tracker — mention token format + expansion (pure)

**Files:** Create `contextMentions.ts` + test.

- [ ] **Step 1: Write failing test**

```ts
import { mentionToken, parseMentionTokens, expandComposerMentions } from "@/components/assistant/contextMentions";

it("formats and parses tokens", () => {
  expect(mentionToken({ type: "issue", id: "DEMO-12" })).toBe("@issue:DEMO-12");
  expect(parseMentionTokens("see @issue:DEMO-12 and @file:lib/a.ex")).toEqual([
    { type: "issue", id: "DEMO-12" },
    { type: "file", id: "lib/a.ex" },
  ]);
});

it("appends a Context block on expansion", () => {
  const out = expandComposerMentions("fix @issue:DEMO-12", [
    { type: "issue", id: "DEMO-12", label: "DEMO-12 Login bug", detail: "Open" },
  ]);
  expect(out).toContain("fix @issue:DEMO-12");
  expect(out).toContain("## Context");
  expect(out).toContain("Issue DEMO-12");
});
```

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — `MentionType = "issue" | "file" | "pr"`; `mentionToken`, `MENTION_TOKEN_RE` (`@(issue|file|pr):([^\s]+)`), `parseMentionTokens`, and `expandComposerMentions(text, resolved[])` that leaves the inline tokens in place and appends a `## Context` section enumerating each resolved entity (issue identifier+title+status, file path, PR number+title). Unknown/unresolved tokens are passed through untouched.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(exec): mention token format + prompt expansion`.

---

## Task 3: Tracker — generic mention hook + popover

**Files:** Create `useContextMentions.ts` + `ContextMentionPopover.tsx` + tests.

Generalize `useCommentMentions.ts` from a single assignee list to entity groups, reusing its cursor/regex approach.

- [ ] **Step 1: Write failing hook test** — typing `"... @log"` at cursor opens the menu with `query === "log"` and `mentionStart` at the `@`; `selectMention({type:"file", id:"lib/log.ex"})` returns the new string with `@file:lib/log.ex ` spliced in; non-`@` input closes it.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** `useContextMentions(value)` — same `MENTION_PATTERN` shape as `useCommentMentions.ts:6`, exposing `{ open, query, handleChange, selectMention, close }`. `selectMention(entity)` splices `mentionToken(entity) + " "`.

- [ ] **Step 4: Write failing popover test** — given grouped options (issues/files/PRs) renders group headings, arrow-key `activeIndex` movement, Enter selects (mirror `MentionAutocomplete.tsx` roles/`data-active`).

- [ ] **Step 5: Implement** `ContextMentionPopover` — grouped list (lucide icons: issue=`CircleDot`, file=`FileText`, pr=`GitPullRequest`), keyboard nav, `onSelect(entity)`. Style after `MentionAutocomplete.tsx`.

- [ ] **Step 6: Run (expect pass).**

- [ ] **Step 7: Commit** — `feat(exec): generic context-mention hook + popover`.

---

## Task 4: Tracker — wire mentions into the composer

**Files:** Modify `AssistantComposer.tsx` + data wiring; test via `ExecutionControlComposer.test.tsx`.

- [ ] **Step 1: Write failing test** — in the execution composer, type `@DEMO`, see the issue option (mock `listIssues`), select it → textarea contains `@issue:DEMO-12`; submit → `dispatchIssueAgent` mock `instructions` contains a `## Context` block with the issue.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement**
- Add optional prop `mentionsEnabled?: boolean` + a `useContextMentionData(projectSlug, identifier, query)` query hook that fans out to `listIssues` (filter by `q`), `searchWorkspaceFiles`, and PRs (debounced, `enabled: open`).
- In the `Textarea` `onChange` (`AssistantComposer.tsx:625`), also call `mentions.handleChange(value, cursor)`; render `ContextMentionPopover` anchored above the textarea; intercept Arrow/Enter/Escape in `handleKeyDown` (`:458-484`) when `mentions.open` so Enter selects a mention instead of submitting.
- On submit (`submitCurrent`, `:430-451`), pass the raw input through; do the `expandComposerMentions` in `ExecutionControlComposer.tsx`’s `guidanceFromSnapshot` (`:136-141`) using the resolved entities cached from the popover (so the dispatched `instructions` carry the `## Context` block). Keep authoring-mode behavior unchanged unless `mentionsEnabled`.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(exec): @-mention issues/files/PRs in the execution composer`.

---

## Task 5: Tracker — data-driven `/` command palette (skills/commands)

**Files:** Modify `slashCommands.ts`; optional backend `/assistant/commands`; tests.

- [ ] **Step 1: Write failing test** — `matchingSlashCommands("/pl", t, "execution")` includes a `/plan`-style command from the registry; fuzzy match works; built-ins (`goal/infer/btw`) still resolve.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — keep `SLASH_COMMAND_SPECS` as built-ins, but let `resolveSlashCommands` merge in an injected list of skill/command entries (passed from the composer, sourced from a `useAssistantCommands(projectSlug)` query with a static fallback of the repo's known skills: `push/pull/land/evidence/workpad/...`). Switch matching to subsequence/fuzzy (reuse `matchesPickerSearch` from `lib/pickerOptions`). A non-action skill command inserts guidance text rather than changing `kind`.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(exec): fuzzy /-command palette with skills`.

---

## Task 6: Tracker — execution shortcut registry + hook

**Files:** Create `executionShortcuts.ts` + `useExecutionShortcuts.ts` + tests.

- [ ] **Step 1: Write failing tests**
- `executionShortcuts.ts`: `EXECUTION_SHORTCUTS` has unique ids + non-empty key descriptors + labelKeys; `matchShortcut(event)` maps a `KeyboardEvent`-like to an action id (e.g. `mod+enter`→`resume`, `mod+shift+r`→`restart`, `mod+.`→`stop`).
- `useExecutionShortcuts.ts`: dispatches the matched action handler; ignores typing inside inputs except the allowlisted ones (mirror `BoardPaletteShortcuts.tsx:34-35` `insideInput` guard).

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** registry + `useExecutionShortcuts({ onResume, onRestart, onStop, onHardReset, onCycleMode, onFocusComposer })` using a `window` keydown listener (cleanup on unmount). `Shift+Tab` mode-cycle from Plan 2a stays composer-local; global shortcuts use `mod`-combos to avoid clobbering typing.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(exec): execution keyboard-shortcut registry + hook`.

---

## Task 7: Tracker — execution command palette (⌘K)

**Files:** Create `ExecutionCommandPalette.tsx` + test; wire into `ExecutionControlComposer.tsx`.

- [ ] **Step 1: Write failing test** — palette opens on `⌘K`, lists actions (resume/restart/stop/hard-reset/cycle-mode/focus-composer) filtered by typing, selecting one calls the matching handler + closes.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — mirror `BoardPaletteShortcuts.tsx` (`CommandDialog`/`Command`/`CommandInput`/`CommandItem` from `cmdk`); items come from `EXECUTION_SHORTCUTS` with their lucide icons + key hints. Mount it in `ExecutionControlComposer.tsx` and pass handlers that reuse `runDispatch(...)`, the Plan 2a `setMode`/`cycleMode`, and a `focusComposer` ref. Respect `controlsDisabled`.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(exec): ⌘K execution command palette`.

---

## Task 8: Full gates + docs

- [ ] **Step 1: Backend gate** — `cd elixir && mix specs.check && make all` → pass.
- [ ] **Step 2: Tracker gate** — `cd tracker && npm run lint && npx vitest run && npm run build` → pass.
- [ ] **Step 3: Docs** — short "Execution control" help section: mention syntax (`@issue:`/`@file:`/`@pr:`), the `/` palette, and the shortcut table.
- [ ] **Step 4: Commit** — `docs(exec): document mentions, commands, and shortcuts`.

---

## Self-Review (spec coverage)

| Requirement (from user) | Task(s) |
| --- | --- |
| "pode citar issues, arquivos" (cite issues, files) | 1–4 (PRs included as a third type) |
| "vários comandos de atalho" (slash/shortcut commands) | 5 (`/` palette), 6–7 (keyboard + ⌘K) |
| "Atalhos" (shortcuts) | 6, 7 |

**Notes / decisions:**
- File mentions require the new scoped, read-only search endpoint (Task 1) because no file-list API exists today; it is sandboxed to the issue workspace with a symlink/`..` guard.
- Mentions are inserted as stable tokens and expanded into a `## Context` block at dispatch (reusing the attachment-enrichment pattern) so the agent receives concrete context without a new prompt-assembly path.
- This plan depends on Plan 2a for `setMode`/`cycleMode`; if 2a is not yet merged, Task 7's cycle-mode item can be stubbed and enabled later.
