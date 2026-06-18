# Board Task Grouping — Implementation Plan

**Goal:** Let a user drag one board card onto another to group issues; the
orchestrator then runs the whole group as a single unit of work (one agent, one
workspace/branch, one PR covering every member).

**Architecture:** A *member* issue points at a *lead* issue via a new
self-referential `group_lead_id` column on `local_tracker_issues`. The group
travels together on the board and behaves as one task. Phase 1 builds
persistence + HTTP API; Phase 2 makes the orchestrator dispatch/run/complete a
group as one unit; Phase 3 adds the drag-to-group board UI.

**Tech Stack:** Elixir/Phoenix + Ecto (SQLite), ExUnit; React/TypeScript +
`@dnd-kit` + Vitest.

> Spec: `docs/superpowers/specs/2026-06-18-task-grouping-board-design.md`.
> Three phases, each independently testable. Backend gate: `cd elixir && make all`.
> Frontend gate: `cd tracker && npm test`. Public Elixir `def`s in `lib/` require
> an adjacent `@spec` (enforced by `mix specs.check`).

---

## File Structure

**Phase 1 — Persistence & API (backend + client contract):**
- Create: `elixir/priv/repo/migrations/20260618000001_add_group_lead_id_to_local_tracker_issues.exs`
- Modify: `elixir/lib/symphony_elixir/local_tracker/issue_record.ex`
- Modify: `elixir/lib/symphony_elixir/issue.ex`
- Modify: `elixir/lib/symphony_elixir/local_tracker/issue_mapper.ex`
- Modify: `elixir/lib/symphony_elixir/tracker/issue_dto.ex`
- Modify: `elixir/lib/symphony_elixir/local_tracker/issue_adapter.ex`
- Modify: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex`
- Modify: `elixir/lib/symphony_elixir_web/tracker_errors.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/group_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Modify: `tracker/src/types/issue.ts`, `tracker/src/services/mappers.ts`, `tracker/src/services/issues.ts`

**Phase 2 — Orchestrator grouped execution:**
- Create: `elixir/lib/symphony_elixir/orchestrator/grouping.ex` (pure helpers)
- Modify: `elixir/lib/symphony_elixir/local_tracker/tracker.ex` (candidate preloads)
- Modify: `elixir/lib/symphony_elixir/tracker/sync/local_first_tracker.ex` (candidate preloads)
- Modify: `elixir/lib/symphony_elixir/orchestrator.ex` (filter members, group dispatch, completion fan-out)
- Modify: `elixir/lib/symphony_elixir/agent_runner.ex` (thread `members:`)
- Modify: `elixir/lib/symphony_elixir/prompt_builder.ex` (grouped-tasks section)
- Modify: `elixir/lib/symphony_elixir/run_contract/finalizer.ex` (one marker per member)

**Phase 3 — Board drag-to-group UI:**
- Modify: `tracker/src/components/board/board-utils.ts` (group units + merge intent)
- Modify: `tracker/src/components/board/BoardView.tsx` (merge vs move on drop)
- Modify: `tracker/src/components/board/BoardColumn.tsx` (render units)
- Create: `tracker/src/components/board/GroupCard.tsx`
- Modify: `tracker/src/components/board/IssueCard.tsx` (merge highlight prop)
- Modify: `tracker/src/hooks/useIssueBoard.ts` (group/ungroup actions)
- Modify: `tracker/locales/en/tracker.json`, `tracker/locales/pt-BR/tracker.json`

---

# PHASE 1 — Persistence & API

## Task 1: Migration — add `group_lead_id`

**Files:** Create `elixir/priv/repo/migrations/20260618000001_add_group_lead_id_to_local_tracker_issues.exs`

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

- [ ] **Step 2: Run it**

Run: `cd elixir && mix ecto.migrate`
Expected: column + index created.

- [ ] **Step 3: Commit**

```bash
git add elixir/priv/repo/migrations/20260618000001_add_group_lead_id_to_local_tracker_issues.exs
git commit -m "feat(tracker): add group_lead_id column to local issues"
```

---

## Task 2: `IssueRecord` associations + cast

**Files:** Modify `elixir/lib/symphony_elixir/local_tracker/issue_record.ex`

- [ ] **Step 1: Add associations** — after `has_many(:target_relations, ...)`:

```elixir
    belongs_to(:group_lead, __MODULE__, foreign_key: :group_lead_id)
    has_many(:group_members, __MODULE__, foreign_key: :group_lead_id)
```

- [ ] **Step 2: Cast the field** — in `changeset/2` `cast/3` list, after `:archived_at`:

```elixir
      :archived_at,
      :group_lead_id
```

- [ ] **Step 3: Compile** — Run: `cd elixir && mix compile --warnings-as-errors` → Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/issue_record.ex
git commit -m "feat(tracker): group lead/member associations on IssueRecord"
```

---

## Task 3: `Issue` struct + `IssueMapper`

**Files:** Modify `elixir/lib/symphony_elixir/issue.ex`, `elixir/lib/symphony_elixir/local_tracker/issue_mapper.ex`; Test `elixir/test/symphony_elixir/local_tracker/issue_mapper_test.exs`

- [ ] **Step 1: Failing test** — append:

```elixir
  test "to_issue surfaces group lead and member identifiers" do
    member_record = %IssueRecord{identifier: "MAC-2", group_lead: %IssueRecord{identifier: "MAC-1"}}
    lead_record = %IssueRecord{identifier: "MAC-1", group_members: [%IssueRecord{identifier: "MAC-2"}]}

    assert IssueMapper.to_issue(member_record).group_lead_identifier == "MAC-1"
    assert IssueMapper.to_issue(member_record).group_member_identifiers == []
    assert IssueMapper.to_issue(lead_record).group_lead_identifier == nil
    assert IssueMapper.to_issue(lead_record).group_member_identifiers == ["MAC-2"]
  end
```

- [ ] **Step 2: Verify it fails** — Run: `cd elixir && mix test test/symphony_elixir/local_tracker/issue_mapper_test.exs` → Expected: FAIL (KeyError / unset).

- [ ] **Step 3: Struct fields** — in `issue.ex` `defstruct`, after `assigned_to_worker: true`:

```elixir
    group_lead_identifier: nil,
    group_member_identifiers: [],
```

- [ ] **Step 4: Mapper** — in `to_issue/1` `%Issue{...}`, after `assigned_to_worker:`:

```elixir
      group_lead_identifier: group_lead_identifier(record.group_lead),
      group_member_identifiers: group_member_identifiers(record.group_members),
```

Add helpers near the other `defp`s:

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

- [ ] **Step 5: Verify pass** — Run the same test → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/issue.ex elixir/lib/symphony_elixir/local_tracker/issue_mapper.ex elixir/test/symphony_elixir/local_tracker/issue_mapper_test.exs
git commit -m "feat(tracker): map group identifiers onto Issue struct"
```

---

## Task 4: `IssueDTO` + `IssueAdapter.to_dto/1`

**Files:** Modify `elixir/lib/symphony_elixir/tracker/issue_dto.ex`, `elixir/lib/symphony_elixir/local_tracker/issue_adapter.ex`; Test `elixir/test/symphony_elixir/tracker/issue_dto_test.exs`

- [ ] **Step 1: Failing test** — append:

```elixir
  test "build defaults and keeps group fields" do
    assert IssueDTO.build(%{identifier: "MAC-1", title: "T"}).group_member_identifiers == []
    assert IssueDTO.build(%{identifier: "MAC-1", title: "T"}).group_lead_identifier == nil
    assert IssueDTO.build(%{identifier: "MAC-2", title: "T", group_lead_identifier: "MAC-1"}).group_lead_identifier == "MAC-1"
  end
```

