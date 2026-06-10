# Run Contract Phase 3: Evidence — Implementation Plan

**Goal:** Test and e2e evidence becomes a completion gate: the agent writes `.symphony/evidence/manifest.json` + artifacts (reports, screenshots, videos, traces); the orchestrator validates it (unit green per changed repo, e2e + mandatory visual capture when UI paths changed, commands cross-checked against the Codex session log), persists it durably, surfaces it in a new "Evidence" tab, and posts a `## Codex Evidence` comment to the remote issue.

**Architecture:** New `SymphonyElixir.Evidence` namespace: `Manifest` (read/validate), `GitDiff` (changed files vs merge-base → `ui_change`), `SessionAudit` (anti-fraud vs Codex rollout JSONL), `Store` (durable copy + SQLite `issue_evidence`), and `Gate` (the VALIDATE decision). `AgentRunner` runs the VALIDATE gate before the publish gate (same corrective-turn machinery from Phase 1). The orchestrator persists evidence on success and renders the remote evidence comment via Phase 2's `comment` outbox. Web: `EvidenceController` (JSON + artifact file serving) + `EvidenceTab` in the issue drawer.

**Tech Stack:** Elixir/OTP (ExUnit), Ecto/`ecto_sqlite3`, Phoenix (`Conn.send_file/3` per `AssistantController.show_attachment` precedent), React/TypeScript (vitest), Playwright on target projects.

**Spec:** `docs/superpowers/specs/2026-06-09-run-contract-design.md` (Section 3 + evidence comment). Depends on Phase 1 (corrective-gate machinery in `AgentRunner`, orchestrator contract hook) and Phase 2 (`comment:create|update` outbox push for the remote evidence comment).

**Scope note (deviation from spec, documented):** screenshots embedded in the remote evidence comment are markdown image links pointing at Symphony-served artifact URLs in this phase. Native uploads to Linear/Jira (upload flows) are deferred to a follow-up (3b) — the comment content and storage layer are upload-ready (stable artifact paths).

**Key facts from the codebase (verified):**
- Config schema: NimbleOptions `@workflow_options_schema` in `elixir/lib/symphony_elixir/config.ex` (lines 87–279; `dev_server` example at 252–266), bridged by `extract_workflow_options/1` (913–926); per-project resolution in `ProjectConfig.resolve/1` via `front_matter_section/2`.
- Migrations: `elixir/priv/repo/migrations/` (`YYYYMMDDHHMMSS_*.exs`); schema/changeset pattern: `tracker/sync/pull_request_record.ex`.
- Durable data dir: `.symphony/` under `Application.get_env(:symphony_elixir, :root_dir, File.cwd!())` (see `Config.local_database_path/0`, lines 335–362).
- Session log: `Codex.SessionLog.resolve_rollout_path/2`, `read_from/2`, `parse_line/1`; tool calls appear as `%{"kind" => "tool_call", "title" => "exec_command", "body" => <json args with "cmd">}`.
- Controller pattern: `pull_request_controller.ex`; routes in `router.ex` scope `/api/tracker/v1` (lines 88–92); file serving precedent: `AssistantController.show_attachment/2` + `AttachmentStore.resolve_path/2` (path traversal guard).
- Drawer tabs: `TABS` in `tracker/src/components/issues/IssueDrawer.tsx:53-62` AND `ISSUE_TABS` in `tracker/src/lib/workspaceRoutes.ts:5`.
- No git-diff util exists in `lib/`; pattern to follow: `SymphonyElixir.LocalTracker.Git` (`System.cmd("git", ...)`).
- Workspaces are multi-repo (subdirs with `.git`); `.symphony/` in the workspace is established (codex-session.json, skills).

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `elixir/lib/symphony_elixir/config.ex` | Modify | `evidence` block in workflow schema |
| `elixir/lib/symphony_elixir/project_config.ex` | Modify | `:evidence` field |
| `elixir/lib/symphony_elixir/evidence/git_diff.ex` | Create | Changed files vs merge-base; `ui_change?/2` |
| `elixir/lib/symphony_elixir/evidence/manifest.ex` | Create | Parse + structural validation of manifest.json |
| `elixir/lib/symphony_elixir/evidence/session_audit.ex` | Create | Commands in manifest ⊆ commands executed in session |
| `elixir/lib/symphony_elixir/evidence/gate.ex` | Create | VALIDATE decision (pure) |
| `elixir/lib/symphony_elixir/evidence/store.ex` | Create | Durable artifact copy + DB persistence + path resolution |
| `elixir/priv/repo/migrations/<ts>_create_issue_evidence.exs` | Create | `issue_evidence` table |
| `elixir/lib/symphony_elixir/evidence/record.ex` | Create | Ecto schema |
| `elixir/lib/symphony_elixir/agent_runner.ex` | Modify | VALIDATE gate before publish gate |
| `elixir/lib/symphony_elixir/orchestrator.ex` | Modify | Persist evidence + remote evidence comment on completion |
| `elixir/lib/symphony_elixir_web/controllers/tracker/evidence_controller.ex` | Create | JSON list + artifact serving |
| `elixir/lib/symphony_elixir_web/router.ex` | Modify | Routes |
| `tracker/src/{types,services,hooks}/…evidence…` | Create | `Evidence` type, `listEvidence`, `useIssueEvidence` |
| `tracker/src/components/issues/issue-detail/EvidenceTab.tsx` | Create | Gallery/list UI |
| `tracker/src/components/issues/IssueDrawer.tsx` + `tracker/src/lib/workspaceRoutes.ts` | Modify | Register tab |
| `skills/evidence/SKILL.md` | Create | Agent-facing skill |

---

### Task 1: `evidence` config block

**Files:**
- Modify: `elixir/lib/symphony_elixir/config.ex`
- Modify: `elixir/lib/symphony_elixir/project_config.ex`
- Test: extend `elixir/test/symphony_elixir/config_test.exs`

Target YAML (per-repo maps keyed by workspace subdir name; `default` key applies to single-repo workspaces):

```yaml
evidence:
  test_command:
    frontend: "npm test -- --watchAll=false"
    backend: "php artisan test"
  e2e_command:
    frontend: "npx playwright test"
  ui_paths:
    - "frontend/src/**"
  required: true
```

- [ ] **Step 1: Write the failing test**

```elixir
  describe "evidence workflow section" do
    test "validate_front_matter accepts and defaults the evidence block" do
      validated =
        SymphonyElixir.Config.validate_front_matter(%{
          "evidence" => %{
            "test_command" => %{"frontend" => "npm test"},
            "e2e_command" => %{"frontend" => "npx playwright test"},
            "ui_paths" => ["frontend/src/**"],
            "required" => true
          }
        })

      assert get_in(validated, [:evidence, :test_command]) == %{"frontend" => "npm test"}
      assert get_in(validated, [:evidence, :ui_paths]) == ["frontend/src/**"]
      assert get_in(validated, [:evidence, :required]) == true
    end

    test "omitted evidence block defaults to disabled" do
      validated = SymphonyElixir.Config.validate_front_matter(%{})
      assert get_in(validated, [:evidence, :required]) == false
      assert get_in(validated, [:evidence, :ui_paths]) == []
    end
  end
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/config_test.exs`
Expected: FAIL — `:evidence` key absent

