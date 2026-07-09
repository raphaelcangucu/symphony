# Preview Layout + Assistant Preview Tools — Implementation Plan

**Goal:** Compact the shared Preview management UI and give assistants structured tools to list, control, diagnose, and tunnel-manage issue previews so they can self-heal crashes.

**Architecture:** Extend `SymphonyElixir.Assistant.PreviewTools` for per-server actions + bounded `output` with an actionable error contract; add thin `ListPreviewTools` and `TunnelTools` modules registered in `ToolExecutor` / `DynamicTool`. Redesign `PreviewPanel` (status strip → primary CTA → compact server rows → on-demand logs) without changing REST/SSE contracts.

**Tech Stack:** Elixir 1.19 / OTP 28, ExUnit, React + Vitest + i18next, existing `DevServer.Manager`, `Cloudflare.Tunnel`, `useIssueDevServers`.

**Spec:** `docs/superpowers/specs/2026-07-09-preview-layout-and-assistant-tools-design.md`

**Out of scope:** Live SSE through tools, serve-step authoring (`manage_dev_env`), iframe chrome changes, daemon boot, inventing tunnel stop if backend has none.

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `elixir/lib/symphony_elixir/assistant/preview_tools.ex` | Modify | `server`, `output`, `output_tail`, public URLs, error contract |
| `elixir/test/symphony_elixir/assistant/preview_tools_test.exs` | Modify | Per-server / output / error tests |
| `elixir/lib/symphony_elixir/assistant/list_preview_tools.ex` | Create | `list_previews` |
| `elixir/test/symphony_elixir/assistant/list_preview_tools_test.exs` | Create | Inventory tests |
| `elixir/lib/symphony_elixir/assistant/tunnel_tools.ex` | Create | `manage_tunnel` |
| `elixir/test/symphony_elixir/assistant/tunnel_tools_test.exs` | Create | Status/start/unsupported stop |
| `elixir/lib/symphony_elixir/assistant/tool_executor.ex` | Modify | Register + dispatch new tools |
| `elixir/lib/symphony_elixir/codex/dynamic_tool.ex` | Modify | Issue-bound specs if needed |
| `elixir/lib/symphony_elixir/assistant/agent_session.ex` | Modify | Tool blurbs / prompts |
| `elixir/lib/symphony_elixir/assistant/project_board_tools.ex` | Modify | Freeform exposure if required |
| `tracker/src/components/issues/issue-detail/PreviewTab.tsx` | Modify | Compact `PreviewPanel` layout |
| `tracker/src/components/issues/issue-detail/DevServerOutputPanel.tsx` | Modify | Error-only when load fails (no empty pre) |
| `tracker/src/components/issues/issue-detail/__tests__/PreviewTab.test.tsx` | Modify | New layout assertions |
| `tracker/locales/en/tracker.json` | Modify | New copy keys if needed |
| `tracker/locales/pt-BR/tracker.json` | Modify | Matching PT strings |

---

### Task 1: `manage_preview` — per-server actions + `output`

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/preview_tools.ex`
- Modify: `elixir/test/symphony_elixir/assistant/preview_tools_test.exs`

- [ ] **Step 1: Write failing tests for `server` + `output`**

Append to `preview_tools_test.exs`:

```elixir
test "start with server slug targets one instance" do
  issue = %Issue{id: "1", identifier: "DEMO-1", project_slug: "demo"}
  started = Agent.start_link(fn -> nil end) |> elem(1)

  assert {:ok, result} =
           PreviewTools.execute("demo", %{"action" => "start", "server" => "front"},
             issue: issue,
             start_instance: fn slug, id, server_id ->
               Agent.update(started, fn _ -> {slug, id, server_id} end)
               {:ok, self()}
             end,
             issue_targets: fn _slug, _id ->
               {:ok,
                %{
                  available: true,
                  reason: nil,
                  servers: [
                    %{id: 7, slug: "front", status: "starting", port: 4101, primary: true},
                    %{id: 8, slug: "back", status: "stopped", port: 4100}
                  ]
                }}
             end,
             list_serve_steps: fn _ -> [%{role: "serve"}] end
           )

  assert Agent.get(started, & &1) == {"demo", "DEMO-1", 7}
  assert result.tool == "manage_preview"
  assert Enum.any?(result.data.servers, &(&1.slug == "front"))
