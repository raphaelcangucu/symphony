# GitHub.Api — REST Fallback for GraphQL (Resilience) — Design

- **Date:** 2026-06-01
- **Status:** Draft (design approved in brainstorming; pending user review of written spec)
- **Area:** `elixir/` — `SymphonyElixir.GitHub.*` (tracker remote transport)

## Problem & Motivation

Symphony's GitHub integration runs **every** read and write against the GitHub
**GraphQL** API (`GitHub.Client`, `IssueComments`, `PullRequests`). GraphQL has a
dedicated 5000-points/hour rate-limit bucket, separate from the REST `core`
bucket (also 5000/hour).

When the GraphQL bucket is exhausted, *everything* GitHub-related fails at once —
including operations that have perfectly good REST equivalents (comments,
open/close, issue/label discovery, PR linkage). This was observed on issue 510:
GraphQL hit `0/5000` (`graphql_rate_limit`) while REST `core` still had
`~4300/5000`, yet the agent run crashed on `issue_state_refresh` and could not
post comments or surface PRs.

**Goal:** Increase resilience to GraphQL rate limiting by introducing a single
GitHub transport service, `SymphonyElixir.GitHub.Api`, that exposes high-level
operations. When a GraphQL call returns `{:rate_limited, _}`, operations that
have a REST equivalent transparently **fall back to REST** and normalize the
result to the shape callers already expect. Operations that are intrinsically
GraphQL-only (GitHub **Projects v2** board status) cannot fall back; they return
a typed `:rate_limited` error so callers defer cleanly until reset.

This is a **resilience** layer, not a replacement of the board path. The project
is already local-first (UI/orchestrator read SQLite via `Tracker.Sync`); this
work hardens the single remote-facing transport.

## Hard Constraint: GitHub Projects v2 is GraphQL-only

The operations that exhausted the bucket on issue 510 read/write the **Projects
v2 Status single-select field** (`Todo`/`In Progress`/`Human Review`/…). GitHub
Projects v2 has **no REST API** (the deprecated "classic Projects" REST is not
what Symphony uses). Therefore REST **cannot** be a drop-in fallback for the
board status path. The resilience gain for the board is **indirect**: moving the
reducible operations (comments, open/close, label discovery, PR linkage) off the
GraphQL bucket reduces total GraphQL burn, so the board calls survive longer
before the bucket reaches zero.

## Approved Decisions (from brainstorming)

1. **Single service module** `SymphonyElixir.GitHub.Api` (Approach A) is the one
   place that owns GraphQL→REST fallback and response normalization. Callers stop
   embedding fallback logic.
2. **Pure fallback (F1):** GraphQL is always attempted first; REST is used **only**
   when the GraphQL attempt returns `{:rate_limited, _}`. Normal-path behavior is
   unchanged; divergence happens only under rate-limit pressure.
3. **Projects v2-only operations do not fall back.** They return
   `{:error, {:rate_limited, %{reset_at: ..., capability: :projects_v2}}}` so the
   sync engine / agent runner defer until `reset_at`.
4. **Normalization is mandatory:** the REST and GraphQL branches of each
   operation return byte-for-byte the same internal shape; callers cannot tell
   which transport served the result.
5. **PR fallback scope is linkage + basic state** (`number/url/title/state`); the
   rich check/review rollup used by the UI stays GraphQL-only and defers.

## Architecture Overview

```
Callers (IssueComments, IssueAdapter, Client admission, SyncDriver)
        │  high-level ops (add_comment, list_comments, transition_issue_open_state,
        │                  list_label_issues, list_issue_prs)
        ▼
SymphonyElixir.GitHub.Api          ← owns fallback + normalization
   try GraphQL (GitHub.Client.graphql/3)
   └─ {:rate_limited, _} and op has REST? → GitHub.Client.rest_* → normalize
   └─ {:rate_limited, _} and Projects-v2-only? → {:error, {:rate_limited, capability: :projects_v2}}
        │ all HTTP via existing GitHub.Client + RequestGateway + RateLimit
        ▼
GitHub GraphQL  /  GitHub REST
```

