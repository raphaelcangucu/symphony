# Issue Authoring Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the create-issue modal with an assistant chat mapped to an issue that creates a draft early, runs simple/complex modes (complex = superpowers in-chat writing spec/plan into the issue working tree), surfaces those documents read-only in the assistant and issue detail, enriches the description, and lets the orchestrator continue from the artifacts — with an opt-in Codex Goal mode for long tasks.

**Architecture:** Reuses the existing Phoenix channel + Codex assistant (`AssistantChannel` → `Assistant.CodexSession` → `Codex.CodingAgent`) and `ToolExecutor` tools. Adds issue-scoped threads (`scope:"issue"`) whose Codex turns run inside the per-issue `Workspace.path_for_issue/1` (cloned repos), vendored superpowers skills injected into the complex-mode prompt, a sandboxed document API over `docs/superpowers/` in the working tree, a reusable read-only `DocumentViewer`, new assistant routes, a split-button entry point, an Agent-tab split (Authoring/Execution), `PromptBuilder` artifact injection for orchestrator continuity, and a `thread/goal/set` Goal mode in `CodingAgent`.

**Tech Stack:** Elixir/Phoenix (Ecto, Phoenix.Channel, JSON-RPC over Codex app-server), React + TypeScript (Vite, react-router, @assistant-ui/react, phoenix.js), Vitest, ExUnit.

**Spec:** `docs/superpowers/specs/2026-05-31-issue-authoring-assistant-design.md`

---

## Conventions for every task

- Backend tests: `cd elixir && mix test <path>`. Full gate before handoff: `cd elixir && make all` (format, lint, coverage, dialyzer) and `cd elixir && mix specs.check` (every `def` in `lib/` needs an adjacent `@spec`).
- Frontend tests: `cd tracker && npx vitest run <path>`. Lint/build: `cd tracker && npm run lint && npm run build`.
- Commit after each task (frequent commits). Work on the current branch (no worktree).
- Elixir: public `def` requires `@spec`. Follow existing module patterns.

---

## File Structure (decomposition)

**Backend — new**
- `skills/superpowers/brainstorming/SKILL.md`, `skills/superpowers/writing-plans/SKILL.md`, `skills/README.md` — vendored, agent-agnostic skill files.
- `elixir/lib/symphony_elixir/skills.ex` — `SymphonyElixir.Skills`: loads vendored `SKILL.md` content.
- `elixir/lib/symphony_elixir/assistant/issue_documents.ex` — `Assistant.IssueDocuments`: sandboxed list/read of `docs/superpowers/` in a workspace.
- `elixir/lib/symphony_elixir_web/controllers/tracker/issue_document_controller.ex` — HTTP boundary.

**Backend — modified**
- `assistant/history.ex` — `ensure_issue_thread/3`, `set_mode/2`.
- `assistant/codex_session.ex` — `send_message_to_issue_thread/4`, issue workspace, mode prompts, doc-change detection.
- `assistant/tool_executor.ex` — `create_draft_issue` tool + issue binding.
- `channels/assistant_channel.ex` — route issue threads; broadcast `assistant_document_changed`.
- `codex/coding_agent.ex` + `codex/config.ex` — `thread/goal/set`, goal loop, `goals_enabled?`.
- `prompt_builder.ex` — inject spec/plan/handoff from workspace.
- `config.ex` — `assistant_draft_status/0`.
- `web/router.ex`, `web/presenters/tracker_presenter.ex`.

**Frontend — new**
- `tracker/src/types/issueDocument.ts`, `tracker/src/services/issueDocuments.ts`, `tracker/src/hooks/useIssueDocuments.ts`.
- `tracker/src/components/assistant/DocumentViewer.tsx`.
- `tracker/src/components/assistant/IssueAuthoringPanel.tsx` (wraps `ProjectAssistantPanel` + `DocumentViewer`).
- `tracker/src/components/workspace/IssueAssistantRoute.tsx`.
- `tracker/src/components/issues/NewIssueMenu.tsx` (split-button).

**Frontend — modified**
- `tracker/src/App.tsx` (routes), `lib/workspaceRoutes.ts` (paths + `"agent"` already a tab), `services/issues.ts` (createDraftIssue helper if needed).
- `components/issues/IssueDrawer.tsx` (Agent tab split), `components/layout/ProjectHeader.tsx`, `components/board/BoardColumn.tsx`.

---

# PHASE 1 — Backend foundation (issue-scoped threads, working tree, draft)

## Task 1: `Config.assistant_draft_status/0`

**Files:**
- Modify: `elixir/lib/symphony_elixir/config.ex`
- Test: `elixir/test/symphony_elixir/config_test.exs`

- [ ] **Step 1: Write the failing test**

Add to `config_test.exs`:

```elixir
describe "assistant_draft_status/0" do
  test "defaults to Triage when unset" do
    assert SymphonyElixir.Config.assistant_draft_status() == "Triage"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/config_test.exs -k assistant_draft_status`
Expected: FAIL with `UndefinedFunctionError` for `assistant_draft_status/0`.

- [ ] **Step 3: Implement**

In `config.ex`, add near other accessors (follow the existing `section/1` pattern used by `Codex.Config`):

```elixir
@default_assistant_draft_status "Triage"

@spec assistant_draft_status() :: String.t()
def assistant_draft_status do
  case section("assistant")["draft_status"] do
    value when is_binary(value) and value != "" -> String.trim(value)
    _ -> @default_assistant_draft_status
  end
end
```

