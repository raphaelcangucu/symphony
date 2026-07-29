# Unified composer and turn navigation rail

**Date:** 2026-07-29
**Status:** Written for user review
**Surfaces:** Assistant sessions and orchestrator execution sessions

## Problem

The Assistant and Execution surfaces already share parts of
`AssistantComposer`, but their visible controls and operational semantics have
diverged:

- the execution composer exposes Diff, execution mode, Magic, reset, steer,
  queue, stop, goal, model, effort, and attachment controls at the same visual
  level;
- Assistant and Execution use different chrome around otherwise related
  conversation behavior;
- queued guidance is presented as a separate block instead of a compact,
  actionable next-turn item;
- the transcript has no Codex-style turn navigation rail;
- operator-facing permission labels (`plan`, `build`, and `yolo`) describe
  implementation modes instead of a provider-neutral approval contract.

The result is visually dense and makes it harder to understand which action is
primary at any moment.

## Goals

1. Use one compact composer shell for Assistant and Execution.
2. Keep only the controls needed on every message in the primary toolbar.
3. Automatically queue messages submitted while a run is active.
4. Let a queued item become an immediate steer when the active agent supports
   steer.
5. Use one stateful primary button for send/start and stop.
6. Expose provider-neutral permission levels persisted by conversation.
7. Preserve Goal, Magic, Context, Diff, KB, attachments, commands, skills,
   model, effort, voice, mentions, and slash commands.
8. Add a Codex-style navigation rail that represents conversation turns.
9. Reuse the existing goal controls for play/pause, edit, and remove.

## Non-goals

- Reimplementing provider runtimes or native goal APIs.
- Changing the message/tool-card rendering inside an assistant response.
- Removing keyboard, slash-command, mention, attachment, or voice behavior.
- Making every provider expose capabilities it does not support.
- Redesigning the session header, Tasks dock, terminal, preview, or
  environment docks.

## Product decisions

### Shared shell and capability adapters

`UnifiedComposer` is the single visual shell. Assistant and Execution provide
presets, while an agent capability adapter describes actual provider support.

```ts
type ComposerSurface = "assistant" | "execution";

interface ComposerCapabilities {
  queue: boolean;
  steer: boolean;
  stop: boolean;
  goal: {
    create: boolean;
    pause: boolean;
    resume: boolean;
    edit: boolean;
    clear: boolean;
  };
  permissions: readonly ComposerPermissionLevel[];
  actions: readonly ComposerActionId[];
}

type ComposerPermissionLevel =
  | "ask_for_approval"
  | "approve_for_me"
  | "full_access";
```

The UI uses the same labels for Codex, Claude, Cursor, and future providers:

| Stable UI ID | Label |
| --- | --- |
| `ask_for_approval` | Ask for approval |
| `approve_for_me` | Approve for me |
| `full_access` | Full access |

Provider adapters translate these IDs to native modes. Unsupported levels stay
visible but disabled with an explanation. They are not silently hidden.

### Permission persistence

- A new conversation starts with the selected agent's configured default.
- If the agent has no explicit default, use `full_access`.
- Once the conversation exists, its permission selection is persisted on the
  conversation/thread, not in browser-local composer state.
- Switching agents keeps the conversation selection when supported.
- If the selected level is unsupported by the new agent, the UI keeps it
  visible as incompatible and requires a supported selection before dispatch.

The existing `plan` / `build` / `yolo` runtime values remain in transport
contracts during the migration, but user-facing copy uses the neutral
permission labels. `Yolo` is replaced by `Full access`.

### Compact primary toolbar

The primary row contains:

1. `+` action menu;
2. current permission level;
3. agent/model/effort control;
4. microphone;
5. one circular primary action.

The primary action occupies one stable position:

| State | Icon/action |
| --- | --- |
| No active run and draft can send | Up arrow: send/start/resume |
| Active run | Square: stop |
| Pending transition | Matching icon with busy state |

While a run is active, Enter still submits the draft to the queue. The visible
primary button remains Stop so stopping a run never moves or competes with
queueing.

### `+` action registry

Secondary actions move into a registry-backed `+` menu:

- Files and folders
- Context
- Diff
- Knowledge Base
- Magic
- Goal
- Commands and skills

