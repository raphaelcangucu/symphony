# Assistant `/btw` Side Question — Implementation Plan

**Goal:** Add a `/btw <text>` command that answers a quick side question in a floating overlay using an ephemeral, read-only, no-tool one-shot Codex run. It never interrupts the main turn and is never persisted to history.

**Architecture:** The composer already classifies `/btw` as `kind: "btw"` (infer plan). `ProjectAssistantPanel` pushes `btw` to the channel and opens a `BtwOverlay`. The channel replies with a `btw_id`, then spawns a Task under `SymphonyElixir.TaskSupervisor` that runs `SymphonyElixir.Assistant.SideQuery.run/3` — an ephemeral session built from the thread's conversation history with `dynamic_tools: []` and a deny-all tool executor — streaming `btw_delta`/`btw_completed`/`btw_error` scoped by `btw_id`. Nothing is persisted.

**Tech Stack:** Elixir/OTP, Phoenix.Channel, ExUnit, React 19 + Tailwind v4, vitest.

**Source of truth:** `docs/superpowers/specs/2026-06-02-assistant-chat-steering-queue-design.md` §4, §9.

**Depends on:** `2026-06-02-assistant-turn-foundation.md` (Task.Supervisor turn model) and `2026-06-02-assistant-infer-steering.md` (slash parser, `kind: "btw"`, composer palette).

---

## Task 1: `SideQuery` ephemeral runner (backend)

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/side_query.ex`
- Test: `elixir/test/symphony_elixir/assistant/side_query_test.exs`

### Step 1: Write the failing test (stub runner)

```elixir
defmodule SymphonyElixir.Assistant.SideQueryTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Assistant.{History, SideQuery}
  alias SymphonyElixir.LocalTracker.Context

  setup do
    migrate_repo()
    clean_repo()
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, thread} = History.ensure_thread("macro-markets", %{workspace_path: System.tmp_dir!()})
    {:ok, thread: thread}
  end

  test "streams deltas, returns the answer, and never persists", %{thread: thread} do
    test_pid = self()

    runner = fn _workspace, prompt, _issue, opts ->
      send(test_pid, {:prompt, prompt})
      Keyword.fetch!(opts, :on_assistant_delta).("42")
      {:ok, %{assistant_message: "The answer is 42.", tool_calls: []}}
    end

    assert {:ok, "The answer is 42."} =
             SideQuery.run(thread, "what is the answer",
               runner: runner,
               on_delta: fn delta -> send(test_pid, {:delta, delta}) end
             )

    assert_receive {:delta, "42"}
    assert_receive {:prompt, prompt}
    assert prompt =~ "side question"
    assert prompt =~ "what is the answer"

    # Not persisted: the thread still has no messages.
    assert History.list_messages_for_thread(thread.id) == []
  end
