# Assistant `/infer` Steering — Implementation Plan

**Goal:** Add an `/infer <text>` slash command that injects the text into the in-flight Codex turn via `turn/steer`, redirecting the running agent. Falls back to queuing as a normal message when there is no steerable active turn.

**Architecture:** A shared `slashCommands` parser classifies composer input. `kind: "infer"` submitted while running pushes `steer_turn` to the channel; the channel persists a steer user message, then forwards `{:codex_steer, input, self()}` to the running turn Task (built in the foundation plan), which calls `turn/steer`. On `steer_error` (or no active turn) the channel emits `steer_failed`; the client then enqueues the text as a normal message. `/infer` with no active turn is sent as a normal message.

**Tech Stack:** React 19 + Tailwind v4 (composer/palette), Elixir/Phoenix.Channel, ExUnit, vitest.

**Source of truth:** `docs/superpowers/specs/2026-06-02-assistant-chat-steering-queue-design.md` §4, §8.

**Depends on:** `2026-06-02-assistant-turn-foundation.md` (Task `{:codex_steer, ...}` loop messages, `turn_pid`, `codex_turn_id` assigns) and `2026-06-02-assistant-queued-messages.md` (`kind` field, queue/fallback).

---

## Task 1: Slash-command parser + palette command list

**Files:**
- Create: `tracker/src/components/assistant/slashCommands.ts`
- Test: `tracker/src/components/assistant/__tests__/slashCommands.test.ts`

### Step 1: Write the failing test

```ts
import { describe, expect, it } from "vitest";

import { matchingSlashCommands, parseSlashCommand, SLASH_COMMANDS } from "../slashCommands";

describe("parseSlashCommand", () => {
  it("parses /infer with its argument", () => {
    expect(parseSlashCommand("/infer focus on tests")).toEqual({ kind: "infer", argument: "focus on tests" });
  });

  it("parses /btw with its argument", () => {
    expect(parseSlashCommand("/btw what's the diff")).toEqual({ kind: "btw", argument: "what's the diff" });
  });

  it("returns a plain message for non-commands", () => {
    expect(parseSlashCommand("hello there")).toEqual({ kind: "message", argument: "hello there" });
  });

  it("treats an unknown slash token as a plain message", () => {
    expect(parseSlashCommand("/unknown thing")).toEqual({ kind: "message", argument: "/unknown thing" });
  });

  it("trims the command argument", () => {
    expect(parseSlashCommand("/infer   spaced  ")).toEqual({ kind: "infer", argument: "spaced" });
  });
});

describe("matchingSlashCommands", () => {
  it("lists all commands when input is just a slash", () => {
    expect(matchingSlashCommands("/").map((c) => c.name)).toEqual(SLASH_COMMANDS.map((c) => c.name));
  });

  it("filters by prefix", () => {
    expect(matchingSlashCommands("/in").map((c) => c.name)).toEqual(["/infer"]);
  });

  it("returns nothing when input does not start with a slash", () => {
    expect(matchingSlashCommands("hello")).toEqual([]);
  });
});
```

### Step 2: Run to verify it fails

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/slashCommands.test.ts`
Expected: FAIL — module not found.

### Step 3: Implement the parser

```ts
import type { AssistantComposerSubmitKind } from "@/components/assistant/AssistantComposer";

export interface SlashCommandDef {
  name: `/${string}`;
  kind: Exclude<AssistantComposerSubmitKind, "message">;
  description: string;
}

export const SLASH_COMMANDS: readonly SlashCommandDef[] = [
  { name: "/infer", kind: "infer", description: "Steer the running agent without waiting" },
  { name: "/btw", kind: "btw", description: "Ask a quick side question (read-only, not saved)" },
] as const;

export interface ParsedComposerInput {
  kind: AssistantComposerSubmitKind;
  argument: string;
}

export function parseSlashCommand(input: string): ParsedComposerInput {
  const trimmedStart = input.trimStart();
  if (!trimmedStart.startsWith("/")) {
    return { kind: "message", argument: input.trim() };
  }

  const spaceIndex = trimmedStart.indexOf(" ");
  const token = spaceIndex === -1 ? trimmedStart : trimmedStart.slice(0, spaceIndex);
  const rest = spaceIndex === -1 ? "" : trimmedStart.slice(spaceIndex + 1);

  const command = SLASH_COMMANDS.find((entry) => entry.name === token.toLowerCase());
  if (!command) {
    return { kind: "message", argument: input.trim() };
  }

  return { kind: command.kind, argument: rest.trim() };
}