- [ ] **Step 2: Verify fails** — Run: `cd elixir && mix test test/symphony_elixir/tracker/issue_dto_test.exs` → FAIL.

- [ ] **Step 3: DTO fields** — in `issue_dto.ex` `defstruct`, change the tail to:

```elixir
            created_at: nil,
            updated_at: nil,
            group_lead_identifier: nil,
            group_member_identifiers: []
```

In `@type t`, add after `updated_at:`:

```elixir
          updated_at: String.t() | nil,
          group_lead_identifier: String.t() | nil,
          group_member_identifiers: [String.t()]
```

In `normalize/1`, add a default:

```elixir
    |> Map.put_new(:attachments, [])
    |> Map.put_new(:group_member_identifiers, [])
```

- [ ] **Step 4: Adapter** — in `issue_adapter.ex` `to_dto/1` `IssueDTO.build(%{...})`, after `updated_at:`:

```elixir
      updated_at: iso8601(issue.updated_at),
      group_lead_identifier: group_lead_identifier(issue.group_lead),
      group_member_identifiers: group_member_identifiers(issue.group_members)
```

Add helpers near `project_slug/1`:

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

- [ ] **Step 5: Verify pass** — Run the DTO test → PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/tracker/issue_dto.ex elixir/lib/symphony_elixir/local_tracker/issue_adapter.ex elixir/test/symphony_elixir/tracker/issue_dto_test.exs
git commit -m "feat(tracker): carry group identifiers through IssueDTO + adapter"
```

---

## Task 5: Presenter + preloads

**Files:** Modify `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`, `elixir/lib/symphony_elixir/local_tracker/context.ex`

- [ ] **Step 1: Presenter** — in `issue(%IssueDTO{} = dto)`, change the tail to:

```elixir
      updated_at: dto.updated_at,
      group_lead_identifier: dto.group_lead_identifier,
      group_member_identifiers: dto.group_member_identifiers
```

- [ ] **Step 2: Preloads** — in `context.ex` (line ~34):

```elixir
  @issue_preloads [:project, :status, :labels, :group_lead, :group_members]
```

- [ ] **Step 3: Compile** — Run: `cd elixir && mix compile --warnings-as-errors` → clean.

- [ ] **Step 4: Commit**

```bash
git add elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex elixir/lib/symphony_elixir/local_tracker/context.ex
git commit -m "feat(tracker): preload + present group identifiers"
```

---

## Task 6: `Context.set_issue_group/3` + guards

**Files:** Modify `elixir/lib/symphony_elixir/local_tracker/context.ex`; Test `elixir/test/symphony_elixir/local_tracker/context_test.exs`

- [ ] **Step 1: Failing tests** — append:

```elixir
  test "set_issue_group makes the target the lead and snaps the member to its status" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _lead} = Context.create_issue("macro-markets", %{title: "Lead", status: "Todo"})
    {:ok, _member} = Context.create_issue("macro-markets", %{title: "Member", status: "Backlog"})

    assert {:ok, member} = Context.set_issue_group("macro-markets", "MAC-2", "MAC-1")
    assert member.group_lead_id
    assert member.status.name == "Todo"
    assert {:ok, [m]} = Context.list_group_members("macro-markets", "MAC-1")
    assert m.identifier == "MAC-2"
  end

  test "set_issue_group rejects self / nested / existing-lead" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _a} = Context.create_issue("macro-markets", %{title: "A", status: "Todo"})
    {:ok, _b} = Context.create_issue("macro-markets", %{title: "B", status: "Todo"})
    {:ok, _c} = Context.create_issue("macro-markets", %{title: "C", status: "Todo"})

    assert {:error, :cannot_group_with_self} = Context.set_issue_group("macro-markets", "MAC-1", "MAC-1")
    assert {:ok, _} = Context.set_issue_group("macro-markets", "MAC-2", "MAC-1")
    assert {:error, :lead_is_member} = Context.set_issue_group("macro-markets", "MAC-3", "MAC-2")
    assert {:error, :member_is_lead} = Context.set_issue_group("macro-markets", "MAC-1", "MAC-3")
  end
```

- [ ] **Step 2: Verify fails** — Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_test.exs -k "set_issue_group"` → FAIL (undefined).

- [ ] **Step 3: Implement** — after `delete_blocker/4` add:

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

  @spec list_group_members(String.t(), String.t()) :: {:ok, [IssueRecord.t()]} | {:error, missing_error()}
  def list_group_members(project_slug, lead_identifier)
      when is_binary(project_slug) and is_binary(lead_identifier) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, lead} <- fetch_project_issue(project.id, lead_identifier) do
      {:ok, lead.id |> group_member_records() |> Enum.map(&Repo.preload(&1, @issue_preloads))}
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
    IssueRecord |> where([issue], issue.group_lead_id == ^lead_id) |> Repo.aggregate(:count, :id)
  end

  defp group_member_records(lead_id) do
    IssueRecord
    |> where([issue], issue.group_lead_id == ^lead_id)
    |> order_by([issue], asc: issue.inserted_at, asc: issue.id)
    |> Repo.all()
  end
```

- [ ] **Step 4: Verify pass** — Run the `set_issue_group` tests → PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/context.ex elixir/test/symphony_elixir/local_tracker/context_test.exs
git commit -m "feat(tracker): set_issue_group + list_group_members with guards"
```

---

## Task 7: `Context.remove_from_group/2`

**Files:** Modify `context.ex`; Test `context_test.exs`

- [ ] **Step 1: Failing tests** — append:

```elixir
  test "remove_from_group detaches a member and disbands on the lead" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _lead} = Context.create_issue("macro-markets", %{title: "Lead", status: "Todo"})
    {:ok, _m1} = Context.create_issue("macro-markets", %{title: "M1", status: "Todo"})
    {:ok, _m2} = Context.create_issue("macro-markets", %{title: "M2", status: "Todo"})
    {:ok, _} = Context.set_issue_group("macro-markets", "MAC-2", "MAC-1")
    {:ok, _} = Context.set_issue_group("macro-markets", "MAC-3", "MAC-1")

    assert {:ok, m2} = Context.remove_from_group("macro-markets", "MAC-2")
    assert m2.group_lead_id == nil
    assert {:ok, [one]} = Context.list_group_members("macro-markets", "MAC-1")
    assert one.identifier == "MAC-3"

    assert {:ok, _lead} = Context.remove_from_group("macro-markets", "MAC-1")
    assert {:ok, []} = Context.list_group_members("macro-markets", "MAC-1")
  end

  test "remove_from_group errors when not grouped" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _solo} = Context.create_issue("macro-markets", %{title: "Solo", status: "Todo"})
    assert {:error, :not_in_group} = Context.remove_from_group("macro-markets", "MAC-1")
  end
```

- [ ] **Step 2: Verify fails** — Run: `... -k "remove_from_group"` → FAIL.

- [ ] **Step 3: Implement** — after `set_issue_group/3`:

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

Helpers:

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

