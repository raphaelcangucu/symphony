# Task Grouping — Phase 1: Persistence & API Implementation Plan

**Goal:** Persist board task groups (a member issue points at a lead issue via a
self-referential `group_lead_id`) and expose group/ungroup HTTP endpoints, so the
board UI (Phase 3) and the orchestrator (Phase 2) can build on a stable contract.

**Architecture:** Add a nullable self-FK column `group_lead_id` to
`local_tracker_issues`. A *member* has `group_lead_id = <lead id>`; a *lead* has
`NULL` and ≥1 issue pointing at it. The local tracker `Context` gains
group/ungroup/list functions plus "move-travels-together" (moving a lead moves
its members). New `GroupController` mirrors `BlockerController`. The issue
struct/DTO/presenter and the React mapper carry `group_lead_identifier` and
`group_member_identifiers`.

**Tech Stack:** Elixir/Phoenix + Ecto (SQLite), ExUnit; React/TypeScript +
Vitest for the client mapper.

> **Phased delivery.** This is Phase 1 of 3 (see
> `docs/superpowers/specs/2026-06-18-task-grouping-board-design.md`).
> Phase 2 = orchestrator grouped execution. Phase 3 = board drag-to-group UI.
> Each phase is independently testable. Run `make all` in `elixir/` and
> `npm test` in `tracker/` before completing this phase.

---

## File Structure

**Backend (`elixir/`):**
- Create: `priv/repo/migrations/20260618000001_add_group_lead_id_to_local_tracker_issues.exs` — adds the column + index.
- Modify: `lib/symphony_elixir/local_tracker/issue_record.ex` — `group_lead`/`group_members` associations + cast.
- Modify: `lib/symphony_elixir/issue.ex` — `group_lead_identifier`, `group_member_identifiers` struct fields.
- Modify: `lib/symphony_elixir/local_tracker/issue_mapper.ex` — populate the two fields.
- Modify: `lib/symphony_elixir/tracker/issue_dto.ex` — DTO fields + normalize.
- Modify: `lib/symphony_elixir/local_tracker/issue_adapter.ex` — `to_dto/1` populates the fields.
- Modify: `lib/symphony_elixir_web/presenters/tracker_presenter.ex` — emit the fields in `issue(%IssueDTO{})`.
- Modify: `lib/symphony_elixir/local_tracker/context.ex` — `@issue_preloads`, `set_issue_group/3`, `remove_from_group/2`, `list_group_members/2`, move-travels-together, lead-removal promotion.
- Modify: `lib/symphony_elixir_web/tracker_errors.ex` — render new group error reasons.
- Create: `lib/symphony_elixir_web/controllers/tracker/group_controller.ex`.
- Modify: `lib/symphony_elixir_web/router.ex` — group routes (after blockers).

**Frontend (`tracker/`):**
- Modify: `src/types/issue.ts` — `groupLeadIdentifier`, `groupMemberIdentifiers`.
- Modify: `src/services/mappers.ts` — `BackendIssueDto` keys + `normalizeIssue`.
- Modify: `src/services/issues.ts` — `groupIssue`/`ungroupIssue` client calls.

**Tests:**
- `test/symphony_elixir/local_tracker/context_test.exs` (group/move).
- `test/symphony_elixir/local_tracker/issue_mapper_test.exs` (mapper fields).
- `test/symphony_elixir/tracker/issue_dto_test.exs` (DTO defaults).
- `test/symphony_elixir_web/controllers/tracker/group_controller_test.exs` (new).
- `tracker/src/services/__tests__/mappers.test.ts` (or co-located) for `normalizeIssue`.

---

## Task 1: Migration — add `group_lead_id`

**Files:**
- Create: `elixir/priv/repo/migrations/20260618000001_add_group_lead_id_to_local_tracker_issues.exs`

- [ ] **Step 1: Write the migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.AddGroupLeadIdToLocalTrackerIssues do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_issues) do
      add(:group_lead_id, references(:local_tracker_issues, on_delete: :nilify_all))
    end

    create(index(:local_tracker_issues, [:group_lead_id]))
  end
end
```

- [ ] **Step 2: Run the migration**

Run: `cd elixir && mix ecto.migrate`
Expected: migration runs; `local_tracker_issues` gains `group_lead_id` and the index. (Tests re-run all migrations via `test_helper.exs`.)

- [ ] **Step 3: Commit**

```bash
git add elixir/priv/repo/migrations/20260618000001_add_group_lead_id_to_local_tracker_issues.exs
git commit -m "feat(tracker): add group_lead_id column to local issues"
```

---

## Task 2: `IssueRecord` associations + cast

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/issue_record.ex`

