# CLI Agent Session Transcript — Implementation Plan

**Goal:** Give headless Cursor and Claude orchestrator runs a Symphony-owned JSONL transcript plus typed Observability events so Autonomous and Observability update like Codex, without inventing agent/model/effort defaults.

**Architecture:** One producer in each CliRunner `process_event` path appends normalized Claude-style NDJSON to `<workspace>/.symphony/<agent>-session.jsonl` and keeps emitting bridge maps. Cursor/Claude `CodingAgent` map those bridge maps to typed `:tool_call_*` / `:notification` atoms for `RunUpdate`. `SessionLog.resolve_log_path` prefers the Symphony file (sidecar pointer optional), then falls back to external `~/.cursor` / `~/.claude` projects JSONL. Task settings stay owned by `AgentRunner.agent_settings_opts/1`.

**Tech Stack:** Elixir / ExUnit (`symphony_elixir`), existing CliRunner fake fixtures, `SessionLogChannel` 500ms poll (unchanged).

**Spec:** [`docs/superpowers/specs/2026-07-16-cli-agent-session-transcript-design.md`](../specs/2026-07-16-cli-agent-session-transcript-design.md)

**WSL testing:** Run **one** narrowly targeted test file or `--only` filter at a time. Never batch files, never `--failed` loops, never parallel suites. Ask before expanding scope.

---

## File map

| Path | Role |
|------|------|
| Create `elixir/lib/symphony_elixir/agent/session_transcript.ex` | `path/1`, `append/3`, `write_sidecar/3`, `read_sidecar/2` — best-effort I/O |
| Create `elixir/test/symphony_elixir/agent/session_transcript_test.exs` | Unit tests for path + append + sidecar + I/O resilience |
| Modify `elixir/lib/symphony_elixir/cursor/session_log.ex` | Prefer Symphony JSONL / sidecar before `~/.cursor/projects/...` |
| Modify `elixir/test/symphony_elixir/cursor/session_log_test.exs` | Resolve-order tests |
| Modify `elixir/lib/symphony_elixir/cursor/cli_runner.ex` | On emit-worthy events: `SessionTranscript.append(:cursor, workspace, line)` |
| Modify `elixir/test/symphony_elixir/cursor/cli_runner_test.exs` | Assert Symphony JSONL grows on happy fake turn |
| Modify `elixir/lib/symphony_elixir/cursor/coding_agent.ex` | Typed `on_event` mapping; sidecar write at turn start with model/effort |
| Create `elixir/test/symphony_elixir/cursor/coding_agent_transcript_test.exs` | Unit-test event mapping helper (extract if needed) |
| Modify `elixir/lib/symphony_elixir/claude/session_log.ex` | Prefer Symphony JSONL / sidecar before `~/.claude/projects/...` |
| Modify `elixir/test/symphony_elixir/claude/session_log_test.exs` (or create if missing) | Resolve-order tests |
| Modify `elixir/lib/symphony_elixir/claude/app_server/cli_runner.ex` | Same append pattern for Claude |
| Modify `elixir/test/symphony_elixir/claude/app_server/cli_runner_test.exs` | Assert Symphony JSONL on happy turn |
| Modify `elixir/lib/symphony_elixir/claude/coding_agent.ex` | Typed `on_event` + sidecar |
| Create `elixir/test/symphony_elixir/claude/coding_agent_transcript_test.exs` | Typed mapping tests |
| Touch only if needed: `elixir/test/symphony_elixir/agent_runner_execution_opts_test.exs` | Non-regression for settings (already covers `agent_settings_opts`; re-run one filter) |

**Out of scope files:** ACP / Plan UX, OpenCode, Codex SessionLog, Phoenix push, issue `agent_session_id` persistence.

---

## Entry line contract (both agents)

Append **one Claude-style JSON object per line** so both parsers already work:

```json
{"type":"assistant","message":{"content":[{"type":"text","text":"planning"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tc1","name":"Shell","input":{"command":"ls"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tc1","content":"ok","is_error":false}]}}
```

Do **not** append raw Cursor `stream-json` system/init or partial delta spam that would flood the UI. Map from the **same moments** CliRunner already calls `on_event` for `item/created` (text, tool_call, tool_result). Skip pure `item/progress` deltas for the JSONL file (Observability still gets notifications via typed mapping if desired — v1: progress stays `:notification` only, no append).

