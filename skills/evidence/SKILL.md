---
name: evidence
description:
  Use during the VALIDATE stage of issue work that needs unit, e2e, visual, or
  blocked evidence before publishing or handoff.
---

# Evidence

## Goals

- Prove the change works with focused unit evidence for every repo you changed:
  tests you created or modified, plus existing tests directly related to the
  same changed feature/surface.
- When the change touches UI paths, prove it visually: e2e run with full-page
  desktop and mobile screenshots, a browser-compatible MP4 walkthrough, the
  original recorder video, and a trace of the affected flow.
- Tick the issue's acceptance criteria as you prove them: when the issue body
  has an `## Acceptance criteria` checklist, mark each covered `- [ ]` with the
  `update_acceptance_criteria` tool (see "Symphony tracker tools" below). Leave
  a box unchecked when the criterion is not yet demonstrated.

## Slice Evidence vs Final Evidence

For long plan-driven issues, read the `## Codex Workpad` first. If the
`### Plan` checklist still has any `[ ]` or `[~]` task, the scope is not
complete:

- You may record **slice evidence** for the task slice you just changed.
- Persist each completed test command in that slice immediately; do not wait
  for the slice or the full plan to finish.
- Do not treat slice evidence as final handoff evidence.
- Do not set `final_validate_allowed: true`, `final_publish_allowed: true`, or
  `scope_status: complete`.
- Resume implementation at the next incomplete `### Plan` item after the slice
  evidence is recorded.

Run **final evidence** only after every plan task is `[x]` and the workpad's
execution contract says `scope_status: complete`.

## Focused testing (agent validation vs CI)

During VALIDATE, **run only checks that cover what you changed**. Agent
validation and CI have different scopes: the agent proves the changed surface;
CI/CD owns full-repository and cross-repository regression.

### Mandatory test-selection order

1. Run every test file or test case you created or modified.
2. Run existing tests that directly cover the changed component, endpoint,
   domain behavior, dependency boundary, or user flow.
3. Run the smallest focused integration/e2e spec required for the affected
   surface.
4. **Stop.** Do not expand to all tests in the repository, framework, CI job,
   or matrix.

"Same surface" means the same feature and behavior contract you changed — not
every test in the same repository or technical layer. A configured unfiltered
command, a desire for "extra confidence", a delayed CI run, or an imminent
handoff does **not** authorize a full suite.

On WSL, run the selected test files/cases **one at a time, sequentially**.
Never batch, parallelize, repeat in loops, or widen the scope to compensate for
an environment limitation.

### Scope from git diff first

1. Run `git diff --name-only origin/<integration-branch>...HEAD` (and
   `git status --porcelain`) **per repo you touched**.
2. Identify tests created or modified in that diff; these are always first.
3. Map changed source files to directly related existing tests (for example,
   mirror `src/` → `tests/`), then add only same-surface tests with a concrete
   behavioral dependency.
4. Run lint/unit only for changed repos. E2e may additionally target a UI repo
   required by the cross-repo impact rules below.

### Per check type

| Check | Do | Don't |
|-------|----|-------|
| **Lint** | ESLint on changed paths only, e.g. `npx eslint --max-warnings 0 src/pages/foo.tsx tests/pages/foo.test.tsx` | `npm run lint` on the whole repo |
| **Unit (frontend)** | Created/modified tests plus directly related same-surface files, each with an explicit path/filter | `npm run test:unit` without paths |
| **Unit (backend)** | Created/modified tests plus directly related same-surface cases, e.g. `./vibe test tests/Feature/MyTest.php --filter=MyTest` | Bare `./vibe test` / full Pest suite |
| **E2e** | Spec for the affected flow, e.g. `cypress run --spec cypress/e2e/my-flow.cy.ts` | Full e2e matrix |

All selected focused tests must pass. The gate needs at least one passing
`unit` run per changed repo; a scoped run satisfies that. When the environment
requires one command per test file/filter, run them sequentially and record the
focused results. **Do not** also run the full suite "to be safe" or record an
unrelated CI-suite failure — skip the full suite entirely.

| Rationalization | Rule |
|-----------------|------|
| "The workflow says `./vibe test`." | Treat it as the test launcher; append the focused file/filter. |
| "The full suite gives more confidence." | CI owns full regression; local evidence owns the changed surface. |
| "CI has not started yet." | Waiting for CI does not expand agent-validation scope. |

