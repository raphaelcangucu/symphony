# GitHub Project Status Source Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer inline execution in this session with checkpoints after each task. Use TDD: write focused failing tests, run them, then implement the minimum production code. Do not create git commits unless the user explicitly asks.

**Goal:** Remove GitHub `Symphony State` as a workflow concept, use only the GitHub Project `Status` field, and add configurable post-agent completion transitions.

**Architecture:** GitHub Project `Status` becomes the single workflow state source for polling and mutation. Bootstrap/cache/reconciliation resolve one state field (`Status`) and one option map. The orchestrator applies an optional workflow-defined transition map after normal agent completion, then the current Macro Markets project is adjusted and verified with GitHub GraphQL.

**Tech Stack:** Elixir, Phoenix, NimbleOptions, GitHub GraphQL via `gh`, ExUnit.

---

## File Map

### Backend Runtime

- Modify `elixir/lib/symphony_elixir/github/config.ex`: remove custom/native split config and default the state field to `Status`.
- Modify `elixir/lib/symphony_elixir/config.ex`: add `agent.completion_transitions` schema, parser, accessor, and validation.
- Modify `elixir/lib/symphony_elixir/github/bootstrap.ex`: resolve/cache the Project `Status` field only.
- Modify `elixir/lib/symphony_elixir/github/state_reconciliation.ex`: reconcile the cached `Status` field and update error/log wording.
- Modify `elixir/lib/symphony_elixir/github/client.ex`: poll/write only the cached `Status` field and remove native/custom fallback/sync logic.
- Modify `elixir/lib/symphony_elixir/agent_runner.ex`: keep turn-continuation behavior unchanged inside one agent run.
- Modify `elixir/lib/symphony_elixir/orchestrator.ex`: apply `agent.completion_transitions` after normal agent process completion.

### Workflow and Docs

- Modify `elixir/WORKFLOW.macromarkets.example.md`: remove `Symphony State` config/docs and add Macro Markets completion transitions.
- Modify `elixir/WORKFLOW.github.example.md`: describe `Status` as the source of truth.
- Modify `elixir/README.md`: update GitHub Project setup text.
- Modify `elixir/docs/troubleshooting.md`: update missing/removed state troubleshooting to refer to `Status`.
- Modify `.codex/skills/github-projects/SKILL.md`: add Symphony Project status setup instructions and inspection commands.
- Optionally update non-authoritative historical docs only when they are current guidance; leave dated design/spec history intact.

### Tests

- Modify `elixir/test/symphony_elixir/github_config_test.exs`: assert GitHub state field defaults to `Status`; remove native sync config tests.
- Modify `elixir/test/symphony_elixir/github/bootstrap_test.exs`: existing and auto project bootstrap cache `Status` metadata without `Symphony State`.
- Modify `elixir/test/symphony_elixir/github/state_reconciliation_test.exs`: reconcile messages and field matching refer to `Status`.
- Modify `elixir/test/symphony_elixir/github_client_test.exs`: poll/write only `Status`; conflicting `Symphony State` values are ignored.
- Modify `elixir/test/symphony_elixir/orchestrator_status_test.exs`: normal completion transitions update state; failed exits do not.
- Modify `elixir/test/support/test_support.exs`: add workflow helper support for `agent.completion_transitions` and remove custom GitHub state-field helpers if unused.

### Operational Project Adjustment

- Use `gh api graphql` against `clouapp` project `2` to inspect and, if needed, adjust the current Macro Markets Project `Status` options.
- After implementation passes, remove or hide the unused `Symphony State` field from Macro Markets so humans cannot update the wrong field again.
- Verify `clouapp/front#507` remains `Status = Rework` and is visible to the status-only Symphony poll.

---

## Task 1: Update Workflow Config Contract

**Files:**
- Modify: `elixir/lib/symphony_elixir/config.ex`
- Modify: `elixir/lib/symphony_elixir/github/config.ex`
- Modify: `elixir/test/symphony_elixir/github_config_test.exs`
- Modify: `elixir/test/support/test_support.exs`

