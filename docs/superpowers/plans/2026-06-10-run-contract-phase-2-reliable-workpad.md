# Run Contract Phase 2: Reliable Workpad — Implementation Plan

**Goal:** The workpad becomes a guaranteed deliverable: created before implementation (PLAN gate), classified correctly when written locally, synced to the remote tracker (Linear/GitHub/Jira) as a single in-place-edited comment, with sync status visible in issue detail.

**Architecture:** A shared `Tracker.Workpad` module owns workpad classification. Local comment creation classifies `kind` and starts `sync_status: "pending"`; the outbox gains a `comment:update` operation and the Linear driver gains comment push (GraphQL `commentCreate`/`commentUpdate`). A `Tracker.upsert_workpad/2` boundary edits the existing workpad in place instead of stacking comments. `AgentRunner` gains a PLAN gate after turn 1 (corrective turn citing the new `workpad` skill). The UI exposes `sync_status` as a badge.

**Tech Stack:** Elixir/OTP (ExUnit), Ecto/SQLite, Linear GraphQL via `SymphonyElixir.Linear.Client.graphql/3`, React/TypeScript (vitest).

**Spec:** `docs/superpowers/specs/2026-06-09-run-contract-design.md` (Phase 2). Depends on Phase 1 (`apply_publish_gate` pattern in `AgentRunner`).

**Key facts from the codebase (verified):**
- Driver behaviour: `pull/2`, `push/2`, `pull_pull_requests/2` in `elixir/lib/symphony_elixir/tracker/sync/driver.ex:21-23`.
- Linear rejects comment push: catch-all at `elixir/lib/symphony_elixir/linear/sync_driver.ex:30` → `{:error, {:unsupported_push, type, op}}`.
- GitHub comment push works: `elixir/lib/symphony_elixir/github/sync_driver.ex:30-36`.
- Jira comment push already works (`elixir/lib/symphony_elixir/jira/sync_driver.ex:34-40`); missing workpad classification + `comment:update` (sub-phase 2b).
- Local comment schema (`local_tracker_comments`) already has `kind`, `remote_id`, `sync_status` (default `"synced"` — wrong for fresh local writes), `dirty_fields`.
- Workpad regex today only in `GitHub.IssueComments` (`@workpad_pattern ~r/^\s*#*\s*Codex Workpad/i`).
- Outbox: `Outbox.enqueue/1`, `claim_pending/2`, `mark_done/2` (records `remote_id`), `mark_failed/3` (max 5 attempts). Post-push hook `LocalStore.link_comment_remote_id/2` runs for `comment:create`.
- Comment creation paths both land in `Context.add_comment` + `Outbox.enqueue("comment","create", %{"identifier","body","comment_id"})`: orchestrator via `Tracker.create_comment/2` → `LocalFirstTracker`, UI via `CommentController` → `LocalFirstAdapter.add_comment/4`.
- `Linear.Tracker.create_comment/2` already has the `commentCreate` mutation (success-only, no id) — the driver needs a variant returning the comment id.
- Skills are mirrored into workspaces by `WorkspaceSkills.prepare/1` from repo-root `skills/` — adding `skills/workpad/SKILL.md` is enough to distribute it.
- UI: `Comment` type (`tracker/src/types/comment.ts`) has no `syncStatus`; presenter `TrackerPresenter.comment/1` doesn't expose it; workpad picked by `kind === "workpad"` in `tracker/src/hooks/useIssueComments.ts:25-28`; badge in `issue-detail/CommentCard.tsx` (`WorkpadBadge`).

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `elixir/lib/symphony_elixir/tracker/workpad.ex` | Create | Workpad classification + body markers (single source of truth) |
| `elixir/lib/symphony_elixir/local_tracker/context.ex` | Modify | Classify `kind` on `add_comment`; add `update_comment/3`; `latest_workpad/2` |
| `elixir/lib/symphony_elixir/tracker/sync/local_first_adapter.ex` | Modify | `sync_status: "pending"` on enqueue; `update_comment` enqueue |
| `elixir/lib/symphony_elixir/tracker/sync/local_first_tracker.ex` | Modify | `upsert_workpad/2` implementation |
| `elixir/lib/symphony_elixir/tracker.ex` | Modify | `upsert_workpad/2` boundary |
| `elixir/lib/symphony_elixir/tracker/sync/engine.ex` | Modify | Post-push sync_status updates; `comment:update` linking |
| `elixir/lib/symphony_elixir/linear/comments.ex` | Create | `commentCreate`/`commentUpdate` returning ids |
| `elixir/lib/symphony_elixir/linear/sync_driver.ex` | Modify | Push `comment:create` / `comment:update` |
| `elixir/lib/symphony_elixir/github/sync_driver.ex` | Modify | Push `comment:update` |
| `elixir/lib/symphony_elixir/github/issue_comments.ex` | Modify | Delegate classification to `Tracker.Workpad`; `update/3` |
| `elixir/lib/symphony_elixir/jira/sync_driver.ex` | Modify (2b) | Push `comment:update` |
| `elixir/lib/symphony_elixir/jira/issue_adapter.ex` | Modify (2b) | Workpad classification in `normalize_comment/1` |
| `elixir/lib/symphony_elixir/agent_runner.ex` | Modify | PLAN gate after turn 1 |
| `elixir/lib/symphony_elixir/orchestrator.ex` | Modify | Incomplete/blocked notes go through `upsert_workpad` |
| `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex` | Modify | Expose `sync_status` |
| `skills/workpad/SKILL.md` | Create | Canonical workpad skill |
| `tracker/src/types/comment.ts` + `services` + `CommentCard.tsx` | Modify | Sync badge |

---

### Task 1: `Tracker.Workpad` — shared classification

