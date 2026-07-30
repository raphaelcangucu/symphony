# Single running activity

**Date:** 2026-07-29  
**Status:** Approved visual direction  
**Surface:** Assistant chat tool activity

## Problem

While a tool is active, the chat renders the same execution twice:

1. `FileActivityCard` renders the live tool call in the assistant turn timeline.
2. `WorkingIndicator` repeats that tool call below the transcript as the global
   running-turn indicator.

This produces two spinners, two running labels, and competing Stop/Kill
controls. They represent one tool call, not two processes.

## Approved behavior

The live tool call is the single source of truth whenever an active tool is
present.

- During execution, render one line:
  `Running sleep 10 · 0:07`.
- Hide transport wrappers such as `/bin/zsh -lc` when the command argument has
  the exact form `/bin/zsh -lc '<payload>'`; display the unquoted payload while
  retaining the raw command in expandable details. Other command shapes remain
  unchanged.
- Keep `Kill` on the live command row because it targets that tool call.
- Keep turn-level `Stop` only in the composer's stable primary action.
- Do not render the global `WorkingIndicator` while that same active tool is
  already visible in the timeline.
- On completion, update the same row to:
  `Ran sleep 10 · 10s`.
- When the turn is active without a visible tool call, retain a compact global
  status such as `Working for 0:07`.
- Preserve stale/no-activity feedback in the fallback global status.

## State model

| Turn state | Visible activity |
| --- | --- |
| Active with a visible tool call | One live timeline row with elapsed time and Kill |
| Active without a visible tool call | Global Working indicator with elapsed time |
| Tool call completed | Settled timeline row with completed verb and duration |
| Turn stopped or completed | No global Working indicator |

The decision to suppress the global indicator must be based on whether the
active tool call is present in the rendered transcript, not merely whether the
server reports an `activeTools` snapshot. This avoids hiding all activity when
the live tool has not yet reached the client transcript.

## Presentation

The live command row follows the Codex hierarchy:

- one spinner at the leading edge;
- sentence-case progressive verb (`Running`);
- concise command title without shell-launcher noise;
- muted elapsed time separated with `·`;
- contextual `Kill` action at the trailing edge;
- no uppercase status badge;
- expandable input/output remains available through the existing disclosure.

The row should not introduce a new card surface. It remains part of the
assistant turn timeline and uses the existing activity typography.

## Component changes

- `AssistantMessageList` derives whether the active tool is already represented
  by a rendered message and suppresses `WorkingIndicator` only in that case.
- `FileActivityCard` uses state-aware command verbs (`Running` / `Ran`) and
  receives elapsed timing for a live command.
- `ToolActivityTimeline` receives timing keyed by stable tool-call ID. The
  panel captures the active tool's server `startedAt`; when the tool settles, it
  retains the final elapsed duration for the life of the mounted transcript.
- The composer continues to own the turn-level Stop action.
- Existing Kill transport callbacks and expandable output stay unchanged.

## Accessibility

- The single live row retains `aria-busy`.
- The visible copy communicates activity without relying only on animation.
- `Kill` keeps the active tool-call identifier as its target.
- The composer Stop button keeps its current accessible label.
- Reduced-motion preferences disable spinner rotation without removing the
  running label.

## Testing

1. A running tool represented in the transcript produces one running activity,
   not a second `WorkingIndicator`.
2. A running turn without a rendered active tool retains the fallback
   `WorkingIndicator`.
3. The active row renders `Running`, concise command copy, elapsed time, and
   Kill.
4. Completion changes the row to `Ran` and removes Kill.
5. Stop remains available in the composer during the active turn.
6. Stale feedback remains available when the fallback indicator is used.

## Acceptance criteria

1. One backend tool call never appears as two simultaneous running rows.
2. Active and completed command copy follows `Running …` / `Ran …`.
3. Kill is tool-scoped; Stop is turn-scoped and remains in the composer.
4. A turn without a visible tool call still communicates that work is active.
5. Existing tool output, disclosure, queue, steer, and composer behavior do not
   regress.
