# GitHub Projects v2 — Tracker Workflow Design

**Status:** Approved  
**Date:** 2026-05-24  
**Scope:** Replace label-based GitHub issue status with repo-scoped GitHub Projects v2, including automatic project bootstrap on first configuration.

---

## 1. Problem

The current GitHub tracker adapter maps workflow states to issue labels (`symphony:todo`, `symphony:in-progress`, etc.). Compared to the Linear integration, this creates several gaps:

| Capability | Linear | GitHub (current) |
|---|---|---|
| Work scope | `project_slug` filters issues | Entire repo |
| State model | Native `state` field | Label hack |
| Candidate polling | Uses `tracker.active_states` | Hardcoded `todo` + `in-progress` only |
| State transitions | Single GraphQL mutation | GET + N label DELETEs + POST + optional close |
| Assignee routing | `linear.assignee` + `"me"` | Always `assigned_to_worker: true` |
| Blockers | `inverseRelations` type `blocks` | Always empty |
| Branch name | From API | Always `nil` |
| Agent tooling | `linear_graphql` | None |

Status control is the primary pain point. Labels are visible repo-wide, updates are non-atomic, and the poll ignores states like `Merging` and `Rework` even when configured in `WORKFLOW.md`.

---

## 2. Goal

Achieve semantic parity with Linear for **project scope** and **workflow state**, using GitHub Projects v2 at **repository level**, with a **GraphQL-only** client and zero manual board setup when `github.project.mode: auto`.

The legacy REST + label-based adapter is removed entirely at the end of Phase 1 — no dual path, no feature flag.

Out of scope for this design (follow-up work):

- Org-level shared boards
- Full `github_graphql` agent tool (phase 3)
- Blockers via issue links (phase 3)
- Migration tooling for existing label-based setups (greenfield assumed; legacy deleted, not migrated)

---

## 3.1 Legacy removal (Phase 1, final step)

Delete outright — no deprecation period:

| Remove | Path / symbol |
|---|---|
| REST issue client | `SymphonyElixir.GitHub.Client` (current REST implementation) |
| Label state logic | `swap_labels`, `extract_state`, `normalize_state`, `fetch_issues_for_each_label` |
| Config | `github.label_prefix`, `@default_label_prefix` |
| Tests | `github_client_test.exs` REST mocks; rewrite for GraphQL |
| Docs | References to `symphony:todo` / `symphony:in-progress` label workflow |

Replace with single `SymphonyElixir.GitHub.Client` GraphQL module (same module name, new implementation).

---

## 3. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| API surface | **GraphQL only** | Single client, single endpoint; mirrors `Linear.Client`; no REST split |
| Project scope | **Repo-level** | Aligns with `github.repo`; simpler permissions; one board per Symphony instance |
| State field | **Custom `Symphony State`** single-select | Built-in `Status` field cannot receive new options via API |
| State source of truth | **`WORKFLOW.md`** `active_states` + `terminal_states` | Same contract as Linear |
| Bootstrap trigger | **Startup validation** when `project.mode: auto` and no cached project metadata | Zero manual setup |
| Issue admission | **Label gate** (`symphony`) | Issues auto-added to board; mirrors Linear project membership |
| Labels | **Metadata only** (`priority:N`, tags) | No `symphony:*` state labels |
| Legacy REST adapter | **Delete at end of Phase 1** | No feature flag, no dual path |

---

## 4. Configuration

### 4.1 WORKFLOW.md front matter

```yaml
github:
  repo: your-org/your-repo
  project:
    mode: auto          # auto | existing
    title: "Symphony"   # used only when mode: auto
    # Populated by bootstrap (or set manually for mode: existing):
    # id: "PVT_kwDO..."
    # number: 3
  status_field: "Symphony State"

tracker:
  active_states:
    - Todo
    - In Progress
    - Merging
    - Rework
  terminal_states:
    - Done
    - Cancelled
```

- `mode: auto` — Symphony creates the project and field on first startup if metadata is missing.
- `mode: existing` — Symphony connects to a pre-created repo-level project; `project.id` or `project.number` is required.
- `status_field` defaults to `"Symphony State"` if omitted.

### 4.2 Runtime cache (`.symphony/github-project.json`)

Written by bootstrap; gitignored. Avoids editing `WORKFLOW.md` on every bootstrap.

