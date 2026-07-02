# Task Grouping on the Board (Grouped Orchestrator Execution) — Design

> ## ⚠️ DEPRECATED (2026-06-30) — superseded by pure parent/child
>
> Issue **grouping is removed**. The "Parent/Child Execution Rework"
> (`2026-06-29-symphony-orchestrated-subagents-design.md`) replaces grouping with a
> strict **parent/child (sub-issue)** hierarchy. The board **drag-drop merge gesture
> now sets the parent/child relationship** (`setIssueParent` → `POST .../parent`),
> not a group. The grouping backend (`Orchestrator.Grouping`, `Tracker.Sync.GroupStatus`,
> `GroupController`, the `/group` routes, `group_lead_id`, and `group_members_section`)
> and the grouping frontend (group cards/banners/lead picker) have been deleted; a
> migration drops `group_lead_id` after converting existing members to `sub_issue_of`.
> This document is retained for history only.

Date: 2026-06-18
Status: **Deprecated** (removed in favor of parent/child; was: Draft pending user review)
Topic: Allow grouping one or more board issues by drag-and-drop so the
orchestrator executes the whole group as **a single unit of work** — one agent
session, one workspace, one branch, one pull request that covers every issue in
the group.

## Background / Motivation

Today the board lets you drag a card to **move/reorder** it across workflow
columns. The orchestrator then dispatches issues strictly **one issue → one
agent task → one workspace/branch/PR**, keyed by `issue.id`
(`elixir/lib/symphony_elixir/orchestrator.ex`, `agent_runner.ex`,
`workspace.ex`). There is **no concept of grouping** between issues — the only
inter-issue relation is `blocked_by` (`local_tracker_issue_relations` via
`IssueRelation`).

Users frequently have several small, tightly-coupled tasks (e.g. `CDE-1139` and
`CDE-1140`) that touch the same code and are wasteful to run as separate agent
sessions / separate PRs. We want to let the user **group them on the board** and
have the orchestrator treat the group as one task.

### Decisions made with the user

- **Execution semantics**: **single run** — one agent/session takes the whole
  group, in one workspace and branch, producing **1 PR** covering every issue.
- **Anchor model**: **drop target becomes the lead.** Dragging card A onto card
  B makes **B the lead**; A becomes a member. Workspace/branch/PR are anchored
  on the lead's identifier. Dragging more cards onto the group adds members.
- **Board behavior**: **the group travels together and behaves as a single
  task.** On the board the group is **one draggable unit**; members do not move
  independently while grouped. Moving the lead into a dispatch state runs the
  whole group. Members are **never** dispatched on their own while grouped.
- **All-or-nothing (v1)**: success/failure is for the whole group/PR; member
  statuses move together; no partial per-member completion.
- **No nested groups (v1)**: one level only (lead + members). A member cannot be
  the lead of another group.
- **Lead removal/archival**: auto-promote the oldest / highest-priority member to
  lead; if no members remain, the group dissolves.

## Goals

- Group/ungroup issues on the board by drag-and-drop, in a UI-friendly,
  discoverable way (a clear "merge" affordance distinct from reorder).
- Persist group membership (lead ↔ members) on the local tracker.
- The group renders and moves as a single card/unit on the board.
- The orchestrator dispatches and runs a group as one unit (lead's workspace,
  combined multi-issue prompt, one PR linking every member).
- On completion, the outcome (status transition + PR link) is applied to the
  lead and every member atomically.

## Non-goals

- Nested/multi-level groups, named group entities, group-level metadata UI.
- Cross-project groups (the board is per-project; groups are per-project).
- Partial member completion / per-member PRs within a group.
- Reordering members inside a group (the group is one task).
- Changing remote-tracker (Linear/Jira/GitHub) relation sync semantics. Grouping
  is a **local Symphony concept** in v1 (not pushed to remote trackers).
- Drag-out-to-ungroup gesture (ungroup is an explicit action in v1).

## Architecture overview

