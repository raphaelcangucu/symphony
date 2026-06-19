# Evidence Integrity Implementation Plan

**Goal:** Stop agents from passing the VALIDATE gate with fake e2e evidence by adding a harness-observed proof-of-realness check, an independent semantic judge with veto, and an evidence-aware code-review pre-check — all project-agnostic.

**Architecture:** Three layers. (A) `Evidence.Manifest.Run` gains `navigations`/`proof`; `Evidence.Gate` rejects e2e runs with no real navigation (`:synthetic_e2e`) plus optional per-project url/path strictness. (B) A new `Evidence.Judge` runs a one-shot, no-tools, fresh-context model turn (reusing the `SideQuery` pattern) over ticket criteria + git diff + changed test files, returns `:pass | {:fail, reasons} | :none`, caches it in `.symphony/evidence/judge.json`; `Gate` consumes the verdict via an injected dep and emits `:judge_rejected`, keeping the gate pure. (C) The `evidence` skill dispatches the existing superpowers `code-reviewer` with the generated artifacts to review code quality + evidence. Plus: bump default `max_turns` 20 → 30.

**Tech Stack:** Elixir 1.19 / OTP 28, ExUnit (`mix test`), Ecto/Postgres, Jason; Playwright (JS) for the proof fixture; Symphony skills (Markdown).

---

## File Structure

- Modify `elixir/lib/symphony_elixir/instance_config.ex` — default `max_turns` 20 → 30.
- Modify `elixir/lib/symphony_elixir/config.ex` — env-schema default `max_turns` 20 → 30.
- Modify `advising-project.yaml` — `agent.max_turns` 20 → 30.
- Modify `elixir/lib/symphony_elixir/evidence/manifest.ex` — add `navigations`/`proof` to `Run`, parse + validate.
- Modify `elixir/lib/symphony_elixir/evidence/gate.ex` — `:synthetic_e2e`, optional url/path strictness, `:judge_rejected` via injected `judge_verdict` dep, `default_deps/1`.
- Create `elixir/lib/symphony_elixir/evidence/judge.ex` — build prompt, run one-shot model turn, parse + cache verdict (`verdict/2` run-or-read, `read_verdict/1` read-only).
- Modify `elixir/lib/symphony_elixir/agent_handoff_gate.ex` — wire `default_deps(issue:, config:)` into the validate check.
- Modify `elixir/lib/symphony_elixir/agent_runner.ex` — wire judge deps into `validate_evaluator`.
- Modify `elixir/lib/symphony_elixir/assistant/evidence_tools.ex` — read-only verdict reader (no LLM on status probes).
- Modify `elixir/lib/symphony_elixir/orchestrator.ex` — distinct handoff note for `:judge_rejected`.
- Create `automation/playwright/.../symphony-evidence.fixture.js` (advising repo) — generic navigation/proof recorder.
- Modify `.claude/skills/evidence/SKILL.md` — ban substitute evidence, require real navigation, dispatch evidence-aware `code-reviewer`.
- Modify `.claude/skills/superpowers/requesting-code-review/SKILL.md` — evidence-aware variant.
- Tests: `elixir/test/symphony_elixir/{instance_config,config}_test.exs`, `evidence/{manifest,gate,judge}_test.exs`, plus an anchor regression in `evidence/gate_test.exs`.

> Run all Elixir commands from `elixir/`. Format with `mix format` before each commit.

---

### Task 1: Bump default `max_turns` 20 → 30

**Files:**
- Modify: `elixir/lib/symphony_elixir/instance_config.ex:19`
- Modify: `elixir/lib/symphony_elixir/config.ex:16`
- Modify: `advising-project.yaml:117-118`
- Test: `elixir/test/symphony_elixir/instance_config_test.exs`

- [ ] **Step 1: Write the failing test**

Add to `elixir/test/symphony_elixir/instance_config_test.exs`:

```elixir
test "default_max_turns is 30 when unset" do
  assert SymphonyElixir.InstanceConfig.default_max_turns() == 30
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/instance_config_test.exs`
Expected: FAIL — `Assertion with == failed ... left: 20, right: 30`.

- [ ] **Step 3: Bump the constants**

In `elixir/lib/symphony_elixir/instance_config.ex` change:

```elixir
@default_max_turns 30
```

In `elixir/lib/symphony_elixir/config.ex` change:

```elixir
@default_agent_max_turns 30
```

In `advising-project.yaml` under `agent:` change `max_turns: 20` to:

```yaml
    agent:
      max_turns: 30
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `mix test test/symphony_elixir/instance_config_test.exs test/symphony_elixir/config_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/instance_config.ex elixir/lib/symphony_elixir/config.ex advising-project.yaml elixir/test/symphony_elixir/instance_config_test.exs
git commit -m "feat(evidence): raise default agent max_turns 20 -> 30"
```

---

### Task 2: Manifest gains `navigations` + `proof`

**Files:**
- Modify: `elixir/lib/symphony_elixir/evidence/manifest.ex:11-31` (Run struct), `:141-163` (validation + `to_run/1`)
- Test: `elixir/test/symphony_elixir/evidence/manifest_test.exs`

- [ ] **Step 1: Write the failing test**

Add to `elixir/test/symphony_elixir/evidence/manifest_test.exs`:

```elixir
test "parses navigations and proof on an e2e run", %{tmp_dir: ws} do
  manifest =
    valid_manifest()
    |> update_in(["runs"], fn [unit, e2e] ->
      [unit, Map.merge(e2e, %{"navigations" => ["http://cwu.localhost:4302/students"], "proof" => %{"title" => "Student Groups"}})]
    end)

  write_manifest!(ws, manifest)
  touch_artifacts!(ws)

  assert {:ok, %{runs: [_unit, e2e]}} = Manifest.read(ws)
  assert e2e.navigations == ["http://cwu.localhost:4302/students"]
  assert e2e.proof == %{"title" => "Student Groups"}