```json
{
  "project_id": "PVT_kwDO...",
  "project_number": 3,
  "status_field_id": "PVTSSF_...",
  "state_options": {
    "Todo": "abc123",
    "In Progress": "def456",
    "Done": "ghi789"
  },
  "bootstrapped_at": "2026-05-24T12:00:00Z"
}
```

Resolution order: cache file → `github.project.id` / `number` in WORKFLOW → bootstrap if `mode: auto`.

---

## 5. Bootstrap flow (`mode: auto`)

Runs during `GitHub.Config.validate!` (or dedicated `SymphonyElixir.GitHub.Bootstrap.run/0` called from validate).

```
1. Parse github.repo → owner, repo name
2. Resolve owner node ID via GraphQL (repository.owner or user/organization lookup)
3. createProjectV2(input: { ownerId, title: "Symphony — {owner}/{repo}" })
4. linkProjectV2ToRepository (if API available) — associate project with target repo
5. createProjectV2Field:
     name: "Symphony State"
     dataType: SINGLE_SELECT
     singleSelectOptions: active_states ∪ terminal_states (from WORKFLOW)
6. Query field IDs + option IDs; write .symphony/github-project.json
7. Log success with project URL
```

### 5.1 API constraints

- **`createProjectV2Field`** supports initial single-select options at creation time.
- **Built-in `Status` field** (Todo / In Progress / Done) cannot be extended via API — do not use it.
- **`updateProjectV2Field`** does not exist — options are immutable after creation. If WORKFLOW states change later, bootstrap must detect mismatch and fail with a clear error (manual field recreation or re-bootstrap).

### 5.2 Token permissions

Fine-grained PAT on target repo:

- Issues: Read and write
- Pull requests: Read and write
- **Projects**: Read and write (required for GraphQL project mutations)
- Contents: Read (for `linkProjectV2ToRepository`)

---

## 6. Tracker adapter architecture

Single GraphQL client — same shape as `SymphonyElixir.Linear.Client`:

```
SymphonyElixir.Tracker (behaviour — unchanged)
  └── SymphonyElixir.GitHub.Tracker
        └── SymphonyElixir.GitHub.Client
              ├── graphql/3              — transport (endpoint, auth, errors)
              ├── fetch_candidate_issues/0
              ├── fetch_issues_by_states/1
              ├── fetch_issue_states_by_ids/1
              ├── update_issue_state/2
              ├── create_comment/2
              └── Bootstrap.run/0
```

Endpoint: `https://api.github.com/graphql`  
Auth: `GITHUB_TOKEN` via `Authorization: Bearer` header.

The existing `SymphonyElixir.GitHub.Client` REST module and `label_prefix` config are **removed** when Phase 1 ships — not kept behind a flag.

### 6.1 Required operations

| Operation | GraphQL mutation / query | Notes |
|---|---|---|
| `fetch_candidate_issues/0` | `projectV2.items` | Items where `Symphony State` ∈ `active_states` |
| `fetch_issues_by_states/1` | `projectV2.items` | Same filter, arbitrary state list |
| `fetch_issue_states_by_ids/1` | `Issue` / project item lookup | By issue node ID or number |
| `update_issue_state/2` | `updateProjectV2ItemFieldValue` + `updateIssue` | Status field update; close issue when terminal |
| `create_comment/2` | `addComment` | `subjectId` = issue node ID |

### 6.2 Normalized `Issue` mapping

| Field | Source |
|---|---|
| `id` | Issue node ID (`I_kwDO...`) |
| `identifier` | Issue number as string |
| `state` | `Symphony State` option name (exact match to WORKFLOW names) |
| `title`, `description`, `url` | Issue content |
| `assignee_id` | Issue assignee login |
| `labels` | Issue labels (lowercase; no state labels) |
| `priority` | Label `priority:N` if present |
| `branch_name` | `nil` (future: derive convention `symphony/{number}`) |
| `blocked_by` | `[]` (phase 3) |
| `assigned_to_worker` | `true` (phase 2: assignee filter) |

### 6.3 Poll query (conceptual)

```graphql
query SymphonyGitHubPoll($projectId: ID!, $after: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: 50, after: $after) {
        nodes {
          id
          content {
            ... on Issue {
              id
              number
              title
              body
              url
              assignees(first: 1) { nodes { login } }
              labels(first: 20) { nodes { name } }
            }
          }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2FieldCommon { name } }
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}
```