- [ ] **Step 1: Add the self-referential associations**

In the `schema "local_tracker_issues"` block, after the existing `has_many(:target_relations, ...)` line, add:

```elixir
    belongs_to(:group_lead, __MODULE__, foreign_key: :group_lead_id)
    has_many(:group_members, __MODULE__, foreign_key: :group_lead_id)
```

- [ ] **Step 2: Cast `:group_lead_id`**

In `changeset/2`, add `:group_lead_id` to the `cast/3` field list (e.g. right after `:archived_at`):

```elixir
      :archived_at,
      :group_lead_id
```

- [ ] **Step 3: Compile to verify**

Run: `cd elixir && mix compile --warnings-as-errors`
Expected: compiles, no warnings.

- [ ] **Step 4: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/issue_record.ex
git commit -m "feat(tracker): add group lead/member associations to IssueRecord"
```

---

## Task 3: `Issue` struct + `IssueMapper` fields

**Files:**
- Modify: `elixir/lib/symphony_elixir/issue.ex`
- Modify: `elixir/lib/symphony_elixir/local_tracker/issue_mapper.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/issue_mapper_test.exs`

- [ ] **Step 1: Write the failing test**

Append to `issue_mapper_test.exs` (inside the existing `describe`/module; mirror its existing setup of building an `IssueRecord`). Add a test that builds a lead record with a preloaded member and asserts the mapper surfaces identifiers:

```elixir
  test "to_issue surfaces group lead and member identifiers" do
    lead = %IssueRecord{identifier: "MAC-1"}
    member_record = %IssueRecord{identifier: "MAC-2", group_lead: lead}
    lead_record = %IssueRecord{identifier: "MAC-1", group_members: [%IssueRecord{identifier: "MAC-2"}]}

    assert IssueMapper.to_issue(member_record).group_lead_identifier == "MAC-1"
    assert IssueMapper.to_issue(member_record).group_member_identifiers == []
    assert IssueMapper.to_issue(lead_record).group_lead_identifier == nil
    assert IssueMapper.to_issue(lead_record).group_member_identifiers == ["MAC-2"]
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/issue_mapper_test.exs`
Expected: FAIL — `Issue` has no `group_lead_identifier` key (KeyError) / mapper does not set it.

- [ ] **Step 3: Add struct fields**

In `elixir/lib/symphony_elixir/issue.ex`, add to the `defstruct` list (after `assigned_to_worker: true`):

```elixir
    group_lead_identifier: nil,
    group_member_identifiers: [],
```

- [ ] **Step 4: Populate in the mapper**

In `issue_mapper.ex`, add to the `%Issue{...}` map in `to_issue/1` (after `assigned_to_worker:` line):

```elixir
      group_lead_identifier: group_lead_identifier(record.group_lead),
      group_member_identifiers: group_member_identifiers(record.group_members),
```

Add these private helpers near the other `defp`s:

```elixir
  defp group_lead_identifier(%IssueRecord{identifier: identifier}) when is_binary(identifier), do: identifier
  defp group_lead_identifier(_), do: nil

  defp group_member_identifiers(members) when is_list(members) do
    members
    |> Enum.flat_map(fn
      %IssueRecord{identifier: identifier} when is_binary(identifier) -> [identifier]
      _ -> []
    end)
  end

  defp group_member_identifiers(_), do: []
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/issue_mapper_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/issue.ex elixir/lib/symphony_elixir/local_tracker/issue_mapper.ex elixir/test/symphony_elixir/local_tracker/issue_mapper_test.exs
git commit -m "feat(tracker): map group lead/member identifiers onto Issue struct"
```

---

## Task 4: `IssueDTO` fields + `IssueAdapter.to_dto/1`

**Files:**
- Modify: `elixir/lib/symphony_elixir/tracker/issue_dto.ex`
- Modify: `elixir/lib/symphony_elixir/local_tracker/issue_adapter.ex`
- Test: `elixir/test/symphony_elixir/tracker/issue_dto_test.exs`

- [ ] **Step 1: Write the failing test**

Append to `issue_dto_test.exs`:

```elixir
  test "build defaults group fields" do
    dto = IssueDTO.build(%{identifier: "MAC-1", title: "Title"})
    assert dto.group_lead_identifier == nil
    assert dto.group_member_identifiers == []
  end

  test "build keeps provided group fields" do
    dto = IssueDTO.build(%{identifier: "MAC-2", title: "T", group_lead_identifier: "MAC-1"})
    assert dto.group_lead_identifier == "MAC-1"
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/tracker/issue_dto_test.exs`
Expected: FAIL — `group_lead_identifier` not a struct field (KeyError in `struct!`).

- [ ] **Step 3: Add DTO fields**

In `issue_dto.ex` `defstruct`, after `updated_at: nil` add:

```elixir
            updated_at: nil,
            group_lead_identifier: nil,
            group_member_identifiers: []
