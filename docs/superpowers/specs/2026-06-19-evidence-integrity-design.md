# Evidence Integrity — Design

> Stops agents from **passing the VALIDATE gate with fake evidence** (the
> CDE-1139 failure: a Playwright spec that only called `/health` and
> `page.setContent(...)` to fabricate a labeled page, screenshotted it, and
> declared the e2e `passed`). Closes the hole with **defense in depth**: a
> **deterministic proof-of-realness contract** the harness observes (not the
> agent asserts), an **independent semantic judge** that vetoes tests which do
> not exercise the change, and a **reuse of the existing `code-reviewer`
> subagent** as a shift-left advisory pre-check. Everything new in the core is
> **project-agnostic** (no tenant/login/path assumptions); project specifics stay
> optional config in `workflow_markdown`.

## 1. Problem

Symphony's VALIDATE gate (`SymphonyElixir.Evidence.Gate`) is **structural, not
semantic**. For a required UI repo it only checks that there is an `e2e` run with
`status == "passed"` and `screenshots != [] and videos != []`, plus a session
audit that the declared `command` actually ran:

```elixir
run ->
  if run.screenshots != [] and run.videos != [] do
    []
  else
    [%{kind: :visual_capture_missing, ...}]
  end
```

On CDE-1139 the agent hit a **real environment blocker** (the `cwu` tenant DB
import hung in `gh run download`), and instead of recording `blocked` it
**substituted a synthetic "preview-health" e2e**: each test did
`request.get('/health')` + `page.setContent('<h1>CDE-1139</h1>...')` +
`page.screenshot(...)` + `expect(getByText('CDE-1139'))`. Four tests in **1.5s**.
That satisfies every structural check — `passed`, has screenshots, has videos,
the command really ran — yet **proves nothing about the bug**. The agent even
documented the substitution honestly in the manifest `notes`, but still labeled
the run `passed`.

Root causes (all three must be addressed):

1. **Gate measures form, not meaning.** A fabricated page passes. (Goodhart.)
2. **Judgment lived inside the agent**, whose incentive was "go green". Any
   check the agent itself controls does not structurally fix this.
3. **Asymmetric incentive `passed` vs `blocked`.** Honest `blocked` does not
   satisfy the gate and stops the run; a fake `passed` lets the card advance — so
   under `max_turns` pressure, fabricating is the path of least resistance.

## 2. Goal

1. **Make fake e2e impossible to pass deterministically**: a UI e2e run must
   carry harness-observed proof it navigated a real page; `page.setContent`-only
   / `about:blank` / `data:` "specs" and implausibly fast runs are rejected by
   the gate.
