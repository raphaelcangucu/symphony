# Tracker Agent Tools — Phase 2/3 + `mix symphony.tracker` CLI — Implementation Plan

**Goal:** Ship the remaining assistant/coding-agent tools (`link_pull_request`,
`get_issue_orchestrator_state`, `explain_dispatch_eligibility`, `manage_blockers`,
`sync_issue`) and a `mix symphony.tracker` CLI that is a thin shell over the same
`ToolExecutor` surface, so agents, the chat assistant, humans, and CI all share one
tool boundary.

**Architecture:** Each tool is a focused `SymphonyElixir.Assistant.*Tools` module
(`assistant_tool_spec/0` + `execute/3`, deps injected via `opts`) wired into
`ToolExecutor` (`do_execute` + `@tracker_tools`), `ProjectBoardTools` (`@scoped_tools`),
and — where issue-bound — `DynamicTool`. The CLI does **not** open the tracker SQLite
itself; the DB is owned by the running daemon, so the CLI connects over distributed
Erlang (the same `:erpc` pattern as `mix symphony.ctl`) to a thin in-daemon dispatcher
`SymphonyElixir.Tracker.Cli` that calls `ToolExecutor.execute/4` and returns the
structured `{tool, message, data}` result.

**Tech Stack:** Elixir 1.19 / OTP 28, ExUnit, Ecto/SQLite, `:erpc` + distributed
Erlang, `OptionParser`, `Jason`. Reuses `LocalStore`, `PullRequestUrl`,
`Presenter`, `Context` (blockers), `Tracker.Sync.Engine`, `ProjectConfig`,
`Settings.Orchestration`, `AgentRouting`.

**Spec:** `docs/superpowers/specs/2026-06-17-tracker-agent-tools-design.md`
(Phase 2 §5–7, Phase 3 §8–9) plus the deferred CLI (`mix symphony.tracker`).

---

## Design decisions (locked in this plan)

1. **CLI talks to the running daemon over `:erpc`** — never `Mix.Task.run("app.start")`.
   The tracker SQLite has a single owner (the daemon); a second BEAM opening it would
   risk lock conflicts and stale reads. Node/cookie discovery reuses
   `SymphonyElixir.Ctl.node_name/1` + `cookie/1` and the `on_daemon` connect dance from
   `Mix.Tasks.Symphony.Ctl`.
2. **CLI is a thin shell over `ToolExecutor`** — one in-daemon dispatcher
   (`SymphonyElixir.Tracker.Cli.call/3`) maps a tool name + slug + args to
   `ToolExecutor.execute/4` (plus `DiscoveryTools` for the slug-less `projects` command).
   No business logic in the CLI.
3. **Output format:** default prints the human `message` line then a pretty-printed
   `data` block; `--json` prints the full `{tool, message, data}` as one compact JSON
   line on stdout (script/agent friendly). Errors print to stderr and exit non-zero.
4. **`explain_dispatch_eligibility` scope:** deterministic config/label/status
   eligibility only (`dispatch_states` membership, terminal/wait exclusion, symphony
   label when required). It reports the global gate flags + the issue's
   status/labels/assignee as context. Live "currently running/retrying" state is **not**
   a reason here — that is what `get_issue_orchestrator_state` answers. This keeps the
   tool pure and free of fragile orchestrator-internal assumptions.
5. **`get_issue_orchestrator_state`** loads the tracker issue first (so it always
   reports the persisted status, even when idle) and enriches with
   `Presenter.issue_payload/3` when the orchestrator snapshot has a running/retry entry.
6. **Audiences (from spec):** `link_pull_request` = assistant + coding agent (issue
   bound). `get_issue_orchestrator_state`, `explain_dispatch_eligibility`,
   `manage_blockers`, `sync_issue` = assistant only.

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `elixir/lib/symphony_elixir/assistant/pull_request_tools.ex` | Create | `link_pull_request` |
| `elixir/lib/symphony_elixir/assistant/orchestrator_tools.ex` | Create | `get_issue_orchestrator_state` |
| `elixir/lib/symphony_elixir/assistant/dispatch_tools.ex` | Create | `explain_dispatch_eligibility` |
| `elixir/lib/symphony_elixir/assistant/blocker_tools.ex` | Create | `manage_blockers` |
| `elixir/lib/symphony_elixir/assistant/sync_tools.ex` | Create | `sync_issue` |
| `elixir/lib/symphony_elixir/assistant/tool_executor.ex` | Modify | Register 5 tools; `do_execute` clauses |
| `elixir/lib/symphony_elixir/assistant/project_board_tools.ex` | Modify | Add 5 tools to `@scoped_tools` |
| `elixir/lib/symphony_elixir/codex/dynamic_tool.ex` | Modify | Issue-bound `link_pull_request` |
| `elixir/lib/symphony_elixir/tracker/cli.ex` | Create | In-daemon RPC dispatcher |
| `elixir/lib/mix/tasks/symphony.tracker.ex` | Create | `mix symphony.tracker` CLI |
| `elixir/lib/symphony_elixir/ctl.ex` | Modify | Add new tool modules to `@assistant_reload_modules` |
| `elixir/lib/symphony_elixir/assistant/codex_session.ex` | Modify | Prompt mentions new tools |
| `elixir/test/symphony_elixir/assistant/pull_request_tools_test.exs` | Create | Unit tests |
| `elixir/test/symphony_elixir/assistant/orchestrator_tools_test.exs` | Create | Unit tests |
| `elixir/test/symphony_elixir/assistant/dispatch_tools_test.exs` | Create | Unit tests |
| `elixir/test/symphony_elixir/assistant/blocker_tools_test.exs` | Create | Unit tests |
| `elixir/test/symphony_elixir/assistant/sync_tools_test.exs` | Create | Unit tests |
| `elixir/test/symphony_elixir/assistant/tool_executor_test.exs` | Modify | Specs include new tools |
| `elixir/test/symphony_elixir/dynamic_tool_test.exs` | Modify | Issue-bound `link_pull_request` |
| `elixir/test/symphony_elixir/tracker/cli_test.exs` | Create | Dispatcher routing tests |
| `elixir/test/mix/tasks/symphony_tracker_test.exs` | Create | argv parsing tests |
| `skills/evidence/SKILL.md`, `.claude/.../evidence/SKILL.md`, `.codex/.../evidence/SKILL.md` | Modify | Reference `link_pull_request` |
| `skills/workflow/SKILL.md` (+ mirrors) | Modify | `explain_dispatch_eligibility`, `manage_blockers`, `sync_issue`, CLI |
| `elixir/README.md` | Modify | Document `mix symphony.tracker` |
| `docs/superpowers/specs/2026-06-17-tracker-agent-tools-design.md` | Modify | Status note: Phase 2/3 + CLI done |