end
```

### Step 2: Run to verify it fails

Run: `cd elixir && mix test test/symphony_elixir/assistant/side_query_test.exs`
Expected: FAIL — module not found.

### Step 3: Implement `SideQuery`

```elixir
defmodule SymphonyElixir.Assistant.SideQuery do
  @moduledoc """
  Ephemeral, read-only, no-tool one-shot side answers for the `/btw` command.

  Builds a prompt from the thread's recent history plus a side-question instruction,
  runs a single Codex turn with no tools, streams deltas, and returns the answer text.
  Nothing is persisted to the conversation history.
  """

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Codex.CodingAgent

  @history_limit 20

  @system_instruction """
  This is a side question from the user. Answer it directly in a single response.
  You are a separate, lightweight assistant; the main agent is NOT interrupted.
  You share the conversation context but have NO tools available: do not read files,
  run commands, or promise to take any action. Never say "Let me try" — just answer.
  """

  @spec run(SymphonyElixir.Assistant.Thread.t(), String.t(), keyword()) ::
          {:ok, String.t()} | {:error, term()}
  def run(%{id: thread_id, workspace_path: workspace_path} = _thread, question, opts \\ [])
      when is_binary(question) and is_list(opts) do
    with {:ok, trimmed} <- normalize(question),
         workspace <- resolve_workspace(workspace_path),
         :ok <- File.mkdir_p(workspace) do
      history =
        thread_id
        |> History.list_messages_for_thread()
        |> Enum.map(&History.message_payload/1)

      prompt = build_prompt(history, trimmed)
      runner = Keyword.get(opts, :runner, &default_runner/4)

      runner_opts = [
        dynamic_tools: [],
        tool_executor: fn _tool, _arguments -> {:error, :no_tools_in_side_query} end,
        on_assistant_delta: Keyword.get(opts, :on_delta, fn _delta -> :ok end)
      ]

      case runner.(workspace, prompt, side_issue(), runner_opts) do
        {:ok, %{assistant_message: answer}} when is_binary(answer) -> {:ok, answer}
        {:ok, _other} -> {:error, :no_answer}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp normalize(question) do
    case String.trim(question) do
      "" -> {:error, :question_required}
      trimmed -> {:ok, trimmed}
    end
  end

  defp resolve_workspace(path) when is_binary(path) and path != "", do: path
  defp resolve_workspace(_path), do: System.tmp_dir!()

  defp side_issue, do: %{id: "assistant:btw", identifier: "btw", title: "Side question"}

  defp build_prompt(history, question) do
    """
    #{@system_instruction}

    Recent conversation:
    #{format_history(history)}

    Side question:
    #{question}
    """
    |> String.trim()
  end

  defp format_history(history) do
    history
    |> Enum.take(-@history_limit)
    |> Enum.map(fn message ->
      role = Map.get(message, :role) || Map.get(message, "role")
      content = Map.get(message, :content) || Map.get(message, "content")
      "#{role}: #{content}"
    end)
    |> case do
      [] -> "(no prior messages)"
      lines -> Enum.join(lines, "\n")
    end
  end

  defp default_runner(workspace, prompt, issue, opts) do
    {:ok, collector} = Agent.start_link(fn -> "" end)

    on_message = fn message ->
      delta = extract_delta(message)

      if is_binary(delta) and delta != "" do
        Agent.update(collector, fn acc -> acc <> delta end)
        Keyword.get(opts, :on_assistant_delta, fn _ -> :ok end).(delta)
      end
    end

    try do
      case CodingAgent.run_session(workspace, prompt, issue, Keyword.put(opts, :on_message, on_message)) do
        {:ok, _result} ->
          {:ok, %{assistant_message: fallback(Agent.get(collector, & &1)), tool_calls: []}}

        {:error, reason} ->
          {:error, reason}
      end
    after
      Agent.stop(collector)
    end
  end

  defp extract_delta(message) when is_map(message) do
    payload = Map.get(message, :payload) || Map.get(message, "payload") || %{}

    get_in(payload, ["params", "delta"]) ||
      get_in(payload, ["params", "text"]) ||
      get_in(payload, ["params", "message", "content"])
  end

  defp extract_delta(_message), do: nil

  defp fallback(""), do: "(no answer returned)"
  defp fallback(text), do: text
end
```

> `CodingAgent.run_session/4` is the existing synchronous start→run→stop entry point (`coding_agent.ex:39-47`). The deny-all `tool_executor` plus `dynamic_tools: []` enforce the no-tools constraint.

### Step 4: Run + gate

Run: `cd elixir && mix test test/symphony_elixir/assistant/side_query_test.exs && mix format && mix specs.check`
Expected: PASS. `SideQuery.run/3` has a `@spec`.

### Step 5: Commit

```bash
git add elixir/lib/symphony_elixir/assistant/side_query.ex elixir/test/symphony_elixir/assistant/side_query_test.exs
git commit -m "feat(assistant): add ephemeral no-tool SideQuery runner for /btw"
```

---

## Task 2: `btw` channel handler

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` (new `handle_in("btw", ...)`)
- Test: `elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs`

### Step 1: Write the failing test

```elixir
  test "btw runs an ephemeral side query and streams answer without persisting" do
    side_runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_assistant_delta).("Yes")
      {:ok, %{assistant_message: "Yes, useMemo memoizes values.", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_side_runner, side_runner)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :assistant_side_runner) end)

    {:ok, %{messages: []}, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

    assert_push("history_loaded", %{messages: []})

    ref = push(socket, "btw", %{"message" => "what does useMemo do?"})
    assert_reply(ref, :ok, %{btw_id: btw_id})
    assert is_binary(btw_id)

    assert_push("btw_delta", %{btw_id: ^btw_id, delta: "Yes"})
    assert_push("btw_completed", %{btw_id: ^btw_id, message: "Yes, useMemo memoizes values."})

    # The side query must not have created any chat messages.
    {:ok, %{messages: messages}, _socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

    assert messages == []
  end
```