- [ ] **Step 3: Implement**

In `@workflow_options_schema` (next to `dev_server`):

```elixir
                             evidence: [
                               type: :map,
                               default: %{},
                               keys: [
                                 test_command: [type: {:map, :string, :string}, default: %{}],
                                 e2e_command: [type: {:map, :string, :string}, default: %{}],
                                 ui_paths: [type: {:list, :string}, default: []],
                                 required: [type: :boolean, default: false]
                               ]
                             ],
```

(If the installed NimbleOptions version lacks `{:map, key, value}`, use `type: :map` and coerce string keys/values in the extractor.)

In `extract_workflow_options/1` add `evidence: extract_evidence_options(section_map(config, "evidence"))` and:

```elixir
  defp extract_evidence_options(section) do
    %{}
    |> put_present(:test_command, string_map(section["test_command"]))
    |> put_present(:e2e_command, string_map(section["e2e_command"]))
    |> put_present(:ui_paths, string_list(section["ui_paths"]))
    |> put_present(:required, boolean(section["required"]))
  end
```

(Reuse the module's existing coercion helpers — `section_map/2` and the put/coerce helpers used by `extract_dev_server_options/1`; mirror them exactly.)

In `ProjectConfig`: add `:evidence` to `defstruct` and `evidence: validated_evidence(opts)` in `resolve/1` where `validated_evidence(opts), do: get_in(opts, [:evidence]) || %{}`.

- [ ] **Step 4: Run to verify pass**

Run: `cd elixir && mix test test/symphony_elixir/config_test.exs test/symphony_elixir/workspace_and_config_test.exs`
Expected: `0 failures`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/config.ex elixir/lib/symphony_elixir/project_config.ex elixir/test/symphony_elixir/config_test.exs
git commit -m "feat(config): evidence block (test/e2e commands, ui_paths, required)"
```

---

### Task 2: `Evidence.GitDiff` — changed files and `ui_change`

**Files:**
- Create: `elixir/lib/symphony_elixir/evidence/git_diff.ex`
- Test: `elixir/test/symphony_elixir/evidence/git_diff_test.exs`

- [ ] **Step 1: Write the failing tests** (reuse the git fixture helpers from `run_contract_test.exs` — extract them into `elixir/test/support/git_fixtures.ex` if not already shared by Phase 1)

```elixir
defmodule SymphonyElixir.Evidence.GitDiffTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Evidence.GitDiff

  @moduletag :tmp_dir

  # make_repo!/3 and sh!/2 from test/support/git_fixtures.ex (Phase 1 helpers)
  import SymphonyElixir.GitFixtures

  test "changed_files lists files vs merge-base per repo", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "frontend")
    sh!(repo, "git checkout -b feat/x && mkdir -p src && echo a > src/App.tsx && echo b > README2.md && git add -A && git commit -m work")

    assert %{"frontend" => files} = GitDiff.changed_files(ws)
    assert Enum.sort(files) == ["README2.md", "src/App.tsx"]
  end

  test "uncommitted changes are included", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "backend")
    sh!(repo, "echo dirty > new.php")

    assert %{"backend" => ["new.php"]} = GitDiff.changed_files(ws)
  end

  test "ui_change? matches ui_paths globs against repo-prefixed paths" do
    changed = %{"frontend" => ["src/App.tsx"], "backend" => ["app/Service.php"]}
    assert GitDiff.ui_change?(changed, ["frontend/src/**"])
    refute GitDiff.ui_change?(changed, ["frontend/styles/**"])
    refute GitDiff.ui_change?(%{}, ["frontend/src/**"])
  end
end
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/evidence/git_diff_test.exs`
Expected: compile error — module unavailable

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Evidence.GitDiff do
  @moduledoc """
  Computes changed files per workspace repo against the merge-base with the
  default branch, including uncommitted changes. Drives the orchestrator-owned
  `ui_change` decision (the agent's judgment is not trusted for the gate).
  """

  alias SymphonyElixir.RunContract

  @spec changed_files(Path.t()) :: %{String.t() => [String.t()]}
  def changed_files(workspace) do
    workspace
    |> RunContract.repo_states()
    |> Map.new(fn repo -> {repo.name, repo_changed_files(repo)} end)
    |> Enum.reject(fn {_name, files} -> files == [] end)
    |> Map.new()
  end

  @spec ui_change?(%{String.t() => [String.t()]}, [String.t()]) :: boolean()
  def ui_change?(_changed, []), do: false

  def ui_change?(changed, ui_paths) do
    patterns = Enum.map(ui_paths, &glob_to_regex/1)

    Enum.any?(changed, fn {repo, files} ->
      Enum.any?(files, fn file ->
        full = repo <> "/" <> file
        Enum.any?(patterns, &Regex.match?(&1, full))
      end)
    end)
  end

  defp repo_changed_files(repo) do
    base = diff_base(repo)
    committed = git_lines(repo.path, ["diff", "--name-only", base])
    uncommitted = git_lines(repo.path, ["status", "--porcelain"]) |> Enum.map(&porcelain_path/1)

    (committed ++ uncommitted) |> Enum.reject(&(&1 == "")) |> Enum.uniq() |> Enum.sort()
  end

  defp diff_base(%{default_branch: default}) when is_binary(default), do: "origin/#{default}...HEAD"
  defp diff_base(_repo), do: "HEAD"

  defp git_lines(path, args) do
    case System.cmd("git", args, cd: path, stderr_to_stdout: true) do
      {output, 0} -> output |> String.split("\n", trim: true)
      {_output, _status} -> []
    end
  end

  # "?? new.php" / " M src/x.ts" → path; handles rename "R  old -> new"
  defp porcelain_path(line) do
    line
    |> String.slice(3..-1//1)
    |> String.split(" -> ")
    |> List.last()
    |> String.trim()
  end

  # Glob → regex: ** matches any depth, * matches within a segment.
  defp glob_to_regex(glob) do
    pattern =
      glob
      |> Regex.escape()
      |> String.replace("\\*\\*", "GLOBSTAR")
      |> String.replace("\\*", "[^/]*")
      |> String.replace("GLOBSTAR", ".*")

    Regex.compile!("^" <> pattern <> "$")
  end
end
```

- [ ] **Step 4: Run to verify pass**