> **Skill mirrors:** `skills/`, `.claude/skills/`, and `.codex/skills/` hold identical
> copies (confirmed by the Phase 1 grep). Edit all three for every skill change.

---

### Task 1: `PullRequestTools` — `link_pull_request`

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/pull_request_tools.ex`
- Create: `elixir/test/symphony_elixir/assistant/pull_request_tools_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.Assistant.PullRequestToolsTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Assistant.PullRequestTools
  alias SymphonyElixir.LocalTracker.Context

  defp project_with_issue do
    {:ok, _} = Context.ensure_project(%{name: "Macro", slug: "macro"})
    {:ok, issue} = Context.create_issue("macro", %{"title" => "T", "status" => "Todo"})
    issue
  end

  test "assistant spec requires identifier and url" do
    spec = PullRequestTools.assistant_tool_spec()
    assert spec["name"] == "link_pull_request"
    assert "identifier" in spec["inputSchema"]["required"]
    assert "url" in spec["inputSchema"]["required"]
  end

  test "issue-bound spec requires only url" do
    spec = PullRequestTools.issue_bound_tool_spec()
    assert spec["inputSchema"]["required"] == ["url"]
  end

  test "links a valid PR url to the issue" do
    issue = project_with_issue()

    assert {:ok, result} =
             PullRequestTools.execute("macro", %{
               "identifier" => issue.identifier,
               "url" => "https://github.com/org/repo/pull/42"
             })

    assert result.tool == "link_pull_request"
    assert result.data.pull_request.number == 42
    assert result.data.pull_request.repo == "org/repo"
    assert result.data.pull_request.origin == "manual"
  end

  test "rejects an invalid PR url" do
    issue = project_with_issue()

    assert {:error, :invalid_pr_url} =
             PullRequestTools.execute("macro", %{"identifier" => issue.identifier, "url" => "nope"})
  end

  test "requires a url" do
    issue = project_with_issue()
    assert {:error, :missing_url} = PullRequestTools.execute("macro", %{"identifier" => issue.identifier})
  end
end
```

- [ ] **Step 2: Run — expect FAIL** (`PullRequestTools` undefined)

Run: `cd elixir && mix test test/symphony_elixir/assistant/pull_request_tools_test.exs`

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Assistant.PullRequestTools do
  @moduledoc false

  alias SymphonyElixir.Assistant.HandoffTools
  alias SymphonyElixir.GitHub.PullRequestUrl
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.Sync.LocalStore

  @tool "link_pull_request"

  @description """
  Link a GitHub pull request URL to a tracker issue (origin "manual").
  Use after opening a PR so the issue shows the association on the board and the publish gate can see it.
  """

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    tool_spec(@description, %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["identifier", "url"],
      "properties" => %{
        "identifier" => %{"type" => "string", "description" => "Issue identifier, for example MAC-1."},
        "url" => %{"type" => "string", "description" => "GitHub pull request URL."}
      }
    })
  end

  @spec issue_bound_tool_spec() :: map()
  def issue_bound_tool_spec do
    tool_spec(@description, %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["url"],
      "properties" => %{
        "url" => %{"type" => "string", "description" => "GitHub pull request URL."}
      }
    })
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec(), issue_bound_tool_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    link_fun = Keyword.get(opts, :link_pull_request, &LocalStore.link_manual_pull_request/3)

    with {:ok, issue} <- HandoffTools.resolve_issue(project_slug, arguments, opts),
         {:ok, url} <- required_url(arguments),
         {:ok, parsed} <- PullRequestUrl.parse(url),
         {:ok, project} <- Context.get_project(project_slug),
         {:ok, record} <- link_fun.(project.id, issue.identifier, %{url: url, repo: parsed.repo, number: parsed.number}) do
      {:ok,
       %{
         tool: @tool,
         message: "Linked #{parsed.repo}##{parsed.number} to #{issue.identifier}.",
         data: %{pull_request: present(record)}
       }}
    end
  end

  defp present(record) do
    %{
      url: record.url,
      repo: record.repo,
      number: record.number,
      state: record.state,
      origin: record.origin
    }
  end

  defp required_url(arguments) do
    case Map.get(arguments, "url") do
      url when is_binary(url) ->
        case String.trim(url) do
          "" -> {:error, :missing_url}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, :missing_url}
    end
  end

  defp tool_spec(description, input_schema) do
    %{"name" => @tool, "description" => String.trim(description), "inputSchema" => input_schema}
  end
end
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Wire into `ToolExecutor`**

In `@tracker_tools` add `link_pull_request`. Add alias `PullRequestTools` to the
`alias SymphonyElixir.Assistant.{...}` block. Add spec to `build_tool_specs/0` (append
`PullRequestTools.assistant_tool_spec()` to the returned list — mirror how
`HandoffTools.assistant_tool_spec()` is appended). Add `do_execute`:

```elixir
defp do_execute(project, "link_pull_request", arguments, opts) do
  case PullRequestTools.execute(project_slug(project), arguments, opts) do
    {:ok, result} -> {:ok, result}
    {:error, reason} -> {:error, reason}
  end
end
```

> Verify how Phase 1 specs are appended: read `build_tool_specs/0` end and the place
> `HandoffTools.assistant_tool_spec()` / `EvidenceTools.assistant_tool_spec()` are added,
> and follow the exact same shape.

- [ ] **Step 6: Wire into `ProjectBoardTools`** — add `link_pull_request` to `@scoped_tools`.

- [ ] **Step 7: Wire issue-bound into `DynamicTool`**

Add module attribute `@link_pull_request_tool "link_pull_request"`, alias
`PullRequestTools`, a clause in `execute/3`:

```elixir
@link_pull_request_tool ->
  execute_bound_assistant_tool(PullRequestTools, arguments, opts)
```

and append `PullRequestTools.issue_bound_tool_spec()` to `coding_agent_tool_specs/0`.

- [ ] **Step 8: Run tool + dynamic tests — expect PASS**

Run: `cd elixir && mix test test/symphony_elixir/assistant/pull_request_tools_test.exs test/symphony_elixir/dynamic_tool_test.exs`

- [ ] **Step 9: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/pull_request_tools.ex \
  elixir/test/symphony_elixir/assistant/pull_request_tools_test.exs \
  elixir/lib/symphony_elixir/assistant/tool_executor.ex \
  elixir/lib/symphony_elixir/assistant/project_board_tools.ex \
  elixir/lib/symphony_elixir/codex/dynamic_tool.ex
git commit -m "feat(assistant): link_pull_request tool (assistant + coding agent)"
```

