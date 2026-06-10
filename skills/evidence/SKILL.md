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
- Record everything in `.symphony/evidence/manifest.json` so Symphony's gate
  can verify it. Symphony cross-checks every `command` you declare against the
  session log — only declare commands you actually executed in this session.

## Where commands come from

The project workflow config has an `evidence:` block: `test_command` and
`e2e_command` per repo. Use those commands. If a repo has no e2e suite and the
change touches UI paths, PROVISION one: install Playwright
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

## Manifest format

Write `.symphony/evidence/manifest.json` in the workspace root, with all
artifact paths RELATIVE to `.symphony/evidence/`:

```json
{
  "issue": "GAM-5",
  "generated_at": "2026-06-10T00:00:00-03:00",
  "ui_change": true,
  "runs": [
    {
      "kind": "unit",
      "repo": "backend",
      "command": "npm test -- --watchAll=false",
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
  ]
}
```

Copy real outputs into `.symphony/evidence/artifacts/` (test stdout to a .txt
file, Playwright's `playwright-report/`, `test-results/` screenshots/videos).

## Definition of done (Symphony validate gate)

Symphony verifies ALL of the following; the run cannot finish until they hold:

1. `manifest.json` exists, is valid JSON, and every referenced artifact file
   exists on disk.
2. Every repo with a git diff has a `unit` run with `status: "passed"`.
3. If UI paths changed (computed by Symphony from the project's `ui_paths`
   globs — not from your judgment): an `e2e` run with `status: "passed"`
   including at least 1 screenshot and 1 video.
4. Every declared `command` appears in this session's execution log.

If tests fail: fix the code, re-run, and only then update the manifest.
Never declare a run you did not execute — the gate will reject it.