```text
Board (tracker/React)                       Backend (elixir)
─────────────────────                       ────────────────
IssueCard / BoardColumn  ──drag merge──▶  POST /issues/:id/group {lead}
  group = single sortable unit            DELETE /issues/:id/group
  (lead + member chips)                        │
        │ move lead                            ▼
        ▼                                 Context: group_lead_id column
POST /issues/:lead/move ───────────▶  move_issue moves members too (atomic)
                                              │
                                              ▼
                                      Orchestrator poll loop
                                       - members filtered out of candidates
                                       - lead eligible ⇒ "group run"
                                       - AgentRunner.run(lead, members: [...])
                                       - workspace = lead's; 1 slot
                                       - completion ⇒ apply to lead + members
                                       - PR carries Symphony-Issue marker per member
```

Persistence approach (chosen): **a self-referential `group_lead_id` column on
`local_tracker_issues`.** Rejected alternatives: a first-class `IssueGroup`
table (too heavy / YAGNI) and reusing `IssueRelation` with a new `type`
(membership/"travel together" queries become relation traversals everywhere and
mix semantics with blockers).

## Data model & persistence

### Migration

New migration adding a nullable self-FK to `local_tracker_issues`:

```elixir
alter table(:local_tracker_issues) do
  add :group_lead_id, references(:local_tracker_issues, on_delete: :nilify_all)
end

create index(:local_tracker_issues, [:group_lead_id])
```

Semantics:

- **Member**: `group_lead_id = <lead issue id>`.
- **Lead**: `group_lead_id = NULL` and has ≥1 issue pointing at it.
- **Standalone**: `group_lead_id = NULL` and no issue pointing at it.
- A lead must itself have `group_lead_id = NULL` (enforced in changeset/context:
  cannot point a lead at another lead → no nested groups).
- `on_delete: :nilify_all` makes orphaned members standalone if the lead row is
  hard-deleted; the application path (archival) promotes a new lead first (see
  Edge cases).

### Ecto schema — `IssueRecord`

(`elixir/lib/symphony_elixir/local_tracker/issue_record.ex`)

Add:

```elixir
belongs_to(:group_lead, __MODULE__, foreign_key: :group_lead_id)
has_many(:group_members, __MODULE__, foreign_key: :group_lead_id)
```

Add `:group_lead_id` to `cast/3`. Add a changeset validation: an issue with
members (i.e. it is a lead) cannot be assigned a non-nil `group_lead_id`.

### Runtime struct & DTO

- `Issue` struct (`elixir/lib/symphony_elixir/issue.ex`): add
  `group_lead_identifier: nil` and `group_member_identifiers: []`. The
  orchestrator needs member identifiers on the lead to build the group run, and
  `group_lead_identifier` to filter members out of candidates.
- `IssueMapper.to_issue/1`: populate both from `group_lead` / `group_members`
  associations (preload them where blockers are preloaded today).
- `IssueDTO` (`elixir/lib/symphony_elixir/tracker/issue_dto.ex`) +
  `TrackerPresenter.issue/1`: expose `group_lead_identifier` and
  `group_member_identifiers` (camelCased in JSON via existing presenter
  conventions).
- `LocalTracker.IssueAdapter.to_dto/1`: include the new fields.

### Frontend type

`tracker/src/types/issue.ts` — add to `Issue`:

```ts
groupLeadIdentifier: string | null;   // set on members; null on lead/standalone
groupMemberIdentifiers: string[];      // set on lead; [] otherwise
```

## Backend API

Routes under the existing prefix
`/api/tracker/v1/projects/:project_slug/issues/:identifier`
(`elixir/lib/symphony_elixir_web/router.ex`, near the blockers routes):

| Method | Path | Action |
|--------|------|--------|
| `POST` | `.../:identifier/group` | Add `:identifier` as a member of `{ "lead_identifier": "CDE-1139" }` |
| `DELETE` | `.../:identifier/group` | Remove `:identifier` from its group |

Handled by a new `Tracker.GroupController` (or extend `IssueController`),
delegating to `LocalTracker.Context` via the issue adapter dispatch pattern used
by blockers/move.

### Context functions (`local_tracker/context.ex`)