---

### Task 2: `OrchestratorTools` — `get_issue_orchestrator_state`

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/orchestrator_tools.ex`
- Create: `elixir/test/symphony_elixir/assistant/orchestrator_tools_test.exs`

- [ ] **Step 1: Write failing tests** (inject the orchestrator-state fn so no GenServer is needed)

```elixir
defmodule SymphonyElixir.Assistant.OrchestratorToolsTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Assistant.OrchestratorTools
  alias SymphonyElixir.LocalTracker.Context

  defp issue_fixture do
    {:ok, _} = Context.ensure_project(%{name: "Macro", slug: "macro"})
    {:ok, issue} = Context.create_issue("macro", %{"title" => "T", "status" => "Todo"})
    issue
  end

  test "assistant spec requires identifier" do
    spec = OrchestratorTools.assistant_tool_spec()
    assert spec["name"] == "get_issue_orchestrator_state"
    assert "identifier" in spec["inputSchema"]["required"]
  end

  test "reports idle when orchestrator has no entry" do
    issue = issue_fixture()

    assert {:ok, result} =
             OrchestratorTools.execute("macro", %{"identifier" => issue.identifier},
               orchestrator_state: fn _ -> {:error, :issue_not_found} end
             )

    assert result.data.active == false
    assert result.data.issue.identifier == issue.identifier
    assert result.data.orchestrator == nil
  end

  test "passes through orchestrator payload when active" do
    issue = issue_fixture()
    payload = %{status: "running", attempts: %{restart_count: 0}}

    assert {:ok, result} =
             OrchestratorTools.execute("macro", %{"identifier" => issue.identifier},
               orchestrator_state: fn _ -> {:ok, payload} end
             )

    assert result.data.active == true
    assert result.data.orchestrator == payload
  end

  test "errors when issue is unknown" do
    {:ok, _} = Context.ensure_project(%{name: "Macro", slug: "macro"})
    assert {:error, :issue_not_found} = OrchestratorTools.execute("macro", %{"identifier" => "MACRO-999"})
  end
end
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Assistant.OrchestratorTools do
  @moduledoc false

  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.Presenter
  alias SymphonyElixirWeb.TrackerPresenter

  @tool "get_issue_orchestrator_state"
  @snapshot_timeout_ms 15_000

  @description """
  Report what the orchestrator is doing with an issue: persisted status plus any live running/retry entry.
  Use to answer "is this issue running, retrying, or idle?".
  """

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    %{
      "name" => @tool,
      "description" => String.trim(@description),
      "inputSchema" => %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["identifier"],
        "properties" => %{
          "identifier" => %{"type" => "string", "description" => "Issue identifier, for example MAC-1."}
        }
      }
    }
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    state_fun = Keyword.get(opts, :orchestrator_state, &default_state/1)

    with {:ok, identifier} <- required_identifier(arguments),
         {:ok, issue} <- Context.get_issue(project_slug, identifier) do
      {active, payload} =
        case state_fun.(identifier) do
          {:ok, state} -> {true, state}
          {:error, _} -> {false, nil}
        end

      {:ok,
       %{
         tool: @tool,
         message: orchestrator_message(identifier, active),
         data: %{active: active, issue: TrackerPresenter.issue(issue), orchestrator: payload}
       }}
    end
  end

  defp default_state(identifier) do
    Presenter.issue_payload(identifier, Config.orchestrator_name(), @snapshot_timeout_ms)
  rescue
    _ -> {:error, :issue_not_found}
  catch
    :exit, _ -> {:error, :issue_not_found}
  end

  defp orchestrator_message(identifier, true), do: "#{identifier} is active in the orchestrator."
  defp orchestrator_message(identifier, false), do: "#{identifier} is not currently running or retrying."

  defp required_identifier(arguments) do
    case Map.get(arguments, "identifier") do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> {:error, :missing_identifier}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, :missing_identifier}
    end
  end
end
```

> **Verify `Config.orchestrator_name/0` exists.** Grep `def orchestrator` in
> `elixir/lib/symphony_elixir/config.ex`. If it does not exist, default to the module
> name `SymphonyElixir.Orchestrator` (same value the observability controller uses via
> `Endpoint.config(:orchestrator) || SymphonyElixir.Orchestrator`). In that case replace
> `Config.orchestrator_name()` with the literal `SymphonyElixir.Orchestrator`.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Wire into `ToolExecutor` + `ProjectBoardTools`** (assistant only — no DynamicTool)

`@tracker_tools` += `get_issue_orchestrator_state`; alias `OrchestratorTools`; append
`OrchestratorTools.assistant_tool_spec()` in `build_tool_specs/0`; `do_execute`:

```elixir
defp do_execute(project, "get_issue_orchestrator_state", arguments, opts) do
  case OrchestratorTools.execute(project_slug(project), arguments, opts) do
    {:ok, result} -> {:ok, result}
    {:error, reason} -> {:error, reason}
  end
