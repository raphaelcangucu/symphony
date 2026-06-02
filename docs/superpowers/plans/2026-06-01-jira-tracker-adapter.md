# JIRA Tracker Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is TDD: write a failing test, see it fail, implement, see it pass, commit.

**Goal:** Add a third remote tracker backend — **JIRA Cloud** — alongside GitHub and Linear, with full parity at the three existing adapter boundaries (orchestrator poll, per-project UI read/write, local-first sync), plus all the registration/dispatch wiring and config/docs updates.

**Architecture:** JIRA mirrors the existing GitHub/Linear adapter layout under a new `lib/symphony_elixir/jira/` directory and plugs into the same three behaviours:

| Layer | Behaviour | JIRA module |
|-------|-----------|-------------|
| Orchestrator poll | `SymphonyElixir.Tracker` | `SymphonyElixir.Jira.Tracker` → `Jira.Client` |
| Per-project UI read/write | `SymphonyElixir.Tracker.IssueAdapter` | `SymphonyElixir.Jira.IssueAdapter` → `Jira.IssueAdapter.Query` |
| Local-first sync | `SymphonyElixir.Tracker.Sync.Driver` | `SymphonyElixir.Jira.SyncDriver` |
| Config validation | `SymphonyElixir.TrackerConfig` | `SymphonyElixir.Jira.Config` |

**Key technical difference vs. GitHub/Linear:** GitHub and Linear are GraphQL. **JIRA Cloud is REST (API v3)** and uses **ADF (Atlassian Document Format, a JSON tree)** for `description` and comment bodies. This plan introduces one extra helper module, `SymphonyElixir.Jira.Adf`, to convert plain text ↔ ADF. Everything else is a direct mirror of the Linear adapter (the thinner of the two references), upgraded to GitHub-level write parity (`move_issue`, `add_comment`, `create_issue`) so local-first sync push works end-to-end.

**Tech Stack:** Elixir/Phoenix, `Req` HTTP client, ExUnit. No new dependencies. Tests use the existing inline-stub pattern (`Application.put_env(:symphony_elixir, :jira_client_module, Stub)`) — no Mox/Bypass.

**Reference implementations to copy from:**
- `elixir/lib/symphony_elixir/linear/` (closest layout)
- `elixir/lib/symphony_elixir/github/sync_driver.ex` (full push parity: state/comment/issue)

---

## JIRA Cloud REST API reference (API v3)

Decisions locked for this plan (pick a reasonable default, document it):

- **Base URL:** `https://<site>.atlassian.net` from config (`jira.base_url` / `$JIRA_BASE_URL`).
- **Auth:** HTTP Basic with `email:api_token` Base64-encoded → `Authorization: Basic <b64>`. Email + token from config/env.
- **Bodies:** description + comment use **ADF**. `Jira.Adf.from_text/1` wraps plain text in a single-paragraph ADF doc; `Jira.Adf.to_text/1` flattens an ADF tree back to plain text for reads.

| Operation | Endpoint | Notes |
|-----------|----------|-------|
| Search issues (poll, list) | `POST /rest/api/3/search/jql` | Body `{"jql","fields":[...],"maxResults":50,"nextPageToken":...}`. Response `{"issues":[...],"nextPageToken":...,"isLast":bool}`. (The legacy `/rest/api/3/search` is removed on Cloud — use `/search/jql`.) |
| Get one issue | `GET /rest/api/3/issue/{key}?fields=...` | |
| Create issue | `POST /rest/api/3/issue` | Body `{"fields":{"project":{"key":KEY},"issuetype":{"name":"Task"},"summary":...,"description":ADF,...}}` → `{"id","key","self"}`. |
| List transitions | `GET /rest/api/3/issue/{key}/transitions` | Returns `transitions:[{id,name,to:{name,statusCategory}}]`. |
| Apply transition (= move) | `POST /rest/api/3/issue/{key}/transitions` | Body `{"transition":{"id":TRANSITION_ID}}` → 204. Pick the transition whose `to.name == target_status`. |
| List comments | `GET /rest/api/3/issue/{key}/comment` | `{comments:[{id,body(ADF),author:{displayName},updated}]}`. |
| Add comment | `POST /rest/api/3/issue/{key}/comment` | Body `{"body":ADF}` → `{id,...}`. |
| Project statuses | `GET /rest/api/3/project/{projectKey}/statuses` | Array per issue-type → flatten unique `{id,name,statusCategory:{key,name}}`. |
| Labels | `GET /rest/api/3/label` | `{values:[...string...],isLast}`. Free-form, no ids. |
| Assignable users | `GET /rest/api/3/user/assignable/search?project={projectKey}&maxResults=100` | `[{accountId,displayName,...}]`. |
| Current user (`assignee: "me"`) | `GET /rest/api/3/myself` | `{accountId,...}`. |