- [ ] **Step 4: Verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/context.ex elixir/test/symphony_elixir/local_tracker/context_test.exs
git commit -m "feat(tracker): remove_from_group (detach member / disband lead)"
```

---

## Task 8: `move_issue` travels together

**Files:** Modify `context.ex` (`move_issue/3`); Test `context_test.exs`

- [ ] **Step 1: Failing test** — append:

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

- [ ] **Step 2: Verify fails** — Run: `... -k "carries group members"` → FAIL.

- [ ] **Step 3: Implement** — replace `move_issue/3` body:

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

Helper near `persist_moved_issue/4`:

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

- [ ] **Step 4: Verify pass** then regression — Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_test.exs` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/context.ex elixir/test/symphony_elixir/local_tracker/context_test.exs
git commit -m "feat(tracker): move group members with their lead"
```

---

## Task 9: Lead removal promotes a new lead

**Files:** Modify `context.ex` (`set_issue_archived_at/3`, `delete_issue_with_children/1`); Test `context_test.exs`

- [ ] **Step 1: Failing test** — append:

```elixir
  test "archiving a lead promotes the oldest member to lead" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _lead} = Context.create_issue("macro-markets", %{title: "Lead", status: "Todo"})
    {:ok, _m1} = Context.create_issue("macro-markets", %{title: "M1", status: "Todo"})
    {:ok, _m2} = Context.create_issue("macro-markets", %{title: "M2", status: "Todo"})
    {:ok, _} = Context.set_issue_group("macro-markets", "MAC-2", "MAC-1")
    {:ok, _} = Context.set_issue_group("macro-markets", "MAC-3", "MAC-1")

    assert {:ok, _archived} = Context.archive_issue("macro-markets", "MAC-1")
    assert {:ok, [member]} = Context.list_group_members("macro-markets", "MAC-2")
    assert member.identifier == "MAC-3"
  end
```

- [ ] **Step 2: Verify fails** — Run: `... -k "promotes the oldest member"` → FAIL (members orphaned).

- [ ] **Step 3: Implement** — add helper:

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

In `set_issue_archived_at/3`, before the changeset, add (only when archiving):

```elixir
      if not is_nil(archived_at), do: reassign_group_on_removal(issue)
```

In `delete_issue_with_children/1`, add as the first line inside `Repo.transaction(fn -> ... end)`:

```elixir
      reassign_group_on_removal(issue)
```

- [ ] **Step 4: Verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/context.ex elixir/test/symphony_elixir/local_tracker/context_test.exs
git commit -m "feat(tracker): promote a new lead when the lead is archived/deleted"
```

---

## Task 10: Group error rendering

**Files:** Modify `elixir/lib/symphony_elixir_web/tracker_errors.ex`

- [ ] **Step 1: Add clauses** — before `def render(conn, message) when is_binary(message)`:

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

- [ ] **Step 2: Compile** — Run: `cd elixir && mix compile --warnings-as-errors` → clean.

- [ ] **Step 3: Commit**

```bash
git add elixir/lib/symphony_elixir_web/tracker_errors.ex
git commit -m "feat(tracker): render group validation errors"
```

---

## Task 11: `GroupController` + routes

**Files:** Create `elixir/lib/symphony_elixir_web/controllers/tracker/group_controller.ex`; Modify `router.ex`; Test `elixir/test/symphony_elixir_web/controllers/tracker/group_controller_test.exs`

- [ ] **Step 1: Failing test** — create the file. First open `elixir/test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs` and copy its `use ... ConnCase`/`setup` header verbatim; then:

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

  test "POST groups under the lead", %{conn: conn} do
    conn = post(conn, "/api/tracker/v1/projects/macro-markets/issues/MAC-2/group", %{"lead_identifier" => "MAC-1"})
    assert %{"data" => data} = json_response(conn, 201)
    assert data["group_lead_identifier"] == "MAC-1"
  end

  test "POST without lead_identifier is 422", %{conn: conn} do
    conn = post(conn, "/api/tracker/v1/projects/macro-markets/issues/MAC-2/group", %{})
    assert json_response(conn, 422)
  end

  test "DELETE ungroups", %{conn: conn} do
    {:ok, _} = Context.set_issue_group("macro-markets", "MAC-2", "MAC-1")
    conn = delete(conn, "/api/tracker/v1/projects/macro-markets/issues/MAC-2/group")
    assert response(conn, 204)
    assert {:ok, []} = Context.list_group_members("macro-markets", "MAC-1")
  end
end
```

- [ ] **Step 2: Verify fails** — Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/group_controller_test.exs` → FAIL (no route).

- [ ] **Step 3: Controller**

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

- [ ] **Step 4: Routes** — in `router.ex`, after the blockers `delete` route (~L166):

```elixir
    post("/projects/:project_slug/issues/:identifier/group", GroupController, :create)
    delete("/projects/:project_slug/issues/:identifier/group", GroupController, :delete)
```

- [ ] **Step 5: Verify pass** → PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/group_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/test/symphony_elixir_web/controllers/tracker/group_controller_test.exs
git commit -m "feat(tracker): group/ungroup HTTP endpoints"
```

---

## Task 12: Frontend types + mapper

**Files:** Modify `tracker/src/types/issue.ts`, `tracker/src/services/mappers.ts`; Test `tracker/src/services/__tests__/mappers.test.ts`

- [ ] **Step 1: Failing test** — create `tracker/src/services/__tests__/mappers.test.ts`:

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

  it("reads a lead's members and defaults to null/[]", () => {
    const lead = normalizeIssue({ id: 2, identifier: "MAC-1", title: "Lead", group_member_identifiers: ["MAC-2"] });
    expect(lead.groupLeadIdentifier).toBeNull();
    expect(lead.groupMemberIdentifiers).toEqual(["MAC-2"]);
  });
});
```

- [ ] **Step 2: Verify fails** — Run: `cd tracker && npx vitest run src/services/__tests__/mappers.test.ts` → FAIL.

- [ ] **Step 3: Type** — in `tracker/src/types/issue.ts` `Issue`, after `attachments: IssueAttachment[];`:

```ts
  groupLeadIdentifier: string | null;
  groupMemberIdentifiers: string[];
```

- [ ] **Step 4: Mapper** — in `mappers.ts` `BackendIssueDto`, after `agentKind?`:

```ts
  group_lead_identifier?: string | null;
  groupLeadIdentifier?: string | null;
  group_member_identifiers?: string[] | null;
  groupMemberIdentifiers?: string[] | null;
```

In `normalizeIssue` return, after `attachments:`:

```ts
    groupLeadIdentifier: dto.groupLeadIdentifier ?? dto.group_lead_identifier ?? null,
    groupMemberIdentifiers: dto.groupMemberIdentifiers ?? dto.group_member_identifiers ?? [],
```

- [ ] **Step 5: Verify pass** → PASS.

- [ ] **Step 6: Commit**

```bash
git add tracker/src/types/issue.ts tracker/src/services/mappers.ts tracker/src/services/__tests__/mappers.test.ts
git commit -m "feat(board): carry group identifiers through the issue mapper"
```

---

## Task 13: Frontend service client

**Files:** Modify `tracker/src/services/issues.ts`

- [ ] **Step 1: Add calls** — after `moveIssue`:

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

- [ ] **Step 2: Type-check** — Run: `cd tracker && npx tsc -p tsconfig.app.json --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add tracker/src/services/issues.ts
git commit -m "feat(board): group/ungroup issue service calls"
```

---

## Task 14: Phase 1 gate

- [ ] **Step 1:** Run: `cd elixir && make all` → all green.
- [ ] **Step 2:** Run: `cd tracker && npm test` → green.
- [ ] **Step 3:** Commit any fixups: `git commit -am "test: phase 1 task grouping green"`.

---

# PHASE 2 — Orchestrator grouped execution

## Task 15: `Orchestrator.Grouping` pure helpers

**Files:** Create `elixir/lib/symphony_elixir/orchestrator/grouping.ex`; Test `elixir/test/symphony_elixir/orchestrator/grouping_test.exs`

- [ ] **Step 1: Failing test**