### Step 2: Run to verify it fails

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs -o "btw runs an ephemeral"`
Expected: FAIL — no `btw` handler.

### Step 3: Implement the handler

In `assistant_channel.ex`, add the alias `SideQuery` to the existing alias line (`:7`):

```elixir
  alias SymphonyElixir.Assistant.{CodexSession, History, Payload, SideQuery, ToolExecutor}
```

Add the handler after `steer_turn` (from the infer plan):

```elixir
  def handle_in("btw", %{"message" => message}, socket) when is_binary(message) do
    case String.trim(message) do
      "" ->
        {:reply, {:error, %{reason: "message is required"}}, socket}

      question ->
        thread = ensure_btw_thread(socket)
        btw_id = "btw-" <> Integer.to_string(System.unique_integer([:positive]))
        channel_pid = self()
        side_runner = Application.get_env(:symphony_elixir, :assistant_side_runner)

        run_opts =
          [on_delta: fn delta -> push(socket, "btw_delta", %{btw_id: btw_id, delta: delta}) end]
          |> maybe_put_side_runner(side_runner)

        Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor, fn ->
          case SideQuery.run(thread, question, run_opts) do
            {:ok, answer} -> send(channel_pid, {:btw_finished, btw_id, {:ok, answer}})
            {:error, reason} -> send(channel_pid, {:btw_finished, btw_id, {:error, reason}})
          end
        end)

        {:reply, {:ok, %{btw_id: btw_id}}, socket}
    end
  end

  def handle_in("btw", _payload, socket), do: {:reply, {:error, %{reason: "message is required"}}, socket}
```

Add the completion `handle_info` (next to the steer-result clauses):

```elixir
  def handle_info({:btw_finished, btw_id, {:ok, answer}}, socket) do
    push(socket, "btw_completed", %{btw_id: btw_id, message: answer})
    {:noreply, socket}
  end

  def handle_info({:btw_finished, btw_id, {:error, reason}}, socket) do
    push(socket, "btw_error", %{btw_id: btw_id, message: error_reason(reason)})
    {:noreply, socket}
  end
```

Add the private helpers near the other `defp`s:

```elixir
  defp ensure_btw_thread(%Socket{assigns: %{thread: %{} = thread}}), do: thread

  defp ensure_btw_thread(%Socket{assigns: %{project_slug: project_slug}}) when is_binary(project_slug) do
    case History.ensure_thread(project_slug, %{}) do
      {:ok, thread} -> thread
      _ -> %{id: nil, workspace_path: nil}
    end
  end

  defp ensure_btw_thread(_socket), do: %{id: nil, workspace_path: nil}

  defp maybe_put_side_runner(opts, runner) when is_function(runner, 4), do: Keyword.put(opts, :runner, runner)
  defp maybe_put_side_runner(opts, _runner), do: opts
```

> `SideQuery.run/3` tolerates `%{id: nil, workspace_path: nil}` (it falls back to a temp workspace and an empty history list — guard `History.list_messages_for_thread(nil)` by returning `[]` for a nil id; if that function raises on nil, add a `defp ensure_btw_thread` path that only runs for real threads and reply `{:error, ...}` otherwise. In practice the issue/project assistant always has a thread assigned at join, so the `%{}` branch is the live path.)

### Step 4: Run + gate

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs && mix format && mix specs.check`
Expected: PASS.

### Step 5: Commit

```bash
git add elixir/lib/symphony_elixir_web/channels/assistant_channel.ex elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs
git commit -m "feat(assistant): add btw channel handler for ephemeral side questions"
```

---

## Task 3: `BtwOverlay` component + channel bindings (frontend)

**Files:**
- Create: `tracker/src/components/assistant/BtwOverlay.tsx`
- Modify: `tracker/src/services/phoenix/assistantChannel.ts` (bind `btw_delta`/`btw_completed`/`btw_error`)
- Test: `tracker/src/components/assistant/__tests__/BtwOverlay.test.tsx`

### Step 1: Write the failing test

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BtwOverlay } from "../BtwOverlay";