---

### Task 1: `Agent.SessionTranscript`

**Files:**
- Create: `elixir/lib/symphony_elixir/agent/session_transcript.ex`
- Create: `elixir/test/symphony_elixir/agent/session_transcript_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Agent.SessionTranscriptTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Agent.SessionTranscript

  setup do
    workspace = Path.join(System.tmp_dir!(), "session-transcript-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf(workspace) end)
    %{workspace: workspace}
  end

  test "path/2 returns agent-specific symphony jsonl", %{workspace: workspace} do
    assert SessionTranscript.path(:cursor, workspace) ==
             Path.join(workspace, ".symphony/cursor-session.jsonl")

    assert SessionTranscript.path(:claude, workspace) ==
             Path.join(workspace, ".symphony/claude-session.jsonl")
  end

  test "append/3 creates .symphony and appends one NDJSON line", %{workspace: workspace} do
    line = %{"type" => "assistant", "message" => %{"content" => [%{"type" => "text", "text" => "hi"}]}}

    assert :ok = SessionTranscript.append(:cursor, workspace, line)

    path = SessionTranscript.path(:cursor, workspace)
    assert File.exists?(path)
    [written] = path |> File.read!() |> String.split("\n", trim: true)
    assert Jason.decode!(written)["message"]["content"] == [%{"type" => "text", "text" => "hi"}]
  end

  test "append/3 never raises when workspace is unwritable", %{workspace: workspace} do
    # Point at a path under a file (not a directory) so mkdir/append fails.
    blocker = Path.join(workspace, "not-a-dir")
    File.write!(blocker, "x")

    assert :ok = SessionTranscript.append(:cursor, blocker, %{"type" => "assistant", "message" => %{"content" => []}})
  end

  test "write_sidecar/3 and read_sidecar/2 round-trip meta", %{workspace: workspace} do
    meta = %{
      "session_id" => "chat-1",
      "agent_kind" => "cursor",
      "model" => "composer-1",
      "effort" => "high",
      "path" => SessionTranscript.path(:cursor, workspace)
    }

    assert :ok = SessionTranscript.write_sidecar(:cursor, workspace, meta)
    assert {:ok, ^meta} = SessionTranscript.read_sidecar(:cursor, workspace)
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run (WSL — single file):

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/agent/session_transcript_test.exs --trace
```

Expected: FAIL — `SymphonyElixir.Agent.SessionTranscript` undefined / function missing.

- [ ] **Step 3: Minimal implementation**