**Status category mapping** (`statusCategory.key` → Symphony category): `new` → `"unstarted"`, `indeterminate` → `"started"`, `done` → `"completed"`. Terminal = category `done`.

**Priority mapping** (`fields.priority.name` ↔ integer): `Highest`→1, `High`→2, `Medium`→3, `Low`→4, `Lowest`→5, else `nil`. Reverse for create.

**Identifier mapping:** `IssueDTO.id` = JIRA internal `id` (stable across renames); `IssueDTO.identifier` = JIRA `key` (e.g. `"ABC-123"`).

**Blockers:** `fields.issuelinks` entries where `type.inward == "is blocked by"` and `inwardIssue` present → `%{id, identifier: key, state: status.name}`.

**Branch name:** `nil` (JIRA dev-status panel requires a separate undocumented API; out of scope, matches Linear-level simplicity).

---

## Conventions for every task

- Backend tests: `cd elixir && mix test <path>`. Full gate before handoff: `cd elixir && make all` (format, lint, coverage, dialyzer) and `cd elixir && mix specs.check` (every `def` in `lib/` needs an adjacent `@spec`; `@impl` callbacks are exempt).
- Commit after each task (frequent commits). Work on the current branch (no worktree) unless told otherwise.
- Follow existing module/style patterns in `lib/symphony_elixir/linear/*`. Keep changes narrowly scoped.
- Inputs validated at entry; fail fast with clear `{:error, atom()}`/`{:error, {tag, detail}}`. No magic strings — module attributes for endpoints/issue-type defaults.

---

## File Structure (decomposition)

**Backend — new (`elixir/lib/symphony_elixir/jira/`)**
- `config.ex` — `Jira.Config` (`@behaviour TrackerConfig`): `base_url/0`, `email/0`, `api_token/0`, `project_key/0`, `assignee/0`, `validate!/0`. Mirrors `Linear.Config` env-resolution (`$ENV` references).
- `adf.ex` — `Jira.Adf`: `from_text/1` (plain → ADF doc), `to_text/1` (ADF → plain).
- `client.ex` — `Jira.Client`: REST poll client → `SymphonyElixir.Issue`. `fetch_candidate_issues/0`, `fetch_issues_by_states/1`, `fetch_issue_states_by_ids/1`, plus a low-level `request/4` (verb, path, body, opts) injectable via `:request_fun`. Maps JIRA fields → `%Issue{}`.
- `tracker.ex` — `Jira.Tracker` (`@behaviour Tracker`): delegates polls to client; `create_comment/2` (POST comment), `update_issue_state/2` (resolve + apply transition), `project_identity/0`, `default_prompt_template/0`.
- `issue_adapter.ex` — `Jira.IssueAdapter` (`@behaviour Tracker.IssueAdapter`): UI list/get/create/move/comments/statuses/labels/users → `IssueDTO`.
- `issue_adapter/query.ex` — `Jira.IssueAdapter.Query`: JQL/field constants + normalizers (`normalize_issue/2`, `statuses/1`, `labels/1`, `users/1`, `created_issue/2`, `category_for/1`).
- `sync_driver.ex` — `Jira.SyncDriver` (`@behaviour Tracker.Sync.Driver`): `pull/2`, `push/2` (state/comment/issue, mirrors `GitHub.SyncDriver`), `pull_pull_requests/2` → `{:ok, []}`.