describe("BtwOverlay", () => {
  it("renders the question and streamed answer", () => {
    render(<BtwOverlay question="what is x?" answer="x is 1" status="streaming" onClose={vi.fn()} />);
    expect(screen.getByText("what is x?")).toBeInTheDocument();
    expect(screen.getByText("x is 1")).toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<BtwOverlay question="q" answer="" status="streaming" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an error message when status is error", () => {
    render(<BtwOverlay question="q" answer="boom" status="error" onClose={vi.fn()} />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
});
```

### Step 2: Run to verify it fails

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/BtwOverlay.test.tsx`
Expected: FAIL — module not found.

### Step 3: Implement the overlay

```tsx
import { X } from "lucide-react";
import { useEffect } from "react";

import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";

export type BtwStatus = "streaming" | "complete" | "error";

interface BtwOverlayProps {
  question: string;
  answer: string;
  status: BtwStatus;
  onClose: () => void;
}

export function BtwOverlay({ question, answer, status, onClose }: BtwOverlayProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/20 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label="Side question"
        className="w-full max-w-lg rounded-2xl border bg-card p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">By the way</p>
          <button type="button" aria-label="Close side question" onClick={onClose} className="rounded p-0.5 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-sm font-medium">{question}</p>
        <div className={cn("text-sm", status === "error" && "text-destructive")}>
          {status === "streaming" && answer.length === 0 ? (
            <span className="text-muted-foreground">Thinking…</span>
          ) : (
            <Markdown className="max-w-none text-sm leading-7">{answer}</Markdown>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Esc to dismiss · not saved to the conversation</p>
      </div>
    </div>
  );
}
```

### Step 4: Add channel bindings

In `assistantChannel.ts`, add to `AssistantChannelHandlers`:

```ts
  onBtwDelta?: (payload: { btwId: string; delta: string }) => void;
  onBtwCompleted?: (payload: { btwId: string; message: string }) => void;
  onBtwError?: (payload: { btwId: string; message: string }) => void;
```

And in `bindAssistantEvents`:

```ts
  channel.on("btw_delta", (payload) => {
    const data = payload as { btw_id?: string | null; delta?: string | null };
    if (data.btw_id && typeof data.delta === "string") handlers.onBtwDelta?.({ btwId: data.btw_id, delta: data.delta });
  });

  channel.on("btw_completed", (payload) => {
    const data = payload as { btw_id?: string | null; message?: string | null };
    if (data.btw_id) handlers.onBtwCompleted?.({ btwId: data.btw_id, message: data.message ?? "" });
  });

  channel.on("btw_error", (payload) => {
    const data = payload as { btw_id?: string | null; message?: string | null };
    if (data.btw_id) handlers.onBtwError?.({ btwId: data.btw_id, message: data.message ?? "Side question failed" });
  });
```

### Step 5: Run + commit

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/BtwOverlay.test.tsx src/services/phoenix/__tests__/assistantChannel.test.ts && npx tsc --noEmit`
Expected: PASS.

```bash
git add tracker/src/components/assistant/BtwOverlay.tsx tracker/src/services/phoenix/assistantChannel.ts tracker/src/components/assistant/__tests__/BtwOverlay.test.tsx
git commit -m "feat(tracker): add BtwOverlay and btw channel bindings"
```

---

## Task 4: Wire `/btw` into `ProjectAssistantPanel`

**Files:**
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx` (`sendMessage` btw branch, overlay state, bindings, render)
- Test: `tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx`

### Step 1: Write the failing test

```tsx
it("opens an overlay and streams the answer when /btw is submitted", async () => {
  render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);
  const textarea = screen.getByPlaceholderText("Write a message...");

  fireEvent.change(textarea, { target: { value: "/btw what is useMemo" } });
  fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

  await waitFor(() =>
    expect(push).toHaveBeenCalledWith("btw", expect.objectContaining({ message: "what is useMemo" })),
  );

  // Simulate the channel reply assigning a btw_id, then streaming.
  const btwCallIndex = push.mock.calls.findIndex(([event]) => event === "btw");
  pushReceives[btwCallIndex]?.ok?.({ btw_id: "btw-1" });

  channelHandlers["btw_delta"]({ btw_id: "btw-1", delta: "useMemo memoizes" });
  expect(await screen.findByText(/useMemo memoizes/)).toBeTruthy();

  channelHandlers["btw_completed"]({ btw_id: "btw-1", message: "useMemo memoizes a value." });
  expect(await screen.findByText("useMemo memoizes a value.")).toBeTruthy();
});
```

### Step 2: Run to verify it fails

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx`
Expected: FAIL — `/btw` is queued/sent, not pushed as `btw`; no overlay.

### Step 3: Add overlay state and the btw branch

Add the import:

```tsx
import { BtwOverlay, type BtwStatus } from "@/components/assistant/BtwOverlay";
```

Add state near the others:

```tsx
  const [btw, setBtw] = useState<{ id: string | null; question: string; answer: string; status: BtwStatus } | null>(null);
```

In `sendMessage`, replace the `// (btw handled in the /btw plan)` seam with:

```tsx
      if (payload.kind === "btw") {
        const channel = channelRef.current;
        const question = payload.message.trim();
        if (!channel || !question) return;

        setBtw({ id: null, question, answer: "", status: "streaming" });
        channel
          .push("btw", { message: question })
          .receive("ok", (response) => {
            const id = (response as { btw_id?: string }).btw_id ?? null;
            setBtw((current) => (current ? { ...current, id } : current));
          })
          .receive("error", () => {
            setBtw((current) => (current ? { ...current, status: "error", answer: "Failed to start side question." } : current));
          });
        return;
      }
```

### Step 4: Bind btw streaming events and render the overlay

Add to the `bindAssistantEvents` call:

```tsx
      onBtwDelta: ({ btwId, delta }) =>
        setBtw((current) => (current && (current.id === btwId || current.id === null) ? { ...current, id: btwId, answer: current.answer + delta } : current)),
      onBtwCompleted: ({ btwId, message }) =>
        setBtw((current) => (current && current.id === btwId ? { ...current, answer: message, status: "complete" } : current)),
      onBtwError: ({ btwId, message }) =>
        setBtw((current) => (current && current.id === btwId ? { ...current, answer: message, status: "error" } : current)),
```

Render the overlay near the end of each returned layout (e.g. just before the closing `</AssistantRuntimeProvider>` in the panel-mode return and the sheet return):

```tsx
      {btw ? (
        <BtwOverlay
          question={btw.question}
          answer={btw.answer}
          status={btw.status}
          onClose={() => setBtw(null)}
        />
      ) : null}
```

### Step 5: Run + gate

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx && npx tsc --noEmit && npm test`
Expected: PASS.

### Step 6: Manual smoke check

While a turn is running, submit `/btw <question>`. Confirm the overlay opens, the answer streams, the main turn keeps running uninterrupted, Esc closes the overlay, and nothing new appears in the transcript.

### Step 7: Commit

```bash
git add tracker/src/components/assistant/ProjectAssistantPanel.tsx tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx
git commit -m "feat(tracker): wire /btw to ephemeral side-question overlay"
```

---

## Self-Review

- **Spec coverage (§9):** `/btw` runs whether or not a turn is active ✓ (Task 4 Step 3 pushes regardless of `isRunning`); separate ephemeral session, no tools ✓ (Task 1 `dynamic_tools: []` + deny-all executor); conversation history in prompt ✓ (Task 1 `format_history`); overlay with streaming + Esc dismiss ✓ (Task 3); not persisted ✓ (Task 1 — no `append_message`; asserted in Task 1 + Task 2 tests).
- **Placeholder scan:** none — all steps contain code or exact commands. The `ensure_btw_thread` nil-id note explains the live-path assumption; the issue/project assistant always has a thread at join, so the `%{}` branch runs in production.
- **Type consistency:** `btw` reply `%{btw_id}` matches Task 4 Step 3 `response.btw_id`. `btw_delta`/`btw_completed`/`btw_error` payload keys (`btw_id`, `delta`/`message`) match the channel pushes (Task 2 Step 3) and the bindings (Task 3 Step 4). `BtwStatus` (`"streaming" | "complete" | "error"`) is defined in Task 3 Step 3 and used in Task 4 state. `SideQuery.run/3` option names (`runner`, `on_delta`) match Task 1 and the channel caller (Task 2). `:assistant_side_runner` app env mirrors `:assistant_runner`.
- **Cross-plan note:** the `/btw` branch fills the seam left in the infer plan's `sendMessage`; the parser/palette already emit `kind: "btw"`.
