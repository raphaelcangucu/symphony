# Issue Detail Sidebar: Editable Labels/Assignee + Clone/Delete — Implementation Plan

**Goal:** Make the issue detail sidebar edit labels and assignee and run Clone/Delete actions, persisting local-first and syncing to the GitHub remote.

**Architecture:** Reuse the local-first write chain (Controller → IssueAdapter.dispatch → LocalFirstAdapter → Context/SQLite + Outbox → Sync.Engine → GitHub.SyncDriver → GitHub.IssueAdapter GraphQL). Extend `update_issue` to apply labels, add a `clone_issue` operation, implement the GitHub `issue/update` push, and make the React `SummaryTab` sidebar editable.

**Tech Stack:** Elixir/Phoenix + Ecto (SQLite), GitHub GraphQL (Projects v2); React + TypeScript + Vitest/RTL, Radix dropdown-menu.

Spec: `docs/superpowers/specs/2026-06-03-issue-detail-sidebar-actions-design.md`

Commands:
- Backend tests: `cd elixir && mix test <path>`
- Frontend tests: `cd tracker && npm test -- <path>`

---
### Task 1: Context — apply labels in `update_issue` + `clone_issue`

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex` (`update_issue/3`, new `clone_issue/2`, new private `set_issue_labels/2`)
- Test: `elixir/test/symphony_elixir/local_tracker/context_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
test "update_issue replaces the issue label set from label_ids by name", %{project: project} do
  {:ok, issue} = Context.create_issue(project.slug, %{"title" => "t", "status" => "Backlog"})
  {:ok, updated} = Context.update_issue(project.slug, issue.identifier, %{"label_ids" => ["bug", "urgent"]})
  names = Enum.map(updated.labels, & &1.name) |> Enum.sort()
  assert names == ["bug", "urgent"]

  {:ok, replaced} = Context.update_issue(project.slug, issue.identifier, %{"label_ids" => ["bug"]})
  assert Enum.map(replaced.labels, & &1.name) == ["bug"]
end

test "update_issue with empty label_ids clears labels", %{project: project} do
  {:ok, issue} = Context.create_issue(project.slug, %{"title" => "t", "status" => "Backlog"})
  {:ok, _} = Context.update_issue(project.slug, issue.identifier, %{"label_ids" => ["bug"]})
  {:ok, cleared} = Context.update_issue(project.slug, issue.identifier, %{"label_ids" => []})
  assert cleared.labels == []
end

test "clone_issue copies fields, labels and assignee, resets status, mints new identifier", %{project: project} do
  {:ok, src} =
    Context.create_issue(project.slug, %{
      "title" => "Source",
      "description" => "desc",
      "status" => "In Progress",
      "priority" => 2,
      "assignee_id" => "alice"
    })

  {:ok, _} = Context.update_issue(project.slug, src.identifier, %{"label_ids" => ["bug"]})
  {:ok, clone} = Context.clone_issue(project.slug, src.identifier)

  refute clone.identifier == src.identifier
  assert clone.title == "Source"
  assert clone.description == "desc"
  assert clone.priority == 2
  assert clone.assignee_id == "alice"
  assert Enum.map(clone.labels, & &1.name) == ["bug"]
  assert clone.status.name == "Backlog"
end
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_test.exs`
Expected: FAIL (`clone_issue/2` undefined; label_ids ignored).

- [ ] **Step 3: Apply labels inside `update_issue/3`**

In `update_issue/3` (after `Repo.update()` succeeds, before/within the result pipeline) apply labels when `label_ids` is present. Add a `maybe_set_labels` hop:

```elixir
issue
|> IssueRecord.changeset(changes)
|> Repo.update()
|> sync_agent_routing_label_result(project.id, attr(attrs, :agent))
|> maybe_set_labels_result(project.id, attrs)
|> preload_issue_result()
|> tap_issue_event("issue_updated", %{status: status.name})
```

Add private helpers (label_ids may be names or remote ids; resolve by name, create if missing):

```elixir
defp maybe_set_labels_result({:ok, %IssueRecord{} = issue}, project_id, attrs) do
  case label_id_list(attrs) do
    :absent -> {:ok, issue}
    names -> set_issue_labels(issue, project_id, names)
  end