If `section/1` is private in `config.ex`, mirror the local accessor used by neighbors. If an `assistant` section helper does not exist, read via the same mechanism other sections use (`section("assistant")`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/config_test.exs -k assistant_draft_status`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/config.ex elixir/test/symphony_elixir/config_test.exs
git commit -m "feat(assistant): add assistant_draft_status config accessor"
```

## Task 2: `History.ensure_issue_thread/3` and `set_mode/2`

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/history.ex`
- Test: `elixir/test/symphony_elixir/assistant/history_test.exs`

- [ ] **Step 1: Write the failing test**

Add to `history_test.exs` (follow existing setup that creates a project via `Context`):

```elixir
describe "ensure_issue_thread/3" do
  setup do
    {:ok, _project} = SymphonyElixir.LocalTracker.Context.create_project(%{name: "Macro", slug: "macro"})
    :ok
  end

  test "creates an issue-scoped thread bound to the identifier" do
    assert {:ok, thread} =
             History.ensure_issue_thread("macro", "MAC-1", %{workspace_path: "/tmp/ws"})

    assert thread.scope == "issue"
    assert thread.project_slug == "macro"
    assert thread.issue_identifier == "MAC-1"
    assert thread.status == "active"
  end

  test "returns the same active thread on repeat calls" do
    {:ok, a} = History.ensure_issue_thread("macro", "MAC-1", %{workspace_path: "/tmp/ws"})
    {:ok, b} = History.ensure_issue_thread("macro", "MAC-1", %{workspace_path: "/tmp/ws"})
    assert a.id == b.id
  end

  test "set_mode/2 persists the mode in metadata" do
    {:ok, thread} = History.ensure_issue_thread("macro", "MAC-1", %{workspace_path: "/tmp/ws"})
    assert {:ok, updated} = History.set_mode(thread, "complex")
    assert updated.metadata["mode"] == "complex"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/assistant/history_test.exs -k ensure_issue_thread`
Expected: FAIL (`ensure_issue_thread/3` undefined).

- [ ] **Step 3: Implement**

In `history.ex` add (alias `Context` is already imported):

```elixir
@spec ensure_issue_thread(String.t(), String.t(), attrs()) :: {:ok, Thread.t()} | {:error, term()}
def ensure_issue_thread(project_slug, issue_identifier, attrs \\ %{})
    when is_binary(project_slug) and is_binary(issue_identifier) and is_map(attrs) do
  with {:ok, slug} <- normalize_required_string(project_slug, :project_slug),
       {:ok, identifier} <- normalize_required_string(issue_identifier, :issue_identifier),
       {:ok, _project} <- Context.get_project(slug) do
    case active_issue_thread(slug, identifier) do
      %Thread{} = thread -> {:ok, thread}
      nil -> create_issue_thread(slug, identifier, attrs)
    end
  end
end

@spec set_mode(Thread.t(), String.t()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
def set_mode(%Thread{metadata: metadata} = thread, mode) when is_binary(mode) do
  next = Map.put(metadata || %{}, "mode", mode)
  update_thread(thread, %{metadata: next})
end

defp active_issue_thread(slug, identifier) do
  Repo.get_by(Thread, project_slug: slug, issue_identifier: identifier, scope: "issue", status: "active")
end

defp create_issue_thread(slug, identifier, attrs) do
  attrs
  |> Map.put(:scope, "issue")
  |> Map.put(:project_slug, slug)
  |> Map.put(:issue_identifier, identifier)
  |> Map.put_new(:status, "active")
  |> then(&Thread.changeset(%Thread{}, &1))
  |> Repo.insert()
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/assistant/history_test.exs -k ensure_issue_thread`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/history.ex elixir/test/symphony_elixir/assistant/history_test.exs
git commit -m "feat(assistant): ensure_issue_thread and set_mode in History"
```

## Task 3: `create_draft_issue` tool in `ToolExecutor`

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/tool_executor.ex`
- Test: `elixir/test/symphony_elixir/assistant/tool_executor_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
describe "create_draft_issue" do
  setup do
    {:ok, _project} = SymphonyElixir.LocalTracker.Context.create_project(%{name: "Macro", slug: "macro"})
    :ok
  end

  test "creates an issue in the non-actionable draft status" do
    assert {:ok, result} =
             ToolExecutor.execute("macro", "create_draft_issue", %{
               "title" => "Add export button",
               "description" => "quick note"
             })

    assert result.tool == "create_draft_issue"
    assert result.data.status == "Triage"
    assert result.data.title == "Add export button"
  end
end
```

(Ensure the test project's workflow has a "Triage" status; if the local tracker seeds default statuses without "Triage", add it in setup via `Context`/workflow seed, or set the draft status to a status the seed provides and update the assertion accordingly.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/assistant/tool_executor_test.exs -k create_draft_issue`
Expected: FAIL with `{:unsupported_tool, "create_draft_issue"}`.

- [ ] **Step 3: Implement**

Add `"create_draft_issue"` to `@supported_tools`. Add a tool spec entry in `tool_specs/0` (mirror `create_issue` but without `status`):

```elixir
tool_spec("create_draft_issue", "Create a draft tracker issue (non-actionable status) to anchor the authoring chat.", %{
  "type" => "object",
  "additionalProperties" => false,
  "required" => ["title"],
  "properties" => %{
    "title" => string_schema("Issue title."),
    "description" => string_schema("Optional short description.")
  }
}),
```

Add a `do_execute` clause:

```elixir
defp do_execute(project, "create_draft_issue", arguments, _opts) do
  with {:ok, title} <- normalize_required_string(Map.get(arguments, "title"), :title),
       attrs <- build_draft_attrs(arguments, title),
       {:ok, issue} <- IssueAdapter.dispatch(project, :create_issue, [attrs]) do
    presented = TrackerPresenter.issue(issue)

    {:ok, %{tool: "create_draft_issue", message: "Created draft #{presented.identifier}: #{presented.title}", data: presented}}
  end
end
```

Add the private builder (uses `Config.assistant_draft_status/0`; add `alias SymphonyElixir.Config`):

```elixir
defp build_draft_attrs(arguments, title) do
  %{
    "title" => title,
    "description" => Map.get(arguments, "description"),
    "status" => Config.assistant_draft_status()
  }
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/assistant/tool_executor_test.exs -k create_draft_issue`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/tool_executor.ex elixir/test/symphony_elixir/assistant/tool_executor_test.exs
git commit -m "feat(assistant): add create_draft_issue tool"
```

## Task 4: Issue-scoped Codex turns in the issue working tree

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/codex_session.ex`
- Test: `elixir/test/symphony_elixir/assistant/codex_session_test.exs`

- [ ] **Step 1: Write the failing test**

Use the injectable `:runner` opt (the channel/tests already inject runners). Capture the workspace the runner is called with:

```elixir
describe "send_message_to_issue_thread/4" do
  setup do
    {:ok, _project} = SymphonyElixir.LocalTracker.Context.create_project(%{name: "Macro", slug: "macro"})
    {:ok, thread} = History.ensure_issue_thread("macro", "MAC-1", %{workspace_path: "/tmp/ignored"})
    %{thread: thread}
  end

  test "runs the turn in the issue working tree", %{thread: thread} do
    test_pid = self()

    runner = fn workspace, _prompt, _issue, _opts ->
      send(test_pid, {:workspace, workspace})
      {:ok, %{assistant_message: "done", tool_calls: [], codex_thread_id: "ct", turn_id: "t1"}}
    end

    assert {:ok, result} =
             CodexSession.send_message_to_issue_thread(thread, "hi", %{}, runner: runner)

    assert result.assistant_message == "done"
    expected = SymphonyElixir.Workspace.path_for_issue("MAC-1")
    assert_receive {:workspace, ^expected}
  end

  test "complex mode injects superpowers methodology into the prompt", %{thread: thread} do
    {:ok, thread} = History.set_mode(thread, "complex")
    test_pid = self()

    runner = fn _workspace, prompt, _issue, _opts ->
      send(test_pid, {:prompt, prompt})
      {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "ct", turn_id: "t1"}}
    end

    {:ok, _} = CodexSession.send_message_to_issue_thread(thread, "build X", %{}, runner: runner)
    assert_receive {:prompt, prompt}
    assert prompt =~ "brainstorming"
    assert prompt =~ "docs/superpowers/specs"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/assistant/codex_session_test.exs -k send_message_to_issue_thread`
Expected: FAIL (`send_message_to_issue_thread/4` undefined).

- [ ] **Step 3: Implement**

Add to `codex_session.ex` (alias `SymphonyElixir.{Skills, Workspace}` plus existing aliases):

```elixir
@spec send_message_to_issue_thread(SymphonyElixir.Assistant.Thread.t(), String.t(), map(), keyword()) ::
        {:ok, turn_result()} | {:error, term()}
def send_message_to_issue_thread(
      %{scope: "issue", id: thread_id, project_slug: project_slug, issue_identifier: identifier} = thread,
      message,
      context,
      opts \\ []
    )
    when is_binary(message) and is_map(context) and is_list(opts) do
  with {:ok, trimmed} <- normalize_message(message),
       {:ok, workspace} <- ensure_issue_workspace(identifier),
       history <- thread_id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1),
       {:ok, user_message} <-
         History.append_message(thread, %{role: "user", content: trimmed, metadata: stringify_map(context)}),
       prompt <- build_issue_prompt(thread, trimmed, context, history),
       :ok <- maybe_call(opts, :on_message_created, History.message_payload(user_message)),
       {:ok, runner_result} <- run_issue_turn(workspace, prompt, project_slug, opts),
       {:ok, updated_thread} <- maybe_update_codex_thread(thread, runner_result),
       {:ok, assistant_message} <- persist_assistant_message(updated_thread, runner_result) do
    {:ok,
     %{
       assistant_message: assistant_message.content,
       tool_calls: assistant_message.tool_calls,
       codex_thread_id: Map.get(runner_result, :codex_thread_id),
       turn_id: Map.get(runner_result, :turn_id),
       user_message: History.message_payload(user_message),
       assistant_chat_message: History.message_payload(assistant_message)
     }}
  end
end

defp ensure_issue_workspace(identifier) do
  Workspace.create_for_issue(identifier)
end

defp run_issue_turn(workspace, prompt, project_slug, opts) do
  runner = Keyword.get(opts, :runner, &default_runner/4)

  runner_opts =
    opts
    |> Keyword.put(:project_slug, project_slug)
    |> Keyword.put_new(:dynamic_tools, ToolExecutor.tool_specs())
    |> Keyword.put_new(:tool_executor, ToolExecutor.codex_tool_executor(project_slug))

  runner.(workspace, prompt, assistant_issue(project_slug), runner_opts)
  |> normalize_runner_result()
end

defp build_issue_prompt(%{metadata: metadata, issue_identifier: identifier, project_slug: project_slug}, message, context, history) do
  mode = Map.get(metadata || %{}, "mode", "triage")

  base = """
  You are the Symphony issue authoring assistant for `#{project_slug}`, working on issue `#{identifier}`.
  You are running inside the issue's working tree (the project repositories are cloned here).
  Answer in the user's language. Use tracker tools to update the bound issue. Do not dispatch Codex unless asked.

  Recent conversation:
  #{format_history(history)}

  Context:
  #{inspect(context)}

  Current user message:
  #{message}
  """

  mode_section =
    case mode do
      "complex" ->
        """

        MODE: COMPLEX. Follow this vendored methodology exactly:
        #{Skills.load(["brainstorming", "writing-plans"])}

        Write spec files to `docs/superpowers/specs/` and plan files to `docs/superpowers/plans/`
        in this working tree. Get section-by-section approval in chat. Do not start writing feature code.
        """

      "simple" ->
        """

        MODE: SIMPLE. Search the repositories in this working tree for relevant context (README, code,
        conventions) and produce a fuller, formal issue description. Apply it with the update_issue tool
        for `#{identifier}`. Do not create spec/plan files.
        """

      _ ->
        "\n\nMODE: TRIAGE. Collect the title and a short description, then help decide simple vs complex."
    end

  String.trim(base <> mode_section)
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/assistant/codex_session_test.exs -k send_message_to_issue_thread`
Expected: PASS. (Requires Task 5 `Skills.load/1`; if running before Task 5, temporarily stub — prefer doing Task 5 first, then this. Reorder if needed.)

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/codex_session.ex elixir/test/symphony_elixir/assistant/codex_session_test.exs
git commit -m "feat(assistant): issue-scoped Codex turns in the issue working tree"
```

## Task 5: Vendored skills + `SymphonyElixir.Skills` loader

> Do this BEFORE Task 4 step 4 if you want Task 4 green first try (Task 4 calls `Skills.load/1`).

**Files:**
- Create: `skills/superpowers/brainstorming/SKILL.md`
- Create: `skills/superpowers/writing-plans/SKILL.md`
- Create: `skills/README.md`
- Create: `elixir/lib/symphony_elixir/skills.ex`
- Test: `elixir/test/symphony_elixir/skills_test.exs`

- [ ] **Step 1: Vendor the skill files**

Create `skills/README.md`:

```markdown
# Vendored agent skills

Agent-agnostic skill definitions (plain `SKILL.md` files) usable by Symphony's
assistant and by other agents/CLIs. Sourced from https://github.com/obra/superpowers
(static vendor; update manually). Loaded at runtime by `SymphonyElixir.Skills`.
```

Create `skills/superpowers/brainstorming/SKILL.md` and `skills/superpowers/writing-plans/SKILL.md` by copying the corresponding upstream `SKILL.md` bodies (the brainstorming and writing-plans skills). Keep them verbatim minus the YAML front matter's harness-specific notes.

- [ ] **Step 2: Write the failing test**

`elixir/test/symphony_elixir/skills_test.exs`:

```elixir
defmodule SymphonyElixir.SkillsTest do
  use ExUnit.Case, async: true
  alias SymphonyElixir.Skills

  test "load/1 returns concatenated skill bodies" do
    content = Skills.load(["brainstorming", "writing-plans"])
    assert content =~ "brainstorming"
    assert content =~ "writing-plans" or content =~ "Writing Plans"
  end

  test "load/1 ignores unknown skills" do
    assert Skills.load(["does-not-exist"]) == ""
  end

  test "available/0 lists vendored skills" do
    names = Skills.available()
    assert "brainstorming" in names
    assert "writing-plans" in names
  end
end
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/skills_test.exs`
Expected: FAIL (module undefined).

- [ ] **Step 4: Implement `skills.ex`**

```elixir
defmodule SymphonyElixir.Skills do
  @moduledoc "Loads vendored, agent-agnostic skill definitions from the repo `skills/` directory."

  @spec root() :: Path.t()
  def root do
    Application.get_env(:symphony_elixir, :skills_root) ||
      Path.expand(Path.join([:code.priv_dir(:symphony_elixir) |> to_string(), "..", "..", "..", "skills"]))
  end

  @spec available() :: [String.t()]
  def available do
    base = Path.join(root(), "superpowers")

    case File.ls(base) do
      {:ok, entries} ->
        entries
        |> Enum.filter(&File.regular?(Path.join([base, &1, "SKILL.md"])))
        |> Enum.sort()

      _ ->
        []
    end
  end

  @spec load([String.t()]) :: String.t()
  def load(names) when is_list(names) do
    names
    |> Enum.map(&read_skill/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n\n---\n\n")
  end

  defp read_skill(name) when is_binary(name) do
    path = Path.join([root(), "superpowers", name, "SKILL.md"])

    case File.read(path) do
      {:ok, body} -> body
      {:error, _} -> ""
    end
  end
end
```

Note: `root()` resolution must point at the repo `skills/` dir at runtime. The `:code.priv_dir` relative climb works for dev/`mix`; for releases set `config :symphony_elixir, :skills_root, "/app/skills"`. In `test`, set `config :symphony_elixir, :skills_root, Path.expand("../../skills", __DIR__)` in `config/test.exs` (point at the repo `skills/`).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/skills_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/ elixir/lib/symphony_elixir/skills.ex elixir/test/symphony_elixir/skills_test.exs elixir/config/test.exs
git commit -m "feat(skills): vendor superpowers skills and add Skills loader"
```

## Task 6: Route issue threads through the channel

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex`
- Test: `elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs`

- [ ] **Step 1: Write the failing test**

Add a test that joins `assistant:thread:<id>` for an issue thread and asserts `send_message` routes to the issue path (inject runner via `Application.put_env(:symphony_elixir, :assistant_runner, fn ...)`). Assert the runner receives the issue workspace path. Model it on existing channel tests.

```elixir
test "issue thread send_message routes to the issue working tree", %{socket: socket} do
  {:ok, _project} = Context.create_project(%{name: "Macro", slug: "macro"})
  {:ok, thread} = History.ensure_issue_thread("macro", "MAC-1", %{workspace_path: "/tmp/ws"})
  test_pid = self()

  Application.put_env(:symphony_elixir, :assistant_runner, fn workspace, _p, _i, _o ->
    send(test_pid, {:workspace, workspace})
    {:ok, %{assistant_message: "hi", tool_calls: [], codex_thread_id: "c", turn_id: "t"}}
  end)
  on_exit(fn -> Application.delete_env(:symphony_elixir, :assistant_runner) end)

  {:ok, _reply, socket} = subscribe_and_join(socket, "assistant:thread:#{thread.id}", %{})
  ref = push(socket, "send_message", %{"message" => "build X"})
  assert_reply ref, :ok
  assert_receive {:workspace, ws}
  assert ws == SymphonyElixir.Workspace.path_for_issue("MAC-1")
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs -k "issue working tree"`
Expected: FAIL (currently routes to `CodexSession.send_message/4`, wrong workspace).

- [ ] **Step 3: Implement**

In `assistant_channel.ex`, add a `run_send_turn` clause for issue scope BEFORE the generic clause:

```elixir
defp run_send_turn(%{scope: "issue"} = thread, _project_slug, trimmed, context, opts) do
  CodexSession.send_message_to_issue_thread(thread, trimmed, context, opts)
end
```

(`alias` already includes `CodexSession`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs`
Expected: PASS (incl. existing project/freeform tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir_web/channels/assistant_channel.ex elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs
git commit -m "feat(assistant): route issue-scoped threads to the issue working tree"
```

---

# PHASE 2 — Documents API (sandboxed read of working-tree docs)

## Task 7: `Assistant.IssueDocuments` (list/read with sandbox)

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/issue_documents.ex`
- Test: `elixir/test/symphony_elixir/assistant/issue_documents_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Assistant.IssueDocumentsTest do
  use ExUnit.Case, async: false
  alias SymphonyElixir.Assistant.IssueDocuments

  setup do
    root = Path.join(System.tmp_dir!(), "idocs-#{System.unique_integer([:positive])}")
    prev = Application.get_env(:symphony_elixir, :workspace_root)
    Application.put_env(:symphony_elixir, :workspace_root, root)
    File.mkdir_p!(Path.join([root, "MAC-1", "docs", "superpowers", "specs"]))
    File.write!(Path.join([root, "MAC-1", "docs", "superpowers", "specs", "2026-05-31-x-design.md"]), "# X Design\n\nbody")
    on_exit(fn ->
      Application.put_env(:symphony_elixir, :workspace_root, prev)
      File.rm_rf!(root)
    end)
    %{root: root}
  end

  test "list/1 returns specs with derived titles" do
    assert %{available: true, documents: [doc]} = IssueDocuments.list("MAC-1")
    assert doc.kind == "spec"
    assert doc.title == "X Design"
    assert doc.path == "docs/superpowers/specs/2026-05-31-x-design.md"
  end

  test "list/1 reports workspace_missing when the dir is absent" do
    assert %{available: false, reason: "workspace_missing", documents: []} = IssueDocuments.list("MAC-404")
  end

  test "read/2 returns the markdown body" do
    assert {:ok, "# X Design\n\nbody"} = IssueDocuments.read("MAC-1", "docs/superpowers/specs/2026-05-31-x-design.md")
  end

  test "read/2 rejects path traversal" do
    assert {:error, :invalid_path} = IssueDocuments.read("MAC-1", "../../../../etc/passwd")
    assert {:error, :invalid_path} = IssueDocuments.read("MAC-1", "docs/superpowers/../../secret.md")
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/assistant/issue_documents_test.exs`
Expected: FAIL (module undefined).

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Assistant.IssueDocuments do
  @moduledoc "Sandboxed read access to docs/superpowers/* inside an issue working tree."

  alias SymphonyElixir.Workspace

  @doc_root "docs/superpowers"
  @kinds %{"specs" => "spec", "plans" => "plan"}
  @max_bytes 512_000

  @type document :: %{id: String.t(), kind: String.t(), path: String.t(), title: String.t(), updated_at: String.t() | nil}

  @spec list(String.t()) :: %{available: boolean(), reason: String.t() | nil, documents: [document()]}
  def list(identifier) when is_binary(identifier) do
    workspace = Workspace.path_for_issue(identifier)
    base = Path.join(workspace, @doc_root)

    if File.dir?(base) do
      %{available: true, reason: nil, documents: collect(base) ++ handoff(base)}
    else
      %{available: false, reason: "workspace_missing", documents: []}
    end
  end

  @spec read(String.t(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def read(identifier, rel_path) when is_binary(identifier) and is_binary(rel_path) do
    workspace = Workspace.path_for_issue(identifier)

    with {:ok, abs} <- safe_join(workspace, rel_path),
         {:ok, %File.Stat{size: size}} when size <= @max_bytes <- File.stat(abs),
         {:ok, body} <- File.read(abs) do
      {:ok, body}
    else
      {:ok, %File.Stat{}} -> {:error, :too_large}
      {:error, :enoent} -> {:error, :not_found}
      {:error, _} = err -> err
    end
  end

  defp collect(base) do
    Enum.flat_map(@kinds, fn {dir, kind} ->
      base
      |> Path.join(dir)
      |> list_markdown()
      |> Enum.map(&to_document(&1, kind, Path.join([@doc_root, dir, Path.basename(&1)])))
    end)
  end

  defp handoff(base) do
    path = Path.join(base, "handoff.md")
    if File.regular?(path), do: [to_document(path, "handoff", Path.join(@doc_root, "handoff.md"))], else: []
  end

  defp list_markdown(dir) do
    case File.ls(dir) do
      {:ok, entries} -> entries |> Enum.filter(&String.ends_with?(&1, ".md")) |> Enum.map(&Path.join(dir, &1)) |> Enum.sort()
      _ -> []
    end
  end

  defp to_document(abs, kind, rel) do
    %{
      id: rel,
      kind: kind,
      path: rel,
      title: title_from(abs),
      updated_at: mtime(abs)
    }
  end

  defp title_from(abs) do
    case File.read(abs) do
      {:ok, body} ->
        body
        |> String.split("\n")
        |> Enum.find_value(fn line ->
          case Regex.run(~r/^#\s+(.+)$/, String.trim(line)) do
            [_, title] -> String.trim(title)
            _ -> nil
          end
        end) || Path.basename(abs)

      _ ->
        Path.basename(abs)
    end
  end

  defp mtime(abs) do
    case File.stat(abs, time: :posix) do
      {:ok, %File.Stat{mtime: secs}} -> secs |> DateTime.from_unix!() |> DateTime.to_iso8601()
      _ -> nil
    end
  end

  defp safe_join(workspace, rel_path) do
    allowed = Path.expand(Path.join(workspace, @doc_root))
    candidate = Path.expand(Path.join(workspace, rel_path))

    if candidate == allowed or String.starts_with?(candidate, allowed <> "/") do
      {:ok, candidate}
    else
      {:error, :invalid_path}
    end
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/assistant/issue_documents_test.exs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/issue_documents.ex elixir/test/symphony_elixir/assistant/issue_documents_test.exs
git commit -m "feat(assistant): sandboxed IssueDocuments list/read"
```

## Task 8: `IssueDocumentController` + routes + presenter

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/issue_document_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Modify: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/issue_document_controller_test.exs`

- [ ] **Step 1: Write the failing test**

Model on existing tracker controller tests (authenticated conn helper). Assert:
- `GET .../issues/MAC-1/documents` → `200` with `%{"data" => %{"available" => true, "documents" => [...]}}`.
- `GET .../issues/MAC-1/documents/docs/superpowers/specs/<file>` → `200` with `%{"data" => %{"content" => "..."}}`.
- traversal path → `400`/`422` via `TrackerErrors`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/issue_document_controller_test.exs`
Expected: FAIL (route/controller undefined).

- [ ] **Step 3: Implement controller**

```elixir
defmodule SymphonyElixirWeb.Tracker.IssueDocumentController do
  @moduledoc "Read access to superpowers documents in an issue working tree."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Assistant.IssueDocuments
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"identifier" => identifier}) do
    json(conn, %{data: IssueDocuments.list(identifier)})
  end

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"identifier" => identifier, "path" => path_segments}) do
    rel = Enum.join(List.wrap(path_segments), "/")

    case IssueDocuments.read(identifier, rel) do
      {:ok, content} -> json(conn, %{data: %{path: rel, content: content}})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
end
```

- [ ] **Step 4: Add routes**

In `router.ex` after the terminal/dev_servers issue routes (around line 87):

```elixir
get("/projects/:project_slug/issues/:identifier/documents", IssueDocumentController, :index)
get("/projects/:project_slug/issues/:identifier/documents/*path", IssueDocumentController, :show)
```

Ensure `TrackerErrors.render/2` handles `:invalid_path` (→ 422) and `:not_found` (→ 404); add clauses if missing.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/issue_document_controller_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/issue_document_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex elixir/test/symphony_elixir_web/controllers/tracker/issue_document_controller_test.exs
git commit -m "feat(assistant): issue document API endpoints"
```

## Task 9: Broadcast `assistant_document_changed` after doc-writing turns

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/codex_session.ex`
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex`
- Test: extend `codex_session_test.exs` and `assistant_channel_test.exs`

- [ ] **Step 1: Write the failing test**

In `codex_session_test.exs`, assert that an `:on_documents_changed` callback fires when the turn modifies `docs/superpowers/`. Use a runner that writes a file into the issue workspace before returning:

```elixir
test "fires on_documents_changed when a turn writes a doc", %{thread: thread} do
  test_pid = self()
  ws = SymphonyElixir.Workspace.path_for_issue("MAC-1")

  runner = fn _w, _p, _i, _o ->
    File.mkdir_p!(Path.join([ws, "docs", "superpowers", "specs"]))
    File.write!(Path.join([ws, "docs", "superpowers", "specs", "new.md"]), "# New")
    {:ok, %{assistant_message: "wrote spec", tool_calls: [], codex_thread_id: "c", turn_id: "t"}}
  end

  {:ok, _} =
    CodexSession.send_message_to_issue_thread(thread, "spec it", %{},
      runner: runner,
      on_documents_changed: fn id -> send(test_pid, {:docs_changed, id}) end
    )

  assert_receive {:docs_changed, "MAC-1"}
end
```

(Set `:workspace_root` in this test's setup to a tmp dir, mirroring Task 7 setup.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/assistant/codex_session_test.exs -k on_documents_changed`
Expected: FAIL (callback never called).

- [ ] **Step 3: Implement**

In `send_message_to_issue_thread/4`, snapshot doc mtimes before/after the turn and fire the callback when changed:

```elixir
# before run_issue_turn:
docs_before = doc_fingerprint(identifier)
# after persist_assistant_message succeeds:
maybe_notify_documents(identifier, docs_before, opts)
```

Add:

```elixir
defp doc_fingerprint(identifier) do
  identifier |> SymphonyElixir.Assistant.IssueDocuments.list() |> Map.get(:documents) |> Enum.map(&{&1.path, &1.updated_at}) |> Enum.sort()
end

defp maybe_notify_documents(identifier, before, opts) do
  if doc_fingerprint(identifier) != before do
    maybe_call(opts, :on_documents_changed, identifier)
  else
    :ok
  end
end
```

Thread the call into the `with` pipeline (call it just before building the `{:ok, ...}` result).

- [ ] **Step 4: Wire the channel callback**

In `assistant_channel.ex` `handle_in("send_message", ...)`, add to `opts`:

```elixir
|> Keyword.put(:on_documents_changed, fn identifier ->
  push(socket, "assistant_document_changed", %{identifier: identifier})
end)
```

Add a channel test asserting the `assistant_document_changed` push is received for an issue thread when the runner writes a doc.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir/assistant/codex_session_test.exs test/symphony_elixir_web/channels/assistant_channel_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/codex_session.ex elixir/lib/symphony_elixir_web/channels/assistant_channel.ex elixir/test/symphony_elixir
git commit -m "feat(assistant): broadcast assistant_document_changed after doc-writing turns"
```

---

# PHASE 3 — Orchestrator continuity (artifacts + handoff)

## Task 10: `PromptBuilder` injects spec/plan/handoff from the workspace

**Files:**
- Modify: `elixir/lib/symphony_elixir/prompt_builder.ex`
- Test: `elixir/test/symphony_elixir/prompt_builder_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
test "appends superpowers artifacts when present in the workspace" do
  root = Path.join(System.tmp_dir!(), "pb-#{System.unique_integer([:positive])}")
  File.mkdir_p!(Path.join([root, "docs", "superpowers", "specs"]))
  File.write!(Path.join([root, "docs", "superpowers", "specs", "x.md"]), "# Spec X")
  File.write!(Path.join([root, "docs", "superpowers", "handoff.md"]), "# Handoff\nkey decisions")

  issue = %SymphonyElixir.Issue{identifier: "MAC-1", title: "T", description: "d", status: "In Progress"}
  prompt = SymphonyElixir.PromptBuilder.build_prompt(issue, workspace: root)

  assert prompt =~ "docs/superpowers/specs/x.md"
  assert prompt =~ "Spec X"
  assert prompt =~ "Handoff"
end
```

(Match the `Issue` struct fields actually required by the template; populate the minimum that `Solid.render!` needs.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/prompt_builder_test.exs -k artifacts`
Expected: FAIL (no artifact section appended).

- [ ] **Step 3: Implement**

In `build_prompt/2`, after producing the rendered binary, append an artifacts section when `:workspace` is provided and docs exist:

```elixir
def build_prompt(issue, opts \\ []) do
  template = Workflow.current() |> prompt_template!() |> parse_template!()

  rendered =
    template
    |> Solid.render!(%{"attempt" => Keyword.get(opts, :attempt), "issue" => issue |> Map.from_struct() |> to_solid_map()}, @render_opts)
    |> IO.iodata_to_binary()
    |> ensure_utf8()

  rendered <> artifacts_section(Keyword.get(opts, :workspace))
end

defp artifacts_section(nil), do: ""

defp artifacts_section(workspace) when is_binary(workspace) do
  base = Path.join(workspace, "docs/superpowers")

  if File.dir?(base) do
    files =
      ["specs", "plans"]
      |> Enum.flat_map(fn dir -> base |> Path.join(dir) |> list_md() end)
      |> Kernel.++(handoff_file(base))

    case files do
      [] -> ""
      list -> "\n\n## Existing authoring artifacts (follow these)\n\n" <> Enum.map_join(list, "\n\n", &render_artifact(workspace, &1))
    end
  else
    ""
  end
end

defp list_md(dir) do
  case File.ls(dir) do
    {:ok, entries} -> entries |> Enum.filter(&String.ends_with?(&1, ".md")) |> Enum.map(&Path.join(dir, &1)) |> Enum.sort()
    _ -> []
  end
end

defp handoff_file(base) do
  path = Path.join(base, "handoff.md")
  if File.regular?(path), do: [path], else: []
end

defp render_artifact(workspace, abs) do
  rel = Path.relative_to(abs, workspace)
  body = case File.read(abs) do
    {:ok, content} -> content
    _ -> ""
  end

  "### `#{rel}`\n\n#{body}"
end
```

- [ ] **Step 4: Wire `AgentRunner` to pass `:workspace`**

In `agent_runner.ex`, find the `PromptBuilder.build_prompt(issue, ...)` call and add `workspace: workspace` to the opts (the runner already has the workspace path from `Workspace.create_for_issue`). Add/adjust a test in `agent_runner_test.exs` if one asserts the prompt.

- [ ] **Step 5: Run tests**

Run: `cd elixir && mix test test/symphony_elixir/prompt_builder_test.exs test/symphony_elixir/agent_runner_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/prompt_builder.ex elixir/lib/symphony_elixir/agent_runner.ex elixir/test/symphony_elixir
git commit -m "feat(orchestrator): inject superpowers artifacts into the dispatch prompt"
```

## Task 11: Handoff note instruction in complex mode

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/codex_session.ex`
- Test: extend `codex_session_test.exs`

- [ ] **Step 1: Write the failing test**

Assert the complex-mode prompt instructs writing `docs/superpowers/handoff.md` at the "ready"/enrichment step.

```elixir
test "complex prompt instructs writing handoff.md", %{thread: thread} do
  {:ok, thread} = History.set_mode(thread, "complex")
  test_pid = self()
  runner = fn _w, prompt, _i, _o -> send(test_pid, {:prompt, prompt}); {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "c", turn_id: "t"}} end
  {:ok, _} = CodexSession.send_message_to_issue_thread(thread, "done", %{}, runner: runner)
  assert_receive {:prompt, prompt}
  assert prompt =~ "docs/superpowers/handoff.md"
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/assistant/codex_session_test.exs -k handoff`
Expected: FAIL.

- [ ] **Step 3: Implement**

Extend the complex `mode_section` string (Task 4) with:

```
        When the user signals the task is ready, write a concise `docs/superpowers/handoff.md`
        (key decisions + current state) and enrich the issue description (executive summary + links
        to the spec/plan files) via the update_issue tool.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/assistant/codex_session_test.exs -k handoff`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/codex_session.ex elixir/test/symphony_elixir/assistant/codex_session_test.exs
git commit -m "feat(assistant): instruct handoff note + enrichment in complex mode"
```

---

# PHASE 4 — Codex Goal mode

## Task 12: `Codex.Config.goals_enabled?/0`

**Files:**
- Modify: `elixir/lib/symphony_elixir/codex/config.ex`
- Test: `elixir/test/symphony_elixir/codex/config_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
test "goals_enabled?/0 defaults to false" do
  assert SymphonyElixir.Codex.Config.goals_enabled?() == false
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/codex/config_test.exs -k goals_enabled`
Expected: FAIL.

- [ ] **Step 3: Implement**

```elixir
@spec goals_enabled?() :: boolean()
def goals_enabled? do
  section_value("goals_enabled") == true
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/codex/config_test.exs -k goals_enabled`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/codex/config.ex elixir/test/symphony_elixir/codex/config_test.exs
git commit -m "feat(codex): goals_enabled? config accessor"
```

## Task 13: `CodingAgent` sends `thread/goal/set` when a goal is provided

**Files:**
- Modify: `elixir/lib/symphony_elixir/codex/coding_agent.ex`
- Test: `elixir/test/symphony_elixir/codex/coding_agent_test.exs`

- [ ] **Step 1: Write the failing test**

The existing tests drive `CodingAgent` against a fake app-server port. Add a test that, with `goal: "..."` in opts and goals enabled, a `thread/goal/set` JSON-RPC message is sent after `thread/start` and before `turn/start`. Use the existing fake-port harness; assert the captured outbound messages include `"method" => "thread/goal/set"` with the goal text.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/codex/coding_agent_test.exs -k goal`
Expected: FAIL (no goal set message).

- [ ] **Step 3: Implement**

Add a `@goal_set_id 4` attribute. In `start_session/2`, after `do_start_session` returns the `thread_id`, call a new `maybe_set_goal`:

```elixir
defp maybe_set_goal(_port, _thread_id, nil), do: :ok
defp maybe_set_goal(_port, _thread_id, ""), do: :ok

defp maybe_set_goal(port, thread_id, goal) when is_binary(goal) do
  if SymphonyElixir.Codex.Config.goals_enabled?() do
    send_message(port, %{
      "method" => "thread/goal/set",
      "id" => @goal_set_id,
      "params" => %{"threadId" => thread_id, "goal" => goal}
    })

    case await_response(port, @goal_set_id) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, {:goal_set_failed, reason}}
    end
  else
    {:error, :goals_unsupported}
  end
end
```

Wire it in `start_session` so a failure does not crash a non-goal run: only call when `Keyword.get(opts, :goal)` is set; on `{:error, :goals_unsupported}` or `{:goal_set_failed, _}`, log a warning and continue in single-turn mode (do not fail the session). Add `goal` to the `session()` struct if you want to surface it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/codex/coding_agent_test.exs -k goal`
Expected: PASS, and existing coding_agent tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/codex/coding_agent.ex elixir/test/symphony_elixir/codex/coding_agent_test.exs
git commit -m "feat(codex): set Codex goal via thread/goal/set when enabled"
```

## Task 14: Goal auto-continuation loop + dispatch wiring

**Files:**
- Modify: `elixir/lib/symphony_elixir/codex/coding_agent.ex`
- Modify: `elixir/lib/symphony_elixir/agent_runner.ex` (pass `:goal` through dispatch)
- Test: `coding_agent_test.exs`, `agent_runner_test.exs`

- [ ] **Step 1: Write the failing test**

In `coding_agent_test.exs`, with a goal set and the fake server emitting `turn/completed` followed by a goal-active signal, assert the runner issues a follow-up `turn/start` (auto-continuation) until a stopping condition (goal `completed`/`blocked`) is observed. Bound iterations with a max-turns opt to avoid infinite loops in tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/codex/coding_agent_test.exs -k continuation`
Expected: FAIL (only one turn runs).

- [ ] **Step 3: Implement**

When a goal is active, after `await_turn_completion` returns `{:ok, :turn_completed}`, inspect the goal status (from the `turn/completed` payload or a `thread/goal/get`) and, if still active and under `Keyword.get(opts, :max_goal_turns, 50)`, issue another `turn/start` with a continuation prompt; stop on `completed`/`blocked`/budget. Keep single-turn behavior unchanged when no goal is set.

- [ ] **Step 4: Wire dispatch**

In `agent_runner.ex` (and the orchestrator dispatch path), thread a `goal` option from the issue dispatch request through to `CodingAgent.run/4`. Source the goal from the dispatch payload (set by the frontend in Task 19) — e.g. stored transiently on the dispatch request or derived in `ToolExecutor.dispatch_codex`.

- [ ] **Step 5: Run tests**

Run: `cd elixir && mix test test/symphony_elixir/codex/coding_agent_test.exs test/symphony_elixir/agent_runner_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/codex/coding_agent.ex elixir/lib/symphony_elixir/agent_runner.ex elixir/test/symphony_elixir
git commit -m "feat(codex): goal auto-continuation loop and dispatch wiring"
```

---

# PHASE 5 — Frontend: documents service, viewer, routes

## Task 15: Types + service for issue documents

**Files:**
- Create: `tracker/src/types/issueDocument.ts`
- Create: `tracker/src/services/issueDocuments.ts`
- Test: `tracker/src/services/__tests__/issueDocuments.test.ts`

- [ ] **Step 1: Write types**

`tracker/src/types/issueDocument.ts`:

```ts
export type IssueDocumentKind = "spec" | "plan" | "handoff";

export interface IssueDocument {
  id: string;
  kind: IssueDocumentKind;
  path: string;
  title: string;
  updatedAt: string | null;
}

export interface IssueDocumentList {
  available: boolean;
  reason: string | null;
  documents: IssueDocument[];
}
```

- [ ] **Step 2: Write the failing test**

`tracker/src/services/__tests__/issueDocuments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeIssueDocument, normalizeIssueDocumentList } from "@/services/issueDocuments";

describe("normalizeIssueDocument", () => {
  it("normalizes snake_case", () => {
    const doc = normalizeIssueDocument({ id: "a", kind: "spec", path: "docs/superpowers/specs/a.md", title: "A", updated_at: "2026-05-31T00:00:00Z" });
    expect(doc.updatedAt).toBe("2026-05-31T00:00:00Z");
    expect(doc.kind).toBe("spec");
  });

  it("defaults available list", () => {
    const list = normalizeIssueDocumentList({ available: false, reason: "workspace_missing", documents: [] });
    expect(list.available).toBe(false);
    expect(list.documents).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/services/__tests__/issueDocuments.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement service** (mirror `agentExecutions.ts` http usage)

```ts
import { http, trackerPath, unwrapData } from "./http";
import type { IssueDocument, IssueDocumentKind, IssueDocumentList } from "@/types/issueDocument";

interface BackendIssueDocumentDto {
  id?: string | null;
  kind?: string | null;
  path?: string | null;
  title?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
}

interface BackendIssueDocumentListDto {
  available?: boolean | null;
  reason?: string | null;
  documents?: BackendIssueDocumentDto[] | null;
}

const KINDS: readonly IssueDocumentKind[] = ["spec", "plan", "handoff"];

export function normalizeIssueDocument(dto: BackendIssueDocumentDto): IssueDocument {
  const kind = KINDS.includes(dto.kind as IssueDocumentKind) ? (dto.kind as IssueDocumentKind) : "spec";
  return {
    id: dto.id ?? dto.path ?? "",
    kind,
    path: dto.path ?? "",
    title: dto.title ?? dto.path ?? "Untitled",
    updatedAt: dto.updatedAt ?? dto.updated_at ?? null,
  };
}

export function normalizeIssueDocumentList(dto: BackendIssueDocumentListDto): IssueDocumentList {
  return {
    available: Boolean(dto.available),
    reason: dto.reason ?? null,
    documents: (dto.documents ?? []).map(normalizeIssueDocument),
  };
}

export async function listIssueDocuments(projectSlug: string, identifier: string): Promise<IssueDocumentList> {
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/documents`));
  return normalizeIssueDocumentList(unwrapData<BackendIssueDocumentListDto>(response));
}

export async function readIssueDocument(projectSlug: string, identifier: string, path: string): Promise<string> {
  const response = await http.get(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/documents/${path.split("/").map(encodeURIComponent).join("/")}`),
  );
  return unwrapData<{ content: string }>(response).content;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/services/__tests__/issueDocuments.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tracker/src/types/issueDocument.ts tracker/src/services/issueDocuments.ts tracker/src/services/__tests__/issueDocuments.test.ts
git commit -m "feat(tracker): issue document types and service"
```

## Task 16: `useIssueDocuments` hook

**Files:**
- Create: `tracker/src/hooks/useIssueDocuments.ts`
- Test: `tracker/src/hooks/__tests__/useIssueDocuments.test.tsx`

- [ ] **Step 1: Write the failing test**

Mock `listIssueDocuments`; render the hook with `@testing-library/react` `renderHook`; assert it fetches on mount and exposes `{ documents, available, reason, loading }`. Mirror `useIssuePullRequests` structure (focus-aware polling, keep-last on error).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/hooks/__tests__/useIssueDocuments.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** (copy the `useIssuePullRequests` skeleton; swap the service; add an optional `channel`/`refreshKey` arg so the panel can call `refetch` on `assistant_document_changed`).

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useWindowFocus } from "@/hooks/useWindowFocus";
import { listIssueDocuments } from "@/services/issueDocuments";
import type { IssueDocument } from "@/types/issueDocument";

const DEFAULT_INTERVAL_MS = 20_000;

interface Args {
  projectSlug: string;
  identifier: string | null;
  enabled?: boolean;
  refreshKey?: number;
  intervalMs?: number;
}

export interface UseIssueDocumentsResult {
  documents: IssueDocument[];
  available: boolean;
  reason: string | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useIssueDocuments({ projectSlug, identifier, enabled = true, refreshKey = 0, intervalMs = DEFAULT_INTERVAL_MS }: Args): UseIssueDocumentsResult {
  const [documents, setDocuments] = useState<IssueDocument[]>([]);
  const [available, setAvailable] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const hasLoaded = useRef(false);
  const focused = useWindowFocus();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  const active = enabled && Boolean(identifier && projectSlug);

  const refetch = useCallback(async () => {
    if (!identifier || !projectSlug || inFlight.current) return;
    inFlight.current = true;
    if (!hasLoaded.current) setLoading(true);
    try {
      const result = await listIssueDocuments(projectSlug, identifier);
      setDocuments(result.documents);
      setAvailable(result.available);
      setReason(result.reason);
      hasLoaded.current = true;
    } catch {
      // keep last known
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [identifier, projectSlug]);

  useEffect(() => {
    hasLoaded.current = false;
    if (!active) {
      setDocuments([]);
      setAvailable(false);
      setReason(null);
      setLoading(false);
      return undefined;
    }
    void refetch();
    const timer = setInterval(() => {
      if (focusedRef.current) void refetch();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, refetch, refreshKey]);

  return { documents, available, reason, loading, refetch };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/hooks/__tests__/useIssueDocuments.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/hooks/useIssueDocuments.ts tracker/src/hooks/__tests__/useIssueDocuments.test.tsx
git commit -m "feat(tracker): useIssueDocuments hook"
```

## Task 17: `DocumentViewer` component

**Files:**
- Create: `tracker/src/components/assistant/DocumentViewer.tsx`
- Test: `tracker/src/components/assistant/__tests__/DocumentViewer.test.tsx`

- [ ] **Step 1: Write the failing test**

Render `DocumentViewer` with a list of docs (mock `readIssueDocument`); assert the list renders titles grouped by kind, clicking a doc renders its markdown (via the shared `Markdown` component), and the `workspace_missing` reason shows a hint.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/DocumentViewer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
import { FileText, ListChecks, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { Markdown } from "@/components/ui/markdown";
import { readIssueDocument } from "@/services/issueDocuments";
import type { IssueDocument } from "@/types/issueDocument";
import { cn } from "@/lib/utils";

interface DocumentViewerProps {
  projectSlug: string;
  identifier: string;
  documents: IssueDocument[];
  available: boolean;
  reason: string | null;
}

const KIND_ICON = { spec: ScrollText, plan: ListChecks, handoff: FileText } as const;

export function DocumentViewer({ projectSlug, identifier, documents, available, reason }: DocumentViewerProps) {
  const [selected, setSelected] = useState<string | null>(documents[0]?.path ?? null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selected == null && documents[0]) setSelected(documents[0].path);
  }, [documents, selected]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    void readIssueDocument(projectSlug, identifier, selected)
      .then((body) => {
        if (!cancelled) setContent(body);
      })
      .catch(() => {
        if (!cancelled) setContent("");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectSlug, identifier, selected]);

  if (!available) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {reason === "workspace_missing"
          ? "The working tree is not ready yet. Documents appear once the assistant starts working."
          : "No documents available."}
      </div>
    );
  }

  if (documents.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">No spec or plan documents yet.</div>;
  }

  return (
    <div className="flex min-h-0 flex-1">
      <ul className="w-56 shrink-0 space-y-0.5 overflow-auto border-r p-2">
        {documents.map((doc) => {
          const Icon = KIND_ICON[doc.kind] ?? FileText;
          return (
            <li key={doc.path}>
              <button
                type="button"
                onClick={() => setSelected(doc.path)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted",
                  selected === doc.path && "bg-muted font-medium",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{doc.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : <Markdown className="max-w-none text-sm leading-6">{content}</Markdown>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/DocumentViewer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/DocumentViewer.tsx tracker/src/components/assistant/__tests__/DocumentViewer.test.tsx
git commit -m "feat(tracker): read-only DocumentViewer"
```

## Task 18: `IssueAuthoringPanel` + routes + mode toggle

**Files:**
- Create: `tracker/src/components/assistant/IssueAuthoringPanel.tsx`
- Create: `tracker/src/components/workspace/IssueAssistantRoute.tsx`
- Modify: `tracker/src/App.tsx`, `tracker/src/lib/workspaceRoutes.ts`
- Test: `tracker/src/components/workspace/__tests__/IssueAssistantRoute.test.tsx`

- [ ] **Step 1: Add route path helpers**

In `workspaceRoutes.ts`:

```ts
export function newIssueAssistantPath(projectSlug: string): string {
  return `/projects/${requireSlug(projectSlug)}/assistant/new-issue`;
}

export function issueAssistantPath(projectSlug: string, issueId: string): string {
  return `/projects/${requireSlug(projectSlug)}/assistant/issue/${encodeURIComponent(issueId)}`;
}
```

- [ ] **Step 2: Write the failing route test**

Render `IssueAssistantRoute` inside a `MemoryRouter` at `/projects/macro/assistant/new-issue`; assert it mounts the authoring panel (mock the channel/services). Then at `/projects/macro/assistant/issue/MAC-1` assert it passes `identifier="MAC-1"` to the panel and renders the documents pane.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/workspace/__tests__/IssueAssistantRoute.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement `IssueAuthoringPanel`**

Composes the existing `ProjectAssistantPanel` (page mode, with `threadId`) on the left and `DocumentViewer` on the right; renders a Simple/Complex toggle that sends a mode-change message through the chat (or a dedicated control). Subscribe to `assistant_document_changed` by bumping a `refreshKey` passed to `useIssueDocuments`.

```tsx
import { useState } from "react";
import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { DocumentViewer } from "@/components/assistant/DocumentViewer";
import { useIssueDocuments } from "@/hooks/useIssueDocuments";
import { Button } from "@/components/ui/button";
import type { WorkspaceView } from "@/lib/workspaceRoutes";

interface IssueAuthoringPanelProps {
  projectSlug: string;
  threadId?: number;
  identifier?: string;
  view: WorkspaceView;
}

export function IssueAuthoringPanel({ projectSlug, threadId, identifier, view }: IssueAuthoringPanelProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const docs = useIssueDocuments({ projectSlug, identifier: identifier ?? null, enabled: Boolean(identifier), refreshKey });

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0">
      <div className="flex min-h-0 flex-1 flex-col border-r">
        <ProjectAssistantPanel projectSlug={projectSlug} threadId={threadId} view={view} mode="page" />
      </div>
      {identifier ? (
        <aside className="flex w-[40%] min-w-[320px] flex-col">
          <div className="border-b px-4 py-2 text-sm font-semibold">Documents</div>
          <DocumentViewer projectSlug={projectSlug} identifier={identifier} documents={docs.documents} available={docs.available} reason={docs.reason} />
        </aside>
      ) : null}
    </div>
  );
}
```

(Wiring `assistant_document_changed` → `setRefreshKey` requires exposing an event hook from `ProjectAssistantPanel`. Add an optional `onDocumentChanged?: () => void` prop to `ProjectAssistantPanel`, bound in `bindAssistantEvents` via a new `onAssistantDocumentChanged` handler in `assistantChannel.ts`. Add the handler there: `channel.on("assistant_document_changed", () => handlers.onAssistantDocumentChanged?.());`)

- [ ] **Step 5: Implement `IssueAssistantRoute`** (reads `:identifier`/thread from URL params; resolves the issue thread id — for `new-issue` no `threadId` yet; for `issue/:issueId` look up or create the thread via the channel join by identifier). Implement resolution by joining `assistant:thread:<id>` once the draft exists; for `new-issue`, start a project-scoped chat that calls `create_draft_issue` then navigates to `issueAssistantPath`.

- [ ] **Step 6: Add routes in `App.tsx`** under `projects/:projectSlug` → `ProjectWorkspaceLayout`:

```tsx
<Route path="assistant" element={<ProjectAssistantRoute />} />
<Route path="assistant/new-issue" element={<IssueAssistantRoute />} />
<Route path="assistant/issue/:issueId" element={<IssueAssistantRoute />} />
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/workspace/__tests__/IssueAssistantRoute.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tracker/src/components/assistant/IssueAuthoringPanel.tsx tracker/src/components/workspace/IssueAssistantRoute.tsx tracker/src/App.tsx tracker/src/lib/workspaceRoutes.ts tracker/src/services/phoenix/assistantChannel.ts tracker/src/components/assistant/ProjectAssistantPanel.tsx tracker/src/components/workspace/__tests__/IssueAssistantRoute.test.tsx
git commit -m "feat(tracker): issue authoring panel, routes, and document-change refresh"
```

---

# PHASE 6 — Entry points, Agent tab split, Goal-mode UI

## Task 19: `NewIssueMenu` split-button (assistant primary + quick-create fallback)

**Files:**
- Create: `tracker/src/components/issues/NewIssueMenu.tsx`
- Modify: `tracker/src/components/layout/ProjectHeader.tsx`, `tracker/src/components/board/BoardColumn.tsx`
- Test: `tracker/src/components/issues/__tests__/NewIssueMenu.test.tsx`

- [ ] **Step 1: Write the failing test**

Render `NewIssueMenu`; assert the primary action navigates to `newIssueAssistantPath(projectSlug)`, and the dropdown "Quick create" opens the existing `IssueCreateDialog` (controlled open).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/issues/__tests__/NewIssueMenu.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** a split-button: primary button → `navigate(newIssueAssistantPath(projectSlug))`; a chevron opens a small menu with "Quick create" toggling `IssueCreateDialog` `open`. Reuse the existing `IssueCreateDialog` in controlled mode.

- [ ] **Step 4: Wire into `ProjectHeader.tsx` and `BoardColumn.tsx`** replacing the direct "New issue" trigger with `NewIssueMenu` (keep `onCreated` callbacks intact for the quick-create path).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/issues/__tests__/NewIssueMenu.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tracker/src/components/issues/NewIssueMenu.tsx tracker/src/components/layout/ProjectHeader.tsx tracker/src/components/board/BoardColumn.tsx tracker/src/components/issues/__tests__/NewIssueMenu.test.tsx
git commit -m "feat(tracker): New issue split-button (assistant primary, quick-create fallback)"
```

## Task 20: Agent tab split (Authoring / Execution)

**Files:**
- Modify: `tracker/src/components/issues/IssueDrawer.tsx`
- Create: `tracker/src/components/issues/issue-detail/AgentTabs.tsx`
- Test: `tracker/src/components/issues/__tests__/IssueDrawer.agent.test.tsx`

- [ ] **Step 1: Write the failing test**

Render `IssueDrawer` open on the `agent` tab; assert two sub-tabs render: "Authoring" (mounts `IssueAuthoringPanel` content / documents) and "Execution" (the existing `AgentTab`). Mock channel/services.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/issues/__tests__/IssueDrawer.agent.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `AgentTabs`** with an inner segmented control:

```tsx
import { useState } from "react";
import { AgentTab } from "./AgentTab";
import { IssueAuthoringPanel } from "@/components/assistant/IssueAuthoringPanel";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import { cn } from "@/lib/utils";

export function AgentTabs({ issue, projectSlug, execution, view }: { issue: Issue; projectSlug: string; execution?: AgentExecution; view: "board" | "list" }) {
  const [section, setSection] = useState<"authoring" | "execution">("authoring");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex gap-1">
        {(["authoring", "execution"] as const).map((value) => (
          <button key={value} type="button" onClick={() => setSection(value)} className={cn("rounded-md px-3 py-1 text-xs", section === value ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
            {value === "authoring" ? "Authoring" : "Execution"}
          </button>
        ))}
      </div>
      {section === "authoring" ? (
        <IssueAuthoringPanel projectSlug={projectSlug} identifier={issue.identifier} view={view} />
      ) : (
        <AgentTab issue={issue} execution={execution} />
      )}
    </div>
  );
}
```

In `IssueDrawer.tsx`, replace `<TabsContent value="agent"><AgentTab .../></TabsContent>` with `<TabsContent value="agent"><AgentTabs issue={issue} projectSlug={projectSlug} execution={execution} view={view} /></TabsContent>`. Add a `view` prop to `IssueDrawer` (passed from `IssueDetailRoute`) or derive it via `viewFromPathname`.

(Embedding `IssueAuthoringPanel` inside the drawer should use a non-full-height variant; add a `compact` prop to `IssueAuthoringPanel`/`ProjectAssistantPanel` if the `h-[calc(100vh-4rem)]` is too tall for the drawer.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/issues/__tests__/IssueDrawer.agent.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail/AgentTabs.tsx tracker/src/components/issues/IssueDrawer.tsx tracker/src/components/issues/__tests__/IssueDrawer.agent.test.tsx
git commit -m "feat(tracker): split Agent tab into Authoring and Execution"
```

## Task 21: Goal-mode checkbox in the dispatch control (Codex-only)

**Files:**
- Modify: the dispatch UI component (the agent picker used at dispatch; locate via `agent` selection in `IssueCreateDialog`/issue dispatch flow) — likely `tracker/src/components/issues/issue-detail/AgentTab.tsx` or a dispatch action component.
- Test: corresponding `__tests__`.

- [ ] **Step 1: Write the failing test**

Render the dispatch control with `agent="codex"`; assert a "Goal mode (long-running)" checkbox is visible and, when checked, the dispatch payload includes `goal` (auto-derived text shown for review). With `agent="claude"`, assert the checkbox is NOT rendered.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run <dispatch test path>`
Expected: FAIL.

- [ ] **Step 3: Implement** the checkbox shown only when the selected agent is `codex`; when checked, reveal a textarea pre-filled with an auto-derived goal (objective from the issue summary + constraints + verification + stopping condition) for review/edit; include `goal` in the dispatch request payload that ultimately reaches `ToolExecutor.dispatch_codex`/`AgentRunner` (Task 14).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run <dispatch test path>`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues tracker/src/services
git commit -m "feat(tracker): Codex Goal-mode checkbox at dispatch"
```

---

# PHASE 7 — Integration, docs, gates

## Task 22: End-to-end wiring check + docs

**Files:**
- Modify: `elixir/README.md`, `WORKFLOW.md`, `WORKFLOW.*.example.md`, `SPEC.md`, `docs/logging.md`

- [ ] **Step 1:** Document the assistant authoring flow, `assistant.draft_status`, `codex.goals_enabled`, and the documents API in `elixir/README.md`; add the `assistant:`/`codex.goals_enabled` config note to `WORKFLOW.md` and an example to `WORKFLOW.*.example.md`; note the issue-scoped authoring assistant + Goal-mode dispatch in `SPEC.md`; add any new issue/session log fields to `docs/logging.md`.

- [ ] **Step 2: Run full backend gate**

Run: `cd elixir && mix test && mix specs.check && make all`
Expected: all green (format, lint, coverage, dialyzer).

- [ ] **Step 3: Run full frontend gate**

Run: `cd tracker && npx vitest run && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 4: Manual smoke (document in PR):** start the app; from the board click "New issue" → assistant; give a title/description → draft created + redirect to `/projects/:slug/assistant/issue/:id`; flip to Complex → spec/plan files appear in the documents pane; open the issue detail Agent tab → Authoring shows the same docs; dispatch with Goal mode checked → orchestrator run continues from the artifacts.

- [ ] **Step 5: Commit**

```bash
git add elixir/README.md WORKFLOW.md WORKFLOW.macromarkets.example.md SPEC.md docs/logging.md
git commit -m "docs: document issue authoring assistant, documents API, and Goal mode"
```

---

## Self-Review notes (gaps the implementer must watch)

- **Task ordering:** Do Task 5 (Skills) before Task 4's green step, since `build_issue_prompt` calls `Skills.load/1`.
- **Draft status existence:** Task 1/3 assume the project workflow has the `assistant.draft_status` value (default "Triage"). If a project's workflow lacks it, `create_draft_issue` fails — the implementer must either seed the status or set `assistant.draft_status` to an existing non-actionable status. Verify against `LocalTracker` default statuses.
- **`view` prop into `IssueDrawer`/`AgentTabs`:** ensure `IssueDetailRoute` passes the current `WorkspaceView` (or derive via `viewFromPathname`) so `IssueAuthoringPanel` gets a valid `view`.
- **`assistant_document_changed` plumbing:** the event must be added to `AssistantChannelHandlers` (`onAssistantDocumentChanged`) in `assistantChannel.ts`, bound in `ProjectAssistantPanel`, and surfaced to `IssueAuthoringPanel` to bump `refreshKey`.
- **Goal continuation safety:** bound auto-continuation with `max_goal_turns`; never loop when no goal is set; preserve existing single-turn behavior for all non-goal runs.
- **Type consistency:** `IssueDocument`/`IssueDocumentList` field names (`updatedAt`, `available`, `reason`, `documents`) are identical across service, hook, viewer, and tests. Backend JSON keys are snake_case (`updated_at`) and normalized client-side.
- **`new-issue` thread bootstrap:** decide concretely how the `new-issue` route creates the draft and obtains the thread id (project-scoped chat calls `create_draft_issue`, backend upgrades/creates the issue thread, response carries the new identifier → navigate to `issueAssistantPath`). This handoff is the riskiest UX seam — implement and test it explicitly.