Client-side filter: keep items where `Symphony State` name ∈ `Config.active_states()` and issue belongs to configured repo.

---

## 7. Issue admission (label gate)

When an issue in the configured repo has label `symphony` (configurable via `github.admission_label`, default `symphony`) and is not yet a project item:

1. `addProjectV2ItemById(projectId, contentId: issue.node_id)`
2. Set `Symphony State` → first `active_states` entry (typically `Todo`)

Admission runs during poll (lazy) or via optional GitHub Action webhook (future). Lazy admission during poll is sufficient for MVP.

Issues without the admission label are ignored by Symphony even if they exist in the repo.

---

## 8. State transitions

`update_issue_state(issue_id, state_name)`:

1. Resolve project item ID for issue (cache per poll cycle).
2. Look up `option_id` from `.symphony/github-project.json` `state_options` map.
3. `updateProjectV2ItemFieldValue(projectId, itemId, fieldId, singleSelectOptionId)`.
4. If `state_name` ∈ `terminal_states`: `updateIssue(input: { id, state: CLOSED })`.
5. If leaving a terminal state for an active state: `updateIssue(input: { id, state: OPEN })`.

Errors:

- `:state_not_found` — option name not in bootstrap map (WORKFLOW/config mismatch).
- `:item_not_in_project` — issue not on board; attempt admission then retry once.
- `:github_graphql_errors` — pass through GraphQL errors.

---

## 9. Phased delivery

### Phase 1 — MVP (this spec)

- [ ] Rewrite `GitHub.Client` as GraphQL-only (mirror `Linear.Client` structure)
- [ ] Bootstrap (`mode: auto`, repo-level)
- [ ] Poll + state update via `Symphony State`
- [ ] Lazy issue admission via label gate
- [ ] `create_comment/2` via `addComment` mutation
- [ ] Close/reopen issue via `updateIssue` on terminal/active transitions
- [ ] **Delete legacy code:** remove REST client, label-based state logic, `label_prefix` config, and related tests
- [ ] Update `elixir/docs/troubleshooting.md` and `elixir/README.md`
- [ ] Tests with mock GraphQL responses only

### Phase 2 — Parity

- [ ] Assignee filter (`github.assignee`, mirror Linear)
- [ ] Dashboard project URL → link to repo project board
- [ ] Detect WORKFLOW state changes vs cached options; clear error message

### Phase 3 — Agent tooling

- [ ] `github_graphql` dynamic tool (mirror `linear_graphql`)
- [ ] Blockers via issue links (`blocked by` / `depends on`)
- [ ] Optional branch name convention

---

## 10. Error handling

| Error | Orchestrator behavior |
|---|---|
| Bootstrap failure | Halt startup; print fix instructions |
| Poll GraphQL failure | Log; skip dispatch for this tick |
| State refresh failure | Log; keep active workers running |
| `:state_not_found` on agent write | Agent receives error; logged |
| Missing cache + `mode: existing` | Halt startup |

---

## 11. Testing strategy

- Unit tests: GraphQL response decoding, state option mapping, normalization.
- Bootstrap tests: mock `createProjectV2` + `createProjectV2Field` sequence; verify cache file shape.
- Integration tests: `fetch_candidate_issues` respects full `active_states` list.
- Removal tests: confirm no references to `label_prefix`, REST endpoints, or `symphony:*` state labels remain.

---

## 12. Open questions (resolved)

| Question | Resolution |
|---|---|
| Org vs repo project? | **Repo-level** |
| GraphQL only or REST + GraphQL? | **GraphQL only** |
| Keep legacy REST / label adapter? | **No** — delete at end of Phase 1 |
| Use built-in Status field? | **No** — custom `Symphony State` field |
| Existing label setups? | **Greenfield** — no migration |
| Where to persist project IDs? | **`.symphony/github-project.json`** (gitignored) |

---

## 13. Success criteria

1. Fresh repo + `mode: auto` → Symphony starts with a populated board and correct state columns derived from WORKFLOW.
2. Issue with label `symphony` in `Todo` → picked up by orchestrator.
3. Agent transition to `Human Review` → single GraphQL call; visible on board.
4. States `Merging` and `Rework` appear in poll (unlike current label adapter).
5. No `symphony:*` state labels; no REST calls to `api.github.com/repos/.../issues`.
6. `GitHub.Config` has no `label_prefix`; troubleshooting docs describe GraphQL + Projects setup only.