export function matchingSlashCommands(input: string): SlashCommandDef[] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) return [];

  const token = (trimmed.split(" ", 1)[0] ?? "").toLowerCase();
  return SLASH_COMMANDS.filter((entry) => entry.name.startsWith(token));
}
```

### Step 4: Run + commit

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/slashCommands.test.ts && npx tsc --noEmit`
Expected: PASS.

```bash
git add tracker/src/components/assistant/slashCommands.ts tracker/src/components/assistant/__tests__/slashCommands.test.ts
git commit -m "feat(tracker): add slash-command parser for assistant composer"
```

---

## Task 2: Composer emits command kind + shows a palette

**Files:**
- Modify: `tracker/src/components/assistant/AssistantComposer.tsx` (`submitCurrent` from queued-messages Task 1, textarea block `:246-253`)
- Test: `tracker/src/components/assistant/__tests__/AssistantComposer.test.tsx`

### Step 1: Write the failing test

```tsx
it("submits kind 'infer' when the message starts with /infer", () => {
  const onSubmit = vi.fn();
  render(<AssistantComposer projectSlug="macro-markets" catalog={testCatalog} onSubmit={onSubmit} />);

  const textarea = screen.getByPlaceholderText("Write a message...");
  fireEvent.change(textarea, { target: { value: "/infer look at the tests" } });
  fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "infer", message: "look at the tests" }),
  );
});

it("shows the slash-command palette when the input starts with a slash", () => {
  render(<AssistantComposer projectSlug="macro-markets" catalog={testCatalog} onSubmit={vi.fn()} />);
  const textarea = screen.getByPlaceholderText("Write a message...");
  fireEvent.change(textarea, { target: { value: "/" } });

  expect(screen.getByText("/infer")).toBeInTheDocument();
  expect(screen.getByText("/btw")).toBeInTheDocument();
});
```

### Step 2: Run to verify it fails

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/AssistantComposer.test.tsx`
Expected: FAIL — submit always uses `kind: "message"`; no palette.

### Step 3: Use the parser in `submitCurrent`

Add the import at the top of `AssistantComposer.tsx`:

```tsx
import { matchingSlashCommands, parseSlashCommand } from "@/components/assistant/slashCommands";
```

Replace `submitCurrent` (as written in the queued-messages plan) so it classifies the input:

```tsx
  function submitCurrent() {
    if (!canSend) return;

    const parsed = parseSlashCommand(input);
    if (parsed.kind !== "message" && parsed.argument.length === 0) return; // bare "/infer" with no text

    onSubmit({
      kind: parsed.kind,
      message: parsed.kind === "message" ? input : parsed.argument,
      settings,
      attachments: serializeAttachments(attachments),
    });

    revokeAttachmentPreviews(attachments);
    setInput("");
    setAttachments([]);
    recordingRef.current = false;
    stopSpeechRecognition();
  }
```

### Step 4: Render the palette

Add palette state near the other `useState` calls:

```tsx
  const paletteCommands = matchingSlashCommands(input);
  const showPalette = paletteCommands.length > 0 && input.trim().split(" ").length === 1;
```

Add the palette popover directly above the `<Textarea>` inside the rounded container (after the attachments block, before `<Textarea>` at `:246`):

```tsx
        {showPalette ? (
          <div className="border-b px-2 py-1.5">
            {paletteCommands.map((command) => (
              <button
                key={command.name}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                onClick={() => setInput(`${command.name} `)}
              >
                <span className="font-mono text-xs font-semibold">{command.name}</span>
                <span className="truncate text-xs text-muted-foreground">{command.description}</span>
              </button>
            ))}
          </div>
        ) : null}
```

### Step 5: Run + commit

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/AssistantComposer.test.tsx && npx tsc --noEmit`
Expected: PASS.

```bash
git add tracker/src/components/assistant/AssistantComposer.tsx tracker/src/components/assistant/__tests__/AssistantComposer.test.tsx
git commit -m "feat(tracker): classify slash commands and show command palette"
```

---

## Task 3: Route `/infer` to steer in `ProjectAssistantPanel`

