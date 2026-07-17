# Per-session identity, channels & logs — Implementation Plan

**Goal:** Make *session* the unit of identity so one working tree can hold N independent sessions (assistant / issue / orchestrator execution / exploration), each with its own id, channel, and log file — eliminating the phantom synthesized "execution" and the shared-log cross-contamination seen on CDE-1180.

**Architecture:** Reuse the `Thread` record (`assistant_threads`) as the canonical session for every origin (new scope `issue_execution`). Re-key session logs to `<workspace>/.symphony/sessions/<session_id>/transcript.jsonl` and the autonomous channel to `session_log:<session_id>`. The orchestrator creates/closes real execution sessions; `AgentExecution` stops synthesizing interrupted rows and derives them from real sessions.

**Tech Stack:** Elixir/Phoenix (Ecto, Phoenix.Channel), React + TypeScript (Vitest, phoenix.js channels).

**Spec:** `docs/superpowers/specs/2026-07-17-per-session-identity-logs-design.md`

---

## Testing rule (WSL)

Run **one targeted test file or filter at a time, sequentially**. Never run the
full suite, a directory, or a repeated/parallel run. Each step below gives the
smallest command that proves the changed behavior.

- Elixir: `cd elixir && mix test <file>:<line>` (single test) or `mix test <file>`.
- Frontend: `cd tracker && npx vitest run <file> -t "<name>"`.

---

## File Structure

**Elixir (create):**
- `elixir/lib/symphony_elixir/agent/session_store.ex` — resolve/create the per-session log path + session lookup helpers.

**Elixir (modify):**
- `elixir/lib/symphony_elixir/assistant/thread.ex` — add `issue_execution` scope + validation.
- `elixir/lib/symphony_elixir/session_log.ex` — add `resolve_for_session/1`.
- `elixir/lib/symphony_elixir_web/channels/session_log_channel.ex` — `session_log:<session_id>` topic + back-compat shim.
- `elixir/lib/symphony_elixir/agent_execution.ex` — remove `interrupted_executions`/`interrupted_issue?` synthesis; derive from real sessions.
- `elixir/lib/symphony_elixir/orchestrator.ex` — create execution session on dispatch; set status on completion/abort.

**Frontend (modify):**
- `tracker/src/services/session-log.ts` — `sessionLogTopic(sessionId)`.
- `tracker/src/hooks/useSessionLogChannel.ts` — accept `sessionId`.
- `tracker/src/pages/ProjectSessionsPage.tsx` — resolve `?exec=<issue>` → session id.
- `tracker/src/lib/flatSidebarTree.ts` — map `issue_execution → execution`.
- `tracker/src/lib/workspaceCards.ts` — "2+ writers" indicator derivation.

---

## Task 1: `Thread` gains the `issue_execution` scope

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/thread.ex:11` and `:57-68`
- Test: `elixir/test/symphony_elixir/assistant/thread_test.exs` (create if missing)

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/assistant/thread_test.exs`:

```elixir
defmodule SymphonyElixir.Assistant.ThreadTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Assistant.Thread

  test "issue_execution scope is valid and requires project + issue + workspace" do
    valid =
      Thread.changeset(%Thread{}, %{
        scope: "issue_execution",
        project_slug: "advising",
        issue_identifier: "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        status: "active"
      })

    assert valid.valid?

    missing =
      Thread.changeset(%Thread{}, %{
        scope: "issue_execution",
        project_slug: "advising",
        workspace_path: "/tmp/advising/CDE-1180",
        status: "active"
      })

    refute missing.valid?
    assert %{issue_identifier: _} = errors_on(missing)
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/assistant/thread_test.exs`
Expected: FAIL — `issue_execution` rejected by `validate_inclusion(:scope, @scopes)`.

- [ ] **Step 3: Add the scope + validation**

In `thread.ex`, add `"issue_execution"` to `@scopes`:

```elixir
  @scopes ["project", "project_session", "project_explore", "freeform", "issue", "issue_session", "issue_execution", "kb"]
```

Add a clause in `validate_scope_fields/1` (after the `issue_session` clause):

```elixir
      "issue_execution" -> validate_required(changeset, [:project_slug, :issue_identifier])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/assistant/thread_test.exs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/thread.ex elixir/test/symphony_elixir/assistant/thread_test.exs
git commit -m "feat(thread): add issue_execution scope for orchestrator sessions"
```

---