end

defp maybe_set_labels_result(result, _project_id, _attrs), do: result

defp label_id_list(attrs) do
  case attr(attrs, :label_ids) do
    nil -> :absent
    list when is_list(list) -> Enum.filter(list, &(is_binary(&1) and String.trim(&1) != ""))
    _ -> :absent
  end
end

defp set_issue_labels(%IssueRecord{} = issue, project_id, names) do
  desired =
    names
    |> Enum.map(&String.trim/1)
    |> Enum.uniq()

  with {:ok, labels} <- ensure_labels(project_id, desired) do
    desired_ids = Enum.map(labels, & &1.id)
    keep_ids = agent_routing_label_ids() ++ desired_ids

    IssueLabel
    |> where([il], il.issue_id == ^issue.id and il.label_id not in ^keep_ids)
    |> Repo.delete_all()

    Enum.each(desired_ids, &ensure_issue_label_idempotent(issue.id, &1))
    {:ok, issue}
  end
end

defp ensure_labels(project_id, names) do
  Enum.reduce_while(names, {:ok, []}, fn name, {:ok, acc} ->
    case ensure_label(project_id, name) do
      {:ok, label} -> {:cont, {:ok, [label | acc]}}
      {:error, _} = error -> {:halt, error}
    end
  end)
end

defp agent_routing_label_ids do
  Label
  |> where([label], label.name in ^AgentRouting.agent_labels())
  |> select([label], label.id)
  |> Repo.all()
end
```

- [ ] **Step 4: Add `clone_issue/2`**

```elixir
@spec clone_issue(String.t(), String.t()) ::
        {:ok, IssueRecord.t()} | {:error, Ecto.Changeset.t() | missing_error()}
def clone_issue(project_slug, identifier)
    when is_binary(project_slug) and is_binary(identifier) do
  with {:ok, project} <- fetch_project(project_slug),
       {:ok, source} <- fetch_project_issue(project.id, identifier) do
    source = Repo.preload(source, [:labels])
    label_names = Enum.map(source.labels, & &1.name)

    attrs = %{
      "title" => source.title,
      "description" => source.description,
      "priority" => source.priority,
      "assignee_id" => source.assignee_id,
      "status" => @default_issue_status
    }

    with {:ok, clone} <- create_issue(project_slug, attrs),
         {:ok, clone} <- set_issue_labels(clone, project.id, label_names) do
      clone |> preload_issue_result() |> elem(1) |> then(&{:ok, &1})
    end
  end
end
```

(If `create_issue` does not accept `assignee_id`/`priority` into `issue_create_attrs`, both keys are already in `issue_create_attrs` per `context.ex:1118-1142`, so they persist.)

- [ ] **Step 5: Run tests, verify pass**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_test.exs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/context.ex elixir/test/symphony_elixir/local_tracker/context_test.exs
git commit -m "feat(tracker): apply labels on update_issue and add clone_issue"
```

### Task 2: LocalFirstAdapter — `:labels` dirty + `clone_issue` enqueue

**Files:**
- Modify: `elixir/lib/symphony_elixir/tracker/sync/local_first_adapter.ex`
- Test: `elixir/test/symphony_elixir/tracker/sync/local_first_adapter_test.exs` (extend existing; if absent, create following `issue_controller_test.exs` setup)

- [ ] **Step 1: Write failing tests**