```elixir
defmodule SymphonyElixir.Orchestrator.GroupingTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Issue
  alias SymphonyElixir.Orchestrator.Grouping

  test "dispatch_candidates drops members but keeps leads and standalone" do
    lead = %Issue{id: "1", identifier: "MAC-1", group_member_identifiers: ["MAC-2"]}
    member = %Issue{id: "2", identifier: "MAC-2", group_lead_identifier: "MAC-1"}
    solo = %Issue{id: "3", identifier: "MAC-3"}

    assert Grouping.dispatch_candidates([lead, member, solo]) == [lead, solo]
  end

  test "members_for resolves member structs in the lead's order" do
    lead = %Issue{id: "1", identifier: "MAC-1", group_member_identifiers: ["MAC-3", "MAC-2"]}
    m2 = %Issue{id: "2", identifier: "MAC-2", group_lead_identifier: "MAC-1"}
    m3 = %Issue{id: "3", identifier: "MAC-3", group_lead_identifier: "MAC-1"}

    assert Grouping.members_for(lead, [lead, m2, m3]) == [m3, m2]
  end

  test "claim_ids includes the lead and members" do
    lead = %Issue{id: "1", identifier: "MAC-1", group_member_identifiers: ["MAC-2"]}
    m2 = %Issue{id: "2", identifier: "MAC-2", group_lead_identifier: "MAC-1"}

    assert Grouping.claim_ids(lead, [m2]) == ["1", "2"]
  end
end
```

- [ ] **Step 2: Verify fails** — Run: `cd elixir && mix test test/symphony_elixir/orchestrator/grouping_test.exs` → FAIL (no module).

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Orchestrator.Grouping do
  @moduledoc """
  Pure helpers for grouped issue dispatch. A *lead* (non-empty
  `group_member_identifiers`) runs its whole group as one unit; *members*
  (`group_lead_identifier` set) never dispatch independently.
  """

  alias SymphonyElixir.Issue

  @spec member?(Issue.t()) :: boolean()
  def member?(%Issue{group_lead_identifier: id}) when is_binary(id) and id != "", do: true
  def member?(_), do: false

  @spec lead?(Issue.t()) :: boolean()
  def lead?(%Issue{group_member_identifiers: ids}) when is_list(ids) and ids != [], do: true
  def lead?(_), do: false

  @spec dispatch_candidates([Issue.t()]) :: [Issue.t()]
  def dispatch_candidates(issues) when is_list(issues), do: Enum.reject(issues, &member?/1)

  @spec members_for(Issue.t(), [Issue.t()]) :: [Issue.t()]
  def members_for(%Issue{group_member_identifiers: ids}, issues) when is_list(ids) and is_list(issues) do
    by_identifier = Map.new(issues, &{&1.identifier, &1})

    Enum.flat_map(ids, fn identifier ->
      case Map.get(by_identifier, identifier) do
        %Issue{} = issue -> [issue]
        _ -> []
      end
    end)
  end

  def members_for(_lead, _issues), do: []

  @spec claim_ids(Issue.t(), [Issue.t()]) :: [String.t()]
  def claim_ids(%Issue{id: lead_id}, members) when is_list(members) do
    [lead_id | Enum.map(members, & &1.id)]
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end
end
```

- [ ] **Step 4: Verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/orchestrator/grouping.ex elixir/test/symphony_elixir/orchestrator/grouping_test.exs
git commit -m "feat(orchestrator): pure grouping helpers"
```

---

## Task 16: Preload group associations for candidates

**Files:** Modify `elixir/lib/symphony_elixir/local_tracker/tracker.ex`, `elixir/lib/symphony_elixir/tracker/sync/local_first_tracker.ex`

- [ ] **Step 1: Add preloads** — in BOTH modules' private `issue_preloads/0`, add `:group_lead` and `:group_members` to the list. For `local_tracker/tracker.ex`:

```elixir
  defp issue_preloads do
    [
      :status,
      :labels,
      :group_lead,
      :group_members,
      comments: from(comment in Comment, order_by: [asc: comment.inserted_at, asc: comment.id]),
      source_relations:
        from(relation in IssueRelation,
          where: relation.type == "blocked_by",
          preload: [target_issue: :status]
        )
    ]
  end
```

For `tracker/sync/local_first_tracker.ex`, add `:group_lead, :group_members` right after `:status,` in its `issue_preloads/0` list (keep its existing `:project` and other entries).

- [ ] **Step 2: Compile** — Run: `cd elixir && mix compile --warnings-as-errors` → clean.

- [ ] **Step 3: Failing→passing test (mapper-through-fetch)** — append to `elixir/test/symphony_elixir/local_tracker/tracker_test.exs` a test that grouped issues fetched as candidates carry the fields. Mirror that file's existing setup (it already configures the local tracker). If it uses `use SymphonyElixir.TestSupport` + a project seed helper, reuse it; then:

```elixir
  test "fetched candidate issues carry group identifiers" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _lead} = Context.create_issue("macro-markets", %{title: "Lead", status: "Todo"})
    {:ok, _member} = Context.create_issue("macro-markets", %{title: "Member", status: "Todo"})
    {:ok, _} = Context.set_issue_group("macro-markets", "MAC-2", "MAC-1")

    {:ok, issues} = SymphonyElixir.LocalTracker.Tracker.fetch_candidate_issues()
    lead = Enum.find(issues, &(&1.identifier == "MAC-1"))
    member = Enum.find(issues, &(&1.identifier == "MAC-2"))

    assert lead.group_member_identifiers == ["MAC-2"]
    assert member.group_lead_identifier == "MAC-1"
  end
```

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/tracker_test.exs -k "carry group identifiers"` → PASS (after preload change). If the suite needs `Config.active_states` to include "Todo", the shared `TestSupport` setup already sets `["Todo", "In Progress"]`.

- [ ] **Step 4: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/tracker.ex elixir/lib/symphony_elixir/tracker/sync/local_first_tracker.ex elixir/test/symphony_elixir/local_tracker/tracker_test.exs
git commit -m "feat(orchestrator): preload group associations for candidate issues"
```

---

## Task 17: Orchestrator — filter members, dispatch group, fan-out completion

**Files:** Modify `elixir/lib/symphony_elixir/orchestrator.ex`

> These are wiring edits around already-read functions. Add `alias SymphonyElixir.Orchestrator.Grouping` to the module's alias list.

- [ ] **Step 1: Filter members + thread the full list into dispatch** — replace `choose_issues/2` and `maybe_dispatch_candidate/2`:

```elixir
  defp choose_issues(issues, state) do
    issues
    |> Grouping.dispatch_candidates()
    |> sort_issues_for_dispatch()
    |> Enum.reduce(state, fn issue, acc -> maybe_dispatch_candidate(acc, issue, issues) end)
  end

  defp maybe_dispatch_candidate(state, issue, all_issues) do
    case dispatch_decision(issue) do
      {:ok, sets} ->
        members = Grouping.members_for(issue, all_issues)

        if should_dispatch_issue?(issue, state, dispatch_set(sets), terminal_set(sets)) and
             not any_member_blocked?(members, terminal_set(sets)) do
          dispatch_issue(state, issue, nil, members)
        else
          state
        end

      {:skip, reason} ->
        Logger.warning("Skipping dispatch; project not runnable for #{issue_context(issue)}: #{reason}")
        state
    end
  end

  defp any_member_blocked?(members, terminal_states) when is_list(members) do
    Enum.any?(members, &issue_blocked_by_non_terminal?(&1, terminal_states))
  end
```

- [ ] **Step 2: Carry members through dispatch** — change `dispatch_issue/3` to `dispatch_issue/4` and `do_dispatch_issue/3` to `/4`:

```elixir
  defp dispatch_issue(%State{} = state, issue, attempt \\ nil, members \\ []) do
    case revalidate_issue_for_dispatch(issue, &Tracker.fetch_issue_states_by_ids/1) do
      {:ok, %Issue{} = refreshed_issue} ->
        do_dispatch_issue(state, refreshed_issue, attempt, members)

      {:skip, :missing} ->
        Logger.info("Skipping dispatch; issue no longer active or visible: #{issue_context(issue)}")
        state

      {:skip, %Issue{} = refreshed_issue} ->
        Logger.info("Skipping stale dispatch after issue refresh: #{issue_context(refreshed_issue)}")
        state

      {:error, reason} ->
        Logger.warning("Skipping dispatch; issue refresh failed for #{issue_context(issue)}: #{inspect(reason)}")
        state
    end
  end

  defp do_dispatch_issue(%State{} = state, issue, attempt, members) do
    recipient = self()
    issue = Tracker.enrich_issue(issue)
    agent_kind = AgentRunner.issue_agent_kind(issue)

    case Task.Supervisor.start_child(SymphonyElixir.Orchestrator.TaskSupervisor, fn ->
           AgentRunner.run(issue, recipient, attempt: attempt, members: members)
         end) do
      {:ok, pid} ->
        ref = Process.monitor(pid)

        Logger.info("Dispatching #{if members == [], do: "issue", else: "group"} to agent: #{issue_context(issue)} members=#{length(members)} pid=#{inspect(pid)}")

        running = Map.put(state.running, issue.id, dispatch_running_entry(pid, ref, issue, agent_kind, attempt, members))

        claimed =
          issue
          |> Grouping.claim_ids(members)
          |> Enum.reduce(state.claimed, fn id, acc -> MapSet.put(acc, id) end)

        %{state | running: running, claimed: claimed, retry_attempts: Map.delete(state.retry_attempts, issue.id)}

      {:error, reason} ->
        Logger.error("Unable to spawn agent for #{issue_context(issue)}: #{inspect(reason)}")
        next_attempt = if is_integer(attempt), do: attempt + 1, else: nil

        schedule_issue_retry(state, issue.id, next_attempt, %{
          identifier: issue.identifier,
          project_slug: issue.project_slug,
          error: "failed to spawn agent: #{inspect(reason)}"
        })
    end
  end
```

Add a helper that builds the running entry (extracted so the `members` key is added without re-typing the whole map). Place it after `do_dispatch_issue/4`:

```elixir
  defp dispatch_running_entry(pid, ref, %Issue{} = issue, agent_kind, attempt, members) do
    %{
      pid: pid,
      ref: ref,
      identifier: issue.identifier,
      issue: issue,
      members: members,
      agent_kind: agent_kind,
      agent_goal: Map.get(issue, :agent_goal),
      goal: nil,
      session_id: nil,
      last_codex_message: nil,
      last_codex_timestamp: nil,
      last_codex_event: nil,
      codex_app_server_pid: nil,
      agent_input_tokens: 0,
      agent_output_tokens: 0,
      agent_total_tokens: 0,
      codex_last_reported_input_tokens: 0,
      codex_last_reported_output_tokens: 0,
      codex_last_reported_total_tokens: 0,
      turn_count: 0,
      retry_attempt: normalize_retry_attempt(attempt),
      started_at: DateTime.utc_now()
    }
  end
```

> Any other internal caller of `dispatch_issue(state, issue, attempt)` (e.g. retry paths) keeps working via the `members \\ []` default.

- [ ] **Step 3: Fan out PR links to members** — in `apply_gated_successful_completion/3`, after `record_run_pull_requests(issue, prs)`:

```elixir
        record_run_pull_requests(issue, prs)
        Enum.each(Map.get(running_entry, :members, []), &record_run_pull_requests(&1, prs))
```

- [ ] **Step 4: Fan out the status transition to members** — in `apply_transition_after_contract/3`, on the `{:transitioned, transitioned_state}` branch, transition members too:

```elixir
      {:transitioned, transitioned_state} ->
        transition_group_members(running_entry)
        transitioned_state
```

Add the helper:

```elixir
  defp transition_group_members(running_entry) do
    members = Map.get(running_entry, :members, [])

    Enum.each(members, fn %Issue{} = member ->
      transitions = completion_transitions_for(member)

      with dest when is_binary(dest) <- member_destination(member, transitions),
           :ok <- Tracker.update_issue_state(member.id, dest) do
        Logger.info("Moved grouped member after completion: #{issue_context(member)} -> #{dest}")
      else
        _ -> :ok
      end
    end)

    :ok
  end

  defp member_destination(%Issue{id: id, state: state}, transitions) do
    case Tracker.fetch_issue_states_by_ids([id]) do
      {:ok, [%Issue{state: current} | _]} -> Map.get(transitions, current)
      _ -> Map.get(transitions, state)
    end
  end
```

- [ ] **Step 5: Compile + targeted run**

Run: `cd elixir && mix compile --warnings-as-errors && mix test test/symphony_elixir/orchestrator_test.exs`
Expected: compiles; existing orchestrator tests still pass (non-group dispatch uses `members = []`, hitting the same code paths with empty fan-out).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/orchestrator.ex
git commit -m "feat(orchestrator): dispatch a group as one unit and fan out completion"
```

---

## Task 18: `AgentRunner` threads `members:`; `PromptBuilder` grouped section

**Files:** Modify `elixir/lib/symphony_elixir/agent_runner.ex`, `elixir/lib/symphony_elixir/prompt_builder.ex`; Test `elixir/test/symphony_elixir/prompt_builder_test.exs` (append; create if absent mirroring an existing prompt test)

- [ ] **Step 1: Failing test** — append a `PromptBuilder` test. `build_prompt/2` needs a resolvable project config; instead test the extracted pure section directly:

```elixir
  test "group_members_section lists each member with identifier and title" do
    members = [
      %SymphonyElixir.Issue{identifier: "MAC-2", title: "Add API", description: "desc", agent_goal: nil},
      %SymphonyElixir.Issue{identifier: "MAC-3", title: "Add UI", description: nil, agent_goal: "ship it"}
    ]

    section = SymphonyElixir.PromptBuilder.group_members_section(members)
    assert section =~ "Grouped tasks"
    assert section =~ "MAC-2: Add API"
    assert section =~ "MAC-3: Add UI"
    assert section =~ "Symphony-Issue:"
    assert SymphonyElixir.PromptBuilder.group_members_section([]) == ""
  end
```

- [ ] **Step 2: Verify fails** — Run: `cd elixir && mix test test/symphony_elixir/prompt_builder_test.exs -k "group_members_section"` → FAIL.

- [ ] **Step 3: PromptBuilder** — in `build_prompt/2`, insert the section into the concatenation (after `workflow_guidance_section(...)`):

```elixir
    rendered <>
      workflow_guidance_section(issue, Keyword.get(opts, :agent_kind)) <>
      group_members_section(Keyword.get(opts, :members, [])) <>
      validate_section(config) <>
      preview_context_section(issue) <>
      discussion_section(issue) <>
      artifacts_section(Keyword.get(opts, :workspace))
```

Add the public function (needs `@spec`):

```elixir
  @doc false
  @spec group_members_section([SymphonyElixir.Issue.t()]) :: String.t()
  def group_members_section([]), do: ""

  def group_members_section(members) when is_list(members) do
    items =
      Enum.map_join(members, "\n", fn %SymphonyElixir.Issue{} = member ->
        goal = if is_binary(member.agent_goal) and String.trim(member.agent_goal) != "", do: " — goal: #{String.trim(member.agent_goal)}", else: ""
        desc = if is_binary(member.description) and String.trim(member.description) != "", do: " — #{String.trim(member.description)}", else: ""
        "- **#{member.identifier}: #{member.title}**#{desc}#{goal}"
      end)

    """

    ## Grouped tasks (Symphony)

    This run covers a **group** of issues. Complete ALL of them in this single workspace and branch, then open ONE pull request. In the PR body include a `Symphony-Issue: <identifier>` marker line for the lead AND for every member task below.

    Member tasks:
    #{items}
    """
  end