### Persist after every test command

Evidence is incremental, not an end-of-VALIDATE batch:

1. Before the first check, remove stale evidence from prior sessions and
   initialize a fresh manifest for the current session.
2. Run one focused test command.
3. As soon as that command exits or times out, save its stdout/stderr report
   and copy any artifacts. After those files exist, **atomically update**
   `.symphony/evidence/manifest.json` with that run's real status.
4. Only then start the next focused command.

Never wait for all unit/e2e commands to finish before writing evidence. A later
failure or environment block must not erase an earlier passing run; keep prior
entries and add/update only the command that just completed. If the same command
is retried, replace its earlier entry with the latest result instead of
duplicating it.

This ordering preserves partial success if a later command hangs, the agent is
interrupted, or the environment fails. Do not add a planned command to the
manifest before it has actually executed.

### Manifest hygiene

- Include **only** runs you executed in **this** session — never copy a prior
  `manifest.json`.
- Keep one entry per actual focused command. Preserve completed commands across
  later updates; replace only an exact command retry.
- Record the **actual scoped command** in the `command` field.
- For plan-driven workpads, include `task_id` and `task_title` on each run,
  using the current `### Plan` checklist item. This lets the Evidence tab group
  slice evidence by task instead of showing one long chronological list.
- Decide cross-repo impact: when you change a back-end/service repo that the
  config says can impact a UI repo, either run that UI repo's e2e OR record a
  justified `impacts_ui: false` decision in the manifest. Silent skips are a
  gate violation.
- Record everything in `.symphony/evidence/manifest.json` so Symphony's gate
  can verify it. Symphony cross-checks every `command` you declare against the
  session log — only declare commands you actually executed in this session.

## Where commands come from

The project workflow config has a per-repo `evidence:` block:

```yaml
evidence:
  required: true
  repos:
    frontend:                         # a UI repo
      unit_command: "yarn test --run"
      ui_paths: ["src/**", "components/**"]   # repo-relative globs
      e2e: { command: "npx playwright test" }
    backend:                          # a source repo that can affect the UI
      unit_command: "./vibe test"
      impacts: ["frontend"]           # which UI repos this repo can affect
      contract_paths: ["app/Http/**", "routes/**", "graphql/**"]
```

Use configured unit/e2e commands as **launchers**, not as permission to run
their unfiltered CI form. Add the supported test path, case filter, or spec
selector that implements the mandatory selection order above. If a configured
launcher cannot be focused, find the repository's smallest focused target; do
not fall back to the full suite.

If a UI repo has no e2e suite and the change touches its UI paths, PROVISION
one: install Playwright
(`npm init playwright@latest -- --quiet`), write specs covering the changed
screens, and enable capture in `playwright.config.ts`:

```ts
use: {
  screenshot: "on",
  video: "on",
  trace: "on",
},
```

Each spec should screenshot the key states of the changed screen
(`await page.screenshot({ path: "...", fullPage: true })` for before/after
states where applicable).

For a page-level UI change, capture the final real page twice with
`fullPage: true`: once at a desktop viewport and once at a mobile viewport.
Record the walkthrough at a stable desktop viewport, then transcode the
finished WebM without deleting it:

```bash
ffmpeg -y -i flow.webm -c:v libx264 -pix_fmt yuv420p \
  -movflags +faststart -an flow.mp4
```

Reference both video paths and both labeled screenshots in the final manifest
so all four assets appear in the Evidence tab.

Artifact paths must resolve to regular files or real directories below
`.symphony/evidence/`. Never use symlinks, absolute paths, or `..` traversal;
the import boundary rejects them.

## Real-flow proof (no fakes)

The VALIDATE gate checks that an e2e **actually exercised the change** — not just
that screenshots exist:

- **Drive the real flow.** Use `page.goto(<real app/tenant URL>)` and interact
  with the real UI. `page.setContent(...)`, `about:blank`, and `data:` URLs do
  NOT count — the gate rejects them as `:synthetic_e2e`.