```elixir
test "update_issue marks :labels dirty and enqueues issue/update", ctx do
  {:ok, _dto} = LocalFirstAdapter.update_issue(ctx.project, ctx.identifier, %{"label_ids" => ["bug"]})
  assert :labels in LocalStore.dirty_fields(ctx.identifier, ctx.project.slug)
  assert Outbox.pending(ctx.project.id) |> Enum.any?(&(&1.entity_type == "issue" and &1.operation == "update"))
end

test "clone_issue persists locally and enqueues issue/create", ctx do
  {:ok, clone} = LocalFirstAdapter.clone_issue(ctx.project, ctx.identifier)
  refute clone.identifier == ctx.identifier
  assert Outbox.pending(ctx.project.id) |> Enum.any?(&(&1.entity_type == "issue" and &1.operation == "create"))
end
```

(Use whatever pending/inspection helpers the existing outbox tests use; if none, query `Repo.all(OutboxEntry)`.)

- [ ] **Step 2: Run, verify fail**

Run: `cd elixir && mix test test/symphony_elixir/tracker/sync/local_first_adapter_test.exs`
Expected: FAIL (`:labels` not produced; `clone_issue/2` undefined).

- [ ] **Step 3: Add `:labels` dirty mapping**

In `to_dirty_field/1` add a clause before the catch-all:

```elixir
defp to_dirty_field(key) when key in [:label_ids, "label_ids", :labels, "labels"], do: :labels
```

- [ ] **Step 4: Add `clone_issue/2`**

```elixir
@spec clone_issue(Project.t(), String.t()) :: {:ok, term()} | {:error, term()}
def clone_issue(%Project{} = project, identifier) do
  with {:ok, dto} <- IssueAdapter.clone_issue(project, identifier) do
    payload = %{"title" => dto.title}
    enqueue(project, dto.identifier, "issue", "create", payload, "issue:create:#{project.id}:#{dto.identifier}")
    {:ok, dto}
  end
end
```

This requires `LocalTracker.IssueAdapter` to expose `clone_issue/2` (Task 3 Step 3a).

- [ ] **Step 5: Run, verify pass**

Run: `cd elixir && mix test test/symphony_elixir/tracker/sync/local_first_adapter_test.exs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/tracker/sync/local_first_adapter.ex elixir/test/symphony_elixir/tracker/sync/local_first_adapter_test.exs
git commit -m "feat(sync): mark labels dirty and enqueue clone as issue/create"
```

### Task 3: Adapters + Controller route + remote form_options

**Files:**
- Modify: `elixir/lib/symphony_elixir/tracker/issue_adapter.ex` (add `clone_issue/2` callback)
- Modify: `elixir/lib/symphony_elixir/local_tracker/issue_adapter.ex` (implement `clone_issue/2`, delegating to `Context.clone_issue`)
- Modify: `elixir/lib/symphony_elixir_web/router.ex` (clone route)
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex` (`clone/2`, normalize `label_ids`/`assignee_id` in `update`, route `form_options` labels/assignees to remote)
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs`

- [ ] **Step 1: Write failing controller tests**

```elixir
test "PATCH update sets labels and assignee", %{conn: conn, project: project, issue: issue} do
  conn = patch(conn, ~p"/api/tracker/v1/projects/#{project.slug}/issues/#{issue.identifier}",
    %{"label_ids" => ["bug"], "assignee_id" => "alice"})
  assert %{"data" => data} = json_response(conn, 200)
  assert data["labels"] == ["bug"]
  assert data["assignee_id"] == "alice" or data["assignee"] == "alice"
end

test "POST clone returns a new issue", %{conn: conn, project: project, issue: issue} do
  conn = post(conn, ~p"/api/tracker/v1/projects/#{project.slug}/issues/#{issue.identifier}/clone")
  assert %{"data" => data} = json_response(conn, 201)
  refute data["identifier"] == issue.identifier
end

test "form_options returns remote labels and assignees for remote-backed project", %{conn: conn} do
  # uses fake remote adapter returning label "bug" + assignee "alice" (existing fixture pattern)
  ...
end
```