end
```

`ProjectBoardTools` `@scoped_tools` += `get_issue_orchestrator_state`.

- [ ] **Step 6: Run — expect PASS** then **Commit**

```bash
git commit -m "feat(assistant): get_issue_orchestrator_state tool"
```

---

### Task 3: `DispatchTools` — `explain_dispatch_eligibility`

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/dispatch_tools.ex`
- Create: `elixir/test/symphony_elixir/assistant/dispatch_tools_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.Assistant.DispatchToolsTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Assistant.DispatchTools
  alias SymphonyElixir.LocalTracker.Context

  defp issue_in(status) do
    {:ok, _} = Context.ensure_project(%{name: "Macro", slug: "macro"})
    {:ok, issue} = Context.create_issue("macro", %{"title" => "T", "status" => status})
    issue
  end

  test "eligible when status is in dispatch_states and label gate off" do
    issue = issue_in("Todo")

    assert {:ok, result} =
             DispatchTools.execute("macro", %{"identifier" => issue.identifier},
               dispatch_states: ["Todo"],
               require_symphony_label: false,
               require_assignee_match: false
             )

    assert result.data.eligible == true
    assert result.data.reasons == []
  end

  test "not eligible when status outside dispatch_states" do
    issue = issue_in("Backlog")

    assert {:ok, result} =
             DispatchTools.execute("macro", %{"identifier" => issue.identifier},
               dispatch_states: ["Todo"],
               require_symphony_label: false
             )

    assert result.data.eligible == false
    assert "status_not_in_dispatch_states" in result.data.reasons
  end

  test "missing symphony label is a reason when required" do
    issue = issue_in("Todo")

    assert {:ok, result} =
             DispatchTools.execute("macro", %{"identifier" => issue.identifier},
               dispatch_states: ["Todo"],
               require_symphony_label: true
             )

    assert "missing_symphony_label" in result.data.reasons
    assert result.data.gates.require_symphony_label == true
  end
end
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Assistant.DispatchTools do
  @moduledoc false

  alias SymphonyElixir.AgentRouting
  alias SymphonyElixir.Assistant.HandoffTools
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.Settings.Orchestration

  @tool "explain_dispatch_eligibility"

  @description """
  Explain whether the orchestrator would auto-dispatch an issue, listing concrete reasons when it would not.
  Use to answer "why didn't this issue start?". Checks status against dispatch/terminal/wait states and the symphony-label gate.
  """

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    %{
      "name" => @tool,
      "description" => String.trim(@description),
      "inputSchema" => %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["identifier"],
        "properties" => %{
          "identifier" => %{"type" => "string", "description" => "Issue identifier, for example MAC-1."}
        }
      }
    }
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    with {:ok, identifier} <- required_identifier(arguments),
         {:ok, issue} <- Context.get_issue(project_slug, identifier),
         {:ok, config} <- HandoffTools.load_config(project_slug, opts) do
      require_label = Keyword.get(opts, :require_symphony_label, Orchestration.require_symphony_label?())
      require_assignee = Keyword.get(opts, :require_assignee_match, Orchestration.require_assignee_match?())
      dispatch_states = Keyword.get(opts, :dispatch_states, config.dispatch_states) || []

      status = status_name(issue)
      labels = label_names(issue)
      reasons = compute_reasons(status, labels, config, dispatch_states, require_label)

      {:ok,
       %{
         tool: @tool,
         message: eligibility_message(identifier, reasons),
         data: %{
           eligible: reasons == [],
           reasons: reasons,
           status: status,
           labels: labels,
           assignee_id: issue.assignee_id,
           gates: %{
             require_symphony_label: require_label,
             require_assignee_match: require_assignee,
             dispatch_states: dispatch_states
           }
         }
       }}
    end
  end

  defp compute_reasons(status, labels, %ProjectConfig{} = config, dispatch_states, require_label) do
    []
    |> add_unless(in_states?(status, dispatch_states), "status_not_in_dispatch_states")
    |> add_if(in_states?(status, config.terminal_states), "terminal_state")
    |> add_if(in_states?(status, config.wait_states), "wait_state")
    |> add_if(require_label and not Enum.any?(labels, &AgentRouting.symphony_label?/1), "missing_symphony_label")
    |> Enum.reverse()
  end

  defp add_if(reasons, true, reason), do: [reason | reasons]
  defp add_if(reasons, _false, _reason), do: reasons
  defp add_unless(reasons, true, _reason), do: reasons
  defp add_unless(reasons, _false, reason), do: [reason | reasons]

  defp in_states?(nil, _states), do: false
  defp in_states?(_status, states) when not is_list(states), do: false

  defp in_states?(status, states) do
    normalized = normalize(status)
    Enum.any?(states, &(normalize(&1) == normalized))
  end

  defp normalize(value) when is_binary(value), do: value |> String.trim() |> String.downcase()
  defp normalize(_), do: ""

  defp status_name(%{status: %{name: name}}) when is_binary(name), do: name
  defp status_name(_), do: nil

  defp label_names(%{labels: labels}) when is_list(labels) do
    Enum.flat_map(labels, fn
      %{name: name} when is_binary(name) -> [name]
      name when is_binary(name) -> [name]
      _ -> []
    end)
  end

  defp label_names(_), do: []

  defp eligibility_message(identifier, []), do: "#{identifier} is eligible for auto-dispatch."
  defp eligibility_message(identifier, reasons),
    do: "#{identifier} is not eligible: #{Enum.join(reasons, ", ")}."

  defp required_identifier(arguments) do
    case Map.get(arguments, "identifier") do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> {:error, :missing_identifier}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, :missing_identifier}
    end
  end
end
```

> Confirm `ProjectConfig` has `terminal_states` and `wait_states` fields (HandoffTools
> already reads `config.wait_states`; `agent_runner` reads `config.terminal_states`).

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Wire into `ToolExecutor` + `ProjectBoardTools`** (assistant only)

`@tracker_tools` += `explain_dispatch_eligibility`; alias; append spec; `do_execute`:

```elixir
defp do_execute(project, "explain_dispatch_eligibility", arguments, opts) do
  case DispatchTools.execute(project_slug(project), arguments, opts) do
    {:ok, result} -> {:ok, result}
    {:error, reason} -> {:error, reason}
  end
end
```

`ProjectBoardTools` `@scoped_tools` += `explain_dispatch_eligibility`.

- [ ] **Step 6: Run — expect PASS** then **Commit**

```bash
git commit -m "feat(assistant): explain_dispatch_eligibility tool"
```

---

### Task 4: `BlockerTools` — `manage_blockers`

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/blocker_tools.ex`
- Create: `elixir/test/symphony_elixir/assistant/blocker_tools_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.Assistant.BlockerToolsTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Assistant.BlockerTools
  alias SymphonyElixir.LocalTracker.Context

  defp two_issues do
    {:ok, _} = Context.ensure_project(%{name: "Macro", slug: "macro"})
    {:ok, a} = Context.create_issue("macro", %{"title" => "A", "status" => "Todo"})
    {:ok, b} = Context.create_issue("macro", %{"title" => "B", "status" => "Todo"})
    {a, b}
  end

  test "spec advertises list/create/delete actions" do
    spec = BlockerTools.assistant_tool_spec()
    assert spec["name"] == "manage_blockers"
    assert "action" in spec["inputSchema"]["required"]
  end

  test "create then list then delete" do
    {a, b} = two_issues()

    assert {:ok, created} =
             BlockerTools.execute("macro", %{"action" => "create", "identifier" => a.identifier, "target" => b.identifier})

    assert created.data.blocker.source_identifier == a.identifier
    assert created.data.blocker.target_identifier == b.identifier

    assert {:ok, listed} =
             BlockerTools.execute("macro", %{"action" => "list", "identifier" => a.identifier})

    assert length(listed.data.blockers) == 1

    assert {:ok, _deleted} =
             BlockerTools.execute("macro", %{"action" => "delete", "identifier" => a.identifier, "target" => b.identifier})

    assert {:ok, empty} = BlockerTools.execute("macro", %{"action" => "list", "identifier" => a.identifier})
    assert empty.data.blockers == []
  end

  test "create requires target" do
    {a, _b} = two_issues()
    assert {:error, :missing_target} =
             BlockerTools.execute("macro", %{"action" => "create", "identifier" => a.identifier})
  end

  test "rejects unknown action" do
    {a, _b} = two_issues()
    assert {:error, {:invalid_action, "frobnicate"}} =
             BlockerTools.execute("macro", %{"action" => "frobnicate", "identifier" => a.identifier})
  end