- **Record the proof contract.** Import the `symphony-evidence` Playwright
  fixture so the harness writes `test-results/symphony-navigations.json`, then
  copy the real URLs into each e2e run's `navigations` (and any key asserted
  title/selector into `proof`) in `.symphony/evidence/manifest.json`. Some
  projects also set `e2e.require_url_pattern` (e.g. advising's `<tenant>.localhost`)
  — a real navigation must match it.
- **Substitute evidence is a gate violation, not a pass.** Never swap the real
  flow for a preview-health check or a hand-built page to "make the gate green".
  If the real check genuinely cannot run (e.g. tenant DB import fails), record
  the run as `blocked` with a written `blocked_reason` — that is the honest path
  and is not penalized.
- **An independent judge reads your tests.** A separate, fresh-context judge
  compares your test files against the ticket criteria and the git diff. If the
  tests do not exercise the change, it returns `fail` and the gate blocks
  (`:judge_rejected`) with reasons — fix the tests, not the gate.

### Shift-left: dispatch the code-reviewer with the evidence

Before declaring VALIDATE done, dispatch the superpowers `code-reviewer`
subagent (see `requesting-code-review`) to review the **generated code quality**
and, **when evidence exists**, the **evidence** too — pass it the diff + test
files plus the artifacts (screenshots, video, `navigations`/`proof`, manifest).
Fix any Critical/Important findings (regenerating evidence if needed) before
finishing.

## Cross-repo impact (when you changed a back-end/service repo)

For each repo you changed that declares `impacts: [<ui repos>]`:

- If your change touches that repo's `contract_paths` (its API surface with the
  UI), Symphony REQUIRES the impacted UI repo's e2e — you cannot waive it. Run
  it.
- If your change is OUTSIDE the contract surface, YOU decide: run the UI repo's
  e2e if it could affect the UI, OR add an `impact` entry with
  `impacts_ui: false` and a concrete rationale. If you neither run the e2e nor
  record a decision, the gate fails with `impact_assessment_missing`.

### Visual artifact naming (desktop/mobile screenshots + videos)

Each screenshot and video must answer **"what evidence is this?"** for a human
reviewer. Use the **Playwright test title** (or Cypress `it(...)` string) as the
source of truth:

1. **Filename** — kebab-case, issue-prefixed, under `.symphony/evidence/artifacts/`:
   - `artifacts/screens/{ISSUE}-{test-intent-slug}-desktop-full.png`
   - `artifacts/screens/{ISSUE}-{test-intent-slug}-mobile-full.png`
   - `artifacts/videos/{ISSUE}-{test-intent-slug}.webm`
   - `artifacts/videos/{ISSUE}-{test-intent-slug}.mp4`
   - Example: `artifacts/videos/cde-1142-long-share-dialog-header-real-app.webm`
     for a test titled `long share dialog header real app`.
   - Never leave generic names like `video.webm` or `screenshot.png`.
   - Keep Playwright's WebM as the immutable recorder output. Derive an
     MP4/H.264 copy with `yuv420p` and fast-start metadata for reliable browser,
     PR, and mobile playback; never replace or relabel the WebM source.

2. **Manifest entry** — prefer labeled objects (plain path strings still work,
   but objects are required when one e2e command runs multiple specs):

```json
"videos": [
  {
    "path": "artifacts/videos/cde-1142-long-share-dialog-header-real-app.webm",
    "label": "long share dialog header real app",
    "navigations": [
      "http://cwu.localhost:4300/health",
      "http://cwu.localhost:4300/login",
      "http://cwu.localhost:4300/advisor/9006610/get-assigned-advisors"
    ]
  }
]
```

3. **Per-test navigations** — copy from `test-results/symphony-navigations.json`
   (keyed by Playwright `testInfo.titlePath`) into each artifact's
   `navigations`, not only at the run level. The Evidence tab shows intent +
   page flow per screenshot/video.

4. **Screenshots in specs** — pass the same slug when calling `page.screenshot`:

```ts
await page.screenshot({
  path: ".symphony/evidence/artifacts/screens/cde-1142-long-share-dialog-header-real-app.png",
  fullPage: true,
});
```

## Manifest format

Write `.symphony/evidence/manifest.json` in the **workspace root** (the parent
of the repo checkouts), with all artifact paths RELATIVE to `.symphony/evidence/`.
**Do NOT write it inside a repo's own `.symphony/`** (some repos — e.g.
`clouapp/back` — ship their own `.symphony/` tooling; nesting evidence there gets
it committed into the PR and hides it from Symphony's Evidence tab). Each `e2e`
run's `repo` must be the UI repo it exercises:

```json
{
  "issue": "GAM-5",
  "generated_at": "2026-06-10T00:00:00-03:00",
  "ui_change": true,
  "runs": [
    {
      "task_id": "task-3",
      "task_title": "Task 3: Add Tasks, Review, And Runs Namespace",
      "kind": "unit",
      "repo": "backend",
      "command": "./vibe test tests/Feature/MyTest.php --filter=MyTest",
      "status": "passed",
      "summary": { "total": 1, "passed": 1, "failed": 0 },
      "report": "artifacts/backend-unit.txt",
      "duration_ms": 48210
    },
    {
      "kind": "e2e",
      "repo": "frontend",
      "command": "npx playwright test tests/e2e/settings.spec.ts",
      "status": "passed",
      "summary": { "total": 1, "passed": 1, "failed": 0 },
      "report": "artifacts/playwright-report/",
      "screenshots": [
        {
          "path": "artifacts/screens/gam-5-settings-desktop-full.png",
          "label": "settings page renders for tenant admin — desktop full page",
          "navigations": ["http://gam.localhost:4300/settings"]
        },
        {
          "path": "artifacts/screens/gam-5-settings-mobile-full.png",
          "label": "settings page renders for tenant admin — mobile full page",
          "navigations": ["http://gam.localhost:4300/settings"]
        }
      ],
      "videos": [
        {
          "path": "artifacts/videos/gam-5-settings-flow.webm",
          "label": "settings page renders for tenant admin — WebM source",
          "navigations": ["http://gam.localhost:4300/settings"]
        },
        {
          "path": "artifacts/videos/gam-5-settings-flow.mp4",
          "label": "settings page renders for tenant admin — MP4 H.264",
          "navigations": ["http://gam.localhost:4300/settings"]
        }
      ],
      "trace": "artifacts/trace.zip",
      "navigations": ["http://gam.localhost:4300/settings"],
      "proof": { "title": "settings page renders for tenant admin" }
    }
  ],
  "impact": [
    {
      "from": "backend",
      "to": "frontend",
      "impacts_ui": false,
      "rationale": "Internal queue worker refactor; no API/GraphQL surface changed, so the frontend flows are unaffected."
    }
  ]
}
```

`impact` is OPTIONAL — include an entry only for a changed source repo where you
chose NOT to run an impacted UI repo's e2e. `impacts_ui: false` requires a
non-empty `rationale`.