```elixir
defmodule SymphonyElixir.Agent.SessionTranscript do
  @moduledoc false
  require Logger

  @agents %{
    cursor: "cursor-session",
    claude: "claude-session"
  }

  @spec path(atom(), Path.t()) :: Path.t()
  def path(agent_kind, workspace) when is_binary(workspace) do
    base = Map.fetch!(@agents, normalize_agent(agent_kind))
    Path.join(Path.expand(workspace), ".symphony/#{base}.jsonl")
  end

  @spec sidecar_path(atom(), Path.t()) :: Path.t()
  def sidecar_path(agent_kind, workspace) when is_binary(workspace) do
    base = Map.fetch!(@agents, normalize_agent(agent_kind))
    Path.join(Path.expand(workspace), ".symphony/#{base}.json")
  end

  @spec append(atom(), Path.t(), map() | String.t()) :: :ok
  def append(agent_kind, workspace, entry) when is_binary(workspace) do
    with {:ok, line} <- encode_line(entry),
         path <- path(agent_kind, workspace),
         :ok <- File.mkdir_p(Path.dirname(path)),
         :ok <- File.write(path, line <> "\n", [:append]) do
      :ok
    else
      {:error, reason} ->
        Logger.warning("SessionTranscript.append failed: #{inspect(reason)}")
        :ok

      :error ->
        :ok
    end
  rescue
    error ->
      Logger.warning("SessionTranscript.append crashed: #{Exception.message(error)}")
      :ok
  end

  @spec write_sidecar(atom(), Path.t(), map()) :: :ok
  def write_sidecar(agent_kind, workspace, meta) when is_binary(workspace) and is_map(meta) do
    path = sidecar_path(agent_kind, workspace)
    payload = meta |> stringify_keys() |> Map.put_new("started_at", DateTime.utc_now() |> DateTime.to_iso8601())

    with :ok <- File.mkdir_p(Path.dirname(path)),
         {:ok, json} <- Jason.encode(payload),
         :ok <- File.write(path, json) do
      :ok
    else
      {:error, reason} ->
        Logger.warning("SessionTranscript.write_sidecar failed: #{inspect(reason)}")
        :ok
    end
  rescue
    error ->
      Logger.warning("SessionTranscript.write_sidecar crashed: #{Exception.message(error)}")
      :ok
  end

  @spec read_sidecar(atom(), Path.t()) :: {:ok, map()} | :error
  def read_sidecar(agent_kind, workspace) when is_binary(workspace) do
    with {:ok, contents} <- File.read(sidecar_path(agent_kind, workspace)),
         {:ok, %{} = decoded} <- Jason.decode(contents) do
      {:ok, decoded}
    else
      _ -> :error
    end
  end

  defp encode_line(line) when is_binary(line), do: {:ok, String.trim_trailing(line)}
  defp encode_line(%{} = entry), do: Jason.encode(entry)
  defp encode_line(_), do: :error

  defp normalize_agent(:cursor), do: :cursor
  defp normalize_agent("cursor"), do: :cursor
  defp normalize_agent(:claude), do: :claude
  defp normalize_agent("claude"), do: :claude
  defp normalize_agent(other), do: raise(ArgumentError, "unsupported agent_kind: #{inspect(other)}")

  defp stringify_keys(map) do
    Map.new(map, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      {k, v} when is_binary(k) -> {k, v}
    end)
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/agent/session_transcript_test.exs --trace
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/agent/session_transcript.ex \
        elixir/test/symphony_elixir/agent/session_transcript_test.exs
git commit -m "$(cat <<'EOF'
feat(agent): add SessionTranscript for Symphony-owned CLI JSONL

EOF
)"
```

---

### Task 2: Cursor `SessionLog` prefers Symphony path

**Files:**
- Modify: `elixir/lib/symphony_elixir/cursor/session_log.ex` (`resolve_log_path/2`)
- Modify: `elixir/test/symphony_elixir/cursor/session_log_test.exs`

- [ ] **Step 1: Write the failing test** (append to existing file)

```elixir
describe "resolve_log_path/2 prefers Symphony transcript" do
  test "returns .symphony/cursor-session.jsonl when present" do
    workspace = Path.join(System.tmp_dir!(), "cursor-sl-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(workspace, ".symphony"))
    symphony = Path.join(workspace, ".symphony/cursor-session.jsonl")
    File.write!(symphony, ~s({"type":"assistant","message":{"content":[{"type":"text","text":"x"}]}}\n))

    assert {:ok, ^symphony} = SessionLog.resolve_log_path(workspace)
  after
    # cleanup in test body via on_exit if preferred
  end

  test "falls back to projects_dir when Symphony file missing" do
    workspace = Path.join(System.tmp_dir!(), "cursor-sl-fb-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)
    projects = Path.join(System.tmp_dir!(), "cursor-projects-#{System.unique_integer([:positive])}")
    encoded = SessionLog.encode_workspace(workspace)
    external_dir = Path.join([projects, encoded, "agent-transcripts"])
    File.mkdir_p!(external_dir)
    external = Path.join(external_dir, "chat.jsonl")
    File.write!(external, "{}\n")

    assert {:ok, ^external} = SessionLog.resolve_log_path(workspace, projects_dir: projects)
  end
end
```

- [ ] **Step 2: Run single file (expect fail on prefer-Symphony assertion)**

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/cursor/session_log_test.exs --only line:<LINE_OF_NEW_TEST> --trace
```

If `--only line:` is awkward, run the whole file once (still one file):

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/cursor/session_log_test.exs --trace
```

Expected: FAIL — resolve still returns external / `:error` while Symphony file exists.

- [ ] **Step 3: Implement resolve preference**

At the top of `resolve_log_path/2`:

```elixir
def resolve_log_path(workspace, opts \\ []) when is_binary(workspace) do
  alias SymphonyElixir.Agent.SessionTranscript

  symphony = SessionTranscript.path(:cursor, workspace)

  cond do
    File.regular?(symphony) ->
      {:ok, symphony}

    true ->
      case SessionTranscript.read_sidecar(:cursor, workspace) do
        {:ok, %{"path" => path}} when is_binary(path) ->
          if File.regular?(path), do: {:ok, path}, else: resolve_external(workspace, opts)

        _ ->
          resolve_external(workspace, opts)
      end
  end
end

defp resolve_external(workspace, opts) do
  # existing body (projects_dir wildcard sort)
end
```

Move the current body into `resolve_external/2`.

- [ ] **Step 4: Re-run the same file — expect PASS**

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/cursor/session_log_test.exs --trace
```

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/cursor/session_log.ex \
        elixir/test/symphony_elixir/cursor/session_log_test.exs
git commit -m "$(cat <<'EOF'
feat(cursor): prefer Symphony session JSONL in SessionLog resolve

EOF
)"
```

---

### Task 3: Cursor `CliRunner` appends transcript lines

**Files:**
- Modify: `elixir/lib/symphony_elixir/cursor/cli_runner.ex`
- Modify: `elixir/test/symphony_elixir/cursor/cli_runner_test.exs`

- [ ] **Step 1: Extend happy-path test**

In `test "happy turn captures the chat id and emits translated events"`, after asserting events:

```elixir
# workspace is created inside run/2 — refactor run/2 to return workspace OR
# re-read from a known path. Prefer changing the private run/2 helper to return
# {result, events, workspace}.

symphony = Path.join(workspace, ".symphony/cursor-session.jsonl")
assert File.exists?(symphony)
lines = symphony |> File.read!() |> String.split("\n", trim: true)
assert length(lines) >= 2

decoded = Enum.map(lines, &Jason.decode!/1)
assert Enum.any?(decoded, fn
  %{"type" => "assistant", "message" => %{"content" => [%{"type" => "tool_use"} | _]}} -> true
  %{"type" => "assistant", "message" => %{"content" => [%{"type" => "tool_use", ...}]}} -> true
  _ -> false
end)
```

Concrete assertion that matches the fake fixture tool name:

```elixir
assert Enum.any?(decoded, fn row ->
  get_in(row, ["message", "content"])
  |> List.wrap()
  |> Enum.any?(fn
    %{"type" => "tool_use", "name" => "mcp__symphony__list_issues"} -> true
    _ -> false
  end)
end)
```

Refactor `run/2` in the test module to return `{result, events, workspace}`.

- [ ] **Step 2: Run single file — expect FAIL (no JSONL)**

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/cursor/cli_runner_test.exs --trace
```

Expected: FAIL — Symphony file missing.

- [ ] **Step 3: Implement append in CliRunner**

1. Put `workspace` into `initial_state`.
2. Add helper that builds Claude-style lines from the bridge `on_event` payload **and** appends before/after calling `on_event`.

Recommended shape — wrap `on_event` once in `run_turn/2`:

```elixir
alias SymphonyElixir.Agent.SessionTranscript

on_event =
  fn notification ->
    maybe_append_transcript(workspace, notification)
    on_event.(notification)
  end
```

```elixir
defp maybe_append_transcript(workspace, %{
       "method" => "item/created",
       "params" => %{"item" => item}
     }) do
  case transcript_line(item) do
    nil -> :ok
    line -> SessionTranscript.append(:cursor, workspace, line)
  end
end

defp maybe_append_transcript(_workspace, _notification), do: :ok

defp transcript_line(%{"type" => "text", "text" => text}) when is_binary(text) and text != "" do
  %{
    "type" => "assistant",
    "message" => %{"content" => [%{"type" => "text", "text" => text}]}
  }
end

defp transcript_line(%{"type" => "tool_call", "tool_use_id" => id, "name" => name} = item)
     when is_binary(id) and is_binary(name) do
  %{
    "type" => "assistant",
    "message" => %{
      "content" => [
        %{
          "type" => "tool_use",
          "id" => id,
          "name" => name,
          "input" => Map.get(item, "input") || %{}
        }
      ]
    }
  }