Each registered action defines its icon, label, shortcut, availability, and
compatible surface. Existing dialogs, palettes, sheets, callbacks, and
keyboard shortcuts are reused. For example, Diff opens the existing diff
launcher and Magic opens the existing palette.

Unavailable actions remain visible and disabled when the absence is a
capability limitation. Actions that are structurally irrelevant to the current
surface are omitted; specifically, Diff is omitted when there is no workspace.

### Queue-first submission

This design intentionally supersedes the current behavior in
`2026-07-17-unified-session-panel-design.md`, where a steerable active run sends
Enter directly as steer.

The new behavior is:

1. No active run: Enter sends/starts/resumes.
2. Active run: Enter always creates a queued guidance item.
3. `Shift+Enter`: inserts a newline in every state.
4. A queued item preserves text, attachments, and context references.
5. When steer is supported, the queued item exposes `Steer now`.
6. Without steer support, the equivalent action is `Send again`; the UI never
   claims it can steer.

The durable server queue remains the source of truth when available. Local
optimistic items receive stable client IDs and reconcile with the server
snapshot rather than being keyed by list index.

### Queued item actions

Queued guidance appears immediately above the goal/composer as a compact
next-turn row. Its frequent actions are visible:

- `Steer now` or `Send again`, depending on capability;
- remove.

The overflow menu contains:

- Edit message
- Open in side chat
- Turn off queueing

`Open in side chat` delegates to the new-thread handoff path; it must not mutate
the active execution. It creates a separate Assistant session with the queued
text, attachments, and context references as its seed.

Queueing is enabled by default. Turning it off affects subsequent submissions
only: with an active steer-capable run, Enter steers immediately; with an active
non-steerable run, submission is disabled until the run ends. Existing queued
items remain visible until sent or removed.

### Goal strip

The existing native goal state remains authoritative. `GoalPill` behavior is
restyled as a compact strip above the composer and retains capability-gated
controls:

- active goal: pause;
- paused goal: play/resume;
- editable goal: edit objective;
- clearable goal: remove;
- runtime stop remains the composer primary Stop action.

Unsupported goal actions stay absent or disabled according to the existing
native capability contract; the UI does not synthesize goal support.

### Turn navigation rail

The new component is named `TurnNavigationRail`. It is distinct from the
existing `AssistantTurnTimeline`, which orders text and tool activity inside a
single assistant message.

A turn is one user submission and the assistant/execution response it starts.
The rail:

- renders one compact group of horizontal marks per turn;
- aligns the group with that turn's user-message anchor;
- emphasizes the active/current turn;
- shows a compact preview containing the user prompt and response prefix on
  hover, keyboard focus, or selection;
- scrolls to the turn when activated;
- updates the selected mark as the transcript crosses turn anchors;
- supports both Assistant history and the adapted execution session feed.

The rail is navigation, not a second transcript. It does not duplicate full
message bodies or tool events.

On narrow screens the marks use a smaller gutter and the preview becomes a
popover. The rail must not introduce a second vertical scrollbar.

## Component boundaries

```text
AssistantSessionShell
├── TurnNavigationRail
│   └── TurnNavigationItem[]
├── AssistantMessageList
│   └── existing message/tool rendering
└── UnifiedComposer
    ├── QueuedGuidanceList
    │   └── QueuedGuidanceItem
    ├── UnifiedGoalStrip
    ├── ComposerTextarea
    └── ComposerPrimaryToolbar
        ├── ComposerAddMenu
        ├── ComposerPermissionMenu
        ├── AgentModelEffortMenu
        ├── VoiceControl
        └── ComposerPrimaryAction
```

Execution-specific behavior is supplied through an adapter rather than a
parallel composer:

```text
Assistant preset
  -> assistant channel adapter
  -> UnifiedComposer

Execution preset
  -> session-log / issue-dispatch adapter
  -> UnifiedComposer
```

The adapter owns transport and state transitions. The shell owns presentation,
keyboard intent, focus, menus, and accessible labels.

## Data flow

1. Load thread metadata, surface, agent, provider catalog, permission, active
   run, goal, and durable queue snapshot.