- `set_issue_group(project, member_identifier, lead_identifier)`:
  - Both issues exist and are in the same project.
  - `lead` is not itself a member (resolve transitively: if the chosen lead is a
    member, reject — no nested groups).
  - `member` is not currently a lead with its own members (a lead joining
    another group would orphan its members) — reject in v1, or re-parent its
    members to the new lead (v1: **reject** with a clear error to keep scope
    small).
  - Neither issue is currently running in a group/agent execution.
  - On success: set `member.group_lead_id = lead.id`. When the member already
    sits in a different column than the lead, snap it to the lead's status
    (groups travel together) and reposition adjacent to the lead.
- `remove_from_group(project, member_identifier)`: set `group_lead_id = NULL`.
  If the removed issue was the lead, promote a replacement (see Edge cases).
- `list_group_members(project, lead_identifier)` → member records.

### Move endpoint — travel together

`Context.move_issue/3` (`move_issue` path, `persist_moved_issue/4`): when the
moved issue **is a lead**, move **all members** to the same target status and
keep them positioned contiguously right after the lead, in one transaction.
Members are not independently movable from the UI, but this server-side rule
guarantees consistency for realtime/other clients and remote sync.

Reject moves whose target issue is a **member** (the API should only ever move a
lead or a standalone issue; the UI enforces this, the backend validates it).

### Realtime

Reuse the existing project channel `issue_moved` / `issue_updated` broadcasts so
other board clients re-fetch and re-render the group. Group/ungroup emits
`issue_updated` for every affected issue (lead + members).

## Orchestrator changes

File: `elixir/lib/symphony_elixir/orchestrator.ex`.

1. **Filter members out of independent dispatch.** In `candidate_issue?/3` (or
   `should_dispatch_issue?/4`, L552–604), an issue with a non-nil
   `group_lead_identifier` is **not** an independent candidate. Members only run
   as part of their lead's group run.

2. **Group run on lead dispatch.** When a **lead** (an issue with
   `group_member_identifiers != []`) passes `should_dispatch_issue?`, dispatch a
   *group run* instead of a single-issue run:
   - Resolve member issues (already on the lead struct, or fetch fresh in
     `revalidate_issue_for_dispatch/2`).
   - Spawn one task: `AgentRunner.run(lead, recipient, members: member_issues,
     ...)`.
   - Track in `state.running` keyed by **lead `issue.id`** (one entry); add the
     **lead and every member id** to `state.claimed` so members are never
     double-dispatched.
   - The group occupies **one** global slot and **one** per-state slot
     (`state_slots_available?/2`, `available_slots/1`) — counted by the lead.

3. **Blockers.** The group is blocked if the lead **or any member** is blocked
   by a non-terminal issue (extend `issue_blocked_by_non_terminal?/2` to consider
   members when evaluating a lead).

4. **Completion.** In the `{:DOWN, ...}` / `apply_normal_completion/3` /
   `apply_gated_successful_completion/3` path, apply the outcome (status move +
   PR link + cleanup) to the **lead and every member**:
   - Move all member issues to the same completion/wait status as the lead.
   - Link the resulting PR to every member (see PR linking).
   - Remove the lead and members from `claimed`/`running`.
   - Workspace cleanup is per the lead's workspace (one workspace).

5. **Reconciliation** (`reconcile_running_issues/1`): treat the group as one
   running entry keyed by the lead; if membership changed mid-run (shouldn't,
   since grouping is blocked while running), reconcile against the snapshot.

## Agent run (single workspace, combined prompt)

File: `elixir/lib/symphony_elixir/agent_runner.ex`.

- `run/3` accepts `members: [%Issue{}]` in `opts` (default `[]`). The workspace,
  branch, and session remain the **lead's** (`Workspace.create_for_issue(lead)`,
  `path_for_issue(lead)`).
- `PromptBuilder`: when `members != []`, build a **combined task brief** — the
  lead's title/description/goal plus a clearly delimited list of each member's
  title/description/goal — instructing the agent to complete **all** tasks in one
  branch and reference every issue in the PR. Each member identifier must appear
  in the PR body as a `Symphony-Issue: <identifier>` marker line
  (`GitHub.IssueMarker.marker_line/2`).