- [ ] **Step 1: Write failing config tests for `Status` default and completion transitions**

Add tests that assert:

```elixir
test "status_field/0 defaults to Status" do
  write_workflow_file!(Workflow.workflow_file_path(), tracker_kind: "github", tracker_repo: "owner/repo")

  assert SymphonyElixir.GitHub.Config.status_field() == "Status"
end

test "completion_transitions/0 returns normalized workflow map" do
  write_workflow_file!(Workflow.workflow_file_path(),
    tracker_active_states: ["Todo", "In Progress", "Rework", "Merging"],
    tracker_wait_states: ["Human Review"],
    tracker_terminal_states: ["Done", "Cancelled"],
    agent_completion_transitions: %{
      "Todo" => "Human Review",
      "In Progress" => "Human Review",
      "Rework" => "Human Review",
      "Merging" => "Done"
    }
  )

  assert SymphonyElixir.Config.completion_transitions() == %{
           "Todo" => "Human Review",
           "In Progress" => "Human Review",
           "Rework" => "Human Review",
           "Merging" => "Done"
         }
end

test "validate! rejects completion transition states outside field_states" do
  write_workflow_file!(Workflow.workflow_file_path(),
    tracker_field_states: ["Todo", "In Progress", "Done"],
    agent_completion_transitions: %{"In Progress" => "Human Review"}
  )

  assert {:error, message} = SymphonyElixir.Config.validate!()
  assert message =~ "completion_transitions"
  assert message =~ "Human Review"
end
```

Also update `write_workflow_file!/2` in `elixir/test/support/test_support.exs` so tests can emit:

```yaml
agent:
  completion_transitions:
    In Progress: Human Review
```

- [ ] **Step 2: Run focused config tests and verify failure**

Run:

```bash
cd elixir && mise exec -- mix test test/symphony_elixir/github_config_test.exs
```

Expected: tests fail because `status_field/0` still defaults to `Symphony State`, `completion_transitions/0` does not exist, and validation does not check the map.

- [ ] **Step 3: Implement config changes**

In `elixir/lib/symphony_elixir/github/config.ex`:

- Change `@default_status_field` from `"Symphony State"` to `"Status"`.
- Remove `native_status_field/0` and `sync_native_status?/0` if no production callers remain after later tasks; if callers still exist during this task, leave removal to Task 3.

In `elixir/lib/symphony_elixir/config.ex`:

- Add `completion_transitions` under the `agent` schema:

```elixir
completion_transitions: [
  type: {:map, :string, :string},
  default: %{}
]
```

- Add accessor:

```elixir
@spec completion_transitions() :: %{String.t() => String.t()}
def completion_transitions do
  get_in(validated_workflow_options(), [:agent, :completion_transitions])
end
```

- Parse the YAML map in `extract_agent_options/1`:

```elixir
|> put_if_present(:completion_transitions, string_map_value(Map.get(section, "completion_transitions")))
```

- Add a helper that accepts only binary keys and values:

```elixir
defp string_map_value(value) when is_map(value) do
  value
  |> Enum.reduce(%{}, fn
    {key, val}, acc when is_binary(key) and is_binary(val) ->
      Map.put(acc, String.trim(key), String.trim(val))

    {_key, _val}, acc ->
      acc
  end)
  |> Enum.reject(fn {key, val} -> key == "" or val == "" end)
  |> Map.new()
end

defp string_map_value(_value), do: nil
```

- Extend `validate!` or the workflow validation path so every source and destination in `completion_transitions` belongs to `Config.field_states()`. Return a clear `{:error, message}` listing invalid names.

- [ ] **Step 4: Run focused config tests and verify pass**

Run:

```bash
cd elixir && mise exec -- mix test test/symphony_elixir/github_config_test.exs
```

Expected: 0 failures.

---