**Backend — modified (registration / dispatch)**
- `config.ex` — add `"jira"` to `@tracker_sections`; add `"jira" -> Jira.Config` in `tracker_config_module/0`.
- `tracker.ex` — add `"jira" -> Jira.Tracker` in `adapter/0`.
- `tracker/issue_adapter.ex` — add `"jira" => Jira.IssueAdapter` to `@default_adapters`, `"jira"` to `@remote_kinds`, extend `@callback kind()` typespec to include `:jira`.
- `tracker/sync/engine.ex` — add `"jira" -> Jira.SyncDriver` in `default_driver_for/1`, and `"jira"` to the `sync_enabled?/1` allow-list.

**Tests — new**
- `test/symphony_elixir/jira/config_test.exs`
- `test/symphony_elixir/jira/adf_test.exs`
- `test/symphony_elixir/jira_client_test.exs`
- `test/symphony_elixir/tracker_jira_test.exs` (Jira.Tracker delegation + transitions/comments)
- `test/symphony_elixir/jira/issue_adapter_test.exs`
- `test/symphony_elixir/jira/issue_adapter_query_test.exs`
- `test/symphony_elixir/jira/sync_driver_test.exs`

**Tests — modified**
- Existing routing/config tests if they assert the exact set of tracker kinds (extend, don't replace).

**Docs — modified (same PR, per repo Docs Update Policy)**
- `WORKFLOW.md` — add `jira:` section contract.
- `elixir/README.md` and `README.md` — mention JIRA backend + env vars.
- `SPEC.md` — if it enumerates supported trackers, add JIRA.

---

# PHASE 1 — Config, ADF helper, and HTTP client foundation

## Task 1: `Jira.Adf` text ↔ ADF conversion

**Files:**
- Create: `elixir/lib/symphony_elixir/jira/adf.ex`
- Test: `elixir/test/symphony_elixir/jira/adf_test.exs`

- [ ] **Step 1: Failing test** — assert round-trip and extraction:

```elixir
defmodule SymphonyElixir.Jira.AdfTest do
  use ExUnit.Case, async: true
  alias SymphonyElixir.Jira.Adf

  test "from_text wraps plain text in a single-paragraph ADF doc" do
    assert Adf.from_text("hello") == %{
             "type" => "doc",
             "version" => 1,
             "content" => [
               %{"type" => "paragraph", "content" => [%{"type" => "text", "text" => "hello"}]}
             ]
           }
  end

  test "from_text splits on blank lines into multiple paragraphs" do
    doc = Adf.from_text("a\n\nb")
    assert length(doc["content"]) == 2
  end

  test "from_text on empty/nil yields an empty doc" do
    assert Adf.from_text(nil)["content"] == []
    assert Adf.from_text("")["content"] == []
  end

  test "to_text flattens nested ADF text nodes with paragraph breaks" do
    doc = %{"type" => "doc", "content" => [
      %{"type" => "paragraph", "content" => [%{"type" => "text", "text" => "a"}]},
      %{"type" => "paragraph", "content" => [%{"type" => "text", "text" => "b"}]}
    ]}
    assert Adf.to_text(doc) == "a\n\nb"
  end

  test "to_text on nil/non-adf returns empty string" do
    assert Adf.to_text(nil) == ""
    assert Adf.to_text("already plain") == "already plain"
  end
end
```

- [ ] **Step 2: Run, verify fail** — `cd elixir && mix test test/symphony_elixir/jira/adf_test.exs` → `UndefinedFunctionError`.

- [ ] **Step 3: Implement** — recursive text walk; `from_text` splits on `\n\n` into paragraphs; `to_text` recurses `content`, joins `text` nodes, separates `paragraph` blocks with `\n\n`. Handle `nil`, `""`, and already-plain `String`. Both public `def`s get `@spec`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `feat(jira): add ADF <-> plain text helper`.

## Task 2: `Jira.Config`

**Files:**
- Create: `elixir/lib/symphony_elixir/jira/config.ex`
- Test: `elixir/test/symphony_elixir/jira/config_test.exs`

Mirror `Linear.Config` exactly (env-reference resolution via `$ENV_NAME`, `normalize_secret`, `section("jira")`), with accessors `base_url/0`, `email/0`, `api_token/0`, `project_key/0`, `assignee/0`.

- [ ] **Step 1: Failing test** — drive `validate!/0` branches via `Application.put_env(:symphony_elixir, ...)`? No — config reads `SymphonyElixir.Config.section("jira")` from WORKFLOW. Follow the pattern in `test/symphony_elixir/github_config_test.exs` / Linear config tests (use `TestSupport` to set a workflow fixture, or stub `section/1`). At minimum:

```elixir
test "validate! errors when base_url missing" do
  # with jira section lacking base_url
  assert {:error, msg} = SymphonyElixir.Jira.Config.validate!()
  assert msg =~ "base URL"
end

test "validate! ok when base_url, email, api_token, project_key present" do
  assert :ok = SymphonyElixir.Jira.Config.validate!()
end
```

Look at how `linear/config` tests inject the section (search `test/symphony_elixir` for `section` setup) and copy that mechanism.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** `validate!/0` with ordered `cond`:
  - missing `base_url` → `{:error, "JIRA base URL missing — set jira.base_url in WORKFLOW.md or JIRA_BASE_URL env var"}`
  - missing `email` → `"JIRA email missing — set jira.email or JIRA_EMAIL"`
  - missing `api_token` → `"JIRA API token missing — set jira.api_token or JIRA_API_TOKEN"`
  - missing `project_key` → `"JIRA project key missing — set jira.project_key in WORKFLOW.md"`
  - else `:ok`
  Env fallbacks: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_ASSIGNEE`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `feat(jira): add Jira.Config with WORKFLOW + env resolution`.

## Task 3: `Jira.Client` request core + auth

**Files:**
- Create: `elixir/lib/symphony_elixir/jira/client.ex`
- Test: `elixir/test/symphony_elixir/jira_client_test.exs`

This task implements only the injectable `request/4` + header/auth + error classification (no issue mapping yet). Mirror Linear's `graphql/3` shape: accept `opts[:request_fun]` to bypass HTTP.

- [ ] **Step 1: Failing test** — inject a fake `request_fun` returning `%{status: 200, body: %{"ok" => true}}` and assert `{:ok, %{"ok" => true}}`; inject `%{status: 401}` → `{:error, {:jira_api_status, 401}}`; assert the `Authorization: Basic` header is Base64 of `email:token`.

```elixir
test "request returns body on 200 and sets basic auth" do
  fun = fn _verb, _url, _body, headers ->
    auth = headers |> Enum.into(%{}) |> Map.get("Authorization")
    assert auth == "Basic " <> Base.encode64("user@x.com:tok")
    {:ok, %{status: 200, body: %{"ok" => true}}}
  end
  assert {:ok, %{"ok" => true}} =
           SymphonyElixir.Jira.Client.request(:get, "/rest/api/3/myself", nil,
             request_fun: fun, base_url: "https://x.atlassian.net", email: "user@x.com", api_token: "tok")
end
```

(Allow `base_url`/`email`/`api_token` opt overrides so tests don't need WORKFLOW fixtures; production reads them from `Jira.Config`.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**
  - `@spec request(atom(), String.t(), map() | nil, keyword()) :: {:ok, map()} | {:error, term()}`
  - Build full URL `base_url <> path`; headers `Authorization: Basic ...`, `Content-Type: application/json`, `Accept: application/json`.
  - Default `request_fun` calls `Req.request(method: verb, url: url, headers: headers, json: body, connect_options: [timeout: 30_000])` (omit `json` when body is `nil`).
  - Map: `{:ok, %{status: s, body: b}}` with `s in 200..299` → `{:ok, b}`; other status → `{:error, {:jira_api_status, s}}` (log truncated body, copy `Linear.Client.summarize_error_body`); transport `{:error, reason}` → `{:error, {:jira_api_request, reason}}`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `feat(jira): add Jira.Client request core with basic auth`.

---

# PHASE 2 — Orchestrator poll (`Jira.Client` mapping + `Jira.Tracker`)

## Task 4: `Jira.Client` issue mapping + JQL search

**Files:**
- Modify: `elixir/lib/symphony_elixir/jira/client.ex`
- Test: `elixir/test/symphony_elixir/jira_client_test.exs`

- [ ] **Step 1: Failing test** — feed a stub `request_fun` returning a `/search/jql` body fixture (one issue with `summary`, `description` ADF, `status.statusCategory`, `assignee.accountId`, `priority.name`, `issuelinks` blocker, `created`/`updated`) and assert the normalized `%Issue{}` fields. Add a paging test: first response `isLast: false, nextPageToken: "t2"`, second `isLast: true` → issues concatenated in order. Add an assignee-filter test (config `assignee: "me"` resolves via `/myself` then filters `assigned_to_worker`).

  Provide a `normalize_issue_for_test/1,2` helper like Linear for unit coverage.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**
  - `@search_fields` module attr listing requested fields: `["summary","description","status","assignee","priority","labels","issuelinks","created","updated"]`.
  - `fetch_candidate_issues/0`: guard missing config (`{:error, :missing_jira_credentials}` / `:missing_project_key`); build JQL `project = "KEY" AND status in (active_states) [AND assignee = currentUser()/accountId]`; page via `POST /rest/api/3/search/jql` following `nextPageToken` until `isLast`.
  - `fetch_issues_by_states/1`: JQL `project = KEY AND status in (...)`, no assignee filter (mirror Linear).
  - `fetch_issue_states_by_ids/1`: JQL `id in (...)` (JIRA accepts numeric ids or keys; use keys/ids passed in). Return `%Issue{}` with at least `id`, `identifier`, `state`.
  - `normalize_issue/2` → `%SymphonyElixir.Issue{}`: `id: f.id`, `identifier: f.key`, `title: fields.summary`, `description: Adf.to_text(fields.description)`, `priority: priority_to_int(fields.priority.name)`, `state: fields.status.name`, `branch_name: nil`, `url: base_url <> "/browse/" <> key`, `assignee_id: fields.assignee.accountId`, `blocked_by: extract_blockers(fields.issuelinks)`, `labels: fields.labels |> downcase`, `assigned_to_worker: ...`, timestamps via `DateTime.from_iso8601`.
  - JQL string quoting: wrap status names in double quotes, escape embedded quotes.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `feat(jira): map JQL search results to Issue structs`.

## Task 5: `Jira.Tracker` (orchestrator behaviour)

**Files:**
- Create: `elixir/lib/symphony_elixir/jira/tracker.ex`
- Test: `elixir/test/symphony_elixir/tracker_jira_test.exs`

Mirror `Linear.Tracker`: delegate `fetch_*` to `client_module()`; implement `create_comment/2` and `update_issue_state/2` against REST.

- [ ] **Step 1: Failing test** — stub `:jira_client_module` with a module exposing `request/4` recording calls:
  - `create_comment(key, body)` → POSTs `/rest/api/3/issue/KEY/comment` with ADF body, returns `:ok` on 2xx.
  - `update_issue_state(key, "Done")` → first GETs `/transitions`, finds transition whose `to.name == "Done"`, then POSTs `/transitions` with that id → `:ok`; unknown status → `{:error, :transition_not_found}`.
  - `project_identity/0` returns the configured project key.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**
  - `@behaviour SymphonyElixir.Tracker`.
  - `project_identity/0` → `Jira.Config.project_key()`.
  - `default_prompt_template/0` → copy Linear's template, reword "Linear issue" → "JIRA issue", keep `{{ issue.identifier }}` / `{{ issue.title }}` / description block.
  - `fetch_candidate_issues/0`, `fetch_issues_by_states/1`, `fetch_issue_states_by_ids/1` → `client_module().<fn>`.
  - `create_comment/2` → `client_module().request(:post, "/rest/api/3/issue/#{key}/comment", %{"body" => Adf.from_text(body)}, [])`; 2xx → `:ok`.
  - `update_issue_state/2` → `resolve_transition_id(key, state_name)` via GET `/transitions`, then POST. Return `{:error, :transition_not_found}` when no match.
  - `client_module/0` → `Application.get_env(:symphony_elixir, :jira_client_module, Client)`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `feat(jira): add Jira.Tracker orchestrator adapter`.

---

# PHASE 3 — Per-project UI adapter (`Jira.IssueAdapter` + `Query`)

## Task 6: `Jira.IssueAdapter.Query` normalizers

**Files:**
- Create: `elixir/lib/symphony_elixir/jira/issue_adapter/query.ex`
- Test: `elixir/test/symphony_elixir/jira/issue_adapter_query_test.exs`

Pure functions, no HTTP — easiest to TDD first. Mirror `Linear.IssueAdapter.Query`.

- [ ] **Step 1: Failing test** — assert:
  - `normalize_issue/2` builds an `IssueDTO` from a JIRA issue map (id, key→identifier, summary→title, ADF description→text, priority name→int, status→`%{name,category,position,is_terminal}`, assignee.displayName, created/updated, url).
  - `category_for/1`: `"new"`→`"unstarted"`, `"indeterminate"`→`"started"`, `"done"`→`"completed"`.
  - `statuses/1` flattens `/project/{key}/statuses` per-issue-type arrays into unique status list.
  - `labels/1` maps `/label` `values` (strings) → `%{id: nil, name: label}`.
  - `users/1` maps assignable-user array → `%{id: accountId, login: displayName, name, avatar_url}`.
  - `created_issue/2` reads `{id,key}` from a create response + given title → `IssueDTO`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** the query/field constants and the normalizers above. `position` for status: index within the flattened ordered list (or `nil`). `is_terminal` = category `"completed"`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `feat(jira): add IssueAdapter.Query normalizers`.

## Task 7: `Jira.IssueAdapter` (full read/write parity)

**Files:**
- Create: `elixir/lib/symphony_elixir/jira/issue_adapter.ex`
- Test: `elixir/test/symphony_elixir/jira/issue_adapter_test.exs`

Unlike Linear (which stubs `move_issue`/`add_comment`/`create_issue`), implement **all** of these so local-first sync push works (GitHub parity). Use `tracker_config["project_key"]` for the project, optional `tracker_config["issue_type"]` (default `"Task"`).

- [ ] **Step 1: Failing test** — stub `:jira_client_module` with a `request/4` that pattern-matches on `{verb, path}` and returns canned bodies. Cover:
  - `kind/0 == :jira`.
  - `list_issues/2` → JQL search → `[%IssueDTO{}]`.
  - `get_issue/2` → found / `:issue_not_found`.
  - `list_statuses/1`, `list_labels/1`, `list_assignable_users/1`.
  - `create_issue/2` → resolves issue type, builds fields, returns `IssueDTO`; missing title → `{:remote_validation, %{title: ["is required"]}}`.
  - `move_issue/3` → GET transitions, POST matching transition → returns updated DTO; unknown status → `:status_not_found`.
  - `add_comment/4` → POST comment → `{:ok, %{remote_id: id, body: ..., author: ..., remote_updated_at: ...}}` (shape consumed by `GitHub.SyncDriver` push and `Normalize`).
  - `list_comments/2` → `{:ok, [%{remote_id, body, author, remote_updated_at}]}`.
  - Error mapping: 401→`:remote_unauthorized`, 403→`:remote_forbidden`, 404→`:issue_not_found`, 429→`:remote_rate_limited`, 5xx→`:remote_unavailable`, 400→`{:remote_validation, _}`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** `@behaviour SymphonyElixir.Tracker.IssueAdapter` with all 11 callbacks. `client/0` → `Application.get_env(:symphony_elixir, :jira_client_module, Client)`. Centralize status→error mapping in `map_error/1` (copy/adapt `Linear.IssueAdapter.map_error/1` for the `:jira_api_status` tags). `move_issue/3` resolves the transition id like `Jira.Tracker.update_issue_state/2` then re-fetches the issue for the returned DTO. Comments returned as maps with `remote_id`, `body` (`Adf.to_text`), `author`, `remote_updated_at`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `feat(jira): add Jira.IssueAdapter UI read/write`.

---

# PHASE 4 — Sync driver + registration wiring

## Task 8: `Jira.SyncDriver`

**Files:**
- Create: `elixir/lib/symphony_elixir/jira/sync_driver.ex`
- Test: `elixir/test/symphony_elixir/jira/sync_driver_test.exs`

Copy `GitHub.SyncDriver` (not Linear's — we want full push parity), swapping the adapter env key to `:jira_sync_adapter` and returning `{:ok, []}` for `pull_pull_requests/2` (GitHub owns source control).

- [ ] **Step 1: Failing test** — model on `test/symphony_elixir/linear/sync_driver_test.exs` with a `StubAdapter` implementing `list_issues/2`, `list_comments/2`, `move_issue/3`, `add_comment/4`, `create_issue/2`. Assert:
  - `pull/2` normalizes issues + attaches comments.
  - `push` state/move → `{:ok, id}`.
  - `push` comment/create → `{:ok, remote_id}`.
  - `push` issue/create → `{:ok, id}`.
  - unsupported entity → `{:error, {:unsupported_push, type, op}}`.
  - `pull_pull_requests/2` → `{:ok, []}`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — `@behaviour SymphonyElixir.Tracker.Sync.Driver`; `adapter/0` → `Application.get_env(:symphony_elixir, :jira_sync_adapter, SymphonyElixir.Jira.IssueAdapter)`. `pull/2` fetches comments per issue via `list_comments` (like GitHub).

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `feat(jira): add Jira.SyncDriver with full push parity`.

## Task 9: Register JIRA across all dispatch points

**Files:**
- Modify: `elixir/lib/symphony_elixir/config.ex`
- Modify: `elixir/lib/symphony_elixir/tracker.ex`
- Modify: `elixir/lib/symphony_elixir/tracker/issue_adapter.ex`
- Modify: `elixir/lib/symphony_elixir/tracker/sync/engine.ex`
- Test: `elixir/test/symphony_elixir/tracker/issue_adapter_test.exs` (+ routing test), `elixir/test/symphony_elixir/config_test.exs`

- [ ] **Step 1: Failing tests** — assert:
  - `IssueAdapter.for(%Project{tracker_kind: "jira"})` returns `Jira.IssueAdapter` when sync disabled, and `Sync.LocalFirstAdapter` when `tracker_sync_enabled?` is true (mirror existing GitHub/Linear routing test).
  - With a WORKFLOW fixture containing a `jira:` section, `Config.tracker_kind() == "jira"` and `Tracker.adapter() == Jira.Tracker`.
  - `Sync.Engine` default driver for a `"jira"` project is `Jira.SyncDriver` (if there's an existing engine test asserting drivers, extend it; otherwise add a focused test calling the engine's public surface or a thin testable wrapper).

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement the four edits:**

`config.ex`:
```elixir
@tracker_sections ["local", "linear", "jira", "github", "memory"]
```
```elixir
defp tracker_config_module do
  case tracker_kind() do
    "local" -> SymphonyElixir.LocalTracker.Config
    "linear" -> SymphonyElixir.Linear.Config
    "jira" -> SymphonyElixir.Jira.Config
    "github" -> SymphonyElixir.GitHub.Config
    "memory" -> SymphonyElixir.Memory.Config
  end
end
```

`tracker.ex` `adapter/0`:
```elixir
case Config.tracker_kind() do
  "local" -> SymphonyElixir.LocalTracker.Tracker
  "memory" -> SymphonyElixir.Memory.Tracker
  "linear" -> SymphonyElixir.Linear.Tracker
  "jira" -> SymphonyElixir.Jira.Tracker
  _ -> SymphonyElixir.GitHub.Tracker
end
```

`tracker/issue_adapter.ex`:
```elixir
@callback kind() :: :local | :github | :linear | :jira
# ...
@default_adapters %{
  "local" => SymphonyElixir.LocalTracker.IssueAdapter,
  "github" => SymphonyElixir.GitHub.IssueAdapter,
  "linear" => SymphonyElixir.Linear.IssueAdapter,
  "jira" => SymphonyElixir.Jira.IssueAdapter
}

@remote_kinds ["github", "linear", "jira"]
```

`tracker/sync/engine.ex`:
```elixir
defp sync_enabled?(project), do: project.tracker_kind in ["github", "linear", "jira"]

defp default_driver_for(project) do
  case project.tracker_kind do
    "github" -> SymphonyElixir.GitHub.SyncDriver
    "linear" -> SymphonyElixir.Linear.SyncDriver
    "jira" -> SymphonyElixir.Jira.SyncDriver
    _ -> nil
  end
end
```

- [ ] **Step 4: Run, verify pass** — also run the broader suites that touch these modules: `cd elixir && mix test test/symphony_elixir/tracker test/symphony_elixir/config_test.exs`.

- [ ] **Step 5: Commit** — `feat(jira): register JIRA across tracker dispatch points`.

---

# PHASE 5 — Docs and final gates

## Task 10: Docs

**Files:**
- Modify: `WORKFLOW.md`, `elixir/README.md`, `README.md`, and `SPEC.md` (if it enumerates trackers).

- [ ] **Step 1:** Add a `jira:` section to `WORKFLOW.md` documenting:
```yaml
jira:
  base_url: $JIRA_BASE_URL        # https://<site>.atlassian.net
  email: $JIRA_EMAIL
  api_token: $JIRA_API_TOKEN
  project_key: ABC
  assignee: me                    # optional: "me" or an accountId
```
  Note per-project `tracker_config` keys for the UI adapter: `project_key` (required), `issue_type` (optional, default `Task`).

- [ ] **Step 2:** README env-var table: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_ASSIGNEE`. Mention JIRA uses REST v3 + ADF (vs. GraphQL for GitHub/Linear).

- [ ] **Step 3: Commit** — `docs(jira): document JIRA tracker configuration`.

## Task 11: Full gate

- [ ] `cd elixir && mix specs.check` — every new public `def` has an adjacent `@spec`.
- [ ] `cd elixir && make all` — format check, lint (Credo), coverage, Dialyzer all green.
- [ ] Fix any Dialyzer/spec/format issues, then commit `chore(jira): satisfy quality gates`.

---

## Verification checklist (before claiming done)

- [ ] All new test files pass individually and as part of `mix test`.
- [ ] `make all` green; `mix specs.check` green.
- [ ] `Config.tracker_kind()` returns `"jira"` for a WORKFLOW with a `jira:` section.
- [ ] `Tracker.adapter/0`, `IssueAdapter.for/1`, `Sync.Engine.default_driver_for/1`, and `Config` validation all route `"jira"` correctly.
- [ ] Local-first sync push for state/comment/issue exercises real `Jira.IssueAdapter` write paths (the GitHub-parity gap that Linear left open is closed).
- [ ] Docs updated in the same PR (WORKFLOW.md + READMEs).

## Out of scope (call out, don't silently skip)

- JIRA dev-status branch linking (`branch_name` stays `nil`).
- Rich ADF rendering (tables, mentions, panels) — only paragraphs/text are converted; other nodes degrade to their text content.
- A `RequestGateway`-style rate-limit coordinator (GitHub has one; JIRA returns 429 → `:remote_rate_limited` and relies on the engine's retry/backoff). Add later if JIRA throttling becomes a problem.
- JIRA Server/Data Center (this targets **JIRA Cloud** API v3 only).
