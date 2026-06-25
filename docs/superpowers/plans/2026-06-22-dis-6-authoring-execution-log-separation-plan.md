# Authoring vs. Execution Log Separation + Authoring Digest — Implementation Plan

**Goal:** Stop authoring Codex turns from clobbering the execution session log, and feed the authoring conversation to the execution agent as a fallback when no spec/plan/handoff exists.

**Architecture:** Two independent parts. (1) Make the Codex session sidecar **role-aware** — execution keeps `.symphony/codex-session.json` (so the evidence gate, goal-mode resume, and the Execution tab are unchanged), while authoring writes `.symphony/codex-session-authoring.json`. (2) A new `Assistant.AuthoringDigest` writes `docs/superpowers/authoring-log.md` from the authoring chat transcript during execution prep, and `PromptBuilder.artifacts_section/1` injects it only when no spec/plan/handoff is present.

**Tech Stack:** Elixir 1.19 / OTP 28, Phoenix, Ecto/SQLite, ExUnit. Quality gates: `make all` and `mix specs.check` (public `def` in `lib/` require `@spec`).

**Design:** `docs/superpowers/specs/2026-06-22-authoring-execution-log-separation-design.md`

---

## Conventions for every task

- Run targeted tests with `mix test path:line` from the `elixir/` directory.
- Public `def` in `lib/` must have an adjacent `@spec`. Validate with `mix specs.check`.
- Do **not** create commits unless the user asks. (Steps below include commit commands per the writing-plans format; skip them if the user has not requested commits.)
- Workspace safety: never run a Codex turn cwd in a source repo; keep workspaces under the configured root. These tasks don't change cwd resolution.

---

## Task 1: Role-aware `Codex.Session` (write/resolve/clear)

**Files:**
- Modify: `elixir/lib/symphony_elixir/codex/session.ex`
- Test: `elixir/test/symphony_elixir/codex/session_test.exs`

- [ ] **Step 1: Write failing tests for the authoring role**

Add to `session_test.exs`:

```elixir
test "writes the authoring sidecar to a separate file", %{tmp_dir: workspace} do
  assert :ok = Session.write(workspace, "auth-thread", :authoring)

  assert File.exists?(Path.join(workspace, ".symphony/codex-session-authoring.json"))
  refute File.exists?(Path.join(workspace, ".symphony/codex-session.json"))
end

test "execution and authoring sidecars do not clobber each other", %{tmp_dir: workspace} do
  assert :ok = Session.write(workspace, "exec-thread", :execution)
  assert :ok = Session.write(workspace, "auth-thread", :authoring)

  assert {:ok, "exec-thread"} = Session.resolve(workspace)
  assert {:ok, "auth-thread"} = Session.resolve(workspace, session_role: :authoring)
end

test "default write/resolve/clear stay on the legacy execution file", %{tmp_dir: workspace} do
  assert :ok = Session.write(workspace, "exec-thread")
  assert File.exists?(Path.join(workspace, ".symphony/codex-session.json"))
  assert {:ok, "exec-thread"} = Session.resolve(workspace)
  assert :ok = Session.clear(workspace)
  assert :error = Session.resolve(workspace)
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd elixir && mix test test/symphony_elixir/codex/session_test.exs`
Expected: FAIL — `Session.write/3` and `resolve/2` with `:session_role` are undefined / arities don't match.

- [ ] **Step 3: Implement role-aware filenames**

In `session.ex`, replace the single relative-path module attr and the `write/2`,
`resolve/2`, `clear/1`, `sidecar_path/1` definitions:

```elixir
@sidecar_files %{
  execution: ".symphony/codex-session.json",
  authoring: ".symphony/codex-session-authoring.json"
}
@default_sessions_dir "~/.codex/sessions"
@scan_limit 500

@spec write(Path.t(), String.t(), :execution | :authoring) :: :ok
def write(workspace, thread_id, role \\ :execution)

def write(workspace, thread_id, role)
    when is_binary(workspace) and is_binary(thread_id) and thread_id != "" and is_atom(role) do
  path = sidecar_path(workspace, role)

  payload = %{
    "thread_id" => thread_id,
    "updated_at" => DateTime.utc_now() |> DateTime.to_iso8601()
  }

  with :ok <- File.mkdir_p(Path.dirname(path)),
       :ok <- File.write(path, Jason.encode!(payload)) do
    :ok
  else
    {:error, reason} ->
      Logger.warning("codex session sidecar write failed workspace=#{workspace} role=#{role} reason=#{inspect(reason)}")
      :ok
  end
end

def write(_workspace, _thread_id, _role), do: :ok

@spec clear(Path.t(), :execution | :authoring) :: :ok
def clear(workspace, role \\ :execution)

def clear(workspace, role) when is_binary(workspace) and is_atom(role) do
  workspace
  |> sidecar_path(role)
  |> File.rm()
  |> case do
    :ok -> :ok
    {:error, :enoent} -> :ok
    {:error, reason} ->
      Logger.warning("codex session sidecar clear failed workspace=#{workspace} role=#{role} reason=#{inspect(reason)}")
      :ok
  end
end

def clear(_workspace, _role), do: :ok

@spec resolve(Path.t(), keyword()) :: {:ok, String.t()} | :error
def resolve(workspace, opts \\ []) when is_binary(workspace) do
  role = Keyword.get(opts, :session_role, :execution)

  case read_sidecar(workspace, role) do
    {:ok, thread_id} ->
      {:ok, thread_id}

    :error ->
      case scan_rollouts(workspace, opts) do
        {:ok, thread_id} ->
          write(workspace, thread_id, role)
          {:ok, thread_id}

        :error ->
          :error
      end
  end
end

defp sidecar_path(workspace, role) do
  Path.join(Path.expand(workspace), Map.fetch!(@sidecar_files, role))
end

defp read_sidecar(workspace, role) do
  path = sidecar_path(workspace, role)

  with {:ok, contents} <- File.read(path),
       {:ok, %{"thread_id" => thread_id}} when is_binary(thread_id) and thread_id != "" <-
         Jason.decode(contents) do
    {:ok, thread_id}
  else
    _absent -> :error
  end
end
```

Keep `scan_rollouts/2`, `rollout_thread_id/2`, `first_line/1`, `sessions_dir/1` unchanged.
Remove the now-unused `@sidecar_relative_path` attribute.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir/codex/session_test.exs`
Expected: PASS (new + existing tests).

- [ ] **Step 5: Specs + format check**

Run: `cd elixir && mix specs.check && mix format --check-formatted`
Expected: no missing `@spec`, formatted.

- [ ] **Step 6: Commit** (only if the user asked for commits)

```bash
git add elixir/lib/symphony_elixir/codex/session.ex elixir/test/symphony_elixir/codex/session_test.exs
git commit -m "feat(codex): role-aware session sidecar (execution vs authoring)"
```

---

## Task 2: `Codex.CodingAgent` threads the session role

**Files:**
- Modify: `elixir/lib/symphony_elixir/codex/coding_agent.ex:68` (the `Session.write` call) and `resumable_thread_id/3`
- Test: `elixir/test/symphony_elixir/codex/coding_agent_test.exs` (or the existing app-server test that exercises `start_session`)

- [ ] **Step 1: Write a failing test for the authoring role write**

Find the existing test that starts a Codex session against a stubbed port (see
`test/symphony_elixir/app_server_test.exs` / `test/support/test_support.exs`). Add a test
asserting that starting a session with `session_role: :authoring` writes the authoring
sidecar:

```elixir
test "start_session with :authoring role writes the authoring sidecar", %{workspace: workspace} = ctx do
  {:ok, _session} = start_codex_session(ctx, session_role: :authoring)

  assert File.exists?(Path.join(workspace, ".symphony/codex-session-authoring.json"))
  refute File.exists?(Path.join(workspace, ".symphony/codex-session.json"))
end
```

(Use the test's existing helper for starting a stubbed session; pass the extra opt through.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/app_server_test.exs`
Expected: FAIL — the authoring sidecar is not written (still writes the default file).

- [ ] **Step 3: Implement the role plumbing**

In `coding_agent.ex`, change the write in `start_session/2` (currently line ~68):

```elixir
Session.write(expanded_workspace, thread_id, session_role(opts))
```

Add the private helper near the other small helpers:

```elixir
defp session_role(opts) do
  case Keyword.get(opts, :session_role, :execution) do
    role when role in [:execution, :authoring] -> role
    _ -> :execution
  end
end
```

`resumable_thread_id/3` already calls `Session.resolve(workspace, opts)`; since `opts` now
carries `:session_role`, authoring goal-mode resolves the authoring sidecar with no further
change. (Confirm `opts` flows into `resumable_thread_id/3` — it does via
`start_or_resume_thread/5`.)

- [ ] **Step 4: Run it to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/app_server_test.exs`
Expected: PASS.

- [ ] **Step 5: Specs + format**

Run: `cd elixir && mix specs.check && mix format --check-formatted`
Expected: clean.

- [ ] **Step 6: Commit** (only if asked)

```bash
git add elixir/lib/symphony_elixir/codex/coding_agent.ex elixir/test/symphony_elixir/app_server_test.exs
git commit -m "feat(codex): pass session role to sidecar write + resume resolution"
```

---

## Task 3: Authoring path tags `:authoring`; execution tags `:execution`

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/codex_session.ex` (`default_runner/4`, ~line 721)
- Modify: `elixir/lib/symphony_elixir/agent_runner.ex` (`run_codex_turns/4` `session_opts`, ~line 181)
- Test: `elixir/test/symphony_elixir/assistant/codex_session_test.exs` (or a focused new test)

- [ ] **Step 1: Write a failing test that authoring turns write only the authoring sidecar**

Add a test that runs an issue authoring turn against a stubbed runner/port in a temp
workspace and asserts the execution sidecar is **not** created while the authoring one is:

```elixir
test "issue authoring turn writes only the authoring sidecar", %{workspace: workspace} = ctx do
  run_issue_authoring_turn(ctx, "draft a description")

  assert File.exists?(Path.join(workspace, ".symphony/codex-session-authoring.json"))
  refute File.exists?(Path.join(workspace, ".symphony/codex-session.json"))
end
```

If the existing authoring tests use an injected fake runner that never touches the sidecar,
instead assert at the opts boundary: capture the opts passed to
`RootCodingAgent.start_session/3` and assert `Keyword.get(opts, :session_role) == :authoring`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/assistant/codex_session_test.exs`
Expected: FAIL — `:session_role` not set / execution sidecar written.

- [ ] **Step 3: Implement the opt in `default_runner/4`**

In `assistant/codex_session.ex`, in `default_runner/4`, set the role before starting:

```elixir
defp default_runner(workspace, prompt, issue, opts) do
  agent_kind = Keyword.get(opts, :agent_kind)
  opts = Keyword.put_new(opts, :session_role, :authoring)

  with {:ok, session} <- RootCodingAgent.start_session(workspace, agent_kind, opts) do
    # ... unchanged ...
```

- [ ] **Step 4: Implement the explicit execution opt**

In `agent_runner.ex`, in `run_codex_turns/4`, add the explicit role to `session_opts`:

```elixir
session_opts =
  [workspace_root: workspace_root, session_role: :execution]
  |> maybe_put_codex_config(Keyword.get(opts, :project_config))
  |> maybe_put_claude_tools(agent_kind, issue)
  |> maybe_put_resume_thread_id(opts, issue, agent_kind)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir/assistant/codex_session_test.exs test/symphony_elixir/agent_runner_test.exs`
Expected: PASS.

- [ ] **Step 6: Regression — evidence gate still resolves the execution rollout**

Add/confirm a test in `test/symphony_elixir/evidence/session_audit_test.exs` that
`rollout_path_for_workspace/1` (which uses the default `:execution` role) resolves the
execution sidecar even when an authoring sidecar also exists:

```elixir
test "resolves the execution rollout, ignoring the authoring sidecar", %{tmp_dir: workspace} do
  Session.write(workspace, "auth-thread", :authoring)
  Session.write(workspace, "exec-thread", :execution)
  # ... seed a rollout file whose basename contains "exec-thread" under the test sessions dir ...
  assert {:ok, path} = SessionAudit.rollout_path_for_workspace(workspace)
  assert String.contains?(Path.basename(path), "exec-thread")
