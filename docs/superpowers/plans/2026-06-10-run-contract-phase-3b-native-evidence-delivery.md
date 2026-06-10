# Run Contract — Phase 3B: native evidence delivery

**Goal:** Evidence artifacts (screenshots/videos) actually render on the remote
issue, regardless of provider:

- **Part A (GitHub-backed projects, e.g. `gamba`):** evidence images render on
  GitHub because the `## Codex Evidence` comment points at a *publicly
  reachable* Symphony artifact URL (reuse the public tunnel), the comment sync
  no longer dies with `:remote_unavailable`, and the run's PR is recorded as a
  structured row so it shows in the issue's **Pull request** tab — not only as
  free text inside the workpad.
- **Part B (Linear/Jira):** evidence artifacts are *uploaded natively* to the
  tracker (Linear `fileUpload`, Jira attachments + ADF media) so the comment
  embeds tracker-hosted asset URLs instead of Symphony-served URLs. This was the
  deviation deferred from Phase 3.

## Current state (verified 2026-06-10)

- Evidence comment body is built by `Orchestrator.evidence_comment_body/3` and
  embeds `symphony_base_url()` = `http://#{Config.server_host()}:#{port}` — not
  reachable from GitHub/Linear/Jira renderers.
- `Tracker.upsert_evidence/2` writes the comment locally + enqueues an outbox
  `comment:create`/`comment:update`; the `Tracker.Sync.Engine` pushes it through
  the provider `SyncDriver` (`Linear`/`Jira`/`GitHub`).
- `gamba` is `tracker_kind = github`. GAM-5 has a real GitHub issue
  `remote_id` (`I_kwDOJHngx8...`); its workpad comment synced, but the evidence
  comment outbox row is `failed / attempts=5 / :remote_unavailable`.
- `tracker_pull_requests` has **no** row for GAM-5; the `#3992` link only lives
  as text inside the workpad body. `LocalStore.upsert_run_pull_request/3` already
  exists (Phase 1) and explicitly supports non-numeric identifiers like GAM-5.
- Public tunnel: when enabled, `PublicHostPlug` falls the tracker host
  (`<namespace>.<base_domain>`) through to the Phoenix app, so
  `/api/tracker/v1/.../evidence/.../artifacts/...` is reachable publicly. The
  namespace/base-domain come from `Config.public_tunnel_*` + `PublicRouting`.

---

## Part A — GitHub-backed evidence + PR tab

### Task A1: Public evidence artifact URLs

**Files:**
- Modify: `elixir/lib/symphony_elixir/public_routing.ex` (add safe `public_base_url/1`)
- Modify: `elixir/lib/symphony_elixir/orchestrator.ex` (`symphony_base_url/0`)
- Test: `elixir/test/symphony_elixir/public_routing_test.exs`, extend
  `orchestrator_run_contract_test.exs`

**Steps (TDD):**
1. Add `PublicRouting.public_base_url(opts \\ []) :: String.t() | nil` returning
   `"https://" <> tracker_host(opts)` when `public_tunnel_enabled?` **and** the
   namespace resolves; `nil` otherwise (never raise — `tracker_host/1` currently
   pattern-matches `{:ok, ns}` and would crash on `:no_namespace`).
2. `Orchestrator.symphony_base_url/0`: prefer `PublicRouting.public_base_url()`,
   fall back to `http://#{server_host}:#{server_port}`.
3. Tests: tunnel-enabled+namespace → `https://…` base; tunnel-off → loopback;
   tunnel-on but no namespace → loopback (no crash).

### Task A2: Harden evidence comment sync to GitHub (`:remote_unavailable`)

This needs a repro before a fix — follow `systematic-debugging`.

**Investigation:**
1. Reproduce `GitHub.IssueAdapter.add_comment(project, "GAM-5", evidence_body, %{})`
   in isolation (the workpad synced; only evidence failed → suspect body content
   or transient 5xx, not identifier resolution).
2. Inspect `GitHub.IssueComments.create/3` + `GitHub.Api` for what maps to
   `:remote_unavailable` (catch-all `map_error(_)`), and add a one-line log of
   the underlying reason so the outbox failure is diagnosable.

**Fix (depends on root cause; likely one of):**
- If catch-all hides a real status/body: surface it (log + map specific codes)
  so retries are meaningful and operators can act.
- If a transient 5xx: the outbox already retried 5x — confirm backoff and that a
  later poll re-attempts; consider not permanently parking evidence-comment
  failures (they should re-attempt on the next completion).