## PR linking (one PR, many issues)

`GitHub.IssueMarker.extract/2` already returns a **list** of identifiers and the
PR↔issue link path stores PRs per issue (`IssueRecord has_many :pull_requests`).
Changes:

- `RunContract` / `Finalizer` (PR creation/validation): when the run is a group
  run, require/insert one `Symphony-Issue: <identifier>` marker per member +
  lead, and validate the PR body contains all of them
  (`RunContract.gh_pr_checker/1`).
- PR linking on completion associates the single PR record with the lead and
  every member issue.

## Board UI — drag to group, group as one unit

Files: `tracker/src/components/board/` (`BoardView.tsx`, `IssueCard.tsx`,
`BoardColumn.tsx`, `board-utils.ts`, `board-collision.ts`) +
`tracker/src/services/issues.ts` (new group/ungroup calls) +
`tracker/src/hooks/useIssueBoard.ts` (grouping-aware board build).

### Grouping board model

`buildBoardState` (board-utils) produces, per column, a list of **board units**
instead of raw issues:

- A **standalone** issue → its own unit.
- A **lead** → one **group unit** containing the lead + its members (members are
  not rendered as separate top-level units; they are absorbed into the lead's
  group unit). Members are hidden from the column's top-level list.

The column's `SortableContext` items are **unit ids** (a standalone uses
`issue:<id>`; a group uses `group:<leadId>`). Only units are draggable.

### Drag interaction: merge vs reorder

Use a **merge zone** within each card:

- In `onDragOver`, compute the pointer position relative to the card under it
  (`board-collision.ts` already prefers the card under the pointer). If the
  pointer is within the **center band** (e.g. middle ~50% vertically) of a target
  card/unit → **merge intent**; near the top/bottom edges → **reorder intent**.
- Merge intent preview: highlight the target unit with a ring +
  `bg-primary/5` and show a floating label, e.g. "Agrupar com `CDE-1139`"
  (i18n). Reorder intent preview keeps the existing gap/placeholder behavior.
- On drop:
  - **merge** → call `groupIssue(projectSlug, activeIdentifier, { leadIdentifier: targetIdentifier })` (the **target is the lead**). If the target is already a group unit, the dragged card joins as a member.
  - **reorder/move** → existing `onMoveIssue` path.

`resolveBoardMove` returns an extended result that distinguishes
`{ kind: "move", ... }` from `{ kind: "group", leadIdentifier }` so `BoardView`
can branch in `handleDragEnd`.

### Group unit rendering (single task)

A `GroupCard` (or `IssueCard` in `group` mode):

- Shows the **lead** card prominently with a group badge: a count chip ("+2") and
  a stack/layers icon.
- A chevron toggles **expand/collapse** of member rows (compact rows: identifier
  + title + priority), nested under the lead with a subtle container border so it
  reads as one cohesive card.
- The whole unit is the drag handle; member rows are not independently draggable.
- Agent status is shown once for the group (the lead's `AgentExecution`).

### Ungroup / manage

- Each member row (expanded) has a small "remove from group" action (×) →
  `ungroupIssue(projectSlug, memberIdentifier)`.
- The group/lead overflow menu has "Desfazer grupo" (disband) → ungroup all
  members.
- Grouping/ungrouping is disabled while the group's agent is running (the UI
  hides the actions; the backend also rejects).

### i18n

Add keys under `board.*` in `tracker/locales/pt-BR` and `tracker/locales/en`,
e.g. `board.group.mergeHint`, `board.group.count`, `board.group.disband`,
`board.group.removeMember`, `board.group.runningLocked`.

## Edge cases & rules (v1)

- **Same project only** (board is per-project) — inherent; validated in context.
- **No nested groups**: a member cannot be a lead; grouping a current lead as a
  member is rejected.
- **Locked while running**: group membership cannot change while the group's
  agent execution is active (UI + backend).