```

Add to the `@type t` map:

```elixir
          updated_at: String.t() | nil,
          group_lead_identifier: String.t() | nil,
          group_member_identifiers: [String.t()]
```

In `normalize/1`, add a default so the field is always a list:

```elixir
    |> Map.put_new(:attachments, [])
    |> Map.put_new(:group_member_identifiers, [])
```

- [ ] **Step 4: Populate in `to_dto/1`**

In `issue_adapter.ex` `to_dto/1`, add to the `IssueDTO.build(%{...})` map (after `updated_at:`):

```elixir
      updated_at: iso8601(issue.updated_at),
      group_lead_identifier: group_lead_identifier(issue.group_lead),
      group_member_identifiers: group_member_identifiers(issue.group_members)
```

Add private helpers near `project_slug/1`:

```elixir
  defp group_lead_identifier(%IssueRecord{identifier: identifier}) when is_binary(identifier), do: identifier
  defp group_lead_identifier(_), do: nil

  defp group_member_identifiers(members) when is_list(members) do
    Enum.flat_map(members, fn
      %IssueRecord{identifier: identifier} when is_binary(identifier) -> [identifier]
      _ -> []
    end)
  end

  defp group_member_identifiers(_), do: []
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/tracker/issue_dto_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/tracker/issue_dto.ex elixir/lib/symphony_elixir/local_tracker/issue_adapter.ex elixir/test/symphony_elixir/tracker/issue_dto_test.exs
git commit -m "feat(tracker): carry group identifiers through IssueDTO + adapter"
```

---

## Task 5: Presenter emits group fields + preloads

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex` (`@issue_preloads`)

- [ ] **Step 1: Add group fields to the DTO presenter clause**

In `tracker_presenter.ex` `issue(%IssueDTO{} = dto)`, add to the returned map (after `updated_at: dto.updated_at`):

```elixir
      updated_at: dto.updated_at,
      group_lead_identifier: dto.group_lead_identifier,
      group_member_identifiers: dto.group_member_identifiers
```

- [ ] **Step 2: Preload group associations everywhere issues load**

In `context.ex`, extend the module attribute (line ~34):

```elixir
  @issue_preloads [:project, :status, :labels, :group_lead, :group_members]
```

- [ ] **Step 3: Compile to verify**

Run: `cd elixir && mix compile --warnings-as-errors`
Expected: compiles. (`to_dto/1` now reads preloaded `group_lead`/`group_members`.)

- [ ] **Step 4: Commit**

```bash
git add elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex elixir/lib/symphony_elixir/local_tracker/context.ex
git commit -m "feat(tracker): preload + present group identifiers on issues"
```

---

