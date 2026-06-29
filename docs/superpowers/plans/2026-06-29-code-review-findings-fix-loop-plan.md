# Code Review — Structured Findings + Fix Loop Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer a fresh subagent per task with review between tasks. Replace example commands with this repo's real tools (Elixir `mix`, tracker `npm`/`vitest`).

**Goal:** Mirror Jean's **Review Comments** flow — run an AI code review of an issue's workspace changes that produces **structured findings** (severity + `repo`/`path`/`line` + explanation + suggested fix), persist and track each finding's state (`open` → `fixing` → `fixed` / `dismissed`), and offer per-finding **Fix**, batch **Fix all**, and an auto-apply **Yolo** variant that dispatch agent fix-turns scoped to the finding(s).

**Architecture:** One source-agnostic `ReviewFinding` JSON contract is emitted by **both** finding sources and persisted in a new `review_findings` table. Source 1 (Symphony's existing review capability — the realistic server analog of Bugbot/security-review is a **structured-output agent review turn**) and Source 2 (a customizable per-project **review** prompt template) both run through one `ReviewRunner` that mirrors `Evidence.Judge`'s "call agent (no tools) → parse JSON → persist" pattern, fed the workspace diff from the `Evidence.GitDiff`/`Evidence.Commits` layer. A `ReviewFindings` context (mirroring `Evidence.Store`) does CRUD + state transitions. A "Fix" renders a built-in `fix-finding` prompt template embedding the finding + file context and dispatches through the **existing** dispatch path (the Magic Commands `run-prompt-template` endpoint, which itself rides `IssueDispatch` + execution-control `model/effort/mode`); the finding moves to `fixing`. The tracker gets a **Review** tab (Jean's `ReviewCommentsDialog` analog) rendering grouped findings with per-finding actions.

**Tech Stack:** Elixir + Ecto migration + Jason, Phoenix controller + ExUnit, React 19 + TanStack-style hook + shadcn/ui + lucide icons, vitest, i18n (`en` + `pt-BR`).

---

## Depends on / relates to

- **`docs/superpowers/plans/2026-06-27-magic-prompts-templates-plan.md`** — the `prompt_templates` table + `PromptTemplates` context (`render/2`, per-template `agent_kind/model/effort/mode`, `Builtin` seeding). This plan **adds two built-in templates** (`code-review` is already seeded there as the finding-source template; we **formalize its body** to emit the findings JSON contract, and we **add `fix-finding`**). Do not re-create the table or context.
- **`docs/superpowers/plans/2026-06-27-magic-commands-palette-plan.md`** — the `POST /projects/:project_slug/issues/:identifier/run-prompt-template` endpoint that renders a template + dispatches via the existing dispatch path. The per-finding **Fix** reuses this dispatch path (render `fix-finding` → dispatch). Review can also be launched from the Magic palette's `code-review` command.
- **`docs/superpowers/plans/2026-06-26-execution-control-model-mode-plan.md`** (Plan 2a) — Plan/Build/**Yolo** execution mode + `model`/`effort`/`mode` threaded through `IssueDispatch` and `dispatchIssueAgent`. **Yolo** = the auto-apply variant: the fix dispatch passes `mode: "yolo"`.
- **Diff layer** — `elixir/lib/symphony_elixir/evidence/git_diff.ex` (`changed_files/1`) and `elixir/lib/symphony_elixir/evidence/commits.ex` (`list/2`, `show/3` with per-file `patch`). The review prompt is fed the workspace diff.
- **Structured-AI precedent** — `elixir/lib/symphony_elixir/evidence/judge.ex` (pure `build_prompt/1` + `parse_verdict/1`, `verdict/2` with injected `:runner`/`:input_fn`, `default_runner/2` running `CodingAgent.run` with `dynamic_tools: []`). `ReviewRunner` mirrors this exactly.
- **Persistence precedent** — `elixir/lib/symphony_elixir/evidence/record.ex` + `store.ex` + migration `20260610000100_create_issue_evidence.exs` (issue-scoped via `project_id` FK + `issue_identifier` string; confirmed by `IssueRecord` whose `identifier` is a `:string`).

### Jean references

- `src/components/magic/ReviewCommentsDialog.tsx` (+ `ReviewCommentsDialog.test.tsx`) — the findings dialog with per-finding actions, "Fix all", finding-state tracking. **Maps to** `tracker/.../ReviewPanel.tsx` + `ReviewFindingCard.tsx`.
- `src/components/magic/MagicModal.tsx` — the Magic command palette that launches Review. **Maps to** the Magic Commands palette's `code-review` command (separate plan) which now `POST`s `/review`.
- Pattern parity: `src/components/magic/ResolveConflictsDialog.tsx`, `UpdatePrDialog.tsx`, `ReleaseNotesDialog.tsx` — one-shot flow + result panel shape.
- Feature blurb: "Magic Commands — … code review **WITH FINDING TRACKING** … customizable per-prompt model/backend/effort selection." Finding tracking = the `status` column + state transitions; per-prompt model/backend/effort = inherited from the prompt template + execution-control dispatch.

---

## The ReviewFinding contract (the spine)

This is the **single** typed shape every source emits and the UI consumes. Field names are identical across the agent JSON, the Ecto schema, and the React type (snake_case on the wire/DB, camelCase in TS). **Self-review anchor: any later task that renames a field is a bug.**

**Agent-emitted JSON** (one object per finding; the agent returns a JSON **array**):

```json
{
  "severity": "warning",
  "repo": "tracker",
  "path": "src/services/issues.ts",
  "line": 42,
  "end_line": 48,
  "title": "Unhandled null from normalizeIssue",
  "body": "normalizeIssue can return null when the DTO lacks an id; the caller dereferences it on the next line.",
  "suggested_fix": "Guard the return value and throw a typed error before dereferencing.",
  "fix_instructions": "In issues.ts around line 42, add a null check after normalizeIssue and throw ClientError when null."
}
```

| Field | Type | Source | Notes |
| --- | --- | --- | --- |
| `severity` | `"warning" \| "suggestion" \| "praise"` | agent | enum; anything else → dropped |
| `repo` | string | agent | workspace repo name (matches `GitDiff.changed_files` keys) |
| `path` | string | agent | repo-relative path |
| `line` | integer \| null | agent | 1-based start line; null = file-level |
| `end_line` | integer \| null | agent | inclusive end of range; null = single line |
| `title` | string | agent | short headline |
| `body` | string | agent | explanation |
| `suggested_fix` | string \| null | agent | human-readable suggestion (rendered as a code/quote block) |
| `fix_instructions` | string \| null | agent | imperative text fed to the fix-turn; falls back to `title`+`body`+`suggested_fix` when null |
| `source` | `"review" \| "template"` | **server-stamped** | `review` = built-in structured review turn (Bugbot/security analog); `template` = project-customized review template |
| `status` | `"open" \| "fixing" \| "fixed" \| "dismissed"` | **server-stamped** | starts `open` |
| `run_id` | string | **server-stamped** | groups findings from one review run |
| `project_id` | FK | **server-stamped** | DB only |
| `issue_identifier` | string | **server-stamped** | DB only |
| `id`, `inserted_at`, `updated_at` | — | **server** | DB only |

**Fix → dispatch mapping:** render the built-in `fix-finding` template with `%{issue, finding, file_context}` → dispatch via the `run-prompt-template` path with `mode` (`build` default, `yolo` for auto-apply) → transition the finding `open → fixing`. **Fix all** renders one consolidated prompt embedding every selected `open` finding and dispatches a single run (default) so concurrent agent runs don't collide; all selected findings move to `fixing`.

---

## File Structure

**Create (backend):**
- `elixir/lib/symphony_elixir/code_review/finding.ex` — Ecto schema + changeset for `review_findings`.
- `elixir/lib/symphony_elixir/code_review/findings.ex` — context: `create_many/3`, `list/2`, `get/1`, `update_status/2`, `delete_run/3`.
- `elixir/lib/symphony_elixir/code_review/review_runner.ex` — pure `build_prompt/1` + `parse_findings/1`; `run/2` with injected `:runner`/`:input_fn` (mirrors `Evidence.Judge`).
- `elixir/lib/symphony_elixir/code_review/review_input.ex` — assembles `%{criteria, diff}` from `Evidence.GitDiff` + `Evidence.Commits`.
- `elixir/lib/symphony_elixir/code_review/fix_dispatcher.ex` — renders the `fix-finding` template + reads file context + dispatches + flips status.
- `elixir/priv/repo/migrations/20260629120000_create_review_findings.exs`
- tests: `finding_test.exs`, `findings_test.exs`, `review_runner_test.exs`, `review_input_test.exs`, `fix_dispatcher_test.exs`, `review_controller_test.exs`.

**Modify (backend):**
- `elixir/lib/symphony_elixir/prompt_templates/builtin.ex` (from Magic Prompts plan) — formalize `code-review` body to emit the JSON contract; add `fix-finding`.
- `elixir/lib/symphony_elixir_web/controllers/tracker/review_controller.ex` — **create** (`run`, `index`, `fix`, `fix_all`, `update`).
- `elixir/lib/symphony_elixir_web/router.ex` — add 5 review routes.

**Create (tracker):**
- `tracker/src/types/reviewFinding.ts`
- `tracker/src/services/reviewFindings.ts`
- `tracker/src/hooks/useReviewFindings.ts`
- `tracker/src/components/issues/issue-detail/ReviewPanel.tsx`
- `tracker/src/components/issues/issue-detail/ReviewFindingCard.tsx`
- tests: `reviewFindings.test.ts`, `useReviewFindings.test.tsx`, `ReviewPanel.test.tsx`, `ReviewFindingCard.test.tsx`.

**Modify (tracker):**
- `tracker/src/components/issues/IssueDrawer.tsx` — add the `review` tab to `TAB_DEFS` + a `TabsContent`.
- `tracker/locales/en/tracker.json` + `tracker/locales/pt-BR/tracker.json` — `issue.review.*` keys.

---

## Task 1: review_findings schema + migration

**Files:**
- Create: `elixir/priv/repo/migrations/20260629120000_create_review_findings.exs`
- Create: `elixir/lib/symphony_elixir/code_review/finding.ex`
- Test: `elixir/test/symphony_elixir/code_review/finding_test.exs`

- [ ] **Step 1: Write the migration** (mirror `20260610000100_create_issue_evidence.exs`)

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateReviewFindings do
  use Ecto.Migration

  def change do
    create table(:review_findings) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:issue_identifier, :string, null: false)
      add(:run_id, :string, null: false)
      add(:source, :string, null: false, default: "review")
      add(:severity, :string, null: false)
      add(:repo, :string)
      add(:path, :string)
      add(:line, :integer)
      add(:end_line, :integer)
      add(:title, :string, null: false)
      add(:body, :text, null: false, default: "")
      add(:suggested_fix, :text)
      add(:fix_instructions, :text)
      add(:status, :string, null: false, default: "open")

      timestamps(type: :utc_datetime_usec)
    end

    create(index(:review_findings, [:project_id, :issue_identifier]))
    create(index(:review_findings, [:project_id, :issue_identifier, :status]))
    create(index(:review_findings, [:project_id, :issue_identifier, :run_id]))
  end
end
```

- [ ] **Step 2: Write failing schema test**

```elixir
defmodule SymphonyElixir.CodeReview.FindingTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.CodeReview.Finding

  @valid %{
    project_id: 1,
    issue_identifier: "DEMO-1",
    run_id: "r1",
    source: "review",
    severity: "warning",
    title: "X",
    body: "Y",
    status: "open"
  }

  test "valid changeset" do
    assert Finding.changeset(%Finding{}, @valid).valid?
  end

  test "requires project_id, issue_identifier, run_id, severity, title" do
    cs = Finding.changeset(%Finding{}, %{})
    refute cs.valid?

    for field <- [:project_id, :issue_identifier, :run_id, :severity, :title] do
      assert %{} = errors_on(cs)
      assert Keyword.has_key?(cs.errors, field)
    end
  end

  test "rejects unknown severity" do
    refute Finding.changeset(%Finding{}, %{@valid | severity: "blocker"}).valid?
  end

  test "rejects unknown status and source" do
    refute Finding.changeset(%Finding{}, %{@valid | status: "wip"}).valid?
    refute Finding.changeset(%Finding{}, %{@valid | source: "bugbot"}).valid?
  end
end
```

- [ ] **Step 3: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/code_review/finding_test.exs -o`
  Expected: FAIL with `module SymphonyElixir.CodeReview.Finding is not available`.

- [ ] **Step 4: Implement the schema** (mirror `Evidence.Record`)

```elixir
defmodule SymphonyElixir.CodeReview.Finding do
  @moduledoc "A single structured code-review finding for an issue (source-agnostic)."

  use Ecto.Schema

  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @severities ~w(warning suggestion praise)
  @statuses ~w(open fixing fixed dismissed)
  @sources ~w(review template)

  @type t :: %__MODULE__{}

  schema "review_findings" do
    field(:issue_identifier, :string)
    field(:run_id, :string)
    field(:source, :string, default: "review")
    field(:severity, :string)
    field(:repo, :string)
    field(:path, :string)
    field(:line, :integer)
    field(:end_line, :integer)
    field(:title, :string)
    field(:body, :string, default: "")
    field(:suggested_fix, :string)
    field(:fix_instructions, :string)
    field(:status, :string, default: "open")

    belongs_to(:project, Project)

    timestamps(type: :utc_datetime_usec)
  end

  @spec severities() :: [String.t()]
  def severities, do: @severities

  @spec statuses() :: [String.t()]
  def statuses, do: @statuses

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(finding, attrs) do
    finding
    |> cast(attrs, [
      :project_id,
      :issue_identifier,
      :run_id,
      :source,
      :severity,
      :repo,
      :path,
      :line,
      :end_line,
      :title,
      :body,
      :suggested_fix,
      :fix_instructions,
      :status
    ])
    |> validate_required([:project_id, :issue_identifier, :run_id, :severity, :title])
    |> validate_inclusion(:severity, @severities)
    |> validate_inclusion(:status, @statuses)
    |> validate_inclusion(:source, @sources)
  end
end
```

- [ ] **Step 5: Migrate + run (expect pass)** — `cd elixir && mix ecto.migrate && mix test test/symphony_elixir/code_review/finding_test.exs -o`
  Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/priv/repo/migrations/20260629120000_create_review_findings.exs elixir/lib/symphony_elixir/code_review/finding.ex elixir/test/symphony_elixir/code_review/finding_test.exs
git commit -m "feat(review): review_findings schema + migration"
```

---

## Task 2: ReviewFindings context (create_many / list / get / update_status / delete_run)

**Files:**
- Create: `elixir/lib/symphony_elixir/code_review/findings.ex`
- Test: `elixir/test/symphony_elixir/code_review/findings_test.exs`

The context mirrors `Evidence.Store`: resolve the project via `LocalTracker.Context.get_project/1`, scope every query by `project_id` + `issue_identifier`. `create_many/3` stamps `run_id`/`source`/`status: "open"` on every row and inserts in one transaction. `list/2` orders by severity weight (`warning` < `suggestion` < `praise`) then `inserted_at`. `update_status/2` validates the target status and the transition.

- [ ] **Step 1: Write failing test**

```elixir
defmodule SymphonyElixir.CodeReview.FindingsTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.CodeReview.Findings
  alias SymphonyElixir.LocalTracker.Context

  setup do
    {:ok, project} = Context.create_project(%{slug: "demo", name: "Demo"})
    %{project: project}
  end

  test "create_many stamps run_id/source/status and returns inserted findings", %{project: project} do
    attrs = [
      %{severity: "warning", repo: "tracker", path: "a.ts", line: 1, title: "A", body: "b"},
      %{severity: "praise", repo: "tracker", path: "b.ts", title: "B", body: "c"}
    ]

    {:ok, findings} =
      Findings.create_many(project.slug, "DEMO-1", attrs, run_id: "r1", source: "review")

    assert length(findings) == 2
    assert Enum.all?(findings, &(&1.run_id == "r1" and &1.source == "review" and &1.status == "open"))
  end

  test "list orders warning before praise", %{project: project} do
    {:ok, _} =
      Findings.create_many(
        project.slug,
        "DEMO-1",
        [
          %{severity: "praise", title: "P", body: ""},
          %{severity: "warning", title: "W", body: ""}
        ],
        run_id: "r1"
      )

    {:ok, [first, second]} = Findings.list(project.slug, "DEMO-1")
    assert first.severity == "warning"
    assert second.severity == "praise"
  end

  test "update_status open -> fixing -> fixed", %{project: project} do
    {:ok, [finding]} =
      Findings.create_many(project.slug, "DEMO-1", [%{severity: "warning", title: "W", body: ""}], run_id: "r1")

    {:ok, fixing} = Findings.update_status(finding.id, "fixing")
    assert fixing.status == "fixing"
    {:ok, fixed} = Findings.update_status(finding.id, "fixed")
    assert fixed.status == "fixed"
  end

  test "update_status rejects unknown status", %{project: project} do
    {:ok, [finding]} =
      Findings.create_many(project.slug, "DEMO-1", [%{severity: "warning", title: "W", body: ""}], run_id: "r1")

    assert {:error, :invalid_status} = Findings.update_status(finding.id, "wip")
  end

  test "get returns not_found for missing id" do
    assert {:error, :not_found} = Findings.get(-1)
  end

  test "delete_run removes only that run's findings", %{project: project} do
    {:ok, _} = Findings.create_many(project.slug, "DEMO-1", [%{severity: "warning", title: "A", body: ""}], run_id: "r1")
    {:ok, _} = Findings.create_many(project.slug, "DEMO-1", [%{severity: "warning", title: "B", body: ""}], run_id: "r2")

    {:ok, 1} = Findings.delete_run(project.slug, "DEMO-1", "r1")
    {:ok, remaining} = Findings.list(project.slug, "DEMO-1")
    assert Enum.map(remaining, & &1.run_id) == ["r2"]
  end
end
```

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/code_review/findings_test.exs -o`
  Expected: FAIL (`Findings is not available`).

- [ ] **Step 3: Implement the context**

```elixir
defmodule SymphonyElixir.CodeReview.Findings do
  @moduledoc """
  Persistence + state transitions for structured code-review findings, scoped to
  an issue by `project_id` + `issue_identifier` (mirrors `Evidence.Store`).
  """

  import Ecto.Query

  alias SymphonyElixir.CodeReview.Finding
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @severity_weight %{"warning" => 0, "suggestion" => 1, "praise" => 2}

  @spec create_many(String.t(), String.t(), [map()], keyword()) ::
          {:ok, [Finding.t()]} | {:error, term()}
  def create_many(project_slug, identifier, attrs_list, opts \\ []) when is_list(attrs_list) do
    with {:ok, project} <- Context.get_project(project_slug) do
      run_id = Keyword.get(opts, :run_id, generate_run_id())
      source = Keyword.get(opts, :source, "review")
      now = DateTime.utc_now()

      rows =
        Enum.map(attrs_list, fn attrs ->
          attrs
          |> Map.merge(%{
            project_id: project.id,
            issue_identifier: identifier,
            run_id: run_id,
            source: source,
            status: "open"
          })
          |> insert_finding(now)
        end)

      case Enum.split_with(rows, &match?({:ok, _}, &1)) do
        {ok, []} -> {:ok, Enum.map(ok, fn {:ok, finding} -> finding end)}
        {_ok, [{:error, changeset} | _]} -> {:error, changeset}
      end
    end
  end

  @spec list(String.t(), String.t()) :: {:ok, [Finding.t()]} | {:error, term()}
  def list(project_slug, identifier) do
    with {:ok, project} <- Context.get_project(project_slug) do
      findings =
        Repo.all(
          from(f in Finding,
            where: f.project_id == ^project.id and f.issue_identifier == ^identifier,
            order_by: [asc: f.inserted_at]
          )
        )
        |> Enum.sort_by(&{Map.get(@severity_weight, &1.severity, 9), &1.inserted_at})

      {:ok, findings}
    end
  end

  @spec get(integer()) :: {:ok, Finding.t()} | {:error, :not_found}
  def get(id) do
    case Repo.get(Finding, id) do
      nil -> {:error, :not_found}
      finding -> {:ok, finding}
    end
  end

  @spec update_status(integer(), String.t()) ::
          {:ok, Finding.t()} | {:error, :not_found | :invalid_status | Ecto.Changeset.t()}
  def update_status(id, status) do
    cond do
      status not in Finding.statuses() ->
        {:error, :invalid_status}

      true ->
        with {:ok, finding} <- get(id) do
          finding
          |> Finding.changeset(%{status: status})
          |> Repo.update()
        end
    end
  end

  @spec delete_run(String.t(), String.t(), String.t()) ::
          {:ok, non_neg_integer()} | {:error, term()}
  def delete_run(project_slug, identifier, run_id) do
    with {:ok, project} <- Context.get_project(project_slug) do
      {count, _} =
        Repo.delete_all(
          from(f in Finding,
            where:
              f.project_id == ^project.id and f.issue_identifier == ^identifier and
                f.run_id == ^run_id
          )
        )

      {:ok, count}
    end
  end

  defp insert_finding(attrs, now) do
    %Finding{inserted_at: now, updated_at: now}
    |> Finding.changeset(attrs)
    |> Repo.insert()
  end

  defp generate_run_id do
    DateTime.utc_now()
    |> Calendar.strftime("%Y%m%d%H%M%S")
    |> Kernel.<>("-#{System.unique_integer([:positive])}")
  end
end
```

- [ ] **Step 4: Run (expect pass)** — `cd elixir && mix test test/symphony_elixir/code_review/findings_test.exs -o`
  Expected: PASS.

> If `Context.create_project/1` is not the real signature, replace the `setup` block with the project factory used by `Evidence.Store`'s tests (`test/symphony_elixir/evidence/store_test.exs`); the production code does not depend on the factory.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/code_review/findings.ex elixir/test/symphony_elixir/code_review/findings_test.exs
git commit -m "feat(review): ReviewFindings context (create_many/list/update_status/delete_run)"
```

---

## Task 3: ReviewInput (diff assembler)

**Files:**
- Create: `elixir/lib/symphony_elixir/code_review/review_input.ex`
- Test: `elixir/test/symphony_elixir/code_review/review_input_test.exs`

Assembles the review prompt input from the workspace: `criteria` (issue title + description) and `diff` (per-repo unified diff). Reuses the same `RunContract.repo_states` + `git diff origin/<base>...HEAD` approach as `Evidence.Judge.diff_text/1`, but exposes it as a small testable module. `git` calls are isolated behind an injectable `:git_fn` so the test is pure.

- [ ] **Step 1: Write failing test**

```elixir
defmodule SymphonyElixir.CodeReview.ReviewInputTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.CodeReview.ReviewInput

  test "build/2 joins criteria and labels each repo diff" do
    issue = %{title: "Fix login", description: "Users cannot log in"}

    git_fn = fn _repo ->
      %{"tracker" => "diff --git a/x b/x", "elixir" => "diff --git a/y b/y"}
    end

    input = ReviewInput.build("/ws", issue: issue, git_fn: git_fn)

    assert input.criteria =~ "Fix login"
    assert input.criteria =~ "Users cannot log in"
    assert input.diff =~ "### tracker"
    assert input.diff =~ "diff --git a/x b/x"
    assert input.diff =~ "### elixir"
  end

  test "build/2 tolerates empty diff" do
    input = ReviewInput.build("/ws", issue: %{title: "T"}, git_fn: fn _ -> %{} end)
    assert input.diff == "(no changes detected)"
  end
end
```

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/code_review/review_input_test.exs -o`

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.CodeReview.ReviewInput do
  @moduledoc """
  Assembles the code-review prompt input (`criteria` + per-repo `diff`) from an
  issue workspace. Mirrors `Evidence.Judge.diff_text/1` but is isolated behind an
  injectable `:git_fn` so it is unit-testable without a real workspace.
  """

  alias SymphonyElixir.RunContract

  @type input :: %{criteria: String.t(), diff: String.t()}

  @spec build(Path.t(), keyword()) :: input()
  def build(workspace, opts \\ []) do
    issue = Keyword.get(opts, :issue, %{})
    git_fn = Keyword.get(opts, :git_fn, &repo_diffs/1)

    %{criteria: criteria(issue), diff: format_diff(git_fn.(workspace))}
  end

  defp criteria(issue) do
    [Map.get(issue, :title), Map.get(issue, :description) || Map.get(issue, :body)]
    |> Enum.filter(&is_binary/1)
    |> Enum.join("\n\n")
    |> blank_to_dash()
  end

  defp format_diff(map) when map_size(map) == 0, do: "(no changes detected)"

  defp format_diff(map) do
    map
    |> Enum.sort_by(fn {repo, _} -> repo end)
    |> Enum.map_join("\n\n", fn {repo, diff} -> "### #{repo}\n```diff\n#{diff}\n```" end)
  end

  defp repo_diffs(workspace) do
    workspace
    |> RunContract.repo_states()
    |> Map.new(fn repo -> {repo.name, repo_diff(repo)} end)
    |> Enum.reject(fn {_name, diff} -> String.trim(diff) == "" end)
    |> Map.new()
  end

  defp repo_diff(%{path: path} = repo) do
    base = Map.get(repo, :default_branch)
    args = if is_binary(base), do: ["diff", "origin/#{base}...HEAD"], else: ["diff", "HEAD"]

    case System.cmd("git", args, cd: path, stderr_to_stdout: true) do
      {out, 0} -> out
      _ -> ""
    end
  end

  defp blank_to_dash(""), do: "(none provided)"
  defp blank_to_dash(text), do: text
end
```

- [ ] **Step 4: Run (expect pass)** — `cd elixir && mix test test/symphony_elixir/code_review/review_input_test.exs -o`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/code_review/review_input.ex elixir/test/symphony_elixir/code_review/review_input_test.exs
git commit -m "feat(review): ReviewInput diff assembler"
```

---

## Task 4: ReviewRunner (call agent → parse findings)

**Files:**
- Create: `elixir/lib/symphony_elixir/code_review/review_runner.ex`
- Test: `elixir/test/symphony_elixir/code_review/review_runner_test.exs`

Mirrors `Evidence.Judge`: a pure `build_prompt/1` (template body + input), a pure `parse_findings/1` (extract the JSON array, decode, normalize, drop invalid), and `run/2` with an injected `:runner` (so the LLM is never called in unit tests) and `:input_fn`. `default_runner/2` mirrors `Judge.default_runner/2` exactly: `CodingAgent.run` with `dynamic_tools: []`, a `tool_executor` returning `{:error, :no_tools}`, and an `on_message` delta collector. The prompt body comes from the rendered template (passed in by the controller) so Source 1 (built-in `code-review`) and Source 2 (project override) share the same runner.

- [ ] **Step 1: Write failing test**

```elixir
defmodule SymphonyElixir.CodeReview.ReviewRunnerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.CodeReview.ReviewRunner

  test "build_prompt embeds template body + criteria + diff" do
    prompt =
      ReviewRunner.build_prompt(%{
        template_body: "Review issue DEMO-1.",
        criteria: "Fix login",
        diff: "### tracker\n```diff\n+x\n```"
      })

    assert prompt =~ "Review issue DEMO-1."
    assert prompt =~ "Fix login"
    assert prompt =~ "+x"
    assert prompt =~ "JSON array"
  end

  test "parse_findings extracts and normalizes a JSON array" do
    text = """
    Here is my review:
    [
      {"severity":"warning","repo":"tracker","path":"a.ts","line":4,"end_line":6,
       "title":"Null deref","body":"explanation","suggested_fix":"guard it",
       "fix_instructions":"add a guard"},
      {"severity":"praise","repo":"tracker","path":"b.ts","title":"Nice","body":""}
    ]
    Done.
    """

    findings = ReviewRunner.parse_findings(text)
    assert length(findings) == 2
    assert hd(findings).severity == "warning"
    assert hd(findings).line == 4
    assert hd(findings).end_line == 6
  end

  test "parse_findings drops entries with invalid severity or missing title" do
    text = ~s([{"severity":"blocker","title":"x"},{"severity":"warning"},{"severity":"warning","title":"keep"}])
    findings = ReviewRunner.parse_findings(text)
    assert Enum.map(findings, & &1.title) == ["keep"]
  end

  test "parse_findings returns [] for non-JSON" do
    assert ReviewRunner.parse_findings("no json here") == []
  end

  test "run/2 uses injected runner + input_fn and returns parsed findings" do
    runner = fn _ws, _prompt -> {:ok, ~s([{"severity":"warning","title":"t","body":"b"}])} end
    input_fn = fn _ws -> %{criteria: "c", diff: "d"} end

    {:ok, findings} =
      ReviewRunner.run("/ws", template_body: "Review.", runner: runner, input_fn: input_fn, issue: %{})

    assert [%{severity: "warning", title: "t"}] = findings
  end

  test "run/2 surfaces runner errors" do
    runner = fn _ws, _prompt -> {:error, :unavailable} end
    assert {:error, :unavailable} = ReviewRunner.run("/ws", template_body: "x", runner: runner, input_fn: fn _ -> %{criteria: "", diff: ""} end, issue: %{})
  end
end
```

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/code_review/review_runner_test.exs -o`

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.CodeReview.ReviewRunner do
  @moduledoc """
  Runs a structured code-review turn and parses the findings JSON. Mirrors
  `Evidence.Judge`: `build_prompt/1` and `parse_findings/1` are pure and unit
  tested; `run/2` is tested with an injected `:runner`/`:input_fn`. The review
  agent runs with NO tools (read-only review) and must emit a JSON array of
  findings matching the ReviewFinding contract.
  """

  require Logger

  alias SymphonyElixir.Codex.CodingAgent
  alias SymphonyElixir.CodeReview.ReviewInput

  @severities ~w(warning suggestion praise)

  @contract """
  Respond with a SINGLE JSON array and nothing else. Each element:
  {"severity":"warning"|"suggestion"|"praise","repo":string,"path":string,
   "line":integer|null,"end_line":integer|null,"title":string,"body":string,
   "suggested_fix":string|null,"fix_instructions":string|null}
  Use "warning" for correctness/security issues, "suggestion" for improvements,
  "praise" for notably good code. Cite real file:line from the diff. Do not
  modify code. If there is nothing to report, return [].
  """

  @type finding :: %{required(:severity) => String.t(), required(:title) => String.t(), optional(atom()) => term()}

  @spec build_prompt(%{template_body: String.t(), criteria: String.t(), diff: String.t()}) :: String.t()
  def build_prompt(%{template_body: body, criteria: criteria, diff: diff}) do
    """
    #{body}

    ## Ticket acceptance criteria
    #{criteria}

    ## Change to review (git diff)
    #{diff}

    ## Output format
    #{@contract}
    """
    |> String.trim()
  end

  @spec parse_findings(String.t()) :: [finding()]
  def parse_findings(text) when is_binary(text) do
    with [json] <- Regex.run(~r/\[.*\]/s, text),
         {:ok, list} when is_list(list) <- Jason.decode(json) do
      list
      |> Enum.map(&normalize/1)
      |> Enum.reject(&is_nil/1)
    else
      _ -> []
    end
  end

  def parse_findings(_text), do: []

  @spec run(Path.t(), keyword()) :: {:ok, [finding()]} | {:error, term()}
  def run(workspace, opts) do
    template_body = Keyword.fetch!(opts, :template_body)
    issue = Keyword.get(opts, :issue, %{})
    input_fn = Keyword.get(opts, :input_fn, fn ws -> ReviewInput.build(ws, issue: issue) end)
    runner = Keyword.get(opts, :runner, &default_runner(&1, &2, issue))

    input = input_fn.(workspace)
    prompt = build_prompt(Map.put(input, :template_body, template_body))

    case runner.(workspace, prompt) do
      {:ok, text} -> {:ok, parse_findings(text)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp normalize(%{} = raw) do
    severity = to_string(raw["severity"] || raw[:severity])
    title = trimmed(raw["title"] || raw[:title])

    if severity in @severities and title != nil do
      %{
        severity: severity,
        title: title,
        body: to_string(raw["body"] || raw[:body] || ""),
        repo: trimmed(raw["repo"] || raw[:repo]),
        path: trimmed(raw["path"] || raw[:path]),
        line: integer_or_nil(raw["line"] || raw[:line]),
        end_line: integer_or_nil(raw["end_line"] || raw[:end_line]),
        suggested_fix: trimmed(raw["suggested_fix"] || raw[:suggested_fix]),
        fix_instructions: trimmed(raw["fix_instructions"] || raw[:fix_instructions])
      }
    end
  end

  defp normalize(_raw), do: nil

  defp trimmed(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp trimmed(_value), do: nil

  defp integer_or_nil(value) when is_integer(value), do: value
  defp integer_or_nil(_value), do: nil

  defp default_runner(workspace, prompt, issue) do
    review_issue = Map.merge(%{id: "review", identifier: "review", title: "Code review"}, issue)
    {:ok, collector} = Agent.start_link(fn -> "" end)

    on_message = fn message ->
      delta = extract_delta(message)
      if is_binary(delta) and delta != "", do: Agent.update(collector, &(&1 <> delta))
    end

    opts = [dynamic_tools: [], tool_executor: fn _t, _a -> {:error, :no_tools} end, on_message: on_message]

    try do
      case CodingAgent.run(workspace, prompt, review_issue, opts) do
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

- [ ] **Step 4: Run (expect pass)** — `cd elixir && mix test test/symphony_elixir/code_review/review_runner_test.exs -o`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/code_review/review_runner.ex elixir/test/symphony_elixir/code_review/review_runner_test.exs
git commit -m "feat(review): ReviewRunner (agent review turn -> findings JSON)"
```

---

## Task 5: Built-in templates — formalize `code-review`, add `fix-finding`

**Files:**
- Modify: `elixir/lib/symphony_elixir/prompt_templates/builtin.ex` (from Magic Prompts plan)
- Test: extend `elixir/test/symphony_elixir/prompt_templates/builtin_test.exs` (created by that plan)

The Magic Prompts plan seeds a `code-review` built-in. **Formalize its body** so the review turn emits the contract, and **add a `fix-finding` template** that the fix loop renders. Both use Solid variables (`{{ issue.identifier }}`, and for `fix-finding`: `{{ finding.title }}`, `{{ finding.path }}`, `{{ finding.line }}`, `{{ finding.body }}`, `{{ finding.suggested_fix }}`, `{{ finding.fix_instructions }}`, `{{ file_context }}`).

> If the Magic Prompts plan has not landed yet, create `prompt_templates/builtin.ex` with at least these two entries following that plan's `@templates` shape; do not block on the full template store.

- [ ] **Step 1: Write failing test** (extend the Builtin test)

```elixir
test "code-review body instructs JSON-array findings output" do
  tpl = Enum.find(Builtin.all(), &(&1.slug == "code-review"))
  assert tpl
  assert tpl.body =~ "JSON array"
  assert Solid.parse!(tpl.body)
end

test "fix-finding template exists and parses with finding vars" do
  tpl = Enum.find(Builtin.all(), &(&1.slug == "fix-finding"))
  assert tpl
  assert tpl.category == "review"
  assert tpl.body =~ "{{ finding.title }}"
  assert tpl.body =~ "{{ finding.path }}"
  assert Solid.parse!(tpl.body)
end
```

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/prompt_templates/builtin_test.exs -o`

- [ ] **Step 3: Implement** — update/add the two `@templates` entries

```elixir
%{
  slug: "code-review",
  name: "AI Code Review",
  category: "review",
  description: "Structured findings (warning/suggestion/praise) for the workspace diff.",
  effort: "high",
  body: """
  Review the changes for issue {{ issue.identifier }} — {{ issue.title }}.
  Act as a strict, senior reviewer. Examine the git diff for correctness,
  security, edge cases, and clarity. Produce STRUCTURED FINDINGS as a JSON array
  (severity warning|suggestion|praise, repo, path, line, end_line, title, body,
  suggested_fix, fix_instructions). Cite real file:line. Do not modify code.
  """
},
%{
  slug: "fix-finding",
  name: "Fix review finding",
  category: "review",
  description: "Apply a fix for a single code-review finding.",
  mode: "build",
  body: """
  Resolve this code-review finding on issue {{ issue.identifier }}.

  File: {{ finding.path }}:{{ finding.line }}
  Severity: {{ finding.severity }}
  Title: {{ finding.title }}

  Problem:
  {{ finding.body }}

  Suggested fix:
  {{ finding.suggested_fix }}

  Instructions:
  {{ finding.fix_instructions }}

  Relevant file context:
  {{ file_context }}

  Apply the minimal change that resolves only this finding. Do not refactor
  unrelated code. Keep the workspace building and tests passing.
  """
}
```

- [ ] **Step 4: Run (expect pass)** — `cd elixir && mix test test/symphony_elixir/prompt_templates/builtin_test.exs -o`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/prompt_templates/builtin.ex elixir/test/symphony_elixir/prompt_templates/builtin_test.exs
git commit -m "feat(review): code-review JSON contract + fix-finding built-in templates"
```

---

## Task 6: FixDispatcher (render fix template → dispatch → flip status)

**Files:**
- Create: `elixir/lib/symphony_elixir/code_review/fix_dispatcher.ex`
- Test: `elixir/test/symphony_elixir/code_review/fix_dispatcher_test.exs`

A "Fix" renders the `fix-finding` template with the finding + file context, dispatches through the **existing** dispatch path (`IssueDispatch.resume/3`, which Plan 2a extends with `mode`), then flips the finding to `fixing`. `fix_all/4` renders ONE consolidated prompt embedding every selected `open` finding and dispatches a single run. The dispatch boundary is injected (`:dispatch_fn`) so the test asserts the instructions + mode without launching a real agent. File context is read capped from the workspace repo (injectable `:read_fn`).

- [ ] **Step 1: Write failing test**

```elixir
defmodule SymphonyElixir.CodeReview.FixDispatcherTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.CodeReview.{FixDispatcher, Findings}
  alias SymphonyElixir.LocalTracker.Context

  setup do
    {:ok, project} = Context.create_project(%{slug: "demo", name: "Demo"})

    {:ok, [finding]} =
      Findings.create_many(
        project.slug,
        "DEMO-1",
        [%{severity: "warning", repo: "tracker", path: "a.ts", line: 4, title: "Null deref", body: "explain", fix_instructions: "add a guard"}],
        run_id: "r1"
      )

    %{project: project, finding: finding}
  end

  test "fix renders instructions with finding + context and dispatches build mode", %{project: project, finding: finding} do
    test_pid = self()

    dispatch_fn = fn _project, identifier, opts ->
      send(test_pid, {:dispatched, identifier, opts})
      {:ok, %{run_id: "run-x"}}
    end

    read_fn = fn _ws, _path, _line -> "const x = maybeNull();" end

    {:ok, updated} =
      FixDispatcher.fix(project, "DEMO-1", finding.id,
        mode: "build",
        dispatch_fn: dispatch_fn,
        read_fn: read_fn,
        workspace: "/ws"
      )

    assert updated.status == "fixing"
    assert_received {:dispatched, "DEMO-1", opts}
    assert opts.mode == "build"
    assert opts.instructions =~ "Null deref"
    assert opts.instructions =~ "add a guard"
    assert opts.instructions =~ "const x = maybeNull();"
  end

  test "yolo mode is forwarded to dispatch", %{project: project, finding: finding} do
    test_pid = self()
    dispatch_fn = fn _p, _id, opts -> send(test_pid, {:mode, opts.mode}); {:ok, %{}} end

    {:ok, _} =
      FixDispatcher.fix(project, "DEMO-1", finding.id,
        mode: "yolo",
        dispatch_fn: dispatch_fn,
        read_fn: fn _, _, _ -> "" end,
        workspace: "/ws"
      )

    assert_received {:mode, "yolo"}
  end

  test "fix_all dispatches one run and flips all selected open findings", %{project: project} do
    {:ok, more} =
      Findings.create_many(
        project.slug,
        "DEMO-2",
        [
          %{severity: "warning", repo: "tracker", path: "a.ts", line: 1, title: "A", body: ""},
          %{severity: "suggestion", repo: "tracker", path: "b.ts", line: 2, title: "B", body: ""}
        ],
        run_id: "r2"
      )

    ids = Enum.map(more, & &1.id)
    test_pid = self()
    dispatch_fn = fn _p, _id, opts -> send(test_pid, {:all, opts.instructions}); {:ok, %{}} end

    {:ok, updated} =
      FixDispatcher.fix_all(project, "DEMO-2", ids,
        mode: "build",
        dispatch_fn: dispatch_fn,
        read_fn: fn _, _, _ -> "" end,
        workspace: "/ws"
      )

    assert Enum.all?(updated, &(&1.status == "fixing"))
    assert_received {:all, instructions}
    assert instructions =~ "A"
    assert instructions =~ "B"
  end
end
```

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/code_review/fix_dispatcher_test.exs -o`

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.CodeReview.FixDispatcher do
  @moduledoc """
  Turns a code-review finding into an agent fix-turn: renders the built-in
  `fix-finding` template with the finding + file context, dispatches through the
  existing dispatch path (`IssueDispatch.resume/3`, carrying the execution mode
  from Plan 2a), and transitions the finding to `fixing`.
  """

  alias SymphonyElixir.CodeReview.{Finding, Findings}
  alias SymphonyElixir.IssueDispatch
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.PromptTemplates

  @context_radius 12
  @default_mode "build"

  @spec fix(Project.t(), String.t(), integer(), keyword()) ::
          {:ok, Finding.t()} | {:error, term()}
  def fix(%Project{} = project, identifier, finding_id, opts \\ []) do
    with {:ok, finding} <- Findings.get(finding_id),
         instructions = render_one(project, identifier, finding, opts),
         {:ok, _result} <- dispatch(project, identifier, instructions, opts) do
      Findings.update_status(finding.id, "fixing")
    end
  end

  @spec fix_all(Project.t(), String.t(), [integer()], keyword()) ::
          {:ok, [Finding.t()]} | {:error, term()}
  def fix_all(%Project{} = project, identifier, finding_ids, opts \\ []) when is_list(finding_ids) do
    findings =
      finding_ids
      |> Enum.map(&Findings.get/1)
      |> Enum.flat_map(fn
        {:ok, finding} -> [finding]
        {:error, _} -> []
      end)
      |> Enum.filter(&(&1.status == "open"))

    if findings == [] do
      {:error, :no_open_findings}
    else
      instructions = render_many(project, identifier, findings, opts)

      with {:ok, _result} <- dispatch(project, identifier, instructions, opts) do
        updated =
          Enum.flat_map(findings, fn finding ->
            case Findings.update_status(finding.id, "fixing") do
              {:ok, f} -> [f]
              {:error, _} -> []
            end
          end)

        {:ok, updated}
      end
    end
  end

  defp render_one(_project, identifier, finding, opts) do
    {:ok, body} = fix_template_body()

    PromptTemplates.render(body, %{
      issue: %{identifier: identifier},
      finding: finding_vars(finding, opts),
      file_context: file_context(finding, opts)
    })
  end

  defp render_many(project, identifier, findings, opts) do
    header = "Resolve the following code-review findings on issue #{identifier}. Apply minimal, scoped changes for each.\n\n"

    body =
      findings
      |> Enum.with_index(1)
      |> Enum.map_join("\n\n---\n\n", fn {finding, idx} ->
        "## Finding #{idx}\n" <> render_one(project, identifier, finding, opts)
      end)

    header <> body
  end

  defp dispatch(project, identifier, instructions, opts) do
    dispatch_fn = Keyword.get(opts, :dispatch_fn, &IssueDispatch.resume/3)
    mode = Keyword.get(opts, :mode, @default_mode)

    dispatch_fn.(project, identifier, %{instructions: instructions, mode: mode})
  end

  defp finding_vars(%Finding{} = finding, _opts) do
    %{
      severity: finding.severity,
      path: finding.path,
      line: finding.line,
      title: finding.title,
      body: finding.body,
      suggested_fix: finding.suggested_fix || "(none)",
      fix_instructions: finding.fix_instructions || finding.title
    }
  end

  defp file_context(%Finding{path: nil}, _opts), do: "(no file)"

  defp file_context(%Finding{} = finding, opts) do
    workspace = Keyword.get(opts, :workspace)
    read_fn = Keyword.get(opts, :read_fn, &read_capped/3)
    read_fn.(workspace, finding.path, finding.line)
  end

  defp read_capped(nil, _path, _line), do: "(workspace unavailable)"

  defp read_capped(workspace, path, line) do
    full = Path.join([workspace, repo_root(path), path])

    case File.read(full) do
      {:ok, content} -> slice_around(content, line)
      _ -> "(file not found in workspace)"
    end
  end

  defp slice_around(content, nil), do: String.slice(content, 0, 2_000)

  defp slice_around(content, line) when is_integer(line) do
    lines = String.split(content, "\n")
    from = max(line - @context_radius, 1)
    to = line + @context_radius

    lines
    |> Enum.slice((from - 1)..(to - 1))
    |> Enum.with_index(from)
    |> Enum.map_join("\n", fn {text, n} -> "#{n}| #{text}" end)
  end

  defp repo_root(_path), do: ""

  defp fix_template_body do
    case PromptTemplates.get_by_slug("fix-finding") do
      {:ok, %{body: body}} -> {:ok, body}
      _ -> {:ok, fallback_fix_body()}
    end
  end

  defp fallback_fix_body do
    "Resolve finding {{ finding.title }} at {{ finding.path }}:{{ finding.line }}. " <>
      "{{ finding.body }} Suggested: {{ finding.suggested_fix }}. " <>
      "Instructions: {{ finding.fix_instructions }}. Context:\n{{ file_context }}"
  end
end
```

> **Integration notes for the implementer:** confirm the real `PromptTemplates.render/2` arity/signature from the Magic Prompts plan — it may take a `%Template{}` struct rather than a raw body string. If so, replace `PromptTemplates.render(body, ctx)` with a `get_by_slug("fix-finding")` + `PromptTemplates.render(template, ctx)` call, and drop the local body-string path. Likewise confirm `IssueDispatch.resume/3` accepts `:mode` (Plan 2a Task 4 adds `model/effort/mode` to `@type opts`); until then, pass `mode` through and let `IssueDispatch` validate it via `ExecutionMode`.

- [ ] **Step 4: Run (expect pass)** — `cd elixir && mix test test/symphony_elixir/code_review/fix_dispatcher_test.exs -o`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/code_review/fix_dispatcher.ex elixir/test/symphony_elixir/code_review/fix_dispatcher_test.exs
git commit -m "feat(review): FixDispatcher (render fix-finding + dispatch + flip status)"
```

---

## Task 7: ReviewController + routes

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/review_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/review_controller_test.exs`

Actions (all under `/projects/:project_slug/issues/:identifier/review`):

| Verb | Path | Action | Purpose |
| --- | --- | --- | --- |
| POST | `/review` | `run` | run a review (`source`/`template_slug` optional) → persist findings |
| GET | `/review/findings` | `index` | list persisted findings |
| POST | `/review/findings/fix_all` | `fix_all` | batch fix (`finding_ids`, `mode`) |
| POST | `/review/findings/:finding_id/fix` | `fix` | per-finding fix (`mode`) |
| PATCH | `/review/findings/:finding_id` | `update` | set `status` (`dismissed`/`fixed`) |

`run` resolves the issue's workspace via `Workspace.path_for_issue/1`, resolves the template (built-in `code-review`, or a project-scoped override → `source: "template"`), renders the template body, runs `ReviewRunner.run/2`, and persists via `Findings.create_many/3`. The runner is injectable so the controller test stays offline.

- [ ] **Step 1: Write failing controller test**

```elixir
defmodule SymphonyElixirWeb.Tracker.ReviewControllerTest do
  use SymphonyElixirWeb.ConnCase, async: true

  alias SymphonyElixir.CodeReview.Findings
  alias SymphonyElixir.LocalTracker.Context

  setup %{conn: conn} do
    {:ok, project} = Context.create_project(%{slug: "demo", name: "Demo"})
    {:ok, conn: put_req_header(conn, "accept", "application/json"), project: project}
  end

  test "POST /review persists parsed findings", %{conn: conn, project: project} do
    runner = fn _ws, _prompt -> {:ok, ~s([{"severity":"warning","repo":"tracker","path":"a.ts","line":3,"title":"Null","body":"b"}])} end

    conn =
      conn
      |> assign(:review_runner, runner)
      |> post(~p"/api/tracker/v1/projects/#{project.slug}/issues/DEMO-1/review", %{})

    assert %{"data" => %{"findings" => [finding]}} = json_response(conn, 200)
    assert finding["severity"] == "warning"
    assert finding["path"] == "a.ts"
    assert finding["status"] == "open"
  end

  test "GET /review/findings lists persisted findings", %{conn: conn, project: project} do
    {:ok, _} = Findings.create_many(project.slug, "DEMO-1", [%{severity: "warning", title: "W", body: ""}], run_id: "r1")

    conn = get(conn, ~p"/api/tracker/v1/projects/#{project.slug}/issues/DEMO-1/review/findings")
    assert %{"data" => [%{"title" => "W", "status" => "open"}]} = json_response(conn, 200)
  end

  test "PATCH /review/findings/:id dismisses a finding", %{conn: conn, project: project} do
    {:ok, [finding]} = Findings.create_many(project.slug, "DEMO-1", [%{severity: "warning", title: "W", body: ""}], run_id: "r1")

    conn = patch(conn, ~p"/api/tracker/v1/projects/#{project.slug}/issues/DEMO-1/review/findings/#{finding.id}", %{"status" => "dismissed"})
    assert %{"data" => %{"status" => "dismissed"}} = json_response(conn, 200)
  end

  test "PATCH rejects an unknown status", %{conn: conn, project: project} do
    {:ok, [finding]} = Findings.create_many(project.slug, "DEMO-1", [%{severity: "warning", title: "W", body: ""}], run_id: "r1")

    conn = patch(conn, ~p"/api/tracker/v1/projects/#{project.slug}/issues/DEMO-1/review/findings/#{finding.id}", %{"status" => "wip"})
    assert json_response(conn, 422)
  end

  test "POST /review/findings/:id/fix flips to fixing", %{conn: conn, project: project} do
    {:ok, [finding]} = Findings.create_many(project.slug, "DEMO-1", [%{severity: "warning", repo: "tracker", path: "a.ts", line: 1, title: "W", body: ""}], run_id: "r1")

    conn =
      conn
      |> assign(:fix_dispatch_fn, fn _p, _id, _opts -> {:ok, %{}} end)
      |> post(~p"/api/tracker/v1/projects/#{project.slug}/issues/DEMO-1/review/findings/#{finding.id}/fix", %{"mode" => "build"})

    assert %{"data" => %{"status" => "fixing"}} = json_response(conn, 200)
  end
end
```

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/review_controller_test.exs -o`

- [ ] **Step 3: Implement the controller**

```elixir
defmodule SymphonyElixirWeb.Tracker.ReviewController do
  @moduledoc """
  Runs structured code reviews for an issue and exposes the persisted findings +
  the per-finding / batch fix loop. Findings come from one source-agnostic
  contract (built-in `code-review` review turn, or a project review template).
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.CodeReview.{Finding, Findings, FixDispatcher, ReviewRunner}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.PromptTemplates
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.Workspace
  alias SymphonyElixirWeb.TrackerErrors

  @spec run(Conn.t(), map()) :: Conn.t()
  def run(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    slug = Map.get(params, "template_slug", "code-review")

    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]),
         {:ok, template} <- resolve_template(project_slug, slug),
         workspace = Workspace.path_for_issue(issue),
         runner_opts = runner_opts(conn, template, issue),
         {:ok, raw_findings} <- ReviewRunner.run(workspace, runner_opts),
         {:ok, findings} <-
           Findings.create_many(project_slug, identifier, raw_findings, source: source_for(template, slug)) do
      json(conn, %{data: %{findings: Enum.map(findings, &present/1)}})
    else
      {:error, :template_not_found} -> TrackerErrors.validation_msg(conn, "unknown review template")
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    case Findings.list(project_slug, identifier) do
      {:ok, findings} -> json(conn, %{data: Enum.map(findings, &present/1)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec update(Conn.t(), map()) :: Conn.t()
  def update(conn, %{"finding_id" => finding_id, "status" => status}) do
    case Findings.update_status(String.to_integer(finding_id), status) do
      {:ok, finding} -> json(conn, %{data: present(finding)})
      {:error, :invalid_status} -> TrackerErrors.validation_msg(conn, "status must be open, fixing, fixed, or dismissed")
      {:error, :not_found} -> TrackerErrors.render(conn, :not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec fix(Conn.t(), map()) :: Conn.t()
  def fix(conn, %{"project_slug" => project_slug, "identifier" => identifier, "finding_id" => finding_id} = params) do
    opts = fix_opts(conn, params)

    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, finding} <- FixDispatcher.fix(project, identifier, String.to_integer(finding_id), opts) do
      json(conn, %{data: present(finding)})
    else
      {:error, :not_found} -> TrackerErrors.render(conn, :not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec fix_all(Conn.t(), map()) :: Conn.t()
  def fix_all(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    ids = params |> Map.get("finding_ids", []) |> Enum.map(&to_int/1) |> Enum.reject(&is_nil/1)
    opts = fix_opts(conn, params)

    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, findings} <- FixDispatcher.fix_all(project, identifier, ids, opts) do
      json(conn, %{data: Enum.map(findings, &present/1)})
    else
      {:error, :no_open_findings} -> TrackerErrors.validation_msg(conn, "no open findings to fix")
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp runner_opts(conn, template, issue) do
    base = [template_body: template.body, issue: issue_map(issue)]

    case conn.assigns[:review_runner] do
      runner when is_function(runner, 2) -> Keyword.put(base, :runner, runner)
      _ -> base
    end
  end

  defp fix_opts(conn, params) do
    base = [mode: Map.get(params, "mode", "build")]

    case conn.assigns[:fix_dispatch_fn] do
      fun when is_function(fun, 3) -> Keyword.put(base, :dispatch_fn, fun)
      _ -> base
    end
  end

  defp resolve_template(project_slug, slug) do
    case PromptTemplates.get_by_slug(slug, scope: project_slug) do
      {:ok, template} -> {:ok, template}
      _ -> {:error, :template_not_found}
    end
  end

  # A project-scoped override of `code-review` (or a different slug) = "template";
  # the built-in global `code-review` = "review" (Bugbot/security analog).
  defp source_for(%{scope: scope}, "code-review") when scope in [nil, "global"], do: "review"
  defp source_for(_template, _slug), do: "template"

  defp issue_map(issue) do
    %{identifier: Map.get(issue, :identifier), title: Map.get(issue, :title), description: Map.get(issue, :description)}
  end

  defp to_int(value) when is_integer(value), do: value
  defp to_int(value) when is_binary(value), do: case(Integer.parse(value), do: ({n, _} -> n; :error -> nil))
  defp to_int(_value), do: nil

  defp present(%Finding{} = finding) do
    %{
      id: finding.id,
      run_id: finding.run_id,
      source: finding.source,
      severity: finding.severity,
      repo: finding.repo,
      path: finding.path,
      line: finding.line,
      end_line: finding.end_line,
      title: finding.title,
      body: finding.body,
      suggested_fix: finding.suggested_fix,
      fix_instructions: finding.fix_instructions,
      status: finding.status,
      inserted_at: finding.inserted_at
    }
  end
end
```

> Confirm `PromptTemplates.get_by_slug/2` (with `scope:`) exists; the Magic Prompts plan exposes `get/1` + `list/1` with project shadowing. If only `list/1` exists, resolve with `PromptTemplates.list(scope: project_slug) |> Enum.find(&(&1.slug == slug))`.

- [ ] **Step 4: Add the routes** (in the same `scope "/api/tracker/v1"` block as the evidence routes; define `/fix_all` before `/:finding_id/fix` is not required since segments differ, but keep them grouped)

```elixir
post("/projects/:project_slug/issues/:identifier/review", ReviewController, :run)
get("/projects/:project_slug/issues/:identifier/review/findings", ReviewController, :index)
post("/projects/:project_slug/issues/:identifier/review/findings/fix_all", ReviewController, :fix_all)
post("/projects/:project_slug/issues/:identifier/review/findings/:finding_id/fix", ReviewController, :fix)
patch("/projects/:project_slug/issues/:identifier/review/findings/:finding_id", ReviewController, :update)
```

- [ ] **Step 5: Run (expect pass)** — `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/review_controller_test.exs -o`

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/review_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/test/symphony_elixir_web/controllers/tracker/review_controller_test.exs
git commit -m "feat(review): review run/list/fix/fix_all/update endpoints"
```

---

## Task 8: Tracker types + service

**Files:**
- Create: `tracker/src/types/reviewFinding.ts`
- Create: `tracker/src/services/reviewFindings.ts`
- Test: `tracker/src/services/__tests__/reviewFindings.test.ts`

Mirror `services/evidence.ts` (snake→camel mapping, `trackerPath`, `requireProjectSlug`/`requireNonBlank`).

- [ ] **Step 1: Write the types**

```typescript
export type ReviewSeverity = "warning" | "suggestion" | "praise";
export type ReviewFindingStatus = "open" | "fixing" | "fixed" | "dismissed";
export type ReviewSource = "review" | "template";
export type ReviewFixMode = "build" | "yolo";

export interface ReviewFinding {
  id: number;
  runId: string;
  source: ReviewSource;
  severity: ReviewSeverity;
  repo: string | null;
  path: string | null;
  line: number | null;
  endLine: number | null;
  title: string;
  body: string;
  suggestedFix: string | null;
  fixInstructions: string | null;
  status: ReviewFindingStatus;
  insertedAt: string | null;
}
```

- [ ] **Step 2: Write failing service test**

```typescript
import { describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import {
  dismissFinding,
  fixAllFindings,
  fixFinding,
  listReviewFindings,
  runReview,
} from "@/services/reviewFindings";

const backendFinding = {
  id: 1,
  run_id: "r1",
  source: "review",
  severity: "warning",
  repo: "tracker",
  path: "a.ts",
  line: 4,
  end_line: 6,
  title: "Null deref",
  body: "explanation",
  suggested_fix: "guard it",
  fix_instructions: "add a guard",
  status: "open",
  inserted_at: "2026-06-29T12:00:00Z",
};

describe("reviewFindings service", () => {
  it("runReview posts and normalizes findings", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: { data: { findings: [backendFinding] } },
    });

    const findings = await runReview("demo", "DEMO-1");

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/demo/issues/DEMO-1/review", {});
    expect(findings[0].endLine).toBe(6);
    expect(findings[0].suggestedFix).toBe("guard it");
    expect(findings[0].status).toBe("open");
  });

  it("listReviewFindings GETs the findings list", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: { data: [backendFinding] } });
    const findings = await listReviewFindings("demo", "DEMO-1");
    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/demo/issues/DEMO-1/review/findings");
    expect(findings[0].severity).toBe("warning");
  });

  it("fixFinding posts the mode and returns the updated finding", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: { data: { ...backendFinding, status: "fixing" } },
    });
    const finding = await fixFinding("demo", "DEMO-1", 1, "yolo");
    expect(post).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/demo/issues/DEMO-1/review/findings/1/fix",
      { mode: "yolo" },
    );
    expect(finding.status).toBe("fixing");
  });

  it("fixAllFindings posts ids + mode", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: { data: [{ ...backendFinding, status: "fixing" }] },
    });
    const findings = await fixAllFindings("demo", "DEMO-1", [1, 2], "build");
    expect(post).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/demo/issues/DEMO-1/review/findings/fix_all",
      { finding_ids: [1, 2], mode: "build" },
    );
    expect(findings[0].status).toBe("fixing");
  });

  it("dismissFinding patches the status", async () => {
    const patch = vi.spyOn(http, "patch").mockResolvedValueOnce({
      data: { data: { ...backendFinding, status: "dismissed" } },
    });
    const finding = await dismissFinding("demo", "DEMO-1", 1);
    expect(patch).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/demo/issues/DEMO-1/review/findings/1",
      { status: "dismissed" },
    );
    expect(finding.status).toBe("dismissed");
  });
});
```

- [ ] **Step 3: Run (expect fail)** — `cd tracker && npx vitest run src/services/__tests__/reviewFindings.test.ts`

- [ ] **Step 4: Implement the service**

```typescript
import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type { ReviewFinding, ReviewFindingStatus, ReviewFixMode } from "@/types/reviewFinding";

import { http, trackerPath } from "./http";

interface BackendReviewFindingDto {
  id: number;
  run_id: string;
  source?: string | null;
  severity: string;
  repo?: string | null;
  path?: string | null;
  line?: number | null;
  end_line?: number | null;
  title: string;
  body?: string | null;
  suggested_fix?: string | null;
  fix_instructions?: string | null;
  status: string;
  inserted_at?: string | null;
}

function isSeverity(value: string): value is ReviewFinding["severity"] {
  return value === "warning" || value === "suggestion" || value === "praise";
}

function isStatus(value: string): value is ReviewFindingStatus {
  return value === "open" || value === "fixing" || value === "fixed" || value === "dismissed";
}

export function normalizeReviewFinding(dto: BackendReviewFindingDto): ReviewFinding {
  return {
    id: dto.id,
    runId: dto.run_id,
    source: dto.source === "template" ? "template" : "review",
    severity: isSeverity(dto.severity) ? dto.severity : "suggestion",
    repo: dto.repo ?? null,
    path: dto.path ?? null,
    line: typeof dto.line === "number" ? dto.line : null,
    endLine: typeof dto.end_line === "number" ? dto.end_line : null,
    title: dto.title,
    body: dto.body ?? "",
    suggestedFix: dto.suggested_fix ?? null,
    fixInstructions: dto.fix_instructions ?? null,
    status: isStatus(dto.status) ? dto.status : "open",
    insertedAt: dto.inserted_at ?? null,
  };
}

function basePath(slug: string, identifier: string): string {
  return trackerPath(
    `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(identifier)}/review`,
  );
}

export async function runReview(
  projectSlug: string,
  identifier: string,
  templateSlug?: string,
): Promise<ReviewFinding[]> {
  const slug = requireProjectSlug(projectSlug);
  const id = requireNonBlank(identifier, "identifier");
  const payload = templateSlug ? { template_slug: templateSlug } : {};

  const response = await http.post<{ data?: { findings?: BackendReviewFindingDto[] } }>(
    basePath(slug, id),
    payload,
  );

  return (response.data?.data?.findings ?? []).map(normalizeReviewFinding);
}

export async function listReviewFindings(
  projectSlug: string,
  identifier: string,
): Promise<ReviewFinding[]> {
  const slug = requireProjectSlug(projectSlug);
  const id = requireNonBlank(identifier, "identifier");

  const response = await http.get<{ data?: BackendReviewFindingDto[] }>(
    `${basePath(slug, id)}/findings`,
  );

  return (response.data?.data ?? []).map(normalizeReviewFinding);
}

export async function fixFinding(
  projectSlug: string,
  identifier: string,
  findingId: number,
  mode: ReviewFixMode = "build",
): Promise<ReviewFinding> {
  const slug = requireProjectSlug(projectSlug);
  const id = requireNonBlank(identifier, "identifier");

  const response = await http.post<{ data: BackendReviewFindingDto }>(
    `${basePath(slug, id)}/findings/${findingId}/fix`,
    { mode },
  );

  return normalizeReviewFinding(response.data.data);
}

export async function fixAllFindings(
  projectSlug: string,
  identifier: string,
  findingIds: number[],
  mode: ReviewFixMode = "build",
): Promise<ReviewFinding[]> {
  const slug = requireProjectSlug(projectSlug);
  const id = requireNonBlank(identifier, "identifier");

  const response = await http.post<{ data: BackendReviewFindingDto[] }>(
    `${basePath(slug, id)}/findings/fix_all`,
    { finding_ids: findingIds, mode },
  );

  return (response.data.data ?? []).map(normalizeReviewFinding);
}

export async function dismissFinding(
  projectSlug: string,
  identifier: string,
  findingId: number,
): Promise<ReviewFinding> {
  return updateFindingStatus(projectSlug, identifier, findingId, "dismissed");
}

export async function updateFindingStatus(
  projectSlug: string,
  identifier: string,
  findingId: number,
  status: ReviewFindingStatus,
): Promise<ReviewFinding> {
  const slug = requireProjectSlug(projectSlug);
  const id = requireNonBlank(identifier, "identifier");

  const response = await http.patch<{ data: BackendReviewFindingDto }>(
    `${basePath(slug, id)}/findings/${findingId}`,
    { status },
  );

  return normalizeReviewFinding(response.data.data);
}
```

- [ ] **Step 5: Run (expect pass)** — `cd tracker && npx vitest run src/services/__tests__/reviewFindings.test.ts`

- [ ] **Step 6: Commit**

```bash
git add tracker/src/types/reviewFinding.ts tracker/src/services/reviewFindings.ts tracker/src/services/__tests__/reviewFindings.test.ts
git commit -m "feat(review): tracker reviewFindings types + service"
```

---

## Task 9: useReviewFindings hook

**Files:**
- Create: `tracker/src/hooks/useReviewFindings.ts`
- Test: `tracker/src/hooks/__tests__/useReviewFindings.test.tsx`

Mirror `useIssueEvidence` exactly (manual `loading`/`error`/`refetch`) plus mutating actions (`run`, `fix`, `fixAll`, `dismiss`) that refetch on success.

- [ ] **Step 1: Write failing test**

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { useReviewFindings } from "@/hooks/useReviewFindings";
import * as service from "@/services/reviewFindings";

const finding = {
  id: 1, runId: "r1", source: "review" as const, severity: "warning" as const,
  repo: "tracker", path: "a.ts", line: 4, endLine: null, title: "Null", body: "b",
  suggestedFix: null, fixInstructions: null, status: "open" as const, insertedAt: null,
};

describe("useReviewFindings", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads findings on mount", async () => {
    vi.spyOn(service, "listReviewFindings").mockResolvedValue([finding]);
    const { result } = renderHook(() => useReviewFindings({ projectSlug: "demo", identifier: "DEMO-1" }));
    await waitFor(() => expect(result.current.findings).toHaveLength(1));
  });

  it("run() persists and refetches", async () => {
    vi.spyOn(service, "listReviewFindings").mockResolvedValue([finding]);
    const run = vi.spyOn(service, "runReview").mockResolvedValue([finding]);
    const { result } = renderHook(() => useReviewFindings({ projectSlug: "demo", identifier: "DEMO-1" }));
    await act(async () => { await result.current.run(); });
    expect(run).toHaveBeenCalledWith("demo", "DEMO-1", undefined);
  });

  it("fix() flips a finding optimistically and calls the service", async () => {
    vi.spyOn(service, "listReviewFindings").mockResolvedValue([finding]);
    const fix = vi.spyOn(service, "fixFinding").mockResolvedValue({ ...finding, status: "fixing" });
    const { result } = renderHook(() => useReviewFindings({ projectSlug: "demo", identifier: "DEMO-1" }));
    await waitFor(() => expect(result.current.findings).toHaveLength(1));
    await act(async () => { await result.current.fix(1, "yolo"); });
    expect(fix).toHaveBeenCalledWith("demo", "DEMO-1", 1, "yolo");
  });
});
```

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/hooks/__tests__/useReviewFindings.test.tsx`

- [ ] **Step 3: Implement**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";

import { i18n } from "@/i18n";
import {
  dismissFinding,
  fixAllFindings,
  fixFinding,
  listReviewFindings,
  runReview,
  updateFindingStatus,
} from "@/services/reviewFindings";
import type { ReviewFinding, ReviewFindingStatus, ReviewFixMode } from "@/types/reviewFinding";

interface UseReviewFindingsArgs {
  projectSlug: string;
  identifier: string | null;
  enabled?: boolean;
}

export interface UseReviewFindingsResult {
  findings: ReviewFinding[];
  loading: boolean;
  running: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  run: (templateSlug?: string) => Promise<void>;
  fix: (findingId: number, mode?: ReviewFixMode) => Promise<void>;
  fixAll: (findingIds: number[], mode?: ReviewFixMode) => Promise<void>;
  dismiss: (findingId: number) => Promise<void>;
  setStatus: (findingId: number, status: ReviewFindingStatus) => Promise<void>;
}

export function useReviewFindings({
  projectSlug,
  identifier,
  enabled = true,
}: UseReviewFindingsArgs): UseReviewFindingsResult {
  const [findings, setFindings] = useState<ReviewFinding[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const hasLoadedRef = useRef(false);

  const active = enabled && Boolean(identifier && projectSlug);

  const refetch = useCallback(async () => {
    if (!identifier || !projectSlug) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const result = await listReviewFindings(projectSlug, identifier);
      setFindings(result);
      setError(null);
      hasLoadedRef.current = true;
    } catch {
      setError(i18n.t("issue.review.errors.loadFailed"));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [identifier, projectSlug]);

  const run = useCallback(
    async (templateSlug?: string) => {
      if (!identifier || !projectSlug) return;
      setRunning(true);
      setError(null);
      try {
        const result = await runReview(projectSlug, identifier, templateSlug);
        setFindings(result);
        hasLoadedRef.current = true;
      } catch {
        setError(i18n.t("issue.review.errors.runFailed"));
      } finally {
        setRunning(false);
      }
    },
    [identifier, projectSlug],
  );

  const replace = useCallback((updated: ReviewFinding) => {
    setFindings((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  }, []);

  const fix = useCallback(
    async (findingId: number, mode: ReviewFixMode = "build") => {
      if (!identifier || !projectSlug) return;
      setFindings((prev) => prev.map((f) => (f.id === findingId ? { ...f, status: "fixing" } : f)));
      try {
        const updated = await fixFinding(projectSlug, identifier, findingId, mode);
        replace(updated);
      } catch {
        setError(i18n.t("issue.review.errors.fixFailed"));
        await refetch();
      }
    },
    [identifier, projectSlug, refetch, replace],
  );

  const fixAll = useCallback(
    async (findingIds: number[], mode: ReviewFixMode = "build") => {
      if (!identifier || !projectSlug || findingIds.length === 0) return;
      const ids = new Set(findingIds);
      setFindings((prev) => prev.map((f) => (ids.has(f.id) ? { ...f, status: "fixing" } : f)));
      try {
        const updated = await fixAllFindings(projectSlug, identifier, findingIds, mode);
        setFindings((prev) => prev.map((f) => updated.find((u) => u.id === f.id) ?? f));
      } catch {
        setError(i18n.t("issue.review.errors.fixFailed"));
        await refetch();
      }
    },
    [identifier, projectSlug, refetch],
  );

  const setStatus = useCallback(
    async (findingId: number, status: ReviewFindingStatus) => {
      if (!identifier || !projectSlug) return;
      try {
        const updated = await updateFindingStatus(projectSlug, identifier, findingId, status);
        replace(updated);
      } catch {
        setError(i18n.t("issue.review.errors.updateFailed"));
        await refetch();
      }
    },
    [identifier, projectSlug, refetch, replace],
  );

  const dismiss = useCallback(
    async (findingId: number) => {
      if (!identifier || !projectSlug) return;
      try {
        const updated = await dismissFinding(projectSlug, identifier, findingId);
        replace(updated);
      } catch {
        setError(i18n.t("issue.review.errors.updateFailed"));
        await refetch();
      }
    },
    [identifier, projectSlug, refetch, replace],
  );

  useEffect(() => {
    hasLoadedRef.current = false;
    setFindings([]);
    setError(null);
    setLoading(false);
  }, [identifier, projectSlug]);

  useEffect(() => {
    if (!active) return;
    if (hasLoadedRef.current) return;
    void refetch();
  }, [active, refetch]);

  return { findings, loading, running, error, refetch, run, fix, fixAll, dismiss, setStatus };
}
```

- [ ] **Step 4: Run (expect pass)** — `cd tracker && npx vitest run src/hooks/__tests__/useReviewFindings.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add tracker/src/hooks/useReviewFindings.ts tracker/src/hooks/__tests__/useReviewFindings.test.tsx
git commit -m "feat(review): useReviewFindings data + mutation hook"
```

---

## Task 10: ReviewFindingCard (single finding row)

**Files:**
- Create: `tracker/src/components/issues/issue-detail/ReviewFindingCard.tsx`
- Test: `tracker/src/components/issues/issue-detail/__tests__/ReviewFindingCard.test.tsx`

The Jean `ReviewCommentsDialog` per-finding row: severity badge, `repo/path:line`, title, body, `suggested_fix` block, a status pill, and **Fix** / **Dismiss** buttons (disabled while `fixing`). Reuse `@/components/ui/{card,badge,button}`.

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReviewFindingCard } from "@/components/issues/issue-detail/ReviewFindingCard";
import type { ReviewFinding } from "@/types/reviewFinding";

const finding: ReviewFinding = {
  id: 1, runId: "r1", source: "review", severity: "warning",
  repo: "tracker", path: "src/a.ts", line: 4, endLine: 6, title: "Null deref",
  body: "explanation", suggestedFix: "guard it", fixInstructions: null,
  status: "open", insertedAt: null,
};

describe("ReviewFindingCard", () => {
  it("renders severity, location, title, body, and suggested fix", () => {
    render(<ReviewFindingCard finding={finding} onFix={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText("Null deref")).toBeInTheDocument();
    expect(screen.getByText(/src\/a\.ts:4/)).toBeInTheDocument();
    expect(screen.getByText("guard it")).toBeInTheDocument();
  });

  it("calls onFix with build mode", () => {
    const onFix = vi.fn();
    render(<ReviewFindingCard finding={finding} onFix={onFix} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /fix/i }));
    expect(onFix).toHaveBeenCalledWith(1, "build");
  });

  it("disables actions while fixing", () => {
    render(<ReviewFindingCard finding={{ ...finding, status: "fixing" }} onFix={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("button", { name: /fixing/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/ReviewFindingCard.test.tsx`

- [ ] **Step 3: Implement**

```tsx
import { AlertTriangle, Check, Lightbulb, Sparkles, Wand2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ReviewFinding, ReviewFixMode, ReviewSeverity } from "@/types/reviewFinding";

const SEVERITY_META: Record<ReviewSeverity, { Icon: typeof AlertTriangle; className: string }> = {
  warning: { Icon: AlertTriangle, className: "text-amber-600 dark:text-amber-400" },
  suggestion: { Icon: Lightbulb, className: "text-sky-600 dark:text-sky-400" },
  praise: { Icon: Sparkles, className: "text-emerald-600 dark:text-emerald-400" },
};

interface ReviewFindingCardProps {
  finding: ReviewFinding;
  onFix: (findingId: number, mode: ReviewFixMode) => void;
  onDismiss: (findingId: number) => void;
  yolo?: boolean;
}

export function ReviewFindingCard({ finding, onFix, onDismiss, yolo = false }: ReviewFindingCardProps) {
  const { t } = useTranslation();
  const { Icon, className } = SEVERITY_META[finding.severity];
  const location = finding.path
    ? `${finding.repo ? `${finding.repo}/` : ""}${finding.path}${finding.line ? `:${finding.line}` : ""}`
    : null;
  const isFixing = finding.status === "fixing";
  const isResolved = finding.status === "fixed" || finding.status === "dismissed";

  return (
    <Card
      className={cn("space-y-2 p-3", isResolved && "opacity-60")}
      data-testid={`review-finding-${finding.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn("gap-1", className)}>
          <Icon className="h-3.5 w-3.5" />
          {t(`issue.review.severity.${finding.severity}`)}
        </Badge>
        {location ? <code className="font-mono text-xs text-muted-foreground">{location}</code> : null}
        <Badge variant="secondary" className="ml-auto">
          {t(`issue.review.status.${finding.status}`)}
        </Badge>
      </div>

      <p className="text-sm font-medium">{finding.title}</p>
      {finding.body ? <p className="text-sm text-muted-foreground">{finding.body}</p> : null}

      {finding.suggestedFix ? (
        <pre className="overflow-x-auto rounded-md border bg-muted/30 p-2 text-xs">
          <code>{finding.suggestedFix}</code>
        </pre>
      ) : null}

      {finding.severity !== "praise" && !isResolved ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            type="button"
            disabled={isFixing}
            onClick={() => onFix(finding.id, yolo ? "yolo" : "build")}
          >
            <Wand2 className="h-3.5 w-3.5" />
            {isFixing ? t("issue.review.actions.fixing") : t("issue.review.actions.fix")}
          </Button>
          <Button
            size="sm"
            type="button"
            variant="ghost"
            disabled={isFixing}
            onClick={() => onDismiss(finding.id)}
          >
            <X className="h-3.5 w-3.5" />
            {t("issue.review.actions.dismiss")}
          </Button>
        </div>
      ) : null}

      {finding.status === "fixed" ? (
        <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" />
          {t("issue.review.status.fixed")}
        </p>
      ) : null}
    </Card>
  );
}
```

> If `@/components/ui/card` does not export a plain `Card`, use a `<div className="rounded-lg border ...">` wrapper as `EvidenceTab` does; the test only relies on rendered text/roles.

- [ ] **Step 4: Run (expect pass)** — `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/ReviewFindingCard.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail/ReviewFindingCard.tsx tracker/src/components/issues/issue-detail/__tests__/ReviewFindingCard.test.tsx
git commit -m "feat(review): ReviewFindingCard"
```

---

## Task 11: ReviewPanel (the findings dialog analog)

**Files:**
- Create: `tracker/src/components/issues/issue-detail/ReviewPanel.tsx`
- Test: `tracker/src/components/issues/issue-detail/__tests__/ReviewPanel.test.tsx`

The Jean `ReviewCommentsDialog` analog as an in-tab panel: header with **Run review**, **Fix all**, and a **Yolo** (auto-apply) toggle; findings grouped by severity; empty/loading/error states. Uses `useReviewFindings`.

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReviewPanel } from "@/components/issues/issue-detail/ReviewPanel";
import * as service from "@/services/reviewFindings";

const finding = {
  id: 1, run_id: "r1", source: "review", severity: "warning",
  repo: "tracker", path: "a.ts", line: 4, end_line: null, title: "Null deref",
  body: "b", suggested_fix: "guard it", fix_instructions: null, status: "open",
  inserted_at: null,
};

describe("ReviewPanel", () => {
  it("runs a review and renders findings", async () => {
    vi.spyOn(service, "listReviewFindings").mockResolvedValue([]);
    const run = vi.spyOn(service, "runReview").mockResolvedValue([
      service.normalizeReviewFinding(finding as never),
    ]);

    render(<ReviewPanel projectSlug="demo" identifier="DEMO-1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /run review/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /run review/i }));
    await waitFor(() => expect(screen.getByText("Null deref")).toBeInTheDocument());
    expect(run).toHaveBeenCalled();
  });

  it("Fix all dispatches fixes for open findings", async () => {
    vi.spyOn(service, "listReviewFindings").mockResolvedValue([
      service.normalizeReviewFinding(finding as never),
    ]);
    const fixAll = vi.spyOn(service, "fixAllFindings").mockResolvedValue([
      service.normalizeReviewFinding({ ...finding, status: "fixing" } as never),
    ]);

    render(<ReviewPanel projectSlug="demo" identifier="DEMO-1" />);
    await waitFor(() => expect(screen.getByText("Null deref")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /fix all/i }));
    await waitFor(() => expect(fixAll).toHaveBeenCalledWith("demo", "DEMO-1", [1], "build"));
  });
});
```

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/ReviewPanel.test.tsx`

- [ ] **Step 3: Implement**

```tsx
import { Play, Wand2, Zap } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ReviewFindingCard } from "@/components/issues/issue-detail/ReviewFindingCard";
import { Button } from "@/components/ui/button";
import { useReviewFindings } from "@/hooks/useReviewFindings";
import { cn } from "@/lib/utils";
import type { ReviewFinding, ReviewSeverity } from "@/types/reviewFinding";
import { useState } from "react";

const SEVERITY_ORDER: ReviewSeverity[] = ["warning", "suggestion", "praise"];

interface ReviewPanelProps {
  projectSlug: string;
  identifier: string;
}

export function ReviewPanel({ projectSlug, identifier }: ReviewPanelProps) {
  const { t } = useTranslation();
  const [yolo, setYolo] = useState(false);
  const { findings, loading, running, error, run, fix, fixAll, dismiss } = useReviewFindings({
    projectSlug,
    identifier,
  });

  const grouped = useMemo(() => groupBySeverity(findings), [findings]);
  const openIds = findings.filter((f) => f.status === "open" && f.severity !== "praise").map((f) => f.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("issue.review.title")}</p>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            type="button"
            variant={yolo ? "default" : "outline"}
            aria-pressed={yolo}
            onClick={() => setYolo((v) => !v)}
          >
            <Zap className={cn("h-3.5 w-3.5", yolo && "text-yellow-300")} />
            {t("issue.review.actions.yolo")}
          </Button>
          {openIds.length > 0 ? (
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void fixAll(openIds, yolo ? "yolo" : "build")}
            >
              <Wand2 className="h-3.5 w-3.5" />
              {t("issue.review.actions.fixAll")}
            </Button>
          ) : null}
          <Button size="sm" type="button" disabled={running} onClick={() => void run()}>
            <Play className={cn("h-3.5 w-3.5", running && "animate-pulse")} />
            {running ? t("issue.review.actions.running") : t("issue.review.actions.run")}
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!error && findings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {loading || running ? t("issue.review.loading") : t("issue.review.empty")}
        </p>
      ) : null}

      {SEVERITY_ORDER.map((severity) =>
        grouped[severity].length > 0 ? (
          <section className="space-y-2" key={severity}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`issue.review.severity.${severity}`)} ({grouped[severity].length})
            </h3>
            {grouped[severity].map((finding) => (
              <ReviewFindingCard
                key={finding.id}
                finding={finding}
                onFix={fix}
                onDismiss={dismiss}
                yolo={yolo}
              />
            ))}
          </section>
        ) : null,
      )}
    </div>
  );
}

function groupBySeverity(findings: ReviewFinding[]): Record<ReviewSeverity, ReviewFinding[]> {
  const groups: Record<ReviewSeverity, ReviewFinding[]> = { warning: [], suggestion: [], praise: [] };
  for (const finding of findings) groups[finding.severity].push(finding);
  return groups;
}
```

- [ ] **Step 4: Run (expect pass)** — `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/ReviewPanel.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail/ReviewPanel.tsx tracker/src/components/issues/issue-detail/__tests__/ReviewPanel.test.tsx
git commit -m "feat(review): ReviewPanel (run review + grouped findings + fix all + yolo)"
```

---

## Task 12: Mount the Review tab + i18n

**Files:**
- Modify: `tracker/src/components/issues/IssueDrawer.tsx` (`TAB_DEFS` at `:64-73` + the `TabsContent` list)
- Modify: `tracker/locales/en/tracker.json`, `tracker/locales/pt-BR/tracker.json`
- Test: extend an existing drawer test or add a thin mount assertion.

- [ ] **Step 1: Add the i18n keys** (en — mirror under `issue.review` next to `issue.evidence`)

```json
"review": {
  "title": "Code review",
  "loading": "Running review…",
  "empty": "No findings yet. Run a review to analyze this issue's changes.",
  "severity": { "warning": "Warning", "suggestion": "Suggestion", "praise": "Praise" },
  "status": { "open": "Open", "fixing": "Fixing", "fixed": "Fixed", "dismissed": "Dismissed" },
  "actions": {
    "run": "Run review",
    "running": "Running…",
    "fix": "Fix",
    "fixing": "Fixing…",
    "fixAll": "Fix all",
    "dismiss": "Dismiss",
    "yolo": "Yolo (auto-apply)"
  },
  "errors": {
    "loadFailed": "Could not load review findings.",
    "runFailed": "Could not run the review.",
    "fixFailed": "Could not dispatch the fix.",
    "updateFailed": "Could not update the finding."
  }
}
```

  And the tab label under `issue.drawer.tabs`: `"review": "Review"`. Add the same keys to `pt-BR` with translated strings (e.g. `"title": "Revisão de código"`, `"run": "Executar revisão"`, `"fixAll": "Corrigir tudo"`, `"yolo": "Yolo (aplicar auto)"`, `severity` → `"Aviso"/"Sugestão"/"Elogio"`, status → `"Aberto"/"Corrigindo"/"Corrigido"/"Dispensado"`).

- [ ] **Step 2: Add the tab to `TAB_DEFS`** (import an icon, e.g. `ScanSearch` from lucide; place after `evidence`)

```tsx
{ value: "review", labelKey: "issue.drawer.tabs.review", Icon: ScanSearch },
```

- [ ] **Step 3: Add the `TabsContent`** (next to the `evidence` content block, importing `ReviewPanel`)

```tsx
<TabsContent value="review">
  <ReviewPanel projectSlug={projectSlug} identifier={issue.identifier} />
</TabsContent>
```

- [ ] **Step 4: Run the drawer tests + i18n lint** — `cd tracker && npx vitest run src/components/issues && npm run lint`
  Expected: PASS (no missing-key warnings).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/IssueDrawer.tsx tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json
git commit -m "feat(review): mount Review tab + i18n (en/pt-BR)"
```

---

## Task 13: Full gates + docs

- [ ] **Step 1: Backend gate** — `cd elixir && mix specs.check && make all` → pass. (Every new `def` in `lib/` has an adjacent `@spec` — verify `Findings`, `ReviewRunner`, `ReviewInput`, `FixDispatcher`, `ReviewController`.)
- [ ] **Step 2: Tracker gate** — `cd tracker && npm run lint && npx vitest run && npm run build` → pass.
- [ ] **Step 3: Docs** — document the `review_findings` store, the `ReviewFinding` contract, the two finding sources (built-in `code-review` review turn = `source: "review"`, project override = `source: "template"`), and the Fix/Fix-all/Yolo dispatch mapping in `elixir/README.md` (review section) and `../SPEC.md`. Note the Bugbot/security-review → structured agent review turn mapping explicitly.
- [ ] **Step 4: Commit** — `docs(review): document structured findings + fix loop`.

---

## Self-Review

**1. Spec coverage**

| Requirement (from spec) | Task(s) |
| --- | --- |
| Review panel rendering STRUCTURED findings (severity / file:line / explanation / suggested fix) | 10, 11 |
| Severity enum warning / suggestion / praise | 1 (schema), 4 (parse), 8/10 (TS) |
| Per-finding **Fix** | 6 (dispatch), 7 (endpoint), 9 (hook), 10 (button) |
| Batch **Fix all** | 6 (`fix_all`), 7, 9, 11 |
| **Yolo** auto-apply (mode flag → dispatch) | 6 (mode), 7, 9, 11 (toggle); references Plan 2a |
| Finding state open / fixing / fixed / dismissed | 1 (statuses), 2 (`update_status`), 7 (`update`/`fix`), 9, 10 |
| Source BOTH: existing review capability **and** per-project template | 4 (one runner), 5 (built-in + override), 7 (`source_for`) |
| Single source-agnostic typed contract emitted by both | "The ReviewFinding contract" + 1/4/8 |
| Reuse run-prompt-template dispatch path | 6 (`IssueDispatch.resume`), Depends-on Magic Commands |
| Change set from the diff layer | 3 (`ReviewInput` via `GitDiff`/`git diff`) |
| Persistence store mirroring `prompt_templates`/evidence | 1, 2 |
| Frontend mount + service + hooks + i18n | 8, 9, 10, 11, 12 |
| Confirm issue id/identifier columns | Done — `issue_evidence` uses `project_id` + `issue_identifier`; `IssueRecord.identifier` is `:string` (Task 1 mirrors it) |

**2. Placeholder scan** — every code step contains real code (migration, schema, context, runner, dispatcher, controller, routes, TS types/service/hook/components, tests, i18n JSON). No "TBD/implement later". Integration `> notes` flag the two cross-plan signatures to confirm (`PromptTemplates.render`/`get_by_slug`, `IssueDispatch` `:mode`) without leaving code blanks.

**3. Type consistency** — field names verified identical across layers:
- Wire/DB (snake): `severity, repo, path, line, end_line, title, body, suggested_fix, fix_instructions, source, status, run_id, issue_identifier`.
- TS (camel): `severity, repo, path, line, endLine, title, body, suggestedFix, fixInstructions, source, status, runId` (mapped in `normalizeReviewFinding`).
- Enums consistent: severity `warning|suggestion|praise`; status `open|fixing|fixed|dismissed`; source `review|template`; fix mode `build|yolo`. Function names stable across tasks: `create_many/list/get/update_status/delete_run` (Elixir), `runReview/listReviewFindings/fixFinding/fixAllFindings/updateFindingStatus/dismissFinding` (TS), `run/fix/fixAll/dismiss/setStatus/refetch` (hook).

---

## Open questions / risks

1. **"Bugbot" mapping in the server orchestrator.** Symphony has **no** standalone Bugbot/security-review primitive in the Elixir orchestrator — those are review *behaviors*. The realistic analog is the **structured-output agent review turn** (`ReviewRunner`, mirroring `Evidence.Judge`), so this plan treats "Bugbot/security review" as `source: "review"` runs of the built-in `code-review` template. If a true external Bugbot/security backend is later wired in, it only needs to emit the same `ReviewFinding` JSON and call `Findings.create_many/3` with `source: "review"` (or a new enum value added to `Finding`'s `@sources` + the TS `ReviewSource` union) — the UI stays source-agnostic.
2. **Reliable structured-JSON capture from a turn.** Capture mirrors `Evidence.Judge.default_runner/2` (no tools + `on_message` delta collector + `Regex.run(~r/\[.*\]/s, …)` + `Jason.decode`). Risks: the model wraps the array in prose or a ```json fence (the greedy `\[.*\]` regex handles fences/prose; verify with a fenced-output test case), or emits multiple arrays (we take the first match — acceptable for v1). Consider adding, as a follow-up, a Codex structured-output/JSON-mode request if the agent facade supports it, to remove the regex.
3. **`fixing → fixed` reconciliation.** v1 transitions to `fixing` optimistically on dispatch; there is no automatic `fixed` signal because the fix runs as a normal autonomous agent run. v1 relies on (a) a manual re-run of the review (new `run_id`, fresh `open` findings) or (b) a manual status update (`PATCH … status: fixed`). A robust auto-reconcile (mark `fixed` when a later review no longer reports a matching `path`+`title`, or when the fix run's handoff completes) is a noted follow-up, not in scope here.
4. **Consolidated vs sequential "Fix all".** Default is one consolidated run embedding all selected findings (avoids colliding concurrent agent runs on one workspace). Truly independent per-finding runs would need run-queue serialization; deferred.
5. **Diff size.** Large diffs may exceed the model context. `ReviewInput` currently sends full per-repo diffs; a follow-up should cap/segment (e.g. per-file budgets like `Judge.@max_file_bytes`) and possibly chunk the review across files.