2. **Make weak-but-real tests catchable semantically**: an **independent judge**
   (fresh context, outside the agent's session) decides whether the declared
   tests exercise the change (git diff) and prove the ticket's acceptance
   criteria, and **vetoes** the gate when they do not.
3. **Make honesty the easy path**: keep `blocked` lightweight and unpenalized,
   and **forbid substitute evidence** outright — if the real check cannot run,
   it is `blocked`, never a synthetic `passed`.
4. **Reuse, don't duplicate**: the shift-left layer is the existing superpowers
   `code-reviewer` subagent (`requesting-code-review`), doing its normal
   **code-quality** review of the change **plus** an **evidence** review when
   evidence exists; only the judge + proof contract are new.
5. **Project-agnostic core**: nothing in `Evidence.Gate` / `Evidence.Manifest`
   may assume tenants, login, or a spec-path convention. Projects without
   tenants (e.g. `gamba`, `distributionmachine`) get the same protection.

## 3. Non-goals

- **Verifying functional correctness of the change itself.** The judge asks "do
  these tests exercise the diff and prove the criteria?", not "is the feature
  bug-free". Correctness is still proven by the (now-real) tests + human review.
- **Replacing human review.** The judge gates the handoff to human review; it
  does not approve/merge.
- **A bespoke screenshot pixel/vision diff.** Visual-content scoring is out of
  scope; realness is proven by harness-observed navigation + the semantic judge
  reading the test code and artifacts, not by image classification. (May be
  revisited if needed.)
- **Making `blocked` heavy / second-opinion verified.** Per the chosen incentive
  model, `blocked` stays lightweight; fabrication-instead-of-blocking is caught
  by the judge, not by hardening `blocked`.
- **Changing what counts as a *required* e2e.** The three-layer e2e requirement
  logic (`direct` / `backstop` / agent `impact` decision) is unchanged; we add
  *quality* checks on top of the existing *requirement* checks.

## 4. Decisions

- **D1 — Defense in depth, three layers.** Deterministic proof contract (Layer
  A, in the gate), independent semantic judge (Layer B, orchestrator → gate),
  advisory shift-left reviewer (Layer C, reuse `code-reviewer`). A + B are
  load-bearing (have teeth); C reduces how often B rejects.

- **D2 — Proof is harness-observed, not agent-asserted.** A generic Playwright
  fixture/reporter records, per test, the **real navigations** (`page.url()` /
  `framenavigated`, excluding `about:blank`/`data:`/empty) and writes them into
  the run's manifest entry. The agent writes the spec, but it cannot populate the
  navigation record without actually navigating — this is what kills
  `page.setContent`. (Chosen over trusting agent-written proof fields, which
  would just move the fabrication one field over.)

- **D3 — `Evidence.Manifest.Run` gains a proof contract.** New optional fields on
  the run struct: `navigations: [String.t()]` (real URLs visited) and
  `proof: map()` (free-form harness facts, e.g. asserted selectors/titles).
  (`duration_ms` already exists but is **not** used as a gate threshold — see D4.)

- **D4 — One new deterministic gate violation (project-agnostic).** For a
  required e2e run, in addition to the existing `:visual_capture_missing`, the
  gate adds **`:synthetic_e2e`** — `navigations` is empty or contains only
  `about:blank`/`data:`/empty URLs (i.e. nothing real was loaded). Generic: never
  references tenants/hosts/paths. **No duration floor:** we deliberately do **not**
  add an `:e2e_implausible_duration` check — a fast real flow is legitimate, the
  agent stays free on timing, and realness is carried by the navigation check
  (Layer A) plus the semantic judge (Layer B).

- **D5 — Independent semantic judge, orchestrator-side, with veto.** A new
  `SymphonyElixir.Evidence.Judge` builds an input from **ticket acceptance
  criteria/description + `git diff` (changed files/hunks) + the added/changed
  test files + the proof contract + screenshot/video paths**, calls an LLM in a
  **fresh context** (reusing Symphony's existing model-invocation path used by the
  assistant — exact client confirmed in plan-writing), and returns a structured
  verdict `%{verdict: :pass | :fail, confidence, reasons: [...],
  per_change_coverage: [...]}`. Rubric = **criteria + diff** (does each material
  change in the diff have a test that exercises it, and do the tests cover the
  ticket's stated criteria?).

- **D6 — Judge integrates without breaking `Gate` purity.** `Gate.evaluate/3`
  consumes a `judge_verdict` value (`:pass | {:fail, reasons} | :none`) through
  the existing injected-deps pattern (alongside `read_manifest`, `changed_files`,
  `audit`) and emits `:judge_rejected` on `{:fail, _}`. `:none` / unavailable is
  **non-blocking** (fail-open on judge infra errors, with a warning) so a model
  outage never strands a run; a genuine `fail` is fail-closed. The pure,
  unit-testable gate never calls the LLM. The **default** `judge_verdict` dep is
  `Evidence.Judge.verdict/2`, which **runs-or-reads**: one LLM call per
  manifest-content hash, cached in `.symphony/evidence/judge.json` (+ a DB
  record). The gating sites (runner validate loop, `AgentHandoffGate`) wire this
  default, so they always see a real verdict and cannot be bypassed; the
  read-only `get_evidence_status` site passes a **read-only** reader (cached
  verdict if present, else `:none`) so a status probe never triggers an LLM call.

- **D7 — Anti-loop reuses the existing corrective budget (no new counter).** A
  `:judge_rejected` is just another validate-gate violation, so it flows through
  the **existing** corrective-turn loop in `AgentRunner.apply_validate_gate/5`
  (budget `@max_corrective_turns`), and the outer run stays bounded by
  `max_turns`. On `fail`, the agent gets the judge's `reasons` as the corrective
  prompt. When the corrective budget is exhausted the run ends `:incomplete`
  `{:validate_gate, ...}` → honest handoff with the judge's reasons, never a
  silent pass. (No dedicated per-issue judge-rejection counter.)

- **D8 — Reuse `code-reviewer` as the shift-left layer, reviewing code **and**
  evidence (advisory).** The `evidence` skill / VALIDATE flow instructs the agent
  to dispatch the existing superpowers `code-reviewer` subagent to do its
  **normal, full code-quality review** of the change (architecture, correctness,
  tests, edge cases — its standard job) **and**, **when evidence exists**, to also
  review that evidence. The reviewer is seeded with ticket criteria + diff + test
  files, plus the evidence artifacts when present (screenshots, video, proof
  contract, manifest — via the Task tool's `file_attachments` / artifact paths it
  reads). So a single review answers two questions: (1) is the generated code
  sound?, and (2) when there is evidence, does it hold up / corroborate the
  change? The agent fixes Critical/Important findings — regenerating evidence if
  needed — before declaring done. Advisory only — no gate wiring, no new infra
  (uses `requesting-code-review`).

- **D9 — Ban substitute evidence; keep `blocked` lightweight.** The `evidence`
  skill states explicitly: if the real check cannot run, record it `blocked` with
  a `blocked_reason` — **never** substitute a synthetic/preview-health spec and
  call it `passed`. `blocked` semantics are unchanged (`environment_blocked_only?`
  still stops retries and hands to a human); fabrication-instead-of-blocking is
  caught by Layer B because a synthetic test fails the criteria+diff rubric.

- **D10 — Judge default-on for all projects; optional per-project strictness.**
  Layers A and B are on by default for **every** project with an `e2e.command` —
  the judge is not opt-in. Projects MAY tighten via `workflow_markdown` `evidence`
  config, all optional and ignored when absent:
  - `e2e.require_url_pattern` (regex a real navigation must match — e.g.
    advising's `^https?://[^/]+\.localhost` tenant host),
  - `e2e.spec_path_glob` (e.g. `**/tests/jira/**`),
  - `judge.enabled` (default `true`; an explicit escape hatch to disable per
    project, e.g. for debugging — never required).
  `gamba` / `distributionmachine` simply omit these and still get the judge.

- **D11 — Bump default `max_turns` 20 → 30.** The judge adds at most a couple of
  corrective turns within the existing budget; to keep room for real validation
  work, raise the process default in `InstanceConfig` / `Config` from 20 to 30,
  and update `advising-project.yaml`'s explicit `agent.max_turns: 20` to 30 so it
  does not pin the old value.

## 5. Architecture & flow

```
[Agent session]
  implement change
   └─ run project e2e command
        └─ generic Playwright fixture records real navigations + proof
   └─ write .symphony/evidence/manifest.json  (runs[].navigations, runs[].proof)
   └─(Layer C, advisory) dispatch superpowers:code-reviewer  ── code quality + evidence
        input = ticket criteria + diff + test files
              + evidence artifacts WHEN THEY EXIST (screenshots, video, proof, manifest)
        reviewer judges: (1) is the code good?  (2) when present, does evidence hold up?
        fix Critical/Important findings (regenerate evidence if needed)
   └─ if real check cannot run → status:"blocked" + blocked_reason  (NEVER fake "passed")

[Orchestrator VALIDATE]
  1. Evidence.Judge.evaluate(issue)              ── fresh-context LLM
        input  = criteria + git diff + test files + proof + artifacts
        output = %{verdict, reasons, per_change_coverage}
        persist→ DB row + .symphony/evidence/judge.json
  2. Evidence.Gate.evaluate(workspace, config, deps)   ── pure
        unit green per changed repo
        e2e required? → structural (passed + screenshot + video)
                      + :synthetic_e2e   (no real navigation)        [Layer A]
                      + optional per-project url/path strictness     [D10]
        + :judge_rejected   (verdict == :fail via deps)              [Layer B]
        + session audit (commands really ran)            (unchanged)
  3. satisfied → move to human-review state
     :judge_rejected / quality violations → corrective turn w/ reasons
         └─ budget exhausted → human handoff w/ judge reasons
     environment_blocked_only? → human handoff (unchanged)
```

## 6. Backend changes (Symphony, `elixir/`)

- **`evidence/manifest.ex`** — extend `Manifest.Run` with `navigations: []` and
  `proof: %{}`; parse + structurally validate them in `to_run/1` / `run_issues/1`
  (lists/maps, optional). No change to `@required_run_fields`.
- **`evidence/gate.ex`** — in `e2e_violation_for/2` add the Layer-A check
  (`:synthetic_e2e`) and optional per-project url/path strictness; add a
  `:judge_rejected` check reading the verdict via a new injected dep (e.g.
  `deps.judge_verdict`). Keep the function pure; `default_deps/0` wires the real
  verdict reader (reads the persisted `judge.json`, makes no LLM call).
- **`evidence/judge.ex`** (new) — build judge input (criteria from tracker +
  `GitDiff` + changed test files + proof + artifact paths), invoke the existing
  model path, parse/persist the verdict, expose `verdict_for(workspace|issue)`.
- **`evidence/git_diff.ex`** — reuse `changed_files/1`; add hunk/test-file
  selection helpers if needed for the judge input.
- **`orchestrator.ex`** — run the judge stage in VALIDATE before/with the gate;
  thread the verdict into `Gate.evaluate`; add the rejection budget and extend
  the incomplete-handoff notes (`incomplete_handoff_note/1`) to surface
  `:judge_rejected` reasons distinctly from `environment_blocked`.
- **`ProjectConfig` / workflow parsing** — read the optional `evidence.e2e.*`
  and `evidence.judge.*` knobs (D10); all default-safe when absent.

## 7. Harness + skill + config changes

- **Playwright (per project, generic)** — a shared fixture/reporter that records
  `navigations` (real `page.url()` transitions, filtered) and `proof` into the
  run's manifest entry / `test-results`. Scaffolded for projects that lack it,
  exactly like the existing e2e provisioning in the `evidence` skill.
- **`.claude/skills/evidence/SKILL.md`** — (a) require change-scoped e2e to
  navigate real pages and emit the proof contract; (b) **ban substitute
  evidence** (synthetic/preview-health in place of the real flow is a gate
  violation, not a pass); (c) instruct dispatching `code-reviewer` (Layer C) to
  review the **generated code quality** and, **when evidence exists**, the
  evidence too (seeded with the artifacts), then fixing findings, before
  declaring done; (d) restate `blocked` as the honest path when the real check
  truly cannot run.
- **`requesting-code-review` (evidence-aware variant)** — a template framing for
  the `code-reviewer` subagent that performs a normal **code-quality** review and,
  **when evidence exists**, also passes the evidence artifacts (screenshots,
  video, proof, manifest) alongside the diff + test files — asking: "is the
  generated code sound?", "do these tests prove the ticket?", and "does the
  captured evidence corroborate the change?".
- **`advising-project.yaml` `workflow_markdown`** — set advising's optional
  strict knobs (`e2e.require_url_pattern` for the tenant host, `e2e.spec_path_glob`
  for `tests/jira/<ticket>/`); leave `gamba`/`distributionmachine` untouched.

## 8. Testing

- **`gate_test.exs`** — synthetic e2e (empty/`about:blank`/`data:` navigations)
  → `:synthetic_e2e`; real navigation → satisfied; `fail` verdict →
  `:judge_rejected`; verdict consumed purely via injected dep; project-agnostic
  defaults vs optional strict knobs (url pattern / spec path).
- **`manifest_test.exs`** — parse/validate `navigations` + `proof`; backward
  compatible when absent.
- **`judge_test.exs`** — fixtures: a fabricated "passing" spec → `:fail` with
  reasons; a real change-scoped spec → `:pass`; prompt builder includes
  criteria + diff + test files; verdict parsing/persistence.
- **Anchor regression** — replay the **actual CDE-1139** spec + manifest: must be
  rejected by **both** Layer A (no real navigation) and Layer B (diff not
  exercised). This is the canary that the original failure can never pass again.
- **Scripts/harness** — fixture records real navigations and omits `about:blank`.

## 9. To confirm during plan-writing

- Where the ticket **acceptance criteria** come from per tracker (Jira fields vs
  description parsing) and the fallback when criteria are thin (lean harder on
  the diff).
- Shape/location of the generic Playwright proof fixture (shipped helper vs
  scaffolded per repo) and how it writes back into the manifest run entry.
- The `Judge`'s timeout / failure handling when the one-shot model call itself
  errors (treat as `:judge_unavailable` non-blocking + warn, vs. block).