**Files:**
- Create: `elixir/lib/symphony_elixir/tracker/workpad.ex`
- Modify: `elixir/lib/symphony_elixir/github/issue_comments.ex` (replace local `@workpad_pattern`/`classify/1` with delegation)
- Test: `elixir/test/symphony_elixir/tracker/workpad_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Tracker.WorkpadTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.Workpad

  test "classifies workpad bodies" do
    assert Workpad.classify("## Codex Workpad\n\nPlan...") == "workpad"
    assert Workpad.classify("  # codex workpad") == "workpad"
    assert Workpad.classify("Regular comment") == "comment"
    assert Workpad.classify(nil) == "comment"
  end

  test "workpad?/1 mirrors classify" do
    assert Workpad.workpad?("## Codex Workpad")
    refute Workpad.workpad?("hello")
  end
end
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/tracker/workpad_test.exs`
Expected: compile error — module unavailable

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Tracker.Workpad do
  @moduledoc """
  Single source of truth for workpad comment classification. A workpad is the
  issue comment whose body starts with `Codex Workpad` (any heading level);
  exactly one should exist per issue and it is edited in place.
  """

  @workpad_pattern ~r/^\s*#*\s*Codex Workpad/i

  @spec classify(String.t() | nil) :: String.t()
  def classify(body) when is_binary(body) do
    if Regex.match?(@workpad_pattern, body), do: "workpad", else: "comment"
  end

  def classify(_body), do: "comment"

  @spec workpad?(String.t() | nil) :: boolean()
  def workpad?(body), do: classify(body) == "workpad"
end
```

In `elixir/lib/symphony_elixir/github/issue_comments.ex`, delete the module's `@workpad_pattern` and replace the `classify/1` body:

```elixir
  defp classify(body), do: SymphonyElixir.Tracker.Workpad.classify(body)
```

- [ ] **Step 4: Run to verify pass + GitHub comment tests**

Run: `cd elixir && mix test test/symphony_elixir/tracker/workpad_test.exs test/symphony_elixir/github`
Expected: `0 failures`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/tracker/workpad.ex elixir/lib/symphony_elixir/github/issue_comments.ex elixir/test/symphony_elixir/tracker/workpad_test.exs
git commit -m "feat(tracker): shared workpad classification module"
```

---

### Task 2: Local comments — classify on create, `pending` sync status, `update_comment`

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex` (`add_comment` ~line 404; new `update_comment/3`, `latest_workpad/2`)
- Modify: `elixir/lib/symphony_elixir/tracker/sync/local_first_adapter.ex` (`add_comment/4` line ~102)
- Test: `elixir/test/symphony_elixir/local_tracker/context_comments_test.exs` (follow fixtures used by existing context tests)

- [ ] **Step 1: Write the failing tests**

```elixir
defmodule SymphonyElixir.LocalTracker.ContextCommentsTest do
  use SymphonyElixir.DataCase, async: false

  alias SymphonyElixir.LocalTracker.Context

  setup do
    # Reuse the project/issue creation helpers from existing Context tests in
    # elixir/test/symphony_elixir/local_tracker/ (create a project + one issue,
    # return %{project: project, issue: issue}).
    {:ok, ctx} = SymphonyElixir.LocalTrackerFixtures.project_with_issue()
    ctx
  end

  test "add_comment classifies workpad bodies", %{project: project, issue: issue} do
    {:ok, comment} = Context.add_comment(project.slug, issue.identifier, "## Codex Workpad\n\nPlan", %{})
    assert comment.kind == "workpad"

    {:ok, plain} = Context.add_comment(project.slug, issue.identifier, "hello", %{})
    assert plain.kind == "comment"
  end

  test "explicit kind attr still wins", %{project: project, issue: issue} do
    {:ok, comment} = Context.add_comment(project.slug, issue.identifier, "body", %{kind: "workpad"})
    assert comment.kind == "workpad"
  end

  test "update_comment replaces body and bumps sync metadata", %{project: project, issue: issue} do
    {:ok, comment} = Context.add_comment(project.slug, issue.identifier, "## Codex Workpad\nv1", %{})
    {:ok, updated} = Context.update_comment(comment.id, "## Codex Workpad\nv2")
    assert updated.body =~ "v2"
    assert updated.kind == "workpad"
  end

  test "latest_workpad returns the newest workpad comment", %{project: project, issue: issue} do
    {:ok, _} = Context.add_comment(project.slug, issue.identifier, "plain", %{})
    {:ok, wp} = Context.add_comment(project.slug, issue.identifier, "## Codex Workpad\nv1", %{})
    assert {:ok, found} = Context.latest_workpad(project.slug, issue.identifier)
    assert found.id == wp.id
  end

  test "latest_workpad without workpad returns error", %{project: project, issue: issue} do
    {:ok, _} = Context.add_comment(project.slug, issue.identifier, "plain", %{})
    assert {:error, :not_found} = Context.latest_workpad(project.slug, issue.identifier)
  end
end
```

Note: if no shared fixtures module exists, inline the project/issue creation copying the setup block of the nearest existing `Context` comment test.

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_comments_test.exs`
Expected: FAIL — workpad body classified as `"comment"`; `update_comment/2` undefined

- [ ] **Step 3: Implement**

In `Context.add_comment` (the attrs merge at ~line 404), classify by body when no explicit kind:

```elixir
      |> Map.merge(%{
        issue_id: issue.id,
        body: body,
        kind: attr(attrs, :kind, SymphonyElixir.Tracker.Workpad.classify(body)),
        author: attr(attrs, :author, "local")
      })
```

