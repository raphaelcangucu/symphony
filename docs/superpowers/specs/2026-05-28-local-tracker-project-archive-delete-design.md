# Local Tracker Project Archive And Delete Design

**Status:** Approved  
**Date:** 2026-05-28  
**Scope:** Add archive, restore, and permanent delete actions for local tracker projects on `/tracker/projects`.

---

## 1. Problem

The local tracker project list can create workspace projects, but it cannot hide old projects or remove accidental test projects. This makes `/tracker/projects` noisy after browser tests and experiments.

Project removal is sensitive because local tracker projects own issues, workflow statuses, repositories, setup metadata, comments, labels, relations, and activity events. The UI needs a reversible default action and a clearly destructive permanent action.

---

## 2. Goal

Add two project lifecycle actions:

1. **Archive:** Hide a project from the default project list while preserving all local tracker data.
2. **Delete permanently:** Remove an archived project and its local tracker data after explicit confirmation.

Archived projects must be recoverable through a restore action.

---

## 3. Non-goals

- Do not delete local repository folders from disk.
- Do not delete or archive anything in GitHub.
- Do not change issue workflow behavior inside active projects.
- Do not add bulk archive/delete actions in this first version.

---

## 4. Design

### Backend

Add `archived_at` to `local_tracker_projects`.

Project listing should return active projects by default. A query option such as `include_archived=true` should return active and archived projects so the UI can show archived cards on demand.

Add context functions:

1. `archive_project/1`: sets `archived_at` when the project exists and is not already archived.
2. `restore_project/1`: clears `archived_at`.
3. `delete_project/1`: permanently deletes a project. This is intended for archived projects; the API should reject permanent deletion of active projects with a clear validation error.

Add API routes under `/api/tracker/v1`:

1. `POST /projects/:id/archive`
2. `POST /projects/:id/restore`
3. `DELETE /projects/:id`

The existing foreign keys already use `on_delete: :delete_all` for most project-owned tables. Before implementation, confirm all dependent tables are covered. If a dependent table can block project deletion, delete the dependent rows inside a transaction before deleting the project.

### Frontend

On `/tracker/projects`, add lifecycle actions to each card.

Active project cards:

1. Show an `Archive` action.
2. Do not show permanent delete.

Archived project cards:

1. Show an `Archived` badge.
2. Show `Restore`.
3. Show `Delete permanently`.

Add a lightweight `Show archived` toggle near the page title. Default is off. When off, archived projects are hidden. When on, the page fetches or displays archived projects alongside active projects.

Permanent delete must require explicit confirmation that names the project. A browser `confirm` is the confirmation mechanism for this first version.

---

## 5. Error Handling

- Archive/restore/delete failures should leave local UI state unchanged and show a toast error.
- Deleting an active project should fail with a clear backend validation message.
- Fetching projects with archived records should tolerate older rows where `archived_at` is `null`.
- If a project disappears between list render and action, return `project_not_found`.

---

## 6. Testing

Backend tests:

1. Project archive sets `archived_at` and hides the project from default `list_projects`.
2. Restore clears `archived_at` and returns the project to default list.
3. `list_projects(include_archived: true)` returns archived and active projects.
4. Delete permanently removes an archived project and dependent local tracker rows.
5. Delete permanently rejects active projects.
6. API endpoints return expected statuses and JSON payloads.

Frontend tests:

1. Project list hides archived projects by default.
2. `Show archived` reveals archived projects with an `Archived` badge.
3. Archiving a project calls the API and removes it from the default list.
4. Restoring an archived project calls the API and updates the card state.
5. Permanent delete asks for confirmation and removes the archived card only after API success.

---

## 7. Self-review

- No placeholders remain.
- Archive is reversible and is the default path.
- Delete is intentionally restricted to archived projects to reduce accidental data loss.
- Local filesystem and GitHub data are explicitly out of scope.
- API and UI behavior are both covered by focused tests.