end
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Assistant.BlockerTools do
  @moduledoc false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerPresenter

  @tool "manage_blockers"
  @type_default "blocked_by"

  @description """
  List, create, or delete "blocked_by" relations on an issue.
  action: "list" needs identifier; "create"/"delete" also need target (the blocking issue).
  """

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    %{
      "name" => @tool,
      "description" => String.trim(@description),
      "inputSchema" => %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["action", "identifier"],
        "properties" => %{
          "action" => %{"type" => "string", "enum" => ["list", "create", "delete"], "description" => "Operation."},
          "identifier" => %{"type" => "string", "description" => "Issue identifier that is (or would be) blocked."},
          "target" => %{"type" => "string", "description" => "Blocking issue identifier (required for create/delete)."}
        }
      }
    }
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, _opts \\ [])

  def execute(project_slug, arguments, _opts) when is_binary(project_slug) and is_map(arguments) do
    with {:ok, identifier} <- required(arguments, "identifier", :missing_identifier),
         {:ok, action} <- normalize_action(Map.get(arguments, "action")) do
      run(action, project_slug, identifier, arguments)
    end
  end

  defp run(:list, project_slug, identifier, _arguments) do
    with {:ok, relations} <- Context.list_blockers(project_slug, identifier) do
      blockers = Enum.map(relations, &TrackerPresenter.blocker/1)
      {:ok, %{tool: @tool, message: "#{identifier} has #{length(blockers)} blocker(s).", data: %{blockers: blockers}}}
    end
  end

  defp run(:create, project_slug, identifier, arguments) do
    with {:ok, target} <- required(arguments, "target", :missing_target),
         {:ok, relation} <- Context.add_blocker(project_slug, identifier, target, @type_default) do
      {:ok, %{tool: @tool, message: "#{identifier} is now blocked by #{target}.", data: %{blocker: TrackerPresenter.blocker(relation)}}}
    end
  end

  defp run(:delete, project_slug, identifier, arguments) do
    with {:ok, target} <- required(arguments, "target", :missing_target),
         {:ok, relation} <- Context.delete_blocker(project_slug, identifier, target, @type_default) do
      {:ok, %{tool: @tool, message: "Removed blocker #{target} from #{identifier}.", data: %{blocker: TrackerPresenter.blocker(relation)}}}
    end
  end

  defp normalize_action(action) when action in ["list", "create", "delete"], do: {:ok, String.to_existing_atom(action)}
  defp normalize_action(action) when is_binary(action), do: {:error, {:invalid_action, action}}
  defp normalize_action(_), do: {:error, {:invalid_action, nil}}

  defp required(arguments, key, error) do
    case Map.get(arguments, key) do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> {:error, error}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, error}
    end
  end
end
```

> `TrackerPresenter.blocker/1` expects `source_issue`/`target_issue` to be loaded.
> `Context.add_blocker/4` runs `preload_relation_result/1` and `Context.list_blockers/2`
> preloads `[:source_issue, :target_issue]`. `delete_blocker/4` returns the relation from
> `Repo.delete` — its `source_issue`/`target_issue` may not be preloaded, so
> `loaded_issue_identifier/1` returns nil for those; that is acceptable (the message
> already names both issues). Confirm `loaded_issue_identifier/1` tolerates
> `%Ecto.Association.NotLoaded{}` (it pattern-matches `%IssueRecord{}` else nil — safe).

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Wire into `ToolExecutor` + `ProjectBoardTools`** (assistant only)

`@tracker_tools` += `manage_blockers`; alias; append spec; `do_execute`:

```elixir
defp do_execute(project, "manage_blockers", arguments, opts) do
  case BlockerTools.execute(project_slug(project), arguments, opts) do
    {:ok, result} -> {:ok, result}
    {:error, reason} -> {:error, reason}
  end
end
```

`ProjectBoardTools` `@scoped_tools` += `manage_blockers`.

- [ ] **Step 6: Run — expect PASS** then **Commit**

```bash
git commit -m "feat(assistant): manage_blockers tool"
```

---

### Task 5: `SyncTools` — `sync_issue`

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/sync_tools.ex`
- Create: `elixir/test/symphony_elixir/assistant/sync_tools_test.exs`

- [ ] **Step 1: Write failing tests** (inject the sync fn; local projects return `:not_supported_on_remote`)

```elixir
defmodule SymphonyElixir.Assistant.SyncToolsTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Assistant.SyncTools
  alias SymphonyElixir.LocalTracker.Context

  defp issue_fixture do
    {:ok, _} = Context.ensure_project(%{name: "Macro", slug: "macro"})
    {:ok, issue} = Context.create_issue("macro", %{"title" => "T", "status" => "Todo"})
    issue
  end

  test "spec requires identifier" do
    spec = SyncTools.assistant_tool_spec()
    assert spec["name"] == "sync_issue"
    assert "identifier" in spec["inputSchema"]["required"]
  end

  test "returns the refreshed issue on success" do
    issue = issue_fixture()

    assert {:ok, result} =
             SyncTools.execute("macro", %{"identifier" => issue.identifier},
               sync_issue: fn _project, _identifier -> {:ok, :synced} end
             )

    assert result.tool == "sync_issue"
    assert result.data.issue.identifier == issue.identifier
  end

  test "surfaces sync errors as structured failures" do
    issue = issue_fixture()

    assert {:error, :not_supported_on_remote} =
             SyncTools.execute("macro", %{"identifier" => issue.identifier},
               sync_issue: fn _project, _identifier -> {:error, :not_supported_on_remote} end
             )
  end
end
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Assistant.SyncTools do
  @moduledoc false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.Tracker.Sync.Engine
  alias SymphonyElixirWeb.TrackerPresenter

  @tool "sync_issue"

  @description """
  Force-pull a single issue from its remote tracker (GitHub/Linear/Jira) and return the refreshed local copy.
  Use after the issue was edited outside Symphony. No-op error for local-only projects.
  """

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    %{
      "name" => @tool,
      "description" => String.trim(@description),
      "inputSchema" => %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["identifier"],
        "properties" => %{
          "identifier" => %{"type" => "string", "description" => "Issue identifier, for example MAC-1."}
        }
      }
    }
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    sync_fun = Keyword.get(opts, :sync_issue, &Engine.sync_issue/2)

    with {:ok, identifier} <- required_identifier(arguments),
         {:ok, project} <- Context.get_project(project_slug),
         {:ok, _record} <- sync_fun.(project, identifier),
         {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      {:ok,
       %{
         tool: @tool,
         message: "Synced #{identifier} from its remote tracker.",
         data: %{issue: TrackerPresenter.issue(issue)}
       }}
    end
  end

  defp required_identifier(arguments) do
    case Map.get(arguments, "identifier") do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> {:error, :missing_identifier}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, :missing_identifier}
    end
  end
end
```