end

test "output returns bounded output_tail for a server" do
  issue = %Issue{id: "1", identifier: "DEMO-1", project_slug: "demo"}

  assert {:ok, result} =
           PreviewTools.execute("demo", %{"action" => "output", "server" => "front"},
             issue: issue,
             issue_targets: fn _, _ ->
               {:ok,
                %{
                  available: true,
                  reason: nil,
                  servers: [%{id: 7, slug: "front", status: "crashed", port: 4101, primary: true}]
                }}
             end,
             capture_output: fn _slug, _id, 7 ->
               {:ok, %{output: "boom\nstack\n", session_name: "sym-dev-demo-DEMO-1-front"}}
             end,
             list_serve_steps: fn _ -> [%{role: "serve"}] end
           )

  assert result.data.reason == "crashed" or is_binary(result.data.output_tail)
  assert result.data.output_tail =~ "boom"
  assert result.data.server.slug == "front"
  assert is_binary(result.data.next_steps)
end

test "output without server returns structured invalid args" do
  issue = %Issue{id: "1", identifier: "DEMO-1", project_slug: "demo"}

  assert {:error, {:invalid_preview_arguments, _}} =
           PreviewTools.execute("demo", %{"action" => "output"}, issue: issue)
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd elixir && mix test test/symphony_elixir/assistant/preview_tools_test.exs --only line:REPLACE
```

Or full file:

```bash
cd elixir && mix test test/symphony_elixir/assistant/preview_tools_test.exs
```

Expected: FAIL — unknown action `output` / unused `server` / missing injectables.

- [ ] **Step 3: Extend schema + normalize actions**

In `preview_tools.ex`:

```elixir
@output_tail_max_lines 100
@tool_description """
Inspect or control the issue dev-server preview.
Actions: status|start|stop|restart|output.
Optional `server` (slug or id) scopes start/stop/restart/status/output to one process.
On failure, read `reason`, `output_tail`, and `next_steps` to self-heal (fix code, manage_dev_env, restart).
"""

defp preview_action_schema do
  %{
    "type" => "string",
    "enum" => ["status", "start", "stop", "restart", "output"],
    "description" => "Preview action. Use output with server to read command logs."
  }
end

# In assistant_tool_spec / issue_bound_tool_spec properties, add:
"server" => %{
  "type" => "string",
  "description" => "Optional server slug (front) or numeric id."
}
```

Update `@description` / `tool_spec` callers to use `@tool_description`.

- [ ] **Step 4: Resolve server + dispatch per-server / output**

```elixir
defp execute_action(project_slug, identifier, action, issue_targets, list_serve_steps, opts) do
  server_arg = Map.get(Keyword.get(opts, :arguments, %{}), "server") || opts[:server_arg]

  # Prefer reading from the original arguments map passed into execute/3:
end
```

Wire cleanly by threading `arguments` into `execute_action`:

```elixir
def execute(project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
  issue_targets = Keyword.get(opts, :issue_targets, &DevServer.issue_targets/2)
  list_serve_steps = Keyword.get(opts, :list_serve_steps, &DevEnv.list_serve_steps/1)

  with {:ok, identifier} <- resolve_identifier(project_slug, arguments, opts),
       {:ok, action} <- normalize_preview_action(Map.get(arguments, "action")) do
    execute_action(project_slug, identifier, action, arguments, issue_targets, list_serve_steps, opts)
  end
end

defp normalize_preview_action(action) when is_binary(action) do
  case String.trim(action) |> String.downcase() do
    "status" -> {:ok, :status}
    "start" -> {:ok, :start}
    "stop" -> {:ok, :stop}
    "restart" -> {:ok, :restart}
    "output" -> {:ok, :output}
    other -> {:error, {:invalid_preview_action, other}}
  end
end

defp resolve_server(view, server_arg) when is_binary(server_arg) do
  servers = Map.get(view, :servers) || Map.get(view, "servers") || []
  trimmed = String.trim(server_arg)

  cond do
    trimmed == "" -> {:error, :server_required}
    match?({id, ""}, Integer.parse(trimmed)) ->
      {id, _} = Integer.parse(trimmed)
      find_server(servers, fn s -> server_field(s, :id) == id end)
    true ->
      find_server(servers, fn s -> server_field(s, :slug) == trimmed end)
  end
end

defp resolve_server(_view, nil), do: :all
defp resolve_server(_view, _), do: {:error, :invalid_server}

defp find_server(servers, pred) do
  case Enum.find(servers, pred) do
    nil -> {:error, :server_not_found}
    server -> {:ok, server}
  end
end

defp server_field(server, key) when is_map(server) do
  Map.get(server, key) || Map.get(server, Atom.to_string(key))
end
```

For `:start` / `:stop` / `:restart` when `resolve_server` returns `{:ok, server}`, call:

- `Keyword.get(opts, :start_instance, &Manager.start_instance_for_server/3)`
- `stop_instance` / `restart_instance` similarly

with `(project_slug, identifier, server_field(server, :id))`.

For `:output`:

```elixir
defp execute_action(project_slug, identifier, :output, arguments, issue_targets, list_serve_steps, opts) do
  capture = Keyword.get(opts, :capture_output, &Manager.capture_server_output/3)

  with {:ok, view} <- issue_targets.(project_slug, identifier),
       {:ok, server} <- resolve_server(view, Map.get(arguments, "server")),
       server_id when is_integer(server_id) <- server_field(server, :id) do
    case capture.(project_slug, identifier, server_id) do
      {:ok, %{output: output}} ->
        tail = tail_output(output)

        {:ok,
         %{
           tool: @tool,
           message: "Command output for #{server_field(server, :slug)} on #{identifier}.",
           data: %{
             available: Map.get(view, :available),
             reason: status_reason(server_field(server, :status)),
             server: enrich_server(server),
             output_tail: tail,
             next_steps: output_next_steps(server_field(server, :status))
           }
         }}

      {:error, :not_found} ->
        {:error, :server_not_found}

      {:error, message} when is_binary(message) ->
        {:ok,
         %{
           tool: @tool,
           message: "Could not read output for #{server_field(server, :slug)}.",
           data: %{
             ok: false,
             reason: "output_unavailable",
             server: enrich_server(server),
             output_tail: nil,
             next_steps: "Retry manage_preview output, or inspect the Preview dock logs."
           }
         }}
    end
  else
    :all -> {:error, {:invalid_preview_arguments, "output requires server"}}
    {:error, :server_required} -> {:error, {:invalid_preview_arguments, "output requires server"}}
    other -> other
  end
end

defp tail_output(output) when is_binary(output) do
  output
  |> String.split("\n")
  |> Enum.take(-@output_tail_max_lines)
  |> Enum.join("\n")
end

defp status_reason("crashed"), do: "crashed"
defp status_reason(_), do: nil

defp output_next_steps("crashed"),
  do: "Read output_tail, fix the underlying error (or manage_dev_env), then manage_preview restart with the same server."

defp output_next_steps(_),
  do: "If the server is unhealthy, fix the root cause then manage_preview restart."
```

- [ ] **Step 5: Attach `output_tail` on recoverable start failures**

In `run_preview_start` recoverable branch, after building `data`, if any server is crashed, capture output for the first crashed server (via injectable `capture_output`) and `Map.put(data, :output_tail, tail)`.

Also enrich each server with `public_url` when present on the view (pass through from `issue_targets` / presenter fields if already available; otherwise leave nil).

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd elixir && mix test test/symphony_elixir/assistant/preview_tools_test.exs
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/preview_tools.ex \
  elixir/test/symphony_elixir/assistant/preview_tools_test.exs
git commit -m "$(cat <<'EOF'
feat(assistant): per-server manage_preview and output tails

Let agents target one preview process and read bounded logs with next_steps for self-heal.
EOF
)"
```

---

### Task 2: `list_previews`

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/list_preview_tools.ex`
- Create: `elixir/test/symphony_elixir/assistant/list_preview_tools_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Assistant.ListPreviewToolsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.ListPreviewTools

  test "lists running preview issues for a project" do
    assert {:ok, result} =
             ListPreviewTools.execute("demo", %{},
               running_issue_keys: fn -> MapSet.new([{"demo", "DEMO-1"}, {"other", "X-1"}]) end,
               issue_targets: fn
                 "demo", "DEMO-1" ->
                   {:ok,
                    %{
                      available: true,
                      reason: nil,
                      servers: [%{id: 1, slug: "front", status: "crashed", port: 4101, primary: true}],
                      tunnel: %{enabled: true, running: false}
                    }}
               end
             )

    assert result.tool == "list_previews"
    assert [entry] = result.data.previews
    assert entry.identifier == "DEMO-1"
    assert hd(entry.servers).status == "crashed"
    assert entry.tunnel.enabled == true
    assert is_binary(result.data.next_steps) or result.data.next_steps == nil
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd elixir && mix test test/symphony_elixir/assistant/list_preview_tools_test.exs
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `ListPreviewTools`**

```elixir
defmodule SymphonyElixir.Assistant.ListPreviewTools do
  @moduledoc false

  alias SymphonyElixir.Cloudflare.Tunnel
  alias SymphonyElixir.DevServer
  alias SymphonyElixir.DevServer.Manager

  @tool "list_previews"

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec()]

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    %{
      "name" => @tool,
      "description" =>
        "List active issue previews for the current project (status, ports, URLs, tunnel). Use manage_preview to act.",
      "inputSchema" => %{
        "type" => "object",
        "additionalProperties" => false,
        "properties" => %{}
      }
    }
  end

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, _arguments, opts \\ []) when is_binary(project_slug) do
    running_keys = Keyword.get(opts, :running_issue_keys, &Manager.running_issue_keys/0)
    issue_targets = Keyword.get(opts, :issue_targets, &DevServer.issue_targets/2)
    tunnel_summary = Keyword.get(opts, :tunnel_summary, &Tunnel.summary_for_project/1)

    previews =
      running_keys.()
      |> Enum.filter(fn {slug, _id} -> slug == project_slug end)
      |> Enum.map(fn {_slug, identifier} ->
        case issue_targets.(project_slug, identifier) do
          {:ok, view} ->
            %{
              identifier: identifier,
              available: Map.get(view, :available),
              reason: stringify_reason(Map.get(view, :reason)),
              servers: Enum.map(Map.get(view, :servers) || [], &normalize_server/1),
              tunnel: Map.get(view, :tunnel) || tunnel_summary.(project_slug)
            }

          {:error, _} ->
            nil
        end
      end)
      |> Enum.reject(&is_nil/1)

    unhealthy? =
      Enum.any?(previews, fn p ->
        p.available == false or Enum.any?(p.servers, &(&1.status in ["crashed", "starting"]))
      end)

    {:ok,
     %{
       tool: @tool,
       message: "Found #{length(previews)} preview(s) for #{project_slug}.",
       data: %{
         previews: previews,
         next_steps:
           if unhealthy? do
             "Inspect unhealthy entries with manage_preview status/output, then restart or fix via manage_dev_env."
           end
       }
     }}
  end

  defp stringify_reason(nil), do: nil
  defp stringify_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp stringify_reason(reason), do: to_string(reason)

  defp normalize_server(server) when is_map(server) do
    %{
      id: Map.get(server, :id) || Map.get(server, "id"),
      slug: Map.get(server, :slug) || Map.get(server, "slug"),
      status: to_string(Map.get(server, :status) || Map.get(server, "status") || "unknown"),
      port: Map.get(server, :port) || Map.get(server, "port"),
      primary: Map.get(server, :primary) || Map.get(server, "primary") || false,
      local_url: Map.get(server, :local_url) || Map.get(server, "local_url"),
      public_url: Map.get(server, :public_url) || Map.get(server, "public_url") || Map.get(server, :url)
    }
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd elixir && mix test test/symphony_elixir/assistant/list_preview_tools_test.exs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/list_preview_tools.ex \
  elixir/test/symphony_elixir/assistant/list_preview_tools_test.exs
git commit -m "$(cat <<'EOF'
feat(assistant): add list_previews tool

Give agents a project-wide inventory of active issue previews before acting.
EOF
)"
```

---

### Task 3: `manage_tunnel`

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/tunnel_tools.ex`
- Create: `elixir/test/symphony_elixir/assistant/tunnel_tools_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.Assistant.TunnelToolsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.TunnelTools
  alias SymphonyElixir.Issue

  test "status returns project tunnel summary" do
    issue = %Issue{id: "1", identifier: "DEMO-1", project_slug: "demo"}

    assert {:ok, result} =
             TunnelTools.execute("demo", %{"action" => "status"},
               issue: issue,
               summary: fn "demo" -> %{enabled: true, running: false} end
             )

    assert result.tool == "manage_tunnel"
    assert result.data.enabled == true
    assert result.data.running == false
  end

  test "start calls start_tunnel and returns running summary" do
    assert {:ok, result} =
             TunnelTools.execute("demo", %{"action" => "start"},
               start_tunnel: fn -> {:ok, :running} end,
               summary: fn _ -> %{enabled: true, running: true} end
             )

    assert result.data.running == true
  end

  test "stop returns unsupported structured error" do
    assert {:ok, result} =
             TunnelTools.execute("demo", %{"action" => "stop"}, [])

    assert result.data.ok == false
    assert result.data.reason == "unsupported"
    assert result.data.next_steps =~ "start"
  end

  test "start failure returns tunnel_failed with next_steps" do
    assert {:ok, result} =
             TunnelTools.execute("demo", %{"action" => "start"},
               start_tunnel: fn -> {:error, :cloudflared_missing} end,
               summary: fn _ -> %{enabled: true, running: false} end
             )

    assert result.data.ok == false
    assert result.data.reason == "tunnel_failed"
    assert is_binary(result.data.next_steps)
  end
end
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd elixir && mix test test/symphony_elixir/assistant/tunnel_tools_test.exs
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `TunnelTools`**

```elixir
defmodule SymphonyElixir.Assistant.TunnelTools do
  @moduledoc false

  alias SymphonyElixir.Cloudflare.Tunnel
  alias SymphonyElixir.Issue
  alias SymphonyElixir.Assistant.HandoffTools

  @tool "manage_tunnel"

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec(), issue_bound_tool_spec()]

  def assistant_tool_spec do
    tool_spec(%{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["action"],
      "properties" => %{
        "action" => action_schema(),
        "identifier" => %{"type" => "string", "description" => "Optional issue id for context."}
      }
    })
  end

  def issue_bound_tool_spec do
    tool_spec(%{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["action"],
      "properties" => %{"action" => action_schema()}
    })
  end

  defp action_schema do
    %{
      "type" => "string",
      "enum" => ["status", "start", "stop"],
      "description" => "Tunnel action. stop is unsupported today and returns reason unsupported."
    }
  end

  defp tool_spec(input_schema) do
    %{
      "name" => @tool,
      "description" =>
        "Inspect or start the Cloudflare public preview tunnel for this project. Prefer manage_preview for servers.",
      "inputSchema" => input_schema
    }
  end

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ []) when is_binary(project_slug) and is_map(arguments) do
    summary = Keyword.get(opts, :summary, &Tunnel.summary_for_project/1)
    start_tunnel = Keyword.get(opts, :start_tunnel, &Tunnel.start_tunnel/0)

    with {:ok, action} <- normalize_action(Map.get(arguments, "action")) do
      case action do
        :status ->
          data = summary.(project_slug)

          {:ok,
           %{
             tool: @tool,
             message: "Tunnel status for #{project_slug}.",
             data: Map.merge(data, %{ok: true})
           }}

        :start ->
          case start_tunnel.() do
            {:ok, _} ->
              data = summary.(project_slug)

              {:ok,
               %{
                 tool: @tool,
                 message: "Started public preview tunnel.",
                 data: Map.merge(data, %{ok: true})
               }}

            {:error, reason} ->
              data = summary.(project_slug)

              {:ok,
               %{
                 tool: @tool,
                 message: "Failed to start tunnel.",
                 data:
                   Map.merge(data, %{
                     ok: false,
                     reason: "tunnel_failed",
                     detail: inspect(reason),
                     next_steps:
                       "Check cloudflared install and public_tunnel workflow settings, then retry manage_tunnel start."
                   })
               }}
          end

        :stop ->
          data = summary.(project_slug)

          {:ok,
           %{
             tool: @tool,
             message: "Tunnel stop is not supported.",
             data:
               Map.merge(data, %{
                 ok: false,
                 reason: "unsupported",
                 next_steps: "Tunnel stop is not available; leave the tunnel running or restart Symphony if needed. Use manage_tunnel start if it is stopped."
               })
           }}
      end
    end
  end

  defp normalize_action(action) when is_binary(action) do
    case String.trim(action) |> String.downcase() do
      "status" -> {:ok, :status}
      "start" -> {:ok, :start}
      "stop" -> {:ok, :stop}
      other -> {:error, {:invalid_tunnel_action, other}}
    end
  end

  defp normalize_action(action), do: {:error, {:invalid_tunnel_action, action}}
end
```

(Remove unused `Issue`/`HandoffTools` aliases if identifier is unused — keep only if you resolve issue for messaging.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd elixir && mix test test/symphony_elixir/assistant/tunnel_tools_test.exs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/tunnel_tools.ex \
  elixir/test/symphony_elixir/assistant/tunnel_tools_test.exs
git commit -m "$(cat <<'EOF'
feat(assistant): add manage_tunnel tool

Expose tunnel status/start with structured unsupported stop for agents.
EOF
)"
```

---

### Task 4: Register tools + update prompts

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/tool_executor.ex`
- Modify: `elixir/lib/symphony_elixir/assistant/agent_session.ex`
- Modify: `elixir/lib/symphony_elixir/assistant/project_board_tools.ex` (if freeform should see list/tunnel)
- Modify: `elixir/test/symphony_elixir/assistant/tool_executor_test.exs` (or dynamic tool tests)

- [ ] **Step 1: Write a failing registration assertion**

In an existing tool executor / dynamic tool test, assert specs include `"list_previews"` and `"manage_tunnel"`:

```elixir
names = ToolExecutor.tool_specs() |> Enum.map(& &1["name"])
assert "list_previews" in names
assert "manage_tunnel" in names
assert "manage_preview" in names
```

- [ ] **Step 2: Run to verify fail**

```bash
cd elixir && mix test test/symphony_elixir/assistant/tool_executor_test.exs
```

Expected: FAIL on missing names (or add a focused new test file if executor tests are heavy).

- [ ] **Step 3: Wire modules**

In `tool_executor.ex`:

```elixir
alias SymphonyElixir.Assistant.{ListPreviewTools, TunnelTools, PreviewTools, ...}

# In build_tool_specs / assistant specs list, append:
ListPreviewTools.tool_specs() ++ TunnelTools.tool_specs()

# In do_execute:
defp do_execute(project, "list_previews", arguments, opts) do
  ListPreviewTools.execute(project.slug, arguments, opts)
end

defp do_execute(project, "manage_tunnel", arguments, opts) do
  TunnelTools.execute(project.slug, arguments, opts)
end
```

Ensure issue-bound path still exposes `manage_preview` (already) and `manage_tunnel` issue-bound spec.

Update `agent_session.ex` board-tool blurbs:

```text
manage_preview (status|start|stop|restart|output; optional server), list_previews, manage_tunnel (status|start), manage_dev_env, ...
```

And guidance:

```text
For preview: list_previews to discover; manage_preview status/output on crash; manage_tunnel start for public URLs; manage_dev_env when no_serve_step.
```

- [ ] **Step 4: Run tests**

```bash
cd elixir && mix test test/symphony_elixir/assistant/tool_executor_test.exs \
  test/symphony_elixir/assistant/preview_tools_test.exs \
  test/symphony_elixir/assistant/list_preview_tools_test.exs \
  test/symphony_elixir/assistant/tunnel_tools_test.exs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/tool_executor.ex \
  elixir/lib/symphony_elixir/assistant/agent_session.ex \
  elixir/lib/symphony_elixir/assistant/project_board_tools.ex \
  elixir/test/symphony_elixir/assistant/tool_executor_test.exs
git commit -m "$(cat <<'EOF'
feat(assistant): register list_previews and manage_tunnel

Expose the new preview tools to chat and coding agents with updated prompts.
EOF
)"
```

---

### Task 5: Compact `PreviewPanel` UI

**Files:**
- Modify: `tracker/src/components/issues/issue-detail/PreviewTab.tsx`
- Modify: `tracker/src/components/issues/issue-detail/__tests__/PreviewTab.test.tsx`
- Modify: `tracker/locales/en/tracker.json`
- Modify: `tracker/locales/pt-BR/tracker.json`

- [ ] **Step 1: Update failing UI expectations**

Adjust `PreviewTab.test.tsx` for the new hierarchy:

```tsx
it("shows one primary start action and compact server metadata", () => {
  renderPreview(
    response([
      server({ id: 1, slug: "api", status: "ready", url: "http://127.0.0.1:4000", primary: false }),
      server({ id: 2, slug: "web", status: "ready", url: "http://127.0.0.1:5173", primary: true }),
    ]),
  );

  expect(screen.getByRole("link", { name: /^open preview$/i })).toBeInTheDocument();
  // Primary CTA present; stop/restart not three equal primary buttons
  expect(screen.getByRole("button", { name: /^start preview$/i })).toBeInTheDocument();
  expect(screen.getByText(/web/i)).toBeInTheDocument();
  // Prefer compact line containing port
  expect(screen.getByText(/5173/)).toBeInTheDocument();
});
```

Update any tests that required three equal header buttons side-by-side; stop/restart may be in a menu or secondary ghost buttons — assert via accessible names still present.

- [ ] **Step 2: Run test to verify fail / drift**

```bash
cd tracker && npm test -- src/components/issues/issue-detail/__tests__/PreviewTab.test.tsx
```

Expected: FAIL until layout matches (or PASS if assertions still match — tighten assertions if needed).

- [ ] **Step 3: Restructure `PreviewPanel` render**

Replace the dense card header + `TunnelNotice` essay with:

1. **Status strip** — single line: availability · tunnel (enabled/running) · optional “Start tunnel” ghost button.
2. **Primary CTA row** — if ready URL: “Open preview” (primary link/button). Else if can start: “Start preview” (primary). Else if failure: “Ask assistant to fix” (primary). Secondary: Stop / Restart as `variant="ghost"` `size="sm"` or a single overflow `DropdownMenu`.
3. **Ready URL** — one monospace line (no second emerald card duplicating per-server links).
4. **Server rows** — compact:

```tsx
<div className="flex items-center gap-2 border-b py-2 last:border-0">
  <div className="min-w-0 flex-1 truncate text-xs">
    <span className="font-medium">{server.slug}</span>
    {server.primary ? <Badge className="ml-1">principal</Badge> : null}
    <span className="text-muted-foreground"> · :{server.port} · {server.status}</span>
  </div>
  <div className="flex shrink-0 items-center gap-0.5">
    {/* icon Start / Stop / Restart */}
    {/* overflow: Ask assistant, Open URL */}
  </div>
</div>
```

5. Keep `DevServerOutputPanel` under each row; pass `defaultOpen={AUTO_OPEN_STATUSES.has(status)}` as today.

Remove or shrink `TunnelNotice` dashed card into the status strip.

Add i18n keys only if new strings appear, e.g. `issue.preview.moreActions`, `issue.preview.tunnelRunning`, `issue.preview.tunnelStopped`.

- [ ] **Step 4: Run UI tests**

```bash
cd tracker && npm test -- src/components/issues/issue-detail/__tests__/PreviewTab.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail/PreviewTab.tsx \
  tracker/src/components/issues/issue-detail/__tests__/PreviewTab.test.tsx \
  tracker/locales/en/tracker.json \
  tracker/locales/pt-BR/tracker.json
git commit -m "$(cat <<'EOF'
feat(tracker): compact preview panel hierarchy

Status strip, one primary CTA, and dense server rows for the session dock.
EOF
)"
```

---

### Task 6: `DevServerOutputPanel` error UX

**Files:**
- Modify: `tracker/src/components/issues/issue-detail/DevServerOutputPanel.tsx`
- Add/adjust test if one exists; otherwise extend `PreviewTab` crashed-state coverage

- [ ] **Step 1: Reproduce desired behavior in a unit test**

If no dedicated test file, create `tracker/src/components/issues/issue-detail/__tests__/DevServerOutputPanel.test.tsx`:

```tsx
it("shows load error without empty pre body", async () => {
  vi.mocked(fetchDevServerOutput).mockRejectedValue(new Error("fail"));
  render(
    <DevServerOutputPanel
      projectSlug="macro-markets"
      issueIdentifier="510"
      serverId={1}
      slug="front"
      status="crashed"
      sessionName="sym"
      defaultOpen
    />,
  );
  expect(await screen.findByText(/could not load|não foi possível/i)).toBeInTheDocument();
  expect(screen.queryByText(/no output captured|nenhuma saída/i)).not.toBeInTheDocument();
});
```

(Mock `@/services/issueDevServers` accordingly.)

- [ ] **Step 2: Run to fail**

```bash
cd tracker && npm test -- src/components/issues/issue-detail/__tests__/DevServerOutputPanel.test.tsx
```

- [ ] **Step 3: Fix render**

When `error` is set, render only the error callout; do not render the empty `<pre>` placeholder. When `output` is empty and not loading and no error, show the muted empty hint.

- [ ] **Step 4: Pass + commit**

```bash
cd tracker && npm test -- src/components/issues/issue-detail/__tests__/DevServerOutputPanel.test.tsx
git add tracker/src/components/issues/issue-detail/DevServerOutputPanel.tsx \
  tracker/src/components/issues/issue-detail/__tests__/DevServerOutputPanel.test.tsx
git commit -m "$(cat <<'EOF'
fix(tracker): hide empty log pre when output load fails

Keep crashed preview rows scannable when command output cannot be fetched.
EOF
)"
```

---

### Task 7: Verification + tracker build

- [ ] **Step 1: Elixir gate for touched tests**

```bash
cd elixir && mix test test/symphony_elixir/assistant/preview_tools_test.exs \
  test/symphony_elixir/assistant/list_preview_tools_test.exs \
  test/symphony_elixir/assistant/tunnel_tools_test.exs \
  test/symphony_elixir/assistant/tool_executor_test.exs
```

Expected: PASS

- [ ] **Step 2: Tracker tests + build**

```bash
cd tracker && npm test -- src/components/issues/issue-detail/__tests__/PreviewTab.test.tsx \
  src/components/issues/issue-detail/__tests__/DevServerOutputPanel.test.tsx
cd tracker && npm run build
```

Expected: PASS; assets in `elixir/priv/static/tracker`

- [ ] **Step 3: Manual checklist**

1. Open `http://localhost:4000/tracker/projects/macro-markets/workspaces/7999` (or issue with preview).
2. Open Preview dock — status strip + primary CTA + compact rows.
3. Crash / stop a server — logs open; load failure shows error only.
4. In assistant chat: `list_previews` → `manage_preview` `output` with `server=front` → structured `output_tail` / `next_steps` → `restart`.
5. `manage_tunnel` `status` / `start`; `stop` returns `reason: unsupported`.

- [ ] **Step 4: Final commit if any leftover**

```bash
git status -sb
# commit any remaining i18n/prompt nits
```

---

## Spec coverage self-check

| Spec requirement | Task |
| --- | --- |
| Compact status-first UI | Task 5 |
| Primary CTA / secondary stop-restart | Task 5 |
| Compact server rows + icon actions | Task 5 |
| Logs on demand; clean load error | Tasks 5–6 |
| Extend `manage_preview` + `server` + `output` | Task 1 |
| `list_previews` | Task 2 |
| `manage_tunnel` status/start; stop unsupported | Task 3 |
| Register tools + prompts | Task 4 |
| Error contract (`reason`, `output_tail`, `next_steps`) | Tasks 1–3 |
| No live SSE via tools | Honored (capture snapshot only) |
| Shared `PreviewPanel` for dock + tab | Task 5 (same component) |

## Placeholder scan

No TBD/TODO steps; commands and code sketches are concrete. Adjust line-level injectables if `PreviewTools.execute/3` opts names differ slightly during implementation — keep the injectable pattern shown in existing tests.