## Task 6: `Context.set_issue_group/3` + guards

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/context_test.exs`

- [ ] **Step 1: Write the failing tests**

Append to `context_test.exs`:

```elixir
  test "set_issue_group makes the target the lead and snaps the member to its status" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _lead} = Context.create_issue("macro-markets", %{title: "Lead", status: "Todo"})
    {:ok, _member} = Context.create_issue("macro-markets", %{title: "Member", status: "Backlog"})

    assert {:ok, member} = Context.set_issue_group("macro-markets", "MAC-2", "MAC-1")
    assert member.group_lead_id
    assert member.status.name == "Todo"

    assert {:ok, members} = Context.list_group_members("macro-markets", "MAC-1")
    assert Enum.map(members, & &1.identifier) == ["MAC-2"]
  end

  test "set_issue_group rejects grouping an issue with itself" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{title: "Solo", status: "Todo"})

    assert {:error, :cannot_group_with_self} = Context.set_issue_group("macro-markets", "MAC-1", "MAC-1")
  end

  test "set_issue_group rejects a lead that is already a member (no nested groups)" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _a} = Context.create_issue("macro-markets", %{title: "A", status: "Todo"})
    {:ok, _b} = Context.create_issue("macro-markets", %{title: "B", status: "Todo"})
    {:ok, _c} = Context.create_issue("macro-markets", %{title: "C", status: "Todo"})

    assert {:ok, _} = Context.set_issue_group("macro-markets", "MAC-2", "MAC-1")
    assert {:error, :lead_is_member} = Context.set_issue_group("macro-markets", "MAC-3", "MAC-2")
  end

  test "set_issue_group rejects making an existing lead a member" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _a} = Context.create_issue("macro-markets", %{title: "A", status: "Todo"})
    {:ok, _b} = Context.create_issue("macro-markets", %{title: "B", status: "Todo"})
    {:ok, _c} = Context.create_issue("macro-markets", %{title: "C", status: "Todo"})

    assert {:ok, _} = Context.set_issue_group("macro-markets", "MAC-2", "MAC-1")
    assert {:error, :member_is_lead} = Context.set_issue_group("macro-markets", "MAC-1", "MAC-3")
  end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_test.exs -k "set_issue_group"`
Expected: FAIL — `Context.set_issue_group/3` undefined.

- [ ] **Step 3: Implement the public functions**

In `context.ex`, after `delete_blocker/4` (around line 724), add:

```elixir
  @spec set_issue_group(String.t(), String.t(), String.t()) ::
          {:ok, IssueRecord.t()} | {:error, atom() | Ecto.Changeset.t()}
  def set_issue_group(project_slug, member_identifier, lead_identifier)
      when is_binary(project_slug) and is_binary(member_identifier) and is_binary(lead_identifier) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, member} <- fetch_project_issue(project.id, member_identifier),
         {:ok, lead} <- fetch_project_issue(project.id, lead_identifier),
         :ok <- validate_group_pair(member, lead) do
      member
      |> IssueRecord.changeset(%{group_lead_id: lead.id, status_id: lead.status_id})
      |> Repo.update()
      |> preload_issue_result()
      |> tap_issue_event("issue_updated", %{group_lead_identifier: lead.identifier})
    end
  end

  @spec list_group_members(String.t(), String.t()) ::
          {:ok, [IssueRecord.t()]} | {:error, missing_error()}
  def list_group_members(project_slug, lead_identifier)
      when is_binary(project_slug) and is_binary(lead_identifier) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, lead} <- fetch_project_issue(project.id, lead_identifier) do
      members =
        lead.id
        |> group_member_records()
        |> Enum.map(&Repo.preload(&1, @issue_preloads))

      {:ok, members}
    end
  end
```

Add private helpers near `fetch_relation/3`:

```elixir
  defp validate_group_pair(%IssueRecord{id: id}, %IssueRecord{id: id}), do: {:error, :cannot_group_with_self}

  defp validate_group_pair(%IssueRecord{} = member, %IssueRecord{} = lead) do
    cond do
      not is_nil(lead.group_lead_id) -> {:error, :lead_is_member}
      group_member_count(member.id) > 0 -> {:error, :member_is_lead}
      true -> :ok
    end
  end

  defp group_member_count(lead_id) do
    IssueRecord
    |> where([issue], issue.group_lead_id == ^lead_id)
    |> Repo.aggregate(:count, :id)
  end

  defp group_member_records(lead_id) do
    IssueRecord
    |> where([issue], issue.group_lead_id == ^lead_id)
    |> order_by([issue], asc: issue.inserted_at, asc: issue.id)
    |> Repo.all()
  end
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_test.exs -k "set_issue_group"`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/context.ex elixir/test/symphony_elixir/local_tracker/context_test.exs
git commit -m "feat(tracker): set_issue_group + list_group_members with structural guards"
```

---

## Task 7: `Context.remove_from_group/2` (member unset + lead disband)

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/context_test.exs`

- [ ] **Step 1: Write the failing tests**

```elixir
  test "remove_from_group detaches a single member" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _lead} = Context.create_issue("macro-markets", %{title: "Lead", status: "Todo"})
    {:ok, _member} = Context.create_issue("macro-markets", %{title: "Member", status: "Todo"})
    {:ok, _} = Context.set_issue_group("macro-markets", "MAC-2", "MAC-1")

    assert {:ok, member} = Context.remove_from_group("macro-markets", "MAC-2")
    assert member.group_lead_id == nil
    assert {:ok, []} = Context.list_group_members("macro-markets", "MAC-1")
  end

  test "remove_from_group on the lead disbands the whole group" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _lead} = Context.create_issue("macro-markets", %{title: "Lead", status: "Todo"})
    {:ok, _m1} = Context.create_issue("macro-markets", %{title: "M1", status: "Todo"})
    {:ok, _m2} = Context.create_issue("macro-markets", %{title: "M2", status: "Todo"})
    {:ok, _} = Context.set_issue_group("macro-markets", "MAC-2", "MAC-1")
    {:ok, _} = Context.set_issue_group("macro-markets", "MAC-3", "MAC-1")

    assert {:ok, _lead} = Context.remove_from_group("macro-markets", "MAC-1")
    assert {:ok, []} = Context.list_group_members("macro-markets", "MAC-1")
  end

  test "remove_from_group errors when the issue is not in a group" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _solo} = Context.create_issue("macro-markets", %{title: "Solo", status: "Todo"})

    assert {:error, :not_in_group} = Context.remove_from_group("macro-markets", "MAC-1")
  end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_test.exs -k "remove_from_group"`
Expected: FAIL — `Context.remove_from_group/2` undefined.

- [ ] **Step 3: Implement**

Add after `set_issue_group/3`:

```elixir
  @spec remove_from_group(String.t(), String.t()) ::
          {:ok, IssueRecord.t()} | {:error, atom() | Ecto.Changeset.t()}
  def remove_from_group(project_slug, identifier)
      when is_binary(project_slug) and is_binary(identifier) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, issue} <- fetch_project_issue(project.id, identifier) do
      members = group_member_records(issue.id)

      cond do
        not is_nil(issue.group_lead_id) -> detach_group_member(issue)
        members != [] -> disband_group(issue, members)
        true -> {:error, :not_in_group}
      end
    end
  end