Add to `Context` (follow the module's existing patterns for fetching/changesets — it already has list/get helpers for comments):

```elixir
  @spec update_comment(integer(), String.t()) :: {:ok, Comment.t()} | {:error, term()}
  def update_comment(comment_id, body) when is_binary(body) do
    case Repo.get(Comment, comment_id) do
      nil ->
        {:error, :not_found}

      %Comment{} = comment ->
        comment
        |> Ecto.Changeset.change(%{body: body, kind: SymphonyElixir.Tracker.Workpad.classify(body)})
        |> Repo.update()
    end
  end

  @spec latest_workpad(String.t(), String.t()) :: {:ok, Comment.t()} | {:error, :not_found | term()}
  def latest_workpad(project_slug, identifier) do
    with {:ok, comments} <- list_comments(project_slug, identifier) do
      comments
      |> Enum.filter(&(&1.kind == "workpad"))
      |> List.last()
      |> case do
        nil -> {:error, :not_found}
        comment -> {:ok, comment}
      end
    end
  end
```

In `LocalFirstAdapter.add_comment/4`, mark the local row `pending` before enqueueing (it will flip to `synced` on push, Task 4):

```elixir
  def add_comment(%Project{} = project, identifier, body, attrs) do
    with {:ok, comment} <- IssueAdapter.dispatch_local(project, :add_comment, [identifier, body, attrs]),
         {:ok, comment} <- LocalStore.mark_comment_sync_status(comment.id, "pending") do
      payload = %{"identifier" => identifier, "body" => body, "comment_id" => comment.id}
      enqueue(project, identifier, "comment", "create", payload, nil)
      {:ok, comment}
    end
  end
```

(Keep the exact existing call into the adapter — the line above shows intent; preserve whatever `IssueAdapter` invocation the function currently uses and only add the `mark_comment_sync_status` step + keep the enqueue.)

Add to `LocalStore` (`elixir/lib/symphony_elixir/tracker/sync/local_store.ex`):

```elixir
  @spec mark_comment_sync_status(integer(), String.t()) :: {:ok, Comment.t()} | {:error, term()}
  def mark_comment_sync_status(comment_id, status)
      when status in ["synced", "pending", "conflict", "error", "archived"] do
    case Repo.get(SymphonyElixir.LocalTracker.Comment, comment_id) do
      nil ->
        {:error, :not_found}

      comment ->
        comment
        |> Ecto.Changeset.change(%{sync_status: status, last_synced_at: sync_timestamp(status)})
        |> Repo.update()
    end
  end

  defp sync_timestamp("synced"), do: DateTime.utc_now()
  defp sync_timestamp(_status), do: nil
```

Apply the same `mark_comment_sync_status(comment.id, "pending")` step in `LocalFirstTracker`'s comment creation (lines ~103–114).

- [ ] **Step 4: Run to verify pass + adapters**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker test/symphony_elixir/tracker`
Expected: `0 failures` (existing tests asserting default `sync_status: "synced"` on local create must be updated to `"pending"` — that change is the point of this task)

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/context.ex elixir/lib/symphony_elixir/tracker/sync/local_first_adapter.ex elixir/lib/symphony_elixir/tracker/sync/local_first_tracker.ex elixir/lib/symphony_elixir/tracker/sync/local_store.ex elixir/test/symphony_elixir/local_tracker/context_comments_test.exs
git commit -m "feat(tracker): classify workpads on local create and track pending sync status"
```

---

### Task 3: `comment:update` through the outbox + `Tracker.upsert_workpad/2`

**Files:**
- Modify: `elixir/lib/symphony_elixir/tracker/sync/local_first_adapter.ex`
- Modify: `elixir/lib/symphony_elixir/tracker/sync/local_first_tracker.ex`
- Modify: `elixir/lib/symphony_elixir/tracker.ex`
- Test: `elixir/test/symphony_elixir/tracker/upsert_workpad_test.exs`

Design: `Tracker.upsert_workpad(issue_id, body)` — if a local workpad comment exists, update it in place and enqueue `comment:update` (payload carries `comment_id`, `remote_id`, `body`, `identifier`; dedup key `comment:update:{project_id}:{comment_id}` so rapid edits coalesce); otherwise create (existing `comment:create` path). All Symphony-generated workpad notes (incomplete/blocked from Phase 1) switch to this, ending comment spam.

- [ ] **Step 1: Write the failing tests**

```elixir
defmodule SymphonyElixir.Tracker.UpsertWorkpadTest do
  use SymphonyElixir.DataCase, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker
  alias SymphonyElixir.Tracker.Sync.{Outbox, OutboxEntry}

  setup do
    {:ok, ctx} = SymphonyElixir.LocalTrackerFixtures.project_with_issue()
    ctx
  end

  test "creates the workpad when none exists", %{project: project, issue: issue} do
    assert :ok = Tracker.upsert_workpad(issue.id, "## Codex Workpad\nv1")

    assert {:ok, wp} = Context.latest_workpad(project.slug, issue.identifier)
    assert wp.body =~ "v1"

    assert [%OutboxEntry{entity_type: "comment", operation: "create"}] = pending_entries(project.id)
  end

  test "updates the existing workpad in place", %{project: project, issue: issue} do
    :ok = Tracker.upsert_workpad(issue.id, "## Codex Workpad\nv1")
    :ok = Tracker.upsert_workpad(issue.id, "## Codex Workpad\nv2")

    {:ok, comments} = Context.list_comments(project.slug, issue.identifier)
    workpads = Enum.filter(comments, &(&1.kind == "workpad"))
    assert length(workpads) == 1
    assert hd(workpads).body =~ "v2"

    ops = pending_entries(project.id) |> Enum.map(& &1.operation) |> Enum.sort()
    assert ops == ["create", "update"]
  end

  test "rapid updates coalesce by dedup key", %{project: project, issue: issue} do
    :ok = Tracker.upsert_workpad(issue.id, "## Codex Workpad\nv1")
    :ok = Tracker.upsert_workpad(issue.id, "## Codex Workpad\nv2")
    :ok = Tracker.upsert_workpad(issue.id, "## Codex Workpad\nv3")

    updates = pending_entries(project.id) |> Enum.filter(&(&1.operation == "update"))
    assert [%OutboxEntry{payload: %{"body" => body}}] = updates
    assert body =~ "v3"
  end

  defp pending_entries(project_id) do
    import Ecto.Query
    SymphonyElixir.Repo.all(from(e in OutboxEntry, where: e.project_id == ^project_id and e.status == "pending", order_by: e.id))
  end
end
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/tracker/upsert_workpad_test.exs`
Expected: FAIL — `Tracker.upsert_workpad/2` undefined

- [ ] **Step 3: Implement**

Boundary in `elixir/lib/symphony_elixir/tracker.ex` (next to `create_comment/2` at line 52):

```elixir
  @doc """
  Creates the issue's `## Codex Workpad` comment, or edits the existing one in
  place. One workpad per issue; edits flow to the remote tracker as
  `comment:update` outbox operations.
  """
  @spec upsert_workpad(String.t(), String.t()) :: :ok | {:error, term()}
  def upsert_workpad(issue_id, body) do
    adapter().upsert_workpad(issue_id, body)
  end
```

Add the callback to the tracker behaviour module that `adapter()` implementations follow (same file/behaviour where `create_comment/2` is declared), with a default fallback for tracker adapters that don't support it: implement in `LocalFirstTracker`:

```elixir
  @impl true
  def upsert_workpad(issue_id, body) do
    with {:ok, project, issue_record} <- resolve_project_for_issue(issue_id) do
      case Context.latest_workpad(project.slug, issue_record.identifier) do
        {:ok, workpad} ->
          update_workpad(project, issue_record, workpad, body)

        {:error, :not_found} ->
          create_comment(issue_id, body)
      end
    end
  end

  defp update_workpad(project, issue_record, workpad, body) do
    with {:ok, updated} <- Context.update_comment(workpad.id, body),
         {:ok, _} <- LocalStore.mark_comment_sync_status(updated.id, "pending") do
      payload = %{
        "identifier" => issue_record.identifier,
        "body" => body,
        "comment_id" => updated.id,
        "remote_id" => updated.remote_id
      }

      Outbox.enqueue(%{
        project_id: project.id,
        issue_id: issue_record.id,
        entity_type: "comment",
        operation: "update",
        payload: payload,
        dedup_key: "comment:update:#{project.id}:#{updated.id}"
      })

      :ok
    end
  end
```

(Reuse `resolve_project_for_issue/1` already present in `LocalFirstTracker`; match `Outbox.enqueue/1`'s actual argument shape — see how `LocalFirstAdapter.enqueue/6` builds entries and mirror it.)

For the non-sync (legacy live) tracker adapters (`Linear.Tracker`, `GitHub` live tracker), implement `upsert_workpad/2` as a fallback to `create_comment/2` so the behaviour stays total.

In `orchestrator.ex`, switch the Phase 1/incomplete notes to the upsert: replace `Tracker.create_comment(issue_id, incomplete_workpad_comment_body(reason))` and `Tracker.create_comment(issue_id, blocked_comment_body(violations))` with `Tracker.upsert_workpad(issue_id, ...)`.

- [ ] **Step 4: Run to verify pass + orchestrator tests**

Run: `cd elixir && mix test test/symphony_elixir/tracker/upsert_workpad_test.exs test/symphony_elixir/orchestrator_test.exs test/symphony_elixir/orchestrator_run_contract_test.exs`
Expected: `0 failures`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/tracker.ex elixir/lib/symphony_elixir/tracker/sync/local_first_tracker.ex elixir/lib/symphony_elixir/orchestrator.ex elixir/test/symphony_elixir/tracker/upsert_workpad_test.exs
git commit -m "feat(tracker): upsert workpad in place with comment:update outbox operation"
```

---

### Task 4: Engine — push `comment:update`, flip sync status on push results

**Files:**
- Modify: `elixir/lib/symphony_elixir/tracker/sync/engine.ex` (post-push hooks at lines ~370)
- Modify: `elixir/lib/symphony_elixir/github/sync_driver.ex`
- Test: `elixir/test/symphony_elixir/tracker/sync/engine_comment_sync_test.exs` (follow the existing engine test's fake-driver pattern)

- [ ] **Step 1: Write the failing tests**

```elixir
defmodule SymphonyElixir.Tracker.Sync.EngineCommentSyncTest do
  use SymphonyElixir.DataCase, async: false

  alias SymphonyElixir.LocalTracker.Comment
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Engine, Outbox}

  defmodule OkDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver
    def pull(_project, _opts), do: {:ok, []}
    def push(_project, _entry), do: {:ok, "remote-comment-1"}
    def pull_pull_requests(_project, _issue), do: {:ok, []}
  end

  defmodule FailDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver
    def pull(_project, _opts), do: {:ok, []}
    def push(_project, _entry), do: {:error, :boom}
    def pull_pull_requests(_project, _issue), do: {:ok, []}
  end

  setup do
    {:ok, ctx} = SymphonyElixir.LocalTrackerFixtures.project_with_issue()
    ctx
  end

  test "successful comment:create push links remote id and marks comment synced", %{project: project, issue: issue} do
    {:ok, comment} = SymphonyElixir.LocalTracker.Context.add_comment(project.slug, issue.identifier, "## Codex Workpad\nv1", %{})
    # add_comment via Context alone does not enqueue; enqueue like the adapter does:
    Outbox.enqueue(%{project_id: project.id, issue_id: issue.id, entity_type: "comment", operation: "create",
      payload: %{"identifier" => issue.identifier, "body" => comment.body, "comment_id" => comment.id}, dedup_key: nil})

    assert {:ok, %{pushed: 1, failed: 0}} = Engine.sync_project(project, driver: OkDriver, force: true)

    reloaded = Repo.get!(Comment, comment.id)
    assert reloaded.remote_id == "remote-comment-1"
    assert reloaded.sync_status == "synced"
  end

  test "comment:update push marks comment synced", %{project: project, issue: issue} do
    {:ok, comment} = SymphonyElixir.LocalTracker.Context.add_comment(project.slug, issue.identifier, "## Codex Workpad\nv1", %{})
    Outbox.enqueue(%{project_id: project.id, issue_id: issue.id, entity_type: "comment", operation: "update",
      payload: %{"identifier" => issue.identifier, "body" => "v2", "comment_id" => comment.id, "remote_id" => "remote-comment-1"},
      dedup_key: "comment:update:#{project.id}:#{comment.id}"})

    assert {:ok, %{pushed: 1, failed: 0}} = Engine.sync_project(project, driver: OkDriver, force: true)
    assert Repo.get!(Comment, comment.id).sync_status == "synced"
  end

  test "exhausted failures mark comment sync_status error", %{project: project, issue: issue} do
    {:ok, comment} = SymphonyElixir.LocalTracker.Context.add_comment(project.slug, issue.identifier, "x", %{})
    Outbox.enqueue(%{project_id: project.id, issue_id: issue.id, entity_type: "comment", operation: "create",
      payload: %{"identifier" => issue.identifier, "body" => "x", "comment_id" => comment.id}, dedup_key: nil})

    Enum.each(1..5, fn _attempt ->
      Engine.sync_project(project, driver: FailDriver, force: true)
    end)

    assert Repo.get!(Comment, comment.id).sync_status == "error"
  end
end
```

Note: adjust `Engine.sync_project/2` invocation to the real test seam — the existing engine tests show how a driver is injected (driver opt, project tracker_kind, or app env). Mirror exactly that mechanism.

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/tracker/sync/engine_comment_sync_test.exs`
Expected: FAIL — `sync_status` stays `"pending"` / update op unhandled

- [ ] **Step 3: Implement**

In `engine.ex`, extend the post-push linking (where `comment:create` already calls `LocalStore.link_comment_remote_id/2`):

```elixir
  defp record_pushed(acc, entry, remote_id) do
    Outbox.mark_done(entry, remote_id)
    after_push(entry, remote_id)
    %{acc | pushed: acc.pushed + 1}
  end

  defp after_push(%OutboxEntry{entity_type: "comment", operation: "create", payload: payload}, remote_id) do
    with comment_id when is_integer(comment_id) <- payload["comment_id"] do
      LocalStore.link_comment_remote_id(comment_id, remote_id)
      LocalStore.mark_comment_sync_status(comment_id, "synced")
    end

    :ok
  end

  defp after_push(%OutboxEntry{entity_type: "comment", operation: "update", payload: payload}, _remote_id) do
    with comment_id when is_integer(comment_id) <- payload["comment_id"] do
      LocalStore.mark_comment_sync_status(comment_id, "synced")
    end

    :ok
  end

  defp after_push(_entry, _remote_id), do: :ok
```

(Fold the existing `issue:create` / `state:move` post-push handling into the same `after_push/2` dispatch, preserving current behavior.)

In `record_failed` (the `mark_failed` path), when an entry transitions to terminal `failed` status and is a comment op, set `sync_status: "error"`:

```elixir
  defp record_failed(acc, entry, reason, max_attempts) do
    {:ok, updated} = Outbox.mark_failed(entry, reason, max_attempts)

    if updated.status == "failed" and updated.entity_type == "comment" do
      case updated.payload["comment_id"] do
        comment_id when is_integer(comment_id) -> LocalStore.mark_comment_sync_status(comment_id, "error")
        _missing -> :ok
      end
    end

    %{acc | failed: acc.failed + 1}
  end
```

(If `Outbox.mark_failed/3` currently returns something other than `{:ok, entry}`, adapt: have it return the updated entry — small change with its own test in `outbox_test.exs`.)

In `github/sync_driver.ex`, add the update clause above the catch-all:

```elixir
  def push(%Project{} = project, %OutboxEntry{entity_type: "comment", operation: "update", payload: payload}) do
    case adapter().update_comment(project, payload["remote_id"], payload["body"]) do
      {:ok, %{remote_id: remote_id}} -> {:ok, remote_id}
      {:ok, _other} -> {:ok, payload["remote_id"]}
      error -> error
    end
  end
```

Implement `update_comment/3` down the GitHub chain (`GitHub.IssueAdapter` → `GitHub.IssueComments.update/3` → `GitHub.Api`): GraphQL mutation `updateIssueComment(input: {id: $id, body: $body})` with REST fallback `PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}` — mirror exactly how `add_comment` is layered in those modules today, including error shapes.

- [ ] **Step 4: Run to verify pass + sync suite**

Run: `cd elixir && mix test test/symphony_elixir/tracker/sync test/symphony_elixir/github`
Expected: `0 failures`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/tracker/sync/engine.ex elixir/lib/symphony_elixir/github elixir/test/symphony_elixir/tracker/sync/engine_comment_sync_test.exs
git commit -m "feat(sync): comment update push and sync-status lifecycle"
```

---

### Task 5: Linear comment push (`commentCreate`/`commentUpdate`)

**Files:**
- Create: `elixir/lib/symphony_elixir/linear/comments.ex`
- Modify: `elixir/lib/symphony_elixir/linear/sync_driver.ex` (add clauses above the catch-all at line 30)
- Test: `elixir/test/symphony_elixir/linear/comments_test.exs`, extend `elixir/test/symphony_elixir/linear/sync_driver_test.exs` (if absent, create following another driver test)

- [ ] **Step 1: Write the failing tests**

```elixir
defmodule SymphonyElixir.Linear.CommentsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Linear.Comments

  test "create returns the remote comment id" do
    client = fn query, variables, _opts ->
      assert query =~ "commentCreate"
      assert variables == %{issueId: "linear-uuid", body: "## Codex Workpad\nv1"}
      {:ok, %{"data" => %{"commentCreate" => %{"success" => true, "comment" => %{"id" => "cmt-1"}}}}}
    end

    assert {:ok, "cmt-1"} = Comments.create("linear-uuid", "## Codex Workpad\nv1", client: client)
  end

  test "create surfaces graphql failure" do
    client = fn _q, _v, _o -> {:ok, %{"data" => %{"commentCreate" => %{"success" => false}}}} end
    assert {:error, {:linear_comment_create_failed, _}} = Comments.create("id", "b", client: client)
  end

  test "update returns the remote comment id" do
    client = fn query, variables, _opts ->
      assert query =~ "commentUpdate"
      assert variables == %{id: "cmt-1", body: "v2"}
      {:ok, %{"data" => %{"commentUpdate" => %{"success" => true, "comment" => %{"id" => "cmt-1"}}}}}
    end

    assert {:ok, "cmt-1"} = Comments.update("cmt-1", "v2", client: client)
  end
end
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/linear/comments_test.exs`
Expected: compile error — module unavailable

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Linear.Comments do
  @moduledoc """
  Linear comment mutations used by the sync driver. Unlike
  `Linear.Tracker.create_comment/2` (success-only), these return the remote
  comment id so the outbox can link it for in-place workpad updates.
  """

  alias SymphonyElixir.Linear.Client

  @create_mutation """
  mutation SymphonyCommentCreate($issueId: String!, $body: String!) {
    commentCreate(input: {issueId: $issueId, body: $body}) {
      success
      comment { id }
    }
  }
  """

  @update_mutation """
  mutation SymphonyCommentUpdate($id: String!, $body: String!) {
    commentUpdate(id: $id, input: {body: $body}) {
      success
      comment { id }
    }
  }
  """

  @spec create(String.t(), String.t(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def create(issue_remote_id, body, opts \\ []) do
    client = Keyword.get(opts, :client, &Client.graphql/3)

    case client.(@create_mutation, %{issueId: issue_remote_id, body: body}, []) do
      {:ok, %{"data" => %{"commentCreate" => %{"success" => true, "comment" => %{"id" => id}}}}} ->
        {:ok, id}

      {:ok, response} ->
        {:error, {:linear_comment_create_failed, response}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @spec update(String.t(), String.t(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def update(comment_remote_id, body, opts \\ []) do
    client = Keyword.get(opts, :client, &Client.graphql/3)

    case client.(@update_mutation, %{id: comment_remote_id, body: body}, []) do
      {:ok, %{"data" => %{"commentUpdate" => %{"success" => true, "comment" => %{"id" => id}}}}} ->
        {:ok, id}

      {:ok, response} ->
        {:error, {:linear_comment_update_failed, response}}

      {:error, reason} ->
        {:error, reason}
    end
  end
end
```

In `linear/sync_driver.ex`, add above the catch-all (line 30). The Linear issue UUID comes from the local issue record's `remote_id` — resolve it from the outbox entry's `issue_id` association (the entry `belongs_to(:issue, IssueRecord)`):

```elixir
  def push(%Project{}, %OutboxEntry{entity_type: "comment", operation: "create", payload: payload} = entry) do
    with {:ok, issue_remote_id} <- issue_remote_id(entry) do
      Comments.create(issue_remote_id, payload["body"])
    end
  end

  def push(%Project{}, %OutboxEntry{entity_type: "comment", operation: "update", payload: %{"remote_id" => remote_id} = payload})
      when is_binary(remote_id) and remote_id != "" do
    Comments.update(remote_id, payload["body"])
  end

  # update without a known remote id (workpad created before first push
  # completed): fall back to create so the content still reaches Linear.
  def push(%Project{} = project, %OutboxEntry{entity_type: "comment", operation: "update"} = entry) do
    push(project, %{entry | operation: "create"})
  end

  defp issue_remote_id(%OutboxEntry{} = entry) do
    case SymphonyElixir.Repo.preload(entry, :issue) do
      %OutboxEntry{issue: %{remote_id: remote_id}} when is_binary(remote_id) and remote_id != "" ->
        {:ok, remote_id}

      _missing ->
        {:error, :issue_remote_id_unknown}
    end
  end
```

Driver test (extend/create `linear/sync_driver_test.exs`): assert `comment:create` no longer returns `{:unsupported_push, "comment", "create"}` and that `state:move` behavior is unchanged. Inject the GraphQL client the same way `Comments` accepts it — if the driver cannot thread opts, set the client via app env test seam consistent with how `Linear.Client` requests are stubbed in existing Linear tests (`request_fun` opt / Req test adapter).

- [ ] **Step 4: Run to verify pass**

Run: `cd elixir && mix test test/symphony_elixir/linear`
Expected: `0 failures`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/linear elixir/test/symphony_elixir/linear
git commit -m "feat(linear): push workpad comments to Linear via commentCreate/commentUpdate"
```

---

### Task 6: PLAN gate in AgentRunner

**Files:**
- Modify: `elixir/lib/symphony_elixir/agent_runner.ex`
- Test: `elixir/test/symphony_elixir/agent_runner_plan_gate_test.exs`

Design: after turn 1 completes (same hook point as Phase 1's publish gate, but evaluated only once), check that a workpad exists for the issue. Checker default: `Context.latest_workpad(project_slug, identifier)`. Violation → 1 corrective turn citing the `workpad` skill; if still missing, log a warning and continue (the workpad gate is softer than publish: it must not strand implementation work). Injectable via `opts[:workpad_checker]`.

- [ ] **Step 1: Write the failing tests**

```elixir
defmodule SymphonyElixir.AgentRunnerPlanGateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentRunner

  test "no corrective turn when workpad exists" do
    checker = fn -> :ok end
    run_turn = fn _prompt -> raise "must not run corrective turn" end
    assert :ok = AgentRunner.apply_plan_gate(checker, run_turn)
  end

  test "missing workpad triggers one corrective turn" do
    {:ok, agent} = Agent.start_link(fn -> 0 end)

    checker = fn ->
      case Agent.get_and_update(agent, fn n -> {n, n + 1} end) do
        0 -> {:error, :not_found}
        _ -> :ok
      end
    end

    run_turn = fn prompt ->
      assert prompt =~ "Plan gate failed"
      assert prompt =~ "workpad"
      :ok
    end

    assert :ok = AgentRunner.apply_plan_gate(checker, run_turn)
  end

  test "still-missing workpad logs and continues" do
    checker = fn -> {:error, :not_found} end
    run_turn = fn _prompt -> :ok end
    assert :ok = AgentRunner.apply_plan_gate(checker, run_turn)
  end
end
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/agent_runner_plan_gate_test.exs`
Expected: FAIL — `apply_plan_gate/2` undefined

- [ ] **Step 3: Implement**

```elixir
  @doc false
  @spec apply_plan_gate((-> :ok | {:error, term()}), (String.t() -> :ok | {:error, term()})) :: :ok
  def apply_plan_gate(workpad_checker, run_turn) do
    case workpad_checker.() do
      :ok ->
        :ok

      {:error, _reason} ->
        _result = run_turn.(plan_gate_prompt())

        case workpad_checker.() do
          :ok ->
            :ok

          {:error, reason} ->
            Logger.warning("Plan gate still unsatisfied after corrective turn: #{inspect(reason)}; continuing run")
            :ok
        end
    end
  end

  defp plan_gate_prompt do
    """
    ## Plan gate failed (Symphony)

    No `## Codex Workpad` comment exists for this issue yet. Before any further
    implementation, read and follow the `workpad` skill: create the workpad
    comment with the plan, acceptance criteria, and a Validation section. Do
    nothing else in this turn.
    """
  end
```

Wire into `do_run_codex_turns/9`: after the `CodingAgent.run_turn` success for `turn_number == 1` and before `continue_with_issue?`:

```elixir
      if turn_number == 1 do
        workpad_checker =
          Keyword.get(opts, :workpad_checker, fn ->
            case Context.latest_workpad(issue.project_slug, issue.identifier) do
              {:ok, _workpad} -> :ok
              {:error, reason} -> {:error, reason}
            end
          end)

        run_corrective_turn = fn prompt ->
          case CodingAgent.run_turn(advanced_session, prompt, issue, agent_turn_opts(opts, agent_kind, codex_update_recipient, issue)) do
            {:ok, _turn_session} -> :ok
            {:error, reason} -> {:error, reason}
          end
        end

        apply_plan_gate(workpad_checker, run_corrective_turn)
      end
```

(`Context` needs `project_slug`/`identifier` — both live on `%Issue{}`. When `project_slug` is nil — legacy live trackers — default the checker to `fn -> :ok end` so the gate is a no-op.)

- [ ] **Step 4: Run to verify pass + runner suite**

Run: `cd elixir && mix test test/symphony_elixir/agent_runner_plan_gate_test.exs test/symphony_elixir/agent_runner_test.exs`
Expected: `0 failures` (existing run tests use issues without `project_slug` → gate no-ops)

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/agent_runner.ex elixir/test/symphony_elixir/agent_runner_plan_gate_test.exs
git commit -m "feat(agent-runner): plan gate verifies workpad after the first turn"
```

---

### Task 7: `workpad` skill

**Files:**
- Create: `skills/workpad/SKILL.md` (auto-distributed to workspaces by `WorkspaceSkills.prepare/1`)

- [ ] **Step 1: Write the skill**

```markdown
---
name: workpad
description:
  Create and maintain the single `## Codex Workpad` comment on the tracked
  issue: plan, acceptance criteria, validation results, and outcome. Use at
  the start of every issue run and whenever progress changes.
---

# Workpad

## Goals

- Exactly ONE comment per issue whose body starts with `## Codex Workpad`.
- It is the human-readable source of truth: plan, acceptance criteria,
  validation, outcome.
- Always EDIT the existing workpad in place; never post a second one.

## Structure (use exactly these sections)

```markdown
## Codex Workpad

### Plan
- [ ] step 1
- [ ] step 2

### Acceptance criteria
- criterion 1

### Validation
(test commands you ran and their results; updated as you go)

### Outcome
(one of: `in-progress`, `done — PR <url>`, or `no-op — <justification>`)
```

## Creating / updating

Use the tracker tool available in your session:

- Local-first projects (Linear/GitHub/Jira synced): create or update the
  comment through the project's comment mechanism (`add_comment` API /
  `linear_graphql` `commentCreate`-`commentUpdate` / `gh issue comment` with
  `--edit-last` for updates). Symphony syncs it to the remote tracker.
- To update: fetch the existing workpad comment id first; only create a new
  comment when none exists.

## No-op outcome

If after investigation the task requires no changes, record it explicitly:

```markdown
### Outcome
no-op — <why nothing needed to change>
```

Symphony's gates accept a clean working tree only when this outcome is
recorded.

## Definition of done (Symphony plan gate)

Symphony verifies after your first turn that a comment whose body starts with
`## Codex Workpad` exists on the issue, containing a Plan and Acceptance
criteria. Create it BEFORE writing any code.
```

- [ ] **Step 2: Verify distribution**

Run: `cd elixir && mix test test/symphony_elixir/workspace_skills_test.exs`
Expected: pass — `WorkspaceSkills.prepare/1` discovers top-level `skills/<name>/SKILL.md` automatically. If a test enumerates expected skill names, add `workpad` to it.

- [ ] **Step 3: Commit**

```bash
git add skills/workpad/SKILL.md
git commit -m "feat(skills): canonical workpad skill"
```

---

### Task 8: Sync badge in the UI

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex` (`comment/1`, lines 141–151)
- Modify: `tracker/src/types/comment.ts`
- Modify: `tracker/src/services/comments.ts` (the normalizer mapping backend → `Comment`)
- Modify: `tracker/src/components/issues/issue-detail/CommentCard.tsx`
- Test: `elixir/test/symphony_elixir_web/presenters/tracker_presenter_test.exs` (extend), `tracker/src/components/issues/issue-detail/__tests__/CommentCard.syncBadge.test.tsx`

- [ ] **Step 1: Presenter — failing test then implement**

Test (extend presenter test):

```elixir
  test "comment/1 exposes sync_status" do
    comment = %SymphonyElixir.LocalTracker.Comment{id: 1, issue_id: 2, kind: "workpad", body: "b", author: "a", sync_status: "pending", inserted_at: ~U[2026-06-10 00:00:00.000000Z], updated_at: ~U[2026-06-10 00:00:00.000000Z]}
    assert %{sync_status: "pending"} = SymphonyElixirWeb.TrackerPresenter.comment(comment)
  end
```

Implementation — add to the map in `TrackerPresenter.comment/1`:

```elixir
      sync_status: Map.get(comment, :sync_status, "synced"),
```

- [ ] **Step 2: Frontend type + normalizer**

`tracker/src/types/comment.ts` — add to the interface:

```ts
  syncStatus: "synced" | "pending" | "conflict" | "error" | "archived" | null;
```

In the comments service normalizer (where backend fields map to `Comment`), add:

```ts
  syncStatus: raw.sync_status ?? null,
```

- [ ] **Step 3: Badge — failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SyncBadge } from "../CommentCard";

describe("SyncBadge", () => {
  it("shows pending state", () => {
    render(<SyncBadge syncStatus="pending" />);
    expect(screen.getByText(/syncing/i)).toBeInTheDocument();
  });

  it("shows error state", () => {
    render(<SyncBadge syncStatus="error" />);
    expect(screen.getByText(/sync failed/i)).toBeInTheDocument();
  });

  it("renders nothing when synced", () => {
    const { container } = render(<SyncBadge syncStatus="synced" />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 4: Implement badge** (export from `CommentCard.tsx`, render next to `WorkpadBadge` inside the card header)

```tsx
export function SyncBadge({ syncStatus }: { syncStatus: string | null }) {
  if (!syncStatus || syncStatus === "synced" || syncStatus === "archived") return null;

  const styles: Record<string, string> = {
    pending: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
    conflict: "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200",
    error: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  };

  const labels: Record<string, string> = {
    pending: "Syncing…",
    conflict: "Sync conflict",
    error: "Sync failed",
  };

  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${styles[syncStatus] ?? styles.error}`}>
      {labels[syncStatus] ?? "Sync failed"}
    </span>
  );
}
```

Render in `CommentCard` header: `<SyncBadge syncStatus={comment.syncStatus} />` next to where `WorkpadBadge` renders.

- [ ] **Step 5: Run + commit**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__` and `cd elixir && mix test test/symphony_elixir_web`
Expected: all pass.

```bash
git add elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex tracker/src/types/comment.ts tracker/src/services tracker/src/components/issues/issue-detail
git commit -m "feat(tracker-ui): comment sync-status badge"
```

---

### Task 9 (sub-phase 2b): Jira workpad classification + `comment:update`

**Files:**
- Modify: `elixir/lib/symphony_elixir/jira/issue_adapter.ex` (`normalize_comment/1`)
- Modify: `elixir/lib/symphony_elixir/jira/sync_driver.ex` (add `comment:update` clause)
- Test: extend `elixir/test/symphony_elixir/jira/*_test.exs` following existing Jira test patterns

- [ ] **Step 1: Classification** — in `Jira.IssueAdapter.normalize_comment/1`, add `kind: SymphonyElixir.Tracker.Workpad.classify(body)` to the normalized map (mirroring GitHub's normalizer). Failing test: a pulled Jira comment whose body starts with `## Codex Workpad` normalizes to `kind: "workpad"`.

- [ ] **Step 2: Update push** — in `jira/sync_driver.ex`, above the catch-all:

```elixir
  def push(%Project{} = project, %OutboxEntry{entity_type: "comment", operation: "update", payload: payload}) do
    case adapter().update_comment(project, payload["identifier"], payload["remote_id"], payload["body"]) do
      {:ok, %{remote_id: remote_id}} -> {:ok, remote_id}
      {:ok, _other} -> {:ok, payload["remote_id"]}
      error -> error
    end
  end
```

Implement `Jira.IssueAdapter.update_comment/4` calling `Jira.Client` REST `PUT /rest/api/3/issue/{key}/comment/{id}` — mirror the structure of the existing `add_comment/4` in the same module (auth, body shape, error handling).

- [ ] **Step 3: Run + commit**

Run: `cd elixir && mix test test/symphony_elixir/jira`

```bash
git add elixir/lib/symphony_elixir/jira elixir/test/symphony_elixir/jira
git commit -m "feat(jira): workpad classification and comment update push"
```

---

### Task 10: Docs + full gates

- [ ] **Step 1:** Update `elixir/README.md` (workpad/PLAN-gate behavior, comment sync semantics incl. in-place updates) and `SPEC.md` (one paragraph). Same content as the spec's Section 4, condensed.
- [ ] **Step 2:** Run `make -C elixir all` and `cd tracker && npx vitest run`. Fix findings.
- [ ] **Step 3:**

```bash
git add -A && git commit -m "docs: reliable workpad behavior; chore: quality gates"
```

---

## Self-review (against spec Phase 2)

- PLAN gate + skill `workpad`: Tasks 6, 7 ✓
- Driver `push_comment`/`update_comment` (Linear first, GitHub standardized): Tasks 4, 5 ✓ — implemented as `comment:create|update` outbox operations through the existing `push/2` callback rather than new behaviour callbacks (less churn, same guarantee).
- Workpad remoto editado in-place, `remote_comment_id` armazenado: Tasks 2, 3, 4 ✓ (`remote_id` no schema de comment já existia; linking no `after_push`).
- Badge de sync (`synced`/`pending`/`failed`): Tasks 2, 4, 8 ✓ (estados reais: `pending`/`conflict`/`error`).
- Jira: Task 9 ✓ — escopo corrigido vs. spec original: driver Jira já existia com push de `comment:create`; 2b cobre só classificação + update.
- Falhas não engolidas: `sync_status: "error"` + badge (Task 4/8) ✓.