Run: `cd elixir && mix test test/symphony_elixir/evidence/git_diff_test.exs`
Expected: `3 tests, 0 failures`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/evidence/git_diff.ex elixir/test/symphony_elixir/evidence/git_diff_test.exs elixir/test/support/git_fixtures.ex
git commit -m "feat(evidence): git diff utility with ui_paths matching"
```

---

### Task 3: `Evidence.Manifest` — parse and validate

**Files:**
- Create: `elixir/lib/symphony_elixir/evidence/manifest.ex`
- Test: `elixir/test/symphony_elixir/evidence/manifest_test.exs`

- [ ] **Step 1: Write the failing tests**

```elixir
defmodule SymphonyElixir.Evidence.ManifestTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Evidence.Manifest

  @moduletag :tmp_dir

  defp write_manifest!(workspace, map) do
    dir = Path.join(workspace, ".symphony/evidence")
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "manifest.json"), Jason.encode!(map))
  end

  defp valid_manifest do
    %{
      "issue" => "GAM-9",
      "generated_at" => "2026-06-10T00:00:00-03:00",
      "ui_change" => true,
      "runs" => [
        %{
          "kind" => "unit", "repo" => "frontend", "command" => "npm test",
          "status" => "passed", "summary" => %{"total" => 3, "passed" => 3, "failed" => 0},
          "report" => "artifacts/unit.txt"
        },
        %{
          "kind" => "e2e", "repo" => "frontend", "command" => "npx playwright test",
          "status" => "passed", "summary" => %{"total" => 1, "passed" => 1, "failed" => 0},
          "report" => "artifacts/report/",
          "screenshots" => ["artifacts/screens/home.png"],
          "videos" => ["artifacts/videos/flow.webm"]
        }
      ]
    }
  end

  defp touch_artifacts!(workspace) do
    base = Path.join(workspace, ".symphony/evidence")
    for rel <- ["artifacts/unit.txt", "artifacts/report/index.html", "artifacts/screens/home.png", "artifacts/videos/flow.webm"] do
      path = Path.join(base, rel)
      File.mkdir_p!(Path.dirname(path))
      File.write!(path, "x")
    end
  end

  test "reads a valid manifest with existing artifacts", %{tmp_dir: ws} do
    write_manifest!(ws, valid_manifest())
    touch_artifacts!(ws)

    assert {:ok, manifest} = Manifest.read(ws)
    assert manifest.issue == "GAM-9"
    assert [%{kind: "unit"}, %{kind: "e2e"}] = manifest.runs
  end

  test "missing manifest", %{tmp_dir: ws} do
    assert {:error, :manifest_missing} = Manifest.read(ws)
  end

  test "invalid json", %{tmp_dir: ws} do
    dir = Path.join(ws, ".symphony/evidence")
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "manifest.json"), "{nope")
    assert {:error, {:manifest_invalid, _}} = Manifest.read(ws)
  end

  test "run missing required fields", %{tmp_dir: ws} do
    write_manifest!(ws, %{"issue" => "GAM-9", "runs" => [%{"kind" => "unit"}]})
    assert {:error, {:manifest_invalid, reasons}} = Manifest.read(ws)
    assert Enum.any?(reasons, &(&1 =~ "repo"))
  end

  test "referenced artifact missing on disk", %{tmp_dir: ws} do
    write_manifest!(ws, valid_manifest())
    # no touch_artifacts!
    assert {:error, {:artifacts_missing, missing}} = Manifest.read(ws)
    assert "artifacts/unit.txt" in missing
  end
end
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/evidence/manifest_test.exs`
Expected: compile error

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Evidence.Manifest do
  @moduledoc """
  Reads and validates `.symphony/evidence/manifest.json` written by the agent.
  Validation is structural (fields, types, artifact files exist on disk);
  the gate decision lives in `SymphonyElixir.Evidence.Gate`.
  """

  @enforce_keys [:issue, :runs]
  defstruct [:issue, :generated_at, ui_change: false, runs: []]

  defmodule Run do
    @moduledoc false
    @enforce_keys [:kind, :repo, :command, :status]
    defstruct [:kind, :repo, :command, :status, :summary, :report, :duration_ms,
               screenshots: [], videos: [], trace: nil]

    @type t :: %__MODULE__{}
  end

  @type t :: %__MODULE__{}

  @evidence_dir ".symphony/evidence"
  @required_run_fields ~w(kind repo command status)

  @spec dir(Path.t()) :: Path.t()
  def dir(workspace), do: Path.join(workspace, @evidence_dir)

  @spec read(Path.t()) ::
          {:ok, t()} | {:error, :manifest_missing | {:manifest_invalid, term()} | {:artifacts_missing, [String.t()]}}
  def read(workspace) do
    path = Path.join(dir(workspace), "manifest.json")

    with {:ok, raw} <- read_file(path),
         {:ok, decoded} <- decode(raw),
         {:ok, manifest} <- build(decoded),
         :ok <- verify_artifacts(workspace, manifest) do
      {:ok, manifest}
    end
  end

  @spec artifact_paths(t()) :: [String.t()]
  def artifact_paths(%__MODULE__{runs: runs}) do
    Enum.flat_map(runs, fn run ->
      Enum.filter([run.report, run.trace], &is_binary/1) ++ run.screenshots ++ run.videos
    end)
  end

  defp read_file(path) do
    case File.read(path) do
      {:ok, raw} -> {:ok, raw}
      {:error, :enoent} -> {:error, :manifest_missing}
      {:error, reason} -> {:error, {:manifest_invalid, reason}}
    end
  end

  defp decode(raw) do
    case Jason.decode(raw) do
      {:ok, decoded} when is_map(decoded) -> {:ok, decoded}
      {:ok, _other} -> {:error, {:manifest_invalid, "manifest must be a JSON object"}}
      {:error, reason} -> {:error, {:manifest_invalid, reason}}
    end
  end

  defp build(%{"runs" => runs} = decoded) when is_list(runs) do
    case Enum.flat_map(runs, &run_issues/1) do
      [] ->
        {:ok,
         %__MODULE__{
           issue: decoded["issue"],
           generated_at: decoded["generated_at"],
           ui_change: decoded["ui_change"] == true,
           runs: Enum.map(runs, &to_run/1)
         }}

      issues ->
        {:error, {:manifest_invalid, issues}}
    end
  end

  defp build(_decoded), do: {:error, {:manifest_invalid, "missing runs list"}}

  defp run_issues(run) when is_map(run) do
    @required_run_fields
    |> Enum.reject(&is_binary(run[&1]))
    |> Enum.map(&"run missing required field: #{&1}")
  end

  defp run_issues(_run), do: ["run entries must be objects"]

  defp to_run(run) do
    %Run{
      kind: run["kind"],
      repo: run["repo"],
      command: run["command"],
      status: run["status"],
      summary: run["summary"],
      report: run["report"],
      duration_ms: run["duration_ms"],
      screenshots: List.wrap(run["screenshots"]),
      videos: List.wrap(run["videos"]),
      trace: run["trace"]
    }
  end

  defp verify_artifacts(workspace, manifest) do
    base = dir(workspace)

    missing =
      manifest
      |> artifact_paths()
      |> Enum.reject(fn rel ->
        full = Path.join(base, rel)
        File.exists?(full) or File.dir?(String.trim_trailing(full, "/"))
      end)

    case missing do
      [] -> :ok
      missing -> {:error, {:artifacts_missing, missing}}
    end
  end
end
```

- [ ] **Step 4: Run to verify pass**