```

Add private helpers:

```elixir
  defp detach_group_member(%IssueRecord{} = issue) do
    issue
    |> IssueRecord.changeset(%{group_lead_id: nil})
    |> Repo.update()
    |> preload_issue_result()
    |> tap_issue_event("issue_updated", %{group_lead_identifier: nil})
  end

  defp disband_group(%IssueRecord{} = lead, members) do
    Enum.each(members, fn member ->
      member
      |> IssueRecord.changeset(%{group_lead_id: nil})
      |> Repo.update()
      |> preload_issue_result()
      |> tap_issue_event("issue_updated", %{group_lead_identifier: nil})
    end)

    {:ok, Repo.preload(lead, @issue_preloads)}
  end
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_test.exs -k "remove_from_group"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/context.ex elixir/test/symphony_elixir/local_tracker/context_test.exs
git commit -m "feat(tracker): remove_from_group (detach member, disband on lead)"
```

---

## Task 8: `move_issue` travels together

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex` (`move_issue/3`)
- Test: `elixir/test/symphony_elixir/local_tracker/context_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
  test "move_issue carries group members to the lead's new status" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _lead} = Context.create_issue("macro-markets", %{title: "Lead", status: "Todo"})
    {:ok, _member} = Context.create_issue("macro-markets", %{title: "Member", status: "Todo"})
    {:ok, _} = Context.set_issue_group("macro-markets", "MAC-2", "MAC-1")

    assert {:ok, lead} = Context.move_issue("macro-markets", "MAC-1", %{status: "In Progress"})
    assert lead.status.name == "In Progress"

    assert {:ok, [member]} = Context.list_group_members("macro-markets", "MAC-1")
    assert member.status.name == "In Progress"
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_test.exs -k "carries group members"`
Expected: FAIL — member stays in "Todo".

- [ ] **Step 3: Update `move_issue/3`**

Replace the body of `move_issue/3` (lines ~446-457) with:

```elixir
  def move_issue(project_slug, identifier, attrs)
      when is_binary(project_slug) and is_binary(identifier) and is_map(attrs) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, issue} <- fetch_project_issue(project.id, identifier),
         {:ok, status} <- fetch_move_status(project.id, attrs, issue.status_id) do
      position_only = issue.status_id == status.id

      project.id
      |> persist_moved_issue(issue, status, attrs)
      |> tap_issue_event("issue_moved", %{status: status.name, position_only: position_only})
      |> move_group_members(status)
    end
  end
```

Add the private helper near `persist_moved_issue/4`:

```elixir
  defp move_group_members({:ok, %IssueRecord{} = lead} = result, %WorkflowStatus{} = status) do
    lead.id
    |> group_member_records()
    |> Enum.each(fn member ->
      member
      |> IssueRecord.changeset(%{status_id: status.id})
      |> Repo.update()
      |> preload_issue_result()
      |> tap_issue_event("issue_moved", %{status: status.name, position_only: false})
    end)

    result
  end

  defp move_group_members(result, _status), do: result
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_test.exs -k "carries group members"`
Expected: PASS.

- [ ] **Step 5: Run the full context suite (regression)**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_test.exs`
Expected: PASS (existing move tests still green — non-lead issues hit the `move_group_members(result, _status)` no-op clause).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/context.ex elixir/test/symphony_elixir/local_tracker/context_test.exs
git commit -m "feat(tracker): move group members with their lead"
```

