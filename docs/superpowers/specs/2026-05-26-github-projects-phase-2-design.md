# GitHub Projects v2 — Phase 2 + 3 (Linear Parity)

**Status:** Approved  
**Date:** 2026-05-26  
**Scope:** Close remaining gaps between the GitHub Projects v2 adapter and Linear: assignee routing, WORKFLOW/state reconciliation, `branch_name`, blockers, and `github_graphql`. Dogfood: `clouapp/front`, board **Macro Markets**.

**Depends on:** [2026-05-24-github-projects-design.md](./2026-05-24-github-projects-design.md)

---

## 1. Problem

Phase 1 delivered GraphQL polling, Projects v2 state, bootstrap, and label admission. Gaps vs Linear:

| Capability | Linear | GitHub (Phase 1) |
|---|---|---|
| Assignee routing | `linear.assignee` + `"me"` | Always `assigned_to_worker: true` |
| WORKFLOW vs field options | N/A | Static cache; no reconcile |
| Branch name | API field | Always `nil` |
| Blockers | `inverseRelations` | Always `[]` |
| Agent tooling | `linear_graphql` | None |

---

## 2. Goal

Parity for assignee routing, branch metadata, blockers, and in-session GraphQL tooling. Dogfood board **Macro Markets** on `clouapp/front` via `mode: existing`.

---

## 3. Decisions

| Topic | Choice |
|---|---|
| Assignee key | GitHub **login** |
| `"me"` | `viewer { login }` at bootstrap; cache `viewer_login` |
| `assigned_to_worker` | Match login to filter; `true` when filter unset |
| Add missing states | `updateProjectV2Field` + full `singleSelectOptions` |
| Remove state in use | Hard-fail with project URL + count |
| Remove unused state | Skip (options stay on field) |
| Renames | Not detected (document) |
| Branch | `linkedBranches(first:1)` |
| Blockers | `trackedInIssues` + body regex; tracked wins dedup |
| Tool | `github_graphql` mirrors `linear_graphql` |

---

## 4. Configuration

```yaml
github:
  repo: clouapp/front
  assignee: me
  project:
    mode: existing
    id: "PVT_kwDO..."
  status_field: Symphony State
  admission_label: symphony
```

Cache adds `viewer_login`.

---

## 5. Modules

- **`GitHub.Viewer`** — resolve/cache viewer login.
- **`GitHub.StateReconciliation`** — compare WORKFLOW states to field options; add via API; halt if removal would orphan items.
- **`GitHub.Blockers`** — `from_tracked/1`, `from_body/2`, `merge/2`.
- **`GitHub.Config.assignee/0`**
- **`GitHub.Client`** — extended queries; assignee + branch + blockers in normalize.
- **`Codex.DynamicTool`** — register `github_graphql`.

---

## 6. Blocker body syntax

- `Blocked by #42`
- `Depends on #42`
- `Blocked by clouapp/front#42`

Regex requires `#` + digits to avoid false positives.

---

## 7. Error handling

| Error | Behavior |
|---|---|
| Missing `viewer_login` with `assignee: me` | Halt bootstrap with fix instructions |
| State in use but removed from WORKFLOW | Halt with project URL + affected item count |
| `updateProjectV2Field` failure | Halt; log GraphQL message |
| `linkedBranches` / `trackedInIssues` absent | Treat as empty (resilient decode) |

---

## 8. Testing

- Unit: `Viewer`, `Blockers`, `StateReconciliation` (mock GraphQL).
- Client: assignee filter, branch_name, blocked_by in poll/by-id paths.
- `DynamicTool`: `github_graphql` success/error paths.
- Bootstrap: reconcile add, halt on in-use removal.

---

## 9. Success criteria

1. `github.assignee: me` only routes issues assigned to the cached viewer login.
2. Adding a state to WORKFLOW auto-adds the field option on next startup.
3. Removing an in-use state halts with an actionable message.
4. Issues with linked branches populate `branch_name`.
5. Blockers appear from tracked issues and/or body lines.
6. Codex sessions expose `github_graphql` alongside `linear_graphql`.
7. `make all` green on `feat/github-projects-phase-2`.
