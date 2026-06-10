# Run Contract: Staged Pipeline, Deliverable Gates, Skills, and Evidence

Date: 2026-06-09
Status: Draft (pending user review)

## Problem

Symphony orchestrates software development tasks, and nearly every executed
issue should end with a pull request — yet runs frequently finish without one.
Recent examples (GAM-3, GAM-5) show the failure class precisely:

- **GAM-3**: the agent created branch `docs/gam-3-pipelines` across 3 repos
  with local commits, but the run was killed (`Issue no longer routed to this
  worker`) before any `git push`. No branch upstream, no PR.
- **GAM-5**: branch `codex/gam-5-cloudflare-docs` committed locally, then the
  run stalled (`319015ms without codex activity`) and was re-dispatched from
  scratch multiple times, losing the "only the push/PR is missing" context.

Structural causes:

1. PR creation is 100% agent-side (workflow markdown + `push` skill). The
   orchestrator applies `completion_transitions` without verifying that a
   branch was published or a PR exists.
2. Retries/stalls restart the run from scratch; committed-but-unpublished work
   is abandoned because the agent has no memory of it.
3. The workpad is a comment convention the agent may or may not follow, and
   for Linear projects comment push is `unsupported_push` — workpads can exist
   only in the local SQLite mirror and never reach the remote tracker.
4. There is no structured concept of execution evidence (test runs, e2e
   results, screenshots/videos). Validation is free text in the workpad at
   best.
5. Failures along these paths are swallowed (`Logger.warning`) and invisible
   in the issue detail UI.

## Requirements (user-validated)

1. **PR**: mandatory whenever the run changed the working tree. If the task
   legitimately requires no changes, no PR — but the no-op decision must be
   recorded.
2. **Workpad**: a start gate (plan + acceptance criteria before
   implementation) and synced to remote trackers (Linear, GitHub, Jira).
3. **Missing PR at the end**: hybrid recovery — corrective agent turn first,
   then a mechanical orchestrator fallback (`git push` + PR creation).
4. **Tests**: a completion gate — executed and green, otherwise back to the
   agent. E2e required when the change touches UI; the agent provisions an
   e2e suite where none exists.
5. **Evidence**: visible in issue detail; e2e runs MUST capture screenshots
   and videos of the execution.

## Approach

Combination of three approaches:

- **(C) Staged pipeline** with persistent checkpoints gives the structure.
- **(A) Run Contract** gives deterministic, orchestrator-verified gates per
  stage.
- **(B) Skills** are the agent-facing interface: each gate has a skill that
  teaches the agent how to satisfy it.

## Section 1 — Architecture: staged pipeline with verified contract

A run stops being "loop turns until the issue changes state" and becomes a
4-stage pipeline. Each stage has: a skill guiding the agent, a deterministic
gate the orchestrator verifies, and state persisted in
`.symphony/run-state.json` inside the workspace.

```
PLAN  →  IMPLEMENT  →  VALIDATE  →  PUBLISH  →  completion_transitions
skill:    skill:        skill:       skill:
workpad   project       evidence     push/finalize
          workflow
gate:     gate:         gate:        gate:
workpad   commits or    evidence     branch pushed
exists    recorded      manifest     + PR exists
in        no-op         green        + PR linked
tracker   decision      (unit+e2e)
```

### Flow rules