---

## Task 9: Lead removal promotes a new lead

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex` (`set_issue_archived_at/3`, `delete_issue_with_children/1`)
- Test: `elixir/test/symphony_elixir/local_tracker/context_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
  test "archiving a lead promotes the oldest member to lead" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _lead} = Context.create_issue("macro-markets", %{title: "Lead", status: "Todo"})
    {:ok, _m1} = Context.create_issue("macro-markets", %{title: "M1", status: "Todo"})
    {:ok, _m2} = Context.create_issue("macro-markets", %{title: "M2", status: "Todo"})
    {:ok, _} = Context.set_issue_group("macro-markets", "MAC-2", "MAC-1")
    {:ok, _} = Context.set_issue_group("macro-markets", "MAC-3", "MAC-1")

    assert {:ok, _archived} = Context.archive_issue("macro-markets", "MAC-1")

    # MAC-2 (oldest member) becomes the lead; MAC-3 points at it.
    assert {:ok, [member]} = Context.list_group_members("macro-markets", "MAC-2")
    assert member.identifier == "MAC-3"
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_test.exs -k "promotes the oldest member"`
Expected: FAIL — members orphaned (`group_lead_id` nil-ified by FK), so `list_group_members("MAC-2")` returns `[]`.

- [ ] **Step 3: Add promotion before archive/delete**

Add a private helper:

```elixir
  defp reassign_group_on_removal(%IssueRecord{} = issue) do
    case group_member_records(issue.id) do
      [] ->
        :ok

      [new_lead | rest] ->
        {:ok, _} = new_lead |> IssueRecord.changeset(%{group_lead_id: nil}) |> Repo.update()

        Enum.each(rest, fn member ->
          {:ok, _} = member |> IssueRecord.changeset(%{group_lead_id: new_lead.id}) |> Repo.update()
        end)

        :ok
    end
  end
```

In `set_issue_archived_at/3`, call it before updating, but only when archiving (non-nil `archived_at`):

```elixir
  defp set_issue_archived_at(project_slug, identifier, archived_at) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, issue} <- fetch_project_issue(project.id, identifier) do
      if not is_nil(archived_at), do: reassign_group_on_removal(issue)

      issue
      |> IssueRecord.changeset(%{archived_at: archived_at})
      |> Repo.update()
      |> preload_issue_result()
    end
  end