```

- [ ] **Step 4: AgentRunner** — confirm `members:` flows. `run/3` already preserves caller `opts`; verify `members` reaches `build_turn_prompt`. No code change is required if `opts` is threaded unchanged from `run/3` → `do_run/3` → `run_codex_turns/4` → `do_run_codex_turns/9` → `build_turn_prompt(issue, opts, ...)`. Add a regression assertion in an AgentRunner unit test if one exercises `build_turn_prompt`; otherwise the PromptBuilder test covers the section and the orchestrator passes `members:` in Task 17.

Verify by grep that `opts` is passed unchanged at each hop:

Run: `cd elixir && rg -n "do_run_codex_turns\(|build_turn_prompt\(|run_codex_turns\(" lib/symphony_elixir/agent_runner.ex`
Expected: each call forwards `opts`. If a hop drops `:members`, thread it through explicitly.

- [ ] **Step 5: Verify pass** — Run: `cd elixir && mix test test/symphony_elixir/prompt_builder_test.exs -k "group_members_section"` → PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/prompt_builder.ex elixir/lib/symphony_elixir/agent_runner.ex elixir/test/symphony_elixir/prompt_builder_test.exs
git commit -m "feat(orchestrator): combined group brief in the agent prompt"
```

---

## Task 19: Finalizer — one PR marker per member

**Files:** Modify `elixir/lib/symphony_elixir/run_contract/finalizer.ex`; Test `elixir/test/symphony_elixir/run_contract/finalizer_test.exs` (append; create mirroring an existing finalizer test if absent)

- [ ] **Step 1: Failing test**

```elixir
  test "pull_request_body includes a marker for the lead and each member" do
    issue = %SymphonyElixir.Issue{identifier: "MAC-1", title: "Lead", description: nil, group_member_identifiers: ["MAC-2", "MAC-3"]}
    body = SymphonyElixir.RunContract.Finalizer.pull_request_body(issue)

    assert body =~ "Symphony-Issue: MAC-1"
    assert body =~ "Symphony-Issue: MAC-2"
    assert body =~ "Symphony-Issue: MAC-3"
  end
```

- [ ] **Step 2: Verify fails** — Run: `cd elixir && mix test test/symphony_elixir/run_contract/finalizer_test.exs -k "marker for the lead and each member"` → FAIL (only lead marker).

- [ ] **Step 3: Implement** — in `pull_request_body/1`, replace the single `marker = IssueMarker.marker_line(issue.identifier, marker_key(issue))` with a multi-identifier block, and use `markers` where `marker` was rendered:

```elixir
    marker =
      [issue.identifier | Map.get(issue, :group_member_identifiers, [])]
      |> Enum.reject(&(is_nil(&1) or &1 == ""))
      |> Enum.uniq()
      |> Enum.map_join("\n", &IssueMarker.marker_line(&1, marker_key(issue)))
```

(The `marker` variable now holds one or more lines; the existing heredoc that interpolates `#{marker}` renders them all.)

- [ ] **Step 4: Verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/run_contract/finalizer.ex elixir/test/symphony_elixir/run_contract/finalizer_test.exs
git commit -m "feat(orchestrator): finalizer PR body marks every group member"
```

---

## Task 20: Phase 2 gate

- [ ] **Step 1:** Run: `cd elixir && make all` → green (includes `mix specs.check`; ensure new public `def`s have `@spec`: `Grouping.*`, `PromptBuilder.group_members_section/1`, `Finalizer.pull_request_body/1` already specced).
- [ ] **Step 2:** Commit fixups: `git commit -am "test: phase 2 orchestrator grouping green"`.

---

# PHASE 3 — Board drag-to-group UI

## Task 21: Board units + merge-intent helpers

**Files:** Modify `tracker/src/components/board/board-utils.ts`; Test `tracker/src/components/board/__tests__/board-utils.test.ts`

- [ ] **Step 1: Failing test** — append:

```ts
import { groupIssuesIntoUnits, mergeIntent } from "../board-utils";

function issue(partial: Partial<Issue> & { identifier: string }): Issue {
  return {
    id: partial.identifier,
    identifier: partial.identifier,
    projectSlug: "p",
    status: "Todo",
    title: partial.identifier,
    description: null,
    priority: null,
    position: 0,
    labels: [],
    blockedBy: [],
    assignee: null,
    creator: null,
    url: null,
    branchName: null,
    attachments: [],
    createdAt: "",
    updatedAt: "",
    groupLeadIdentifier: null,
    groupMemberIdentifiers: [],
    ...partial,
  };
}

describe("groupIssuesIntoUnits", () => {
  it("absorbs members under their lead and keeps standalone issues", () => {
    const lead = issue({ identifier: "MAC-1", groupMemberIdentifiers: ["MAC-2"] });
    const member = issue({ identifier: "MAC-2", groupLeadIdentifier: "MAC-1" });
    const solo = issue({ identifier: "MAC-3" });

    const units = groupIssuesIntoUnits([lead, member, solo]);
    expect(units).toEqual([
      { kind: "group", id: "group:MAC-1", lead, members: [member] },
      { kind: "issue", id: "issue:MAC-3", issue: solo },
    ]);
  });
});

describe("mergeIntent", () => {
  const over = { top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100 };
  it("is true when the dragged center is in the middle band", () => {
    expect(mergeIntent({ ...over, top: 30 }, over, 0.25)).toBe(true);
  });
  it("is false near the edges", () => {
    expect(mergeIntent({ ...over, top: -45 }, over, 0.25)).toBe(false);
  });
});
```

- [ ] **Step 2: Verify fails** — Run: `cd tracker && npx vitest run src/components/board/__tests__/board-utils.test.ts` → FAIL.

- [ ] **Step 3: Implement** — append to `board-utils.ts`:

```ts
export const GROUP_DRAG_PREFIX = "group:";

export type BoardUnit =
  | { kind: "issue"; id: string; issue: Issue }
  | { kind: "group"; id: string; lead: Issue; members: Issue[] };

export function groupIssuesIntoUnits(issues: readonly Issue[]): BoardUnit[] {
  const byIdentifier = new Map(issues.map((issue) => [issue.identifier, issue]));
  const absorbed = new Set<string>();
  for (const issue of issues) {
    if (issue.groupMemberIdentifiers.length > 0) {
      for (const memberId of issue.groupMemberIdentifiers) absorbed.add(memberId);
    }
  }

  const units: BoardUnit[] = [];
  for (const issue of issues) {
    if (issue.groupLeadIdentifier && absorbed.has(issue.identifier)) continue;

    if (issue.groupMemberIdentifiers.length > 0) {
      const members = issue.groupMemberIdentifiers
        .map((id) => byIdentifier.get(id))
        .filter((member): member is Issue => Boolean(member));
      units.push({ kind: "group", id: `${GROUP_DRAG_PREFIX}${issue.identifier}`, lead: issue, members });
    } else {
      units.push({ kind: "issue", id: issueDragId(issue.identifier), issue });
    }
  }

  return units;
}

interface DragRect {
  top: number;
  height: number;
}

