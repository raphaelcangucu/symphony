# Preview ↔ Chat Port Sync Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in this chat with checkpoints after each task.
>
> **WSL:** Run **one** narrowly targeted test file or filter at a time. Never full/batch suites. Ask before expanding scope.

**Goal:** Make `manage_preview` / `DevServerRecord` the **preferred** (not exclusive) port/URL path for agents via prompt policy + light tool enrichment, with explicit fallback when Preview fails.

**Architecture:** No lease/schema/SSE changes. Update `PromptBuilder.preview_context_section/1` copy and local health URL resolution; extend `PreviewTools` / `ListPreviewTools` descriptions and `next_steps` so healthy status points at dock ports and unhealthy status allows project-script fallback. Advising GraphQL/serve-script tweaks stay **out of this plan** (project repo only).

**Tech Stack:** Elixir (`SymphonyElixir`), ExUnit, existing `manage_preview` / `list_previews` tools.

**Spec:** [`docs/superpowers/specs/2026-07-15-preview-chat-port-sync-design.md`](../specs/2026-07-15-preview-chat-port-sync-design.md)

---

## File map

| File | Role |
| --- | --- |
| `elixir/lib/symphony_elixir/prompt_builder.ex` | Preferred-path + fallback + mid-turn `status` guidance; local URL from `ready_path`/`url_path` when present on server map |
| `elixir/test/symphony_elixir/prompt_builder_test.exs` | Assert new prompt contract |
| `elixir/lib/symphony_elixir/assistant/preview_tools.ex` | Tool description; preferred-path / fallback `next_steps`; `local_url` from matching serve step `ready_path` then `url_path` |
| `elixir/test/symphony_elixir/assistant/preview_tools_test.exs` | Assert description + `next_steps` + `local_url` from step |
| `elixir/lib/symphony_elixir/assistant/list_preview_tools.ex` | Description + `next_steps` align with preferred/fallback |
| `elixir/test/symphony_elixir/assistant/list_preview_tools_test.exs` | Assert copy |
| `elixir/lib/symphony_elixir/assistant/agent_session.ex` | One-line board/tool blurbs: prefer Preview, fallback OK |

**Out of scope files:** DevEnv schema/migrations, `DevServer.Manager`, Tracker UI, Advising repo serve scripts.

---

### Task 1: PromptBuilder preferred-path contract

**Files:**
- Modify: `elixir/lib/symphony_elixir/prompt_builder.ex` (`format_preview_context/3`, `local_preview_url/1`)
- Test: `elixir/test/symphony_elixir/prompt_builder_test.exs`

- [ ] **Step 1: Write the failing tests**

Add to `elixir/test/symphony_elixir/prompt_builder_test.exs`:

```elixir
test "preview_context_section prefers manage_preview, mid-turn status, and fallback" do
  issue = %Issue{
    identifier: "#1",
    project_slug: "mac",
    title: "T",
    description: "d",
    state: "In Progress"
  }

  section = PromptBuilder.preview_context_section(issue)

  assert section =~ "## Issue preview (Symphony)"
  assert section =~ "prefer"
  assert section =~ "manage_preview"
  assert section =~ ~r/fall\s*back/i
  assert section =~ "status"
  refute section =~ "run-e2e.sh"
end

test "local_preview_url uses ready_path when present on server map" do
  assert PromptBuilder.local_preview_url_for_tests(%{
           slug: "advising",
           port: 4300,
           ready_path: "/health"
         }) == "http://127.0.0.1:4300/health"

  assert PromptBuilder.local_preview_url_for_tests(%{
           slug: "api",
           port: 4200
         }) == "http://127.0.0.1:4200/api/health"

  assert PromptBuilder.local_preview_url_for_tests(%{
           slug: "distributionmachine-admin",
           port: 4201
         }) == "http://127.0.0.1:4201/"
end
```

- [ ] **Step 2: Run the new tests (expect fail)**

From `elixir/`:

```bash
mix test test/symphony_elixir/prompt_builder_test.exs --trace 2>&1 | rg -n "prefer manage_preview|local_preview_url uses ready_path|FAIL|Error|undefined"
```