**Files:**
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx` (`sendMessage` from queued-messages Task 2)
- Modify: `tracker/src/services/phoenix/assistantChannel.ts` (add `onSteerFailed` handler binding)
- Test: `tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx`

### Step 1: Write the failing test

```tsx
it("steers a running turn when /infer is submitted, and falls back to queue on steer_failed", async () => {
  render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);
  const textarea = screen.getByPlaceholderText("Write a message...");

  // Start a turn.
  fireEvent.change(textarea, { target: { value: "do work" } });
  fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(push).toHaveBeenCalledWith("send_message", expect.objectContaining({ message: "do work" })));
  channelHandlers["assistant_delta"]({ delta: "..." }); // running

  // /infer while running -> steer_turn push.
  fireEvent.change(textarea, { target: { value: "/infer prefer the simpler fix" } });
  fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
  await waitFor(() =>
    expect(push).toHaveBeenCalledWith("steer_turn", expect.objectContaining({ message: "prefer the simpler fix" })),
  );

  // Backend says the turn already finished -> fall back to queue.
  channelHandlers["steer_failed"]({ reason: "ActiveTurnNotSteerable", message: "prefer the simpler fix" });
  expect(await screen.findByText("prefer the simpler fix")).toBeTruthy(); // queued chip
});
```

### Step 2: Run to verify it fails

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx`
Expected: FAIL — `/infer` is sent as `send_message`, never `steer_turn`; no `steer_failed` handling.

### Step 3: Add the `steer_failed` binding

In `assistantChannel.ts`, add to `AssistantChannelHandlers`:

```ts
  onSteerFailed?: (payload: { reason: string; message: string }) => void;
```

And in `bindAssistantEvents`:

```ts
  channel.on("steer_failed", (payload) => {
    const data = payload as { reason?: string | null; message?: string | null };
    handlers.onSteerFailed?.({
      reason: data.reason ?? "steer_failed",
      message: data.message ?? "",
    });
  });
```

### Step 4: Route `/infer` and handle fallback in the panel

In `ProjectAssistantPanel.tsx`, update `sendMessage` (from the queued-messages plan) so command kinds branch before the queue logic:

```tsx
  const steerTurn = useCallback((payload: AssistantComposerSubmit) => {
    const channel = channelRef.current;
    const text = payload.message.trim();
    if (!channel || !text) return;
    channel.push("steer_turn", { message: text });
  }, []);

  const sendMessage = useCallback(
    (payload: AssistantComposerSubmit) => {
      const trimmed = payload.message.trim();
      const hasAttachments = payload.attachments.length > 0;
      if (!trimmed && !hasAttachments) return;

      if (payload.kind === "infer") {
        if (isRunning) {
          steerTurn(payload);
        } else {
          dispatchSend({ ...payload, kind: "message" });
        }
        return;
      }

      // (btw handled in the /btw plan)

      if (isRunning) {
        setQueued((current) => [...current, { id: crypto.randomUUID(), payload: { ...payload, kind: "message" } }]);
        return;
      }

      dispatchSend(payload);
    },
    [dispatchSend, isRunning, steerTurn],
  );
```

Add `onSteerFailed` to the `bindAssistantEvents` call (`:175-197`) to enqueue the failed steer text:

```tsx
      onSteerFailed: ({ message }) => {
        if (!message) return;
        setQueued((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            payload: {
              kind: "message",
              message,
              settings: defaultComposerSettings(catalogRef.current ?? fallbackCodexCatalog()),
              attachments: [],
            },
          },
        ]);
      },
```

### Step 5: Run + commit

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx src/services/phoenix/__tests__/assistantChannel.test.ts && npx tsc --noEmit`
Expected: PASS.

```bash
git add tracker/src/components/assistant/ProjectAssistantPanel.tsx tracker/src/services/phoenix/assistantChannel.ts tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx
git commit -m "feat(tracker): route /infer to turn steering with queue fallback"
```

---

## Task 4: `steer_turn` channel handler

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` (new `handle_in("steer_turn", ...)`, new `handle_info` clauses for steer results)
- Test: `elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs`

### Step 1: Write the failing test