`GitHub.Api` does **not** open sockets itself. It composes the existing
`GitHub.Client.graphql/3`, `GitHub.Client.rest_get/2`, and `GitHub.Client.rest_put/3`
(plus a new `rest_post/3`), reusing `RequestGateway` (serialized backoff) and
`RateLimit` (unified REST+GraphQL detection and `reset_at` parsing).

## The `GitHub.Api` Interface

All functions accept `opts` (forwarding `:request_fun`, `:operation_name`,
`:client_module`) for deterministic, network-free tests.

| Function | Returns | GraphQL primary | REST fallback |
|---|---|---|---|
| `add_comment(repo, identifier, body, opts)` | `{:ok, comment}` | `addComment` | `POST /repos/{o}/{r}/issues/{n}/comments` |
| `list_comments(repo, identifier, opts)` | `{:ok, [comment]}` | issue `comments(last:)` | `GET /repos/{o}/{r}/issues/{n}/comments` |
| `transition_issue_open_state(repo, identifier, :close \| :reopen, opts)` | `{:ok, %{state}}` | `closeIssue`/`reopenIssue` | `PATCH /repos/{o}/{r}/issues/{n}` |
| `list_label_issues(repo, label, opts)` | `{:ok, [%{number, node_id}]}` | `issues(labels:)` | `GET /repos/{o}/{r}/issues?labels=&state=open` |
| `list_issue_prs(repo, identifier, branch, opts)` | `{:ok, [pr_basic]}` | linkage query | `GET /repos/{o}/{r}/pulls` + issue timeline |

### Normalized shapes

- `comment` (matches `GitHub.IssueComments.comment`):
  `%{id: String.t() | nil, author: String.t() | nil, body: String.t(), kind: "comment" | "workpad", url: String.t() | nil, created_at: String.t() | nil, updated_at: String.t() | nil}`.
  GraphQL `id` is the node id; REST `id` is the integer database id stringified.
  `kind` is derived from the body (the `## Codex Workpad` regex already in
  `IssueComments`), independent of transport.
- `%{state: "OPEN" | "CLOSED"}` for open/close transitions (REST `state`
  `"open"/"closed"` upcased to match the GraphQL enum already used by callers).
- `%{number: integer(), node_id: String.t()}` for label discovery (REST list
  items expose both `number` and `node_id`; the GraphQL path maps `id`→`node_id`).
- `pr_basic`: `%{number: integer(), url: String.t(), title: String.t() | nil, state: "open" | "closed" | "merged"}`
  (matches what `SyncDriver.to_pr_record/1` consumes; `merged` derived from REST
  `merged_at != nil` / `pull_request.merged`).

## Fallback & Defer Semantics

Per operation, `GitHub.Api` runs:

```
case graphql_attempt do
  {:ok, value}                      -> {:ok, normalize_graphql(value)}
  {:error, {:rate_limited, info}}   ->
     if rest_supported?(op) do
       case rest_attempt do
         {:ok, raw}                    -> {:ok, normalize_rest(raw)}
         {:error, {:rate_limited, i2}} -> {:error, {:rate_limited, merge_reset(info, i2)}}
         {:error, other}               -> {:error, other}
       end
     else
       {:error, {:rate_limited, Map.put(info, :capability, :projects_v2)}}
     end
  {:error, other}                   -> {:error, other}   # non-rate-limit GraphQL errors pass through unchanged (F1)
end
```

- Only `{:rate_limited, _}` triggers fallback (F1). Other GraphQL errors
  (validation, 5xx, not-found) propagate unchanged so existing behavior and tests
  hold.
- When both transports are rate-limited, the error carries the **later**
  `reset_at` so callers wait long enough.
- A one-line `Logger.info` records each fallback (`GitHub.Api fallback: op=add_comment
  transport=rest reason=graphql_rate_limited`) for observability/grepping.