end

defp transcript_line(%{"type" => "tool_result", "tool_use_id" => id} = item) when is_binary(id) do
  %{
    "type" => "user",
    "message" => %{
      "content" => [
        %{
          "type" => "tool_result",
          "tool_use_id" => id,
          "content" => Map.get(item, "content"),
          "is_error" => Map.get(item, "is_error", false)
        }
      ]
    }
  }
end

defp transcript_line(_), do: nil
```

Do **not** read or invent `:model` / `:effort` here.

- [ ] **Step 4: Re-run same file — PASS**

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/cursor/cli_runner_test.exs --trace
```

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/cursor/cli_runner.ex \
        elixir/test/symphony_elixir/cursor/cli_runner_test.exs
git commit -m "$(cat <<'EOF'
feat(cursor): append Symphony transcript from CliRunner stream-json

EOF
)"
```

---

### Task 4: Cursor `CodingAgent` typed events + sidecar meta

**Files:**
- Modify: `elixir/lib/symphony_elixir/cursor/coding_agent.ex`
- Create: `elixir/test/symphony_elixir/cursor/coding_agent_transcript_test.exs`

Today (`coding_agent.ex` ~73–75) every CliRunner notification becomes `:notification`. Codex emits `:tool_call_started` / `:tool_call_completed` so Observability `last_codex_event` advances.

- [ ] **Step 1: Failing unit test for mapping**

Extract a pure function (keep it in `CodingAgent` as `@doc false` or a tiny private module tested via `CodingAgent` public test helper). Prefer testing through a public `@doc false` function to avoid fighting private-clause tests:

```elixir
# In CodingAgent:
@doc false
def bridge_event_to_message(notification) when is_map(notification) do
  # returns {event_atom, details_map}
end
```

Test:

```elixir
defmodule SymphonyElixir.Cursor.CodingAgentTranscriptTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Cursor.CodingAgent

  test "maps tool_call item/created to :tool_call_started" do
    notification = %{
      "method" => "item/created",
      "params" => %{
        "item" => %{
          "type" => "tool_call",
          "tool_use_id" => "tc1",
          "name" => "Shell",
          "input" => %{"command" => "ls"}
        }
      }
    }

    assert {:tool_call_started, details} = CodingAgent.bridge_event_to_message(notification)
    assert details.payload == notification
  end

  test "maps tool_result item/created to :tool_call_completed" do
    notification = %{
      "method" => "item/created",
      "params" => %{
        "item" => %{
          "type" => "tool_result",
          "tool_use_id" => "tc1",
          "content" => "ok",
          "is_error" => false
        }
      }
    }

    assert {:tool_call_completed, _} = CodingAgent.bridge_event_to_message(notification)
  end

  test "maps tool_result errors to :tool_call_failed" do
    notification = %{
      "method" => "item/created",
      "params" => %{"item" => %{"type" => "tool_result", "tool_use_id" => "tc1", "is_error" => true}}
    }

    assert {:tool_call_failed, _} = CodingAgent.bridge_event_to_message(notification)
  end

  test "maps progress and text to :notification" do
    progress = %{"method" => "item/progress", "params" => %{"delta" => %{"type" => "text", "text" => "x"}}}
    assert {:notification, _} = CodingAgent.bridge_event_to_message(progress)

    text = %{
      "method" => "item/created",
      "params" => %{"item" => %{"type" => "text", "text" => "hello"}}
    }

    assert {:notification, _} = CodingAgent.bridge_event_to_message(text)
  end
end
```

- [ ] **Step 2: Run single new file — FAIL**

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/cursor/coding_agent_transcript_test.exs --trace
```

- [ ] **Step 3: Implement mapping + wire `on_event` + sidecar**

```elixir
def bridge_event_to_message(%{"method" => "item/created", "params" => %{"item" => item}} = notification) do
  event =
    case item do
      %{"type" => "tool_call"} -> :tool_call_started
      %{"type" => "tool_result", "is_error" => true} -> :tool_call_failed
      %{"type" => "tool_result"} -> :tool_call_completed
      _ -> :notification
    end

  {event, %{payload: notification, raw: Jason.encode!(notification)}}
end

def bridge_event_to_message(notification) when is_map(notification) do
  {:notification, %{payload: notification, raw: Jason.encode!(notification)}}
end
```