## Task 2: Bootstrap and Metadata Use `Status` Only

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/bootstrap.ex`
- Modify: `elixir/lib/symphony_elixir/github/project_metadata.ex` only if metadata validation helpers are added
- Modify: `elixir/test/symphony_elixir/github/bootstrap_test.exs`

- [ ] **Step 1: Write failing bootstrap tests for existing Project `Status` metadata**

Update the existing-project test fixtures so GraphQL returns only:

```json
{
  "statusField": {
    "id": "PVTSSF_status",
    "name": "Status",
    "options": [
      { "id": "opt-todo", "name": "Todo" },
      { "id": "opt-review", "name": "Human Review" },
      { "id": "opt-rework", "name": "Rework" }
    ]
  }
}
```

Assert:

```elixir
assert metadata["status_field_id"] == "PVTSSF_status"
assert metadata["status_field_name"] == "Status"
assert metadata["state_options"]["Rework"] == "opt-rework"
refute Map.has_key?(metadata, "native_status_field_id")
refute Map.has_key?(metadata, "native_state_options")
```

Add a failure test where `Status` is missing:

```elixir
assert {:error, message} = Bootstrap.ensure_project(base_dir: base_dir, client_module: MissingStatusMock)
assert message =~ "Status"
assert message =~ "single-select"
```

- [ ] **Step 2: Run focused bootstrap tests and verify failure**

Run:

```bash
cd elixir && mise exec -- mix test test/symphony_elixir/github/bootstrap_test.exs
```

Expected: tests fail because bootstrap still queries `symphonyField` and writes native status metadata.

- [ ] **Step 3: Implement bootstrap changes**

Change the existing project query to resolve a single field:

```graphql
query SymphonyGitHubReadProject($projectId: ID!, $statusFieldName: String!) {
  node(id: $projectId) {
    ... on ProjectV2 {
      id
      number
      url
      statusField: field(name: $statusFieldName) {
        ... on ProjectV2SingleSelectField {
          id
          name
          options { id name }
        }
      }
    }
  }
}
```

Update `bootstrap_existing/1` to call `load_existing_project(client, project_id, "Status")` and build metadata from only `statusField`.

Update `bootstrap_auto/1` so it no longer logs "creating Symphony State field". The auto path should:

1. Create the project.
2. Resolve `Status`.
3. Cache `Status` metadata.
4. Run reconciliation to add/validate required options.

If GitHub Project auto-created boards do not expose `Status` in the response immediately, add a focused helper to load the project after creation before writing metadata.

- [ ] **Step 4: Run focused bootstrap tests and verify pass**

Run:

```bash
cd elixir && mise exec -- mix test test/symphony_elixir/github/bootstrap_test.exs
```

Expected: 0 failures.

---

## Task 3: Poll and Mutate Only the Project `Status` Field

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/client.ex`
- Modify: `elixir/test/symphony_elixir/github_client_test.exs`

- [ ] **Step 1: Write failing client tests for conflict and single mutation**

Add a polling test with both fields present:

```elixir
test "uses Status over stale Symphony State when both fields exist", %{base_dir: base_dir} do
  request_fun =
    poll_with_items([
      build_project_item_fixture(%{
        item_id: "PVTI_rework",
        issue_node_id: "I_rework",
        number: 507,
        title: "Rework item",
        repo: "owner/repo",
        labels: [%{"name" => "symphony:codex"}],
        field_values: [
          single_select_value("Status", "Rework"),
          single_select_value("Symphony State", "Human Review")
        ]
      })
    ])

  assert {:ok, [issue]} = Client.fetch_candidate_issues(base_dir: base_dir, request_fun: request_fun)
  assert issue.identifier == "507"
  assert issue.state == "Rework"
end
```

Add an update test where metadata contains only `status_field_id` and `state_options`; assert exactly one `SymphonyGitHubSetState` mutation is sent and the field ID is the cached `Status` field ID.

- [ ] **Step 2: Run focused client tests and verify failure**

Run:

```bash
cd elixir && mise exec -- mix test test/symphony_elixir/github_client_test.exs
```

Expected: conflict test fails because the client still prefers `Symphony State`; update test fails or sends two mutations because native sync still exists.