- [ ] **Step 2: Run, verify fail**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs`
Expected: FAIL (no clone route; update drops labels).

- [ ] **Step 3a: `IssueAdapter` behaviour + `LocalTracker.IssueAdapter`**

In `tracker/issue_adapter.ex` add callback:

```elixir
@callback clone_issue(Project.t(), String.t()) :: {:ok, IssueDTO.t()} | {:error, tracker_error()}
```

In `local_tracker/issue_adapter.ex` implement (mirroring its other Context delegations that map to `IssueDTO`):

```elixir
@impl true
def clone_issue(%Project{} = project, identifier) do
  case Context.clone_issue(project.slug, identifier) do
    {:ok, record} -> {:ok, to_dto(record, project)}
    {:error, reason} -> {:error, normalize_error(reason)}
  end
end
```

(Reuse the module's existing record→DTO + error-normalization helpers; match their exact names.)

- [ ] **Step 3b: Router**

Add next to the other custom issue routes in the tracker scope:

```elixir
post("/projects/:project_slug/issues/:identifier/clone", IssueController, :clone)
```

- [ ] **Step 3c: Controller — clone, update normalization, remote form_options**

Add `clone/2`:

```elixir
@spec clone(Conn.t(), map()) :: Conn.t()
def clone(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
  with {:ok, project} <- Context.get_project(project_slug),
       {:ok, issue} <- IssueAdapter.dispatch(project, :clone_issue, [identifier]) do
    conn |> put_status(:created) |> json(%{data: TrackerPresenter.issue(issue)})
  else
    {:error, reason} -> TrackerErrors.render(conn, reason)
  end
end
```

Normalize `update` attrs so labels/assignee pass through cleanly (replace the raw `Map.drop`):

```elixir
def update(conn, %{"project_slug" => project_slug, "id" => identifier} = params) do
  attrs = normalize_update_attrs(params)
  with {:ok, project} <- Context.get_project(project_slug),
       {:ok, issue} <- IssueAdapter.dispatch(project, :update_issue, [identifier, attrs]) do
    json(conn, %{data: TrackerPresenter.issue(issue)})
  else
    {:error, reason} -> TrackerErrors.render(conn, reason)
  end
end

defp normalize_update_attrs(params) do
  base = Map.drop(params, ["project_slug", "id"])

  base =
    if Map.has_key?(params, "label_ids") or Map.has_key?(params, "labels") do
      Map.put(base, "label_ids", normalize_string_list(Map.get(params, "label_ids") || Map.get(params, "labels")))
    else
      base
    end

  base
end
```

For remote `form_options`, resolve labels/assignees through the remote adapter when present, fall back to local:

```elixir
defp options_source(project, fun) do
  case IssueAdapter.remote_for(project.tracker_kind) do
    nil -> IssueAdapter.dispatch(project, fun, [])
    remote ->
      case apply(remote, fun, [project]) do
        {:ok, []} -> IssueAdapter.dispatch(project, fun, [])
        {:ok, _} = ok -> ok
        {:error, _} -> IssueAdapter.dispatch(project, fun, [])
      end
  end
end
```

Use `options_source(project, :list_labels)` / `options_source(project, :list_assignable_users)` in `form_options/2`; keep statuses on `IssueAdapter.dispatch(project, :list_statuses, [])`.

- [ ] **Step 4: Run, verify pass**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir elixir/test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs
git commit -m "feat(tracker): clone route, update labels/assignee, remote form_options"
```

### Task 4: GitHub GraphQL — remove-labels + set-assignees mutations and real `update_issue`

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/issue_adapter/query.ex` (add `remove_labels_mutation/0`, `set_assignees_mutation/0`)
- Modify: `elixir/lib/symphony_elixir/github/issue_adapter.ex` (replace `update_issue/3` stub)
- Test: `elixir/test/symphony_elixir/github/issue_adapter_test.exs` (fake client)

- [ ] **Step 1: Write failing test (fake graphql client records calls)**

```elixir
test "update_issue adds labels and sets assignees on the issue node", %{project: project} do
  # fake client returns repo metadata (labels [%{name: "bug", id: "LB_bug"}]),
  # assignable users ([%{login: "alice", id: "U_alice"}]), issue node id "I_1".
  assert {:ok, _} =
           IssueAdapter.update_issue(project, "1", %{"label_ids" => ["bug"], "assignee_id" => "alice"})

  assert called_mutation?("addLabelsToLabelable", %{"labelIds" => ["LB_bug"]})
  assert called_mutation?("removeLabelsFromLabelable")
  assert called_mutation?("SymphonyUiSetAssignees", %{"assigneeIds" => ["U_alice"]})
end
```

- [ ] **Step 2: Run, verify fail**

Run: `cd elixir && mix test test/symphony_elixir/github/issue_adapter_test.exs`
Expected: FAIL (returns `:not_supported_on_remote`).

- [ ] **Step 3: Add mutations to Query**

```elixir
@remove_labels """
mutation SymphonyUiRemoveLabels($labelableId: ID!, $labelIds: [ID!]!) {
  removeLabelsFromLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
    labelable { __typename }
  }
}
"""

@set_assignees """
mutation SymphonyUiSetAssignees($assignableId: ID!, $assigneeIds: [ID!]!) {
  updateIssue(input: { id: $assignableId, assigneeIds: $assigneeIds }) {
    issue { id }
  }
}
"""

def remove_labels_mutation, do: @remove_labels
def set_assignees_mutation, do: @set_assignees
```

- [ ] **Step 4: Implement `update_issue/3`**

Replace the stub. Only touch fields present in `attrs`. Reuse existing `fetch_issue_node_id`, `fetch_repo_metadata`, `resolve_label_ids`, `add_labels`, `list_assignable_users`, `parse_issue_number`, `RepoSpec.split`, `config`.

```elixir
@impl true
def update_issue(%Project{} = project, identifier, attrs) do
  with {:ok, {owner, name}} <- RepoSpec.split(config(project).repo),
       {:ok, number} <- parse_issue_number(identifier),
       {:ok, issue_node_id} <- fetch_issue_node_id(owner, name, number),
       :ok <- maybe_update_labels(owner, name, issue_node_id, attrs),
       :ok <- maybe_update_assignee(project, issue_node_id, attrs) do
    {:ok, IssueDTO.build(%{identifier: identifier, title: "", project_slug: project.slug})}
  else
    {:error, reason} -> {:error, map_error(reason)}
  end
end

defp maybe_update_labels(owner, name, node_id, %{} = attrs) do
  case Map.get(attrs, "label_ids") do
    nil -> :ok
    names ->
      with {:ok, meta} <- fetch_repo_metadata(owner, name) do
        desired = resolve_label_ids(meta.labels, %{"label_ids" => names})
        present = Enum.map(meta.labels, & &1.id)
        remove = present -- desired
        with {:ok, _} <- (if desired == [], do: {:ok, nil}, else: add_labels(node_id, desired)),
             {:ok, _} <- (if remove == [], do: {:ok, nil}, else: remove_labels(node_id, remove)) do
          :ok
        end
      end
  end
end

defp maybe_update_assignee(_project, _node_id, attrs) when not is_map_key(attrs, "assignee_id"), do: :ok

defp maybe_update_assignee(project, node_id, %{"assignee_id" => login}) do
  ids =
    case login do
      nil -> []
      "" -> []
      value ->
        case list_assignable_users(project) do
          {:ok, users} ->
            users |> Enum.find(&(&1.login == value)) |> case do
              %{id: id} when is_binary(id) -> [id]
              _ -> []
            end
          _ -> []
        end
    end

  case client().graphql(Query.set_assignees_mutation(), %{"assignableId" => node_id, "assigneeIds" => ids}, []) do
    {:ok, _} -> :ok
    {:error, _} = error -> error
  end
end

defp remove_labels(labelable_id, label_ids) do
  client().graphql(Query.remove_labels_mutation(), %{"labelableId" => labelable_id, "labelIds" => label_ids}, [])
end
```

- [ ] **Step 5: Run, verify pass**

Run: `cd elixir && mix test test/symphony_elixir/github/issue_adapter_test.exs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/github/issue_adapter.ex elixir/lib/symphony_elixir/github/issue_adapter/query.ex elixir/test/symphony_elixir/github/issue_adapter_test.exs
git commit -m "feat(github): implement issue update for labels and assignee"
```

### Task 5: GitHub SyncDriver — push `issue/update`

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/sync_driver.ex`
- Test: `elixir/test/symphony_elixir/github/sync_driver_test.exs`

- [ ] **Step 1: Write failing test**

```elixir
test "push issue/update delegates to adapter.update_issue", %{project: project} do
  entry = %OutboxEntry{entity_type: "issue", operation: "update", payload: %{"identifier" => "1", "assignee_id" => "alice"}}
  assert {:ok, _} = SyncDriver.push(project, entry)
  assert adapter_called?(:update_issue, ["1"])
end
```

- [ ] **Step 2: Run, verify fail**

Run: `cd elixir && mix test test/symphony_elixir/github/sync_driver_test.exs`
Expected: FAIL (hits `unsupported_push`).

- [ ] **Step 3: Add push clause** (before the catch-all `unsupported_push`)

```elixir
def push(%Project{} = project, %OutboxEntry{entity_type: "issue", operation: "update", payload: payload}) do
  attrs = Map.drop(payload, ["identifier"])
  case adapter().update_issue(project, payload["identifier"], attrs) do
    {:ok, %{id: id}} -> {:ok, id}
    {:ok, _} -> {:ok, nil}
    error -> error
  end
end
```

Note: the outbox `issue/update` payload is the stringified `update_issue` attrs (includes `label_ids` and/or `assignee_id`) — see `LocalFirstAdapter.update_issue/3` enqueue.

- [ ] **Step 4: Run, verify pass**

Run: `cd elixir && mix test test/symphony_elixir/github/sync_driver_test.exs`
Expected: PASS

- [ ] **Step 5: Backend gates**

Run: `cd elixir && mix specs.check && mix test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/github/sync_driver.ex elixir/test/symphony_elixir/github/sync_driver_test.exs
git commit -m "feat(github): push issue/update outbox entries to remote"
```

### Task 6: Frontend service — `updateIssue` + `cloneIssue`

**Files:**
- Modify: `tracker/src/services/issues.ts`
- Test: `tracker/src/services/__tests__/issues.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it("updateIssue PATCHes label_ids and assignee_id", async () => {
  const issue = await updateIssue("proj", "MAC-1", { labelIds: ["bug"], assigneeId: "alice" });
  expect(http.patch).toHaveBeenCalledWith(
    expect.stringContaining("/projects/proj/issues/MAC-1"),
    { label_ids: ["bug"], assignee_id: "alice" },
  );
  expect(issue.identifier).toBe("MAC-1");
});

it("cloneIssue POSTs to the clone endpoint", async () => {
  await cloneIssue("proj", "MAC-1");
  expect(http.post).toHaveBeenCalledWith(expect.stringContaining("/issues/MAC-1/clone"));
});
```

(Match the existing mocking style in `issues.test.ts`.)

- [ ] **Step 2: Run, verify fail**

Run: `cd tracker && npm test -- src/services/__tests__/issues.test.ts`
Expected: FAIL (functions undefined).

- [ ] **Step 3: Implement**

```ts
export interface UpdateIssueInput {
  labelIds?: string[];
  assigneeId?: string | null;
}

export async function updateIssue(
  projectSlug: string,
  identifier: string,
  input: UpdateIssueInput,
): Promise<Issue> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");

  const payload: Record<string, unknown> = {};
  if (input.labelIds !== undefined) payload.label_ids = input.labelIds;
  if (input.assigneeId !== undefined) payload.assignee_id = input.assigneeId;

  const response = await http.patch(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}`),
    payload,
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}