> `IssueAdapter.dispatch(project, :get_issue, [identifier])` returns the backend's
> normalized `%Issue{}` (or `%IssueDTO{}`). `TrackerPresenter.issue/1` has clauses for
> `IssueDTO` and `IssueRecord`. If a backend returns a bare `%Issue{}` without an
> `issue/1` clause, present via the matching clause used by the issue controller (the
> controller calls `TrackerPresenter.issue(issue)` on the dispatch result, so this is
> already a supported shape — mirror the controller exactly).

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Wire into `ToolExecutor` + `ProjectBoardTools`** (assistant only)

`@tracker_tools` += `sync_issue`; alias; append spec; `do_execute`:

```elixir
defp do_execute(project, "sync_issue", arguments, opts) do
  case SyncTools.execute(project_slug(project), arguments, opts) do
    {:ok, result} -> {:ok, result}
    {:error, reason} -> {:error, reason}
  end
end
```

`ProjectBoardTools` `@scoped_tools` += `sync_issue`.

- [ ] **Step 6: Tool-spec integration test** in `tool_executor_test.exs`:

```elixir
test "tool_specs includes phase 2/3 tools" do
  names = ToolExecutor.tool_specs() |> Enum.map(& &1["name"])
  for tool <- ~w(link_pull_request get_issue_orchestrator_state explain_dispatch_eligibility manage_blockers sync_issue) do
    assert tool in names
  end
end
```

- [ ] **Step 7: Run — expect PASS** then **Commit**

```bash
git commit -m "feat(assistant): sync_issue tool + phase 2/3 spec wiring"
```

---

### Task 6: In-daemon CLI dispatcher `SymphonyElixir.Tracker.Cli`

**Files:**
- Create: `elixir/lib/symphony_elixir/tracker/cli.ex`
- Create: `elixir/test/symphony_elixir/tracker/cli_test.exs`
- Modify: `elixir/lib/symphony_elixir/ctl.ex` (reload list)

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.Tracker.CliTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.Cli

  test "list_tracker_projects works without a slug" do
    {:ok, _} = Context.ensure_project(%{name: "Macro", slug: "macro"})
    assert {:ok, result} = Cli.call("list_tracker_projects", nil, %{})
    assert result.tool == "list_tracker_projects"
  end

  test "routes a project-scoped tool to ToolExecutor" do
    {:ok, _} = Context.ensure_project(%{name: "Macro", slug: "macro"})
    {:ok, issue} = Context.create_issue("macro", %{"title" => "T", "status" => "Todo"})

    assert {:ok, result} = Cli.call("get_issue", "macro", %{"identifier" => issue.identifier})
    assert result.tool == "get_issue"
  end

  test "requires a slug for project-scoped tools" do
    assert {:error, :project_slug_required} = Cli.call("get_issue", nil, %{"identifier" => "X-1"})
  end
end
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Tracker.Cli do
  @moduledoc """
  In-daemon dispatcher for the `mix symphony.tracker` CLI. Runs inside the live
  Symphony daemon (invoked over `:erpc`) so the tracker SQLite database keeps a
  single owner. Maps a tool name + project slug + argument map onto the same
  `SymphonyElixir.Assistant.ToolExecutor` surface the chat assistant uses, and
  returns the structured `{:ok, %{tool, message, data}}` result unchanged.
  """

  alias SymphonyElixir.Assistant.{DiscoveryTools, ToolExecutor}

  @discovery_tools DiscoveryTools.tools()

  @spec call(String.t(), String.t() | nil, map()) :: {:ok, map()} | {:error, term()}
  def call(tool, project_slug, arguments)
      when is_binary(tool) and (is_nil(project_slug) or is_binary(project_slug)) and is_map(arguments) do
    cond do
      tool in @discovery_tools -> DiscoveryTools.execute(tool, arguments, [])
      is_binary(project_slug) -> ToolExecutor.execute(project_slug, tool, arguments)
      true -> {:error, :project_slug_required}
    end
  end
end
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Add to `Ctl` reload list** so `make update` hot-reloads it:

In `elixir/lib/symphony_elixir/ctl.ex` `@assistant_reload_modules`, add the 5 new tool
modules plus `SymphonyElixir.Tracker.Cli`:

```elixir
SymphonyElixir.Assistant.BlockerTools,
SymphonyElixir.Assistant.DispatchTools,
SymphonyElixir.Assistant.OrchestratorTools,
SymphonyElixir.Assistant.PullRequestTools,
SymphonyElixir.Assistant.SyncTools,
SymphonyElixir.Tracker.Cli,
```