- [ ] **Step 3: Implement status-only polling and mutation**

In `resolve_issue_state/3`, remove custom/native fallback and labels-as-state fallback for workflow state. Keep labels only for agent routing. The function should effectively become:

```elixir
defp resolve_issue_state(item, status_field_name, _label_names) do
  extract_status_value(item, status_field_name)
end
```

Keep `status_field_name = metadata["status_field_name"] || GitHub.Config.status_field()` so cached metadata controls the field name.

Remove:

- `GitHub.Config.native_status_field()` fallback.
- `extract_state_from_labels/1` and `extract_symphony_state_label/1` if no callers remain.
- `sync_native_status_field/5`.
- `lookup_native_state_option_id/2`.
- Any tests that assert fallback to labels or native fields for workflow state.

In `set_project_state/6`, call `set_field_value/6` only once for `metadata["status_field_id"]`.

- [ ] **Step 4: Run focused client tests and verify pass**

Run:

```bash
cd elixir && mise exec -- mix test test/symphony_elixir/github_client_test.exs
```

Expected: 0 failures after updating/removing stale assertions.

---

## Task 4: Reconcile Required `Status` Options

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/state_reconciliation.ex`
- Modify: `elixir/test/symphony_elixir/github/state_reconciliation_test.exs`
- Modify: `elixir/docs/troubleshooting.md`

- [ ] **Step 1: Write failing reconciliation tests with `Status` wording**

Update tests so metadata uses:

```elixir
%{
  "project_id" => "PVT_abc",
  "project_url" => "https://github.com/orgs/clouapp/projects/2",
  "status_field_id" => "PVTSSF_status",
  "status_field_name" => "Status",
  "state_options" => %{"Todo" => "opt-todo"}
}
```

Assert missing options log:

```elixir
assert log =~ "Added Status option(s)"
```

Assert removed-in-use errors say:

```elixir
assert message =~ "Project Status"
assert message =~ "Move them to another state"
```

- [ ] **Step 2: Run focused reconciliation tests and verify failure**

Run:

```bash
cd elixir && mise exec -- mix test test/symphony_elixir/github/state_reconciliation_test.exs
```

Expected: failures still mention `Symphony State`.

- [ ] **Step 3: Update reconciliation implementation and docs**

Change logs/errors from `Symphony State` to `Status` or `Project Status`.

Keep matching by `field_id` and `status_field_name`; this remains correct for the built-in field:

```elixir
"field" => %{"id" => ^field_id, "name" => ^status_field_name}
```

In `elixir/docs/troubleshooting.md`, replace instructions about dropped `Symphony State` options with instructions about required Project `Status` options.

- [ ] **Step 4: Run focused reconciliation tests and verify pass**

Run:

```bash
cd elixir && mise exec -- mix test test/symphony_elixir/github/state_reconciliation_test.exs
```

Expected: 0 failures.

---

## Task 5: Add Completion Transitions After Normal Agent Completion

**Files:**
- Modify: `elixir/lib/symphony_elixir/orchestrator.ex`
- Modify: `elixir/test/symphony_elixir/orchestrator_status_test.exs`

- [ ] **Step 1: Write failing orchestrator tests for normal and failed exits**

Add a test that starts an orchestrator with a synthetic running entry, configures:

```yaml
agent:
  completion_transitions:
    In Progress: Human Review
