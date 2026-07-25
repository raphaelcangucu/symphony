# Evidence Comment Baseline Stabilization Implementation Plan

**Goal:** Restore the full artifact filename in evidence-comment image alt text while preserving explicit human-readable labels.

**Architecture:** Evidence comments obtain their image label through `Evidence.Manifest.artifact_label/1`. Explicit labels remain authoritative; path-only legacy entries fall back to the basename, including its extension, so Markdown comments retain their established filename contract.

**Tech Stack:** Elixir, ExUnit, Phoenix application modules

---

### Task 1: Preserve extensions in path-derived artifact labels

**Files:**
- Modify: `elixir/lib/symphony_elixir/evidence/manifest.ex:59`
- Test: `elixir/test/symphony_elixir/orchestrator_run_contract_test.exs:92`
- Test: `elixir/test/symphony_elixir/orchestrator_run_contract_test.exs:136`

- [x] **Step 1: Verify the existing regression tests fail**

Run:

```bash
mix test test/symphony_elixir/orchestrator_run_contract_test.exs:92 --trace
mix test test/symphony_elixir/orchestrator_run_contract_test.exs:136 --trace
```

Expected: both tests fail because `home.png` and `Symphony Preview (failed).png` are rendered without `.png`.

- [x] **Step 2: Preserve the complete basename for path-only artifacts**

Replace the path-derived fallback in `artifact_label/1` with:

```elixir
path -> Path.basename(path)
```

Explicit `%ArtifactRef{label: label}` and `%{"label" => label}` clauses remain unchanged.

- [x] **Step 3: Verify the focused tests pass**

Run:

```bash
mix test test/symphony_elixir/orchestrator_run_contract_test.exs
```

Expected: 7 tests, 0 failures.

- [x] **Step 4: Verify the manifest contract remains green**

Run:

```bash
mix test test/symphony_elixir/evidence/manifest_test.exs
```

Expected: 0 failures.

- [x] **Step 5: Commit the isolated correction**

```bash
git add docs/superpowers/plans/2026-07-24-baseline-evidence-comments-plan.md \
  elixir/lib/symphony_elixir/evidence/manifest.ex
git commit -m "fix(evidence): preserve artifact filename labels"
```