(Keep the list alphabetical where the file already is.)

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(tracker): in-daemon CLI dispatcher over ToolExecutor"
```

---

### Task 7: `mix symphony.tracker` CLI task

**Files:**
- Create: `elixir/lib/mix/tasks/symphony.tracker.ex`
- Create: `elixir/test/mix/tasks/symphony_tracker_test.exs`

The task: parse argv → `{tool, slug, args}` via a declarative command table, connect to
the daemon (reusing `SymphonyElixir.Ctl` discovery + the `mix symphony.ctl` connect
dance), `:erpc.call(node, SymphonyElixir.Tracker.Cli, :call, [tool, slug, args])`, then
print. Parsing is a pure function (`build/1`) so it is unit-testable without a daemon.

- [ ] **Step 1: Write failing tests for `build/1`**

```elixir
defmodule Mix.Tasks.Symphony.TrackerTest do
  use ExUnit.Case, async: true

  alias Mix.Tasks.Symphony.Tracker

  test "issues maps to list_issues with slug and search switch" do
    assert {:ok, "list_issues", "macro", args, _opts} =
             Tracker.build(["issues", "macro", "--search", "login"])

    assert args["search"] == "login"
  end

  test "issue maps to get_issue with identifier" do
    assert {:ok, "get_issue", "macro", %{"identifier" => "MAC-1"}, _opts} =
             Tracker.build(["issue", "macro", "MAC-1"])
  end

  test "move maps positionals to identifier and status" do
    assert {:ok, "move_issue", "macro", args, _} = Tracker.build(["move", "macro", "MAC-1", "In Progress"])
    assert args["identifier"] == "MAC-1"
    assert args["status"] == "In Progress"
  end

  test "pr-link maps to link_pull_request" do
    assert {:ok, "link_pull_request", "macro", args, _} =
             Tracker.build(["pr-link", "macro", "MAC-1", "https://github.com/o/r/pull/9"])

    assert args["url"] == "https://github.com/o/r/pull/9"
  end

  test "blockers-add maps to manage_blockers create" do
    assert {:ok, "manage_blockers", "macro", args, _} =
             Tracker.build(["blockers-add", "macro", "MAC-1", "MAC-2"])

    assert args["action"] == "create"
    assert args["target"] == "MAC-2"
  end

  test "projects needs no slug" do
    assert {:ok, "list_tracker_projects", nil, %{}, _} = Tracker.build(["projects"])
  end

  test "--json sets json option" do
    assert {:ok, _tool, _slug, _args, opts} = Tracker.build(["issue", "macro", "MAC-1", "--json"])
    assert opts[:json] == true
  end

  test "unknown command is an error" do
    assert {:error, {:unknown_command, "wat"}} = Tracker.build(["wat"])
  end

  test "missing positionals is an error" do
    assert {:error, {:missing_args, "move"}} = Tracker.build(["move", "macro"])
  end
end
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd elixir && mix test test/mix/tasks/symphony_tracker_test.exs`

- [ ] **Step 3: Implement**

```elixir
defmodule Mix.Tasks.Symphony.Tracker do
  @shortdoc "Run tracker tools from the shell against the running Symphony daemon"
  @moduledoc """
  Thin CLI over the same assistant tools the chat assistant uses. Connects to the
  running Symphony daemon over distributed Erlang (start it with `make serve` first).

      mix symphony.tracker projects
      mix symphony.tracker issues <slug> [--search TEXT]
      mix symphony.tracker issue <slug> <identifier>
      mix symphony.tracker move <slug> <identifier> <status>
      mix symphony.tracker comment <slug> <identifier> <body>
      mix symphony.tracker comments <slug> <identifier>
      mix symphony.tracker dispatch <slug> <identifier> --instructions TEXT [--agent codex]
      mix symphony.tracker sync <slug> <identifier>
      mix symphony.tracker evidence <slug> <identifier>
      mix symphony.tracker handoff <slug> <identifier>
      mix symphony.tracker orchestrator <slug> <identifier>
      mix symphony.tracker dispatch-explain <slug> <identifier>
      mix symphony.tracker pr-link <slug> <identifier> <url>
      mix symphony.tracker preview <slug> <identifier> [status|start|stop|restart]
      mix symphony.tracker dev-env <slug> <action> [--step-id ID] [--category CAT]
      mix symphony.tracker blockers <slug> <identifier>
      mix symphony.tracker blockers-add <slug> <identifier> <target>
      mix symphony.tracker blockers-rm <slug> <identifier> <target>

  Add `--json` to print the full structured `{tool, message, data}` as one JSON line.
  """

  use Mix.Task

  @switches [search: :string, instructions: :string, agent: :string, step_id: :string, category: :string, json: :boolean]

  # {command, tool, needs_slug?, [positional_arg_keys], %{static args}}
  @commands [
    {"projects", "list_tracker_projects", false, [], %{}},
    {"issues", "list_issues", true, [], %{}},
    {"issue", "get_issue", true, ["identifier"], %{}},
    {"move", "move_issue", true, ["identifier", "status"], %{}},
    {"comment", "add_comment", true, ["identifier", "body"], %{}},
    {"comments", "list_comments", true, ["identifier"], %{}},
    {"dispatch", "dispatch_coding_agent", true, ["identifier"], %{}},
    {"sync", "sync_issue", true, ["identifier"], %{}},
    {"evidence", "get_evidence_status", true, ["identifier"], %{}},
    {"handoff", "check_handoff_gate", true, ["identifier"], %{}},
    {"orchestrator", "get_issue_orchestrator_state", true, ["identifier"], %{}},
    {"dispatch-explain", "explain_dispatch_eligibility", true, ["identifier"], %{}},
    {"pr-link", "link_pull_request", true, ["identifier", "url"], %{}},
    {"preview", "manage_preview", true, ["identifier", "action"], %{"action" => "status"}},
    {"dev-env", "manage_dev_env", true, ["action"], %{}},
    {"blockers", "manage_blockers", true, ["identifier"], %{"action" => "list"}},
    {"blockers-add", "manage_blockers", true, ["identifier", "target"], %{"action" => "create"}},
    {"blockers-rm", "manage_blockers", true, ["identifier", "target"], %{"action" => "delete"}}
  ]

  @impl true
  def run(argv) do
    case build(argv) do
      {:ok, tool, slug, args, opts} -> dispatch(tool, slug, args, opts)
      {:error, reason} -> Mix.raise(error_message(reason))
    end
  end

  @doc false
  @spec build([String.t()]) ::
          {:ok, String.t(), String.t() | nil, map(), keyword()} | {:error, term()}
  def build([command | rest]) do
    case Enum.find(@commands, fn {name, _, _, _, _} -> name == command end) do
      nil ->
        {:error, {:unknown_command, command}}

      {_name, tool, needs_slug?, positional_keys, static} ->
        {parsed, positionals, _invalid} = OptionParser.parse(rest, switches: @switches)
        build_command(command, tool, needs_slug?, positional_keys, static, positionals, parsed)
    end
  end

  def build([]), do: {:error, :no_command}

  defp build_command(command, tool, needs_slug?, positional_keys, static, positionals, parsed) do
    {slug, value_args} = split_slug(needs_slug?, positionals)

    if length(value_args) < length(positional_keys) do
      {:error, {:missing_args, command}}
    else
      positional_map =
        positional_keys
        |> Enum.zip(value_args)
        |> Map.new()

      args =
        static
        |> Map.merge(positional_map)
        |> Map.merge(switch_args(parsed))

      {:ok, tool, slug, args, [json: Keyword.get(parsed, :json, false)]}
    end
  end

  defp split_slug(false, positionals), do: {nil, positionals}
  defp split_slug(true, [slug | rest]), do: {slug, rest}
  defp split_slug(true, []), do: {nil, []}

  defp switch_args(parsed) do
    parsed
    |> Keyword.delete(:json)
    |> Enum.reduce(%{}, fn {key, value}, acc ->
      Map.put(acc, switch_key(key), value)
    end)
  end

  defp switch_key(:step_id), do: "step_id"
  defp switch_key(:category), do: "category_filter"
  defp switch_key(key), do: Atom.to_string(key)

  defp dispatch(tool, slug, args, opts) do
    on_daemon(fn node ->
      case :erpc.call(node, SymphonyElixir.Tracker.Cli, :call, [tool, slug, args]) do
        {:ok, result} -> print_result(result, opts)
        {:error, reason} -> Mix.raise("tool error: #{inspect(reason)}")
      end
    end)
  end

  defp print_result(result, opts) do
    if Keyword.get(opts, :json, false) do
      Mix.shell().info(Jason.encode!(result))
    else
      Mix.shell().info(result[:message] || result["message"] || "")
      data = result[:data] || result["data"] || %{}
      Mix.shell().info(Jason.encode!(data, pretty: true))
    end
  end

  # --- daemon connection (mirrors Mix.Tasks.Symphony.Ctl.on_daemon/1) ---

  defp on_daemon(fun) do
    node = String.to_atom(SymphonyElixir.Ctl.node_name())
    ensure_distributed!()
    Node.set_cookie(String.to_atom(SymphonyElixir.Ctl.cookie()))

    case Node.connect(node) do
      true -> fun.(node)
      _ -> Mix.raise("Could not connect to Symphony daemon node #{node}. Run `make serve` first.")
    end
  end

  defp ensure_distributed! do
    if node() == :nonode@nohost do
      ctl_node = :"symphony_tracker_cli_#{:erlang.unique_integer([:positive])}@127.0.0.1"
      {:ok, _} = Node.start(ctl_node, :longnames)
    end

    :ok
  end

  defp error_message({:unknown_command, command}), do: "unknown command #{inspect(command)} (see `mix help symphony.tracker`)"
  defp error_message({:missing_args, command}), do: "missing arguments for #{inspect(command)} (see `mix help symphony.tracker`)"
  defp error_message(:no_command), do: "usage: mix symphony.tracker <command> [args] (see `mix help symphony.tracker`)"
  defp error_message(reason), do: "invalid invocation: #{inspect(reason)}"