end
```

Run: `cd elixir && mix test test/symphony_elixir/evidence/session_audit_test.exs`
Expected: PASS.

- [ ] **Step 7: Specs + format + commit** (commit only if asked)

```bash
cd elixir && mix specs.check && mix format --check-formatted
git add elixir/lib/symphony_elixir/assistant/codex_session.ex elixir/lib/symphony_elixir/agent_runner.ex elixir/test
git commit -m "feat: tag authoring/execution Codex turns with distinct session roles"
```

**Part 1 is now shippable: the Execution tab no longer shows authoring turns.**

---

## Task 4: `History.find_issue_thread/2` (read-only lookup)

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/history.ex`
- Test: `elixir/test/symphony_elixir/assistant/history_test.exs`

- [ ] **Step 1: Write a failing test**

```elixir
test "find_issue_thread returns the active issue thread or nil" do
  {:ok, thread} = History.ensure_issue_thread("demo", "DIS-6", %{})

  assert %{id: id} = History.find_issue_thread("demo", "DIS-6")
  assert id == thread.id
  assert History.find_issue_thread("demo", "DIS-404") == nil
end
```

(Use whatever project/seed setup the existing `history_test.exs` uses.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/assistant/history_test.exs`
Expected: FAIL — `find_issue_thread/2` undefined.

- [ ] **Step 3: Implement the public wrapper**

In `history.ex`, add a public function that delegates to the existing private
`active_issue_thread/2`:

```elixir
@doc "Returns the active issue-scoped thread for the project/issue, or nil. Read-only."
@spec find_issue_thread(String.t(), String.t()) :: Thread.t() | nil
def find_issue_thread(project_slug, issue_identifier)
    when is_binary(project_slug) and is_binary(issue_identifier) do
  active_issue_thread(project_slug, issue_identifier)
rescue
  _error -> nil
catch
  :exit, _reason -> nil
end

def find_issue_thread(_project_slug, _issue_identifier), do: nil
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/assistant/history_test.exs`
Expected: PASS.

- [ ] **Step 5: Specs + format + commit** (commit only if asked)

```bash
cd elixir && mix specs.check && mix format --check-formatted
git add elixir/lib/symphony_elixir/assistant/history.ex elixir/test/symphony_elixir/assistant/history_test.exs
git commit -m "feat(history): public read-only find_issue_thread/2"
```

---

## Task 5: `Assistant.AuthoringDigest` writes `authoring-log.md`

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/authoring_digest.ex`
- Test: `elixir/test/symphony_elixir/assistant/authoring_digest_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.Assistant.AuthoringDigestTest do
  use SymphonyElixir.DataCase, async: false

  alias SymphonyElixir.Assistant.{AuthoringDigest, History}

  @tag :tmp_dir
  test "writes a transcript digest from the issue thread messages", %{tmp_dir: workspace} do
    {:ok, thread} = History.ensure_issue_thread("demo", "DIS-6", %{})
    {:ok, _} = History.append_message(thread, %{role: "user", content: "build a CSV export"})
    {:ok, _} = History.append_message(thread, %{role: "assistant", content: "Plan: add an export button"})

    assert :ok = AuthoringDigest.write(workspace, "demo", "DIS-6")

    path = Path.join(workspace, "docs/superpowers/authoring-log.md")
    assert File.exists?(path)
    body = File.read!(path)
    assert body =~ "build a CSV export"
    assert body =~ "add an export button"
  end

  @tag :tmp_dir
  test "is a no-op when there is no issue thread", %{tmp_dir: workspace} do
    assert :ok = AuthoringDigest.write(workspace, "demo", "DIS-NONE")
    refute File.exists?(Path.join(workspace, "docs/superpowers/authoring-log.md"))
  end

  @tag :tmp_dir
  test "is a no-op when the thread has no user/assistant messages", %{tmp_dir: workspace} do
    {:ok, _thread} = History.ensure_issue_thread("demo", "DIS-EMPTY", %{})
    assert :ok = AuthoringDigest.write(workspace, "demo", "DIS-EMPTY")
    refute File.exists?(Path.join(workspace, "docs/superpowers/authoring-log.md"))
  end
end
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd elixir && mix test test/symphony_elixir/assistant/authoring_digest_test.exs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

```elixir
defmodule SymphonyElixir.Assistant.AuthoringDigest do
  @moduledoc """
  Renders the issue authoring conversation into `docs/superpowers/authoring-log.md`
  inside the issue workspace, so the execution agent can use it as fallback context
  when no spec/plan/handoff was produced. Best-effort: never raises, never blocks.
  """

  require Logger

  alias SymphonyElixir.Assistant.History

  @relative_path "docs/superpowers/authoring-log.md"
  @max_bytes 60_000
  @max_message_bytes 4_000
  @roles ~w(user assistant)

  @spec write(Path.t(), String.t(), String.t()) :: :ok
  def write(workspace, project_slug, issue_identifier)
      when is_binary(workspace) and is_binary(project_slug) and is_binary(issue_identifier) do
    with %{id: thread_id} <- History.find_issue_thread(project_slug, issue_identifier),
         messages when messages != [] <- relevant_messages(thread_id),
         body when body != "" <- render(issue_identifier, messages) do
      path = Path.join(Path.expand(workspace), @relative_path)

      with :ok <- File.mkdir_p(Path.dirname(path)),
           :ok <- File.write(path, body) do
        :ok
      else
        {:error, reason} ->
          Logger.warning("authoring digest write failed identifier=#{issue_identifier} reason=#{inspect(reason)}")
          :ok
      end
    else
      _absent -> :ok
    end
  rescue
    error ->
      Logger.warning("authoring digest crashed identifier=#{issue_identifier} reason=#{inspect(error)}")
      :ok
  end

  def write(_workspace, _project_slug, _issue_identifier), do: :ok

  defp relevant_messages(thread_id) do
    thread_id
    |> History.list_messages_for_thread()
    |> Enum.map(&History.message_payload/1)
    |> Enum.filter(fn m -> (m[:role] || m["role"]) in @roles end)
  end

  defp render(issue_identifier, messages) do
    header =
      """
      # Authoring conversation — #{issue_identifier}

      _Generated from the issue authoring chat. Use as background context only; this is
      not an approved spec or plan._

      """

    body =
      messages
      |> Enum.map(&render_message/1)
      |> Enum.join("\n\n")

    cap(header <> body, @max_bytes)
  end

  defp render_message(message) do
    role = message[:role] || message["role"] || "message"
    content = to_string(message[:content] || message["content"] || "")
    "**#{role}:** #{cap(String.trim(content), @max_message_bytes)}"
  end

  defp cap(text, max) when byte_size(text) > max do
    binary_part(text, 0, max) <> "\n\n_…truncated…_"
  end

  defp cap(text, _max), do: text
end
```

(Confirm `History.message_payload/1` keys; the design uses `:role`/`:content`. If
`list_messages_for_thread/1` already returns structs with `.role`/`.content`, adjust
`relevant_messages/1` to read struct fields instead of going through `message_payload/1`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir/assistant/authoring_digest_test.exs`
Expected: PASS.

- [ ] **Step 5: Specs + format + commit** (commit only if asked)

```bash
cd elixir && mix specs.check && mix format --check-formatted
git add elixir/lib/symphony_elixir/assistant/authoring_digest.ex elixir/test/symphony_elixir/assistant/authoring_digest_test.exs
git commit -m "feat(assistant): authoring digest writer (docs/superpowers/authoring-log.md)"
```

---

## Task 6: `PromptBuilder.artifacts_section/1` injects the digest as fallback

**Files:**
- Modify: `elixir/lib/symphony_elixir/prompt_builder.ex` (`artifacts_section/1`, ~line 390)
- Test: `elixir/test/symphony_elixir/prompt_builder_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
@tag :tmp_dir
test "injects authoring-log.md only when no spec/plan/handoff exists", %{tmp_dir: workspace} do
  File.mkdir_p!(Path.join(workspace, "docs/superpowers"))
  File.write!(Path.join(workspace, "docs/superpowers/authoring-log.md"), "# Authoring\n\nuser: do X")

  section = PromptBuilder.artifacts_section(workspace)
  assert section =~ "Authoring conversation"
  assert section =~ "do X"
end

@tag :tmp_dir
test "does NOT inject authoring-log.md when a plan is present", %{tmp_dir: workspace} do
  File.mkdir_p!(Path.join(workspace, "docs/superpowers/plans"))
  File.write!(Path.join(workspace, "docs/superpowers/plans/p.md"), "# Plan\n\nstep 1")
  File.write!(Path.join(workspace, "docs/superpowers/authoring-log.md"), "# Authoring\n\nuser: do X")

  section = PromptBuilder.artifacts_section(workspace)
  assert section =~ "step 1"
  refute section =~ "do X"
end
```

`artifacts_section/1` is currently private (`defp`). For testability, promote it to a
documented public `@doc false` function with `@spec` (it is already called only internally).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd elixir && mix test test/symphony_elixir/prompt_builder_test.exs`
Expected: FAIL — digest not injected / function private.

- [ ] **Step 3: Implement the fallback**

In `prompt_builder.ex`, change `artifacts_section/1` to public and add the digest fallback:

```elixir
@doc false
@spec artifacts_section(Path.t() | nil) :: String.t()
def artifacts_section(workspace) when is_binary(workspace) do
  base = Path.join(workspace, "docs/superpowers")

  if File.dir?(base) do
    primary =
      ["specs", "plans"]
      |> Enum.flat_map(fn dir -> base |> Path.join(dir) |> list_markdown_files() end)
      |> Kernel.++(handoff_file(base))

    {files, header} =
      case primary do
        [] -> {authoring_digest_file(base), "## Authoring conversation (no spec/plan was produced — use as background)\n\n"}
        list -> {list, "\n\n## Existing authoring artifacts (follow these)\n\n"}
      end

    case files do
      [] ->
        ""

      list ->
        {rendered_artifacts, skipped_count} = render_artifacts(workspace, list)

        header <>
          (rendered_artifacts
           |> append_artifact_budget_marker(skipped_count)
           |> Enum.join(@artifact_separator))
    end
  else
    ""
  end
end

def artifacts_section(_workspace), do: ""

defp authoring_digest_file(base) do
  file = Path.join(base, "authoring-log.md")
  if regular_markdown_file?(file), do: [file], else: []
end
```

(Keep `render_artifacts/2`, `append_artifact_budget_marker/2`, `regular_markdown_file?/1`,
`handoff_file/1`, `list_markdown_files/1` unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir/prompt_builder_test.exs`
Expected: PASS.

- [ ] **Step 5: Specs + format + commit** (commit only if asked)

```bash
cd elixir && mix specs.check && mix format --check-formatted
git add elixir/lib/symphony_elixir/prompt_builder.ex elixir/test/symphony_elixir/prompt_builder_test.exs
git commit -m "feat(prompt): inject authoring digest as fallback when no spec/plan/handoff"
```

---

## Task 7: `AgentRunner` writes the digest during execution prep

**Files:**
- Modify: `elixir/lib/symphony_elixir/agent_runner.ex` (`run_codex_turns/4`, ~line 173)
- Test: `elixir/test/symphony_elixir/agent_runner_test.exs`

- [ ] **Step 1: Write a failing test**

Add a test that a dispatched run (with the existing stubbed runner) writes the digest into
the workspace when an authoring thread with messages exists:

```elixir
test "writes the authoring digest into the workspace before running turns", ctx do
  {:ok, thread} = History.ensure_issue_thread(ctx.project_slug, ctx.issue.identifier, %{})
  {:ok, _} = History.append_message(thread, %{role: "user", content: "ship feature Z"})

  run_agent(ctx)   # existing helper that drives AgentRunner.run/3 with a fake runner

  digest = Path.join(ctx.workspace, "docs/superpowers/authoring-log.md")
  assert File.exists?(digest)
  assert File.read!(digest) =~ "ship feature Z"
end
```

(Adapt to the test module's existing fixtures: project slug, issue, workspace path. If the
fake runner short-circuits before workspace prep, place the assertion right after the prep
call instead.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/agent_runner_test.exs`
Expected: FAIL — digest not written.

- [ ] **Step 3: Implement the prep call**

In `agent_runner.ex`, at the top of `run_codex_turns/4` (after computing `workspace_root`,
before building `session_opts`), call the digest writer best-effort:

```elixir
maybe_write_authoring_digest(workspace, issue)
```

Add the helper:

```elixir
defp maybe_write_authoring_digest(workspace, %{project_slug: slug, identifier: identifier})
     when is_binary(slug) and is_binary(identifier) do
  SymphonyElixir.Assistant.AuthoringDigest.write(workspace, slug, identifier)
end

defp maybe_write_authoring_digest(_workspace, _issue), do: :ok
```

(Confirm the `issue` struct field names for project slug / identifier in this module; use
whatever `issue_context/1` already reads.)

- [ ] **Step 4: Run it to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/agent_runner_test.exs`
Expected: PASS.

- [ ] **Step 5: Specs + format + commit** (commit only if asked)

```bash
cd elixir && mix specs.check && mix format --check-formatted
git add elixir/lib/symphony_elixir/agent_runner.ex elixir/test/symphony_elixir/agent_runner_test.exs
git commit -m "feat(agent-runner): generate authoring digest during execution prep"
```

**Part 2 is now shippable: execution gets authoring context as fallback.**

---

## Task 8: Full gate + docs

**Files:**
- Modify: `elixir/README.md`
- Modify: `elixir/docs/logging.md` (only if session-log fields/roles are user-visible)

- [ ] **Step 1: Run the full quality gate**

Run: `cd elixir && make all`
Expected: format check, lint (Credo), coverage, dialyzer all pass.

- [ ] **Step 2: Document the behavior**

In `elixir/README.md`, add a short note: authoring vs execution Codex session roles
(`.symphony/codex-session.json` = execution, `.symphony/codex-session-authoring.json` =
authoring), and the `docs/superpowers/authoring-log.md` fallback injected by `PromptBuilder`
when no spec/plan/handoff exists.

- [ ] **Step 3: Commit** (only if asked)

```bash
git add elixir/README.md elixir/docs/logging.md
git commit -m "docs: document authoring/execution session roles + authoring digest fallback"
```

---

## Task 9 (optional, low priority): show `authoring-log.md` in the document viewer

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_document_controller.ex` (or the issue document controller that lists `docs/superpowers/*`)
- Modify: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex` (`issue_document/1`)
- Test: the corresponding controller/presenter test

- [ ] **Step 1: Write a failing test** that the documents listing includes `authoring-log.md` with `kind: "authoring"` when the file exists in the workspace.
- [ ] **Step 2: Run it to verify it fails.**
- [ ] **Step 3: Add `authoring-log.md` to the listed paths** and map its `kind` to `"authoring"`.
- [ ] **Step 4: Run it to verify it passes.**
- [ ] **Step 5: Frontend** — if the viewer filters by `kind`, allow `"authoring"`; run `cd tracker && npm run test` for affected components.
- [ ] **Step 6: Commit** (only if asked).

---

## Self-Review

**Spec coverage:**
- Design §5 (role-aware sidecar) → Tasks 1–3. ✓
- Design §6.1 (`AuthoringDigest` + `History.find_issue_thread/2`) → Tasks 4–5. ✓
- Design §6.2 (write at execution prep) → Task 7. ✓
- Design §6.3 (`PromptBuilder` fallback) → Task 6. ✓
- Design §6.4 (document viewer) → Task 9 (optional). ✓
- Design §7 risks (evidence gate, goal resume) → Task 3 Step 6 regression + Task 2. ✓
- Design §8 docs → Task 8. ✓

**Type/name consistency:** `Session.write/3`, `Session.resolve/2`, `Session.clear/2`,
`session_role(opts)`, `History.find_issue_thread/2`, `AuthoringDigest.write/3`,
`authoring_digest_file/1`, `PromptBuilder.artifacts_section/1` — used consistently across
tasks.

**Placeholder scan:** no TBD/TODO; each code step has concrete code. Test fixtures explicitly
note "adapt to the module's existing helpers" where the surrounding test harness owns setup
(unavoidable without the exact fixture code), but the assertions and production code are
concrete.

**Build order:** Part 1 (Tasks 1–3) ships independently and fixes `DIS-6`; Part 2 (Tasks 4–7)
is additive; Task 8 gates; Task 9 is optional polish.