end

test "navigations defaults to [] and proof to %{} when absent", %{tmp_dir: ws} do
  write_manifest!(ws, valid_manifest())
  touch_artifacts!(ws)
  assert {:ok, %{runs: [_unit, e2e]}} = Manifest.read(ws)
  assert e2e.navigations == []
  assert e2e.proof == %{}
end

test "navigations must be a list of strings", %{tmp_dir: ws} do
  manifest =
    valid_manifest()
    |> update_in(["runs"], fn [unit, e2e] -> [unit, Map.put(e2e, "navigations", "nope")] end)

  write_manifest!(ws, manifest)
  assert {:error, {:manifest_invalid, reasons}} = Manifest.read(ws)
  assert Enum.any?(reasons, &(&1 =~ "navigations"))
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/evidence/manifest_test.exs`
Expected: FAIL — `key :navigations not found` / no `:manifest_invalid` for the bad-type case.

- [ ] **Step 3: Add the fields, parsing, and validation**

In `manifest.ex` extend the `Run` struct defaults (after `trace: nil`):

```elixir
    screenshots: [],
    videos: [],
    trace: nil,
    navigations: [],
    proof: %{}
```

In `to_run/1` add:

```elixir
      navigations: List.wrap(run["navigations"]),
      proof: if(is_map(run["proof"]), do: run["proof"], else: %{})
```

In `run_issues/1` (the `is_map(run)` clause) append a type check so a non-list `navigations` is rejected:

```elixir
  defp run_issues(run) when is_map(run) do
    field_issues =
      @required_run_fields
      |> Enum.reject(&is_binary(run[&1]))
      |> Enum.map(&"run missing required field: #{&1}")

    nav_issues =
      case run["navigations"] do
        nil -> []
        list when is_list(list) -> if Enum.all?(list, &is_binary/1), do: [], else: ["run navigations must be a list of strings"]
        _ -> ["run navigations must be a list of strings"]
      end

    field_issues ++ nav_issues
  end
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `mix test test/symphony_elixir/evidence/manifest_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/evidence/manifest.ex elixir/test/symphony_elixir/evidence/manifest_test.exs
git commit -m "feat(evidence): add navigations/proof contract to manifest Run"
```

---

### Task 3: Gate Layer A — reject synthetic e2e + optional URL strictness

**Files:**
- Modify: `elixir/lib/symphony_elixir/evidence/gate.ex` (`decide/5`, `e2e_violations/2`, `e2e_violation_for/2`, new helpers)
- Test: `elixir/test/symphony_elixir/evidence/gate_test.exs`

- [ ] **Step 1: Update the `e2e/2` test helper so existing runs carry a real navigation**

In `gate_test.exs` change the `e2e/2` helper to include a default real navigation (otherwise every existing "satisfied" test would now trip `:synthetic_e2e`):

```elixir
  defp e2e(repo \\ "frontend", extra \\ []) do
    struct!(
      %Run{
        kind: "e2e",
        repo: repo,
        command: "npx playwright test",
        status: "passed",
        screenshots: ["s.png"],
        videos: ["v.webm"],
        navigations: ["http://localhost:3000/app"]
      },
      Map.new(extra)
    )
  end
```

- [ ] **Step 2: Write the failing tests**

Add to `gate_test.exs`:

```elixir
test "e2e with only synthetic navigation is rejected" do
  d = deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e("frontend", navigations: ["about:blank"])])} end)
  assert {:violations, [%{kind: :synthetic_e2e, repo: "frontend"}]} = Gate.evaluate("/ws", @config, d)
end

test "e2e with empty navigation is rejected" do
  d = deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e("frontend", navigations: [])])} end)
  assert {:violations, [%{kind: :synthetic_e2e, repo: "frontend"}]} = Gate.evaluate("/ws", @config, d)
end

test "e2e with a real navigation is satisfied" do
  d = deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e("frontend", navigations: ["http://localhost:3000/app"])])} end)
  assert :satisfied = Gate.evaluate("/ws", @config, d)
end

test "require_url_pattern rejects a real but off-pattern navigation" do
  config = put_in(@config, [:repos, "frontend", :e2e, :require_url_pattern], "^https?://[^/]+\\.localhost")
  d = deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e("frontend", navigations: ["http://localhost:3000/app"])])} end)
  assert {:violations, [%{kind: :e2e_url_mismatch, repo: "frontend"}]} = Gate.evaluate("/ws", config, d)
end
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `mix test test/symphony_elixir/evidence/gate_test.exs`
Expected: FAIL — new tests get `:satisfied`/`:e2e_missing` instead of `:synthetic_e2e`/`:e2e_url_mismatch`.

- [ ] **Step 4: Implement the Layer-A checks**

In `gate.ex`, thread `repos` into the e2e checks. In `decide/5` change the e2e line:

```elixir
        e2e_violations(manifest, required_ui, repos) ++