Run: `cd elixir && mix test test/symphony_elixir/evidence/manifest_test.exs`
Expected: `5 tests, 0 failures`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/evidence/manifest.ex elixir/test/symphony_elixir/evidence/manifest_test.exs
git commit -m "feat(evidence): manifest parsing and structural validation"
```

---

### Task 4: `Evidence.SessionAudit` — anti-fraud against the Codex session log

**Files:**
- Create: `elixir/lib/symphony_elixir/evidence/session_audit.ex`
- Test: `elixir/test/symphony_elixir/evidence/session_audit_test.exs`

- [ ] **Step 1: Write the failing tests**

```elixir
defmodule SymphonyElixir.Evidence.SessionAuditTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Evidence.SessionAudit

  @moduletag :tmp_dir

  defp write_rollout!(tmp_dir, commands) do
    path = Path.join(tmp_dir, "rollout-test.jsonl")

    lines =
      Enum.map(commands, fn cmd ->
        Jason.encode!(%{
          "type" => "response_item",
          "payload" => %{
            "type" => "function_call",
            "name" => "exec_command",
            "call_id" => "c1",
            "arguments" => Jason.encode!(%{"cmd" => cmd})
          }
        })
      end)

    File.write!(path, Enum.join(lines, "\n") <> "\n")
    path
  end

  test "commands present in the session pass", %{tmp_dir: tmp_dir} do
    rollout = write_rollout!(tmp_dir, ["npm test -- --watchAll=false", "npx playwright test"])

    assert :ok =
             SessionAudit.verify_commands(["npm test", "npx playwright test"],
               rollout_path: rollout
             )
  end

  test "command never executed fails", %{tmp_dir: tmp_dir} do
    rollout = write_rollout!(tmp_dir, ["ls -la"])

    assert {:error, {:commands_not_executed, ["npm test"]}} =
             SessionAudit.verify_commands(["npm test"], rollout_path: rollout)
  end

  test "missing rollout file fails closed", %{tmp_dir: tmp_dir} do
    assert {:error, :session_log_unavailable} =
             SessionAudit.verify_commands(["npm test"], rollout_path: Path.join(tmp_dir, "nope.jsonl"))
  end
end
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/evidence/session_audit_test.exs`
Expected: compile error

- [ ] **Step 3: Implement**

Matching semantics: a manifest command passes if it is a substring of any executed `exec_command` `cmd` (commands in manifests are frequently re-quoted/prefixed, e.g. `cd frontend && npm test`; substring containment of the declared command is the pragmatic check).

```elixir
defmodule SymphonyElixir.Evidence.SessionAudit do
  @moduledoc """
  Cross-checks evidence manifest commands against the Codex session rollout
  log: every declared command must appear as an executed `exec_command` tool
  call in the session. Fails closed when the rollout cannot be read.
  """

  alias SymphonyElixir.Codex.SessionLog

  @spec verify_commands([String.t()], keyword()) ::
          :ok | {:error, :session_log_unavailable | {:commands_not_executed, [String.t()]}}
  def verify_commands(commands, opts) do
    with {:ok, executed} <- executed_commands(opts) do
      missing =
        Enum.reject(commands, fn declared ->
          needle = String.trim(declared)
          needle != "" and Enum.any?(executed, &String.contains?(&1, needle))
        end)

      case missing do
        [] -> :ok
        missing -> {:error, {:commands_not_executed, missing}}
      end
    end
  end

  @spec rollout_path_for_workspace(Path.t()) :: {:ok, Path.t()} | :error
  def rollout_path_for_workspace(workspace), do: SessionLog.resolve_rollout_path(workspace, [])

  defp executed_commands(opts) do
    path =
      case Keyword.fetch(opts, :rollout_path) do
        {:ok, explicit} -> explicit
        :error ->
          case rollout_path_for_workspace(Keyword.fetch!(opts, :workspace)) do
            {:ok, resolved} -> resolved
            :error -> nil
          end
      end

    with true <- is_binary(path) and File.exists?(path),
         {:ok, raw} <- File.read(path) do
      commands =
        raw
        |> String.split("\n", trim: true)
        |> Enum.map(&SessionLog.parse_line/1)
        |> Enum.filter(&match?(%{"kind" => "tool_call", "title" => "exec_command"}, &1))
        |> Enum.flat_map(&extract_cmd/1)

      {:ok, commands}
    else
      _unreadable -> {:error, :session_log_unavailable}
    end
  end

  defp extract_cmd(%{"body" => body}) when is_binary(body) do
    case Jason.decode(body) do
      {:ok, %{"cmd" => cmd}} when is_binary(cmd) -> [cmd]
      _other -> body_as_command(body)
    end
  end

  defp extract_cmd(_entry), do: []

  # parse_line may pretty-print arguments; fall back to the raw body text so a
  # formatted JSON body still matches by substring.
  defp body_as_command(body), do: [body]
end
```

Note for the implementer: confirm against `elixir/test/symphony_elixir/codex/session_log_test.exs` exactly what `parse_line/1` returns for `function_call` entries (the `"body"` is the formatted arguments). Adjust `extract_cmd/1` to whatever the real shape is — the audit must extract the `cmd` string.

- [ ] **Step 4: Run to verify pass**

Run: `cd elixir && mix test test/symphony_elixir/evidence/session_audit_test.exs`
Expected: `3 tests, 0 failures`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/evidence/session_audit.ex elixir/test/symphony_elixir/evidence/session_audit_test.exs
git commit -m "feat(evidence): session-log audit of declared commands"
```

---

### Task 5: `Evidence.Gate` — the VALIDATE decision

**Files:**
- Create: `elixir/lib/symphony_elixir/evidence/gate.ex`
- Test: `elixir/test/symphony_elixir/evidence/gate_test.exs`

Rules (pure function over injected inputs):
1. Evidence disabled (`required: false`) or no repo changed → `:satisfied`.
2. Manifest must read OK.
3. Every changed repo needs a `unit` run with `status == "passed"`.
4. `ui_change` (orchestrator-computed) → an `e2e` run with `status == "passed"` AND ≥1 screenshot AND ≥1 video.
5. Session audit passes for all run commands.

- [ ] **Step 1: Write the failing tests**