- If body-size / markdown issue: confirm GitHub accepts the body (image links
  don't fail the API). Add a regression test in the GitHub adapter test.

### Task A3: Record the run PR so it shows in the PR tab

**Files:**
- Verify/locate where `record_run_pull_requests/2` is invoked in the completion
  flow (`orchestrator.ex`); ensure the publish-contract PRs are persisted.
- One-off backfill for GAM-5 (`#3992`) via `LocalStore.upsert_run_pull_request/3`.

**Steps:**
1. Add a regression test: given a completed run whose publish contract returns a
   PR for a non-numeric identifier (GAM-5), `tracker_pull_requests` gains a row
   with `origin: "agent"` and the PR shows via `PullRequests.for_issue/2`.
2. Backfill GAM-5: run a guarded `mix run` snippet calling
   `LocalStore.upsert_run_pull_request(project_id, "GAM-5", %{url: ".../pull/3992", state: "open"})`
   (idempotent — keyed by URL).
3. If the PR also belongs in the workpad/PR body, leave the existing workpad text
   as-is; the structured row is the source of truth for the tab.

---

## Part B — Native uploads to Linear/Jira

### Task B1: Push-time artifact rewriter (shared)

**New module:** `SymphonyElixir.Evidence.RemoteArtifacts`
- `parse_artifact_urls(body) :: [%{url, project_slug, identifier, run_id, rel}]`
  via a regex on the artifact route shape from `evidence_artifact_url/4`.
- `rewrite(body, uploader, ctx) :: {:ok, body, uploaded}` — for each URL:
  resolve the local file (`Evidence.Store.list/2` + `resolve_artifact/2`),
  upload via the provider `uploader`, replace the URL with the returned asset
  reference; collect failures (degrade: keep the Symphony URL on failure).
- **Cache** to avoid re-upload on every in-place `comment:update`: new table
  `evidence_remote_assets` keyed by `(provider, content_sha256)` → `asset_url`.

**Uploader behaviour:** `@callback upload(abs_path, filename, content_type) :: {:ok, asset_ref} | {:error, term}` where `asset_ref` carries provider-specific
embed info (Linear: `assetUrl`; Jira: attachment id + filename).

Wire the rewriter into `Linear.SyncDriver.push` and `Jira.SyncDriver.push` for
`comment:create`/`comment:update` (only for bodies that contain artifact URLs).

### Task B2: Linear native upload

**New module:** `SymphonyElixir.Linear.Uploads` implementing the uploader.
- `fileUpload(filename, contentType, size, makePublic: true)` → `uploadUrl`,
  `assetUrl`, `headers`.
- `PUT` the bytes to `uploadUrl` with the returned headers (Req).
- Return `assetUrl`; the rewriter embeds `![name](assetUrl)`.

### Task B3: Jira native upload — shipped as **attach + link**

**New module:** `SymphonyElixir.Jira.Uploads` implementing the uploader.
- `POST /rest/api/3/issue/{key}/attachments` (multipart, header
  `X-Atlassian-Token: no-check`) → returns each attachment's `content`
  (Jira-hosted download URL).
- The attachment surfaces in the issue's **Attachments panel** (Jira renders
  image thumbnails there), so evidence is visible without a publicly reachable
  Symphony. The rewriter swaps the Symphony artifact URL for the Jira `content`
  URL in the comment body.
- Attachments are **issue-scoped**, so the rewriter cache key carries the issue
  identifier (`provider = "jira:" <> identifier`); repeated in-place comment
  updates still skip re-upload.
- Wired into `Jira.SyncDriver.push` for `comment:create`/`comment:update` via a
  per-issue uploader closure (`Application.get_env :jira_artifact_uploader`).

**Deferred:** inline ADF `media` rendering inside the comment body. `Jira.Adf`
is plain-text only today, and the `media` node needs a *media id* (distinct from
the attachment id) that we can't validate without a live Jira; tracked as a
follow-up behind the attach-and-link delivery above.

---

## Gates (run per part, before commit)

- `cd elixir && mix format --check-formatted` (run carefully — has crashed WSL;
  keep concurrency low)
- `cd elixir && mix test --max-cases 2 <touched files>` then full suite
- `cd elixir && mix credo --strict` (only fix regressions introduced here)
- `cd tracker && npx vitest run --maxWorkers=1` (only if UI touched)
- Docs: update `README.md` + `SPEC.md` evidence sections; refresh the
  `evidence`/`linear` skills if the upload flow changes operator guidance.