```

Replace `e2e_violations/2` and `e2e_violation_for/2` with:

```elixir
  defp e2e_violations(manifest, required_ui, repos) do
    Enum.flat_map(required_ui, &e2e_violation_for(manifest, &1, repos))
  end

  defp e2e_violation_for(manifest, repo, repos) do
    case Enum.find(manifest.runs, &(&1.kind == "e2e" and &1.repo == repo and &1.status == "passed")) do
      nil ->
        case blocked_run(manifest, "e2e", repo) do
          nil -> [%{kind: :e2e_missing, repo: repo, detail: "e2e required for #{repo} but no passing e2e run"}]
          run -> [environment_blocked_violation(repo, "e2e", run)]
        end

      run ->
        visual_violation(run, repo) ++ synthetic_violation(run, repo) ++ url_pattern_violation(run, repo, repos)
    end
  end

  defp visual_violation(run, repo) do
    if run.screenshots != [] and run.videos != [] do
      []
    else
      [%{kind: :visual_capture_missing, repo: repo, detail: "e2e run for #{repo} must include at least 1 screenshot and 1 video"}]
    end
  end

  defp synthetic_violation(run, repo) do
    if Enum.any?(run.navigations, &real_navigation?/1) do
      []
    else
      [%{kind: :synthetic_e2e, repo: repo, detail: "e2e run for #{repo} recorded no real page navigation (page.setContent/about:blank/data: do not count); drive the real flow with page.goto"}]
    end
  end

  defp url_pattern_violation(run, repo, repos) do
    case get_in(repos, [repo, :e2e, :require_url_pattern]) do
      pattern when is_binary(pattern) and pattern != "" ->
        regex = Regex.compile!(pattern)

        if Enum.any?(run.navigations, &(real_navigation?(&1) and Regex.match?(regex, &1))) do
          []
        else
          [%{kind: :e2e_url_mismatch, repo: repo, detail: "e2e for #{repo} must navigate a URL matching #{pattern}"}]
        end

      _ ->
        []
    end
  end

  defp real_navigation?(url) when is_binary(url) do
    trimmed = String.trim(url)
    trimmed != "" and not String.starts_with?(trimmed, "about:") and not String.starts_with?(trimmed, "data:")
  end

  defp real_navigation?(_url), do: false
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `mix test test/symphony_elixir/evidence/gate_test.exs`
Expected: PASS (including all pre-existing gate tests).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/evidence/gate.ex elixir/test/symphony_elixir/evidence/gate_test.exs
git commit -m "feat(evidence): reject synthetic e2e and enforce optional url pattern"
```

---

### Task 4: Gate Layer B — consume the judge verdict (`:judge_rejected`)

**Files:**
- Modify: `elixir/lib/symphony_elixir/evidence/gate.ex` (`default_deps`, `decide/5`, new `judge_violations/2`)
- Test: `elixir/test/symphony_elixir/evidence/gate_test.exs`

> **Build-order note:** `default_deps/1` (Step 3) references `Evidence.Judge.verdict/2`, which is created in Task 5. The gate's own tests inject `judge_verdict` directly and never hit that closure, so `mix test` here passes. If this project compiles with `--warnings-as-errors`, implement Task 5 (create `judge.ex`) **before** this task — the two are independent except for that one reference.

- [ ] **Step 1: Write the failing tests**

In `gate_test.exs`, add `judge_verdict` to the default `deps/1` helper so existing tests stay green:

```elixir
  defp deps(overrides \\ []) do
    Map.merge(
      %{
        read_manifest: fn _ws -> {:ok, manifest([unit("frontend")])} end,
        changed_files: fn _ws -> %{"frontend" => ["src/App.tsx"]} end,
        audit: fn _commands, _opts -> :ok end,
        judge_verdict: fn _ws -> :pass end
      },
      Map.new(overrides)
    )
  end
```

Add the tests:

```elixir
test "judge fail verdict is a violation" do
  d =
    deps(
      judge_verdict: fn _ws -> {:fail, ["e2e does not exercise the diff"]} end,
      read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e()])} end
    )

  assert {:violations, [%{kind: :judge_rejected, detail: detail}]} = Gate.evaluate("/ws", @config, d)
  assert detail =~ "does not exercise the diff"
end

test "judge pass verdict does not block an otherwise green gate" do
  d = deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e()])} end)
  assert :satisfied = Gate.evaluate("/ws", @config, d)
end

test "judge none (unavailable) is non-blocking" do
  d =
    deps(
      judge_verdict: fn _ws -> :none end,
      read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e()])} end
    )

  assert :satisfied = Gate.evaluate("/ws", @config, d)
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `mix test test/symphony_elixir/evidence/gate_test.exs`
Expected: FAIL — `judge fail` returns `:satisfied` (or `KeyError` on `deps.judge_verdict`).

- [ ] **Step 3: Implement the verdict consumption**

In `gate.ex`, add the alias near the top:

```elixir
  alias SymphonyElixir.Evidence.Judge
```

Change `default_deps/0` to `default_deps/1` (keeps `default_deps()` working):

```elixir
  @spec default_deps(keyword()) :: map()
  def default_deps(opts \\ []) do
    base = %{
      read_manifest: &Manifest.read/1,
      changed_files: &GitDiff.changed_files/1,
      audit: fn commands, o -> SessionAudit.verify_commands(commands, o) end,
      judge_verdict: fn _ws -> :none end
    }

    case Keyword.get(opts, :issue) do
      nil -> base
      issue -> Map.put(base, :judge_verdict, fn ws -> Judge.verdict(ws, issue: issue, config: Keyword.get(opts, :config)) end)
    end
  end
```

In `decide/5` add the judge line into the `violations` pipeline (after `e2e_violations`):

```elixir
        e2e_violations(manifest, required_ui, repos) ++
        judge_violations(workspace, deps) ++
```

Add the helper:

```elixir
  defp judge_violations(workspace, deps) do
    case deps.judge_verdict.(workspace) do
      {:fail, reasons} ->
        [%{kind: :judge_rejected, repo: nil, detail: "validation judge rejected the evidence: " <> format_reasons(reasons)}]

      _pass_or_none ->
        []
    end
  end

  defp format_reasons(reasons) when is_list(reasons), do: Enum.join(reasons, "; ")
  defp format_reasons(reason) when is_binary(reason), do: reason
  defp format_reasons(other), do: inspect(other)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `mix test test/symphony_elixir/evidence/gate_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/evidence/gate.ex elixir/test/symphony_elixir/evidence/gate_test.exs