- The orchestrator evaluates the current stage's gate **after every turn**.
  Gate satisfied → advance stage, persist to `run-state.json`. Gate violated →
  corrective turn with a focused prompt ("gate X failed because Y; follow
  skill Z").
- **Retry/stall/kill recovery**: on re-dispatch, the orchestrator reads
  `run-state.json` AND re-inspects ground truth in the workspace (git status,
  branch, upstream, PR via forge API) to recompute real deliverable state. The
  continuation prompt states it exactly, e.g. "you are at PUBLISH; branch
  `docs/gam-3-pipelines` has 3 commits, no upstream; publish and open the PR".
  Runs never restart from scratch when committed work exists.
- **No-op path**: if the agent concludes nothing needs to change, it records
  the decision in the workpad (`## Outcome: no-op` section with
  justification). The IMPLEMENT gate accepts clean working tree + recorded
  decision; VALIDATE/PUBLISH are skipped.
- **Mechanical fallback (PUBLISH only)**: after N corrective turns (default 2)
  with commits present but no PR, the orchestrator itself runs `git push` and
  creates the PR (forge-appropriate, e.g. `gh pr create`), generating the PR
  body from the workpad. If even the fallback fails, the issue does NOT
  transition: it gets the `symphony:blocked` label and the error is surfaced
  in issue detail.
- `completion_transitions` runs only once PUBLISH (or the no-op path) is
  satisfied. This eliminates "moved to Human Review without a PR".

### Code placement

- New module `SymphonyElixir.RunContract`: pure, testable gate evaluation —
  input (workspace, issue, project config, forge client), output
  `{:satisfied, stage}` | `{:violation, stage, reason}`.
- `AgentRunner` consults the contract between turns and persists
  `run-state.json`.
- `Orchestrator.apply_normal_completion` gains the final gate + mechanical
  fallback; transitions are conditional on contract satisfaction.

## Section 2 — Skills: the agent's interface to the gates

Each gate has a corresponding skill under `.claude/skills/`. The gate defines
*what* must be true; the skill teaches *how*. The project `workflow_markdown`
becomes thin (domain knowledge for IMPLEMENT); operational knowledge moves to
versioned, reusable skills.

| Skill | Stage | Teaches |
|---|---|---|
| `workpad` (new) | PLAN | Canonical workpad structure: plan, acceptance criteria, Validation section, Outcome section (incl. `## Outcome: no-op`). How to create/update via the project's tracker tool (Linear/GitHub/Jira). |
| `evidence` (new) | VALIDATE | How to run the project's tests (commands from config), how UI-change detection works, how to run/provision e2e (Playwright) with mandatory screenshot/video/trace capture, and how to write `manifest.json` + artifacts under `.symphony/evidence/`. |
| `push` (existing, hardened) | PUBLISH | Push + PR creation. Adds: explicit upstream verification after push, PR body derived from workpad, issue↔PR linking (closing keywords / `linear_graphql` / Jira API), final self-check "does the PR exist and is it linked?". |
| existing skills (`debug`, etc.) | — | Unchanged. |

### Delivery mechanics ("skills are the future")

1. **Stage-scoped prompts.** `PromptBuilder` composes each turn citing the
   current stage and its skill: "You are at stage VALIDATE. Read and follow
   the `evidence` skill." PLAN/VALIDATE/PUBLISH are standardized by Symphony
   skills; IMPLEMENT keeps the project workflow.
2. **Corrective turns cite the skill and the violation.** E.g. "PUBLISH gate
   failed: branch `codex/gam-5-cloudflare-docs` has no upstream. Follow the
   `push` skill from the 'publish branch' step."
3. **Symphony-distributed skills with project override.** Canonical skills
   live in the Symphony repo and are copied/linked into the workspace at
   creation (existing `after_create` hook). A same-named project skill wins,
   enabling per-project customization (e.g. exotic e2e setups).

### Skill ↔ gate contract

Each new skill ends with a "Definition of done" section mirroring literally
what its gate verifies. Gate changes and skill changes ship in the same PR; an
integration test asserts every stage's referenced skill exists.

## Section 3 — Evidence subsystem

### Central artifact: `.symphony/evidence/manifest.json`

Written by the agent (guided by the `evidence` skill), validated by the
orchestrator at the VALIDATE gate.

```json
{
  "issue": "GAM-5",
  "generated_at": "2026-06-09T23:50:00-03:00",
  "ui_change": true,
  "runs": [
    {
      "kind": "unit",
      "repo": "backend",
      "command": "npm test",
      "status": "passed",
      "summary": { "total": 142, "passed": 142, "failed": 0 },
      "report": "artifacts/backend-unit.txt",
      "duration_ms": 48210
    },
    {
      "kind": "e2e",
      "repo": "frontend",
      "command": "npx playwright test --grep @cloudflare",
      "status": "passed",
      "summary": { "total": 4, "passed": 4, "failed": 0 },
      "report": "artifacts/playwright-report/",
      "screenshots": ["artifacts/screens/settings-page.png"],
      "videos": ["artifacts/videos/settings-flow.webm"],
      "trace": "artifacts/trace.zip"
    }
  ]
}
```

### Per-project config (`ProjectConfig`, new `evidence` block)

- `test_command` — unit test command(s) per workspace repo.
- `e2e_command` — e2e command per repo (optional; if absent and the change
  touches UI, the skill instructs the agent to provision Playwright and write
  the specs relevant to the change).
- `ui_paths` — globs defining "change touches UI" (e.g. `frontend/src/**`).
  The orchestrator computes `ui_change` from the diff — it does not depend on
  the agent's judgment.
- `required` — per-repo opt-out of the gate (e.g. a repo with no suite yet);
  default on.

### VALIDATE gate checks

1. Manifest exists and is valid.
2. Every repo with a diff has at least one `unit` run with `status: passed`.
3. If `ui_change: true` (orchestrator-computed via `ui_paths`): an `e2e` run
   exists with `status: passed`.
4. **Mandatory visual capture**: when `ui_change: true`, the e2e run must
   reference at least 1 screenshot AND 1 video that exist on disk. A "passed"
   report alone does not satisfy the gate.
5. All referenced artifact files actually exist in the workspace.
6. **Light anti-fraud**: the orchestrator cross-checks the manifest against
   the Codex session log — each declared command must appear as an executed
   tool call in the session. A fabricated manifest fails the gate.

### Visual capture rules

- The `evidence` skill instructs always-on capture — Playwright:
  `screenshot: 'on'`, `video: 'on'`, `trace: 'on'` (not only on-failure).
- Each e2e spec produces screenshots of the key states of the changed screen
  (before/after where applicable) and the full-flow video.
- The Playwright trace is an artifact too; the Evidence tab links to the trace
  viewer for step-by-step review (DOM, network, console).
- The Playwright config template the skill provides for newly provisioned
  suites ships with capture enabled by default.

### Persistence and display

- On gate pass, the orchestrator copies `.symphony/evidence/` to a per-run
  artifact directory (`<data_dir>/evidence/<project>/<issue>/<run_id>/`) and
  stores the manifest in SQLite (`issue_evidence` table), linked to issue +
  session_id. Survives workspace cleanup.
- **Issue detail gains an "Evidence" tab**: run list with status, counters,
  duration; inline screenshot gallery grouped by spec; video player;
  Playwright report served statically; trace viewer link. History per attempt
  (failed run 1 and passing run 2 both visible).
- **Workpad summary** (Validation section): compact table generated from the
  manifest, with key screenshots embedded (Linear and GitHub accept markdown
  images via upload; `linear_graphql` has an upload flow per the existing
  `linear` skill). The PR body generated at PUBLISH includes the same summary.

## Section 4 — Remote workpad sync + deterministic PR visibility

### Comment push as a required driver capability

Today `Linear.SyncDriver` returns `unsupported_push` for comments. Changes:

- The sync driver behaviour gains `push_comment/3` (create) and
  `update_comment/3` (edit) as first-class outbox operations.
- **Linear**: GraphQL `commentCreate`/`commentUpdate` (the `linear_graphql`
  client already exists).
- **GitHub**: already works via outbox; standardize on the new behaviour.
- **Jira**: no driver exists today — new driver implementing the same
  behaviour (REST `POST/PUT /issue/{key}/comment`). Largest scope item in this
  section; treated as its own sub-phase so it does not block Linear/GitHub.

### Remote workpad semantics

- A single `## Codex Workpad` comment per issue, **edited in place** on every
  update (no comment spam). The outbox stores `remote_comment_id` after the
  first push; subsequent edits become `update_comment`.
- Push failures retry with backoff and are no longer swallowed: issue detail
  shows a sync badge next to the workpad (`synced` / `pending` /
  `failed: <reason>`).

### PR in issue detail — deterministic, not discovered

Fix for "PR does not appear" with identifiers like `GAM-5` (not resolvable as
GitHub issue numbers):

1. At the PUBLISH gate the orchestrator already knows the PR URL (it verified
   or created it). It writes the link directly into `tracker_pull_requests`
   (same path as the existing manual link). The PR appears in the UI the
   moment the gate passes.
2. On the remote tracker the PR becomes a native attachment: **Linear** via
   `attachmentLinkPullRequest` (PR card on the issue), **Jira** via remote
   link, **GitHub** via closing keyword in the PR body (which the mechanical
   fallback already generates).
3. Existing discovery remains as a complement for PRs opened by humans outside
   the flow.

### Visible failures

When any gate exhausts its corrective turns, the issue gets the
`symphony:blocked` label and issue detail shows a banner with the exact
violation (e.g. "PUBLISH: push failed — permission denied") instead of
today's silence.

## Phasing

Each phase ships standalone value:

1. **Phase 1 — Guaranteed PR**: `RunContract` module with IMPLEMENT/PUBLISH
   gates, `run-state.json` checkpointing + deliverable-state continuation
   prompts, corrective turns + mechanical fallback, deterministic PR link in
   issue detail, `symphony:blocked` + violation banner, hardened `push` skill.
2. **Phase 2 — Reliable workpad**: PLAN gate, `workpad` skill, driver
   `push_comment`/`update_comment` (Linear first, GitHub standardized), edited
   in-place remote workpad, sync badge. Jira driver as sub-phase 2b.
3. **Phase 3 — Evidence**: `evidence` block in `ProjectConfig`, `evidence`
   skill, VALIDATE gate (incl. mandatory screenshots/videos and session-log
   anti-fraud check), `issue_evidence` persistence + artifact directory,
   Evidence tab in issue detail, workpad/PR evidence summaries with embedded
   screenshots.

## Error handling summary

| Failure | Behavior |
|---|---|
| Run killed/stalled mid-flight with commits | Re-dispatch resumes at the recorded stage with ground-truth deliverable state in the prompt |
| Gate violated | Corrective turn citing skill + exact violation (max N, default 2 per gate) |
| No PR after corrective turns, commits exist | Mechanical fallback: orchestrator pushes + creates PR from workpad |
| Fallback fails | No transition; `symphony:blocked` label + issue detail banner |
| Workpad push to remote fails | Outbox retry with backoff; sync badge shows `failed: <reason>` |
| Manifest fabricated (commands not in session log) | VALIDATE gate fails; corrective turn |
| Task is a legitimate no-op | `## Outcome: no-op` recorded in workpad; VALIDATE/PUBLISH skipped; transition allowed |

## Testing strategy

- `RunContract` gate evaluation: pure unit tests per gate (fixtures: workspace
  trees with/without commits, upstream, manifest variants).
- `run-state.json` checkpoint/recompute: unit tests for ground-truth
  re-inspection (state file says PUBLISH but workspace has no commits, etc.).
- Mechanical fallback: integration test against a local git remote fixture;
  forge API client mocked.
- Driver `push_comment`/`update_comment`: contract tests per driver (Linear
  GraphQL mocked, GitHub via existing test harness).
- VALIDATE gate: manifest validation matrix incl. missing artifacts, missing
  screenshots/videos with `ui_change: true`, session-log mismatch.
- UI: Evidence tab and sync badge component tests; existing dashboard
  snapshot/evidence harness for visual checks.
- Skill ↔ gate sync: integration test asserting every stage's referenced
  skill file exists.

## Out of scope

- Changing the agent backends (Codex/Claude) themselves.
- CI-side enforcement on the target repos (branch protection, required
  checks) — complementary but external to Symphony.
- Full Jira tracker support beyond comment push + remote link (issue sync for
  Jira is a separate project).