```

In `delete_issue_with_children/1`, call `reassign_group_on_removal(issue)` as the first statement inside the `Repo.transaction(fn -> ... end)` block (before the `Repo.delete_all` calls):

```elixir
  defp delete_issue_with_children(%IssueRecord{id: issue_id} = issue) do
    Repo.transaction(fn ->
      reassign_group_on_removal(issue)
      Repo.delete_all(from(event in ActivityEvent, where: event.issue_id == ^issue_id))
      # ... rest unchanged ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_test.exs -k "promotes the oldest member"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/context.ex elixir/test/symphony_elixir/local_tracker/context_test.exs
git commit -m "feat(tracker): promote new group lead when a lead is archived/deleted"
```

---

## Task 10: Group error rendering

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/tracker_errors.ex`

- [ ] **Step 1: Add render clauses**

Before the catch-all `def render(conn, message) when is_binary(message)`, add:

```elixir
  def render(conn, :cannot_group_with_self),
    do: error(conn, 422, "cannot_group_with_self", dgettext("errors", "An issue cannot be grouped with itself."))

  def render(conn, :lead_is_member),
    do: error(conn, 422, "lead_is_member", dgettext("errors", "The chosen lead already belongs to another group."))

  def render(conn, :member_is_lead),
    do: error(conn, 422, "member_is_lead", dgettext("errors", "This issue already leads a group; ungroup it first."))

  def render(conn, :not_in_group),
    do: error(conn, 422, "not_in_group", dgettext("errors", "This issue is not part of a group."))
```

- [ ] **Step 2: Compile to verify**

Run: `cd elixir && mix compile --warnings-as-errors`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add elixir/lib/symphony_elixir_web/tracker_errors.ex
git commit -m "feat(tracker): render group validation errors"
```

---

## Task 11: `GroupController` + routes

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/group_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/group_controller_test.exs`

- [ ] **Step 1: Write the failing controller test**

Create `group_controller_test.exs`. Mirror the setup style of `issue_controller_test.exs` (use `ConnCase`/`build_conn`; if that suite seeds a project via `Context.ensure_project` + `Context.create_issue`, do the same here). Reference `issue_controller_test.exs` for the exact `use`/`setup` header before writing this file.

```elixir
defmodule SymphonyElixirWeb.Tracker.GroupControllerTest do
  use SymphonyElixirWeb.ConnCase, async: false

  alias SymphonyElixir.LocalTracker.Context

  setup do
    SymphonyElixir.TestSupport.truncate_tracker!(SymphonyElixir.Repo)
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _lead} = Context.create_issue("macro-markets", %{title: "Lead", status: "Todo"})
    {:ok, _member} = Context.create_issue("macro-markets", %{title: "Member", status: "Todo"})
    :ok
  end

  test "POST groups the issue under the lead", %{conn: conn} do
    conn =
      post(conn, "/api/tracker/v1/projects/macro-markets/issues/MAC-2/group", %{
        "lead_identifier" => "MAC-1"
      })

    assert %{"data" => data} = json_response(conn, 201)
    assert data["group_lead_identifier"] == "MAC-1"
  end

  test "POST without lead_identifier is a validation error", %{conn: conn} do
    conn = post(conn, "/api/tracker/v1/projects/macro-markets/issues/MAC-2/group", %{})
    assert json_response(conn, 422)
  end

  test "DELETE ungroups the issue", %{conn: conn} do
    {:ok, _} = Context.set_issue_group("macro-markets", "MAC-2", "MAC-1")
    conn = delete(conn, "/api/tracker/v1/projects/macro-markets/issues/MAC-2/group")
    assert response(conn, 204)
    assert {:ok, []} = Context.list_group_members("macro-markets", "MAC-1")
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/group_controller_test.exs`
Expected: FAIL — no route / controller.

- [ ] **Step 3: Create the controller**

```elixir
defmodule SymphonyElixirWeb.Tracker.GroupController do
  @moduledoc "Issue group membership endpoints for the local tracker JSON API."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.{Context, IssueAdapter}
  alias SymphonyElixirWeb.TrackerErrors
  alias SymphonyElixirWeb.TrackerPresenter

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{
        "project_slug" => project_slug,
        "identifier" => member_identifier,
        "lead_identifier" => lead_identifier
      })
      when is_binary(lead_identifier) and lead_identifier != "" do
    case Context.set_issue_group(project_slug, member_identifier, lead_identifier) do
      {:ok, issue} ->
        conn
        |> put_status(:created)
        |> json(%{data: issue |> IssueAdapter.to_dto() |> TrackerPresenter.issue()})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  def create(conn, _params), do: TrackerErrors.validation_msg(conn, "lead_identifier is required")

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    case Context.remove_from_group(project_slug, identifier) do
      {:ok, _issue} -> send_resp(conn, :no_content, "")
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
end
```

- [ ] **Step 4: Add routes**

In `router.ex`, after the blockers `delete` route (line ~166), add:

```elixir
    post("/projects/:project_slug/issues/:identifier/group", GroupController, :create)
    delete("/projects/:project_slug/issues/:identifier/group", GroupController, :delete)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/group_controller_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/group_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/test/symphony_elixir_web/controllers/tracker/group_controller_test.exs
git commit -m "feat(tracker): group/ungroup HTTP endpoints"
```

---

## Task 12: Frontend types + mapper

**Files:**
- Modify: `tracker/src/types/issue.ts`
- Modify: `tracker/src/services/mappers.ts`
- Test: `tracker/src/services/__tests__/mappers.test.ts` (create if absent; otherwise add to existing mapper test)

- [ ] **Step 1: Write the failing test**

Create/append `tracker/src/services/__tests__/mappers.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { normalizeIssue } from "@/services/mappers";

describe("normalizeIssue group fields", () => {
  it("reads snake_case group identifiers", () => {
    const issue = normalizeIssue({
      id: 1,
      identifier: "MAC-2",
      title: "Member",
      group_lead_identifier: "MAC-1",
      group_member_identifiers: [],
    });
    expect(issue.groupLeadIdentifier).toBe("MAC-1");
    expect(issue.groupMemberIdentifiers).toEqual([]);
  });

  it("reads a lead's member identifiers and defaults to null/[]", () => {
    const lead = normalizeIssue({
      id: 2,
      identifier: "MAC-1",
      title: "Lead",
      group_member_identifiers: ["MAC-2", "MAC-3"],
    });
    expect(lead.groupLeadIdentifier).toBeNull();
    expect(lead.groupMemberIdentifiers).toEqual(["MAC-2", "MAC-3"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/services/__tests__/mappers.test.ts`
Expected: FAIL — `groupLeadIdentifier` is undefined on the result.

- [ ] **Step 3: Extend the `Issue` type**

In `tracker/src/types/issue.ts`, add to the `Issue` interface (after `attachments: IssueAttachment[];`):

```ts
  groupLeadIdentifier: string | null;
  groupMemberIdentifiers: string[];
```

- [ ] **Step 4: Extend the backend DTO + normalizer**

In `tracker/src/services/mappers.ts`, add to `BackendIssueDto` (after `agentKind?`):

```ts
  group_lead_identifier?: string | null;
  groupLeadIdentifier?: string | null;
  group_member_identifiers?: string[] | null;
  groupMemberIdentifiers?: string[] | null;
```

In `normalizeIssue`, add to the returned object (after `attachments:` line):

```ts
    groupLeadIdentifier: dto.groupLeadIdentifier ?? dto.group_lead_identifier ?? null,
    groupMemberIdentifiers: dto.groupMemberIdentifiers ?? dto.group_member_identifiers ?? [],
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/services/__tests__/mappers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tracker/src/types/issue.ts tracker/src/services/mappers.ts tracker/src/services/__tests__/mappers.test.ts
git commit -m "feat(board): carry group identifiers through the issue mapper"
```

---

## Task 13: Frontend service client

**Files:**
- Modify: `tracker/src/services/issues.ts`

- [ ] **Step 1: Add the client calls**

In `tracker/src/services/issues.ts`, after `moveIssue`, add:

```ts
export async function groupIssue(
  projectSlug: string,
  memberIdentifier: string,
  leadIdentifier: string,
): Promise<Issue> {
  const slug = requireProjectSlug(projectSlug);
  const member = requireNonBlank(memberIdentifier, "identifier");
  const lead = requireNonBlank(leadIdentifier, "leadIdentifier");
  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(member)}/group`),
    { lead_identifier: lead },
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}