git commit -m "feat(evidence): consume independent judge verdict in the gate"
```

---

### Task 5: `Evidence.Judge` — independent semantic verdict

**Files:**
- Create: `elixir/lib/symphony_elixir/evidence/judge.ex`
- Create: `elixir/test/symphony_elixir/evidence/judge_test.exs`

- [ ] **Step 1: Write the failing tests**

Create `elixir/test/symphony_elixir/evidence/judge_test.exs`:

```elixir
defmodule SymphonyElixir.Evidence.JudgeTest do
  use ExUnit.Case, async: true

  @moduletag :tmp_dir

  alias SymphonyElixir.Evidence.Judge

  defp write_manifest!(ws, content) do
    dir = Path.join(ws, ".symphony/evidence")
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "manifest.json"), content)
  end

  test "parse_verdict handles pass, fail, and garbage" do
    assert Judge.parse_verdict(~s({"verdict":"pass"})) == :pass
    assert Judge.parse_verdict(~s(prefix {"verdict":"fail","reasons":["no nav"]} done)) == {:fail, ["no nav"]}
    assert Judge.parse_verdict("not json at all") == :none
  end

  test "build_prompt includes criteria, diff, and test files" do
    prompt =
      Judge.build_prompt(%{criteria: "AC: email lookup", diff: "+ email column", test_files: [{"a.spec.js", "expect(1)"}]})

    assert prompt =~ "AC: email lookup"
    assert prompt =~ "+ email column"
    assert prompt =~ "a.spec.js"
  end

  test "verdict/2 runs the model, caches it, and reuses the cache", %{tmp_dir: ws} do
    write_manifest!(ws, ~s({"issue":"X","runs":[]}))

    runner = fn _ws, _prompt -> {:ok, ~s({"verdict":"fail","reasons":["does not exercise diff"]})} end
    input_fn = fn _ws -> %{criteria: "c", diff: "d", test_files: []} end

    assert {:fail, ["does not exercise diff"]} = Judge.verdict(ws, runner: runner, input_fn: input_fn)
    assert File.exists?(Path.join(ws, ".symphony/evidence/judge.json"))

    boom = fn _ws, _prompt -> raise "runner should not be called when cache hits" end
    assert {:fail, ["does not exercise diff"]} = Judge.verdict(ws, runner: boom, input_fn: input_fn)
  end

  test "disabled judge returns :none without running", %{tmp_dir: ws} do
    write_manifest!(ws, ~s({"issue":"X","runs":[]}))
    boom = fn _ws, _prompt -> raise "should not run" end
    assert Judge.verdict(ws, config: %{judge: %{enabled: false}}, runner: boom, input_fn: fn _ -> %{} end) == :none
  end

  test "model error yields :none (non-blocking)", %{tmp_dir: ws} do
    write_manifest!(ws, ~s({"issue":"X","runs":[]}))
    runner = fn _ws, _prompt -> {:error, :timeout} end
    assert Judge.verdict(ws, runner: runner, input_fn: fn _ -> %{criteria: "c", diff: "d", test_files: []} end) == :none
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/evidence/judge_test.exs`
Expected: FAIL — `Judge` module does not exist.

- [ ] **Step 3: Create the module**

Create `elixir/lib/symphony_elixir/evidence/judge.ex`:

```elixir
defmodule SymphonyElixir.Evidence.Judge do
  @moduledoc """
  Independent semantic judge for the VALIDATE gate. Runs a one-shot, no-tools,
  fresh-context model turn over the ticket criteria + git diff + changed test
  files and decides whether the tests actually exercise the change. The verdict
  is cached in `.symphony/evidence/judge.json` keyed by the manifest content hash
  so repeated gate evaluations within a run reuse one model call.

  `build_prompt/1` and `parse_verdict/1` are pure and unit-tested; `verdict/2`
  is tested with an injected `:runner`/`:input_fn`.
  """

  require Logger

  alias SymphonyElixir.Codex.CodingAgent
  alias SymphonyElixir.Evidence.{GitDiff, Manifest}

  @verdict_file "judge.json"
  @max_file_bytes 20_000

  @system """
  You are an INDEPENDENT validation judge. You did NOT write this code. Decide
  ONLY whether the provided tests actually exercise the change shown in the diff
  and prove the ticket's acceptance criteria. Be strict: a test that does not
  touch the changed code, or that fabricates a page (e.g. page.setContent)
  instead of driving the real flow, must FAIL.

  Respond with a SINGLE JSON object and nothing else:
  {"verdict":"pass"|"fail","reasons":["short reason", ...]}
  """

  @type verdict :: :pass | {:fail, [String.t()]} | :none

  @spec verdict(Path.t(), keyword()) :: verdict()
  def verdict(workspace, opts \\ []) do
    if judge_enabled?(Keyword.get(opts, :config)) do
      run_or_read(workspace, opts)
    else
      :none
    end
  end

  @spec read_verdict(Path.t()) :: verdict()
  def read_verdict(workspace) do
    with {:ok, raw} <- File.read(verdict_path(workspace)),
         {:ok, %{"verdict" => v} = decoded} <- Jason.decode(raw) do
      to_verdict(v, decoded["reasons"])
    else
      _ -> :none
    end
  end

  @spec build_prompt(map()) :: String.t()
  def build_prompt(%{criteria: criteria, diff: diff, test_files: test_files}) do
    """
    #{@system}

    ## Ticket acceptance criteria
    #{blank_to_dash(criteria)}

    ## Change (git diff)
    #{blank_to_dash(diff)}

    ## Test files added/changed
    #{format_test_files(test_files)}

    Return the JSON verdict now.
    """
    |> String.trim()
  end

  @spec parse_verdict(String.t()) :: verdict()
  def parse_verdict(text) when is_binary(text) do
    with [json] <- Regex.run(~r/\{.*\}/s, text),
         {:ok, %{"verdict" => v} = decoded} <- Jason.decode(json) do
      to_verdict(v, decoded["reasons"])
    else
      _ -> :none
    end
  end

  def parse_verdict(_text), do: :none

  defp run_or_read(workspace, opts) do
    hash_fn = Keyword.get(opts, :hash_fn, &manifest_hash/1)
    hash = hash_fn.(workspace)

    case cached(workspace, hash) do
      {:ok, verdict} ->
        verdict

      :miss ->
        input_fn = Keyword.get(opts, :input_fn, fn ws -> judge_input(ws, Keyword.get(opts, :issue)) end)
        runner = Keyword.get(opts, :runner, &default_runner/2)
        prompt = build_prompt(input_fn.(workspace))

        case runner.(workspace, prompt) do
          {:ok, text} ->
            verdict = parse_verdict(text)
            write_verdict(workspace, hash, verdict, text)
            verdict

          {:error, reason} ->
            Logger.warning("Evidence judge unavailable: #{inspect(reason)}")
            :none
        end
    end
  end

  defp judge_enabled?(%{judge: %{enabled: false}}), do: false
  defp judge_enabled?(_config), do: true

  defp to_verdict("pass", _reasons), do: :pass
  defp to_verdict("fail", reasons), do: {:fail, normalize_reasons(reasons)}
  defp to_verdict(_other, _reasons), do: :none

  defp normalize_reasons(reasons) when is_list(reasons), do: Enum.filter(reasons, &is_binary/1)
  defp normalize_reasons(reason) when is_binary(reason), do: [reason]
  defp normalize_reasons(_other), do: []

  defp verdict_path(workspace), do: Path.join(Manifest.dir(workspace), @verdict_file)

  defp manifest_hash(workspace) do
    case File.read(Path.join(Manifest.dir(workspace), "manifest.json")) do
      {:ok, raw} -> :crypto.hash(:sha256, raw) |> Base.encode16(case: :lower)
      _ -> "no-manifest"
    end
  end

  defp cached(workspace, hash) do
    with {:ok, raw} <- File.read(verdict_path(workspace)),
         {:ok, %{"manifest_hash" => ^hash, "verdict" => v} = decoded} <- Jason.decode(raw) do
      {:ok, to_verdict(v, decoded["reasons"])}
    else
      _ -> :miss
    end
  end

  defp write_verdict(workspace, hash, verdict, raw_text) do
    {v, reasons} =
      case verdict do
        :pass -> {"pass", []}
        {:fail, reasons} -> {"fail", reasons}
        :none -> {"none", []}
      end

    payload = %{"manifest_hash" => hash, "verdict" => v, "reasons" => reasons, "raw" => raw_text}
    File.mkdir_p!(Manifest.dir(workspace))
    File.write!(verdict_path(workspace), Jason.encode!(payload))
  end

  defp judge_input(workspace, issue) do
    %{criteria: issue_criteria(issue), diff: diff_text(workspace), test_files: changed_test_files(workspace)}
  end

  defp issue_criteria(%{} = issue) do
    [Map.get(issue, :title), Map.get(issue, :description) || Map.get(issue, :body)]
    |> Enum.filter(&is_binary/1)
    |> Enum.join("\n\n")
  end

  defp issue_criteria(_issue), do: ""

  defp diff_text(workspace) do
    workspace
    |> SymphonyElixir.RunContract.repo_states()
    |> Enum.map_join("\n", &repo_diff/1)
  end

  defp repo_diff(%{path: path} = repo) do
    base = Map.get(repo, :default_branch)
    args = if is_binary(base), do: ["diff", "origin/#{base}...HEAD"], else: ["diff", "HEAD"]

    case System.cmd("git", args, cd: path, stderr_to_stdout: true) do
      {out, 0} -> out
      _ -> ""
    end
  end

  defp changed_test_files(workspace) do
    repo_paths =
      workspace
      |> SymphonyElixir.RunContract.repo_states()
      |> Map.new(fn r -> {r.name, r.path} end)

    workspace
    |> GitDiff.changed_files()
    |> Enum.flat_map(fn {repo, files} ->
      base = Map.get(repo_paths, repo)
      files |> Enum.filter(&test_file?/1) |> Enum.map(&{&1, read_capped(base, &1)})
    end)
  end

  defp test_file?(path), do: String.contains?(path, "test") or String.contains?(path, "spec")

  defp read_capped(nil, _rel), do: ""

  defp read_capped(base, rel) do
    case File.read(Path.join(base, rel)) do
      {:ok, content} -> String.slice(content, 0, @max_file_bytes)
      _ -> ""
    end
  end

  defp format_test_files([]), do: "(none changed)"

  defp format_test_files(files) do
    Enum.map_join(files, "\n\n", fn {name, content} -> "### #{name}\n```\n#{content}\n```" end)
  end

  defp blank_to_dash(""), do: "(none provided)"
  defp blank_to_dash(nil), do: "(none provided)"
  defp blank_to_dash(text), do: text

  defp default_runner(workspace, prompt) do
    issue = %{id: "evidence:judge", identifier: "judge", title: "Evidence judge"}
    {:ok, collector} = Agent.start_link(fn -> "" end)

    on_message = fn message ->
      delta = extract_delta(message)
      if is_binary(delta) and delta != "", do: Agent.update(collector, &(&1 <> delta))
    end

    opts = [dynamic_tools: [], tool_executor: fn _t, _a -> {:error, :no_tools} end, on_message: on_message]

    try do
      case CodingAgent.run(workspace, prompt, issue, opts) do
        {:ok, _result} -> {:ok, Agent.get(collector, & &1)}
        {:error, reason} -> {:error, reason}
      end
    after
      Agent.stop(collector)
    end
  end

  defp extract_delta(message) when is_map(message) do
    payload = Map.get(message, :payload) || Map.get(message, "payload") || %{}

    get_in(payload, ["params", "delta"]) ||
      get_in(payload, ["params", "text"]) ||
      get_in(payload, ["params", "message", "content"])
  end

  defp extract_delta(_message), do: nil