```elixir
defmodule SymphonyElixir.Evidence.GateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Evidence.{Gate, Manifest}
  alias SymphonyElixir.Evidence.Manifest.Run

  defp manifest(runs), do: %Manifest{issue: "GAM-9", runs: runs}

  defp unit(repo, status \\ "passed"), do: %Run{kind: "unit", repo: repo, command: "npm test", status: status}

  defp e2e(extra \\ []) do
    struct!(%Run{kind: "e2e", repo: "frontend", command: "npx playwright test", status: "passed",
                 screenshots: ["s.png"], videos: ["v.webm"]}, Map.new(extra))
  end

  defp deps(overrides \\ []) do
    Map.merge(
      %{
        read_manifest: fn _ws -> {:ok, manifest([unit("frontend")])} end,
        changed_files: fn _ws -> %{"frontend" => ["src/App.tsx"]} end,
        audit: fn _commands, _opts -> :ok end
      },
      Map.new(overrides)
    )
  end

  @config %{required: true, ui_paths: ["frontend/src/**"]}

  test "disabled evidence is satisfied" do
    assert :satisfied = Gate.evaluate("/ws", %{required: false, ui_paths: []}, deps())
  end

  test "no changed repos is satisfied" do
    assert :satisfied = Gate.evaluate("/ws", @config, deps(changed_files: fn _ -> %{} end))
  end

  test "missing manifest is a violation" do
    d = deps(read_manifest: fn _ -> {:error, :manifest_missing} end)
    assert {:violations, [%{kind: :manifest_missing}]} = Gate.evaluate("/ws", @config, d)
  end

  test "changed repo without passing unit run" do
    d = deps(read_manifest: fn _ -> {:ok, manifest([unit("frontend", "failed")])} end,
             changed_files: fn _ -> %{"frontend" => ["src/x.ts"]} end)
    assert {:violations, [%{kind: :unit_not_green, repo: "frontend"}]} =
             Gate.evaluate("/ws", %{required: true, ui_paths: []}, d)
  end

  test "ui change demands e2e with screenshots and video" do
    d = deps(read_manifest: fn _ -> {:ok, manifest([unit("frontend")])} end)
    assert {:violations, [%{kind: :e2e_missing}]} = Gate.evaluate("/ws", @config, d)

    d2 = deps(read_manifest: fn _ -> {:ok, manifest([unit("frontend"), e2e(screenshots: [])])} end)
    assert {:violations, [%{kind: :visual_capture_missing}]} = Gate.evaluate("/ws", @config, d2)
  end

  test "fully green with visual capture is satisfied" do
    d = deps(read_manifest: fn _ -> {:ok, manifest([unit("frontend"), e2e()])} end)
    assert :satisfied = Gate.evaluate("/ws", @config, d)
  end

  test "session audit failure is a violation" do
    d = deps(read_manifest: fn _ -> {:ok, manifest([unit("frontend"), e2e()])} end,
             audit: fn _c, _o -> {:error, {:commands_not_executed, ["npm test"]}} end)
    assert {:violations, [%{kind: :commands_not_executed}]} = Gate.evaluate("/ws", @config, d)
  end
end
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/evidence/gate_test.exs`
Expected: compile error

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Evidence.Gate do
  @moduledoc """
  The VALIDATE gate decision. Pure over injected dependencies; the
  orchestrator/runner supply real implementations
  (`Manifest.read/1`, `GitDiff.changed_files/1`, `SessionAudit.verify_commands/2`).
  """

  alias SymphonyElixir.Evidence.{GitDiff, Manifest, SessionAudit}

  @type violation :: %{kind: atom(), repo: String.t() | nil, detail: String.t()}

  @spec evaluate(Path.t(), map(), map()) :: :satisfied | {:violations, [violation()]}
  def evaluate(workspace, config, deps \\ default_deps()) do
    changed = deps.changed_files.(workspace)

    cond do
      config[:required] != true -> :satisfied
      changed == %{} -> :satisfied
      true -> evaluate_manifest(workspace, config, changed, deps)
    end
  end

  @spec default_deps() :: map()
  def default_deps do
    %{
      read_manifest: &Manifest.read/1,
      changed_files: &GitDiff.changed_files/1,
      audit: fn commands, opts -> SessionAudit.verify_commands(commands, opts) end
    }
  end

  defp evaluate_manifest(workspace, config, changed, deps) do
    case deps.read_manifest.(workspace) do
      {:ok, manifest} ->
        ui_change = GitDiff.ui_change?(changed, config[:ui_paths] || [])

        violations =
          unit_violations(manifest, changed) ++
            e2e_violations(manifest, ui_change) ++
            audit_violations(manifest, workspace, deps)

        case violations do
          [] -> :satisfied
          violations -> {:violations, violations}
        end

      {:error, :manifest_missing} ->
        {:violations, [%{kind: :manifest_missing, repo: nil, detail: "no .symphony/evidence/manifest.json in workspace"}]}

      {:error, reason} ->
        {:violations, [%{kind: :manifest_invalid, repo: nil, detail: inspect(reason)}]}
    end
  end

  defp unit_violations(manifest, changed) do
    changed
    |> Map.keys()
    |> Enum.reject(fn repo ->
      Enum.any?(manifest.runs, &(&1.kind == "unit" and &1.repo == repo and &1.status == "passed"))
    end)
    |> Enum.map(&%{kind: :unit_not_green, repo: &1, detail: "no passing unit run for changed repo #{&1}"})
  end

  defp e2e_violations(_manifest, false), do: []

  defp e2e_violations(manifest, true) do
    case Enum.find(manifest.runs, &(&1.kind == "e2e" and &1.status == "passed")) do
      nil ->
        [%{kind: :e2e_missing, repo: nil, detail: "UI paths changed but no passing e2e run"}]

      run ->
        if run.screenshots != [] and run.videos != [] do
          []
        else
          [%{kind: :visual_capture_missing, repo: run.repo, detail: "e2e run must include at least 1 screenshot and 1 video"}]
        end
    end
  end

  defp audit_violations(manifest, workspace, deps) do
    commands = manifest.runs |> Enum.map(& &1.command) |> Enum.uniq()

    case deps.audit.(commands, workspace: workspace) do
      :ok ->
        []

      {:error, {:commands_not_executed, missing}} ->
        [%{kind: :commands_not_executed, repo: nil, detail: "declared but never executed in session: #{Enum.join(missing, ", ")}"}]

      {:error, :session_log_unavailable} ->
        [%{kind: :session_log_unavailable, repo: nil, detail: "could not read Codex session log to audit evidence"}]
    end
  end
end
```

- [ ] **Step 4: Run to verify pass**

Run: `cd elixir && mix test test/symphony_elixir/evidence/gate_test.exs`
Expected: `7 tests, 0 failures`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/evidence/gate.ex elixir/test/symphony_elixir/evidence/gate_test.exs
git commit -m "feat(evidence): VALIDATE gate decision logic"
```

---

### Task 6: Persistence — migration, `Evidence.Record`, `Evidence.Store`

**Files:**
- Create: `elixir/priv/repo/migrations/20260610000100_create_issue_evidence.exs`
- Create: `elixir/lib/symphony_elixir/evidence/record.ex`
- Create: `elixir/lib/symphony_elixir/evidence/store.ex`
- Modify: `elixir/lib/symphony_elixir/config.ex` (add `evidence_root/0`)
- Test: `elixir/test/symphony_elixir/evidence/store_test.exs`

- [ ] **Step 1: Migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateIssueEvidence do
  use Ecto.Migration

  def change do
    create table(:issue_evidence) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:issue_identifier, :string, null: false)
      add(:run_id, :string, null: false)
      add(:session_id, :string)
      add(:status, :string, null: false, default: "passed")
      add(:ui_change, :boolean, null: false, default: false)
      add(:manifest, :map, null: false, default: %{})
      add(:artifact_dir, :string, null: false)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:issue_evidence, [:project_id, :issue_identifier, :run_id]))
    create(index(:issue_evidence, [:project_id, :issue_identifier]))
  end