Expected: FAIL — missing phrases and/or `local_preview_url_for_tests/1` undefined.

- [ ] **Step 3: Implement prompt + URL helper**

In `prompt_builder.ex`:

1. Add a thin test seam:

```elixir
@doc false
@spec local_preview_url_for_tests(map()) :: String.t()
def local_preview_url_for_tests(server) when is_map(server), do: local_preview_url(server)
```

2. Replace `format_preview_context/3` guidance with:

```elixir
"""
## Issue preview (Symphony)

#{availability}

**Preferred path:** when Preview is available, prefer `manage_preview` (`status` | `start` | `restart`) to bring up this issue's app so chat stays aligned with the Preview dock. Do not invent ports while still on the Preview path.

**Mid-turn:** before citing a port or running HTTP checks while using Preview, call `manage_preview` with `action: status` again (or trust the latest `start`/`restart` tool result).

**Fallback:** if Preview fails, stays crashed, or never reaches `ready` after reasonable `status`/`restart`/`output` self-heal, fall back to a convenient project bring-up path, cite the ports actually serving traffic, and note the dock may be stale until a later best-effort `manage_preview restart`. Do not block the run on Preview. Never retry a failing preview in a tight loop.

Do **not** run bare `npx playwright test` on random ports — use the project's configured e2e command (see the `evidence` config / project workflow), which reuses the preview ports below when Preview is healthy.

#{if server_lines == "", do: "_No preview servers registered yet — call `manage_preview` with `start`._", else: server_lines}

Project: `#{project_slug}` · Issue: `#{identifier}`
"""
```

3. Update `local_preview_url/1`:

```elixir
defp local_preview_url(server) when is_map(server) do
  port = Map.get(server, :port) || Map.get(server, "port")
  slug = to_string(Map.get(server, :slug) || Map.get(server, "slug") || "")
  ready_path = Map.get(server, :ready_path) || Map.get(server, "ready_path")
  url_path = Map.get(server, :url_path) || Map.get(server, "url_path")

  cond do
    not is_integer(port) or port <= 0 ->
      "n/a"

    is_binary(ready_path) and ready_path != "" ->
      "http://127.0.0.1:#{port}#{normalize_preview_path(ready_path)}"

    is_binary(url_path) and url_path != "" ->
      "http://127.0.0.1:#{port}#{normalize_preview_path(url_path)}"

    String.contains?(slug, "admin") ->
      "http://127.0.0.1:#{port}/"

    true ->
      "http://127.0.0.1:#{port}/api/health"
  end
end

defp normalize_preview_path("/" <> _ = path), do: path
defp normalize_preview_path(path) when is_binary(path), do: "/" <> path
defp normalize_preview_path(_), do: "/"
```

**Note:** `issue_targets` servers may not include `ready_path` yet. The helper still works; Task 2 attaches paths when enriching tool views. Prompt lines keep admin/`/api/health` fallbacks when fields are absent.

- [ ] **Step 4: Run the same targeted tests (expect pass)**

```bash
mix test test/symphony_elixir/prompt_builder_test.exs --trace 2>&1 | rg -n "prefer manage_preview|local_preview_url uses ready_path|FAIL|Error|Finished"
```

Expected: those two tests PASS. Do not expand to full suite.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/prompt_builder.ex elixir/test/symphony_elixir/prompt_builder_test.exs
git commit -m "$(cat <<'EOF'
Prefer manage_preview in agent preview prompts with explicit fallback.

EOF
)"
```

---

### Task 2: `manage_preview` preferred-path enrichment + serve-step local URLs

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/preview_tools.ex`
- Test: `elixir/test/symphony_elixir/assistant/preview_tools_test.exs`

- [ ] **Step 1: Write the failing tests**

Add to `preview_tools_test.exs` (mirror existing crash-start injectable names from that file when wiring `start`):

```elixir
test "tool description prefers Preview ports and allows fallback" do
  for spec <- PreviewTools.tool_specs() do
    desc = spec["description"]
    assert desc =~ ~r/prefer/i
    assert desc =~ ~r/fall\s*back/i
  end
end

test "status next_steps or message mention preferred dock ports when healthy" do
  issue = %Issue{id: "1", identifier: "DEMO-1", project_slug: "demo"}

  assert {:ok, result} =
           PreviewTools.execute("demo", %{"action" => "status"},
             issue: issue,
             issue_targets: fn _slug, _id ->
               {:ok,
                %{
                  available: true,
                  reason: nil,
                  servers: [%{slug: "web", status: "ready", port: 4300, primary: true}]
                }}
             end,
             list_serve_steps: fn _slug ->
               [%{role: "serve", slug: "web", ready_path: "/health", url_path: "/"}]
             end
           )

  combined = result.message <> " " <> to_string(result.data.next_steps)
  assert combined =~ ~r/prefer/i or combined =~ ~r/dock/i
  assert combined =~ "Preview" or combined =~ "preview"
end

test "crashed next_steps allow project-script fallback" do
  issue = %Issue{id: "1", identifier: "DEMO-1", project_slug: "demo"}

  assert {:ok, result} =
           PreviewTools.execute("demo", %{"action" => "start"},
             issue: issue,
             start_for_issue: fn _slug, _id, _opts -> {:error, :crashed} end,
             issue_targets: fn _slug, _id ->
               {:ok,
                %{
                  available: true,
                  reason: nil,
                  servers: [%{slug: "web", status: "crashed", port: 4300, primary: true}]
                }}
             end,
             list_serve_steps: fn _slug -> [%{role: "serve"}] end,
             capture_output: fn _, _, _ -> {:ok, %{output: ""}} end
           )

  assert result.data.next_steps =~ ~r/fall\s*back/i
end

test "enrich_view local_url uses serve step ready_path" do
  view = %{
    available: true,
    reason: nil,
    servers: [%{slug: "web", status: "ready", port: 4300, primary: true}]
  }

  enriched =
    PreviewTools.enrich_view("demo", view, fn _slug ->
      [%{role: "serve", slug: "web", ready_path: "/health", url_path: "/"}]
    end)

  [server] = enriched.servers
  assert server.local_url == "http://127.0.0.1:4300/health"
end
```

If `start_for_issue` is not the injectable used by existing tests, copy the exact opts from the nearest crashed-start test in the same file.

- [ ] **Step 2: Run targeted tests (expect fail)**

```bash
mix test test/symphony_elixir/assistant/preview_tools_test.exs --trace 2>&1 | rg -n "tool description prefers|preferred dock|project-script fallback|ready_path|FAIL|Error"
```

Expected: FAIL on new assertions.

- [ ] **Step 3: Implement**

1. Update `@tool_description`:

```elixir
@tool_description """
Inspect or control the issue Preview dock (preferred ports/URLs for this issue).
Actions: status|start|stop|restart|output.
Optional `server` (slug or id) scopes start/stop/restart/status/output to one process.
Prefer these ports while Preview is healthy. On failure, read `reason`, `output_tail`, and `next_steps` to self-heal (fix code, manage_dev_env, restart); if Preview still cannot reach ready, fall back to a convenient project bring-up path (dock may lag).
"""
```

2. Update attributes:

```elixir
@preferred_ports_next_steps "These ports/URLs match the Preview dock — prefer them while Preview is healthy. Before citing ports mid-turn, re-call manage_preview status."

@not_ready_next_steps "Preview is not ready. Self-heal with manage_preview output/restart/status and manage_dev_env if needed. If it still cannot reach ready, fall back to a convenient project bring-up path, cite the ports actually in use, and note the dock may be stale. Do not block the run or tight-loop retries."
```

Keep `@starting_next_steps` and `@lock_next_steps` unless you also want fallback wording on lock (optional; not required).

3. In `enrich_view/3`, when `available == true`, `reason` is nil, and no server status is `"crashed"`, set `next_steps` to `@preferred_ports_next_steps`. Preserve existing `:no_serve_step` / `:workspace_missing` / `:disabled` hints.

4. Status message example: `"Preview status for #{identifier} (preferred Preview dock ports)."`

5. Pass serve steps into server enrichment:

```elixir
defp enrich_servers(servers, serve_steps) when is_list(servers) do
  Enum.map(servers, &enrich_server(&1, serve_steps))
end

defp enrich_server(server, serve_steps) when is_map(server) do
  port = Map.get(server, :port) || Map.get(server, "port")
  slug = to_string(Map.get(server, :slug) || Map.get(server, "slug") || "")
  step = find_serve_step(serve_steps, slug)
  ready_path = step_field(step, :ready_path)
  url_path = step_field(step, :url_path)
  public_url =
    Map.get(server, :public_url) || Map.get(server, "public_url") || Map.get(server, :url) ||
      Map.get(server, "url")

  local_url =
    cond do
      not is_integer(port) or port <= 0 ->
        nil

      is_binary(ready_path) and ready_path != "" ->
        "http://127.0.0.1:#{port}#{normalize_path(ready_path)}"

      is_binary(url_path) and url_path != "" ->
        "http://127.0.0.1:#{port}#{normalize_path(url_path)}"

      String.contains?(slug, "admin") ->
        "http://127.0.0.1:#{port}/"

      true ->
        "http://127.0.0.1:#{port}/api/health"
    end

  server
  |> Map.put(:local_url, local_url)
  |> maybe_put_public_url(public_url)
end

defp find_serve_step(steps, slug) when is_list(steps) and is_binary(slug) do
  Enum.find(steps, fn step ->
    step_slug = step_field(step, :slug)
    is_binary(step_slug) and step_slug == slug
  end)
end

defp find_serve_step(_steps, _slug), do: nil

defp step_field(nil, _key), do: nil

defp step_field(step, key) when is_map(step) do
  Map.get(step, key) || Map.get(step, Atom.to_string(key))
end

defp normalize_path("/" <> _ = path), do: path
defp normalize_path(path) when is_binary(path), do: "/" <> path
defp normalize_path(_), do: "/"
```

If serve steps lack `slug`, keep the admin/`/api/health` heuristics (do not invent fragile matching).

6. Crashed/failed paths already use `@not_ready_next_steps` via `apply_start_next_steps` / `apply_failed_next_steps` — updating the attribute is enough.

- [ ] **Step 4: Run targeted tests (expect pass)**

```bash
mix test test/symphony_elixir/assistant/preview_tools_test.exs --trace 2>&1 | rg -n "FAIL|Error|Finished"
```

Expected: PASS for this file. If an unrelated pre-existing failure appears, stop and report.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/preview_tools.ex elixir/test/symphony_elixir/assistant/preview_tools_test.exs
git commit -m "$(cat <<'EOF'
Enrich manage_preview with preferred dock ports and fallback next_steps.

EOF
)"
```

---

### Task 3: `list_previews` copy alignment

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/list_preview_tools.ex`
- Test: `elixir/test/symphony_elixir/assistant/list_preview_tools_test.exs`

- [ ] **Step 1: Write the failing tests**

```elixir
test "tool description prefers manage_preview ports and mentions fallback" do
  spec = ListPreviewTools.assistant_tool_spec()
  desc = spec["description"]
  assert desc =~ "manage_preview"
  assert desc =~ ~r/prefer/i or desc =~ "Preview"
  assert desc =~ ~r/fall\s*back/i
end

test "next_steps allow fallback when previews are unhealthy" do
  assert {:ok, result} =
           ListPreviewTools.execute("demo", %{},
             running_issue_keys: fn -> [{"demo", "DEMO-1"}] end,
             issue_targets: fn _slug, _id ->
               {:ok,
                %{
                  available: true,
                  reason: nil,
                  servers: [%{slug: "web", status: "crashed", port: 4300}]
                }}
             end,
             tunnel_summary: fn _ -> %{enabled: false, running: false} end
           )

  assert result.data.next_steps =~ "manage_preview"
  assert result.data.next_steps =~ ~r/fall\s*back/i
end
```

Mirror existing injectables in `list_preview_tools_test.exs` if names differ.

- [ ] **Step 2: Run targeted tests (expect fail)**

```bash
mix test test/symphony_elixir/assistant/list_preview_tools_test.exs --trace 2>&1 | rg -n "preferred|fallback|FAIL|Error"
```

- [ ] **Step 3: Implement**

```elixir
"description" =>
  "List active issue previews for the current project (preferred Preview dock status, ports, URLs, tunnel). Use manage_preview to act; if Preview cannot be healed, fall back to project bring-up is allowed.",

@next_steps
  "Inspect unhealthy entries with manage_preview status/output, then restart or fix via manage_dev_env. If Preview still cannot reach ready, fall back to a convenient project bring-up path (dock may lag)."
```

Only change the unhealthy `next_steps` string if healthy cases currently return a different value.

- [ ] **Step 4: Run targeted tests (expect pass)**

```bash
mix test test/symphony_elixir/assistant/list_preview_tools_test.exs --trace 2>&1 | rg -n "FAIL|Error|Finished"
```

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/list_preview_tools.ex elixir/test/symphony_elixir/assistant/list_preview_tools_test.exs
git commit -m "$(cat <<'EOF'
Align list_previews copy with preferred Preview path and fallback.

EOF
)"
```

---

### Task 4: Agent session board blurbs

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/agent_session.ex` (preview sentences ~360–362 and ~920–924)
- Test: update assertion only if an existing test pins the exact blurb string

- [ ] **Step 1: Locate exact strings**

```bash
rg -n "For preview:|manage_preview start" elixir/lib/symphony_elixir/assistant/agent_session.ex
```

- [ ] **Step 2: Update blurbs**

Replace preview guidance sentences with:

```text
For preview: prefer manage_preview status/start/restart (ports match the Preview dock); on crash use output then restart; if Preview cannot reach ready, fall back to a convenient project bring-up path. Use list_previews to inventory and manage_tunnel start for public links.
```

Keep tool name lists unchanged.

- [ ] **Step 3: Run a single related test only if one asserts the blurb**

```bash
rg -n "For preview|manage_preview" elixir/test/symphony_elixir/assistant/agent_session_test.exs
```

If a pinned string exists, update it and run that single test file. Otherwise skip the run.

- [ ] **Step 4: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/agent_session.ex
git commit -m "$(cat <<'EOF'
Mention preferred Preview path and fallback in assistant board blurbs.

EOF
)"
```

---

### Task 5: Docs verify (no Symphony GraphQL generalization)

**Files:**
- `docs/superpowers/specs/2026-07-15-preview-chat-port-sync-design.md` (status: Approved for planning)
- This plan

- [ ] **Step 1: Confirm non-goals in the PR diff**

Diff must **not** include:

- DevEnv migrations / `exists` field
- `DevServer.Manager` start filtering for optional GraphQL
- Advising repo serve scripts
- SSE→LLM wiring

- [ ] **Step 2: Optional human smoke**

On an issue with Preview available: `manage_preview status` should mention preferred dock ports; crash/`not ready` path should mention fallback.

- [ ] **Step 3: Commit docs if needed**

```bash
git add docs/superpowers/specs/2026-07-15-preview-chat-port-sync-design.md docs/superpowers/plans/2026-07-15-preview-chat-port-sync-plan.md
git commit -m "$(cat <<'EOF'
Approve preview chat port-sync spec and add implementation plan.

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Preferred (not sole) port source | 1, 2, 3, 4 |
| Prefer `manage_preview start` when available | 1, 4 |
| Mid-turn re-`status` | 1, 2 |
| Fallback after failure | 1, 2, 3, 4 |
| Prefer `ready_path`/`url_path` for local health URLs | 1, 2 |
| Availability gate unchanged | intentional no-op |
| No GraphQL/`exists` in Symphony | Task 5 verify |
| Advising serve scripts | **Out of plan** — separate Advising PR |

## Placeholder / consistency self-review

- No TBD steps; Advising work explicitly deferred.
- `local_url` / `ready_path` naming consistent across Tasks 1–2.
- Task 2 crash injectable names must match existing `preview_tools_test.exs` stubs at implement time.
- WSL: one targeted `mix test` path/filter per step.