In `run_turn/3`, replace the opaque wrapper:

```elixir
alias SymphonyElixir.Agent.SessionTranscript

SessionTranscript.write_sidecar(:cursor, session.workspace, %{
  "session_id" => session.cli_session_id,
  "agent_kind" => "cursor",
  "model" => session.model || Keyword.get(opts, :model),
  "effort" => Keyword.get(opts, :effort) || Map.get(session, :effort),
  "path" => SessionTranscript.path(:cursor, session.workspace)
})

on_event = fn notification ->
  {event, details} = bridge_event_to_message(notification)
  emit_message(on_message, event, details, %{})
end
```

Rules:
- Use **only** values already on `session` / `opts` from `AgentRunner` — never hardcode model/effort.
- `nil` model/effort in sidecar is fine (encode as JSON null or omit via existing put_if pattern).

- [ ] **Step 4: Re-run mapping tests — PASS**

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/cursor/coding_agent_transcript_test.exs --trace
```

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/cursor/coding_agent.ex \
        elixir/test/symphony_elixir/cursor/coding_agent_transcript_test.exs
git commit -m "$(cat <<'EOF'
feat(cursor): emit typed tool events and write transcript sidecar

EOF
)"
```

---

### Task 5: Claude `SessionLog` prefers Symphony path

**Files:**
- Modify: `elixir/lib/symphony_elixir/claude/session_log.ex`
- Modify or create: `elixir/test/symphony_elixir/claude/session_log_test.exs`

Mirror Task 2 with `:claude` / `.symphony/claude-session.jsonl` and Claude `projects_dir` fallback (`encode_workspace` already Claude-specific).

- [ ] **Step 1: Failing resolve tests** (same structure as Cursor, agent `:claude`)
- [ ] **Step 2: Run**

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/claude/session_log_test.exs --trace
```

Expected: FAIL until preference lands.

- [ ] **Step 3: Implement `resolve_log_path/2` preference** (same cond as Cursor, `SessionTranscript.path(:claude, ...)`)
- [ ] **Step 4: Re-run — PASS**
- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(claude): prefer Symphony session JSONL in SessionLog resolve

EOF
)"
```

---

### Task 6: Claude `CliRunner` appends transcript lines

**Files:**
- Modify: `elixir/lib/symphony_elixir/claude/app_server/cli_runner.ex`
- Modify: `elixir/test/symphony_elixir/claude/app_server/cli_runner_test.exs`

Reuse the same `maybe_append_transcript/2` + `transcript_line/1` pattern (or extract shared private helpers into `SessionTranscript` if duplication exceeds ~40 lines — prefer extract to `SessionTranscript.line_from_bridge_item/1` in this task if both runners need the same clauses).

Preferred DRY (do it in this task if Cursor helper already exists duplicated):

```elixir
# In SessionTranscript:
@spec line_from_bridge_item(map()) :: map() | nil
def line_from_bridge_item(item), do: ... # move transcript_line/1 here
```

Then both CliRunners call:

```elixir
case SessionTranscript.line_from_bridge_item(item) do
  nil -> :ok
  line -> SessionTranscript.append(:claude, workspace, line)
end
```

Update Cursor CliRunner to use the shared helper (small follow-up commit inside this task is OK).

- [ ] **Step 1: Extend Claude happy-path cli_runner test** to assert `.symphony/claude-session.jsonl` exists and contains a `tool_use` or text line matching the fake fixture.
- [ ] **Step 2: Run**

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/claude/app_server/cli_runner_test.exs --trace
```

Expected: FAIL missing JSONL.

- [ ] **Step 3: Wrap `on_event` in Claude `run_turn/2` like Cursor**
- [ ] **Step 4: Re-run — PASS**
- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(claude): append Symphony transcript from CliRunner stream-json

EOF
)"
```

---

### Task 7: Claude `CodingAgent` typed events + sidecar

**Files:**
- Modify: `elixir/lib/symphony_elixir/claude/coding_agent.ex`
- Create: `elixir/test/symphony_elixir/claude/coding_agent_transcript_test.exs`