export async function ungroupIssue(projectSlug: string, identifier: string): Promise<void> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");
  await http.delete(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/group`),
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd tracker && npx tsc -p tsconfig.app.json --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add tracker/src/services/issues.ts
git commit -m "feat(board): group/ungroup issue service calls"
```

---

## Task 14: Phase gate — full suites

- [ ] **Step 1: Backend gate**

Run: `cd elixir && make all`
Expected: format check, lint, coverage, dialyzer all pass. (`mix specs.check` enforces `@spec` on new public `def`s — `set_issue_group/3`, `remove_from_group/2`, `list_group_members/2` already have specs above; ensure the `GroupController` public actions have `@spec` as written.)

- [ ] **Step 2: Frontend gate**

Run: `cd tracker && npm test`
Expected: PASS, including the new mapper test.

- [ ] **Step 3: Commit any fixups, then stop for review**

```bash
git add -A
git commit -m "test(tracker): phase 1 task grouping gate green"
```

Hand off to Phase 2 (orchestrator) once this phase is reviewed and green.

---

## Self-Review

**Spec coverage (Phase 1 scope):**
- Persistence `group_lead_id` column → Task 1, 2. ✓
- DTO/presenter/mapper expose `group_lead_identifier` / `group_member_identifiers` → Tasks 3, 4, 5, 12. ✓
- `POST/DELETE .../group` endpoints → Task 11. ✓
- Context `set_issue_group` / `remove_from_group` / `list_group_members` + guards (same-project via `fetch_project_issue` scoping, no-nested-groups, self) → Tasks 6, 7. ✓
- Move-travels-together → Task 8. ✓
- Lead removal promotion → Task 9. ✓
- Frontend type + service client → Tasks 12, 13. ✓
- **Deferred to later phases (by design):** running-lock guard on group edits (needs orchestrator state — Phase 2); board rendering/DnD (Phase 3); orchestrator candidate filtering / grouped run / PR markers (Phase 2). Noted, not gaps.

**Placeholder scan:** No TBD/TODO; every code step shows complete code. Test files that already exist (`issue_mapper_test.exs`, `issue_dto_test.exs`, `context_test.exs`, `issues`/mapper vitest) are appended to; `group_controller_test.exs` references `issue_controller_test.exs` only for the exact `use ConnCase`/`setup` header (one explicit lookup, not a placeholder).

**Type consistency:** `group_lead_identifier` / `group_member_identifiers` (snake_case) used consistently in Elixir struct, DTO, presenter, and JSON; `groupLeadIdentifier` / `groupMemberIdentifiers` (camelCase) used consistently in TS. `set_issue_group/3` arg order is `(project_slug, member_identifier, lead_identifier)` everywhere (Context, controller, service `groupIssue` posts `lead_identifier`). Helper `group_member_records/1` defined once in Context and reused by Tasks 6–9.
```

