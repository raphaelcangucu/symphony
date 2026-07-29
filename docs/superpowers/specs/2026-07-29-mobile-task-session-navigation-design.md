# Mobile Task and Session Navigation Design

## Goal

Make task-associated mobile sessions feel connected to their underlying task
without overcrowding the session header or copying the entire web issue drawer
onto a smaller screen.

The approved design adds:

- a task shortcut beside the terminal shortcut in associated sessions;
- an animated screen transition from session to task detail;
- a focused mobile task detail with five essential tabs;
- Plan mode, Magic, and entity-aware context selection in the composer `+`
  menu.

## Session header and navigation

When a session is associated with a task, its header shows two trailing icon
buttons:

1. Terminal.
2. Open task.

The task button uses the task/list icon and an accessible label containing the
task identifier. It is absent for sessions without an associated task.

Tapping it pushes the task detail screen from right to left. Returning to the
session reverses that animation and preserves the session state, message
position, draft, and composer settings. This is normal stack navigation, not a
modal or nested drawer.

## Mobile task detail

The task screen borrows the information hierarchy of the web issue drawer but
reduces its navigation to five tabs:

1. Summary
2. Pull request
3. Comments
4. Evidence
5. Sessions

Preview, activity, terminal, files, and diff remain available through the
associated session or workspace. They are not duplicated as top-level task
tabs.

The persistent header contains the task identifier, workflow status, back
button, and overflow actions. The tab strip stays immediately below it.

### Summary

Summary prioritizes the task's decision-making context:

- title;
- status, priority, assignee, agent, model, and effort;
- related pull request and branch;
- description;
- Codex Workpad progress;
- labels and last-updated time;
- primary actions to open the associated session or workspace.

The initial implementation is read-oriented. Mutating or secondary operations
belong in the overflow menu or existing dedicated flows, keeping the primary
screen calm and scannable.

### Pull request

The pull-request tab shows:

- linked PR number, title, source and target branches;
- overall merge state;
- individual checks;
- review state;
- monitor summary;
- action to open the full pull request.

Status is encoded with both color and text:

- success for passing checks;
- warning for pending review or other attention;
- destructive for failed or merge-blocking checks.

A concise problem panel appears when merge is blocked. It states the number and
nature of the problems and provides a clear route to their details. Color is
never the only signal; every state also has a label and marker.

### Comments

Comments contains a compact Markdown composer with `@` mentions, a submit
action, and the chronological comment stream. Each comment shows author,
timestamp, body, and relevant system badges such as Workpad or evidence when
present.

### Evidence

Evidence leads with the latest run status, timestamp, and execution provenance.
It summarizes build and E2E results, model/effort provenance, and artifact hash.
Previewable artifacts such as desktop screenshot, mobile screenshot, video,
trace, logs, and manifest appear in a compact grid. A final action opens the
complete evidence run.

### Sessions

Sessions lists the task's execution session first, followed by associated chat
sessions. Each row includes type, agent when available, state, updated time,
preview, and a chevron to open it. A compact primary action starts a new
task-associated session.

## Composer `+` menu

The `+` button opens a bottom sheet titled `Add to session`. The approved
actions are:

1. Plan mode
2. Magic
3. Add context
4. Attach photo
5. Set or edit goal

Plan mode is a direct, visible choice rather than being hidden under model or
permission settings. Selecting it changes the composer/session into the
existing planning workflow.

### Magic

Magic opens a searchable mobile palette inside the same bottom-sheet flow. It
contains the same command sources and grouping as the web palette:

- built-in slash commands;
- workspace prompt templates;
- template metadata such as agent, effort, and execution mode.

Selecting a slash command inserts or invokes it according to the existing web
contract. Selecting a prompt template runs it with the current project and task
context. Loading, running, empty, and failure states are explicit.

### Add context

Add context opens a searchable entity picker aligned with the web mention
system. Results are grouped in this order:

1. Issues
2. Files
3. Pull requests

Each result includes its type icon, stable identifier or filename, and a short
label or path. Selecting an entity attaches the same structured mention
reference used by the web composer instead of pasting an untyped string. The
chosen context is then visible in the composer before sending.

## Component boundaries

Implementation should keep these responsibilities separate:

- task association and header shortcut;
- navigation helper for opening the task and returning to the session;
- mobile task detail shell and tab strip;
- one focused content component per task tab;
- composer quick-action sheet;
- Magic palette;
- grouped context picker.

The mobile components should consume existing task, PR, evidence, session,
Magic, and mention contracts where available. They should not introduce a
second incompatible representation of these entities.

## States and failures

Every tab supports loading, empty, error, refresh, and populated states.
Unavailable optional data does not block the whole task screen. For example, a
PR fetch failure affects the PR tab but not Summary or Sessions.

Navigation to a task that no longer exists shows the task error state and a
working return path to the session. Failed Magic commands and context searches
keep the bottom sheet open and preserve the current composer draft.

## Accessibility and interaction

- All icon-only buttons have descriptive accessible labels.
- Tab selection is announced and remains keyboard/screen-reader navigable.
- Status never relies on color alone.
- Touch targets are at least the app's established mobile minimum.
- The back gesture and hardware back button follow the same stack behavior as
  the visible back button.
- Reduced-motion preferences replace the slide with a short crossfade.

## Validation

The implementation plan must include:

- unit tests for task-association visibility and navigation routing;
- component tests for all five tabs and their loading/error/empty states;
- component tests for Plan mode, Magic, and grouped context selection;
- tests proving issue/file/PR context uses structured mention references;
- tests for PR success, warning, and failure presentation;
- mobile E2E for session to task transition and return-state preservation;
- mobile E2E for opening Magic and adding issue, file, and PR context;
- visual evidence for both phone platforms supported by the existing suite.

## Out of scope

- Reproducing all eight web issue tabs on mobile.
- Rebuilding terminal, preview, files, or diff inside task detail.
- Introducing new Magic command semantics.
- Expanding context types beyond the web-supported issues, files, and pull
  requests.
- Redesigning the desktop/web issue drawer.
