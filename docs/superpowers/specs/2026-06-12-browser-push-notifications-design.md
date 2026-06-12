# Design: Browser Web Push notifications (Service Worker + VAPID)

Date: 2026-06-12
Status: Implemented (MVP)
Scope: Symphony tracker SPA + Elixir hub API

## Problem

Operators must keep the tracker open to notice when an issue lands in a wait
state (e.g. **Human Review**) or when an agent finishes validation and records
evidence. In-app Phoenix channels only help while a tab is connected.

## Goals (v1)

1. **Web Push** via Service Worker + VAPID (approach A — no in-tab-only phase).
2. Notify on:
   - Issue moved to a project **wait state** (typically Human Review).
   - **Evidence** persisted after an agent run (`.symphony/evidence` gate).
   - **Agent retry** scheduled after a real failure (not slot-contention backoff).
   - **Agent run incomplete** (max turns / gate handoff without finished work).
   - **Agent run blocked** (publish gate violations).
   - **PR monitor** human-attention outcomes: auto-fix limit, needs human, CI unrelated.
3. Opt-in from **Settings → Browser notifications**.
4. Deep link opens the issue (evidence or pull-request tab when relevant).

## Non-goals (v1)

- Per-event toggles in the UI (Human Review vs evidence vs PR monitor).
- Per-project filters.
- Push when tab is focused (always send; browser may suppress duplicates via `tag`).
- Agent retry / PR monitor events (future).

## Architecture

```
  Orchestrator / LocalTracker.Context
            │ human_review_needed / evidence_generated
            ▼
  PushNotifications.Dispatcher
            │ JSON payload {kind, title, body, url, tag}
            ▼
  PushNotifications.Sender ──► WebPushElixir ──► browser push service
            ▲
  push_subscriptions (SQLite)

  Tracker Settings UI ──POST──► /api/tracker/v1/push/subscriptions
  Service Worker (public/sw.js) ──showNotification on push event
```

## Backend

| Piece | Role |
|-------|------|
| `push_subscriptions` table | Stores endpoint + p256dh + auth per browser |
| `PushController` | `GET /push/config`, `POST/DELETE /push/subscriptions` |
| `Dispatcher` | Maps Symphony events → notification payloads |
| `Sender` | Fan-out to all subscriptions; drops expired (410) |

**Config:** `SYMPHONY_VAPID_PUBLIC_KEY`, `SYMPHONY_VAPID_PRIVATE_KEY`,
optional `SYMPHONY_VAPID_SUBJECT` (default `mailto:symphony@localhost`).

Generate keys via `ExNudge.generate_vapid_keys/0`. Delivery uses `ex_nudge`
(RFC 8291 `aes128gcm` content encoding, required by modern Chrome/Edge).

## Frontend

| Piece | Role |
|-------|------|
| `tracker/public/sw.js` | `push` + `notificationclick` handlers |
| `PushNotificationsCard` | Enable/disable in global Settings |
| `pushNotifications.ts` | Register SW, subscribe, sync with API |

Service worker scope: `/tracker/` (matches Vite `base`).

## Testing

- Controller tests for config/subscribe/unsubscribe.
- Dispatcher unit tests for wait-state gating.

## Follow-ups

- Per-event notification preferences in Settings UI.
- Quiet hours / suppress when tracker tab is focused.
- PR merged → Done (informational, lower priority).
