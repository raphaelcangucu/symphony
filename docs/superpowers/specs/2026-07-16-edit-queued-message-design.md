# Edit Queued Assistant Message

- **Date:** 2026-07-16
- **Status:** Approved
- **Area:** `tracker/` assistant chat queue chips + composer

## 1. Summary

Allow editing a Cursor-style queued message by moving it back into the composer
(full payload), replacing any current draft. The item leaves the queue
immediately; resubmit re-queues if the turn is still blocked.

## 2. Decisions

| Topic | Choice |
|-------|--------|
| Interaction | Edit button on chip → dequeue into composer (not inline edit) |
| Non-empty composer | Replace draft without confirmation |
| Restored fields | `message` + `attachments` + `contextRefs` |
| Not restored | agent / model / effort (keep current composer settings) |
| Persistence | Existing `localStorage` queue write on dequeue |

## 3. UX

- Pencil button on each chip, between Send now and Remove.
- Click: remove from queue; apply draft to composer; focus textarea.
- Resubmit while blocked uses existing queue path.

## 4. Architecture

1. `QueuedMessageChips` gains `onEdit(id)`.
2. `ProjectAssistantPanel.editQueued(id)` finds item, removes it, bumps
   `composerDraftSeed: { requestId, message, attachments, contextRefs }`.
3. `AssistantComposer` accepts `draftSeed`; on `requestId` change applies input,
   hydrated attachments, and context refs, then focuses the textarea.
4. `hydrateAttachments` in `assistantAttachments.ts` rebuilds
   `AssistantAttachment[]` from serialized outgoing attachments.
5. `useComposerAttachments` exposes `replaceAttachments` (revoke old previews).

No backend changes.

## 5. Edge cases

- Unknown id → no-op.
- Hydrated image/file may lack blob preview; resend uses `path` / audio `data`.
- Empty queue after edit clears chips and storage.

## 6. Tests

- Chips: edit button calls `onEdit`.
- Panel: edit removes chip and seeds composer text.
- `hydrateAttachments` round-trip for image/file/audio shapes.
- Composer: new `draftSeed.requestId` applies message + contextRefs.