Mirror Task 4:
- `bridge_event_to_message/1` with identical semantics (or move to `SymphonyElixir.Agent.BridgeEvents` if both agents share 100% — only extract if the two functions are identical after Task 4).
- Replace Claude `on_event` wrapper at ~107–109.
- `SessionTranscript.write_sidecar(:claude, session.workspace, meta)` using `session.model`, `session.effort`, `session.cli_session_id`.

- [ ] **Step 1: Write failing mapping tests** (copy Cursor cases, alias Claude module)
- [ ] **Step 2: Run**

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/claude/coding_agent_transcript_test.exs --trace
```

- [ ] **Step 3: Implement**
- [ ] **Step 4: Re-run — PASS**
- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(claude): emit typed tool events and write transcript sidecar

EOF
)"
```

---

### Task 8: Task-settings non-regression (no new defaults)

**Files:**
- Re-run only: `elixir/test/symphony_elixir/agent_runner_execution_opts_test.exs`
- Grep new code for hard-coded model/effort strings in SessionTranscript / CliRunner / CodingAgent transcript paths — none allowed except reading from session/opts.

- [ ] **Step 1: Grep guard**

```bash
cd /home/raphaelcangucu/symphony/elixir && rg -n "composer-|gpt-|sonnet|effort.*high|model.*=.*\"" \
  lib/symphony_elixir/agent/session_transcript.ex \
  lib/symphony_elixir/cursor/cli_runner.ex \
  lib/symphony_elixir/claude/app_server/cli_runner.ex
```

Expected: no hits that invent defaults (CLI flag helpers that omit invalid models are fine).

- [ ] **Step 2: Run existing settings tests (single file)**

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/agent_runner_execution_opts_test.exs --trace
```

Expected: PASS unchanged.

- [ ] **Step 3: Commit only if you added a tiny clarifying test; otherwise skip commit**

If adding a test that sidecar meta keys are passed through from opts without defaults, put it in `coding_agent_transcript_test.exs` as a pure function test of the meta map builder — do **not** start a full agent turn.

---

### Task 9: Manual acceptance checklist (no code)

After Tasks 1–8 green:

1. Dispatch Advising-style Cursor issue with agent/model/effort set on the task.
2. While tools/shell run, Autonomous workspace poll shows growing transcript (not empty until end).
3. Observability row `last_event` shows `tool_call_started` / `tool_call_completed` (not stuck solely on `notification`).
4. Agent/model badge matches task settings.
5. Repeat with Claude headless.
6. Delete `.symphony/cursor-session.jsonl` and confirm external JSONL fallback still works when present.
7. Force append failure (optional: chmod) and confirm turn continues.

Do not claim done until at least Cursor path is observed live.

---

## Spec coverage checklist

| Spec § | Task |
|--------|------|
| Symphony JSONL writer | Task 1, 3, 6 |
| Resolve prefer Symphony → fallback | Tasks 2, 5 |
| Typed Observability events | Tasks 4, 7 |
| Task settings SoT / no bridge defaults | Task 8 + sidecar meta in 4/7 |
| Sidecar meta | Tasks 1, 4, 7 |
| No Phoenix push / API change | (none — poll unchanged) |
| Claude + Cursor | Tasks 2–7 |
| Append failure soft | Task 1 |
| Acceptance | Task 9 |

## Placeholder / consistency notes

- Agent atoms: `:cursor` / `:claude` (and string forms) only.
- Filenames: `cursor-session.jsonl` / `claude-session.jsonl` (+ `.json` sidecar).
- Bridge methods consumed: `item/created` with `tool_call` | `tool_result` | `text`.
- Typed atoms: `:tool_call_started`, `:tool_call_completed`, `:tool_call_failed`, `:notification` (plus existing `:session_started` / `:turn_completed` / `:turn_ended_with_error`).

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-16-cli-agent-session-transcript-plan.md`.

Documents:
- Plan: `docs/superpowers/plans/2026-07-16-cli-agent-session-transcript-plan.md`
- Spec: `docs/superpowers/specs/2026-07-16-cli-agent-session-transcript-design.md`

**Next:** execute task-by-task (TDD, one WSL test file at a time, commit per task). Say when to start Task 1.