end
```

- [ ] **Step 4: Run parsing tests — expect PASS**

- [ ] **Step 5: Manual smoke (with daemon running)**

```bash
cd elixir && make serve
mix symphony.tracker projects
mix symphony.tracker issue <slug> <id> --json | jq .data.status
```
Expected: JSON with the issue payload; non-zero exit + clear message when the daemon is down.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/mix/tasks/symphony.tracker.ex elixir/test/mix/tasks/symphony_tracker_test.exs
git commit -m "feat(cli): mix symphony.tracker over the running daemon"
```

---

### Task 8: Prompts, skills, docs, spec status, full gate

**Files:** `codex_session.ex`, evidence/workflow skills (×3 mirrors each), `elixir/README.md`,
the design spec.

- [ ] **Step 1: Prompt** — in `assistant/codex_session.ex`, add to the tool guidance:
  `link_pull_request` after opening a PR; `get_issue_orchestrator_state` /
  `explain_dispatch_eligibility` for "why isn't this running?"; `manage_blockers` for
  dependencies; `sync_issue` after external edits. Keep it short (tool names + when).

- [ ] **Step 2: Skills** — `skills/workflow/SKILL.md` (+ `.claude` + `.codex` mirrors):
  add a short "Diagnose / repair" list referencing `explain_dispatch_eligibility`,
  `get_issue_orchestrator_state`, `manage_blockers`, `sync_issue`, and the
  `mix symphony.tracker` CLI. In `skills/evidence/SKILL.md` (×3) add `link_pull_request`
  to the publish-gate step.

- [ ] **Step 3: README** — document `mix symphony.tracker` (the command table + `--json`
  + "requires `make serve`") near the existing `mix symphony.*` docs in `elixir/README.md`.

- [ ] **Step 4: Spec status** — in
  `docs/superpowers/specs/2026-06-17-tracker-agent-tools-design.md` update the rollout +
  open-questions: Phase 2 and Phase 3 are implemented; the CLI is implemented as
  `mix symphony.tracker` (thin RPC shell over `ToolExecutor`), superseding the "deferred"
  note.

- [ ] **Step 5: Prompt snapshot tests** — run and update assertions if they list tools:

Run: `cd elixir && mix test test/symphony_elixir/assistant/codex_session_test.exs test/symphony_elixir/assistant/codex_session_agent_test.exs`

- [ ] **Step 6: Full gate**

Run: `cd elixir && make all`
Expected: format, credo, specs.check, tests, dialyzer all pass.

Run: `cd elixir && mix specs.check`
Expected: no missing `@spec` on new public `def`s.

- [ ] **Step 7: Commit**

```bash
git commit -m "docs(agent): reference phase 2/3 tools + symphony.tracker CLI in prompts, skills, README, spec"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `link_pull_request` (A+B) | Task 1 |
| `get_issue_orchestrator_state` (B) | Task 2 |
| `explain_dispatch_eligibility` (B) | Task 3 |
| `manage_blockers` (B) | Task 4 |
| `sync_issue` (B) | Task 5 |
| CLI `mix symphony.tracker` (deferred → now built) | Tasks 6–7 |
| Prompts/skills/docs/spec status | Task 8 |

## Execution notes

- `@moduledoc false` on tool modules to match siblings; public `def`s need `@spec`.
- Inject deps via `opts` in tests (`link_pull_request:`, `orchestrator_state:`,
  `sync_issue:`, `dispatch_states:`, `require_symphony_label:`) — never bypass real code
  paths in production.
- The CLI never starts the app; it only RPCs the daemon. Do not add `app.start`.
- Before each "wire into ToolExecutor" step, re-read the current `build_tool_specs/0`
  tail and the `alias SymphonyElixir.Assistant.{...}` block so the append matches the
  live file (Phase 1 may have shifted line numbers).
