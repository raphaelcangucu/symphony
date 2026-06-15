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

If tests fail: fix the code, re-run, and only then update the manifest.
Never declare a run you did not execute — the gate will reject it.