export async function cloneIssue(projectSlug: string, identifier: string): Promise<Issue> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");
  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/clone`),
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}
```

(Confirm `http.patch` exists in `services/http.ts`; if not, add a thin wrapper mirroring `http.post`.)

- [ ] **Step 4: Run, verify pass**

Run: `cd tracker && npm test -- src/services/__tests__/issues.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tracker/src/services/issues.ts tracker/src/services/__tests__/issues.test.ts
git commit -m "feat(tracker-ui): add updateIssue and cloneIssue services"
```

### Task 7: SummaryTab — editable Labels + Assignee + Actions

**Files:**
- Create: `tracker/src/hooks/useIssueFormOptions.ts` (lazy load `getIssueFormOptions`)
- Modify: `tracker/src/components/issues/issue-detail/SummaryTab.tsx`
- Test: `tracker/src/components/issues/issue-detail/__tests__/SummaryTab.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
it("changes assignee via the sidebar", async () => {
  const onUpdate = vi.fn();
  render(<SummaryTab issue={issueFixture} formOptions={optionsFixture} onUpdate={onUpdate} onClone={vi.fn()} onDelete={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: /assignee/i }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: /alice/i }));
  expect(onUpdate).toHaveBeenCalledWith({ assigneeId: "alice" });
});

it("toggles a label via the sidebar", async () => {
  const onUpdate = vi.fn();
  render(<SummaryTab issue={issueFixture} formOptions={optionsFixture} onUpdate={onUpdate} onClone={vi.fn()} onDelete={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: /edit labels/i }));
  await userEvent.click(screen.getByRole("menuitemcheckbox", { name: /bug/i }));
  expect(onUpdate).toHaveBeenCalledWith({ labelIds: ["bug"] });
});

it("fires clone and delete actions", async () => {
  const onClone = vi.fn();
  const onDelete = vi.fn();
  render(<SummaryTab issue={issueFixture} formOptions={optionsFixture} onUpdate={vi.fn()} onClone={onClone} onDelete={onDelete} />);
  await userEvent.click(screen.getByRole("button", { name: /clone task/i }));
  expect(onClone).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd tracker && npm test -- src/components/issues/issue-detail/__tests__/SummaryTab.test.tsx`
