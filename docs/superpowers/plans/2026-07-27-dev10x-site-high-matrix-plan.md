# Dev10x Site High-Effort Matrix Implementation Plan

**Goal:** Add and execute a six-cell Dev10x-branded site benchmark for Grok 4.5, Opus 5 and GPT-5.6 Sol at high effort, then publish audited visual evidence and an objective decision in a new PR.

**Architecture:** Extend the existing PR #6 benchmark rather than replacing it. A new `dev10x-brand-high` matrix selects six real Symphony executions, provisioning copies byte-identical brand assets from `tracker/public` into every seed workspace, collection verifies hashes and model provenance, and visual capture adds section-level screenshots to the existing MP4/WebM/trace contract.

**Tech Stack:** Node.js ESM, Symphony Elixir/Phoenix, React/TypeScript/Vite generated sites, Playwright, ffmpeg, Git/GitHub CLI.

---

### Task 1: Define the focused high-effort matrix

**Files:**
- Modify: `benchmarks/landing-page-agent-comparison/src/contract.mjs`
- Modify: `benchmarks/landing-page-agent-comparison/tests/contract.test.mjs`
- Modify: `benchmarks/landing-page-agent-comparison/package.json`

- [x] **Step 1: Write the failing six-cell matrix test**

Add a test that selects `dev10x-brand-high` and expects exactly:

```js
[
  ["session", "codex", "gpt-5.6-sol", "high"],
  ["session", "cursor", "cursor-grok-4.5-high", null],
  ["session", "claude", "claude-opus-5", "high"],
  ["orchestrator", "codex", "gpt-5.6-sol", "high"],
  ["orchestrator", "cursor", "cursor-grok-4.5-high", null],
  ["orchestrator", "claude", "claude-opus-5", "high"],
]
```

Also assert that the six generated ids are unique and the historical matrices
still exist in the full catalog.

- [x] **Step 2: Run the contract test and verify RED**

Run:

```bash
cd benchmarks/landing-page-agent-comparison
node --test tests/contract.test.mjs
```

Expected: FAIL because `dev10x-brand-high` is not defined.

- [x] **Step 3: Implement the new matrix and selector**

Add:

```js
export const DEFAULT_MATRIX = "dev10x-brand-high";

const DEV10X_BRAND_HIGH = Object.freeze({
  codex: Object.freeze({ model: "gpt-5.6-sol", effort: "high" }),
  cursor: Object.freeze({
    model: "cursor-grok-4.5-high",
    effort: null,
  }),
  claude: Object.freeze({ model: "claude-opus-5", effort: "high" }),
});

export function runsForMatrix(matrix, runs = RUN_MATRIX) {
  const selected = runs.filter((run) => run.matrix === matrix);
  if (selected.length === 0) {
    throw new Error(`benchmark matrix has no runs: ${matrix}`);
  }
  return selected;
}
```

Append six frozen run records to `RUN_MATRIX`. Add:

```json
"run:brand-high": "SYMPHONY_BENCH_MATRIX=dev10x-brand-high node src/run-matrix.mjs"
```

- [x] **Step 4: Run the contract test and verify GREEN**

Run: `node --test tests/contract.test.mjs`

Expected: the updated matrix tests pass with six `dev10x-brand-high` cells.

- [x] **Step 5: Commit**

Commit subject:

```text
test(benchmark): define Dev10x high-effort matrix
```

### Task 2: Stage canonical Dev10x assets in every seed

**Files:**
- Modify: `benchmarks/landing-page-agent-comparison/src/provision.mjs`
- Modify: `benchmarks/landing-page-agent-comparison/tests/provision.test.mjs`

- [x] **Step 1: Write failing brand staging tests**

Use a temporary seed root and assert:

```js
const manifest = await stageCanonicalBrandAssets(seedRoot);
assert.equal(manifest.palette.ink, "#0F172A");
assert.equal(manifest.palette.violet, "#7C3AED");
assert.equal(manifest.palette.blue, "#2563EB");
assert.equal(manifest.palette.cyan, "#38BDF8");
assert.equal(manifest.palette.white, "#FFFFFF");
assert.deepEqual(
  Object.keys(manifest.assets).sort(),
  [
    "dev10x_icon.png",
    "dev10x_logo_black.png",
    "dev10x_logo_color.png",
    "dev10x_logo_white.png",
    "favicon.png",
    "favicon.svg",
    "favicons/16x16.png",
    "favicons/180x180.png",
    "favicons/192x192.png",
    "favicons/32x32.png",
    "favicons/512x512.png",
  ],
);
```