```elixir
  test "steer_turn persists a steer message and forwards to the running turn" do
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_turn_started).("turn-xyz")
      send(test_pid, {:runner, self()})

      receive do
        {:codex_steer, input, reply_to} ->
          send(test_pid, {:steered, input})
          send(reply_to, {:steer_ok, %{"turnId" => "turn-xyz"}})
      after
        2_000 -> :ok
      end

      {:ok, %{assistant_message: "done", turn_id: "turn-xyz", tool_calls: []}}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)

    {:ok, %{messages: []}, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

    assert_push("history_loaded", %{messages: []})

    ref = push(socket, "send_message", %{"message" => "go", "context" => %{"view" => "board"}})
    assert_reply(ref, :ok, %{})
    assert_receive {:runner, _pid}, 2_000

    sref = push(socket, "steer_turn", %{"message" => "use the simpler approach"})
    assert_reply(sref, :ok, %{})

    assert_push("message_created", %{message: %{role: "user", content: "use the simpler approach"}})
    assert_receive {:steered, [%{"type" => "text", "text" => "use the simpler approach"}]}, 2_000
    assert_push("assistant_completed", %{message: %{role: "assistant", content: "done"}})
  end

  test "steer_turn replies error when no turn is running" do
    {:ok, %{messages: []}, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

    assert_push("history_loaded", %{messages: []})

    ref = push(socket, "steer_turn", %{"message" => "hi"})
    assert_reply(ref, :error, %{reason: "ActiveTurnNotSteerable"})
  end
```

> Note: the runner stub now receives the `{:codex_steer, ...}` message because the channel forwards it to `self()` of the running Task — which is the process executing the runner.

### Step 2: Run to verify it fails

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs -o "steer_turn"`
Expected: FAIL — no `steer_turn` handler.

### Step 3: Add the handler and steer-result `handle_info`

In `assistant_channel.ex`, add after the `dispatch_codex` handler (`:163`):

```elixir
  def handle_in("steer_turn", %{"message" => message}, socket) when is_binary(message) do
    trimmed = String.trim(message)

    cond do
      trimmed == "" ->
        {:reply, {:error, %{reason: "message is required"}}, socket}

      socket.assigns[:turn_status] != :running or not is_pid(socket.assigns[:turn_pid]) or
          is_nil(socket.assigns[:codex_turn_id]) ->
        {:reply, {:error, %{reason: "ActiveTurnNotSteerable"}}, socket}

      true ->
        thread = socket.assigns[:thread]

        case History.append_message(thread, %{role: "user", content: trimmed, metadata: %{"steer" => true}}) do
          {:ok, user_message} ->
            push(socket, "message_created", %{message: History.message_payload(user_message)})
            send(socket.assigns.turn_pid, {:codex_steer, [%{"type" => "text", "text" => trimmed}], self()})
            {:reply, :ok, assign(socket, :last_steer_text, trimmed)}

          {:error, reason} ->
            {:reply, {:error, %{reason: error_reason(reason)}}, socket}
        end
    end
  end

  def handle_in("steer_turn", _payload, socket), do: {:reply, {:error, %{reason: "message is required"}}, socket}
```

Add `handle_info` clauses (next to the turn-finished clauses from the foundation plan):

```elixir
  def handle_info({:steer_ok, _result}, socket), do: {:noreply, socket}

  def handle_info({:steer_error, _error}, socket) do
    push(socket, "steer_failed", %{
      reason: "ActiveTurnNotSteerable",
      message: socket.assigns[:last_steer_text] || ""
    })

    {:noreply, socket}
  end
```

### Step 4: Run + gate

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs && mix format && mix specs.check`
Expected: PASS.

### Step 5: Commit

```bash
git add elixir/lib/symphony_elixir_web/channels/assistant_channel.ex elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs
git commit -m "feat(assistant): add steer_turn channel handler for /infer"
```

---

## Self-Review

- **Spec coverage (§8):** slash parsing ✓ (Task 1–2); `/infer` while running → `steer_turn` → `turn/steer` ✓ (Task 3–4 + foundation loop); persists steer user message + `message_created` ✓ (Task 4 Step 3); fallback to queue on `steer_failed`/no active turn ✓ (Task 3 Step 4, Task 4 guard); `/infer` with no active turn → normal send ✓ (Task 3 Step 4 `dispatchSend`).
- **Placeholder scan:** none. The `// (btw handled in the /btw plan)` comment marks an intentional seam filled by the next plan, not a placeholder in this plan's behavior.
- **Type consistency:** `steer_turn` payload `{ message }` matches the handler. `{:codex_steer, [%{"type"=>"text","text"=>...}], self()}` matches the foundation `receive_loop` clause and `send_steer/4`. `{:steer_ok, _}` / `{:steer_error, _}` match `route_steer_response/3` in the foundation plan. `onSteerFailed` payload `{ reason, message }` is produced by the `steer_failed` push (Task 4 Step 3) and consumed in Task 3 Step 3–4. `dispatchSend`, `setQueued`, `catalogRef`, `defaultComposerSettings`, `fallbackCodexCatalog` all exist from prior plans/file.