```

Stub tracker behavior by adding test-only injectable functions if needed, or by extracting a private helper with `@doc false` wrapper for tests. The test should assert:

1. A `:normal` `{:DOWN, ref, :process, pid, :normal}` refreshes the issue state.
2. `Tracker.update_issue_state(issue.id, "Human Review")` is called.
3. The issue claim is released after successful transition so it does not immediately redispatch.

Add a second test for non-normal exit:

```elixir
send(pid, {:DOWN, process_ref, :process, worker_pid, :shutdown})
```

Assert no transition is attempted and the existing retry path remains scheduled.

- [ ] **Step 2: Run focused orchestrator tests and verify failure**

Run:

```bash
cd elixir && mise exec -- mix test test/symphony_elixir/orchestrator_status_test.exs
```

Expected: transition tests fail because normal completion currently schedules active-state continuation without applying a configured transition.

- [ ] **Step 3: Implement transition application**

Add a helper in `Orchestrator`:

```elixir
defp apply_completion_transition(%State{} = state, running_entry, issue_id) do
  transitions = Config.completion_transitions()

  with true <- map_size(transitions) > 0,
       {:ok, [%Issue{} = issue | _]} <- Tracker.fetch_issue_states_by_ids([issue_id]),
       destination when is_binary(destination) <- Map.get(transitions, issue.state) do
    case Tracker.update_issue_state(issue.id, destination) do
      :ok ->
        Logger.info("Moved issue after normal agent completion: #{issue_context(issue)} #{issue.state} -> #{destination}")
        {:transitioned, release_issue_claim(complete_issue(state, issue_id), issue_id)}

      {:error, reason} ->
        Logger.warning("Failed to move issue after normal completion: #{issue_context(issue)} #{issue.state} -> #{destination}: #{inspect(reason)}")
        {:error, reason}
    end
  else
    false -> :not_configured
    nil -> :not_configured
    {:ok, []} -> :not_visible
    {:error, reason} -> {:error, reason}
  end
end
```

Integrate it in the `:normal` branch of `handle_info({:DOWN, ...})` before scheduling the active-state continuation retry:

- `{:transitioned, state}`: do not schedule continuation.
- `:not_configured` or `:not_visible`: keep existing continuation behavior.
- `{:error, reason}`: schedule retry with an error message so the workflow update is not silently lost.

Use the existing `running_entry.identifier` for retry metadata.

- [ ] **Step 4: Run focused orchestrator tests and verify pass**

Run:

```bash
cd elixir && mise exec -- mix test test/symphony_elixir/orchestrator_status_test.exs
```

Expected: 0 failures.

---

## Task 6: Update Macro Markets Workflow, Examples, and Skill Guidance

**Files:**
- Modify: `elixir/WORKFLOW.macromarkets.example.md`
- Modify: `elixir/WORKFLOW.github.example.md`
- Modify: `elixir/README.md`
- Modify: `.codex/skills/github-projects/SKILL.md`
- Modify: `elixir/test/symphony_elixir/github_config_test.exs` or add a workflow parsing test if needed

- [ ] **Step 1: Write failing workflow/documentation guard tests**

Add a test that reads `elixir/WORKFLOW.macromarkets.example.md` and asserts:

```elixir
refute workflow_text =~ "status_field: Symphony State"
refute workflow_text =~ "native_status_field"
refute workflow_text =~ "sync_native_status"
assert workflow_text =~ "completion_transitions:"
assert workflow_text =~ "In Progress: Human Review"
assert workflow_text =~ "Rework: Human Review"
```

- [ ] **Step 2: Run focused docs/config guard tests and verify failure**

Run:

```bash
cd elixir && mise exec -- mix test test/symphony_elixir/github_config_test.exs
```

Expected: guard test fails because the Macro Markets workflow still references `Symphony State`.

- [ ] **Step 3: Update Macro Markets workflow**

In `elixir/WORKFLOW.macromarkets.example.md`, remove:

```yaml
  status_field: Symphony State
  native_status_field: Status
  sync_native_status: true
```

Add:

```yaml
agent:
  completion_transitions:
    Todo: Human Review
    In Progress: Human Review
    Rework: Human Review
    Merging: Done
```

Preserve existing `agent.max_concurrent_agents`, `agent.max_turns`, and Codex config by merging the new map into the existing `agent:` section rather than creating a duplicate section.

Replace prose:

- "Symphony State" -> "Project Status"
- "Symphony updates both..." -> "Symphony reads and updates the GitHub Project Status field."

- [ ] **Step 4: Update GitHub example, README, troubleshooting, and skill**

In `.codex/skills/github-projects/SKILL.md`, add a section:

```markdown
## Symphony Project Status Setup