end
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `mix test test/symphony_elixir/evidence/judge_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/evidence/judge.ex elixir/test/symphony_elixir/evidence/judge_test.exs
git commit -m "feat(evidence): add independent semantic judge module"
```

---

### Task 6: Wire the judge into the gate call sites

**Files:**
- Modify: `elixir/lib/symphony_elixir/agent_runner.ex:173` (inject `:issue` into opts), `:205-208` and `:540-544` (judge-aware evaluators)
- Modify: `elixir/lib/symphony_elixir/agent_handoff_gate.ex:28,39,54-59` (thread issue → judge deps)
- Modify: `elixir/lib/symphony_elixir/assistant/evidence_tools.ex:53` (read-only verdict reader)
- Modify: `elixir/lib/symphony_elixir/orchestrator.ex:1356-1361` (distinct `:judge_rejected` note)
- Test: `elixir/test/symphony_elixir/evidence/gate_test.exs`

- [ ] **Step 1: Write the failing test for the default wiring**

Add to `gate_test.exs`:

```elixir
test "default_deps without an issue yields a non-blocking :none verdict" do
  deps = Gate.default_deps()
  assert deps.judge_verdict.("/ws") == :none
end

test "default_deps with an issue wires a judge_verdict reader" do
  deps = Gate.default_deps(issue: %{identifier: "X", title: "t"}, config: %{judge: %{enabled: false}})
  assert is_function(deps.judge_verdict, 1)
  # judge disabled in config -> :none, proving the closure reaches Judge.verdict
  assert deps.judge_verdict.("/ws") == :none
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/evidence/gate_test.exs`
Expected: FAIL if `default_deps/1` was not yet completed in Task 4 — otherwise these pass immediately and confirm the contract. (If they already pass, proceed; they lock the wiring contract.)

