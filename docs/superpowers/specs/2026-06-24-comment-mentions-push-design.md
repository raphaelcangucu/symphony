# Design: @mentions in issue comments + targeted Web Push

Date: 2026-06-24
Status: Approved — implemented
Scope: Tracker Comments tab (board issue drawer) + Elixir push layer

## Problem

Operators discuss issues in the Comments tab but have no way to notify a specific
teammate that they were mentioned. Existing Web Push covers orchestrator events
(Human Review, evidence, PR monitor) and fans out to every subscription on the
instance — not suitable for per-user @mentions.

## Goals (v1)

1. **@mention autocomplete** in the comment composer (create; edit is follow-up).
2. Mention format: `@login` in comment body (GitHub-compatible markdown).
3. **Targeted Web Push** to mentioned users who opted in (Settings → Browser
   notifications).
4. Push fires **only after remote sync succeeds** (`sync_status: pending → synced`).
5. Deep link opens the issue drawer (Comments context).

## Non-goals (v1)

- Rich-text editor / TipTap mentions.
- Mentions in workpad or evidence comments (`kind != "comment"`).
- Push on comment edit / new mentions added via update.
- Push when remote sync fails (`sync_status: error`).
- Per-event toggle for mention notifications.
- Linear/Jira-native mention syntax conversion (body stays `@login` text).
- Highlighting mentions in rendered markdown (nice-to-have follow-up).

## Push timing (decision)

**Option B — after remote sync only.**

| Event | Push? |
|-------|-------|
| Comment created locally (`pending`) | No |
| Outbox `comment:create` push succeeds → `synced` | Yes |
| Comment created on local-only project (already `synced`, no outbox) | Yes (immediate — no remote step) |
| Remote comment pulled into store (inserted `synced`) | No |
| Sync fails / exhausted retries (`error`) | No |

Trigger: `sync_status` transition **`pending → synced`** on a user-authored
`kind: "comment"`, plus local-only path where comment is born `synced`.

## Architecture

```
  CommentsTab (@ autocomplete)
        │ POST body with @login
        ▼
  LocalFirstAdapter.add_comment
        │ local insert + mark pending + outbox enqueue
        ▼
  Sync.Engine.push comment:create
        │ remote adapter (GitHub/Jira/…)
        ▼
  mark_comment_sync_status(synced)     Context.add_comment (local-only)
        │ pending → synced                    │ born synced
        ▼                                     ▼
  PushNotifications.MentionNotifier.deliver_if_needed/2
        │ parse @logins, resolve tracker_users, skip self
        ▼
  PushNotifications.Dispatcher.comment_mentioned/4
        │ filter subscriptions by identity_keys
        ▼
  PushNotifications.Sender.deliver_to_identities/3
        ▼
  Browser Service Worker (existing sw.js)
```

Realtime UI (tab open) still uses existing `Broadcaster.comment_created` on
local insert — independent of push timing.

## Mention format & parsing

- Pattern: `(?<!\w)@([a-zA-Z0-9_-]+)` — avoids `email@domain.com`.
- Resolve logins case-insensitively against `tracker_users.login` for the project.
- Identity keys for push matching per user: `login`, `remote_id`, `name` (trimmed,
  downcased, non-empty).
- Skip notifying the comment author (match author against same key set).
- Only `kind: "comment"` — not workpad/evidence/system comments.

## Push subscription identity (new)

Current `push_subscriptions` rows have no operator identity; all instance pushes
fan out globally. Mentions require per-subscriber targeting.

**Migration** — add to `push_subscriptions`:

| Column | Type | Notes |
|--------|------|-------|
| `identity_keys` | `{:array, :string}` default `[]` | Normalized match values + logins |

On `POST /push/subscriptions`, collect keys from:

- `Identity.statuses()` — each connected provider's `match_value`, `login`, `name`
- GitHub viewer login (when available)

Subscriptions with empty `identity_keys` still receive **global** pushes
(Human Review, evidence, …) but **not** mention pushes.

## Backend modules

| Module | Role |
|--------|------|
| `PushNotifications.MentionParser` | Regex parse, resolve users, identity keys |
| `PushNotifications.MentionNotifier` | Gate on sync transition + call Dispatcher |
| `PushNotifications.Dispatcher.comment_mentioned/4` | Build localized payload |
| `PushNotifications.Sender.deliver_to_identities/3` | Fan-out to matching subscriptions only |
| `PushNotifications.Subscriptions.list_for_identities/1` | Query helper |

**Payload** (`kind: "comment_mention"`):

```json
{
  "kind": "comment_mention",
  "title": "Raphael mentioned you",
  "body": "GAM-5: first line of comment…",
  "url": "/tracker/projects/gamba/board/issues/GAM-5",
  "tag": "comment_mention:gamba:GAM-5:42"
}
```

Body snippet: first non-empty line of comment, max 120 chars.

## Frontend

| Piece | Role |
|-------|------|
| `useCommentMentions` | Detect `@`, cursor position, filter users |
| `MentionAutocomplete` | Dropdown with `AssigneeAvatar` + login |
| `CommentsTab` | Wire autocomplete into create composer |
| `getIssueFormOptions` | Source list of project assignees (existing) |

UX: `@` opens list; ↑/↓ navigate; Enter/Tab select; Esc close; inserts `@login`.

## Hook points

1. **`LocalStore.mark_comment_sync_status/2`** — after DB update, when
   `previous_status == "pending"` and new status is `"synced"`, call
   `MentionNotifier.deliver_if_needed(comment, :after_remote_sync)`.

2. **`Context.add_comment/4`** — when inserted comment has `sync_status == "synced"`
   (local-only projects), call `MentionNotifier.deliver_if_needed(comment, :local_only)`.

Do **not** hook `Context.add_comment` for remote-backed projects (comment is
`pending` until engine completes).

## Error handling

- Best-effort delivery (same as existing push). Missing VAPID → no-op.
- No subscription match → silent skip.
- Sync failure → no push (operator sees `error` badge on comment).
- Self-mention → skip.
- Unknown `@login` (not in `tracker_users`) → skip that login.

## Testing

| Area | Cases |
|------|-------|
| `MentionParser` | parse, email exclusion, user resolution, identity keys |
| `MentionNotifier` | pending→synced fires; born-synced fires; workpad skipped; self skipped |
| `Dispatcher.comment_mentioned` | payload shape, gettext |
| `Sender.deliver_to_identities` | only matching subscriptions |
| `PushController` | identity_keys stored on subscribe |
| `Engine` comment sync | integration: push after successful comment:create |
| `CommentsTab` | autocomplete interaction (Vitest) |

## Follow-ups

- Mentions on comment edit.
- Markdown highlight for `@login` in `CommentCard`.
- Linear/Jira mention syntax in sync drivers.
- Deep link hash `#comment-{id}` scroll-to-comment.
- Re-notify when sync retries succeed after failure.