end
```

(Confirm the projects table name referenced by other migrations — use whatever `tracker_sync_outbox`'s `project_id` references.)

- [ ] **Step 2: Schema**

```elixir
defmodule SymphonyElixir.Evidence.Record do
  @moduledoc "Persisted evidence run for an issue (manifest snapshot + durable artifact dir)."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}

  schema "issue_evidence" do
    field(:issue_identifier, :string)
    field(:run_id, :string)
    field(:session_id, :string)
    field(:status, :string, default: "passed")
    field(:ui_change, :boolean, default: false)
    field(:manifest, :map, default: %{})
    field(:artifact_dir, :string)

    belongs_to(:project, Project)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, [:project_id, :issue_identifier, :run_id, :session_id, :status, :ui_change, :manifest, :artifact_dir])
    |> validate_required([:project_id, :issue_identifier, :run_id, :status, :artifact_dir])
    |> unique_constraint([:project_id, :issue_identifier, :run_id])
  end
end
```

- [ ] **Step 3: Store — failing test**

```elixir
defmodule SymphonyElixir.Evidence.StoreTest do
  use SymphonyElixir.DataCase, async: false

  alias SymphonyElixir.Evidence.Store

  @moduletag :tmp_dir

  setup %{tmp_dir: tmp_dir} do
    {:ok, ctx} = SymphonyElixir.LocalTrackerFixtures.project_with_issue()

    evidence_dir = Path.join(tmp_dir, "ws/.symphony/evidence")
    File.mkdir_p!(Path.join(evidence_dir, "artifacts"))
    File.write!(Path.join(evidence_dir, "manifest.json"), Jason.encode!(%{"issue" => ctx.issue.identifier, "runs" => []}))
    File.write!(Path.join(evidence_dir, "artifacts/s.png"), "img")

    Map.merge(ctx, %{workspace: Path.join(tmp_dir, "ws"), evidence_root: Path.join(tmp_dir, "durable")})
  end

  test "persist copies artifacts and stores the record", ctx do
    manifest = %{"issue" => ctx.issue.identifier, "ui_change" => true, "runs" => []}

    assert {:ok, record} =
             Store.persist(ctx.project.slug, ctx.issue.identifier, ctx.workspace, manifest,
               session_id: "thread-turn", evidence_root: ctx.evidence_root)

    assert record.run_id != nil
    assert File.exists?(Path.join(record.artifact_dir, "artifacts/s.png"))
    assert record.ui_change

    assert {:ok, [listed]} = Store.list(ctx.project.slug, ctx.issue.identifier)
    assert listed.id == record.id
  end

  test "resolve_artifact rejects path traversal", ctx do
    manifest = %{"issue" => ctx.issue.identifier, "runs" => []}
    {:ok, record} = Store.persist(ctx.project.slug, ctx.issue.identifier, ctx.workspace, manifest, evidence_root: ctx.evidence_root)

    assert {:ok, _path} = Store.resolve_artifact(record, "artifacts/s.png")
    assert {:error, :invalid_path} = Store.resolve_artifact(record, "../../etc/passwd")
  end
end
```

- [ ] **Step 4: Implement Store**

```elixir
defmodule SymphonyElixir.Evidence.Store do
  @moduledoc """
  Durable persistence for evidence: copies the workspace's
  `.symphony/evidence/` tree into `<evidence_root>/<project>/<issue>/<run_id>/`
  (survives workspace removal) and records the manifest in `issue_evidence`.
  """

  import Ecto.Query

  alias SymphonyElixir.Evidence.{Manifest, Record}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @spec persist(String.t(), String.t(), Path.t(), map(), keyword()) :: {:ok, Record.t()} | {:error, term()}
  def persist(project_slug, identifier, workspace, manifest_map, opts \\ []) do
    with {:ok, project} <- Context.get_project(project_slug) do
      run_id = Keyword.get(opts, :run_id, generate_run_id())
      destination = Path.join([evidence_root(opts), project_slug, safe(identifier), run_id])

      with :ok <- copy_artifacts(Manifest.dir(workspace), destination) do
        %Record{}
        |> Record.changeset(%{
          project_id: project.id,
          issue_identifier: identifier,
          run_id: run_id,
          session_id: Keyword.get(opts, :session_id),
          status: overall_status(manifest_map),
          ui_change: manifest_map["ui_change"] == true,
          manifest: manifest_map,
          artifact_dir: destination
        })
        |> Repo.insert()
      end
    end
  end

  @spec list(String.t(), String.t()) :: {:ok, [Record.t()]} | {:error, term()}
  def list(project_slug, identifier) do
    with {:ok, project} <- Context.get_project(project_slug) do
      records =
        Repo.all(
          from(r in Record,
            where: r.project_id == ^project.id and r.issue_identifier == ^identifier,
            order_by: [desc: r.inserted_at]
          )
        )

      {:ok, records}
    end
  end

  @spec resolve_artifact(Record.t(), String.t()) :: {:ok, Path.t()} | {:error, :invalid_path | :not_found}
  def resolve_artifact(%Record{artifact_dir: dir}, relative) do
    base = Path.expand(dir)
    full = Path.expand(Path.join(dir, relative))

    cond do
      not String.starts_with?(full, base <> "/") -> {:error, :invalid_path}
      not File.exists?(full) -> {:error, :not_found}
      true -> {:ok, full}
    end
  end

  @spec evidence_root(keyword()) :: Path.t()
  def evidence_root(opts \\ []) do
    Keyword.get_lazy(opts, :evidence_root, fn ->
      root = Application.get_env(:symphony_elixir, :root_dir, File.cwd!())
      Path.join(root, ".symphony/evidence")
    end)
  end

  defp copy_artifacts(source, destination) do
    File.mkdir_p!(destination)

    case File.cp_r(source, destination) do
      {:ok, _copied} -> :ok
      {:error, reason, file} -> {:error, {:artifact_copy_failed, reason, file}}
    end
  end

  defp overall_status(%{"runs" => runs}) when is_list(runs) do
    if Enum.all?(runs, &(&1["status"] == "passed")), do: "passed", else: "failed"
  end

  defp overall_status(_manifest), do: "failed"

  defp generate_run_id do
    DateTime.utc_now() |> Calendar.strftime("%Y%m%d%H%M%S") |> Kernel.<>("-#{System.unique_integer([:positive])}")
  end

  defp safe(identifier), do: String.replace(identifier, ~r/[^a-zA-Z0-9._-]/, "_")
end
```

- [ ] **Step 5: Run + commit**

Run: `cd elixir && mix ecto.migrate && mix test test/symphony_elixir/evidence/store_test.exs`
Expected: `2 tests, 0 failures`

```bash
git add elixir/priv/repo/migrations elixir/lib/symphony_elixir/evidence/record.ex elixir/lib/symphony_elixir/evidence/store.ex elixir/test/symphony_elixir/evidence/store_test.exs
git commit -m "feat(evidence): durable artifact store and issue_evidence persistence"
```

---

### Task 7: Wire the VALIDATE gate into AgentRunner + Orchestrator

**Files:**
- Modify: `elixir/lib/symphony_elixir/agent_runner.ex`
- Modify: `elixir/lib/symphony_elixir/orchestrator.ex`
- Test: `elixir/test/symphony_elixir/agent_runner_validate_gate_test.exs`, extend `orchestrator_run_contract_test.exs`

- [ ] **Step 1: AgentRunner — VALIDATE before PUBLISH.** Phase 1 added `apply_publish_gate/5`; generalize the call site so gates run in order VALIDATE → PUBLISH, both using the same corrective-turn machinery (max 2 each). The VALIDATE evaluator default:

```elixir
        validate_evaluator =
          Keyword.get(opts, :validate_gate_evaluator, fn ws ->
            config = evidence_config(Keyword.get(opts, :project_config))
            SymphonyElixir.Evidence.Gate.evaluate(ws, config)
          end)
