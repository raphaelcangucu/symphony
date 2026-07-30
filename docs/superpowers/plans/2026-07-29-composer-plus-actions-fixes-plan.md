# Composer `+` Actions Fixes — Implementation Plan

**Goal:** Make every composer `+` action functional and keep the Diff workspace usable on a mobile viewport.

**Approach:** Route Context and Goal through explicit input-action requests owned by `AssistantComposer`, so focus occurs after the dropdown closes and the existing mention/slash-command flows remain canonical. Make the Diff workspace responsive with a single-column mobile layout and horizontally scrollable compact controls. Preserve the current generic permission copy and update its stale test.

## 1. Context and Goal regressions

- Add panel-level regression tests proving that Context inserts `@`, Goal inserts `/goal `, and the textarea retains focus after the menu closes.
- Add a typed input-action request to `AssistantComposer` and pass it through `UnifiedComposer`.
- Wire the `+` handlers in `ProjectAssistantPanel` to issue those requests without discarding an existing draft.

## 2. Diff mobile overflow

- Add a structural regression test for the responsive Diff workspace and toolbar.
- Make the dialog, toolbar, split workspace, aside, and viewer honor `min-width: 0`.
- Use one column on mobile and restore the two-panel workspace at the desktop breakpoint; keep toolbar controls reachable through horizontal scrolling.

## 3. Verification

- Replace the obsolete `Plan` assertion with the current `Ask for approval` permission label.
- Run focused unit/integration tests for the composer menu, unified composer, Magic palette, and Diff modal.
- Repeat the mobile E2E across every `+` action and capture screenshots/video plus an updated functional analysis.