- [ ] **Step 3: Wire `agent_runner.ex`**

At the top of `run_codex_turns/4` body (right after the `def run_codex_turns(workspace, issue, codex_update_recipient, opts) do` line), thread the issue into opts:

```elixir
    opts = Keyword.put_new(opts, :issue, issue)
```

Replace the `validate_evaluator` default (around line 205) with:

```elixir
        validate_evaluator =
          Keyword.get(opts, :validate_gate_evaluator, fn ws ->
            cfg = evidence_config(Keyword.get(opts, :project_config))
            Evidence.Gate.evaluate(ws, cfg, Evidence.Gate.default_deps(issue: Keyword.get(opts, :issue), config: cfg))
          end)
```

Replace the evaluator inside `validate_gate_outcome/2` (around line 540) with the same judge-aware form:

```elixir
  defp validate_gate_outcome(workspace, opts) do
    evaluator =
      Keyword.get(opts, :validate_gate_evaluator, fn ws ->
        cfg = evidence_config(Keyword.get(opts, :project_config))
        Evidence.Gate.evaluate(ws, cfg, Evidence.Gate.default_deps(issue: Keyword.get(opts, :issue), config: cfg))
      end)
```

(Leave the rest of `validate_gate_outcome/2` unchanged.)

- [ ] **Step 4: Wire `agent_handoff_gate.ex`**

Thread the issue through to the verdict deps:

```elixir
  def check(issue, %ProjectConfig{} = config, opts \\ []) do
    workspace = workspace_path(issue, opts)

    with :ok <- check_validate_workspace(workspace, config, issue),
         :ok <- check_publish_workspace(workspace, config) do
      :ok
    end
  end

  def check_validate(issue, %ProjectConfig{} = config, opts \\ []) do
    issue
    |> workspace_path(opts)
    |> check_validate_workspace(config, issue)
  end

  defp check_validate_workspace(workspace, config, issue) do
    cfg = evidence_config(config)

    case Gate.evaluate(workspace, cfg, Gate.default_deps(issue: issue, config: cfg)) do
      :satisfied -> :ok
      {:violations, violations} -> {:error, :validate_gate, violations}
    end
  end
```

- [ ] **Step 5: Wire `evidence_tools.ex` with a read-only reader (no LLM on status probes)**

In `evidence_tools.ex`, replace the gate call (line 53) with:

```elixir
      gate =
        Gate.evaluate(
          workspace,
          evidence_config(config),
          Map.put(Gate.default_deps(), :judge_verdict, &SymphonyElixir.Evidence.Judge.read_verdict/1)
        )
```

- [ ] **Step 6: Distinct orchestrator handoff note for `:judge_rejected`**

In `orchestrator.ex` replace `incomplete_handoff_note({:validate_gate, violations})` with:

```elixir
  defp incomplete_handoff_note({:validate_gate, violations}) do
    cond do
      Evidence.Gate.environment_blocked_only?(violations) ->
        "- The issue was **not** moved to review — required tests could not run in the workspace environment (e.g. no Docker/network). This is an environment blocker, not necessarily a code failure: fix the environment (or sandbox capabilities) and re-dispatch."

      Enum.any?(violations, &(&1.kind == :judge_rejected)) ->
        reasons = violations |> Enum.filter(&(&1.kind == :judge_rejected)) |> Enum.map_join("; ", & &1.detail)
        "- The issue was **not** moved to review — the independent validation judge rejected the evidence (#{reasons}). The tests do not yet prove the change; fix the tests/evidence and re-dispatch."

      true ->
        "- The issue was **not** moved to review — evidence/validation is missing or failing."
    end
  end
```

- [ ] **Step 7: Run the affected suites**

Run: `mix test test/symphony_elixir/evidence/ test/symphony_elixir/agent_runner_test.exs`
Expected: PASS (no regressions; new `default_deps` tests green).

- [ ] **Step 8: Commit**

```bash
git add elixir/lib/symphony_elixir/agent_runner.ex elixir/lib/symphony_elixir/agent_handoff_gate.ex elixir/lib/symphony_elixir/assistant/evidence_tools.ex elixir/lib/symphony_elixir/orchestrator.ex elixir/test/symphony_elixir/evidence/gate_test.exs
git commit -m "feat(evidence): wire judge verdict into runner, handoff gate, and status tool"
```

---

### Task 7: Generic Playwright proof fixture (advising repo)