```

with

```elixir
  defp evidence_config(%ProjectConfig{evidence: %{} = evidence}), do: evidence
  defp evidence_config(_project_config), do: %{required: false, ui_paths: []}
```

Corrective prompt (new function, cited skill `evidence`):

```elixir
  defp corrective_validate_prompt(violations, _workspace) do
    """
    ## Validate gate failed (Symphony)

    Evidence requirements are not satisfied:

    #{Enum.map_join(violations, "\n", fn v -> "- #{v.kind}#{if v.repo, do: " (#{v.repo})", else: ""}: #{v.detail}" end)}

    Read and follow the `evidence` skill now: run the project's unit tests (and
    e2e with screenshot/video capture if UI files changed), then write
    `.symphony/evidence/manifest.json` referencing the real artifacts. Do
    nothing else in this turn.
    """
  end
```

Reuse `apply_publish_gate/5`'s structure — extract a shared `apply_gate(result, workspace, evaluator, run_turn, budget, prompt_fun, incomplete_tag)` and express both gates through it (`incomplete_tag: :validate_gate | :publish_gate`). Failing tests mirror `agent_runner_publish_gate_test.exs` with the validate prompt assertions.

- [ ] **Step 2: Orchestrator — persist + comment on success.** In `apply_normal_completion/3` (Phase 1 shape), after `{:ok, prs}` from the publish contract and before the transition:

```elixir
        persist_evidence(running_entry, issue)
```

with:

```elixir
  defp persist_evidence(running_entry, %Issue{project_slug: slug, identifier: identifier} = issue)
       when is_binary(slug) and slug != "" do
    workspace = Workspace.path_for_issue(issue)

    case SymphonyElixir.Evidence.Manifest.read(workspace) do
      {:ok, _manifest} ->
        manifest_map = workspace |> SymphonyElixir.Evidence.Manifest.dir() |> Path.join("manifest.json") |> File.read!() |> Jason.decode!()

        case SymphonyElixir.Evidence.Store.persist(slug, identifier, workspace, manifest_map, session_id: running_entry[:session_id]) do
          {:ok, record} -> post_evidence_comment(issue, record)
          {:error, error} -> Logger.warning("Failed to persist evidence issue=#{identifier}: #{inspect(error)}")
        end

      {:error, _no_manifest} ->
        :ok
    end
  end

  defp persist_evidence(_running_entry, _issue), do: :ok
```

`post_evidence_comment/2` renders the remote `## Codex Evidence` comment from the record and upserts it in place — same pattern as `upsert_workpad` (Phase 2) but matching the `## Codex Evidence` prefix. Add `Tracker.upsert_comment_by_prefix(issue_id, "## Codex Evidence", body)` generalizing Phase 2's `upsert_workpad/2` (refactor `upsert_workpad/2` to call it with the workpad prefix). Comment body:

```elixir
  @doc false
  @spec evidence_comment_body(SymphonyElixir.Evidence.Record.t(), String.t()) :: String.t()
  def evidence_comment_body(record, base_url) do
    runs = record.manifest["runs"] || []

    rows =
      Enum.map_join(runs, "\n", fn run ->
        "| #{run["kind"]} | #{run["repo"]} | `#{run["command"]}` | #{run["status"]} | #{summary_cell(run["summary"])} |"
      end)

    screenshots =
      runs
      |> Enum.flat_map(&List.wrap(&1["screenshots"]))
      |> Enum.take(4)
      |> Enum.map_join("\n", fn rel -> "![#{Path.basename(rel)}](#{artifact_url(record, rel, base_url)})" end)

    """
    ## Codex Evidence

    Run `#{record.run_id}` — overall **#{record.status}**#{if record.ui_change, do: " (UI change: e2e + visual capture required)", else: ""}.

    | Kind | Repo | Command | Status | Summary |
    |---|---|---|---|---|
    #{rows}

    #{screenshots}

    Full artifacts (videos, reports, traces): #{base_url}/issues/evidence — Evidence tab in Symphony.
    """
  end

  defp summary_cell(%{"total" => t, "passed" => p, "failed" => f}), do: "#{p}/#{t} passed, #{f} failed"
  defp summary_cell(_summary), do: "-"

  defp artifact_url(record, rel, base_url) do
    "#{base_url}/api/tracker/v1/projects/#{record.project_id}/evidence/#{record.id}/artifacts/#{rel}"
  end
```

(`base_url`: reuse however the dev-server/public-tunnel features resolve the externally reachable Symphony URL — search for the existing helper; if none fits, fall back to the configured server host. Adjust `artifact_url` to the real route from Task 8.)

- [ ] **Step 3: Run + commit**

Run: `cd elixir && mix test test/symphony_elixir/agent_runner_validate_gate_test.exs test/symphony_elixir/orchestrator_run_contract_test.exs test/symphony_elixir/orchestrator_test.exs`

```bash
git add elixir/lib/symphony_elixir/agent_runner.ex elixir/lib/symphony_elixir/orchestrator.ex elixir/test
git commit -m "feat(evidence): VALIDATE gate in runner; persistence and remote comment on completion"
```

---

### Task 8: Evidence API

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/evidence_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/evidence_controller_test.exs` (follow `pull_request_controller` test conventions)

- [ ] **Step 1: Routes** (in the `/api/tracker/v1` scope, next to the PR routes at lines 88–92):

```elixir
    get("/projects/:project_slug/issues/:identifier/evidence", EvidenceController, :index)
    get("/projects/:project_slug/issues/:identifier/evidence/:run_id/artifacts/*path", EvidenceController, :artifact)
```

- [ ] **Step 2: Controller**

```elixir
defmodule SymphonyElixirWeb.Tracker.EvidenceController do
  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Evidence.Store
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.Tracker.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    case Store.list(project_slug, identifier) do
      {:ok, records} -> json(conn, %{data: Enum.map(records, &present/1)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec artifact(Conn.t(), map()) :: Conn.t()
  def artifact(conn, %{"project_slug" => project_slug, "identifier" => identifier, "run_id" => run_id, "path" => path_segments}) do
    relative = Enum.join(path_segments, "/")

    with {:ok, records} <- Store.list(project_slug, identifier),
         %{} = record <- Enum.find(records, &(&1.run_id == run_id)) || {:error, :not_found},
         {:ok, absolute} <- Store.resolve_artifact(record, relative) do
      conn
      |> Conn.put_resp_content_type(MIME.from_path(absolute))
      |> Conn.put_resp_header("cache-control", "private, max-age=31536000, immutable")
      |> Conn.send_file(200, absolute)
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp present(record) do
    %{
      id: record.id,
      run_id: record.run_id,
      session_id: record.session_id,
      status: record.status,
      ui_change: record.ui_change,
      manifest: record.manifest,
      inserted_at: record.inserted_at
    }
  end
end
```