2. Derive `ComposerCapabilities` from the selected agent and runtime.
3. Derive the composer state machine from run state and capabilities.
4. The user edits a draft; existing attachment/context hooks remain in use.
5. Submit routes to send/start/resume when inactive or queue when active.
6. Queue mutation updates optimistically and reconciles by stable ID.
7. Promotion invokes steer only after capability and active-turn checks.
8. Run, goal, permission, and queue events update the same shell without
   remounting or losing the draft.
9. Transcript turn anchors update the rail selection through the existing
   scroll container.

## Error handling and race conditions

- Queue failure restores the draft and attachments and shows an inline error.
- Steer promotion failure leaves the item queued and reports the canonical
  provider error; it never drops guidance.
- If the run finishes during queue submission, reconcile to a normal next-turn
  send instead of duplicating the message.
- If steer capability disappears before promotion, retain the item and replace
  the action with `Send again`.
- Stop failure restores the active Stop control and shows the existing
  dispatch error.
- Permission persistence failure restores the last server-confirmed value.
- Agent switches with an incompatible permission block dispatch until the user
  chooses an enabled level.
- Goal mutations remain optimistic only where the existing goal service already
  supports safe reconciliation; otherwise keep the current confirmed goal.
- Turn previews tolerate missing/empty response text and attachment-only user
  messages.
- Composer menus close on Escape, outside click, surface change, and successful
  action dispatch.

## Accessibility

- Every rail item is a native button with an accessible turn label.
- Selected/current turn is exposed with `aria-current`.
- Disabled permission/action options explain why through visible secondary
  copy, not tooltip-only text.
- Primary action has state-specific accessible labels: Send, Start, Resume, or
  Stop.
- Queue action labels distinguish `Steer now` from `Send again`.
- Menus preserve native focus order and return focus to their trigger.
- Reduced-motion preferences disable animated scroll and state transitions.

## Testing

### Unit and component

- capability normalization for Codex, Claude, Cursor, and unsupported levels;
- permission default and conversation persistence;
- active-run Enter queues even when steer is available while queueing is
  enabled;
- inactive Enter sends/starts/resumes;
- Shift+Enter creates a newline;
- one primary action changes between send/start/resume and stop;
- queue item edit, remove, promote, resend, side-chat, and disable-queueing;
- steer failure retains the queued item;
- goal pause/resume/edit/remove capability gating;
- `+` registry visibility, disabled explanations, and existing callbacks;
- draft/attachments/context survive run and capability updates;
- turn grouping, active anchor, preview, click/keyboard navigation;
- compact and expanded responsive layouts.

### Integration

- Assistant and Execution mount the same shell with different adapters;
- execution session-log snapshots reconcile queue and run state;
- permission survives reload from thread state;
- switching agents preserves or blocks the conversation permission correctly;
- existing Magic, Context, Diff, KB, goal, voice, slash, mention, and attachment
  paths still open and submit as before.

### Visual and manual

- Compare Assistant and Execution at desktop, tablet, and narrow widths.
- Verify the rail against Codex reference captures: grouped horizontal marks,
  active emphasis, turn preview, and no continuous vertical line.
- Verify the composer against the approved iterative visual: compact row,
  permission menu, `+` menu, queue row, goal strip, and stable send/stop slot.
- Verify long prompts, many queued items, disabled permissions, attachment-only
  drafts, long goal text, and translated copy.

## Acceptance criteria

1. Assistant and Execution use the same composer shell.
2. Active-run Enter queues and never steers immediately while default queueing
   is enabled; disabling queueing explicitly enables immediate steer only for a
   steer-capable active run.
3. A queued item can be promoted to steer only when supported.
4. Send/start/resume and stop share one stable primary-action position.
5. Permission labels are provider-neutral and persisted on the conversation,
   with agent default and `full_access` fallback.
6. Unsupported permission levels remain visible and disabled with explanation.
7. Goal play/pause, edit, and remove reuse native controls.
8. Files, Context, Diff, KB, Magic, Goal, commands, and skills are available
   from `+` without losing existing behavior or shortcuts.
9. The Codex-style turn rail works for Assistant and Execution transcripts.
10. Existing model, effort, voice, slash, mention, attachment, queue, steer,
    goal, and error behavior is covered by regression tests.
11. No unrelated mobile worktree changes are modified or committed.