For every entry, read `public/dev10x/${relativeName}` and assert its SHA-256
equals the manifest value.

- [x] **Step 2: Run the provision test and verify RED**

Run: `node --test tests/provision.test.mjs`

Expected: FAIL because `stageCanonicalBrandAssets` is missing.

- [x] **Step 3: Implement canonical copy and hashing**

In `provision.mjs`, define the repository root relative to `packageRoot`, then
copy the six top-level brand assets plus `favicons/` from `tracker/public` to
`${seedWorkingPath}/public/dev10x/`. Hash each copied file with Node
`createHash("sha256")`.

Return and persist this shape in `runs.json`:

```js
{
  source: "tracker/public",
  palette: {
    ink: "#0F172A",
    violet: "#7C3AED",
    blue: "#2563EB",
    cyan: "#38BDF8",
    white: "#FFFFFF",
  },
  assets: {
    "dev10x_logo_color.png":
      "5dcd0a5baafec855f5d18f1b125fe2ac739fd2c81ac49c523e657dbe0e51b489",
  },
}
```

Call the staging function after copying `seed/` and before the seed Git commit.

- [x] **Step 4: Make provisioning select only the requested matrix**

Change `buildRunRecords` to accept runs and make `provision` select:

```js
const matrix = env.SYMPHONY_BENCH_MATRIX?.trim() || DEFAULT_MATRIX;
const records = buildRunRecords(prompt, runsForMatrix(matrix));
```

Persist `matrix` and the brand manifest at the top level of `runs.json`.

- [x] **Step 5: Verify GREEN**

Run:

```bash
node --test tests/provision.test.mjs tests/contract.test.mjs
```

Expected: all matrix and provisioning tests pass.

- [x] **Step 6: Commit**

Commit subject:

```text
feat(benchmark): seed canonical Dev10x brand assets
```

### Task 3: Enforce brand integrity during collection

**Files:**
- Modify: `benchmarks/landing-page-agent-comparison/src/collect.mjs`
- Modify: `benchmarks/landing-page-agent-comparison/tests/collect.test.mjs`

- [x] **Step 1: Write failing hash-contract tests**

Create a temporary workspace containing canonical and changed files. Assert:

```js
assert.deepEqual(
  await inspectBrandAssets(workspace, brandManifest),
  {
    passed: true,
    missing: [],
    mismatched: [],
    assets: brandManifest.assets,
  },
);
```

After modifying `dev10x_logo_color.png`, expect `passed: false` and that file in
`mismatched`. After deleting `favicon.svg`, expect it in `missing`.

- [x] **Step 2: Run the collector test and verify RED**

Run: `node --test tests/collect.test.mjs`

Expected: FAIL because `inspectBrandAssets` does not exist.

- [x] **Step 3: Implement the hash contract**

Add `sha256File` and `inspectBrandAssets(workspacePath, brandManifest)`.
`collect()` stores the result as `row.brand` and includes it in
`contract_passed`:

```js
const baseContractPassed = contractPassed(facts.contract);
const brand = await inspectBrandAssets(workspacePath, manifest.brand);
const passed = baseContractPassed && brand.passed;
```

Update `renderComparison` with a `Marca` column that renders `passed` or the
first missing/mismatched asset. Never treat an absent brand manifest as passed.

- [x] **Step 4: Verify GREEN**

Run: `node --test tests/collect.test.mjs`

Expected: all collector tests pass, including missing and changed asset cases.

- [x] **Step 5: Commit**

Commit subject:

```text
feat(benchmark): verify generated Dev10x branding
```

### Task 4: Make the canonical prompt require the real logo and palette

**Files:**
- Modify: `benchmarks/landing-page-agent-comparison/prompt.md`
- Modify: `benchmarks/landing-page-agent-comparison/tests/contract.test.mjs`

- [x] **Step 1: Extend the prompt contract test**

Assert the prompt contains:

```js
assert.match(prompt, /public\/dev10x\/dev10x_logo_color\.png/);
assert.match(prompt, /#0F172A/);
assert.match(prompt, /#7C3AED/);
assert.match(prompt, /#2563EB/);
assert.match(prompt, /#38BDF8/);
assert.match(prompt, /não redesenhe/i);
assert.match(prompt, /id="fluxo"/);
assert.match(prompt, /id="evidencias"/);
```

- [x] **Step 2: Run the contract test and verify RED**

Run: `node --test tests/contract.test.mjs`

Expected: FAIL on the new logo/palette requirements.

- [x] **Step 3: Update the prompt**

Require the visible navigation or hero to use:

```html
<img
  src="/dev10x/dev10x_logo_color.png"
  alt="Dev10x"
/>
```

Allow the black/white variants for contrast, require
`/dev10x/favicon.svg`, and specify the five canonical color values. Explicitly
forbid redrawing, replacing or recoloring the supplied logos. Require stable
`id="visao"`, `id="fluxo"`, `id="agentes"` and `id="evidencias"` sections.

- [x] **Step 4: Verify GREEN**

Run: `node --test tests/contract.test.mjs`

Expected: prompt contract passes with a new shared SHA-256.

- [x] **Step 5: Commit**

Commit subject:

```text
feat(benchmark): require official Dev10x identity
```

### Task 5: Capture detailed site sections and persist them as evidence

**Files:**
- Modify: `benchmarks/landing-page-agent-comparison/src/capture-visuals.mjs`
- Modify: `benchmarks/landing-page-agent-comparison/tests/capture-visuals.test.mjs`

- [x] **Step 1: Write failing visual-name and manifest tests**

Expect `visualScreenshotNames(runId)` to include:

```js
{
  hero: `${runId}-hero.png`,
  flow: `${runId}-flow.png`,
  siteEvidence: `${runId}-site-evidence.png`,
  full: `${runId}-full.png`,
  mobileFull: `${runId}-mobile-full.png`,
  evidenceTab: `${runId}-evidence-tab.png`,
}
```

Expect the E2E manifest to list five site screenshots: hero, flow, site
evidence, full desktop and full mobile.

- [x] **Step 2: Run capture tests and verify RED**

Run: `node --test tests/capture-visuals.test.mjs`

Expected: FAIL because section screenshots are absent.

- [x] **Step 3: Implement section capture**

After the first navigation:

```js
const flow = page.locator("#fluxo");
const evidence = page.locator("#evidencias");
await flow.waitFor({ state: "visible" });
await evidence.waitFor({ state: "visible" });
await flow.screenshot({ path: flowPath });
await evidence.screenshot({ path: siteEvidencePath });
```

Copy both files to the report screen directory, include them in the returned
capture paths and canonical Evidence manifest, and render them inline in
`renderVisualComparison`.

- [x] **Step 4: Strengthen Evidence-tab verification**

Raise the expected rendered screenshot count from two to five while preserving
the two-video requirement. Update the test fixture and error messages.

- [x] **Step 5: Verify GREEN**

Run: `node --test tests/capture-visuals.test.mjs`

Expected: all capture, media and Evidence-tab tests pass.

- [x] **Step 6: Commit**

Commit subject:

```text
feat(benchmark): capture detailed Dev10x site evidence
```

### Task 6: Document the focused execution contract

**Files:**
- Modify: `benchmarks/landing-page-agent-comparison/README.md`
- Modify: `benchmarks/landing-page-agent-comparison/tests/contract.test.mjs`

- [x] **Step 1: Add a failing README contract assertion**

Read the README in `contract.test.mjs` and require:

```js
assert.match(readme, /dev10x-brand-high/);
assert.match(readme, /gpt-5\\.6-sol.*high/s);
assert.match(readme, /cursor-grok-4\\.5-high/);
assert.match(readme, /claude-opus-5.*high/s);
assert.match(readme, /6 células/);
```

- [x] **Step 2: Run the contract test and verify RED**

Run: `node --test tests/contract.test.mjs`

Expected: FAIL because the README describes only the historical matrices.

- [x] **Step 3: Update execution documentation**

Document that `npm run provision` defaults to `dev10x-brand-high`, while
historical reproduction can set another matrix explicitly. Add:

```bash
export SYMPHONY_BENCH_MATRIX=dev10x-brand-high
export SYMPHONY_BENCH_CONCURRENCY=3
npm run provision
npm run run:brand-high
npm run collect
npm run capture:visuals
```

Explain Cursor's encoded high effort and list the six screenshots, MP4/WebM and
trace expected per cell.

- [x] **Step 4: Run all benchmark tests**

Run: `npm test`

Expected: all benchmark tests pass; no full Symphony suite is invoked.

- [x] **Step 5: Commit**

Commit subject:

```text
docs(benchmark): describe Dev10x high matrix
```

### Task 7: Start and verify an isolated real Symphony runtime

**Runtime files (not committed):**
- Runtime root: a new `mktemp -d` directory
- SQLite database: `$SYMPHONY_BENCH_RUNTIME/tracker.sqlite3`
- Workspaces: `$SYMPHONY_BENCH_RUNTIME/workspaces/`
- Results: `$SYMPHONY_BENCH_RUNTIME/results/`
- Artifacts: `$SYMPHONY_BENCH_RUNTIME/artifacts/`

- [x] **Step 1: Verify provider CLIs and model catalogs**

Run only read-only version/catalog probes. Confirm:

- Cursor catalog contains `cursor-grok-4.5-high`;
- Claude catalog contains `claude-opus-5`;
- Codex catalog contains `gpt-5.6-sol` with `high`;
- provider credentials are available without printing secrets.

Record CLI versions in
`$SYMPHONY_BENCH_RUNTIME/report/provider-versions.json`.

- [x] **Step 2: Prepare a dedicated database and server**

Set benchmark-specific `DATABASE_PATH`, `PORT=4010`, token and workspace
environment variables. Run focused migrations and start the Phoenix endpoint in
a persistent PTY. Do not run `make all`.

- [x] **Step 3: Verify the real endpoint**

Run:

```bash
curl -fsS http://127.0.0.1:4010/api/health
```

Expected: HTTP 200 from the dedicated Symphony process.

- [x] **Step 4: Provision exactly six cells**

Run:

```bash
export SYMPHONY_BENCH_MATRIX=dev10x-brand-high
npm run provision
jq -e '.matrix == "dev10x-brand-high" and (.runs | length == 6)' \
  "$SYMPHONY_BENCH_RUNTIME/runs.json"
```

Expected: six runs sharing one prompt hash and one brand manifest.

### Task 8: Execute the real six-cell matrix

**Runtime files (not committed):**
- `$SYMPHONY_BENCH_RUNTIME/results/$RUN_ID.json`
- `$SYMPHONY_BENCH_RUNTIME/results/attempts/$RUN_ID/*.json`
- `$SYMPHONY_BENCH_RUNTIME/artifacts/$RUN_ID/attempts/*`

- [x] **Step 1: Run the matrix with bounded concurrency**

Run:

```bash
SYMPHONY_BENCH_CONCURRENCY=3 npm run run:brand-high
```

Expected: all six cells settle terminally; the command reports every failure
instead of stopping after the first.

- [x] **Step 2: Inspect every result before retrying**

Use `jq` to list status, provider, requested/resolved model, requested/resolved
effort, assistant thread id, attempt id and error. Do not retry a pending run or
replace a provider/model.

- [x] **Step 3: Recover only confirmed failures**

For a real terminal failure, preserve its immutable attempt, correct the
runtime/harness defect with a focused regression test when applicable, and
rerun only that `SYMPHONY_BENCH_RUN_ID`. A missing provider conversation
requires explicit reset; it must not silently create a new one.

The shared timeout contract is 70 minutes for both execution paths, with five
minutes of cleanup headroom at the Playwright, cell-process and matrix-process
boundaries. This replaces the stale 25-minute session-only literal that could
abandon a still-running Claude provider.

- [x] **Step 4: Prove six canonical completions**

Expected result:

```text
6 completed executions
6 matching provider/model provenance contracts
0 fallbacks
0 unresolved or running cells
```

### Task 9: Collect, capture and audit evidence