(Confirm `Context.get_project` error shapes match what `TrackerErrors.render/2` handles; mirror `pull_request_controller.ex` exactly for the error path and `Conn` aliasing. `MIME` ships with Plug.)

- [ ] **Step 3: Controller tests** — index empty → `{"data": []}`; after `Store.persist` fixture → one entry with manifest; artifact route serves bytes with correct content type; traversal path → error status.

- [ ] **Step 4: Run + commit**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/evidence_controller_test.exs`

```bash
git add elixir/lib/symphony_elixir_web elixir/test/symphony_elixir_web
git commit -m "feat(api): evidence listing and artifact serving"
```

---

### Task 9: Evidence tab in the UI

**Files:**
- Create: `tracker/src/types/evidence.ts`, `tracker/src/services/evidence.ts`, `tracker/src/hooks/useIssueEvidence.ts`, `tracker/src/components/issues/issue-detail/EvidenceTab.tsx`
- Modify: `tracker/src/components/issues/IssueDrawer.tsx` (`TABS`), `tracker/src/lib/workspaceRoutes.ts` (`ISSUE_TABS`)
- Test: `tracker/src/components/issues/issue-detail/__tests__/EvidenceTab.test.tsx`

- [ ] **Step 1: Types + service** (mirror `pullRequests.ts` / `useIssuePullRequests.ts` structure exactly — `trackerPath`, envelope `{data}`):

```ts
// types/evidence.ts
export interface EvidenceRun {
  kind: "unit" | "e2e" | string;
  repo: string;
  command: string;
  status: "passed" | "failed" | string;
  summary?: { total: number; passed: number; failed: number } | null;
  report?: string | null;
  screenshots?: string[];
  videos?: string[];
  trace?: string | null;
  duration_ms?: number | null;
}

export interface EvidenceRecord {
  id: number;
  runId: string;
  sessionId: string | null;
  status: string;
  uiChange: boolean;
  runs: EvidenceRun[];
  insertedAt: string;
}
```

```ts
// services/evidence.ts
import { http, trackerPath } from "./http";
import type { EvidenceRecord } from "@/types/evidence";

interface BackendEvidence {
  id: number;
  run_id: string;
  session_id: string | null;
  status: string;
  ui_change: boolean;
  manifest: { runs?: unknown[] } | null;
  inserted_at: string;
}

export function evidenceArtifactUrl(projectSlug: string, identifier: string, runId: string, relative: string): string {
  return trackerPath(
    `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/evidence/${encodeURIComponent(runId)}/artifacts/${relative}`,
  );
}

export async function listEvidence(projectSlug: string, identifier: string): Promise<EvidenceRecord[]> {
  const response = await http.get<{ data: BackendEvidence[] }>(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/evidence`),
  );

  return (response.data.data ?? []).map((raw) => ({
    id: raw.id,
    runId: raw.run_id,
    sessionId: raw.session_id,
    status: raw.status,
    uiChange: raw.ui_change,
    runs: (raw.manifest?.runs ?? []) as EvidenceRecord["runs"],
    insertedAt: raw.inserted_at,
  }));
}
```

(Adapt `http.get` usage to the exact helper signatures in `services/http.ts` — copy from `pullRequests.ts`.)

- [ ] **Step 2: Hook** — copy `useIssuePullRequests.ts` shape: state `{data, loading, error}`, fetch on `(projectSlug, identifier)` change, exposed `refresh`.

- [ ] **Step 3: Tab component + tests.** `EvidenceTab` props: `{ projectSlug, identifier, records, loading, error, onRefresh }`. Renders per record: status pill, `uiChange` marker, runs table (kind/repo/command/status/summary), screenshot gallery (`<img src={evidenceArtifactUrl(...)}>`), videos (`<video controls src=...>`), report/trace links. Empty state: "No evidence captured for this issue yet." Tests: empty state renders; a record with one unit + one e2e run renders the table rows, one `img` per screenshot and one `video` per video.

- [ ] **Step 4: Register the tab** — add `{ value: "evidence", label: "Evidence", Icon: ClipboardCheck }` (lucide) to `TABS` in `IssueDrawer.tsx`, `"evidence"` to `ISSUE_TABS` in `workspaceRoutes.ts`, render `<TabsContent value="evidence"><EvidenceTab ... /></TabsContent>` wiring `useIssueEvidence` at the drawer top alongside `useIssuePullRequests`.

- [ ] **Step 5: Run + commit**

Run: `cd tracker && npx vitest run`

```bash
git add tracker/src
git commit -m "feat(tracker-ui): Evidence tab with screenshot/video artifacts"
```

---

### Task 10: `evidence` skill

**Files:**
- Create: `skills/evidence/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
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
```

- [ ] **Step 2: Verify distribution + commit**

Run: `cd elixir && mix test test/symphony_elixir/workspace_skills_test.exs`

```bash
git add skills/evidence/SKILL.md
git commit -m "feat(skills): evidence skill with mandatory visual capture"
```

---

### Task 11: Docs + full gates

- [ ] **Step 1:** Update `elixir/README.md` (evidence config block + gate semantics + Evidence tab), `SPEC.md` (condensed paragraph), `.env.example` if any env was added (none expected — evidence root derives from `root_dir`).
- [ ] **Step 2:** `make -C elixir all` and `cd tracker && npx vitest run`; fix findings.
- [ ] **Step 3:**

```bash
git add -A && git commit -m "docs: evidence subsystem; chore: quality gates"
```

---

## Self-review (against spec Phase 3 + evidence comment)

- Manifest central + validação estrutural: Task 3 ✓
- Config por projeto (`test_command`, `e2e_command`, `ui_paths`, `required`): Task 1 ✓
- `ui_change` calculado pelo orchestrator via diff (não pelo agente): Task 2 ✓
- Gate VALIDATE (unit verde por repo alterado, e2e quando tela, artefatos existem): Task 5 ✓
- **Captura visual obrigatória** (≥1 screenshot e ≥1 vídeo, trace como artefato): Tasks 5, 10 ✓
- Anti-fraude via session log: Tasks 4, 5 ✓
- Persistência durável + tabela `issue_evidence`, sobrevive limpeza do workspace: Task 6 ✓
- Aba Evidence (galeria, vídeo, relatório, histórico por tentativa): Tasks 8, 9 ✓
- Comentário `## Codex Evidence` na issue remota, editado in-place, gerado pelo orchestrator: Task 7 ✓ (depende do `comment:update` da Fase 2)
- Resumo no PR/workpad: o corpo de PR do Finalizer (Fase 1) e o workpad (Fase 2) podem incorporar `evidence_comment_body/2` — ligação feita na Task 7.
- Deviation documentada: imagens no comentário remoto = URLs servidas pelo Symphony; upload nativo (Linear/Jira) fica para 3b.