Copy real outputs into `.symphony/evidence/artifacts/` (test stdout to a .txt
file, Playwright's `playwright-report/`, `test-results/` screenshots/videos).

## Symphony preview vs Playwright e2e (do not collide)

When a project runs Symphony preview dev servers (typical ports **4200–4299**):

- **First** call **`manage_preview`** with `action: status` (or `start` / `restart`).
  Read `local_url` and `port` for each server in the tool response.
- **Always** use the **project's configured e2e launcher** (the `e2e.command`
  in the project's `evidence` config / workflow) **plus its supported
  spec/filter selector for the affected flow**. Preserve the configured wrapper
  because it reuses the issue's preview ports and isolated e2e database — read
  the workflow for the exact wrapper, selector syntax, ports, and DB path.
- **Never** run bare `npx playwright test` on ad-hoc ports (e.g. 4310) — that bypasses
  preview wiring and causes webServer timeouts.
- Do **not** kill Symphony preview band ports (or set any preview-kill override) unless a
  human explicitly asked you to tear down preview.

## When a check fails: fix it, or (only if truly external) mark it `blocked`

When a required command does not pass, first decide **who owns the blocker** —
the three buckets are treated very differently, and only the last one is
`blocked`:

| Failure | Owner | What you do |
|---------|-------|-------------|
| **Assertion failure** — the command ran and a test/lint check failed | the code | Record `failed` immediately, fix the code, re-run, then replace that command entry with the latest result. |
| **Repo tooling/config broken** — the command never ran because something *inside this workspace that you can change* is wrong: a `.symphony/*` or `vibe`/Sail script, a wrong `COMPOSE_PROJECT_NAME`, a missing setup step, file permissions, an installable-but-missing dependency | you (this repo) | Record the attempt as `failed`, diagnose and fix it, then re-run. This is NOT `blocked`. |
| **Platform/sandbox limitation** — the command cannot run here no matter what you change: no Docker daemon, no network to fetch modules/browsers, a sandbox that blocks the browser's own sandbox | the environment | Record `blocked` + a concrete `blocked_reason` and hand off. |

Retrying the same command will never succeed for bucket 3; it WILL succeed for
buckets 1 and 2 once you fix the cause — so those are work you must do, not
blockers.

### Why the label matters

A `blocked` run makes Symphony **stop spending corrective turns**: it annotates
the run as `environment_blocked` (a human-actionable "fix the environment and
re-dispatch" signal) and waits for a person. A `failed`/missing run instead gets
corrective turns that push you to fix and re-run. So labeling a fixable,
repo-owned problem as `blocked` **suppresses the self-heal loop** and strands the
issue on a human for something you could have fixed yourself.

**Concrete trap:** a focused `./vibe test tests/Feature/MyTest.php` prints
`Sail is not running`. That *looks* like "no Docker", but if the containers are
actually up under a different compose project (e.g. Symphony Preview started
them as `whitelabel` while `vibe` defaulted the project name to the worktree
directory), the real fix is to correct the script/compose project — that is
bucket 2: **fix it and re-run**, do NOT record `blocked`.

### Recording a genuine environment block

Only for a real bucket-3 limitation, after an actual attempt (the command MUST
appear in your session log), record the run with `"status": "blocked"` and a
concrete `"blocked_reason"` instead of thrashing on it:

```json
{
  "kind": "unit",
  "repo": "backend",
  "command": "./vibe test tests/Feature/MyTest.php --filter=MyTest",
  "status": "blocked",
  "blocked_reason": "Docker daemon unreachable at /var/run/docker.sock; no container runtime exists in this sandbox, so Sail cannot start at all.",
  "report": "artifacts/backend-unit.txt"
}
```

A `blocked` run does NOT satisfy the gate — the change is still unproven. Use
`blocked` ONLY for a true platform limitation you actually hit and cannot fix
from inside the workspace. Do not use `blocked` to skip work you could have done.

## Continuation turns — agent responsibility

Symphony may schedule **continuation turns** when the issue stays active after a
turn completes. **You** must decide what to do next — do not assume the
orchestrator will stop you from wasting turns.

### Detect VALIDATE-only mode

When **every** repo in the deliverable summary shows `commits_ahead=0`,
`uncommitted=no`, and `pushed=yes`, implementation and publish are done. The
only remaining work is **VALIDATE/evidence** (unless the ticket explicitly asks
for code changes).

In VALIDATE-only mode:

1. Read this skill and derive **focused** checks from the git diff (see above).
2. Initialize a **fresh** `.symphony/evidence/manifest.json` for this session.
3. Run checks sequentially and update the manifest/artifacts immediately after
   each command, preserving prior partial successes.
4. Update the workpad **Validation** section with commands and outcomes.

**Do not** treat a continuation turn as a status-check loop:
- Do not only run `git status`, parse an old manifest, and append "Continuação
  #N" notes to the workpad.
- Do not re-validate a prior session's manifest as a substitute for executing
  tests in this turn.
- Do not run the full lint or unit suite when scoped paths suffice.

If rework or the human asked for **fresh evidence**, delete
`.symphony/evidence/manifest.json` and artifacts from prior attempts **before**
running checks — stale `blocked` entries are not evidence for this session.

### When to retry vs when to stop

| Situation | Action |
|-----------|--------|
| First turn in this session; required focused command not tried yet | Run it; record `passed`, `failed`, or `blocked` |
| Continuation turn; prior manifest has `blocked` for that focused command **from an earlier turn in this same session** | Retry **once** — sandbox capabilities may differ |
| Same focused command still `blocked` after one retry in this session | Stop retrying; keep the `blocked` entry with `blocked_reason` |
| All required runs are `passed`, or remaining gaps are only `blocked` after real attempts | **End the turn** — do not burn further turns re-checking git/manifest |
| Manifest satisfied from this session's executed commands | End the turn; do not append more workpad continuation notes |

A `blocked` run after a genuine attempt is a valid handoff state: the code may
be fine but the environment cannot prove it. Say so once in the workpad
**Validation** section and **stop** — humans fix the environment and re-dispatch.

### Anti-patterns (never do these on continuation turns)

```text
❌  git status → node -e 'parse manifest' → workpad "Continuação #9" → Task Complete
❌  Run several tests first and write the manifest only after the whole batch finishes
❌  npm run test:unit (full suite) + record unrelated failure alongside scoped pass
❌  Run a bare configured `unit_command` after focused same-surface tests already passed
❌  Copy prior manifest.json without re-running commands this session
❌  Assume "no commits ahead" means "nothing to do" while e2e/backend tests were never run
❌  bare `npx playwright test` on ad-hoc ports instead of the project's configured e2e command
```

```text
✅  git diff → fresh manifest → focused test 1 → persist → focused test 2 → persist
✅  ./vibe up → ./vibe test tests/Feature/MyTest.php --filter=MyTest → persist immediately
✅  manage_preview(status) → configured e2e launcher + affected spec/filter (reuses preview + isolated DB)
✅  blocked after real attempt → one-sentence Validation summary → end turn
```

## Definition of done (Symphony validate gate)

Symphony verifies ALL of the following per repo; the run cannot finish until
they hold:

1. `manifest.json` exists, is valid JSON, every referenced artifact exists
   below `.symphony/evidence/`, and none is a symlink.
2. Every repo with a git diff has a `unit` run with `status: "passed"`.
3. e2e is required for a UI repo (an `e2e` run for that repo with
   `status: "passed"` plus a full-page desktop screenshot, a full-page mobile
   screenshot, the original recorder video, an MP4/H.264 `yuv420p` fast-start
   copy, and a trace) when ANY of:
   - its own `ui_paths` changed (deterministic floor, not your judgment); or
   - a changed source repo touched its `contract_paths` and `impacts` that UI
     repo (deterministic backstop, not your judgment); or
   - you declared `impacts_ui: true` for it from a changed source repo.
4. For a changed source repo that `impacts` a UI repo OUTSIDE the contract
   surface: either that UI repo's e2e ran, or the manifest has an `impact`
   decision for that source→UI pair.
5. Every declared `command` appears in this session's execution log.
6. The final manifest is persisted for the current `issue_session` or
   `issue_execution` and the resulting Evidence-tab record is re-read before
   handoff. A workspace-only manifest is not final evidence. Confirm that the
   persisted record exposes both screenshots, both video formats, and the
   trace; if the import or re-read fails, validation is incomplete.

If a test fails, record that failed execution immediately, then fix the code and
re-run the same focused command; the rerun replaces that command's prior entry
with its latest real result. If a required command is blocked by fixable repo
tooling/config (a `vibe`/`.symphony` script, a wrong compose project,
permissions, a missing setup step), record the attempt as `failed`, fix it, and
re-run — that is NOT `blocked`. Reserve `blocked` (with a `blocked_reason`) for
a genuine environment limitation you cannot fix from inside the workspace (see
the three buckets above), rather than retrying forever. Never declare a run you
did not execute — the gate will reject it.

## Symphony tracker tools (coding agent)

When working inside Symphony (MCP / dynamic tools), prefer structured probes over guessing gate state:

- **`get_evidence_status`** — after each manifest update, confirm the accumulated
  gate state and missing artifacts without discarding partial successes.
- **`update_acceptance_criteria`** — when the issue body has an `## Acceptance criteria` checklist (`- [ ]`), tick each criterion your evidence covers. Read with no args (returns 1-based `index`, `text`, `checked`), then mark by `index` or `text`. It edits ONLY those acceptance checkboxes — never prose or Plan/Tasks boxes — so prefer it over `update_issue`/`gh issue edit`. Leave a box unchecked when the criterion is not yet proven.
- **`check_handoff_gate`** — before calling `set_issue_status` to a handoff/wait status (e.g. Human Review), verify validate + publish gates.
- **`link_pull_request`** — after opening the PR, attach its URL to the issue so the publish gate and board see the association (origin `manual`).
- **`manage_dev_env`** + **`manage_preview`** — before UI e2e, run configured serve steps (`category_filter: serve`) then start/check preview URLs.

These tools read the same backend as the orchestrator; use them instead of re-parsing manifests by hand on continuation turns.
