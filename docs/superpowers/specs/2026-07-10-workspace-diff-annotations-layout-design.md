# Workspace Diff modal — commit annotations + Branch/Uncommitted layout

**Date:** 2026-07-10  
**Status:** Approved for planning  
**Context:** Tracker `GitDiffModal` (“Diff do workspace”) on issue/assistant sessions

## Problem

1. **Commits** tab shows history and per-commit diffs, but review/annotation is disabled. Users cannot leave notes on commits for the assistant the way they can on Branch / Não commitado working-tree diffs.
2. **Não commitado** uses a sparse empty state and a file list without per-file +/- or review badges, so the working-tree lens feels thinner than it should for the primary “review then send” flow.
3. **Branch** looks almost identical to Não commitado, with no branch/base/ahead/behind context, so the tab’s purpose is unclear.

## Goals

1. On **Commits**, support **commit-level notes** and **line comments** on the selected commit’s diff.
2. Keep delivery as **accumulate in the modal → Enviar review → one prompt to the assistant** (same pattern as today’s line review). No server persistence of notes/comments.
3. Improve **Não commitado** with a **summary strip**, denser file list (**+/- per file**, **💬 badge** when that path has comments), and a useful empty state — without staging.
4. Improve **Branch** with a **status strip** (current branch, base, ahead/behind, stats) above the existing aggregated branch-vs-base diff.

## Non-goals

- Git staging / unstage / discard / checkout.
- Persisting notes or comments on the server or across modal closes (beyond the current in-memory session).
- Auto-injecting annotations into the assistant without an explicit Enviar review click.
- Replacing the Commits evidence API or changing commit creation behavior beyond UI affordances already present.

## Decisions (approved)

| Topic | Choice |
| --- | --- |
| Commit annotation shape | Both: note on whole commit + line comments on commit diff |
| Delivery to assistant | Button “Enviar review” (session accumulate), not auto-attach |
| Branch tab | Status strip + aggregated diff vs base (keep file tree + viewer) |
| Não commitado layout | Polish current + summary strip + dense list (A+C); no staging |
| Overall approach | One coherent modal (approach 2), not minimal-only or staging+persistence |
| Persistence | In-memory while modal open; clear on send or close |

## Approach

### 1. Unified in-memory review session

Extend the existing `diffReview` model so one modal session can hold:

- **Line comments** from Branch, Não commitado, and Commits (with source metadata).
- **Commit notes** keyed by `repo` + `sha`.

```ts
type DiffReviewSource = "branch" | "uncommitted" | "commit";

type DiffReviewComment = {
  id: string;
  filePath: string;
  side: "additions" | "deletions";
  lineNumber: number;
  lineText: string | null;
  comment: string;
  source: DiffReviewSource;
  commitSha?: string;
  commitRepo?: string;
};

type CommitNote = {
  repo: string;
  sha: string;
  note: string;
};
```

Enable line-comment UI on the Commits tab (today `reviewEnabled = activeTab !== "commits"` must change when `onSendReview` is set).

**Enviar review** stays disabled until there is at least one non-empty commit note or line comment. On success: call `onSendReview(prompt)`, toast, clear session state, close modal (same as today).

### 2. Commits tab UI

Left list (existing `CommitList`):

- Show a **📝** preview/snippet when that commit has a non-empty note.
- Show **💬 n** for line-comment count on that commit.

Right panel:

- **Nota do commit** textarea above the file diff (bound to selected `repo`+`sha`). Empty placeholder: note for the assistant. Autosave into session state on change.
- Below: existing `GitDiffViewer` with line comments enabled for this commit’s files. New comments store `source: "commit"` plus sha/repo.

### 3. Prompt shape

Extend `buildDiffReviewPrompt` (or a sibling builder) to emit English agent-facing text:

```text
I reviewed workspace diffs and left notes. Address each:

## Commit notes
### <repo> @ <shortSha> — <subject>
- <note>

## Line comments
### <repo> @ <shortSha> — <filePath>   # when source=commit
### (working tree) — <filePath>        # when source=uncommitted
### (branch) — <filePath>              # when source=branch
- line N:
  > <lineText>
  <comment>
```

Omit empty sections. Preserve stable grouping/sort (by commit then file then line).

### 4. Branch status strip

Above the file tree + viewer when `activeTab === "branch"`:

- Per repo (or a compact multi-repo summary): **current branch**, **base** (default branch / merge-base label), **ahead**, **behind**, file count, +/- totals.
- If a field is unavailable, show **—** (graceful degrade).

**Backend:** extend workspace diff payload (or a small companion field on the existing diff response) so each repo can include branch metadata. Prefer enriching `WorkspaceDiff` / controller JSON rather than a separate round-trip. UI must not hard-fail if metadata is missing.

### 5. Não commitado layout polish

When `activeTab === "uncommitted"`:

- **Summary strip:** “Working tree”, file count, +/- totals, and count of review comments with `source: "uncommitted"`. Do **not** duplicate the toolbar Commit button in the strip.
- **File list:** show per-file +/- (from `diffStatsFromPatch`); show **💬** only for comments on that path with `source` matching the active tab (`uncommitted` or `branch`).
- **Empty state:** when no files, show a clear message plus **Atualizar** and **Ver Branch** actions instead of only “select a file” in the viewer.

Apply the same per-file +/- / 💬 list polish on Branch for consistency where cheap.

### 6. Primary files

| Area | Files |
| --- | --- |
| Modal orchestration | `tracker/src/components/issues/issue-detail/git-diff/GitDiffModal.tsx` |
| File list | `tracker/src/components/issues/issue-detail/git-diff/GitDiffFileTree.tsx` |
| Review model / prompt | `tracker/src/lib/diffReview.ts` (+ tests) |
| Types / API client | `tracker/src/types/gitDiff.ts`, gitDiff service/hooks as needed |
| Branch metadata | `elixir/lib/symphony_elixir/evidence/workspace_diff.ex`, `WorkspaceDiffController` |
| i18n | tracker locale strings for new labels/empty states |

## Error handling

- Commit detail load failure: keep list selection; show existing empty/error treatment in the viewer; do not lose in-memory notes for that sha.
- Branch metadata failure: strip shows placeholders; diff still loads.
- Send with only whitespace notes: treat as empty; do not send.

## Testing

- Unit: `diffReview` prompt includes commit notes + sourced line comments; omits empty sections.
- Component: Commits tab enables comment UI when `onSendReview` is set; note + line comment appear in sent prompt; badges update in list.
- Component: Não commitado empty state and file +/- / comment badge rendering.
- Elixir: branch metadata fields present when git state is known; absent/null-safe when not.

## Out of scope follow-ups

- Persisted review drafts per issue.
- Staging UI.
- Selecting commits as “context packs” without free-text notes (option D from brainstorming).