- **Blocked members**: a non-terminal blocker on any member blocks the whole
  group from dispatch.
- **Lead removal/archival**: promote the oldest member (tie-break: highest
  priority, then earliest `created_at`) to lead by clearing its `group_lead_id`
  and re-pointing siblings to it; if no members remain, the group dissolves.
- **Single-member group**: allowed transiently; a "group" with the lead and one
  member still runs as a (small) group. Removing the last member makes the lead
  standalone.
- **Group size**: no hard cap in v1.
- **Move target validation**: API rejects moving a member directly; only leads
  and standalone issues are movable.

## Testing

Run `make all` in `elixir/` and the tracker test suite before merge.

| Layer | Coverage |
|-------|----------|
| Migration/schema | `group_lead_id` column, self-FK, index; changeset rejects lead→lead |
| `Context` | set/remove group; same-project guard; no-nested-groups guard; running-lock guard; move-lead-moves-members; lead-removal promotion |
| `IssueMapper`/DTO/Presenter | `group_lead_identifier` / `group_member_identifiers` populated |
| Orchestrator | members filtered from candidates; lead dispatches a group run (one slot, members claimed); blocker on member blocks group; completion applies status + PR link to all members |
| `AgentRunner`/`PromptBuilder` | `members:` opt builds combined brief; workspace = lead's |
| PR linking | PR body contains a marker per member; gate validates all markers; PR linked to all members |
| Frontend `board-utils` | group unit build; lead absorbs members; standalone units; move-vs-group resolution |
| Frontend DnD | merge-zone detection (center vs edge); drop→group vs drop→move; group render expand/collapse; ungroup actions; running-lock hides actions |

## Affected files (map)

- DB: new migration; `local_tracker/issue_record.ex`.
- Backend model: `issue.ex`, `local_tracker/issue_mapper.ex`,
  `tracker/issue_dto.ex`, `local_tracker/issue_adapter.ex`,
  `.../tracker_presenter.ex`.
- API: `..._web/router.ex`, new `..._web/controllers/tracker/group_controller.ex`
  (or extend `issue_controller.ex`), `local_tracker/context.ex`.
- Orchestrator/agent: `orchestrator.ex`, `agent_runner.ex`, `prompt_builder.ex`,
  `run_contract*.ex` / finalizer, PR-link path.
- Frontend: `tracker/src/types/issue.ts`, `tracker/src/services/issues.ts`,
  `tracker/src/hooks/useIssueBoard.ts`,
  `tracker/src/components/board/{BoardView,IssueCard,BoardColumn,board-utils,board-collision}.tsx/ts`,
  new `GroupCard.tsx`, `tracker/locales/{pt-BR,en}`.

## Open questions (resolved)

| Question | Resolution |
|----------|------------|
| Execution semantics | Single run: one agent/workspace/branch, 1 PR for the group |
| Anchor | Drop target becomes lead; others are members |
| Board behavior | Group travels together; renders/moves as one unit; one task |
| Member independent dispatch | Never while grouped |
| Partial completion | No (all-or-nothing in v1) |
| Nested groups | No (v1) |
| Lead removal | Auto-promote oldest/highest-priority member; dissolve if none |
| Remote sync of groups | Local-only concept in v1 |

## References

- `elixir/lib/symphony_elixir/orchestrator.ex` (L505–634 dispatch/candidate)
- `elixir/lib/symphony_elixir/agent_runner.ex` (`run/3` L46–61)
- `elixir/lib/symphony_elixir/workspace.ex` (`path_for_issue/1` L68–72)
- `elixir/lib/symphony_elixir/local_tracker/issue_record.ex`
- `elixir/lib/symphony_elixir/local_tracker/issue_relation.ex` (blocker relation prior art)
- `elixir/lib/symphony_elixir/github/issue_marker.ex` (multi-identifier markers)
- `tracker/src/components/board/{BoardView,board-utils,board-collision,IssueCard}.{tsx,ts}`
- `tracker/src/types/issue.ts`, `tracker/src/hooks/useIssueBoard.ts`