**Files generated at runtime:**
- `$SYMPHONY_BENCH_RUNTIME/report/comparison.json`
- `$SYMPHONY_BENCH_RUNTIME/report/comparison.md`
- `$SYMPHONY_BENCH_RUNTIME/report/visual-comparison.md`
- `$SYMPHONY_BENCH_RUNTIME/report/screens/*`
- `$SYMPHONY_BENCH_RUNTIME/report/videos/*`
- `$GENERATED_WORKSPACE/.symphony/evidence/manifest.json`

- [ ] **Step 1: Run independent build and E2E collection**

Run: `npm run collect`

Expected: 18 passing validation commands — install, build and focused E2E for
each of six cells — plus six passing brand hash contracts.

- [ ] **Step 2: Capture all visual evidence**

Run: `npm run capture:visuals`

Expected:

- 36 standardized PNGs total, six per cell;
- six WebM files;
- six H.264/yuv420p/fast-start MP4 files;
- six GIF previews;
- six trace ZIP files;
- six real Evidence-tab records rendering at least five images and two videos.

- [ ] **Step 3: Audit media mechanically**

Use `file`, `ffprobe`, `unzip -t`, `sha256sum` and a broken-link scanner. Verify
dimensions, codecs, `faststart`, non-empty traces, byte-identical brand assets,
no symlinks and no paths escaping evidence roots.

- [ ] **Step 4: Inspect screenshots visually**

Open every full desktop/mobile image and the section-level captures. Record
layout clipping, overflow, broken assets, copy problems and brand deviations in
the audit; a visually broken site cannot remain passed.

### Task 10: Publish reports, decision and PR

**Files:**
- Create: `docs/pr-assets/dev10x-site-high-matrix/README.md`
- Create: `docs/pr-assets/dev10x-site-high-matrix/comparison.json`
- Create: `docs/pr-assets/dev10x-site-high-matrix/comparison.md`
- Create: `docs/pr-assets/dev10x-site-high-matrix/execution-report.md`
- Create: `docs/pr-assets/dev10x-site-high-matrix/evidence-audit.md`
- Create: `docs/pr-assets/dev10x-site-high-matrix/evaluation.md`
- Create: `docs/pr-assets/dev10x-site-high-matrix/visual-comparison.md`
- Create: `docs/pr-assets/dev10x-site-high-matrix/screens/*.png`
- Create: `docs/pr-assets/dev10x-site-high-matrix/videos/*.mp4`
- Create: `docs/pr-assets/dev10x-site-high-matrix/videos/*-preview.gif`
- Modify: `docs/superpowers/plans/2026-07-27-dev10x-site-high-matrix-plan.md`

- [ ] **Step 1: Copy only sanitized canonical outputs**

Copy the six-cell comparison, audited PNGs, MP4s and GIF previews. Do not commit
tokens, raw tracker traces, local absolute paths or generated node modules.

- [ ] **Step 2: Score the sites with the fixed rubric**

Score each cell out of 100:

```text
25 brand fidelity
20 visual craft
15 information architecture and copy
20 responsive behavior and accessibility
20 technical quality and evidence
```

Document evidence for every score, rank all six sites, identify the strongest
session and orchestrator outputs, and choose the final winner only now.

- [ ] **Step 3: Run final focused verification**

Run:

```bash
cd benchmarks/landing-page-agent-comparison
npm test
git diff --check
git ls-files | rg -i '(token|secret|credential)' docs/pr-assets/dev10x-site-high-matrix
```

Also verify every Markdown media link resolves to a committed file.

- [ ] **Step 4: Request independent code review**

Review matrix fidelity, asset hashing, failure behavior, evidence counts,
sanitization and the evidence-backed ranking. Resolve all actionable findings.

- [ ] **Step 5: Commit and push**

Create intentional commits for reports/evidence, push
`feat/dev10x-site-matrix-high`, and open a new PR against `main`.

- [ ] **Step 6: Write the PR body in the PR #6 structure**

Include:

- Context, TL;DR, Summary, objective evaluation and alternatives;
- a six-row matrix with requested/resolved provenance and result;
- verified aggregate counts;
- failures and recoveries;
- links to every report;
- inline winner screenshots;
- inline GIF previews linked to all six MP4s;
- Test Plan with commands actually run.

- [ ] **Step 7: Monitor checks and audit the final PR**

Require green applicable checks, a clean branch, remote SHA equality, a
mergeable open PR, valid committed media links and no missing objective
requirement before marking the goal complete.