Expected: FAIL (no editors/actions; props don't exist).

- [ ] **Step 3: Extend `SummaryTabProps`**

Add to the interface:

```tsx
formOptions?: IssueFormOptions | null;
onUpdate?: (input: { labelIds?: string[]; assigneeId?: string | null }) => void;
onClone?: () => void;
onDelete?: () => void;
```

- [ ] **Step 4: Make the Assignee field editable** (replace the read-only `<Field label="Assignee">` content with a dropdown trigger built from `formOptions?.assignees`, plus an "Unassigned" `menuitemradio`). Selecting calls `onUpdate({ assigneeId })`. Use the existing `dropdown-menu` primitives.

- [ ] **Step 5: Make the Labels field editable** (add an "Edit labels" trigger opening a dropdown of `menuitemcheckbox` items from `formOptions?.labels`; checked state from `issue.labels`; toggling computes the next label-name array and calls `onUpdate({ labelIds: next })`).

- [ ] **Step 6: Add the Actions section** at the end of the `<aside>`:

```tsx
<Separator />
<div className="space-y-2">
  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Actions</div>
  <button type="button" onClick={onClone} className="...">Clone task</button>
  <button type="button" onClick={onDelete} className="... text-destructive">Delete task</button>
</div>
```

- [ ] **Step 7: Create `useIssueFormOptions` hook** (lazy fetch on first editor open, cached per projectSlug):

```ts
export function useIssueFormOptions(projectSlug: string, enabled: boolean) {
  const [options, setOptions] = useState<IssueFormOptions | null>(null);
  useEffect(() => {
    if (!enabled || options || !projectSlug) return;
    let active = true;
    void getIssueFormOptions(projectSlug).then((o) => { if (active) setOptions(o); }).catch(() => {});
    return () => { active = false; };
  }, [enabled, options, projectSlug]);
  return options;
}
```

- [ ] **Step 8: Run, verify pass**

Run: `cd tracker && npm test -- src/components/issues/issue-detail/__tests__/SummaryTab.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add tracker/src/hooks/useIssueFormOptions.ts tracker/src/components/issues/issue-detail/SummaryTab.tsx tracker/src/components/issues/issue-detail/__tests__/SummaryTab.test.tsx
git commit -m "feat(tracker-ui): editable labels/assignee and clone/delete actions in sidebar"
```

### Task 8: Wire IssueDrawer / IssueDetailRoute (update + clone + optimistic board refresh)

**Files:**
- Modify: `tracker/src/components/issues/IssueDrawer.tsx` (pass `formOptions`, `onUpdate`, `onClone`, `onDelete` into `SummaryTab`; load options via `useIssueFormOptions`)
- Modify: `tracker/src/components/workspace/IssueDetailRoute.tsx` (implement `handleUpdate` and `handleClone`)

- [ ] **Step 1: Add handlers in `IssueDetailRoute`**

```tsx
async function handleUpdate(target: Issue, input: { labelIds?: string[]; assigneeId?: string | null }) {
  try {
    const updated = await updateIssue(projectSlug, target.identifier, input);
    setIssues((current) => current.map((c) => (c.identifier === updated.identifier ? updated : c)));
    if (fetchedIssue?.identifier === updated.identifier) setFetchedIssue(updated);
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : "Failed to update task");
  }
}

async function handleClone(target: Issue) {
  try {
    const clone = await cloneIssue(projectSlug, target.identifier);
    setIssues((current) => [...current, clone]);
    toast.success(`Cloned to ${clone.identifier}`);
    navigate({ pathname: issuePath(projectSlug, view, clone.identifier, tab), search: location.search });
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : "Failed to clone task");
  }
}
```

Pass `onUpdate`/`onClone` down through `IssueDrawer` (add the props to `IssueDrawerProps` and thread to `SummaryTab`; reuse the existing `onDelete`).

- [ ] **Step 2: Load form options in `IssueDrawer`** via `const formOptions = useIssueFormOptions(projectSlug, open && Boolean(issue));` and pass to `SummaryTab`.

- [ ] **Step 3: Run focused frontend tests + lint + build**

Run: `cd tracker && npm test && npm run lint && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tracker/src/components/issues/IssueDrawer.tsx tracker/src/components/workspace/IssueDetailRoute.tsx
git commit -m "feat(tracker-ui): wire sidebar update/clone handlers with optimistic board refresh"
```

### Task 9: Full verification

- [ ] Backend: `cd elixir && make all`
- [ ] Frontend: `cd tracker && npm test && npm run lint && npm run build`
- [ ] Manual smoke (GitHub-backed project, sync enabled): open a task, change assignee, toggle a label, clone, delete; confirm the outbox pushes to GitHub (check `last_synced_at` / no `last_sync_error`).

---

## Self-Review

- **Spec coverage:** editable labels (T1,T3,T4,T7), assignee (T1 already-mutable + T4,T7), delete in sidebar (T7,T8 reuse existing), clone (T1,T2,T3,T7,T8), GitHub update push (T4,T5), remote form_options (T3), frontend services (T6). All spec sections covered.
- **Type consistency:** `clone_issue/2` defined as a callback (T3) before use in `LocalFirstAdapter` (T2) — implement T3 Step 3a before running T2; note added in T2 Step 4. `onUpdate({ labelIds, assigneeId })` shape matches `UpdateIssueInput` (T6) and `updateIssue` serialization. Outbox `issue/update` payload = stringified update attrs, consumed verbatim in T5/T4.
- **Placeholders:** GraphQL mutation strings, Elixir helpers, TS code all concrete. The two "reuse existing helper names" notes (T3 record→DTO, T6 `http.patch` existence) are verification hooks, not deferred work.
- **Ordering caveat:** Task 4 (GitHub adapter) and Task 5 (driver) only affect remote-backed projects; local-only flows are green after Task 3.