## Task 2: Per-session log path (`Agent.SessionStore`)

**Files:**
- Create: `elixir/lib/symphony_elixir/agent/session_store.ex`
- Test: `elixir/test/symphony_elixir/agent/session_store_test.exs` (create)

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/agent/session_store_test.exs`:

```elixir
defmodule SymphonyElixir.Agent.SessionStoreTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Agent.SessionStore

  test "transcript_path is namespaced by session id under the workspace" do
    path = SessionStore.transcript_path("/tmp/tree", 8015)
    assert path == "/tmp/tree/.symphony/sessions/8015/transcript.jsonl"
  end

  test "append writes one NDJSON line to the session's own file" do
    workspace = Path.join(System.tmp_dir!(), "sessstore-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    :ok = SessionStore.append(workspace, 42, %{"type" => "assistant", "text" => "hi"})
    :ok = SessionStore.append(workspace, 43, %{"type" => "assistant", "text" => "other"})

    p42 = SessionStore.transcript_path(workspace, 42)
    p43 = SessionStore.transcript_path(workspace, 43)

    assert File.read!(p42) =~ "hi"
    refute File.read!(p42) =~ "other"
    assert File.read!(p43) =~ "other"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/agent/session_store_test.exs`
Expected: FAIL — module `SessionStore` does not exist.

- [ ] **Step 3: Create the module**

Create `elixir/lib/symphony_elixir/agent/session_store.ex`:

```elixir
defmodule SymphonyElixir.Agent.SessionStore do
  @moduledoc """
  Per-session Symphony-owned transcript files.

  Each session (any origin) writes to
  `<workspace>/.symphony/sessions/<session_id>/transcript.jsonl`, so co-located
  sessions in one working tree never cross-write logs.
  """

  require Logger

  @spec transcript_path(Path.t(), integer() | String.t()) :: Path.t()
  def transcript_path(workspace, session_id) when is_binary(workspace) do
    Path.join([Path.expand(workspace), ".symphony", "sessions", to_string(session_id), "transcript.jsonl"])
  end

  @spec append(Path.t(), integer() | String.t(), map() | String.t()) :: :ok
  def append(workspace, session_id, entry) when is_binary(workspace) do
    with {:ok, line} <- encode_line(entry),
         path <- transcript_path(workspace, session_id),
         :ok <- File.mkdir_p(Path.dirname(path)),
         :ok <- File.write(path, line <> "\n", [:append]) do
      :ok
    else
      {:error, reason} ->
        Logger.warning("SessionStore.append failed: #{inspect(reason)}")
        :ok

      :error ->
        :ok
    end
  rescue
    error ->
      Logger.warning("SessionStore.append crashed: #{Exception.message(error)}")
      :ok
  end

  @spec exists?(Path.t(), integer() | String.t()) :: boolean()
  def exists?(workspace, session_id) when is_binary(workspace) do
    workspace |> transcript_path(session_id) |> File.regular?()
  end

  defp encode_line(line) when is_binary(line), do: {:ok, String.trim_trailing(line)}
  defp encode_line(%{} = entry), do: Jason.encode(entry)
  defp encode_line(_), do: :error
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/agent/session_store_test.exs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/agent/session_store.ex elixir/test/symphony_elixir/agent/session_store_test.exs
git commit -m "feat(agent): per-session transcript store (one log file per session)"
```

---

## Task 3: `SessionLog.resolve_for_session/1`

**Files:**
- Modify: `elixir/lib/symphony_elixir/session_log.ex` (add function after `resolve_log_source/3`)
- Test: `elixir/test/symphony_elixir/session_log_test.exs` (append a describe block)

- [ ] **Step 1: Write the failing test**

Append to `elixir/test/symphony_elixir/session_log_test.exs`:

```elixir
  describe "resolve_for_session/1" do
    alias SymphonyElixir.Agent.SessionStore

    test "prefers the per-session transcript when present" do
      workspace = Path.join(System.tmp_dir!(), "rfs-#{System.unique_integer([:positive])}")
      File.mkdir_p!(workspace)
      on_exit(fn -> File.rm_rf!(workspace) end)

      :ok = SessionStore.append(workspace, 7, %{"type" => "assistant", "text" => "hi"})

      session = %{id: 7, workspace_path: workspace, agent_kind: "codex"}
      assert {:ok, "symphony", path} = SymphonyElixir.SessionLog.resolve_for_session(session)
      assert path == SessionStore.transcript_path(workspace, 7)
    end

    test "falls back to resolve_log_source when no per-session transcript exists" do
      workspace = Path.join(System.tmp_dir!(), "rfs-#{System.unique_integer([:positive])}")
      File.mkdir_p!(workspace)
      on_exit(fn -> File.rm_rf!(workspace) end)

      session = %{id: 8, workspace_path: workspace, agent_kind: "codex"}
      # No transcript and no native rollout in a temp dir → :error (documents fallback path).
      assert SymphonyElixir.SessionLog.resolve_for_session(session) == :error
    end
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/session_log_test.exs -k "resolve_for_session"`
Expected: FAIL — `resolve_for_session/1` undefined.

- [ ] **Step 3: Add the function**

In `session_log.ex`, add alias and function:

```elixir
  alias SymphonyElixir.Agent.SessionStore

  @doc """
  Resolves the log source for a specific session, preferring its own
  per-session transcript file over the working tree's native agent log.
  """
  @spec resolve_for_session(map()) :: {:ok, String.t(), Path.t()} | :error
  def resolve_for_session(%{id: session_id, workspace_path: workspace} = session)
      when is_binary(workspace) do
    if SessionStore.exists?(workspace, session_id) do
      {:ok, "symphony", SessionStore.transcript_path(workspace, session_id)}
    else
      resolve_log_source(Map.get(session, :agent_kind) || "codex", workspace)
    end
  end

  def resolve_for_session(_session), do: :error
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/session_log_test.exs -k "resolve_for_session"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/session_log.ex elixir/test/symphony_elixir/session_log_test.exs
git commit -m "feat(session-log): resolve_for_session prefers per-session transcript"
```

---

## Task 4: `SessionLogChannel` accepts `session_log:<session_id>`

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/channels/session_log_channel.ex:20-59`, `:225-236`
- Test: `elixir/test/symphony_elixir_web/channels/session_log_channel_workspace_test.exs`

- [ ] **Step 1: Write the failing test**

Append a test that a numeric topic joins by session id (mirror the existing test's setup for socket/auth; reuse its helpers):

```elixir
  test "join session_log:<session_id> tails the session's own transcript", %{socket: socket} do
    workspace = Path.join(System.tmp_dir!(), "chan-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    {:ok, thread} =
      SymphonyElixir.Assistant.History.create_issue_session_thread("advising", "CDE-1180", %{
        title: "exec",
        agent_kind: "codex"
      })

    SymphonyElixir.Agent.SessionStore.append(thread.workspace_path, thread.id, %{
      "type" => "assistant",
      "text" => "hello-session"
    })

    {:ok, reply, _socket} =
      subscribe_and_join(socket, "session_log:#{thread.id}", %{"project_slug" => "advising"})

    assert Enum.any?(reply.entries, fn e -> inspect(e) =~ "hello-session" end)
  end
```

Note: reuse the existing test module's `%{socket: socket}` setup and helpers in
`session_log_channel_workspace_test.exs`. If auth/setup differs, copy the exact
`setup` block already used by the passing tests in that file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/session_log_channel_workspace_test.exs -k "session's own transcript"`
Expected: FAIL — numeric topic falls through to `{:error, "invalid_topic"}`.

- [ ] **Step 3: Add a session-id join clause**

In `session_log_channel.ex`, add a new `join/3` clause BEFORE the existing
`"session_log:" <> topic_rest` clause, matching a numeric session id:

```elixir
  @impl true
  def join("session_log:" <> topic_rest, %{"project_slug" => project_slug} = _params, socket)
      when is_binary(project_slug) and project_slug != "" do
    case Integer.parse(topic_rest) do
      {session_id, ""} -> join_session(session_id, project_slug, socket)
      _ -> join_by_issue(topic_rest, project_slug, socket)
    end
  end
```

Rename the current body of the existing join into `join_by_issue/3` (same code,
just extracted), and add `join_session/3`:

```elixir
  defp join_session(session_id, project_slug, socket) do
    with :ok <- authorize(socket),
         {:ok, thread} <- SymphonyElixir.Assistant.History.get_thread(session_id),
         {:ok, log_agent_kind, path} <- SessionLog.resolve_for_session(thread) do
      workspace = thread.workspace_path
      log_opts = SessionLog.join_tail_opts() |> Keyword.put(:workspace, workspace)
      {:ok, lines, offset} = SessionLog.tail(log_agent_kind, path, log_opts)
      {:ok, _, symphony_offset} = SessionEvents.tail(workspace)

      socket =
        socket
        |> assign(:session_id, session_id)
        |> assign(:issue_identifier, thread.issue_identifier)
        |> assign(:project_slug, project_slug)
        |> assign(:workspace, workspace)
        |> assign(:path, path)
        |> assign(:offset, offset)
        |> assign(:symphony_offset, symphony_offset)
        |> assign(:agent_kind, log_agent_kind)
        |> assign(:preferred_agent_kind, thread.agent_kind)

      send(self(), :poll)

      {:ok,
       %{
         entries: lines,
         offset: offset,
         path: path,
         agent_kind: log_agent_kind,
         preferred_agent_kind: thread.agent_kind,
         log_fallback: log_agent_kind != (thread.agent_kind || "codex")
       }, socket}
    else
      :error -> {:error, %{reason: "session_log_unavailable"}}
      {:error, reason} -> {:error, %{reason: error_reason(reason)}}
    end
  end
```

Back-compat: the extracted `join_by_issue/3` keeps the original per-issue
behavior for legacy `session_log:<project>:<issue>` topics unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/session_log_channel_workspace_test.exs -k "session's own transcript"`
Expected: PASS

- [ ] **Step 5: Verify legacy per-issue join still passes**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/session_log_channel_workspace_test.exs`
Expected: PASS (all existing tests in this file green)

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/channels/session_log_channel.ex elixir/test/symphony_elixir_web/channels/session_log_channel_workspace_test.exs
git commit -m "feat(session-log-channel): join by session id; keep per-issue back-compat"
```

---

## Task 5: Orchestrator creates/closes real execution sessions

**Files:**
- Create: `elixir/lib/symphony_elixir/agent/execution_session.ex` — thin helper to create/close `issue_execution` threads.
- Modify: `elixir/lib/symphony_elixir/orchestrator.ex` — call it on dispatch + completion/abort.
- Test: `elixir/test/symphony_elixir/agent/execution_session_test.exs` (create)

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/agent/execution_session_test.exs`:

```elixir
defmodule SymphonyElixir.Agent.ExecutionSessionTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Agent.ExecutionSession
  alias SymphonyElixir.Assistant.History

  setup do
    # Minimal project + issue fixtures the orchestrator relies on. Reuse the
    # project/issue factory already used by agent_execution_test.exs.
    :ok
  end

  test "ensure/3 creates one issue_execution session and reuses it while active" do
    {:ok, s1} = ExecutionSession.ensure("advising", "CDE-1180", workspace_path: "/tmp/advising/CDE-1180", agent_kind: "codex")
    {:ok, s2} = ExecutionSession.ensure("advising", "CDE-1180", workspace_path: "/tmp/advising/CDE-1180", agent_kind: "codex")

    assert s1.id == s2.id
    assert s1.scope == "issue_execution"
    assert s1.metadata["origin"] == "orchestrator"
  end

  test "finish/2 sets terminal status" do
    {:ok, s} = ExecutionSession.ensure("advising", "CDE-1180", workspace_path: "/tmp/advising/CDE-1180", agent_kind: "codex")
    {:ok, closed} = ExecutionSession.finish(s.id, "aborted")
    assert closed.status == "aborted"
    assert {:ok, reloaded} = History.get_thread(s.id)
    assert reloaded.status == "aborted"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/agent/execution_session_test.exs`
Expected: FAIL — module `ExecutionSession` does not exist.

- [ ] **Step 3: Create the helper**

Create `elixir/lib/symphony_elixir/agent/execution_session.ex`:

```elixir
defmodule SymphonyElixir.Agent.ExecutionSession do
  @moduledoc """
  Creates and closes real `issue_execution` sessions for orchestrator runs, so
  every autonomous run has its own session id, channel, and log file.
  """

  import Ecto.Query, only: [from: 2]

  alias SymphonyElixir.Assistant.{History, Thread}
  alias SymphonyElixir.Repo

  @statuses ~w(active completed aborted paused error)

  @spec ensure(String.t(), String.t(), keyword()) :: {:ok, Thread.t()} | {:error, term()}
  def ensure(project_slug, issue_identifier, opts)
      when is_binary(project_slug) and is_binary(issue_identifier) and is_list(opts) do
    case active_execution(project_slug, issue_identifier) do
      %Thread{} = thread -> {:ok, thread}
      nil -> create(project_slug, issue_identifier, opts)
    end
  end

  @spec finish(integer(), String.t()) :: {:ok, Thread.t()} | {:error, term()}
  def finish(session_id, status) when is_integer(session_id) and status in @statuses do
    with {:ok, thread} <- History.get_thread(session_id) do
      thread
      |> Thread.changeset(%{status: normalize_status(status)})
      |> Repo.update()
    end
  end

  defp active_execution(project_slug, issue_identifier) do
    Repo.one(
      from(t in Thread,
        where:
          t.scope == "issue_execution" and t.project_slug == ^project_slug and
            t.issue_identifier == ^issue_identifier and t.status == "active",
        order_by: [desc: t.id],
        limit: 1
      )
    )
  end

  defp create(project_slug, issue_identifier, opts) do
    workspace = Keyword.fetch!(opts, :workspace_path)
    agent_kind = Keyword.get(opts, :agent_kind)

    metadata =
      %{"origin" => "orchestrator"}
      |> maybe_put("unit_id", Keyword.get(opts, :unit_id))
      |> maybe_put("bundle_role", Keyword.get(opts, :bundle_role))

    %Thread{}
    |> Thread.changeset(%{
      scope: "issue_execution",
      project_slug: project_slug,
      issue_identifier: issue_identifier,
      workspace_path: workspace,
      agent_kind: agent_kind,
      title: Keyword.get(opts, :title) || issue_identifier,
      status: "active",
      metadata: metadata
    })
    |> Repo.insert()
    |> tap_notify()
  end

  # `status: "aborted"` is not in the Thread status enum; map interrupted →
  # "error" for storage while the UI reads richer state from metadata/log.
  defp normalize_status("aborted"), do: "error"
  defp normalize_status("completed"), do: "closed"
  defp normalize_status("paused"), do: "active"
  defp normalize_status(other), do: other

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp tap_notify({:ok, thread} = result) do
    History.notify_recents(result)
    _ = thread
    result
  end

  defp tap_notify(other), do: other
end
```

> Note: `Thread` status enum is `["active", "closed", "error", "archived"]`
> (see `thread.ex:49`). `normalize_status/1` maps run outcomes onto it; the
> operator-facing "aborted/paused/completed" distinction is carried in the
> session's transcript + `metadata`, not the coarse status column. If richer
> statuses are required, that is a follow-up migration (out of scope here).

Update the test's `finish/2` expectation to assert the mapped status:

```elixir
    {:ok, closed} = ExecutionSession.finish(s.id, "aborted")
    assert closed.status == "error"
```

If `History.notify_recents/1` is private, drop `tap_notify` and return
`Repo.insert(...)` directly (verify with:
`cd elixir && rg "def notify_recents" elixir/lib/symphony_elixir/assistant/history.ex`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/agent/execution_session_test.exs`
Expected: PASS

- [ ] **Step 5: Wire into orchestrator dispatch + completion (no behavior test yet)**

In `orchestrator.ex`, at the point a `running_entry` is created on dispatch
(near `running: Map.put(state.running, issue.id, ...)`), call:

```elixir
{:ok, session} =
  SymphonyElixir.Agent.ExecutionSession.ensure(
    running_entry.issue.project_slug,
    running_entry.identifier,
    workspace_path: running_entry_workspace(running_entry),
    agent_kind: Map.get(running_entry, :agent_kind),
    unit_id: Map.get(running_entry, :unit_id),
    bundle_role: Map.get(running_entry, :bundle_role)
  )

running_entry = Map.put(running_entry, :session_id, session.id)
```

On completion/abort (in `pop_running_entry` consumers `apply_normal_completion`
and `record_session_abort`), call `ExecutionSession.finish(session_id, "completed")`
or `"aborted"` using `running_entry_session_id(running_entry)`.

- [ ] **Step 6: Run the orchestrator test file to confirm no regressions**

Run: `cd elixir && mix test test/symphony_elixir/agent_execution_test.exs`
Expected: PASS (existing behavior intact; synthesis removal happens in Task 6)

- [ ] **Step 7: Commit**

```bash
git add elixir/lib/symphony_elixir/agent/execution_session.ex elixir/test/symphony_elixir/agent/execution_session_test.exs elixir/lib/symphony_elixir/orchestrator.ex
git commit -m "feat(orchestrator): create/close real issue_execution sessions per run"
```

---

## Task 6: Remove the synthesized-execution heuristic

**Files:**
- Modify: `elixir/lib/symphony_elixir/agent_execution.ex` (`executions_from_snapshot/1`, delete `interrupted_executions/1` + `interrupted_issue?/1` usage)
- Test: `elixir/test/symphony_elixir/agent_execution_test.exs`

- [ ] **Step 1: Write the failing test**

Add to `elixir/test/symphony_elixir/agent_execution_test.exs`:

```elixir
  test "does not synthesize an aborted execution from a live interactive session log" do
    # Given a routable, non-terminal issue whose canonical tree holds an
    # interactive issue_session log (no orchestrator run in the snapshot),
    # AgentExecution must NOT invent an :aborted row.
    snapshot = %{running: [], retrying: []}

    executions = SymphonyElixir.AgentExecution.list(fake_orchestrator(snapshot), 1_000)

    refute Enum.any?(executions, fn e ->
             e.issue_identifier == "CDE-1180" and e.status == :aborted
           end)
  end
```

> Use the same orchestrator stub pattern already present in this test file
> (search for how existing tests provide a snapshot). If the file lacks a stub,
> add a minimal `fake_orchestrator/1` that answers `Orchestrator.snapshot/2`
> with the given map.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/agent_execution_test.exs -k "does not synthesize"`
Expected: FAIL — `interrupted_executions/1` still emits an `:aborted` row.

- [ ] **Step 3: Remove synthesis from the projection**

In `agent_execution.ex`, change `executions_from_snapshot/1`:

```elixir
  defp executions_from_snapshot(snapshot) do
    live = from_snapshot(snapshot)
    covered = MapSet.new(live, & &1.issue_identifier)
    waiting = subagent_executions(snapshot, [])

    live ++ persisted_execution_sessions(covered) ++ waiting
  end
```

Add `persisted_execution_sessions/1` that reads real `issue_execution` threads
(active + recently interrupted) instead of scanning issue session logs:

```elixir
  defp persisted_execution_sessions(covered) do
    SymphonyElixir.Agent.ExecutionSession.recent_non_live()
    |> Enum.reject(fn s -> MapSet.member?(covered, s.issue_identifier) end)
    |> Enum.map(&execution_from_session/1)
  end
```

Add `ExecutionSession.recent_non_live/0` (returns non-active `issue_execution`
threads updated within a window) and a small `execution_from_session/1` mapper
that fills the `t()` shape (status from thread status/metadata, `session_id: s.id`,
`issue_identifier`, `agent_kind`, `last_event_at: s.updated_at`).

Delete `interrupted_executions/1`, `interrupted_issue?/1`, and
`saved_goal_executions/2` **calls** from `executions_from_snapshot/1`. Keep the
now-unused private helpers only if referenced elsewhere; otherwise remove them to
satisfy `mix` unused-function warnings.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/agent_execution_test.exs -k "does not synthesize"`
Expected: PASS

- [ ] **Step 5: Run the full file to catch regressions from removed helpers**

Run: `cd elixir && mix test test/symphony_elixir/agent_execution_test.exs`
Expected: PASS (update/delete any existing test that asserted the old synthesis)

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/agent_execution.ex elixir/lib/symphony_elixir/agent/execution_session.ex elixir/test/symphony_elixir/agent_execution_test.exs
git commit -m "refactor(agent-execution): derive interrupted rows from real sessions, drop log-heuristic synthesis"
```

---

## Task 7: Frontend — session-id channel + `?exec=` resolver

**Files:**
- Modify: `tracker/src/services/session-log.ts`
- Modify: `tracker/src/hooks/useSessionLogChannel.ts:8`, `:43-67`
- Test: `tracker/src/services/__tests__/session-log.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tracker/src/services/__tests__/session-log.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sessionLogTopic } from "@/services/session-log";

describe("sessionLogTopic", () => {
  it("keys by session id", () => {
    expect(sessionLogTopic(8015)).toBe("session_log:8015");
  });

  it("trims and stringifies", () => {
    expect(sessionLogTopic("42")).toBe("session_log:42");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/services/__tests__/session-log.test.ts`
Expected: FAIL — current `sessionLogTopic(projectSlug, issueIdentifier)` signature.

- [ ] **Step 3: Change the topic helper**

Replace `tracker/src/services/session-log.ts` `sessionLogTopic`:

```ts
export function sessionLogTopic(sessionId: number | string): string {
  const id = String(sessionId).trim();
  if (!id) throw new Error("sessionLogTopic requires a session id");
  return `session_log:${id}`;
}
```

Update `useSessionLogChannel.ts` to accept a `sessionId` and join by it:

```ts
interface UseSessionLogChannelArgs {
  projectSlug: string;
  sessionId: number | string | null;
  enabled: boolean;
  agentKind?: string | null;
}
```

```ts
  const project = projectSlug.trim();
  const id = sessionId == null ? "" : String(sessionId).trim();
  const active = enabled && Boolean(project) && Boolean(id);

  const { channel, connected } = usePhoenixChannel({
    topic: active ? sessionLogTopic(id) : null,
    params: {
      project_slug: project,
      ...(preferredKind ? { agent_kind: preferredKind } : {}),
    },
    // ...unchanged
  });
```

Update the one caller `tracker/src/components/issues/issue-detail/ExecutionChatPanel.tsx`
to pass `sessionId={execution?.sessionId ?? null}` instead of `issueIdentifier`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/services/__tests__/session-log.test.ts`
Expected: PASS

- [ ] **Step 5: Run the ExecutionChatPanel test to confirm the caller still renders**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/ExecutionChatPanel.test.tsx`
Expected: PASS (mock already stubs `useSessionLogChannel`; update the mock's args type if it type-checks props)

- [ ] **Step 6: Commit**

```bash
git add tracker/src/services/session-log.ts tracker/src/hooks/useSessionLogChannel.ts tracker/src/components/issues/issue-detail/ExecutionChatPanel.tsx tracker/src/services/__tests__/session-log.test.ts
git commit -m "feat(tracker): session-log channel keyed by session id"
```

---

## Task 8: Frontend — sidebar mapping + `?exec=` → session id

**Files:**
- Modify: `tracker/src/lib/flatSidebarTree.ts:113-125` (`sessionKindFromRecentScope`)
- Modify: `tracker/src/pages/ProjectSessionsPage.tsx`
- Test: `tracker/src/lib/__tests__/flatSidebarTree.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tracker/src/lib/__tests__/flatSidebarTree.test.ts`:

```ts
  it("maps issue_execution scope to the execution kind", () => {
    const project = buildFlatSidebarProject(
      buildInput({
        sessions: [
          sessionRow({
            id: "thread:9001",
            title: "Autonomous run",
            kind: "execution",
            scope: "issue_execution",
            issueIdentifier: "CDE-1180",
          }),
        ],
      }),
    );
    expect(project.sessions[0].sessionKind).toBe("execution");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/lib/__tests__/flatSidebarTree.test.ts -t "issue_execution"`
Expected: FAIL (or default kind) until the mapping is added.

- [ ] **Step 3: Add the scope mapping**

In `flatSidebarTree.ts` `sessionKindFromRecentScope`:

```ts
    case "issue_session":
    case "issue_execution":
      return "execution";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/lib/__tests__/flatSidebarTree.test.ts -t "issue_execution"`
Expected: PASS

- [ ] **Step 5: Resolve `?exec=` to a session id in `ProjectSessionsPage`**

`?exec=<issue>&surface=autonomous` must resolve to the active execution
session's id and open `/workspaces/<id>`. Add a small effect that, when
`activeExecutionIdentifier` is set, looks up the execution session id from
`useProjectSessions` (`relatedSessions`/`executions`) and navigates via
`projectSessionPath(projectSlug, sessionId)`; if none exists yet, keep the
current issue-scoped fallback view. Keep old deep links working.

Add a test in `tracker/src/lib/__tests__/sidebarRouteResolution.test.ts` if the
resolver logic is placed in a pure helper (preferred): a helper
`resolveExecutionSessionId(sessions, issueIdentifier)` returning the newest
`issue_execution` session id or `null`, with a unit test for both cases.

- [ ] **Step 6: Run the resolver + route tests**

Run: `cd tracker && npx vitest run src/lib/__tests__/sidebarRouteResolution.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tracker/src/lib/flatSidebarTree.ts tracker/src/pages/ProjectSessionsPage.tsx tracker/src/lib/__tests__/flatSidebarTree.test.ts tracker/src/lib/__tests__/sidebarRouteResolution.test.ts
git commit -m "feat(tracker): sidebar issue_execution mapping + exec→session resolver"
```

---

## Task 9: "2+ writers" concurrency indicator

**Files:**
- Modify: `tracker/src/lib/workspaceCards.ts` (add `liveSessionsByWorkspace` derivation)
- Modify: `tracker/src/components/sessions/WorkspaceAccordionItem.tsx` (render badge)
- Test: `tracker/src/lib/__tests__/workspaceCards.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tracker/src/lib/__tests__/workspaceCards.test.ts`:

```ts
  it("flags a workspace with 2+ live sessions writing to the same tree", () => {
    const count = countLiveWritersForWorkspace(
      [
        { workspacePath: "/t/CDE-1180", aggregateStatus: "active" },
        { workspacePath: "/t/CDE-1180", aggregateStatus: "active" },
        { workspacePath: "/t/CDE-1180", aggregateStatus: "idle" },
      ],
      "/t/CDE-1180",
    );
    expect(count).toBe(2);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/lib/__tests__/workspaceCards.test.ts -t "2+ live sessions"`
Expected: FAIL — `countLiveWritersForWorkspace` undefined.

- [ ] **Step 3: Implement the pure helper**

In `workspaceCards.ts`:

```ts
const LIVE_WRITER_STATUSES = new Set(["active", "live", "running", "retrying"]);

export function countLiveWritersForWorkspace(
  sessions: ReadonlyArray<{ workspacePath: string | null; aggregateStatus: string }>,
  workspacePath: string,
): number {
  if (!workspacePath) return 0;
  return sessions.filter(
    (s) => s.workspacePath === workspacePath && LIVE_WRITER_STATUSES.has(s.aggregateStatus),
  ).length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/lib/__tests__/workspaceCards.test.ts -t "2+ live sessions"`
Expected: PASS

- [ ] **Step 5: Render the badge**

In `WorkspaceAccordionItem.tsx`, when `countLiveWritersForWorkspace(...) > 1`,
render a small warning badge: `t("workspacesPage.concurrentWriters", { count })`.
Add the i18n key to `tracker/locales/en/tracker.json` and `pt` equivalent:
`"concurrentWriters": "{{count}} sessões escrevendo nesta árvore"`.

- [ ] **Step 6: Run the component test (if present) or the helper test again**

Run: `cd tracker && npx vitest run src/lib/__tests__/workspaceCards.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tracker/src/lib/workspaceCards.ts tracker/src/components/sessions/WorkspaceAccordionItem.tsx tracker/src/lib/__tests__/workspaceCards.test.ts tracker/locales/en/tracker.json tracker/locales/pt/tracker.json
git commit -m "feat(tracker): indicator when 2+ live sessions share a working tree"
```

---

## Task 10: Manual verification (Advising / CDE-1180)

- [ ] **Step 1:** Start the dev stack; open `/tracker/projects/advising/workspaces` for Advising.
- [ ] **Step 2:** Create an interactive `issue_session` on CDE-1180 ("New session"); confirm **no** `exec:CDE-1180` autonomous row appears from it.
- [ ] **Step 3:** Dispatch an orchestrator run on a test issue; confirm a distinct execution session (`thread:<id>`) appears with its own transcript, addressed at `/workspaces/<id>`; `?exec=<issue>&surface=autonomous` redirects to it.
- [ ] **Step 4:** Run two sessions in the same tree; confirm each tab shows a distinct transcript and the "N sessões escrevendo nesta árvore" badge appears.
- [ ] **Step 5:** Abort the orchestrator run; confirm the execution session shows a terminal state and stops updating, while the interactive session (if still running) continues independently.

---

## Self-Review (author checklist — completed)

- **Spec coverage:** Goals 1–4 map to Tasks 1–4/7/8 (identity+log+channel), Task 5 (orchestrator sessions), Task 6 (delete synthesis), Task 9 (indicator). Non-goals respected (no git coordination).
- **Placeholder scan:** No TBD/TODO; each code step ships real code. Two steps (orchestrator wiring, `ProjectSessionsPage` effect) reference existing functions and give exact call shapes; verification `rg` commands included where a private/public boundary must be checked.
- **Type consistency:** `sessionLogTopic(sessionId)` used consistently in Task 7; `ExecutionSession.ensure/3` + `finish/2` + `recent_non_live/0` names reused across Tasks 5–6; `countLiveWritersForWorkspace` name reused in Task 9. `resolve_for_session/1` returns `{:ok, agent_kind, path}` consumed by the channel.
- **Status enum caveat** documented in Task 5 (Thread status is `active|closed|error|archived`; run outcomes mapped, richer status deferred).