## Integration Points

- `GitHub.IssueComments.create/4` and `for_issue/3` → call `GitHub.Api.add_comment` /
  `list_comments` (the GraphQL queries move *into* `GitHub.Api`; `IssueComments`
  keeps `parse_node/1`, `classify/1`, and the public API its callers use).
- `GitHub.IssueAdapter.add_comment/4` and `list_comments/2` already delegate to
  `IssueComments`, so they inherit fallback for free.
- `GitHub.IssueAdapter.move_issue/3`: the **board status** mutation stays GraphQL
  (defers); only the OPEN/CLOSED transition portion (when present) routes through
  `GitHub.Api.transition_issue_open_state`.
- `GitHub.Client` admission (`fetch_admission_candidates*`) → `GitHub.Api.list_label_issues`
  for the label-discovery query (the `addProjectV2ItemById` admission write stays
  GraphQL and defers).
- `GitHub.SyncDriver.pull_pull_requests/2` → `GitHub.Api.list_issue_prs` for
  linkage/state; the UI-facing rich `PullRequests` view is unchanged (GraphQL,
  defers under rate limit).

## Error Handling

- `repo` parsing reuses `RepoSpec.split/1`; identifier parsing reuses the existing
  issue-number parsers. Invalid input → `{:error, :invalid_arguments}` (no HTTP).
- Missing token → `{:error, :missing_github_token}` (already produced by `Client`).
- REST failures are classified by the existing `Client.classify_rest_failure/1`
  (`{:rate_limited, info}` vs `{:github_api_status, status}`).
- `GitHub.Api` never raises; all paths return `{:ok, _}` / `{:error, _}`.

## Testing Strategy

- **Unit (no network):** inject `request_fun` to simulate, per operation:
  (a) GraphQL success → asserts normalized shape;
  (b) GraphQL `200`-with-`RATE_LIMIT` error → REST success → asserts the
      normalized shape is **identical** to (a);
  (c) GraphQL rate-limited → REST rate-limited → asserts `{:rate_limited, info}`
      with the later `reset_at`;
  (d) Projects-v2-only op rate-limited → asserts `{:rate_limited, capability: :projects_v2}`;
  (e) non-rate-limit GraphQL error → passes through unchanged (no REST call).
- **Integration:** `IssueComments` create/for_issue and `SyncDriver.pull_pull_requests`
  exercised through `GitHub.Api` with fake transports; assert no behavior change on
  the happy path and correct fallback under simulated rate limit.
- Reuse the `github_client_test.exs` fake-`request_fun` pattern. No real network.
- Gates: `mix test`, `mix credo`, `mix dialyzer`, `mix format`, `mix specs.check`
  (every public `def` in `lib/` gets an adjacent `@spec`). `make all` clean.

## Out of Scope (this SPEC)

- Replacing the Projects v2 board path with REST (impossible — GraphQL-only).
- The rich PR check/review rollup over REST (stays GraphQL; defers under limit).
- The orchestrator/agent-runner backoff-until-`reset_at` fix (the run crashing and
  burning turns). It is **complementary** and tracked separately; `GitHub.Api`
  reduces how often the limit is hit but does not change run-failure handling.
- Changing the local-first sync cadence or data model.

## Open Questions / Risks

- **ID divergence:** GraphQL node ids vs REST integer ids for comments. Callers
  treat the comment `id`/`remote_id` as opaque; the outbox `dedup_key` is content-
  based, so a fallback-created comment keeps idempotency. Documented as accepted.
- **PR linkage parity:** REST linkage (timeline cross-references + head-branch
  match) may differ slightly from the GraphQL `closedByPullRequestsReferences`
  set; for sync linkage (number/url/state) this is acceptable and reconciles on
  the next non-limited GraphQL pull.
- **Label discovery pagination:** REST uses `Link` header pagination vs GraphQL
  cursors; `GitHub.Api` normalizes both to a full list (follows `Link: rel="next"`).