/** True when the dragged card's vertical center sits in the over card's middle band (merge), not its edges (reorder). */
export function mergeIntent(activeRect: DragRect, overRect: DragRect, bandRatio: number): boolean {
  const activeCenter = activeRect.top + activeRect.height / 2;
  const band = overRect.height * bandRatio;
  return activeCenter > overRect.top + band && activeCenter < overRect.top + overRect.height - band;
}
```

- [ ] **Step 4: Verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/board/board-utils.ts tracker/src/components/board/__tests__/board-utils.test.ts
git commit -m "feat(board): group-unit model + merge-intent helper"
```

---

## Task 22: `useIssueBoard` group/ungroup actions

**Files:** Modify `tracker/src/hooks/useIssueBoard.ts`

- [ ] **Step 1: Add optimistic actions** — import the service:

```ts
import { groupIssue, listIssues, moveIssue, ungroupIssue } from "@/services/issues";
```

Add to the hook body (after `moveIssueOptimistically`):

```ts
  const groupIssueOptimistically = useCallback(
    async (memberIdentifier: string, leadIdentifier: string) => {
      try {
        await groupIssue(projectSlug, memberIdentifier, leadIdentifier);
        await refetch();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : i18n.t("issue.board.moveFailed");
        toast.error(message);
      }
    },
    [projectSlug, refetch],
  );

  const ungroupIssueOptimistically = useCallback(
    async (identifier: string) => {
      try {
        await ungroupIssue(projectSlug, identifier);
        await refetch();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : i18n.t("issue.board.moveFailed");
        toast.error(message);
      }
    },
    [projectSlug, refetch],
  );
```

Add both to the `UseIssueBoardResult` interface and the returned object:

```ts
  groupIssueOptimistically: (memberIdentifier: string, leadIdentifier: string) => Promise<void>;
  ungroupIssueOptimistically: (identifier: string) => Promise<void>;
```

- [ ] **Step 2: Type-check** — Run: `cd tracker && npx tsc -p tsconfig.app.json --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add tracker/src/hooks/useIssueBoard.ts
git commit -m "feat(board): group/ungroup actions in useIssueBoard"
```

---

## Task 23: i18n keys

**Files:** Modify `tracker/locales/en/tracker.json`, `tracker/locales/pt-BR/tracker.json`

- [ ] **Step 1: Add a `group` block** — under the top-level `"board"` object (next to `"issueCard"`/`"column"`), in `en/tracker.json`:

```json
    "group": {
      "mergeHint": "Group with {{identifier}}",
      "count": "{{count}} grouped",
      "expand": "Show grouped tasks",
      "collapse": "Hide grouped tasks",
      "removeMember": "Remove {{identifier}} from group",
      "disband": "Ungroup all",
      "runningLocked": "Can't change the group while it's running"
    },
```

In `pt-BR/tracker.json`, the same keys translated:

```json
    "group": {
      "mergeHint": "Agrupar com {{identifier}}",
      "count": "{{count}} agrupadas",
      "expand": "Mostrar tarefas do grupo",
      "collapse": "Ocultar tarefas do grupo",
      "removeMember": "Remover {{identifier}} do grupo",
      "disband": "Desfazer grupo",
      "runningLocked": "Não dá para alterar o grupo enquanto ele está rodando"
    },
```

- [ ] **Step 2: Validate JSON** — Run: `cd tracker && node -e "require('./locales/en/tracker.json');require('./locales/pt-BR/tracker.json');console.log('ok')"` → prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json
git commit -m "feat(board): i18n for task grouping"
```

---

## Task 24: `GroupCard` component

**Files:** Create `tracker/src/components/board/GroupCard.tsx`

- [ ] **Step 1: Implement** — a single draggable unit showing the lead + collapsible members. It reuses `useSortable` with the group id and renders `IssueCard` for the lead plus compact member rows.

```tsx
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, Layers, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

import { IssueCard } from "./IssueCard";

interface GroupCardProps {
  id: string;
  lead: Issue;
  members: Issue[];
  onSelectIssue: (issue: Issue) => void;
  onRemoveMember: (identifier: string) => void;
  onDisband: (leadIdentifier: string) => void;
  agentExecutions?: ReadonlyMap<string, AgentExecution>;
  mergeActive?: boolean;
}