Symphony expects the GitHub Project v2 `Status` single-select field to be the only workflow source of truth. Do not create or update a separate `Symphony State` field.

Recommended `Status` options:
- Backlog
- Todo
- In Progress
- Human Review
- Rework
- Merging
- Done
- Cancelled
- Duplicate

Inspect a project:

```bash
gh api graphql -f query='query ProjectFields($org: String!, $number: Int!) { organization(login: $org) { projectV2(number: $number) { id title fields(first: 100) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } ... on ProjectV2Field { id name dataType } } } } } }' -F org=clouapp -F number=2
```

Before starting Symphony, confirm `Status` exists and contains every option listed above. If an option is missing, add it in GitHub Project settings or use GraphQL field update when available.
```

Update `elixir/WORKFLOW.github.example.md` and `elixir/README.md` to say the GitHub Project `Status` field is the source of truth.

- [ ] **Step 5: Run focused guard tests and verify pass**

Run:

```bash
cd elixir && mise exec -- mix test test/symphony_elixir/github_config_test.exs
```

Expected: 0 failures.

---

## Task 7: Adjust the Current Macro Markets GitHub Project

**Files:**
- No repo files unless command output reveals a needed workflow/doc correction.
- GitHub Project: `https://github.com/orgs/clouapp/projects/2`
- Issue to verify: `clouapp/front#507`

- [ ] **Step 1: Inspect current Project fields and options**

Run:

```bash
gh api graphql -f query='query ProjectFields($org: String!, $number: Int!) { organization(login: $org) { projectV2(number: $number) { id title fields(first: 100) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } ... on ProjectV2Field { id name dataType } } } } } }' -F org=clouapp -F number=2
```

Expected:

- Project title is `Macro Markets`.
- `Status` exists as a single-select field.
- `Status` includes `Backlog`, `Todo`, `In Progress`, `Human Review`, `Rework`, `Merging`, `Done`, `Cancelled`, and `Duplicate`.
- Capture the `Status` field ID and any `Symphony State` field ID.

- [ ] **Step 2: Add missing `Status` options if any are absent**

If the inspection shows missing `Status` options, run a GraphQL `updateProjectV2Field` mutation with the current option IDs preserved and new missing option names added.

Use the same shape as `StateReconciliation`:

```bash
gh api graphql -f query='mutation UpdateStatusOptions($input: UpdateProjectV2FieldInput!) { updateProjectV2Field(input: $input) { projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name } } } } }' -F input='{"fieldId":"<STATUS_FIELD_ID>","singleSelectOptions":[{"id":"<existing-id>","name":"Backlog","color":"GRAY","description":"Backlog"},{"name":"Missing State","color":"GRAY","description":"Missing State"}]}'
```

Expected: mutation returns the updated `Status` field with every required option. If GitHub rejects option updates for the built-in field, stop and add the missing statuses manually in the GitHub Project settings, then rerun Step 1.

- [ ] **Step 3: Verify the current problematic issue is controlled by `Status`**

Run:

```bash
gh api graphql -f query='query IssueProjectState($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { issue(number: $number) { id number title state url projectItems(first: 20) { nodes { id databaseId project { title number url } fieldValues(first: 50) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { id name } } } ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2Field { name } ... on ProjectV2SingleSelectField { name } } } } } } } } } }' -F owner=clouapp -F repo=front -F number=507
```

Expected:

- The item belongs to `Macro Markets`.
- `Status` is `Rework`.
- Any stale `Symphony State` value is ignored by the new code.

If `Status` is not `Rework`, update the item `Status` to `Rework` using `updateProjectV2ItemFieldValue` with the `Status` field ID and `Rework` option ID.

- [ ] **Step 4: Remove the obsolete `Symphony State` field from Macro Markets after code verification**

After Tasks 1-6 pass and the status-only runtime has been verified, remove the stale field so humans cannot update it accidentally again.

First inspect the field ID from Step 1. Then try:

```bash
gh api graphql -f query='mutation DeleteProjectField($fieldId: ID!) { deleteProjectV2Field(input: { fieldId: $fieldId }) { projectV2Field { id name } } }' -F fieldId=<SYMPHONY_STATE_FIELD_ID>
```

Expected: the mutation deletes `Symphony State` or returns a clear GitHub error. If deletion is rejected, leave the field unused and document in the final handoff that the field should be removed manually from the Project settings.

- [ ] **Step 5: Refresh local metadata and restart Symphony against Macro Markets**

Remove stale cached metadata if present in the runtime base directory:

```bash
cd elixir && rm -f .symphony/github-project.json
```

Restart the Macro Markets Symphony process with:

```bash
cd elixir && set -a; source .env; set +a; GITHUB_TOKEN="$(gh auth token)" mise exec -- mix run --no-start -e 'SymphonyElixir.CLI.main(["--i-understand-that-this-will-be-running-without-the-usual-guardrails", "--logs-root", "~/symphony-logs", "--port", "4000", "./WORKFLOW.macromarkets.example.md"])'
```

Expected:

- Startup validates `Status`.
- Dashboard shows `http://127.0.0.1:4000/`.
- `front#507` is seen as `Rework` if it is still active and routed to this worker.

Do not run duplicate long-lived servers on port `4000`; check existing terminal/server state before starting.

---

## Task 8: End-to-End Verification

**Files:**
- All touched Elixir files.
- Macro Markets Project state in GitHub.

- [ ] **Step 1: Run focused backend suites**

Run:

```bash
cd elixir && mise exec -- mix test \
  test/symphony_elixir/github_config_test.exs \
  test/symphony_elixir/github/bootstrap_test.exs \
  test/symphony_elixir/github/state_reconciliation_test.exs \
  test/symphony_elixir/github_client_test.exs \
  test/symphony_elixir/orchestrator_status_test.exs
```

Expected: 0 failures.

- [ ] **Step 2: Run formatting and specs checks for Elixir**

Run:

```bash
cd elixir && mise exec -- mix format --check-formatted
cd elixir && mise exec -- mix specs.check
```

Expected: both commands exit 0.

- [ ] **Step 3: Run broader Elixir tests**

Run:

```bash
cd elixir && mise exec -- mix test
```

Expected: 0 failures.

- [ ] **Step 4: Verify GitHub Project state after migration**

Repeat the Project field inspection:

```bash
gh api graphql -f query='query ProjectFields($org: String!, $number: Int!) { organization(login: $org) { projectV2(number: $number) { id title fields(first: 100) { nodes { ... on ProjectV2SingleSelectField { name options { name } } ... on ProjectV2Field { name dataType } } } } } }' -F org=clouapp -F number=2
```

Expected:

- `Status` contains the required workflow states.
- `Symphony State` is absent, or the final handoff explicitly says GitHub rejected deletion and it remains unused.

- [ ] **Step 5: Verify no runtime references remain**

Run:

```bash
rg "Symphony State|native_status_field|sync_native_status" elixir/lib elixir/README.md elixir/WORKFLOW.github.example.md elixir/WORKFLOW.macromarkets.example.md .codex/skills/github-projects/SKILL.md
```

Expected: no runtime/config guidance references remain. Historical specs under `docs/superpowers/specs/` may still mention the old design and do not need to be rewritten.

---

## Self-Review

- Spec requirement "poll issues by Project Status" is covered by Task 3.
- Spec requirement "move issues by Project Status only" is covered by Task 3.
- Spec requirement "remove Symphony State creation/fallback/sync/docs" is covered by Tasks 2, 3, 4, 6, and 8.
- Spec requirement "update Macro Markets workflow config" is covered by Task 6.
- Spec requirement "document recommended GitHub setup in the skill" is covered by Task 6.
- Spec requirement "completion transitions after normal execution" is covered by Tasks 1 and 5.
- User requirement "adjust the current Macro Markets project ourselves" is covered by Task 7.
- The plan avoids commits because the user has not requested a git commit.