> **Repo note:** this task lands in the **advising** repo (`automation/playwright`), not the Symphony repo. It is project-agnostic Playwright code; other JS repos can copy it. Symphony itself only reads the `navigations` the agent records into the manifest (Tasks 2–4 already enforce realness).

**Files:**
- Create: `automation/playwright/playwright/e2e/fixtures/symphony-evidence.js`
- Reference: any evidence spec switches its import to this fixture.

- [ ] **Step 1: Create the fixture**

```javascript
// playwright/e2e/fixtures/symphony-evidence.js
// Records the REAL main-frame navigations of each test into a machine file so
// evidence cannot be fabricated with page.setContent(). Copy verbatim into the
// manifest run's `navigations` (see the evidence skill).
const base = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const OUT = process.env.SYMPHONY_NAV_FILE || 'test-results/symphony-navigations.json';

exports.test = base.test.extend({
  page: async ({ page }, use, testInfo) => {
    const navigations = [];

    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      if (url && !url.startsWith('about:') && !url.startsWith('data:')) {
        navigations.push(url);
      }
    });

    await use(page);

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    let all = {};
    try {
      all = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    } catch (_) {
      all = {};
    }
    all[testInfo.titlePath.join(' > ')] = navigations;
    fs.writeFileSync(OUT, JSON.stringify(all, null, 2));
  },
});

exports.expect = base.expect;
```

- [ ] **Step 2: Switch an evidence spec to the fixture**

In an evidence spec, replace `const { test, expect } = require('@playwright/test');` with:

```javascript
const { test, expect } = require('../fixtures/symphony-evidence');
```