export function GroupCard({
  id,
  lead,
  members,
  onSelectIssue,
  onRemoveMember,
  onDisband,
  agentExecutions,
  mergeActive = false,
}: GroupCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = { transform: CSS.Translate.toString(transform), transition, touchAction: "none" } satisfies React.CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-xl border border-border/70 bg-muted/30 p-1.5 shadow-sm transition-all",
        isDragging && "opacity-40",
        mergeActive && "ring-2 ring-primary/50",
      )}
      {...attributes}
      {...listeners}
    >
      <div className="mb-1 flex items-center justify-between px-1 pt-0.5">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          title={expanded ? t("board.group.collapse") : t("board.group.expand")}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Layers className="h-3 w-3" />
          {t("board.group.count", { count: members.length })}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDisband(lead.identifier);
          }}
          className="text-[10px] font-medium text-muted-foreground hover:text-destructive"
        >
          {t("board.group.disband")}
        </button>
      </div>

      <IssueCard issue={lead} onSelect={onSelectIssue} agent={agentExecutions?.get(lead.identifier)} />

      {expanded ? (
        <div className="mt-1.5 space-y-1 border-l-2 border-border/60 pl-2">
          {members.map((member) => (
            <div
              key={member.identifier}
              className="flex items-center justify-between gap-2 rounded-md bg-card px-2 py-1 text-xs"
            >
              <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => onSelectIssue(member)}>
                <span className="font-mono text-[10px] text-muted-foreground">{member.identifier}</span>{" "}
                <span className="truncate">{member.title}</span>
              </button>
              <button
                type="button"
                aria-label={t("board.group.removeMember", { identifier: member.identifier })}
                title={t("board.group.removeMember", { identifier: member.identifier })}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveMember(member.identifier);
                }}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Type-check** — Run: `cd tracker && npx tsc -p tsconfig.app.json --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add tracker/src/components/board/GroupCard.tsx
git commit -m "feat(board): GroupCard renders a group as one collapsible unit"
```

---

## Task 25: Render units in `BoardColumn`

**Files:** Modify `tracker/src/components/board/BoardColumn.tsx`

- [ ] **Step 1: Build units + sortable ids** — replace the `SortableContext`/list section. Compute units from the column's issues, and pass through new callbacks. Add to `BoardColumnProps`:

```ts
  onRemoveMember: (identifier: string) => void;
  onDisband: (leadIdentifier: string) => void;
  mergeTargetId?: string | null;
```

Replace the body's render of cards:

```tsx
import { GroupCard } from "./GroupCard";
import { groupIssuesIntoUnits, issueDragId } from "./board-utils";
```

```tsx
        <SortableContext items={units.map((unit) => unit.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2.5 pt-1">
            {units.map((unit) =>
              unit.kind === "group" ? (
                <GroupCard
                  key={unit.id}
                  id={unit.id}
                  lead={unit.lead}
                  members={unit.members}
                  onSelectIssue={onSelectIssue}
                  onRemoveMember={onRemoveMember}
                  onDisband={onDisband}
                  agentExecutions={agentExecutions}
                  mergeActive={mergeTargetId === unit.id}
                />
              ) : (
                <IssueCard
                  key={unit.id}
                  issue={unit.issue}
                  onSelect={onSelectIssue}
                  agent={agentExecutions?.get(unit.issue.identifier)}
                  mergeActive={mergeTargetId === unit.id}
                />
              ),
            )}
          </div>
        </SortableContext>
```

Compute `units` near the top of the component body:

```tsx
  const units = groupIssuesIntoUnits(issues);
```

- [ ] **Step 2: `IssueCard` merge highlight** — in `IssueCard.tsx`, add `mergeActive?: boolean` to `IssueCardProps` and apply a ring when set:

```tsx
        agentNeedsAttention && "border-rose-500/40 ring-1 ring-rose-500/20",
        mergeActive && "ring-2 ring-primary/50",
```

(Default `mergeActive = false` in the destructure.)

- [ ] **Step 3: Type-check** — Run: `cd tracker && npx tsc -p tsconfig.app.json --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add tracker/src/components/board/BoardColumn.tsx tracker/src/components/board/IssueCard.tsx
git commit -m "feat(board): render board columns as group-aware units"
```

---

## Task 26: `BoardView` — merge vs move on drop

**Files:** Modify `tracker/src/components/board/BoardView.tsx`

- [ ] **Step 1: Track merge target + branch on drop** — add imports and state:

```tsx
import { mergeIntent, parseDragIssueId, resolveBoardMove, workflowStatusNames, GROUP_DRAG_PREFIX, type BoardState } from "./board-utils";
```

```tsx
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
```

Add props to `BoardViewProps` and thread them to columns:

```ts
  onGroupIssue: (memberIdentifier: string, leadIdentifier: string) => Promise<void> | void;
  onUngroupIssue: (identifier: string) => Promise<void> | void;
```

In `handleDragOver`, compute merge intent over a card/group unit:

```tsx
  function handleDragOver(event: DragOverEvent) {
    const identifier = parseDragIssueId(event.active.id);
    if (!identifier || !event.over) {
      setMergeTargetId(null);
      return;
    }

    const overId = String(event.over.id);
    const overIsUnit = overId.startsWith("issue:") || overId.startsWith(GROUP_DRAG_PREFIX);
    const activeRect = event.active.rect.current.translated;
    const merge =
      overIsUnit && overId !== String(event.active.id) && activeRect != null && event.over.rect != null
        ? mergeIntent(activeRect, event.over.rect, 0.25)
        : false;

    setMergeTargetId(merge ? overId : null);

    if (merge) {
      setPreviewBoard(null);
      return;
    }

    const resolved = resolveBoardMove(board, identifier, overId, statusNames);
    if (resolved) setPreviewBoard(resolved.board);
  }
```

In `handleDragEnd`, branch on the merge target:

```tsx
  function handleDragEnd(event: DragEndEvent) {
    const wasMergeTarget = mergeTargetId;
    setPreviewBoard(null);
    setActiveIdentifier(null);
    setMergeTargetId(null);

    const identifier = parseDragIssueId(event.active.id);
    if (!identifier || !event.over) return;

    if (wasMergeTarget) {
      const leadIdentifier = wasMergeTarget.startsWith(GROUP_DRAG_PREFIX)
        ? wasMergeTarget.slice(GROUP_DRAG_PREFIX.length)
        : parseDragIssueId(wasMergeTarget);
      if (leadIdentifier && leadIdentifier !== identifier) {
        void onGroupIssue(identifier, leadIdentifier);
        return;
      }
    }

    const resolved = resolveBoardMove(board, identifier, String(event.over.id), statusNames);
    if (!resolved) return;
    void onMoveIssue(identifier, resolved.targetStatus, resolved.targetIndex);
  }
```

Clear merge state in `handleDragCancel` too: `setMergeTargetId(null);`.

Pass `mergeTargetId`, `onRemoveMember={onUngroupIssue}`, and `onDisband` to each `BoardColumn`. For disband, ungroup every member: define inline:

```tsx
  function handleDisband(leadIdentifier: string) {
    const lead = statusNames.flatMap((status) => displayBoard[status] ?? []).find((issue) => issue.identifier === leadIdentifier);
    for (const memberIdentifier of lead?.groupMemberIdentifiers ?? []) void onUngroupIssue(memberIdentifier);
  }
```

- [ ] **Step 2: Wire `BoardPage`** — in `tracker/src/pages/BoardPage.tsx`, pass the new hook actions to `BoardView`:

```tsx
        onGroupIssue={groupIssueOptimistically}
        onUngroupIssue={ungroupIssueOptimistically}
```

destructuring `groupIssueOptimistically`/`ungroupIssueOptimistically` from `useIssueBoard(...)`.

- [ ] **Step 3: Type-check + board tests** — Run: `cd tracker && npx tsc -p tsconfig.app.json --noEmit && npx vitest run src/components/board` → clean/green.

- [ ] **Step 4: Commit**

```bash
git add tracker/src/components/board/BoardView.tsx tracker/src/pages/BoardPage.tsx
git commit -m "feat(board): drag onto a card to group; drop on edges to move"
```

---

## Task 27: Phase 3 gate

- [ ] **Step 1:** Run: `cd tracker && npm test` → green.
- [ ] **Step 2:** Run: `cd tracker && npx tsc -p tsconfig.app.json --noEmit` → clean.
- [ ] **Step 3:** Manual smoke (optional): start the app, drag `CDE-1140` onto `CDE-1139`, confirm the merge ring + "Agrupar com CDE-1139" hint, drop to group, then move the group across columns as one unit.
- [ ] **Step 4:** Commit fixups: `git commit -am "test: phase 3 board grouping green"`.

---

## Self-Review

**Spec coverage:**
- `group_lead_id` persistence → Tasks 1–2. ✓
- DTO/presenter/mapper expose group identifiers → Tasks 3–5, 12. ✓
- `set_issue_group`/`remove_from_group`/`list_group_members` + guards → Tasks 6–7. ✓
- Move travels together → Task 8. ✓
- Lead-removal promotion → Task 9. ✓
- Group/ungroup endpoints → Task 11. ✓
- Members filtered from candidates; lead runs the group as one slot; member-blocker blocks group → Tasks 15–17. ✓
- Combined prompt → Task 18. ✓
- One PR marker per member + completion fan-out (status + PR link) → Tasks 17, 19. ✓
- Drag-to-group (merge zone), group as single sortable unit, collapsible render, ungroup/disband, i18n → Tasks 21–26. ✓

**Placeholder scan:** No TBD/TODO. Every code step shows complete code or exact edit + anchor. Two explicit lookups (not placeholders): `group_controller_test.exs` copies the `ConnCase` header from `issue_controller_test.exs`; Task 18 Step 4 greps `agent_runner.ex` to confirm `opts` threading (a verification step, with a fix instruction if a hop drops `:members`).

**Type/name consistency:** `group_lead_identifier`/`group_member_identifiers` (Elixir, snake JSON) and `groupLeadIdentifier`/`groupMemberIdentifiers` (TS) used consistently. `set_issue_group(project_slug, member_identifier, lead_identifier)` order matches the controller and the `groupIssue` client (`lead_identifier` in body). `group_member_records/1` defined once (Task 6) and reused (Tasks 7–9). `Grouping.dispatch_candidates/members_for/claim_ids` (Task 15) are the exact names used by the orchestrator (Task 17). Frontend `GROUP_DRAG_PREFIX`/`groupIssuesIntoUnits`/`mergeIntent` (Task 21) are the exact names used in `BoardColumn`/`BoardView` (Tasks 25–26). `groupIssueOptimistically`/`ungroupIssueOptimistically` (Task 22) match the `BoardView` props `onGroupIssue`/`onUngroupIssue` wired in Task 26.

**Deferred (by design, noted in spec):** running-lock on group edits while an agent runs (UI hides actions; backend hardening can follow), exact member positioning within a column (members render under the lead, so position is cosmetic), and remote-tracker sync of groups (local-only in v1).
