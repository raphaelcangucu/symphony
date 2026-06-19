---
name: evidence
description:
  Run the project's tests (unit always; e2e with mandatory screenshot/video
  capture when UI files changed), then write .symphony/evidence/manifest.json
  referencing the real artifacts. Use during the VALIDATE stage of every issue
  run, before publishing.
---

# Evidence

## Goals

- Prove the change works: unit tests green for every repo you changed.
- When the change touches UI paths, prove it visually: e2e run with at least
  1 screenshot AND 1 video (plus trace) of the affected flow.

## Focused testing (agent validation vs CI)

During VALIDATE, **run only checks that cover what you changed** — not full-repo
lint or unit suites. Leave full regression to CI/CD (GitHub Actions, etc.).

### Scope from git diff first

1. Run `git diff --name-only origin/<integration-branch>...HEAD` (and
   `git status --porcelain`) **per repo you touched**.
2. Only run lint/unit/e2e for repos that appear in the diff.
3. Derive test/lint paths from changed source files (mirror `src/` → `tests/`).

### Per check type

| Check | Do | Don't |
|-------|----|-------|
| **Lint** | ESLint on changed paths only, e.g. `npx eslint --max-warnings 0 src/pages/foo.tsx tests/pages/foo.test.tsx` | `npm run lint` on the whole repo |
| **Unit (frontend)** | `npm run test:unit -- tests/...` matching changed areas | `npm run test:unit` without paths |
| **Unit (backend)** | `./vibe test tests/Feature/MyTest.php` or `--filter=MyTest` for changed/impacted code | `./vibe test` (full Pest suite) when only a few files changed |
| **E2e** | Spec for the affected flow, e.g. `cypress run --spec cypress/e2e/my-flow.cy.ts` | Full e2e matrix |

The gate needs **one** passing `unit` run per changed repo; a scoped run satisfies
that. **Do not** also run the full suite and record a failing unrelated test —
either skip the full suite entirely or omit failed supplementary runs from the
manifest.

### Manifest hygiene

- Include **only** runs you executed in **this** session — never copy a prior
  `manifest.json`.
- One entry per `{kind, repo}` is enough (the passing scoped command).
- Record the **actual scoped command** in the `command` field.
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

Use those commands. If a UI repo has no e2e suite and the change touches its UI
paths, PROVISION one: install Playwright
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

## Manifest format

Write `.symphony/evidence/manifest.json` in the workspace root, with all
artifact paths RELATIVE to `.symphony/evidence/`. Each `e2e` run's `repo` must
be the UI repo it exercises:

```json
{
  "issue": "GAM-5",
  "generated_at": "2026-06-10T00:00:00-03:00",
  "ui_change": true,
  "runs": [
    {
      "kind": "unit",
      "repo": "backend",
      "command": "./vibe test",
      "status": "passed",
      "summary": { "total": 142, "passed": 142, "failed": 0 },
      "report": "artifacts/backend-unit.txt",
      "duration_ms": 48210
    },
    {
      "kind": "e2e",
      "repo": "frontend",
      "command": "npx playwright test",
      "status": "passed",
      "summary": { "total": 4, "passed": 4, "failed": 0 },
      "report": "artifacts/playwright-report/",
      "screenshots": ["artifacts/screens/settings.png"],
      "videos": ["artifacts/videos/settings-flow.webm"],
      "trace": "artifacts/trace.zip"
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
- **Always** use the **project's configured e2e command** (the `e2e.command` in the
  project's `evidence` config / workflow). That command is responsible for reusing the
  issue's preview ports and its isolated e2e database — read the project workflow for the
  exact wrapper, ports, and DB path, as these differ per project.
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
| **Assertion failure** — the command ran and a test/lint check failed | the code | Fix the code, re-run, record `passed`. Use `failed` only if you genuinely cannot make it pass. |
| **Repo tooling/config broken** — the command never ran because something *inside this workspace that you can change* is wrong: a `.symphony/*` or `vibe`/Sail script, a wrong `COMPOSE_PROJECT_NAME`, a missing setup step, file permissions, an installable-but-missing dependency | you (this repo) | **Diagnose and fix it, then re-run.** This is NOT `blocked`. |
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

**Concrete trap:** `./vibe test` prints `Sail is not running`. That *looks* like
"no Docker", but if the containers are actually up under a different compose
project (e.g. Symphony Preview started them as `whitelabel` while `vibe`
defaulted the project name to the worktree directory), the real fix is to
correct the script/compose project — that is bucket 2: **fix it and re-run**, do
NOT record `blocked`.

### Recording a genuine environment block

Only for a real bucket-3 limitation, after an actual attempt (the command MUST
appear in your session log), record the run with `"status": "blocked"` and a
concrete `"blocked_reason"` instead of thrashing on it:

```json
{
  "kind": "unit",
  "repo": "backend",
  "command": "./vibe test",
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

1. Read this skill and run **focused** checks from the git diff (see above).
2. Write a **fresh** `.symphony/evidence/manifest.json` for **this session only**.
3. Update the workpad **Validation** section with commands and outcomes.

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
| First turn in this session; required command not tried yet | Run it; record `passed`, `failed`, or `blocked` |
| Continuation turn; prior manifest has `blocked` for that command **from an earlier turn in this same session** | Retry **once** — sandbox capabilities may differ |
| Same command still `blocked` after one retry in this session | Stop retrying; keep the `blocked` entry with `blocked_reason` |
| All required runs are `passed`, or remaining gaps are only `blocked` after real attempts | **End the turn** — do not burn further turns re-checking git/manifest |
| Manifest satisfied from this session's executed commands | End the turn; do not append more workpad continuation notes |

A `blocked` run after a genuine attempt is a valid handoff state: the code may
be fine but the environment cannot prove it. Say so once in the workpad
**Validation** section and **stop** — humans fix the environment and re-dispatch.

### Anti-patterns (never do these on continuation turns)

```text
❌  git status → node -e 'parse manifest' → workpad "Continuação #9" → Task Complete
❌  npm run test:unit (full suite) + record unrelated failure alongside scoped pass
❌  Copy prior manifest.json without re-running commands this session
❌  Assume "no commits ahead" means "nothing to do" while e2e/backend tests were never run
❌  bare `npx playwright test` on ad-hoc ports instead of the project's configured e2e command
```

```text
✅  git diff → scoped lint/unit → ./vibe up → scoped backend test → project's e2e command → fresh manifest
✅  manage_preview(status) → run the project's configured e2e command (reuses preview + isolated DB)
✅  blocked after real attempt → one-sentence Validation summary → end turn
```

## Definition of done (Symphony validate gate)

Symphony verifies ALL of the following per repo; the run cannot finish until
they hold:

1. `manifest.json` exists, is valid JSON, and every referenced artifact file
   exists on disk.
2. Every repo with a git diff has a `unit` run with `status: "passed"`.
3. e2e is required for a UI repo (an `e2e` run for that repo with
   `status: "passed"` plus at least 1 screenshot and 1 video) when ANY of:
   - its own `ui_paths` changed (deterministic floor, not your judgment); or
   - a changed source repo touched its `contract_paths` and `impacts` that UI
     repo (deterministic backstop, not your judgment); or
   - you declared `impacts_ui: true` for it from a changed source repo.
4. For a changed source repo that `impacts` a UI repo OUTSIDE the contract
   surface: either that UI repo's e2e ran, or the manifest has an `impact`
   decision for that source→UI pair.
5. Every declared `command` appears in this session's execution log.

If tests fail: fix the code, re-run, and only then update the manifest. If a
required command is blocked by fixable repo tooling/config (a `vibe`/`.symphony`
script, a wrong compose project, permissions, a missing setup step), fix that and
re-run — that is NOT `blocked`. Reserve `blocked` (with a `blocked_reason`) for a
genuine environment limitation you cannot fix from inside the workspace (see the
three buckets above), rather than retrying forever. Never declare a run you did
not execute — the gate will reject it.

## Symphony tracker tools (coding agent)

When working inside Symphony (MCP / dynamic tools), prefer structured probes over guessing gate state:

- **`get_evidence_status`** — after writing `.symphony/evidence/manifest.json`, confirm gate state and missing artifacts.
- **`check_handoff_gate`** — before calling `set_issue_status` to a handoff/wait status (e.g. Human Review), verify validate + publish gates.
- **`link_pull_request`** — after opening the PR, attach its URL to the issue so the publish gate and board see the association (origin `manual`).
- **`manage_dev_env`** + **`manage_preview`** — before UI e2e, run configured serve steps (`category_filter: serve`) then start/check preview URLs.

These tools read the same backend as the orchestrator; use them instead of re-parsing manifests by hand on continuation turns.