(Adjust the relative path to `fixtures/symphony-evidence` for the spec's location.)

- [ ] **Step 3: Manually verify the recorder captures real navigation**

Run a spec that does a real `page.goto(...)`:

```bash
cd automation/playwright && npx playwright test path/to/evidence.spec.js
cat test-results/symphony-navigations.json
```

Expected: the JSON maps the test title to a list containing the real tenant URL(s) navigated (NOT `about:blank`). A spec that only calls `page.setContent(...)` produces `[]` for that test — which Symphony's Layer-A gate now rejects as `:synthetic_e2e`.

- [ ] **Step 4: Commit (in the advising repo)**

```bash
git add automation/playwright/playwright/e2e/fixtures/symphony-evidence.js
git commit -m "test(evidence): record real navigations for Symphony proof contract"
```

---

### Task 8: Project config (`require_url_pattern`) + skills

**Files:**
- Modify: `elixir/lib/symphony_elixir/config.ex` (`parse_e2e/1` passthrough)
- Modify: `advising-project.yaml` (advising e2e `require_url_pattern`)
- Modify: `.claude/skills/evidence/SKILL.md`
- Modify: `.claude/skills/superpowers/requesting-code-review/SKILL.md`
- Test: `elixir/test/symphony_elixir/config_test.exs`

> **Deferred (optional):** the `judge.enabled: false` escape hatch is **not** wired here. The judge is default-on for every project (the `Judge` module treats a missing `:judge` key as enabled), which satisfies "juiz default para todos projetos". Wiring a config knob to *disable* it (evidence schema `judge` key + `extract_evidence_options`) is a later optional follow-up.

- [ ] **Step 1: Write the failing config test**

Add to `elixir/test/symphony_elixir/config_test.exs` inside the `evidence workflow section` describe:

```elixir
test "validate_front_matter passes through e2e require_url_pattern" do
  validated =
    SymphonyElixir.Config.validate_front_matter(%{
      "evidence" => %{
        "required" => true,
        "repos" => %{
          "frontend" => %{
            "ui_paths" => ["src/**"],
            "e2e" => %{"command" => "npx playwright test", "require_url_pattern" => "^https?://[^/]+\\.localhost"}
          }
        }
      }
    })

  assert get_in(validated, [:evidence, :repos, "frontend", :e2e]) == %{
           command: "npx playwright test",
           require_url_pattern: "^https?://[^/]+\\.localhost"
         }
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/config_test.exs`
Expected: FAIL — the result is `%{command: "npx playwright test"}` (pattern dropped).

- [ ] **Step 3: Pass the pattern through `parse_e2e/1`**

In `config.ex` replace:

```elixir
  defp parse_e2e(%{} = e2e), do: e2e_command_map(scalar_string_value(Map.get(e2e, "command")))
  defp parse_e2e(command) when is_binary(command), do: e2e_command_map(scalar_string_value(command))
  defp parse_e2e(_e2e), do: :omit
```

with:

```elixir
  defp parse_e2e(%{} = e2e) do
    case e2e_command_map(scalar_string_value(Map.get(e2e, "command"))) do
      :omit -> :omit
      map -> put_if_present(map, :require_url_pattern, scalar_string_value(Map.get(e2e, "require_url_pattern")))
    end
  end

  defp parse_e2e(command) when is_binary(command), do: e2e_command_map(scalar_string_value(command))
  defp parse_e2e(_e2e), do: :omit
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `mix test test/symphony_elixir/config_test.exs`
Expected: PASS (existing evidence tests still green — `put_if_present` skips the nil case).

- [ ] **Step 5: Set the advising tenant URL pattern**

In `advising-project.yaml`, under the advising repo's `e2e:` block, add `require_url_pattern` (advising serves tenants on `<tenant>.localhost`):

```yaml
          e2e:
            command: "cd automation/playwright && npx playwright test"
            require_url_pattern: "^https?://[^/]+\\.localhost"
```

- [ ] **Step 6: Update the `evidence` skill**

In `.claude/skills/evidence/SKILL.md`, add a `## Real-flow proof (no fakes)` section after the existing e2e/visual-capture guidance:

```markdown
## Real-flow proof (no fakes)

The VALIDATE gate now checks that an e2e actually exercised the change — not just
that screenshots exist:

- **Drive the real flow.** Use `page.goto(<real app/tenant URL>)` and interact
  with the real UI. `page.setContent(...)`, `about:blank`, and `data:` URLs do
  NOT count and are rejected as `:synthetic_e2e`.
- **Record the proof contract.** Import the `symphony-evidence` fixture so the
  harness writes `test-results/symphony-navigations.json`, then copy the real
  URLs into each e2e run's `navigations` (and any key asserted title/selector
  into `proof`) in `.symphony/evidence/manifest.json`.
- **Substitute evidence is a gate violation, not a pass.** Never swap the real
  flow for a preview-health check or a hand-built page to "make the gate green".
  If the real check genuinely cannot run (e.g. tenant DB import fails), record
  the run as `blocked` with a written `blocked_reason` — that is the honest path
  and is not penalized.
- **An independent judge will read your tests.** A separate, fresh-context judge
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
```

- [ ] **Step 7: Update the code-review skill (evidence-aware)**

In `.claude/skills/superpowers/requesting-code-review/SKILL.md`, add a short
`## Evidence-aware review` subsection:

```markdown
## Evidence-aware review

When the change carries evidence (a `.symphony/evidence/manifest.json` with
screenshots/video and a `navigations`/`proof` contract), include it in the
review packet alongside the diff and test files. Ask the reviewer three
questions: (1) is the generated code sound (architecture, correctness, edge
cases)?; (2) do the tests actually prove the ticket?; and (3) does the captured
evidence corroborate the change (real navigated flow, not a fabricated page)?
Treat a fabricated or substitute-evidence finding as Critical.
```

- [ ] **Step 8: Commit**

```bash
git add elixir/lib/symphony_elixir/config.ex elixir/test/symphony_elixir/config_test.exs advising-project.yaml .claude/skills/evidence/SKILL.md .claude/skills/superpowers/requesting-code-review/SKILL.md
git commit -m "feat(evidence): pass e2e require_url_pattern; teach skills real-flow proof"
```

---

### Task 9: Anchor regression — the CDE-1139 fake must be rejected

**Files:**
- Test: `elixir/test/symphony_elixir/evidence/gate_test.exs`

- [ ] **Step 1: Write the regression test**

Add to `gate_test.exs` — encode the exact CDE-1139 failure mode (passing e2e
with screenshots/video but only a synthetic page) and prove both layers catch
it:

```elixir
describe "CDE-1139 regression (synthetic preview-health e2e)" do
  test "fake e2e (setContent only, no navigation) is rejected by Layer A" do
    fake_e2e = e2e("frontend", navigations: [])

    d =
      deps(
        read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), fake_e2e])} end,
        judge_verdict: fn _ws -> :pass end
      )

    assert {:violations, violations} = Gate.evaluate("/ws", @config, d)
    assert Enum.any?(violations, &(&1.kind == :synthetic_e2e))
  end

  test "even a navigated run is vetoed when the judge says tests miss the change" do
    d =
      deps(
        read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e()])} end,
        judge_verdict: fn _ws -> {:fail, ["e2e never asserts the grantee email lookup changed by the diff"]} end
      )

    assert {:violations, violations} = Gate.evaluate("/ws", @config, d)
    assert Enum.any?(violations, &(&1.kind == :judge_rejected))
  end
end
```

- [ ] **Step 2: Run the regression**

Run: `mix test test/symphony_elixir/evidence/gate_test.exs`
Expected: PASS — Layer A flags `:synthetic_e2e`; Layer B flags `:judge_rejected`.

- [ ] **Step 3: Full evidence + format check**

Run: `mix format && mix test test/symphony_elixir/evidence/ test/symphony_elixir/config_test.exs test/symphony_elixir/instance_config_test.exs`
Expected: PASS, no formatting diff.

- [ ] **Step 4: Commit**

```bash
git add elixir/test/symphony_elixir/evidence/gate_test.exs
git commit -m "test(evidence): anchor regression for CDE-1139 synthetic e2e"
```

---

## Self-Review

**1. Spec coverage**

| Spec decision | Task |
| --- | --- |
| D1 orchestrator-owned gate (unchanged ownership) | reuses existing `Gate`/`AgentHandoffGate` — Tasks 3,4,6 |
| D2 harness-observed proof contract | Task 7 (fixture) + Task 2 (`navigations`/`proof`) |
| D3 `Manifest.Run` gains `navigations`/`proof` | Task 2 |
| D4 `:synthetic_e2e`, no duration floor | Task 3 |
| D5 independent fresh-context judge | Task 5 |
| D6 judge consumed via deps, gate stays pure, run-or-read default, read-only status reader | Tasks 4, 6 |
| D7 anti-loop reuses existing corrective budget | Task 6 (no new counter; existing `apply_validate_gate` loop) |
| D8 code-reviewer reviews code + evidence | Task 8 (skills) |
| D9 `blocked` stays honest/unpenalized | Task 8 (evidence skill wording) |
| D10 judge default-on all projects; optional url/path strictness | Task 5 (default-on) + Task 3/Task 8 (`require_url_pattern`) |
| D11 default `max_turns` 20 → 30 | Task 1 |

Deferred (noted, optional): `judge.enabled: false` config knob; `e2e.spec_path_glob` strictness; Symphony reading the fixture nav file directly instead of trusting the manifest field.

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases" — every code step has concrete code; every run step has a command + expected output.

**3. Type consistency:** Verdict type `:pass | {:fail, [String.t()]} | :none` is identical across `Judge` (Task 5), the gate `judge_verdict` dep + `judge_violations/2` (Task 4), and the deps wiring (Task 6). `default_deps/1` (Task 4) is the single arity used by every gating caller (Task 6) and the `:none` default keeps `default_deps()` callers safe. `e2e_violation_for/3` and `e2e_violations/3` arities match the `decide/5` call site (Task 3). Manifest field names `navigations`/`proof` are consistent across Tasks 2, 3, 7, 9.

