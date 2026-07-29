# Single Running Activity: Design and E2E Analysis

## Outcome

The implemented design matches the recommended interactive direction: a
command is now represented by one stateful timeline row instead of a generic
turn-level status followed by a second command-level status.

The row moves through the same visual object:

`Running sleep 8 · 0:03  Kill` → `Ran sleep 8 · 7s`

The turn-level Stop action remains in the composer. Kill remains contextual to
the command row. This separates the two scopes without duplicating either
action.

## Proposed design compared with the generated UI

| Design intent                             | Generated result                                                                         | Assessment |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- | ---------- |
| One source of truth for active work       | The transcript tool call replaces the global fallback when IDs match                     | Achieved   |
| Compact Codex-like hierarchy              | Sentence-case verb, concise command, elapsed time, and Kill share one quiet row          | Achieved   |
| Remove shell implementation noise         | The exact `/bin/zsh -lc '<payload>'` wrapper is display-normalized                       | Achieved   |
| Preserve diagnostic detail                | Expanding the row reveals the original raw command                                       | Achieved   |
| Preserve useful fallback                  | The global working indicator remains only before the transcript tool call is represented | Achieved   |
| Distinguish command and turn cancellation | Kill is inline; Stop is in the composer                                                  | Achieved   |
| Preserve completion continuity            | The same row changes from Running to Ran and retains duration                            | Achieved   |

The main visual improvement is not simply removing a row. The generated layout
now gives every remaining element a single job:

- the spinner and Running/Ran verb communicate state;
- the normalized command communicates what is happening;
- elapsed time communicates progress;
- Kill controls the command;
- the composer control stops the whole turn.

This is materially closer to Codex because the UI reads as a timeline event,
not as two independent status widgets competing for attention.

## E2E test analysis

The real app was exercised with a Codex-backed prompt that requested an actual
`sleep 8` command followed by `OK`.

Observed sequence:

1. The submitted prompt appears as the current turn.
2. One `Running` row appears with `sleep 8`, a live clock, and Kill.
3. No second global running status is rendered while that tool call is present.
4. The composer exposes the single turn-level Stop control.
5. The row settles to `Ran sleep 8 · 7s`.
6. The assistant response and turn summary appear without changing the command
   row's identity.

The reported duration is based on provider timing when available and otherwise
on first client detection of the tool. That avoids the earlier inflated result
caused by inheriting the beginning of the whole assistant turn.

Automated verification covered formatting, 137 focused tests across 9 files,
and a production TypeScript/Vite build. The E2E video is 17.5 seconds,
1280×720, H.264.

An independent code review initially found four important gaps: uppercase
command verbs, lost raw-command detail, fallback suppression depending on an
active snapshot, and timing limited to the first active tool. The implementation
and tests were revised to address all four before final validation. The
follow-up review found no remaining Critical or Important issue.

## Visual review and residual opportunities

Desktop density, hierarchy, and action placement now match the proposed design.
The command row remains legible without creating a card inside a card, and the
composer retains a clear primary stop affordance.

At the narrow mobile evidence width, the command activity and composer remain
usable, but the global project header still overflows horizontally. That header
predates this change and is outside the command-activity boundary. It should be
handled as a separate responsive-navigation pass so its solution can consider
all project views rather than introducing a local exception in the assistant.

## Evidence

- `.symphony/evidence/artifacts/screens/composer-single-running-activity-desktop.jpg`
- `.symphony/evidence/artifacts/screens/composer-single-running-activity-mobile.jpg`
- `.symphony/evidence/artifacts/screens/composer-single-running-activity-disclosure.jpg`
- `.symphony/evidence/artifacts/videos/composer-single-running-activity-e2e.mp4`
